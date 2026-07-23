import {
  claimAgendaSlot,
  findBusinessById,
  findServiceById,
  listAllBusinessIds,
  listBookingsForDate,
  type Booking,
} from '../database/queries';
import { botTokenStore, sendTelegramMessage } from '../telegram/client';
import { isoDateInAthens } from '../utils/timezone';
import { logger } from '../utils/logger';

// D-09: agenda sweeps only fire at or after 08:00 Athens wall-clock time.
// The first poller tick at or after 08:00 claims the slot and sends; ticks
// before 08:00 bail out before any DB call so claimAgendaSlot is never called
// during the early-morning window (OWNR-03 truth D-09).
const AGENDA_HOUR_THRESHOLD = 8;
export { AGENDA_HOUR_THRESHOLD };

// Parse "HH:MM" into wall-clock minutes since midnight.
function minutesSinceMidnight(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

// Return the current Athens wall-clock time as "HH:MM". Uses en-GB locale
// because its 24-hour format with hour12:false is unambiguous and stable
// across Node versions. Identical to the same function in src/scheduler/reminders.ts.
function athensWallClockTime(date: Date): string {
  return date.toLocaleString('en-GB', {
    timeZone: 'Europe/Athens',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// D-09/D-11: once per business per Athens calendar day, a Greek summary of
// that day's confirmed appointments. Bookings are already ordered by
// calendarTime (Plan 03-01's listBookingsForDate), so no re-sort here.
// Exported so admin-menu.ts can call it directly for on-demand agenda
// (Plan 17-02 AMENU-05) without going through claimAgendaSlot.
export function formatAgendaMessage(bookings: Booking[], serviceNamesById: Map<number, string>): string {
  const lines = bookings.map((booking) => {
    const serviceName = serviceNamesById.get(booking.serviceId) ?? 'Άγνωστη υπηρεσία';
    return `${booking.calendarTime} - ${serviceName} (${booking.clientPhone})`;
  });
  return ['Η ατζέντα σας για σήμερα:', ...lines].join('\n');
}

// Sweeps every business, sending at most one daily agenda message per
// business per Athens calendar day. Mirrors expiry-poller.ts's/poller.ts's
// per-business try/catch isolation. Returns the count of agendas sent this
// sweep.
export async function runAgendaSweep(): Promise<number> {
  // OWNR-03 / D-09: bail out before any DB call if Athens wall-clock time is
  // before 08:00. claimAgendaSlot must NOT be called during this pre-08:00
  // bailout — the slot stays unclaimed so the first tick at or after 08:00 can
  // claim and send.
  const nowAthens = athensWallClockTime(new Date());
  if (minutesSinceMidnight(nowAthens) < AGENDA_HOUR_THRESHOLD * 60) return 0;

  const businessIds = await listAllBusinessIds();
  let sentCount = 0;
  const todayIso = isoDateInAthens(new Date());

  for (const businessId of businessIds) {
    try {
      const business = await findBusinessById(businessId);
      if (!business?.ownerTelegramId) continue;
      if (!business.botToken) {
        logger.warn({ businessId }, 'No bot token for business, skipping agenda notification');
        continue;
      }

      const bookings = await listBookingsForDate(businessId, todayIso);
      if (bookings.length === 0) continue;

      // Atomic claim happens AFTER confirming there is something to send but
      // BEFORE the Telegram send itself: a lost race means no message is
      // sent (never a duplicate) -- Plan 03-01's claimAgendaSlot closes
      // RESEARCH.md Pitfall 5.
      const claimed = await claimAgendaSlot(businessId, todayIso);
      if (!claimed) continue;

      const serviceNamesById = new Map<number, string>();
      for (const booking of bookings) {
        if (!serviceNamesById.has(booking.serviceId)) {
          const service = await findServiceById(businessId, booking.serviceId);
          serviceNamesById.set(booking.serviceId, service?.name ?? 'Άγνωστη υπηρεσία');
        }
      }

      const message = formatAgendaMessage(bookings, serviceNamesById);
      const ownerTelegramId = business.ownerTelegramId;
      // botTokenStore.run ensures callTelegramApi picks up the correct
      // per-business bot token (CR-03: pollers have no inherited context).
      await botTokenStore.run(business.botToken, async () => {
        await sendTelegramMessage(ownerTelegramId, message);
      });
      sentCount += 1;
      logger.info({ businessId, date: todayIso, count: bookings.length }, 'Agenda sent');
    } catch (err) {
      logger.error({ err, businessId }, 'Agenda sweep failed for business');
    }
  }

  return sentCount;
}

// Plain in-process setInterval, matching startExpiryPoller/startCalendarSyncPoller's
// shape (D-12: same process as the Express server, no fly.toml [processes]
// change). Default 10 minutes (D-09 discretion): frequent enough that the
// agenda lands within 10 minutes of 8am, cheap enough to run continuously.
export function startAgendaPoller(intervalMs: number = 10 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    runAgendaSweep().catch((err) => logger.error({ err }, 'Unhandled agenda sweep error'));
  }, intervalMs);
}
