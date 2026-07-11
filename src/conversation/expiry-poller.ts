import {
  expireStalePendingBookings,
  findBusinessById,
  listAllBusinessIds,
} from '../database/queries';
import { botTokenStore, editTelegramMessageReplyMarkup, sendTelegramMessage } from '../telegram/client';
import { logger } from '../utils/logger';

// D-09: pending bookings the owner never acted on are auto-expired 2 hours
// after creation. Matches Plan 02-01's insertBooking's own expiresAt
// computation (and availability.ts's own pre-read sweep) — kept as a
// separate constant here since this module has no direct dependency on
// either of those call sites.
const EXPIRY_CUTOFF_MS = 2 * 60 * 60 * 1000;

const EXPIRY_NOTICE_GREEK =
  'Το ραντεβού σας δεν επιβεβαιώθηκε εγκαίρως από την επιχείρηση και ακυρώθηκε αυτόματα. Παρακαλούμε δοκιμάστε ξανά.';

// Sweeps every business's stale pending_owner_approval bookings (D-09) and
// proactively notifies the affected clients. Returns the count of
// bookings expired-and-notified this sweep. A single business's failure
// (T-02-19) is isolated via a per-business try/catch and never blocks the
// sweep for any other business.
export async function runExpirySweep(): Promise<number> {
  const businessIds = await listAllBusinessIds();
  let notifiedCount = 0;

  for (const businessId of businessIds) {
    try {
      const expired = await expireStalePendingBookings(businessId, EXPIRY_CUTOFF_MS);

      // Fetch business once per sweep iteration so botToken and ownerTelegramId
      // are available for all per-booking Telegram calls below (CR-03).
      const business = await findBusinessById(businessId);
      if (!business?.botToken) {
        logger.warn({ businessId }, 'No bot token for business, skipping Telegram notifications');
        continue;
      }

      for (const booking of expired) {
        // Per-booking isolation (CR-04), nested inside the per-business
        // isolation above: a booking already atomically flipped to
        // 'expired' by expireStalePendingBookings can never be revisited by
        // a future sweep (its WHERE clause only selects still-
        // pending_owner_approval rows), so one Telegram send failure here
        // must not permanently silence notification for the rest of this
        // already-expired batch.
        try {
          // botTokenStore.run ensures callTelegramApi picks up the correct
          // per-business bot token (CR-03: pollers have no inherited context).
          await botTokenStore.run(business.botToken, async () => {
            await sendTelegramMessage(booking.clientPhone, EXPIRY_NOTICE_GREEK);

            if (booking.ownerTelegramMessageId && business.ownerTelegramId) {
              // Button-clearing so a late tap on the original owner alert can't
              // resurrect an already-expired booking.
              await editTelegramMessageReplyMarkup(
                business.ownerTelegramId,
                booking.ownerTelegramMessageId,
                []
              );
            }
          });
          notifiedCount += 1;
        } catch (err) {
          logger.error(
            { err, bookingId: booking.id },
            'Failed to notify client of expired booking'
          );
        }
      }
    } catch (err) {
      logger.error({ err, businessId }, 'Expiry sweep failed for business');
    }
  }

  return notifiedCount;
}

// Plain in-process setInterval — no cron/Redis infrastructure, consistent
// with the locked Postgres-only stack. Returns the interval handle so
// callers (tests, graceful shutdown) can clearInterval it.
export function startExpiryPoller(intervalMs: number = 5 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    // Second safety net beyond runExpirySweep's own per-business isolation,
    // guarding against a totally unexpected top-level throw.
    runExpirySweep().catch((err) => logger.error({ err }, 'Unhandled expiry sweep error'));
  }, intervalMs);
}
