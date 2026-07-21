// Phase 9: Membership expiry notification sweep — covers NOTF-01, NOTF-02, NOTF-03.
// Sweeps every business's memberships expiring within 7 calendar days and sends
// Greek Telegram notifications to both the client and the business owner.
// Dedup via membership_expiry_notifications UNIQUE constraint prevents duplicate
// notifications on repeated sweeps (NOTF-03).
//
// Pattern mirrors expiry-poller.ts (per-business try/catch isolation) and
// reminders.ts (outer-loop-per-business + inner-loop-per-item structure).
// botTokenStore.run() is mandatory for all Telegram calls from pollers (D-06).

import { listAllBusinessIds, findBusinessById } from '../database/queries';
import {
  findMembershipsExpiringIn7Days,
  insertMembershipExpiryNotification,
  getClientName,
} from '../billing/queries';
import { botTokenStore, sendTelegramMessage } from '../telegram/client';
import { isoDateInAthens, formatExpiryDateGreek } from '../utils/timezone';
import { logger } from '../utils/logger';

/**
 * Sweeps all businesses for memberships expiring within 7 calendar days and
 * sends Greek Telegram notifications to the client (NOTF-01) and owner (NOTF-02).
 *
 * Returns the total count of Telegram notifications sent this sweep.
 *
 * Per-business and per-membership isolation via nested try/catch — one failure
 * never blocks the sweep for other businesses or other memberships (same pattern
 * as expiry-poller.ts lines 28–77).
 *
 * PROHIBITED: db.transaction() inside the sweep — atomicity is per-business/
 * per-membership try/catch, not a DB transaction (STATE.md Phase 8 decision).
 * botToken MUST NOT appear in any logger call (T-09-09).
 */
export async function runMembershipExpirySweep(): Promise<number> {
  const businessIds = await listAllBusinessIds();
  let notificationCount = 0;

  for (const businessId of businessIds) {
    try {
      const memberships = await findMembershipsExpiringIn7Days(businessId);
      const business = await findBusinessById(businessId);

      if (!business || !business.botToken) {
        logger.warn(
          { businessId },
          'No bot token for business, skipping membership expiry notifications'
        );
        continue;
      }

      for (const membership of memberships) {
        try {
          const expiryDate = isoDateInAthens(membership.expiresAt);
          const formattedDate = formatExpiryDateGreek(membership.expiresAt);

          // Client notification (NOTF-01) — '7_day_client' dedup key
          const clientNotified = await insertMembershipExpiryNotification(
            membership.id,
            '7_day_client',
            expiryDate
          );
          if (clientNotified) {
            const sessionsText =
              membership.sessionsRemaining !== null
                ? ` Έχετε ${membership.sessionsRemaining} μαθήματα απομείνει.`
                : '';
            const clientMsg =
              `Υπενθύμιση: Η συνδρομή σας λήγει σε 7 ημέρες, στις ${formattedDate}.${sessionsText}`;
            await botTokenStore.run(business.botToken, async () => {
              await sendTelegramMessage(membership.clientPhone, clientMsg);
            });
            notificationCount += 1;
          }

          // Owner notification (NOTF-02) — '7_day_owner' dedup key
          const ownerNotified = await insertMembershipExpiryNotification(
            membership.id,
            '7_day_owner',
            expiryDate
          );
          if (ownerNotified) {
            const clientName =
              (await getClientName(businessId, membership.clientPhone)) ??
              membership.clientPhone;
            const sessionsOwnerText =
              membership.sessionsRemaining !== null
                ? ` Εναπομείναντα μαθήματα: ${membership.sessionsRemaining}.`
                : ' Απεριόριστη συνδρομή.';
            const ownerMsg =
              `Πελάτης με λήγουσα συνδρομή: ${clientName}. Λήγει στις ${formattedDate}.${sessionsOwnerText}`;
            await botTokenStore.run(business.botToken, async () => {
              if (business.ownerTelegramId) {
                await sendTelegramMessage(business.ownerTelegramId, ownerMsg);
              }
            });
            notificationCount += 1;
          }
        } catch (err) {
          logger.error(
            { err, membershipId: membership.id, businessId },
            'Membership expiry notification failed'
          );
        }
      }
    } catch (err) {
      logger.error({ err, businessId }, 'Membership expiry sweep failed for business');
    }
  }

  return notificationCount;
}

/**
 * Starts an in-process setInterval that runs runMembershipExpirySweep on the
 * given interval. Default is 6 hours (D-02). Returns the interval handle so
 * callers (tests, graceful shutdown) can clearInterval it.
 *
 * MUST be called only inside the !JEST_WORKER_ID guard in server.ts to prevent
 * the interval from keeping Jest alive (Pitfall 3 / T-09-11).
 */
export function startMembershipExpiryPoller(
  intervalMs: number = 6 * 60 * 60 * 1000
): NodeJS.Timeout {
  return setInterval(() => {
    runMembershipExpirySweep().catch((err) =>
      logger.error({ err }, 'Unhandled membership expiry sweep error')
    );
  }, intervalMs);
}
