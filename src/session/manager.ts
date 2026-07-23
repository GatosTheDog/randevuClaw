// Phase 10: Session Catalog query layer. All session DB operations for session_catalog
// and session_instances go through this module. Read functions use getConn() for
// RLS-enforced connections; write mutations use withBusinessContext + getConn().

import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { sessionCatalog, sessionInstances, bookings } from '../database/schema';
import { getConn, withBusinessContext } from '../database/queries';
import { getActiveMembershipForDeduction, deductSession } from '../billing/queries';
import type { ActiveMembershipForDeduction } from '../billing/queries';
import { isoDateInAthens, addCalendarDays } from '../utils/timezone';
import { logger } from '../utils/logger';
import { RRule } from 'rrule';

// ---------------------------------------------------------------------------
// Exported TypeScript interfaces
// ---------------------------------------------------------------------------

export interface SessionInstance {
  instanceId: number;
  catalogId: number;
  sessionDate: string;
  sessionTime: string;
  bookedCount: number;
  capacity: number;
  serviceId: number;
}

export interface BookSessionResult {
  status: 'success' | 'full' | 'conflict';
  bookingId?: number;
}

// ---------------------------------------------------------------------------
// Greek weekday → RFC 5545 BYDAY code mapping
// ---------------------------------------------------------------------------

const GREEK_TO_BYDAY: Record<string, string> = {
  'Δευτέρα': 'MO',
  'Τρίτη': 'TU',
  'Τετάρτη': 'WE',
  'Πέμπτη': 'TH',
  'Παρασκευή': 'FR',
  'Σάββατο': 'SA',
  'Κυριακή': 'SU',
};

/**
 * Maps Greek weekday names to an RFC 5545 RRULE BYDAY string.
 * Unrecognized weekday strings are silently filtered out.
 *
 * Example: buildRRuleString(['Δευτέρα', 'Τετάρτη', 'Παρασκευή'], '10:00')
 *          => 'FREQ=WEEKLY;BYDAY=MO,WE,FR'
 */
export function buildRRuleString(weekdays: string[], startTime: string): string {
  const codes = weekdays
    .map((day) => GREEK_TO_BYDAY[day])
    .filter((code): code is string => code !== undefined);
  return `FREQ=WEEKLY;BYDAY=${codes.join(',')}`;
}

// ---------------------------------------------------------------------------
// createSessionCatalogWithExpansion
// ---------------------------------------------------------------------------

/**
 * Creates a session catalog entry and expands it into ~90 calendar days of
 * sessionInstances rows. Idempotent: onConflictDoNothing skips duplicate rows
 * on replay (T-10-07: UNIQUE idempotencyKey constraint at DB level).
 *
 * WR-01: businessId is required as ownership guard on all mutations. The
 * onConflictDoUpdate on the catalog row ensures one active catalog per
 * (businessId, serviceId) pair (partial UNIQUE index in schema).
 *
 * T-10-09: RRule.parseString() throws on invalid RFC 5545 string; try/catch
 * returns a Greek error string to the caller.
 */
export async function createSessionCatalogWithExpansion(
  businessId: number,
  serviceId: number,
  rruleString: string,
  startTime: string,
  capacity: number,
  /** Optional override for the expansion start date (ISO "YYYY-MM-DD" Athens local).
   * Defaults to today in Athens. Used in tests for deterministic DST boundary scenarios.
   * NOT exposed via the owner tool — callers always use today's date in production. */
  startDate?: string
): Promise<{ catalogId: number; instanceCount: number }> {
  // T-10-09: validate rrule before entering the transaction
  let parsedRRule: ReturnType<typeof RRule.parseString>;
  try {
    parsedRRule = RRule.parseString(rruleString);
  } catch {
    throw new Error('Μη έγκυρο rrule pattern: ' + rruleString);
  }

  return withBusinessContext(businessId, async () => {
    // Upsert catalog row — onConflictDoUpdate on (businessId, serviceId) WHERE is_active=true
    // so replaying create_recurring_session updates the rrule/time/capacity in-place.
    const catalogRows = await getConn()
      .insert(sessionCatalog)
      .values({
        businessId,
        serviceId,
        rruleString,
        startTime,
        capacity,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [sessionCatalog.businessId, sessionCatalog.serviceId],
        targetWhere: sql`is_active = true`,
        set: { rruleString, startTime, capacity, isActive: true },
      })
      .returning({ id: sessionCatalog.id });

    const catalogId = catalogRows[0].id;

    // Compute expansion window in Athens wall-clock dates (DST-safe).
    // startDate defaults to today in Athens; can be overridden for test scenarios.
    const expansionStart = startDate ?? isoDateInAthens(new Date());
    const expansionEnd = addCalendarDays(expansionStart, 90);

    // Expand the rrule — dtstart anchored at the expansion start date's startTime in UTC
    // so rrule.between() produces UTC Date objects that we convert to Athens local.
    const rrule = new RRule({
      ...parsedRRule,
      dtstart: new Date(`${expansionStart}T${startTime}:00Z`),
    });

    const instances = rrule.between(
      new Date(`${expansionStart}T00:00:00Z`),
      new Date(`${expansionEnd}T23:59:59Z`)
    );

    if (instances.length > 0) {
      // Map UTC dates → Athens wall-clock ISO dates; build idempotency keys
      const sessionRows = instances.map((utcDate) => {
        const sessionDate = isoDateInAthens(utcDate);
        return {
          catalogId,
          sessionDate,
          sessionTime: startTime,
          bookedCount: 0,
          isCancelled: false,
          idempotencyKey: `catalog:${catalogId}:${sessionDate}:${startTime}`,
        };
      });

      // Batch insert with idempotency guard; duplicate rows silently no-op (T-10-07)
      await getConn()
        .insert(sessionInstances)
        .values(sessionRows)
        .onConflictDoNothing();
    }

    logger.info(
      { catalogId, instanceCount: instances.length, businessId },
      'session catalog expanded'
    );

    return { catalogId, instanceCount: instances.length };
  });
}

