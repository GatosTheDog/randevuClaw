// Phase 13: Slotless booking request query layer (SLOT-01, SLOT-03, SLOT-04, SLOT-05, SLOT-06)
// All DB operations for slotless_requests go through this module.
// Read functions use getConn() for RLS-enforced connections; approveSlotlessRequest uses
// db.transaction() for atomicity across booking insert, ledger insert, and status update.

import { and, eq, gte, desc, sql } from 'drizzle-orm';
import { db } from '../database/db';
import { getConn } from '../database/queries';
import {
  slotlessRequests,
  bookings,
  memberships,
  membershipLedger,
} from '../database/schema';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Exported TypeScript interface
// ---------------------------------------------------------------------------

export interface SlotlessRequest {
  id: number;
  businessId: number;
  clientPhone: string;
  /** ISO "YYYY-MM-DD" Europe/Athens local (requested session date). */
  requestedSessionDate: string;
  /** "HH:MM" Europe/Athens local (requested session time). */
  requestedSessionTime: string;
  serviceId: number;
  /** 'pending' | 'approved' | 'rejected' */
  status: string;
  /** null while pending or rejected; set when owner approves and booking is created. */
  bookingId: number | null;
  /** idempotency_key unique constraint — format: "client:{clientPhone}:service:{serviceId}:{date}:{time}" */
  idempotencyKey: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// insertSlotlessRequest — SLOT-01
// ---------------------------------------------------------------------------

/**
 * Inserts a new slotless request with status='pending'. Uses onConflictDoNothing
 * on the idempotencyKey UNIQUE constraint for idempotent replay. Returns the
 * newly inserted row, or null on idempotent replay (caller ignores).
 */
export async function insertSlotlessRequest(params: {
  businessId: number;
  clientPhone: string;
  requestedSessionDate: string;
  requestedSessionTime: string;
  serviceId: number;
  idempotencyKey: string;
}): Promise<SlotlessRequest | null> {
  const rows = await getConn()
    .insert(slotlessRequests)
    .values({
      businessId: params.businessId,
      clientPhone: params.clientPhone,
      requestedSessionDate: params.requestedSessionDate,
      requestedSessionTime: params.requestedSessionTime,
      serviceId: params.serviceId,
      status: 'pending',
      idempotencyKey: params.idempotencyKey,
    })
    .onConflictDoNothing()
    .returning();

  return (rows[0] as SlotlessRequest) ?? null;
}

// ---------------------------------------------------------------------------
// approveSlotlessRequest — SLOT-03 (atomicity-critical)
// ---------------------------------------------------------------------------

/**
 * Atomically approves a slotless request:
 * 1. Locks and verifies the request is still 'pending' (prevents double-tap)
 * 2. Re-checks active membership inside the transaction (T-13-02 / SELECT FOR UPDATE)
 * 3. Inserts a 'confirmed' booking inline using the tx connection
 * 4. Deducts 1 session credit if membership has a finite sessionsRemaining
 * 5. Updates slotlessRequests.status = 'approved' and sets bookingId
 *
 * Returns { booking, request } on success, or null if:
 * - The request is not found or already processed
 * - The client's membership has lapsed (caller sends an error message to the owner)
 *
 * All mutations run in a single db.transaction() (T-13-01): booking insert,
 * ledger insert, membership decrement, and request status update commit atomically
 * or all roll back.
 */
export async function approveSlotlessRequest(
  slotlessRequestId: number,
  businessId: number
): Promise<{ booking: typeof bookings.$inferSelect; request: SlotlessRequest } | null> {
  return db.transaction(async (tx) => {
    // Step 1: Lock the slotless request row and verify it is still pending.
    // SELECT FOR UPDATE acquires a row-level lock; a concurrent double-tap finds
    // the row already 'approved' after the first tx commits and returns null.
    const reqRows = await tx
      .select()
      .from(slotlessRequests)
      .where(
        and(
          eq(slotlessRequests.id, slotlessRequestId),
          eq(slotlessRequests.businessId, businessId),
          eq(slotlessRequests.status, 'pending')
        )
      )
      .for('update')
      .limit(1);

    const req = reqRows[0];
    if (!req) {
      // Already approved, rejected, or does not belong to this business
      logger.warn({ slotlessRequestId, businessId }, 'approveSlotlessRequest: request not found or not pending');
      return null;
    }

    // Step 2: Re-check active membership inside the transaction (T-13-02).
    // SELECT FOR UPDATE serialises concurrent session deductions.
    const membershipRows = await tx
      .select({
        id: memberships.id,
        sessionsRemaining: memberships.sessionsRemaining,
        expiresAt: memberships.expiresAt,
      })
      .from(memberships)
      .where(
        and(
          eq(memberships.businessId, businessId),
          eq(memberships.clientPhone, req.clientPhone),
          eq(memberships.isActive, true),
          // Exclude expired memberships (mirroring getActiveMembershipForDeduction)
          sql`${memberships.expiresAt} > now()`
        )
      )
      .for('update')
      .limit(1);

    const membership = membershipRows[0];
    if (!membership) {
      logger.warn(
        { slotlessRequestId, businessId, clientPhone: req.clientPhone },
        'approveSlotlessRequest: no active membership — cannot approve'
      );
      return null;
    }

    // Step 3: Insert booking inline using tx (NOT insertBooking which uses getConn).
    // bookingStatus='confirmed' — slotless-approved bookings skip pending_owner_approval.
    // requestId format: "slotless-approval:{slotlessRequestId}" for idempotency guard.
    const bookingRequestId = `slotless-approval:${slotlessRequestId}`;
    const bookingRows = await tx
      .insert(bookings)
      .values({
        businessId,
        clientPhone: req.clientPhone,
        serviceId: req.serviceId,
        calendarDate: req.requestedSessionDate,
        calendarTime: req.requestedSessionTime,
        bookingStatus: 'confirmed',
        requestId: bookingRequestId,
        expiresAt: new Date(Date.now() + 2 * 3600 * 1000),
        calendarSyncStatus: 'pending',
      })
      .onConflictDoNothing()
      .returning();

    let booking = bookingRows[0];

    // Step 4: Idempotent replay — if booking already existed (same requestId),
    // look up the existing booking row.
    if (!booking) {
      const existingRows = await tx
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.clientPhone, req.clientPhone),
            eq(bookings.requestId, bookingRequestId)
          )
        )
        .limit(1);
      booking = existingRows[0];
      if (!booking) {
        // Slot conflict with a different booking — cannot approve at this time
        logger.error(
          { slotlessRequestId, businessId, bookingRequestId },
          'approveSlotlessRequest: booking insert failed and no existing booking found'
        );
        return null;
      }
    }

