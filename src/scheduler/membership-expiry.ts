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
  findMembershipsAtThreshold,
  insertRenewalNudgeNotification,
} from '../billing/queries';
import { botTokenStore, sendTelegramMessage, sendTelegramMessageWithKeyboard } from '../telegram/client';
import { isoDateInAthens, formatExpiryDateGreek } from '../utils/timezone';
import { logger } from '../utils/logger';

// RENW-04: in-memory store of pending renewal batch lists awaiting owner approval.
// Keyed by businessId. Cleared after owner taps Ναι/Όχι or after 10 minutes.
export const pendingRenewalBatches = new Map<number, string[]>();

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
      // WR-03: check business existence and botToken BEFORE fetching memberships so
      // unconfigured or partially-onboarded businesses do not pay a wasted DB query.
      const business = await findBusinessById(businessId);

      if (!business || !business.botToken) {
        logger.warn(
          { businessId },
          'No bot token for business, skipping membership expiry notifications'
        );
        continue;
      }

      const memberships = await findMembershipsExpiringIn7Days(businessId);

      for (const membership of memberships) {
        try {
          const expiryDate = isoDateInAthens(membership.expiresAt);
          const formattedDate = formatExpiryDateGreek(membership.expiresAt);

          // Client notification (NOTF-01) — '7_day_client' dedup key.
          // At-most-once delivery tradeoff: the dedup row is inserted BEFORE sending the
          // Telegram message. If sendTelegramMessage throws (Telegram down, rate limit,
          // network error), the dedup row is already committed and this client will be
          // skipped on all future sweeps for this membership+expiry-date combination.
          // This is an intentional PoC tradeoff: at-most-once delivery to prevent duplicate
          // sends on concurrent sweeps (6-hour interval makes Telegram failures rare enough
          // to be acceptable). A production system would insert the dedup row only after
          // confirmed delivery (WR-02). The dedup table therefore tracks which notifications
          // were *attempted*, not necessarily delivered.
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

          // Owner notification (NOTF-02) — guard before dedup insert, not just before send.
          // If ownerTelegramId is null (valid intermediate onboarding state when botToken is
          // already set), the dedup row must NOT be committed — otherwise a '7_day_owner'
          // UNIQUE row would permanently suppress the owner notification after the ID is later
          // configured (CR-01).
          if (business.ownerTelegramId) {
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
                // ownerTelegramId is guaranteed non-null by the outer guard above.
                await sendTelegramMessage(business.ownerTelegramId!, ownerMsg);
              });
              notificationCount += 1;
            }
          }
        } catch (err) {
          logger.error(
            { err, membershipId: membership.id, businessId },
            'Membership expiry notification failed'
          );
        }
      }
      // RENW-03/04: threshold sweep — find clients at last-session threshold.
      if (business.lastSessionThresholdEnabled && business.ownerTelegramId) {
        try {
          const atThreshold = await findMembershipsAtThreshold(businessId);
          const todayAthens = isoDateInAthens(new Date());
          const toNudge: typeof atThreshold = [];
          for (const m of atThreshold) {
            const inserted = await insertRenewalNudgeNotification(m.id, todayAthens);
            if (inserted) toNudge.push(m);
          }
          if (toNudge.length > 0) {
            const nameLines = await Promise.all(
              toNudge.map(async (m, i) => {
                const name = (await getClientName(businessId, m.clientPhone)) ?? m.clientPhone;
                return `${i + 1}. ${name} (${m.sessionsRemaining} μαθήματα)`;
              })
            );
            const listText = nameLines.join('\n');
            const batchMessage =
              `Πελάτες με λίγα εναπομείναντα μαθήματα:\n${listText}\n\nΘέλετε να σταλεί ειδοποίηση ανανέωσης σε όλους;`;
            pendingRenewalBatches.set(businessId, toNudge.map((m) => m.clientPhone));
            setTimeout(() => pendingRenewalBatches.delete(businessId), 10 * 60 * 1000);
            await botTokenStore.run(business.botToken, async () => {
              await sendTelegramMessageWithKeyboard(business.ownerTelegramId!, batchMessage, [
                [
                  { text: '✅ Ναι, στείλε σε όλους', callback_data: `renewal:approve:${businessId}` },
                  { text: '❌ Όχι', callback_data: `renewal:skip:${businessId}` },
                ],
              ]);
            });
            notificationCount += toNudge.length;
          }
        } catch (err) {
          logger.error({ err, businessId }, 'Renewal threshold sweep failed for business');
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