// ---------------------------------------------------------------------------
// bookSessionInstance
// ---------------------------------------------------------------------------

/**
 * Atomically books a client to a session instance with capacity race guard.
 *
 * D-01 (SELECT FOR UPDATE): Locks the sessionInstance row for the duration of
 * the transaction, preventing concurrent capacity races (T-10-03: Pitfall 1).
 *
 * WR-01: businessId is required — the WHERE clause enforces ownership by
 * restricting the locked row to instances belonging to catalogs owned by the
 * given businessId (subquery guard against cross-tenant booking, T-10-02).
 *
 * Idempotency: onConflictDoNothing on the bookings insert + fallback lookup
 * returns the existing bookingId on replay (same idempotencyKey).
 */
export async function bookSessionInstance(
  businessId: number,
  sessionInstanceId: number,
  clientPhone: string,
  serviceId: number,
  idempotencyKey: string,
  activeMembership?: ActiveMembershipForDeduction | null
): Promise<BookSessionResult> {
  return withBusinessContext(businessId, async () => {
    // SELECT FOR UPDATE: serialize concurrent bookings on the same instance.
    // Ownership guard via subquery: catalogId IN (SELECT id FROM session_catalog WHERE business_id = businessId).
    // T-10-02: prevents cross-tenant booking even if RLS is misconfigured.
    const instanceRows = await getConn()
      .select({
        id: sessionInstances.id,
        catalogId: sessionInstances.catalogId,
        sessionDate: sessionInstances.sessionDate,
        sessionTime: sessionInstances.sessionTime,
        bookedCount: sessionInstances.bookedCount,
        isCancelled: sessionInstances.isCancelled,
      })
      .from(sessionInstances)
      .where(
        and(
          eq(sessionInstances.id, sessionInstanceId),
          inArray(
            sessionInstances.catalogId,
            getConn()
              .select({ id: sessionCatalog.id })
              .from(sessionCatalog)
              .where(eq(sessionCatalog.businessId, businessId))
          )
        )
      )
      .for('update')
      .limit(1);

    const instance = instanceRows[0];

    // No row found or row belongs to another business → conflict
    if (!instance || instance.isCancelled) {
      return { status: 'conflict' };
    }

    // Fetch capacity from the catalog (needed for hard-cap check)
    const catalogRows = await getConn()
      .select({ capacity: sessionCatalog.capacity })
      .from(sessionCatalog)
      .where(eq(sessionCatalog.id, instance.catalogId))
      .limit(1);

    const capacity = catalogRows[0]?.capacity ?? 0;

    if (instance.bookedCount >= capacity) {
      return { status: 'full' };
    }

    // Attempt to insert booking — onConflictDoNothing handles idempotent replay
    const bookingRows = await getConn()
      .insert(bookings)
      .values({
        businessId,
        clientPhone,
        serviceId,
        sessionInstanceId,
        calendarDate: instance.sessionDate,
        calendarTime: instance.sessionTime,
        bookingStatus: 'confirmed',
        requestId: idempotencyKey,
        expiresAt: null,
      })
      .onConflictDoNothing()
      .returning({ id: bookings.id });

    if (bookingRows.length === 0) {
      // Idempotent replay: booking already exists — return existing bookingId.
      // Skip deduction: ledger row already written on the first call.
      const existingRows = await getConn()
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.requestId, idempotencyKey))
        .limit(1);
      return { status: 'success', bookingId: existingRows[0]?.id };
    }

    // Increment denormalized bookedCount atomically (T-10-03: race guard)
    await getConn()
      .update(sessionInstances)
      .set({ bookedCount: sql`${sessionInstances.bookedCount} + 1` })
      .where(eq(sessionInstances.id, sessionInstanceId));

    // SBOK-02: Atomically deduct 1 session credit within the same withBusinessContext
    // transaction as the booking insert. Both land or both roll back.
    const bookingId = bookingRows[0].id;

    // Resolve membership: use caller-supplied value (avoids a second round-trip) or
    // fetch it now (backward-compatible path for owner assign_client_to_session tool
    // which does not supply a membership).
    const membership =
      activeMembership !== undefined
        ? activeMembership
        : await getActiveMembershipForDeduction(businessId, clientPhone);

    // T-11-03: only deduct for finite session memberships (sessionsRemaining !== null).
    // Unlimited memberships (null) and no-membership (null membership) are both skipped.
    if (membership !== null && membership !== undefined && membership.sessionsRemaining !== null) {
      await deductSession(membership.id, bookingId, `booking:${bookingId}:deduction`);
      logger.info(
        { businessId, sessionInstanceId, clientPhone, membershipId: membership.id },
        'session credit deducted on session booking'
      );
    }

    return { status: 'success', bookingId };
  });
}