    // Step 5: Deduct 1 session credit if membership has a finite sessionsRemaining.
    // Inline implementation mirrors deductSession to stay within the tx context.
    if (membership.sessionsRemaining !== null && membership.sessionsRemaining > 0) {
      const deductionKey = `slotless:${slotlessRequestId}:deduction`;

      // 5a: Insert ledger row (idempotency guard via onConflictDoNothing)
      const inserted = await tx
        .insert(membershipLedger)
        .values({
          membershipId: membership.id,
          operationType: 'session_deducted',
          sessionsDeducted: 1,
          bookingId: booking.id,
          idempotencyKey: deductionKey,
        })
        .onConflictDoNothing()
        .returning({ id: membershipLedger.id });

      // 5b: Only decrement counter when a new ledger row was inserted (idempotency guard)
      if (inserted.length > 0) {
        await tx
          .update(memberships)
          .set({ sessionsRemaining: sql`${memberships.sessionsRemaining} - 1` })
          .where(
            and(
              eq(memberships.id, membership.id),
              sql`${memberships.sessionsRemaining} > 0`
            )
          );
      }

      logger.info(
        { slotlessRequestId, membershipId: membership.id, bookingId: booking.id },
        'approveSlotlessRequest: session deducted'
      );
    }

    // Step 6: Update slotlessRequests.status = 'approved' and set bookingId.
    const updatedReqRows = await tx
      .update(slotlessRequests)
      .set({ status: 'approved', bookingId: booking.id })
      .where(eq(slotlessRequests.id, slotlessRequestId))
      .returning();

    const updatedReq = updatedReqRows[0];
    if (!updatedReq) {
      // Should not happen inside the same transaction
      logger.error({ slotlessRequestId }, 'approveSlotlessRequest: failed to update request status');
      return null;
    }

    logger.info(
      { slotlessRequestId, bookingId: booking.id, businessId },
      'Slotless request approved'
    );

    return { booking, request: updatedReq as SlotlessRequest };
  });
}

// ---------------------------------------------------------------------------
// rejectSlotlessRequest — SLOT-04
// ---------------------------------------------------------------------------

/**
 * Sets a pending slotless request's status to 'rejected'. The AND status='pending'
 * guard prevents double-processing (idempotent: a second call returns null).
 * Returns the updated row, or null if the request was not found or not pending.
 */
export async function rejectSlotlessRequest(
  slotlessRequestId: number
): Promise<SlotlessRequest | null> {
  const rows = await getConn()
    .update(slotlessRequests)
    .set({ status: 'rejected' })
    .where(
      and(
        eq(slotlessRequests.id, slotlessRequestId),
        eq(slotlessRequests.status, 'pending')
      )
    )
    .returning();

  return (rows[0] as SlotlessRequest) ?? null;
}

// ---------------------------------------------------------------------------
// listSlotlessRequestsForClient — SLOT-05
// ---------------------------------------------------------------------------

/**
 * Returns all slotless requests for a (businessId, clientPhone) pair, ordered
 * newest first. Uses getConn() for RLS-enforced connection.
 */
export async function listSlotlessRequestsForClient(
  businessId: number,
  clientPhone: string
): Promise<SlotlessRequest[]> {
  const rows = await getConn()
    .select()
    .from(slotlessRequests)
    .where(
      and(
        eq(slotlessRequests.businessId, businessId),
        eq(slotlessRequests.clientPhone, clientPhone)
      )
    )
    .orderBy(desc(slotlessRequests.createdAt));

  return rows as SlotlessRequest[];
}

// ---------------------------------------------------------------------------
// countSlotlessRequestsSinceCheckin — SLOT-06
// ---------------------------------------------------------------------------

/**
 * Returns the count of slotless requests for a client since a given Athens
 * calendar date. sinceDate must be an ISO "YYYY-MM-DD" string in Europe/Athens
 * local time. Uses getConn() for RLS-enforced connection.
 *
 * Date comparison: gte(createdAt, new Date(sinceDate + 'T00:00:00+02:00')) is
 * a reasonable approximation for "since this Athens calendar date" — same
 * approach as expiry comparisons in billing/queries.ts.
 */
export async function countSlotlessRequestsSinceCheckin(
  businessId: number,
  clientPhone: string,
  sinceDate: string
): Promise<number> {
  const since = new Date(sinceDate + 'T00:00:00+02:00');

  const rows = await getConn()
    .select({ count: sql<string>`count(*)` })
    .from(slotlessRequests)
    .where(
      and(
        eq(slotlessRequests.businessId, businessId),
        eq(slotlessRequests.clientPhone, clientPhone),
        gte(slotlessRequests.createdAt, since)
      )
    );

  return Number(rows[0]?.count ?? 0);
}
