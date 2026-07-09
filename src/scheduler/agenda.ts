import {
  claimAgendaSlot,
  findBusinessById,
  findServiceById,
  listAllBusinessIds,
  listBookingsForDate,
  type Booking,
} from '../database/queries';
import { sendTelegramMessage } from '../telegram/client';
import { isoDateInAthens } from '../utils/timezone';
import { logger } from '../utils/logger';

// D-09/D-11: once per business per Athens calendar day, a Greek summary of
// that day's confirmed appointments. Bookings are already ordered by
// calendarTime (Plan 03-01's listBookingsForDate), so no re-sort here.
function formatAgendaMessage(bookings: Booking[], serviceNamesById: Map<number, string>): string {
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
  const businessIds = await listAllBusinessIds();
  let sentCount = 0;
  const todayIso = isoDateInAthens(new Date());

  for (const businessId of businessIds) {
    try {
      const business = await findBusinessById(businessId);
      if (!business?.ownerTelegramId) continue;

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
      await sendTelegramMessage(business.ownerTelegramId, message);
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
