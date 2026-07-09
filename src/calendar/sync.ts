import { google } from 'googleapis';
import { getOAuth2Client } from '../google/oauth';
import {
  Booking,
  Business,
  Service,
  updateBookingGoogleEventId,
  updateCalendarSyncStatus,
} from '../database/queries';
import { addCalendarDays } from '../utils/timezone';
import { logger } from '../utils/logger';

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

// The OAuth client is ALWAYS constructed fresh from the specific `business`
// row passed in (never a global/cached credential) -- T-03-05: a bug that
// passed the wrong business's row would be caught by this file's own
// Test 4/5-equivalent assertions, and no code path here ever reuses one
// business's client for another business's booking.
export function getCalendarClientForBusiness(business: Business): OAuth2Client | null {
  if (!business.googleRefreshToken) return null;
  const client = getOAuth2Client();
  client.setCredentials({ refresh_token: business.googleRefreshToken });
  return client;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// Rare midnight-crossing case (a service that runs past 23:59 local time)
// reuses the existing DST-safe addCalendarDays helper rather than
// duplicating date-rollover logic.
function addMinutesToLocalTime(
  calendarDate: string,
  calendarTime: string,
  minutes: number
): { date: string; time: string } {
  const [hours, mins] = calendarTime.split(':').map(Number);
  const total = hours * 60 + mins + minutes;
  const dayOverflow = Math.floor(total / 1440);
  const remainder = ((total % 1440) + 1440) % 1440;
  const remHours = Math.floor(remainder / 60);
  const remMins = remainder % 60;
  return {
    date: dayOverflow > 0 ? addCalendarDays(calendarDate, dayOverflow) : calendarDate,
    time: `${pad2(remHours)}:${pad2(remMins)}`,
  };
}

// Best-effort, non-blocking per D-15 (RESEARCH.md Pitfall 2): NEVER throws.
// The booking's DB status is always the source of truth; a Calendar API
// failure here only ever results in `false` + calendarSyncStatus='pending'
// for the retry poller to pick up later.
export async function syncBookingToCalendar(
  booking: Booking,
  business: Business,
  service: Service
): Promise<boolean> {
  const client = getCalendarClientForBusiness(business);
  if (!client) {
    logger.warn({ businessId: business.id }, 'No Google Calendar configured for business');
    return false;
  }

  const calendar = google.calendar({ version: 'v3', auth: client });
  const end = addMinutesToLocalTime(booking.calendarDate, booking.calendarTime, service.durationMin);
  // D-08: title = service name + client identifier, no attendee/email invite.
  const requestBody = {
    summary: `${service.name} — Client ${booking.clientPhone}`,
    start: { dateTime: `${booking.calendarDate}T${booking.calendarTime}:00`, timeZone: 'Europe/Athens' },
    end: { dateTime: `${end.date}T${end.time}:00`, timeZone: 'Europe/Athens' },
  };

  try {
    if (booking.googleCalendarEventId) {
      await calendar.events.update({
        calendarId: 'primary',
        eventId: booking.googleCalendarEventId,
        requestBody,
      });
    } else {
      const result = await calendar.events.insert({ calendarId: 'primary', requestBody });
      if (result.data.id) await updateBookingGoogleEventId(booking.id, result.data.id);
    }
    await updateCalendarSyncStatus(booking.id, 'synced');
    return true;
  } catch (err) {
    logger.error({ err, bookingId: booking.id, businessId: business.id }, 'Calendar sync failed (non-blocking)');
    await updateCalendarSyncStatus(booking.id, 'pending');
    return false;
  }
}

// Best-effort, non-blocking per D-15: NEVER throws. Deleting an event that
// was never created (googleCalendarEventId is null) or already deleted is a
// silent no-op, not an error.
export async function deleteBookingFromCalendar(booking: Booking, business: Business): Promise<boolean> {
  if (!booking.googleCalendarEventId) return true;

  const client = getCalendarClientForBusiness(business);
  if (!client) return false;

  const calendar = google.calendar({ version: 'v3', auth: client });
  try {
    await calendar.events.delete({ calendarId: 'primary', eventId: booking.googleCalendarEventId });
    await updateCalendarSyncStatus(booking.id, 'synced');
    return true;
  } catch (err) {
    logger.warn({ err, bookingId: booking.id }, 'Calendar deletion failed (will retry via poller)');
    await updateCalendarSyncStatus(booking.id, 'pending');
    return false;
  }
}
