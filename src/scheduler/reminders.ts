import {
  listAllBusinessIds,
  findBookingsNeedingReminder,
  claimReminder24hSlot,
  claimReminder1hSlot,
  type Booking,
} from '../database/queries';
import { isoDateInAthens, addCalendarDays } from '../utils/timezone';
import { sendTelegramMessage } from '../telegram/client';
import { logger } from '../utils/logger';

// --- DST-safe Athens-local helpers ---

// Parse "HH:MM" into wall-clock minutes since midnight.
function minutesSinceMidnight(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

// Return the current Athens wall-clock time as "HH:MM". Uses en-GB locale
// because its 24-hour format with hour12:false is unambiguous and stable
// across Node versions.
function athensWallClockTime(date: Date): string {
  return date.toLocaleString('en-GB', {
    timeZone: 'Europe/Athens',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// Count calendar days from one ISO date to another using the noon-UTC-anchor
// technique from src/utils/timezone.ts's addCalendarDays. The anchor
// guarantees the result is invariant to the DST offset active on either date.
// Negative result means `toIso` is earlier than `fromIso`.
function calendarDaysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (new Date(`${toIso}T12:00:00Z`).getTime() -
      new Date(`${fromIso}T12:00:00Z`).getTime()) /
      86400000
  );
}

// D-14 eligibility gate. Returns true iff there was at least `minHours` hours
// between the booking's creation (expressed in Athens local time) and the
// appointment. This is a pure function of booking.createdAt (immutable), so
// it is evaluated once per booking per sweep and produces the same result
// forever — a booking that misses the 24h threshold at creation time is
// permanently ineligible for the 24h reminder, no catch-up sends (D-14).
//
// All arithmetic is calendar-date strings and wall-clock minutes — no raw
// Date.getTime() subtraction between two instants that could straddle a
// DST transition.
function hadAtLeastHoursMarginAtBookingTime(booking: Booking, minHours: number): boolean {
  const createdDateIso = isoDateInAthens(booking.createdAt);
  const createdTimeMin = minutesSinceMidnight(athensWallClockTime(booking.createdAt));
  const apptTimeMin = minutesSinceMidnight(booking.calendarTime);
  const daysBetween = calendarDaysBetween(createdDateIso, booking.calendarDate);

  if (daysBetween < 0) return false;

  if (daysBetween === 0) {
    // Same Athens calendar day: margin = (apptTime - createdTime) minutes
    return apptTimeMin - createdTimeMin >= minHours * 60;
  }

  // Cross-day: minutes remaining today + full middle days + minutes until appt
  const marginMinutes =
    (24 * 60 - createdTimeMin) +
    (daysBetween - 1) * 24 * 60 +
    apptTimeMin;
  return marginMinutes >= minHours * 60;
}

// Unified "how many minutes from now until the appointment" computation.
// Negative when the appointment has already passed. Correctly handles the
// late-night/day-crossing case (RESEARCH.md Subtask 4) without separate
// today/tomorrow branching: a 01:00 appointment at 01:05 on the same Athens
// calendar day returns a small negative number (past), not a large positive
// number (misread as "23h until tomorrow's 01:00").
function minutesUntilAppointment(booking: Booking, now: Date): number {
  const todayIso = isoDateInAthens(now);
  const nowTimeMin = minutesSinceMidnight(athensWallClockTime(now));
  const apptTimeMin = minutesSinceMidnight(booking.calendarTime);

  if (booking.calendarDate === todayIso) {
    // Same calendar day: positive = still in the future, negative = past
    return apptTimeMin - nowTimeMin;
  }

  const daysBetween = calendarDaysBetween(todayIso, booking.calendarDate);
  if (daysBetween < 0) {
    // Appointment was on a past Athens calendar day
    return -Infinity;
  }

  // Future calendar day: minutes remaining today + full middle days + minutes until appt
  return (24 * 60 - nowTimeMin) + (daysBetween - 1) * 24 * 60 + apptTimeMin;
}

// --- Exported sweep and poller ---

// Sweeps every business's confirmed bookings approaching their appointment
// time and sends 24h-prior and 1h-prior Telegram reminders to each client,
// exactly once each per reminder type. Returns the total count of reminders
// sent this sweep (24h + 1h combined).
//
// Design invariants:
//   - The 24h check and the 1h check are independent `if` blocks (never `else if`):
//     a booking simultaneously eligible for both (e.g. poller was down for a long
//     stretch) receives each reminder it hasn't already gotten, exactly once each.
//   - `claimReminder24hSlot`/`claimReminder1hSlot` are called BEFORE
//     `sendTelegramMessage` for each type — a lost race (false) means no send,
//     never a duplicate (atomic UPDATE...WHERE...RETURNING, Plan 03-01 T-03-02).
//   - Per-business and per-booking try/catch isolation mirrors expiry-poller.ts:
//     one failure never blocks the rest of the sweep.
export async function runReminderSweep(): Promise<number> {
  const businessIds = await listAllBusinessIds();
  let sentCount = 0;
  const now = new Date();
  const todayIso = isoDateInAthens(now);
  const tomorrowIso = addCalendarDays(todayIso, 1);

  for (const businessId of businessIds) {
    try {
      const candidates = await findBookingsNeedingReminder(businessId, [todayIso, tomorrowIso]);

      for (const booking of candidates) {
        try {
          const minutesUntil = minutesUntilAppointment(booking, now);

          // Appointment already passed — skip both reminders.
          if (minutesUntil < 0) continue;

          // 24h reminder: independent of the 1h check below.
          if (
            !booking.reminder24hSentAt &&
            hadAtLeastHoursMarginAtBookingTime(booking, 24) &&
            minutesUntil <= 24 * 60
          ) {
            // CR-01 / NOTF-01: use 'σήμερα' for same-day appointments, 'αύριο'
            // for next-day ones. booking.calendarDate and todayIso are both
            // Athens-local ISO dates; comparison is a pure string equality check.
            const dayLabel = booking.calendarDate === todayIso ? 'σήμερα' : 'αύριο';
            const claimed = await claimReminder24hSlot(booking.id);
            if (claimed) {
              await sendTelegramMessage(
                booking.clientPhone,
                `Υπενθύμιση: έχετε ραντεβού ${dayLabel} στις ${booking.calendarTime}.`
              );
              sentCount += 1;
            }
          }

          // 1h reminder: independent of the 24h check above.
          if (
            !booking.reminder1hSentAt &&
            hadAtLeastHoursMarginAtBookingTime(booking, 1) &&
            minutesUntil <= 60
          ) {
            const claimed = await claimReminder1hSlot(booking.id);
            if (claimed) {
              await sendTelegramMessage(
                booking.clientPhone,
                `Υπενθύμιση: το ραντεβού σας είναι σε 1 ώρα, στις ${booking.calendarTime}.`
              );
              sentCount += 1;
            }
          }
        } catch (err) {
          logger.error({ err, bookingId: booking.id }, 'Reminder send failed for booking');
        }
      }
    } catch (err) {
      logger.error({ err, businessId }, 'Reminder sweep failed for business');
    }
  }

  return sentCount;
}

// Plain in-process setInterval — 15 minutes (D-10, locked: not discretionary
// unlike the agenda poller's D-09 discretion). Returns the interval handle so
// callers (tests, graceful shutdown) can clearInterval it.
export function startReminderPoller(intervalMs: number = 15 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    runReminderSweep().catch((err) =>
      logger.error({ err }, 'Unhandled reminder sweep error')
    );
  }, intervalMs);
}
