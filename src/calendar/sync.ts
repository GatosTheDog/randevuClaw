import { google } from 'googleapis';
import { getOAuth2Client } from '../google/oauth';
import {
  Booking,
  Business,
  Service,
  updateBookingGoogleEventId,
  updateCalendarSyncStatus,
} from '../database/queries';
import { getClientName } from '../billing/queries';
import {
  ATHENS_TIME_ZONE,
  OWNER_REMINDER_MINUTES,
  addMinutesToLocalTime,
  buildOwnerEventDescription,
  buildOwnerEventSummary,
  formatClientLabel,
} from './event-content';
import { GOOGLE_API_TIMEOUT_MS } from '../google/constants';
import {
  describeGoogleError,
  isGoogleAuthRevokedError,
  isGoogleNotFoundError,
} from '../google/errors';
import { handleGoogleAuthRevoked } from './owner-nudge';
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

// One bounded attempt per call. googleapis defaults to retry:true, which could
// stack several GOOGLE_API_TIMEOUT_MS attempts inside the webhook transaction
// (15 s idle_in_transaction limit); the 5-minute poller supplies the retries.
function createCalendar(client: OAuth2Client) {
  return google.calendar({
    version: 'v3',
    auth: client,
    timeout: GOOGLE_API_TIMEOUT_MS,
    retry: false,
  });
}

async function buildEventBody(booking: Booking, business: Business, service: Service) {
  // D-07: `<service> — <client label>`; label is the client's name when known.
  let clientName: string | null = null;
  try {
    clientName = await getClientName(business.id, booking.clientPhone);
  } catch (err) {
    logger.warn(
      { bookingId: booking.id, businessId: business.id, ...describeGoogleError(err) },
      'Client name lookup failed; using generic label'
    );
  }
  const label = formatClientLabel(clientName, booking.clientPhone);
  const end = addMinutesToLocalTime(booking.calendarDate, booking.calendarTime, service.durationMin);

  // D-08: no location, no attendees (no invitation emails).
  return {
    summary: buildOwnerEventSummary(service.name, label),
    description: buildOwnerEventDescription(business.name, service.name),
    start: { dateTime: `${booking.calendarDate}T${booking.calendarTime}:00`, timeZone: ATHENS_TIME_ZONE },
    end: { dateTime: `${end.date}T${end.time}:00`, timeZone: ATHENS_TIME_ZONE },
    reminders: {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: OWNER_REMINDER_MINUTES }],
    },
  };
}

// A status write must never make a sync/delete function throw.
async function safeSetStatus(bookingId: number, status: 'pending' | 'synced' | 'failed'): Promise<void> {
  try {
    await updateCalendarSyncStatus(bookingId, status);
  } catch (err) {
    logger.warn({ bookingId, ...describeGoogleError(err) }, 'Calendar sync status write failed');
  }
}

async function handleRevocationSafely(business: Business): Promise<void> {
  try {
    await handleGoogleAuthRevoked(business);
  } catch (err) {
    logger.warn(
      { businessId: business.id, ...describeGoogleError(err) },
      'Revoked-authorization handling failed'
    );
  }
}

// Best-effort, non-blocking per D-15 (RESEARCH.md Pitfall 2): NEVER throws.
// The booking's DB status is always the source of truth; a Calendar API
// failure here only ever results in `false` + calendarSyncStatus='pending'
// for the retry poller to pick up later. Session (class) bookings use the
// same path: duration comes from the booking's service (D-05).
export async function syncBookingToCalendar(
  booking: Booking,
  business: Business,
  service: Service
): Promise<boolean> {
  try {
    const client = getCalendarClientForBusiness(business);
    if (!client) {
      // D-06: silent when the business has not connected Google Calendar.
      logger.info({ businessId: business.id }, 'No Google Calendar configured for business; sync skipped');
      return false;
    }

    const calendar = createCalendar(client);
    const requestBody = await buildEventBody(booking, business, service);

    let needsInsert = true;
    if (booking.googleCalendarEventId) {
      try {
        await calendar.events.update({
          calendarId: 'primary',
          eventId: booking.googleCalendarEventId,
          requestBody,
          sendUpdates: 'none',
        });
        needsInsert = false;
      } catch (err) {
        // Owner deleted the event by hand (404/410): recreate it.
        if (!isGoogleNotFoundError(err)) throw err;
        logger.info(
          { bookingId: booking.id, businessId: business.id },
          'Calendar event no longer exists; recreating'
        );
      }
    }

    if (needsInsert) {
      const result = await calendar.events.insert({
        calendarId: 'primary',
        requestBody,
        sendUpdates: 'none',
      });
      if (result.data.id) await updateBookingGoogleEventId(booking.id, result.data.id);
    }

    await updateCalendarSyncStatus(booking.id, 'synced');
    return true;
  } catch (err) {
    // Never pass `err` itself: gaxios errors embed request bodies with secrets.
    logger.error(
      { bookingId: booking.id, businessId: business.id, ...describeGoogleError(err) },
      'Calendar sync failed (non-blocking)'
    );
    await safeSetStatus(booking.id, 'pending');
    if (isGoogleAuthRevokedError(err)) await handleRevocationSafely(business);
    return false;
  }
}

// Best-effort, non-blocking per D-15: NEVER throws. A booking that never got
// an event has nothing to delete: mark it synced so it leaves the sweep. An
// event that is already gone (404/410) counts as success.
export async function deleteBookingFromCalendar(booking: Booking, business: Business): Promise<boolean> {
  try {
    if (!booking.googleCalendarEventId) {
      await safeSetStatus(booking.id, 'synced');
      return true;
    }

    const client = getCalendarClientForBusiness(business);
    if (!client) return false;

    const calendar = createCalendar(client);
    try {
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: booking.googleCalendarEventId,
        sendUpdates: 'none',
      });
    } catch (err) {
      if (!isGoogleNotFoundError(err)) throw err;
      // Already deleted by the owner: treat as success.
    }
    await updateCalendarSyncStatus(booking.id, 'synced');
    return true;
  } catch (err) {
    logger.warn(
      { bookingId: booking.id, businessId: business.id, ...describeGoogleError(err) },
      'Calendar deletion failed (will retry via poller)'
    );
    await safeSetStatus(booking.id, 'pending');
    if (isGoogleAuthRevokedError(err)) await handleRevocationSafely(business);
    return false;
  }
}