// ---------------------------------------------------------------------------
// cancelSession
// ---------------------------------------------------------------------------

/**
 * Marks a session instance as cancelled (soft-delete). Atomically updates
 * isCancelled=true only when the row is currently not cancelled.
 *
 * WR-01: businessId ownership guard via subquery on sessionCatalog FK chain
 * (T-10-02). The WHERE clause prevents cancelling an instance belonging to
 * another business even if RLS is misconfigured.
 *
 * Returns true if the instance was newly cancelled, false if it was already
 * cancelled (idempotent replay) or not found.
 */
export async function cancelSession(
  businessId: number,
  sessionInstanceId: number
): Promise<boolean> {
  return withBusinessContext(businessId, async () => {
    const rows = await getConn()
      .update(sessionInstances)
      .set({ isCancelled: true })
      .where(
        and(
          eq(sessionInstances.id, sessionInstanceId),
          eq(sessionInstances.isCancelled, false),
          inArray(
            sessionInstances.catalogId,
            getConn()
              .select({ id: sessionCatalog.id })
              .from(sessionCatalog)
              .where(eq(sessionCatalog.businessId, businessId))
          )
        )
      )
      .returning({ id: sessionInstances.id });

    return rows.length > 0;
  });
}

// ---------------------------------------------------------------------------
// listSessions
// ---------------------------------------------------------------------------

/**
 * Returns upcoming non-cancelled session instances for a business, ordered by
 * date then time. Joins sessionCatalog for capacity and serviceId.
 *
 * T-10-08: getConn() is RLS-enforced (within withBusinessContext when called
 * from the owner tool chain). WHERE businessId on sessionCatalog is added as
 * defense-in-depth even outside withBusinessContext (e.g. sweep context).
 *
 * limitDays: number of calendar days forward to include (default 90).
 *            A hard LIMIT 200 caps result set size regardless of limitDays.
 */
export async function listSessions(
  businessId: number,
  limitDays = 90
): Promise<SessionInstance[]> {
  const today = isoDateInAthens(new Date());
  const endDate = addCalendarDays(today, limitDays);

  const rows = await getConn()
    .select({
      instanceId: sessionInstances.id,
      catalogId: sessionInstances.catalogId,
      sessionDate: sessionInstances.sessionDate,
      sessionTime: sessionInstances.sessionTime,
      bookedCount: sessionInstances.bookedCount,
      capacity: sessionCatalog.capacity,
      serviceId: sessionCatalog.serviceId,
    })
    .from(sessionInstances)
    .innerJoin(sessionCatalog, eq(sessionInstances.catalogId, sessionCatalog.id))
    .where(
      and(
        eq(sessionCatalog.businessId, businessId),
        eq(sessionInstances.isCancelled, false),
        gte(sessionInstances.sessionDate, today),
        sql`${sessionInstances.sessionDate} <= ${endDate}`
      )
    )
    .orderBy(sessionInstances.sessionDate, sessionInstances.sessionTime)
    .limit(200);

  return rows;
}
