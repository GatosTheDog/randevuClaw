import {
  findBookingsNeedingCalendarSync,
  findBusinessById,
  findServiceById,
  incrementCalendarSyncRetryCount,
  listAllBusinessIds,
  updateCalendarSyncStatus,
} from '../database/queries';
import { deleteBookingFromCalendar, syncBookingToCalendar } from './sync';
import { logger } from '../utils/logger';

// D-16: ~50 minutes total retry window (10 attempts x 5-minute poll
// interval) before a stuck sync is permanently abandoned -- bounds Google
// Calendar API quota exposure per booking (T-03-06).
const MAX_CALENDAR_SYNC_RETRIES = 10;

// Mirrors src/conversation/expiry-poller.ts's per-business + per-booking
// try/catch isolation: one business's (or one booking's) failure never
// blocks the sweep for any other business/booking. Returns the count of
// bookings successfully synced/deleted this sweep.
export async function runCalendarSyncSweep(): Promise<number> {
  const businessIds = await listAllBusinessIds();
  let syncedCount = 0;

  for (const businessId of businessIds) {
    try {
      const business = await findBusinessById(businessId);
      if (!business?.googleRefreshToken) continue;

      const pending = await findBookingsNeedingCalendarSync(businessId);

      for (const booking of pending) {
        try {
          let success: boolean;
          if (booking.bookingStatus === 'confirmed') {
            const service = await findServiceById(businessId, booking.serviceId);
            success = service ? await syncBookingToCalendar(booking, business, service) : false;
          } else {
            // findBookingsNeedingCalendarSync only ever returns
            // 'confirmed' | 'cancelled' rows (Plan 03-01's filter).
            success = await deleteBookingFromCalendar(booking, business);
          }

          if (success) {
            syncedCount += 1;
            continue;
          }

          const retryCount = await incrementCalendarSyncRetryCount(booking.id);
          if (retryCount >= MAX_CALENDAR_SYNC_RETRIES) {
            await updateCalendarSyncStatus(booking.id, 'failed');
            logger.error(
              { businessId, bookingId: booking.id, retryCount },
              'Calendar sync permanently failed after max retries'
            );
          } else {
            logger.warn(
              { businessId, bookingId: booking.id, retryCount },
              'Calendar sync attempt failed, will retry'
            );
          }
        } catch (err) {
          logger.error({ err, businessId, bookingId: booking.id }, 'Calendar sync sweep failed for booking');
        }
      }
    } catch (err) {
      logger.error({ err, businessId }, 'Calendar sync sweep failed for business');
    }
  }

  return syncedCount;
}

// Plain in-process setInterval, matching startExpiryPoller's shape/default
// (D-12: same process as the Express server, no fly.toml [processes] change).
export function startCalendarSyncPoller(intervalMs: number = 5 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    runCalendarSyncSweep().catch((err) => logger.error({ err }, 'Unhandled calendar sync sweep error'));
  }, intervalMs);
}
