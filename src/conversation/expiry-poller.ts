import {
  expireStalePendingBookings,
  findBusinessById,
  listAllBusinessIds,
  withBusinessContext,
} from '../database/queries';
import type { Booking } from '../database/queries';
import { botTokenStore, editTelegramMessageReplyMarkup, sendTelegramMessage } from '../telegram/client';
import { logger } from '../utils/logger';
import { releaseSessionCapacity } from '../session/manager';
import { findMembershipByBooking, restoreCredit } from '../billing/queries';

// D-09: pending bookings the owner never acted on are auto-expired 2 hours
// after creation. Matches Plan 02-01's insertBooking's own expiresAt
// computation (and availability.ts's own pre-read sweep) — kept as a
// separate constant here since this module has no direct dependency on
// either of those call sites.
const EXPIRY_CUTOFF_MS = 2 * 60 * 60 * 1000;

const EXPIRY_NOTICE_GREEK =
  'Το ραντεβού σας δεν επιβεβαιώθηκε εγκαίρως από την επιχείρηση και ακυρώθηκε αυτόματα. Παρακαλούμε δοκιμάστε ξανά.';

// Phase 22 (OWNR-07): releases the held session capacity and restores any
// deducted session credit for an expired session-class booking. No-ops for
// non-session bookings (sessionInstanceId null/undefined — covers both real
// open-slot bookings and this file's own mocked test fixtures, which omit
// the field entirely). Mirrors the exact restoreCredit call shape already
// used by handleCancelExecute — no new credit-restore path invented.
export async function releaseExpiredSessionBooking(businessId: number, booking: Booking): Promise<void> {
  if (!booking.sessionInstanceId) return;

  await withBusinessContext(businessId, async () => {
    await releaseSessionCapacity(booking.sessionInstanceId!);
    const membershipId = await findMembershipByBooking(booking.id);
    if (membershipId !== null) {
      await restoreCredit(membershipId, booking.id, `booking:${booking.id}:credit`);
    }
  });
}

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
          // Phase 22 (OWNR-07): release held capacity + restore any deducted
          // credit for session-class bookings before notifying the client.
          // Stays inside this same per-booking try/catch (CR-04) — a failure
          // here is caught and logged exactly like an existing notification
          // failure, never aborting the rest of the batch.
          await releaseExpiredSessionBooking(businessId, booking);

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
