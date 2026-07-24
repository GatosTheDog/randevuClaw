// Phase 10: Session Cancellation Notification Poller (CLSS-03).
// Finds cancelled session instances not yet notified and sends Greek messages
// to all booked clients. Runs every 6 hours via startSessionCancellationPoller()
// in src/server.ts.
//
// Pattern: src/scheduler/membership-expiry.ts (nested try/catch, botTokenStore.run,
// per-item error isolation, botToken never logged).

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../database/db';
import {
  sessionInstances,
  sessionCatalog,
  sessionCancellationNotifications,
  bookings,
  clientBusinessRelationships,
} from '../database/schema';
import { listAllBusinessIds, findBusinessById } from '../database/queries';
import { botTokenStore, sendTelegramMessage } from '../telegram/client';
import { logger } from '../utils/logger';

/**
 * Sweeps all businesses for cancelled session instances not yet notified and
 * sends Greek Telegram messages to all booked clients (confirmed or pending_owner_approval).
 *
 * Returns the total count of Telegram notifications sent this sweep.
 *
 * Per-business isolation: outer try/catch — one business DB failure never blocks others.
 * Per-client isolation: inner try/catch — one client send failure never blocks other clients
 * in the same session.
 *
 * PROHIBITED: botToken in any logger call (T-10-17). Only {businessId, method} logged.
 * botTokenStore.run() is mandatory for every sendTelegramMessage call (D-06 pattern).
 *
 * Dedup: sessionCancellationNotifications INSERT with onConflictDoNothing prevents
 * duplicate sends on poller re-run. One row per cancelled instance (not per client).
 */
export async function pollSessionCancellations(): Promise<number> {
  const businessIds = await listAllBusinessIds();
  let notificationCount = 0;

  for (const businessId of businessIds) {
    try {
      // Check business existence and botToken BEFORE fetching sessions —
      // unconfigured or partially-onboarded businesses skip without a wasted DB query.
      const business = await findBusinessById(businessId);

      if (!business || !business.botToken) {
        logger.warn(
          { businessId },
          'No bot token for business, skipping session cancellation check'
        );
        continue;
      }

      // Find all cancelled session instances for this business with no dedup row yet.
      // LEFT JOIN + isNull check (not a separate SELECT + JS filter) ensures the query
      // is a single round-trip and relies on the DB unique index for efficiency.
      const cancelledInstances = await db
        .select({
          instanceId: sessionInstances.id,
          sessionDate: sessionInstances.sessionDate,
          sessionTime: sessionInstances.sessionTime,
          catalogId: sessionInstances.catalogId,
        })
        .from(sessionInstances)
        .innerJoin(sessionCatalog, eq(sessionInstances.catalogId, sessionCatalog.id))
        .leftJoin(
          sessionCancellationNotifications,
          eq(sessionInstances.id, sessionCancellationNotifications.sessionInstanceId)
        )
        .where(
          and(
            eq(sessionCatalog.businessId, businessId),
            eq(sessionInstances.isCancelled, true),
            isNull(sessionCancellationNotifications.id)
          )
        );

      for (const cancelled of cancelledInstances) {
        // Find all clients with an active booking for this cancelled session.
        // clientBusinessRelationships JOIN validates client-business association (T-10-18).
        const bookedClients = await db
          .select({ clientPhone: bookings.clientPhone })
          .from(bookings)
          .innerJoin(
            clientBusinessRelationships,
            and(
              eq(bookings.clientPhone, clientBusinessRelationships.senderPhone),
              eq(bookings.businessId, clientBusinessRelationships.businessId)
            )
          )
          .where(
            and(
              eq(bookings.sessionInstanceId, cancelled.instanceId),
              inArray(bookings.bookingStatus, ['confirmed', 'pending_owner_approval'])
            )
          );

        for (const client of bookedClients) {
          try {
            const msg = `Το μάθημά σας στις ${cancelled.sessionDate} ${cancelled.sessionTime} ακυρώθηκε. Παρακαλώ επικοινωνήστε μαζί μας για νέο ραντεβού.`;
            // botTokenStore.run() is mandatory — callTelegramApi will throw without it.
            // botToken must never appear in logger calls (T-10-17).
            await botTokenStore.run(business.botToken, async () => {
              await sendTelegramMessage(client.clientPhone, msg);
            });
            notificationCount += 1;
          } catch (err) {
            logger.error(
              { err, businessId, sessionInstanceId: cancelled.instanceId, method: 'pollSessionCancellations' },
              'Session cancellation notification failed for client'
            );
          }
        }

        // Insert dedup row regardless of whether any clients were notified.
        // Even a cancelled session with 0 bookings must be marked "processed"
        // to avoid re-querying it on every subsequent poller run.
        // onConflictDoNothing handles concurrent poller runs (T-10-19).
        await db
          .insert(sessionCancellationNotifications)
          .values({ sessionInstanceId: cancelled.instanceId })
          .onConflictDoNothing();
      }

      logger.info(
        {
          businessId,
          cancelledCount: cancelledInstances.length,
          notificationCount,
          method: 'pollSessionCancellations',
        },
        'Session cancellation sweep complete'
      );
    } catch (err) {
      logger.error(
        { err, businessId, method: 'pollSessionCancellations' },
        'Session cancellation sweep failed for business'
      );
    }
  }

  return notificationCount;
}

/**
 * Starts an in-process setInterval that runs pollSessionCancellations on the
 * given interval. Default is 6 hours (matching membership-expiry poller cadence).
 * Returns the interval handle so callers (tests, graceful shutdown) can clearInterval it.
 *
 * MUST be called only inside the !JEST_WORKER_ID guard in server.ts to prevent
 * the interval from keeping Jest alive (Pitfall 3 / T-09-11 pattern).
 */
export function startSessionCancellationPoller(
  intervalMs: number = 6 * 60 * 60 * 1000
): NodeJS.Timeout {
  return setInterval(() => {
    pollSessionCancellations().catch((err) =>
      logger.error({ err, method: 'pollSessionCancellations' }, 'Unhandled session cancellation sweep error')
    );
  }, intervalMs);
}
