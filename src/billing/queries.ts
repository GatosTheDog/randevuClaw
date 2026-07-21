// Phase 7: Billing Configuration & Payment Recording — database query layer.
// All DB operations for billing_packages, memberships, and membership_ledger go
// through this module. Read functions use getConn() for RLS-enforced connections
// (T-07-03); write mutations in createMembership use db.transaction() for atomicity.

import { and, desc, eq, gt, gte, lte, sql } from 'drizzle-orm';
import { db } from '../database/db';
import {
  billingPackages,
  memberships,
  membershipLedger,
  membershipExpiryNotifications,
  clientBusinessRelationships,
  bookings,
  services,
  businesses,
} from '../database/schema';
import { getConn } from '../database/queries';
import { isoDateInAthens, addCalendarDays } from '../utils/timezone';
import { logger } from '../utils/logger';

/**
 * CR-02: Returns end-of-day (23:59:59) in the Europe/Athens timezone as a UTC Date.
 * Uses Intl.DateTimeFormat (server-timezone-independent) to compute the DST-aware
 * offset for the given date. The previous toLocaleString approach produced wrong
 * results on non-UTC server timezones (e.g. developer machines in Athens itself).
 *
 * Approach: use noon UTC as an anchor — guaranteed to land on isoDate in Athens
 * regardless of whether the offset is UTC+2 or UTC+3, avoiding day-boundary
 * ambiguity. Read the Athens wall-clock hour at that anchor to derive the offset.
 */
export function athensEndOfDay(isoDate: string): Date {
  // Noon UTC is always within isoDate in Athens (UTC+2 or UTC+3).
  const noonUTC = new Date(`${isoDate}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Athens',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(noonUTC);
  // athensHour at noonUTC = 12 + offsetHours (14 for UTC+2, 15 for UTC+3)
  const athensHour = Number(parts.find((p) => p.type === 'hour')?.value ?? '14');
  const offsetHours = athensHour - 12;
  // 23:59:59 Athens = (23:59:59 UTC) − offsetHours
  const endOfDayUTCMs =
    new Date(`${isoDate}T23:59:59Z`).getTime() - offsetHours * 3_600_000;
  return new Date(endOfDayUTCMs);
}

// ---------------------------------------------------------------------------
// Exported TypeScript interfaces
// ---------------------------------------------------------------------------

export interface BillingPackage {
  id: number;
  businessId: number;
  name: string;
  priceCents: number;
  validDays: number;
  sessionCount: number | null;
  isActive: boolean;
  createdAt: Date;
}

export interface Membership {
  id: number;
  businessId: number;
  clientPhone: string;
  packageId: number;
  purchaseDate: string;
  expiresAt: Date;
  sessionsRemaining: number | null;
  isActive: boolean;
  createdAt: Date;
}

/**
 * Minimal membership fields needed for session deduction.
 * Returned by getActiveMembershipForDeduction — includes only the three
 * fields required for the Phase 8 enforcement + deduction flow.
 */
export interface ActiveMembershipForDeduction {
  id: number;
  sessionsRemaining: number | null;
  expiresAt: Date;
}

/** Result type for getRecentClientsForBusiness. */
export type RecentClient = {
  clientBusinessRelationshipId: number;
  clientName: string | null;
  serviceNameFallback: string;
  lastBookingDateFormatted: string;
};

// ---------------------------------------------------------------------------
// Package CRUD
// ---------------------------------------------------------------------------

/**
 * Creates a new billing package for a business with isActive=false (pending
 * D-03 confirmation flow). Returns the new package id.
 */
export async function createPackage(
  businessId: number,
  data: { name: string; priceCents: number; validDays: number; sessionCount?: number | null }
): Promise<number> {
  const rows = await db
    .insert(billingPackages)
    .values({
      businessId,
      name: data.name,
      priceCents: data.priceCents,
      validDays: data.validDays,
      sessionCount: data.sessionCount ?? null,
      isActive: false,
    })
    .returning({ id: billingPackages.id });
  return rows[0].id;
}

/**
 * Activates a pending (isActive=false) package. Returns true if a row was
 * updated, false if the package was already active or does not exist.
 *
 * WR-04: businessId required as ownership guard — matches deactivatePackage pattern.
 */
export async function activatePackage(businessId: number, packageId: number): Promise<boolean> {
  const rows = await getConn()
    .update(billingPackages)
    .set({ isActive: true })
    .where(and(eq(billingPackages.id, packageId), eq(billingPackages.businessId, businessId), eq(billingPackages.isActive, false)))
    .returning({ id: billingPackages.id });
  return rows.length > 0;
}

/**
 * Deletes a pending (isActive=false) package. No-op if the package is already
 * active or does not exist. Used in the D-03 cancel-confirmation path.
 *
 * WR-04: businessId required as ownership guard — matches deactivatePackage pattern.
 */
export async function cancelPendingPackage(businessId: number, packageId: number): Promise<void> {
  await getConn()
    .delete(billingPackages)
    .where(and(eq(billingPackages.id, packageId), eq(billingPackages.businessId, businessId), eq(billingPackages.isActive, false)));
}

/**
 * Lists all active packages for a business, ordered newest first.
 * Uses getConn() for RLS enforcement (T-07-03).
 */
export async function listPackages(businessId: number): Promise<BillingPackage[]> {
  return getConn()
    .select()
    .from(billingPackages)
    .where(and(eq(billingPackages.businessId, businessId), eq(billingPackages.isActive, true)))
    .orderBy(desc(billingPackages.createdAt));
}

/**
 * Deactivates a package (soft-delete). The billing_packages row is never
 * physically deleted — deactivation preserves audit history.
 *
 * WR-01: businessId is required as a defense-in-depth ownership guard.
 * The WHERE clause includes BOTH packageId AND businessId so that a hallucinated
 * or prompt-injected package_id from another tenant is a no-op even if RLS is
 * misconfigured. Uses getConn() so it benefits from withBusinessContext RLS when
 * called through the owner tool chain.
 */
export async function deactivatePackage(businessId: number, packageId: number): Promise<boolean> {
  // WR-03: include isActive=true so the UPDATE only matches a currently active
  // package. Without this guard, Postgres returns the row even when is_active was
  // already false (the row is still "touched"), causing a false-positive true return
  // and a misleading Greek success message to the owner.
  const rows = await getConn()
    .update(billingPackages)
    .set({ isActive: false })
    .where(
      and(
        eq(billingPackages.id, packageId),
        eq(billingPackages.businessId, businessId),
        eq(billingPackages.isActive, true)
      )
    )
    .returning({ id: billingPackages.id });
  return rows.length > 0;
}

/**
 * Returns a single billing package by ID for a specific business, or null if
 * not found. The businessId ownership guard prevents cross-tenant package
 * access — a crafted packageId for a foreign business returns null (WR-01).
 * Uses getConn() for RLS enforcement (T-07-03).
 */
export async function getPackageById(packageId: number, businessId: number): Promise<BillingPackage | null> {
  const rows = await getConn()
    .select()
    .from(billingPackages)
    .where(and(eq(billingPackages.id, packageId), eq(billingPackages.businessId, businessId)))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Recent clients lookup
// ---------------------------------------------------------------------------

/**
 * Returns clients of a business who had bookings within the last
 * `dayWindowDays` calendar days. Each entry includes:
 * - clientBusinessRelationshipId (for inline keyboard button callback_data)
 * - clientName (nullable — from Telegram from.first_name captured on last message)
 * - serviceNameFallback (service name of their most recent booking)
 * - lastBookingDateFormatted (ISO "YYYY-MM-DD" of most recent booking)
 *
 * Results are ordered by most recent booking first. Deduplication is applied
 * in-process to return one entry per client (the one with the latest booking).
 */
export async function getRecentClientsForBusiness(
  businessId: number,
  dayWindowDays: number
): Promise<RecentClient[]> {
  const cutoffDate = isoDateInAthens(new Date(Date.now() - dayWindowDays * 86400 * 1000));

  const rows = await getConn()
    .select({
      clientBusinessRelationshipId: clientBusinessRelationships.id,
      clientName: clientBusinessRelationships.clientName,
      serviceNameFallback: services.name,
      lastBookingDate: bookings.calendarDate,
    })
    .from(clientBusinessRelationships)
    .innerJoin(
      bookings,
      and(
        eq(bookings.clientPhone, clientBusinessRelationships.senderPhone),
        eq(bookings.businessId, clientBusinessRelationships.businessId)
      )
    )
    .innerJoin(services, eq(services.id, bookings.serviceId))
    .where(
      and(
        eq(clientBusinessRelationships.businessId, businessId),
        gte(bookings.calendarDate, cutoffDate)
      )
    )
    .orderBy(desc(bookings.calendarDate));

  // Deduplicate by clientBusinessRelationshipId, keeping the first (most recent) booking per client
  const seen = new Set<number>();
  const result: RecentClient[] = [];
  for (const row of rows) {
    if (!seen.has(row.clientBusinessRelationshipId)) {
      seen.add(row.clientBusinessRelationshipId);
      result.push({
        clientBusinessRelationshipId: row.clientBusinessRelationshipId,
        clientName: row.clientName,
        serviceNameFallback: row.serviceNameFallback,
        lastBookingDateFormatted: row.lastBookingDate,
      });
    }
  }
  return result;
}

/** Result type for getAllClientsForBusiness (G-07-6 fallback). */
export type AllTimeClient = {
  clientBusinessRelationshipId: number;
  clientName: string | null;
  senderPhone: string;
};

/**
 * Returns all clients registered with a business (all-time, no date filter).
 * Used as a fallback in showClientSelection when the 30-day recent-bookings
 * query returns empty (G-07-6: businesses without recent bookings cannot
 * otherwise reach the payment recording flow).
 *
 * Uses getConn() inside withBusinessContext for RLS enforcement (T-07-GC-01).
 * Ordered by createdAt desc (most recently registered client first).
 */
export async function getAllClientsForBusiness(
  businessId: number
): Promise<AllTimeClient[]> {
  const rows = await getConn()
    .select({
      clientBusinessRelationshipId: clientBusinessRelationships.id,
      clientName: clientBusinessRelationships.clientName,
      senderPhone: clientBusinessRelationships.senderPhone,
    })
    .from(clientBusinessRelationships)
    .where(eq(clientBusinessRelationships.businessId, businessId))
    .orderBy(desc(clientBusinessRelationships.createdAt));

  return rows;
}

// ---------------------------------------------------------------------------
// Membership lifecycle
// ---------------------------------------------------------------------------

/**
 * Creates or replaces the client's active membership for a business.
 *
 * Runs atomically in a single db.transaction(): inserts the membership row
 * (onConflictDoUpdate replaces any existing active membership for the same
 * business+client pair) and inserts the initial payment_recorded ledger row.
 *
 * Expiry is computed using DST-safe Europe/Athens calendar arithmetic:
 * purchaseDate is obtained via isoDateInAthens(new Date()), then
 * addCalendarDays adds validDays to get the expiry date. The resulting
 * expiresAt timestamp is end-of-day in Athens (+02:00 winter offset).
 *
 * The idempotencyKey `${businessId}:${clientPhone}:payment_recorded:${purchaseDate}:${memberId}`
 * prevents double-tap replay (same active membership row → same memberId → same key).
 * A legitimate renewal after the previous membership was deactivated produces a new
 * memberId, which generates a distinct key and succeeds (WR-05).
 */
export async function createMembership(
  businessId: number,
  clientPhone: string,
  packageId: number
): Promise<{ memberId: number; expiresAtDate: string; sessionsRemaining: number | null }> {
  return db.transaction(async (tx) => {
    // Fetch the billing package — WR-01: include businessId ownership guard so a
    // crafted callback_data referencing a foreign package resolves to null and
    // fails fast inside the transaction before any membership row is written.
    const pkgRows = await tx
      .select()
      .from(billingPackages)
      .where(and(eq(billingPackages.id, packageId), eq(billingPackages.businessId, businessId)))
      .limit(1);

    const pkg = pkgRows[0];
    if (!pkg) throw new Error(`Package ${packageId} not found for business ${businessId}`);

    // Compute purchase date and expiry in Europe/Athens timezone (DST-safe)
    const purchaseDate = isoDateInAthens(new Date());
    const expiresAtDate = addCalendarDays(purchaseDate, pkg.validDays);
    // WR-06: DST-aware end-of-day in Europe/Athens (replaces hardcoded +02:00).
    const expiresAt = athensEndOfDay(expiresAtDate);

    // Upsert membership — onConflictDoUpdate targets the partial unique index
    // unique_active_membership (business_id, client_phone) WHERE is_active = true (D-10)
    const membershipRows = await tx
      .insert(memberships)
      .values({
        businessId,
        clientPhone,
        packageId,
        purchaseDate,
        expiresAt,
        sessionsRemaining: pkg.sessionCount,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: [memberships.businessId, memberships.clientPhone],
        targetWhere: sql`${memberships.isActive} = true`,
        set: {
          packageId,
          purchaseDate,
          expiresAt,
          sessionsRemaining: pkg.sessionCount,
          isActive: true,
        },
      })
      .returning({ id: memberships.id });

    const memberId = membershipRows[0].id;
    // WR-05: include memberId in the idempotency key so that a legitimate
    // renewal that produces a new membership row (e.g. previous membership
    // was deactivated before the second payment) gets a different key and
    // succeeds. Double-tap on the SAME active membership row is still blocked
    // because onConflictDoUpdate returns the same memberId for both taps.
    const idempotencyKey = `${businessId}:${clientPhone}:payment_recorded:${purchaseDate}:${memberId}`;

    // Insert immutable ledger row (append-only — D-11 / T-07-04)
    await tx.insert(membershipLedger).values({
      membershipId: memberId,
      operationType: 'payment_recorded',
      sessionsDeducted: 0,
      reason: 'Payment recorded by owner',
      idempotencyKey,
    });

    logger.info(
      { businessId, clientPhone, packageId, memberId, expiresAtDate },
      'Membership created'
    );

    return { memberId, expiresAtDate, sessionsRemaining: pkg.sessionCount };
  });
}

// ---------------------------------------------------------------------------
// Phase 8: Session deduction read queries
// ---------------------------------------------------------------------------

/**
 * Returns the client's active non-expired membership for deduction purposes,
 * or null if none exists. Includes SELECT FOR UPDATE to acquire a PostgreSQL
 * row-level lock — serializes concurrent session deductions (SESS-01 / T-08-01).
 *
 * Uses getConn() (not db.transaction()) — atomicity comes from the
 * withBusinessContext wrapper in telegram.ts (Pitfall 1/2 in RESEARCH.md).
 *
 * IMPORTANT: must be called inside an active withBusinessContext transaction
 * so the lock is held until the surrounding transaction commits/rolls back.
 */
export async function getActiveMembershipForDeduction(
  businessId: number,
  clientPhone: string
): Promise<ActiveMembershipForDeduction | null> {
  const rows = await getConn()
    .select({
      id: memberships.id,
      sessionsRemaining: memberships.sessionsRemaining,
      expiresAt: memberships.expiresAt,
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.businessId, businessId),
        eq(memberships.clientPhone, clientPhone),
        eq(memberships.isActive, true),
        gt(memberships.expiresAt, new Date())
      )
    )
    .for('update')
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Looks up the membershipId for a booking via the session_deducted ledger row.
 * Returns null when no session was deducted (unlimited memberships, pre-Phase-8
 * bookings, or bookings that were never charged against a membership).
 * Returning null is the correct signal for "skip credit restore" (Pitfall 4).
 */
export async function findMembershipByBooking(bookingId: number): Promise<number | null> {
  const rows = await getConn()
    .select({ membershipId: membershipLedger.membershipId })
    .from(membershipLedger)
    .where(
      and(
        eq(membershipLedger.bookingId, bookingId),
        eq(membershipLedger.operationType, 'session_deducted')
      )
    )
    .limit(1);
  return rows[0]?.membershipId ?? null;
}

/**
 * Returns the client's registered name from clientBusinessRelationships,
 * or null if no relationship record exists or clientName is not set.
 * Used by the flag alert in bookAppointmentTool (D-11) to identify the
 * client by name rather than phone number.
 */
export async function getClientName(businessId: number, clientPhone: string): Promise<string | null> {
  const rows = await getConn()
    .select({ clientName: clientBusinessRelationships.clientName })
    .from(clientBusinessRelationships)
    .where(
      and(
        eq(clientBusinessRelationships.businessId, businessId),
        eq(clientBusinessRelationships.senderPhone, clientPhone)
      )
    )
    .limit(1);
  return rows[0]?.clientName ?? null;
}

/**
 * Returns the enforcement policy for a business, or 'allow' if no row found
 * (backward-compatible fallback — D-08). Uses getConn() for RLS enforcement.
 */
export async function getBusinessEnforcementPolicy(businessId: number): Promise<string> {
  const rows = await getConn()
    .select({ enforcementPolicy: businesses.enforcementPolicy })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  return rows[0]?.enforcementPolicy ?? 'allow';
}

// ---------------------------------------------------------------------------
// Phase 8: Session deduction write operations
// ---------------------------------------------------------------------------

/**
 * Atomically deducts 1 session from a membership by:
 * 1. Inserting a 'session_deducted' ledger row (idempotency guard via
 *    onConflictDoNothing on idempotency_key UNIQUE constraint — D-12 / T-08-02)
 * 2. Only when a new row was inserted: decrementing sessionsRemaining by 1
 *
 * CALLER RESPONSIBILITY (D-06): do NOT call this when sessionsRemaining IS NULL
 * (unlimited membership) — caller must check before invoking.
 *
 * Uses getConn() — participates in the withBusinessContext appDb.transaction()
 * for atomicity with the booking insert (Pitfall 1/2 in RESEARCH.md).
 */
export async function deductSession(
  membershipId: number,
  bookingId: number,
  idempotencyKey: string
): Promise<void> {
  // Step 1: Insert ledger row; onConflictDoNothing returns empty array on replay
  const inserted = await getConn()
    .insert(membershipLedger)
    .values({
      membershipId,
      operationType: 'session_deducted',
      sessionsDeducted: 1,
      bookingId,
      idempotencyKey,
    })
    .onConflictDoNothing()
    .returning({ id: membershipLedger.id });

  // Step 2: Idempotency guard — skip counter update if already deducted (D-12)
  if (inserted.length === 0) return;

  // Step 3: Decrement counter only when a new ledger row was inserted.
  // WR-03: DB-level guard prevents counter going below zero if a future caller
  // skips the capacity check that the current call chain enforces.
  await getConn()
    .update(memberships)
    .set({ sessionsRemaining: sql`${memberships.sessionsRemaining} - 1` })
    .where(and(eq(memberships.id, membershipId), gt(memberships.sessionsRemaining, 0)));

  logger.info({ membershipId, bookingId, idempotencyKey }, 'Session deducted');
}

/**
 * CR-02: inserts a link-only ledger row (sessionsDeducted=0) for a rescheduled
 * booking so that findMembershipByBooking can locate the membership when the
 * rescheduled appointment is later cancelled and credit restore runs.
 *
 * The session counter is NOT decremented — it was already decremented when the
 * original booking was created. This call only establishes the booking→membership
 * association needed for the cancel-restore path.
 */
export async function linkRescheduledBooking(
  membershipId: number,
  newBookingId: number
): Promise<void> {
  await getConn()
    .insert(membershipLedger)
    .values({
      membershipId,
      operationType: 'session_deducted',
      sessionsDeducted: 0,
      bookingId: newBookingId,
      idempotencyKey: 'booking:' + newBookingId + ':deduction',
      reason: 'Reschedule link — counter unchanged from original booking',
    })
    .onConflictDoNothing();
}

/**
 * Restores 1 session credit when a booking is cancelled, subject to:
 * - SESS-04: Skip if sessionsRemaining IS NULL (unlimited membership — null check FIRST)
 * - SESS-03: Skip if membership.expiresAt < nowAthens (expired at cancel time)
 * - D-05: Idempotent via onConflictDoNothing on idempotency_key
 *
 * Uses getConn() — participates in the withBusinessContext appDb.transaction()
 * for atomicity with the booking status update (Pitfall 1/2 in RESEARCH.md).
 */
export async function restoreCredit(
  membershipId: number,
  bookingId: number,
  idempotencyKey: string
): Promise<void> {
  // Step 1: Fetch current membership state (fresh DB read — avoids stale-expiry decisions)
  const membershipRows = await getConn()
    .select({
      expiresAt: memberships.expiresAt,
      sessionsRemaining: memberships.sessionsRemaining,
    })
    .from(memberships)
    .where(eq(memberships.id, membershipId))
    .limit(1);

  const membership = membershipRows[0];
  // Step 2: Defensive guard — membership row not found
  if (!membership) return;

  // Step 3: SESS-04 — unlimited membership (sessionsRemaining IS NULL): no counter to restore
  // IMPORTANT: null check MUST come before the expiresAt check (FLAGGED-UNVERIFIED ordering)
  if (membership.sessionsRemaining === null) return;

  // Step 4: SESS-03 — membership expired at time of cancellation: no credit restore
  // CR-03: membership.expiresAt is a UTC TIMESTAMP WITH TIME ZONE from PostgreSQL;
  // compare directly against new Date() (UTC). The previous toLocaleString approach
  // produced a Date whose epoch was offset 2–3 hours into the future, falsely
  // flagging valid memberships as expired during the hours before actual UTC expiry.
  if (membership.expiresAt < new Date()) return;

  // Step 5: Insert credit_restored ledger row (idempotency guard)
  const inserted = await getConn()
    .insert(membershipLedger)
    .values({
      membershipId,
      operationType: 'credit_restored',
      sessionsDeducted: -1,
      bookingId,
      idempotencyKey,
    })
    .onConflictDoNothing()
    .returning({ id: membershipLedger.id });

  // Step 6: Idempotent replay guard — skip if already restored (D-05)
  if (inserted.length === 0) return;

  // Step 7: Increment counter only when a new ledger row was inserted
  await getConn()
    .update(memberships)
    .set({ sessionsRemaining: sql`${memberships.sessionsRemaining} + 1` })
    .where(eq(memberships.id, membershipId));

  logger.info({ membershipId, bookingId }, 'Credit restored');
}

/**
 * Updates the enforcement policy for a business. Uses getConn() so it
 * participates in the withBusinessContext RLS transaction when called from
 * ai-owner-agent.ts (D-09).
 *
 * Allowed values: 'allow' | 'block' | 'flag' (enforced at DB level via CHECK
 * constraint in migration 0007 and at app level via Zod in billing/tools.ts).
 */
export async function setBusinessEnforcementPolicy(
  businessId: number,
  policy: string
): Promise<void> {
  await getConn()
    .update(businesses)
    .set({ enforcementPolicy: policy })
    .where(eq(businesses.id, businessId));

  logger.info({ businessId, policy }, 'Enforcement policy updated');
}

/**
 * Returns the client's current active membership for a business, or null if
 * no active non-expired membership exists. Uses getConn() for RLS (T-07-03).
 */
export async function getClientActiveMembership(
  businessId: number,
  clientPhone: string
): Promise<{
  packageName: string;
  sessionsRemaining: number | null;
  expiresAt: Date;
  isUnlimited: boolean;
} | null> {
  const rows = await getConn()
    .select({
      packageName: billingPackages.name,
      sessionsRemaining: memberships.sessionsRemaining,
      expiresAt: memberships.expiresAt,
    })
    .from(memberships)
    .innerJoin(billingPackages, eq(billingPackages.id, memberships.packageId))
    .where(
      and(
        eq(memberships.businessId, businessId),
        eq(memberships.clientPhone, clientPhone),
        eq(memberships.isActive, true),
        gt(memberships.expiresAt, new Date())
      )
    )
    .limit(1);

  if (!rows[0]) return null;

  return {
    packageName: rows[0].packageName,
    sessionsRemaining: rows[0].sessionsRemaining,
    expiresAt: rows[0].expiresAt,
    isUnlimited: rows[0].sessionsRemaining === null,
  };
}

// ---------------------------------------------------------------------------
// Phase 9: Membership expiry notification queries (NOTF-01, NOTF-02, NOTF-03)
// ---------------------------------------------------------------------------

/**
 * Shape of a membership row returned by the 7-day expiry sweep (NOTF-01).
 * Consumed by runMembershipExpirySweep in Plan 03.
 */
export interface ExpiringMembership {
  id: number;
  clientPhone: string;
  businessId: number;
  expiresAt: Date;
  sessionsRemaining: number | null;
}

/**
 * Returns all active memberships for a business that expire within the next
 * 7 Athens calendar days (exclusive of already-expired memberships).
 *
 * Uses db (not getConn()) — this is a sweep-context read outside any
 * withBusinessContext transaction; RLS scoping is not needed here because
 * businessId is already applied in the WHERE clause (T-09-07).
 *
 * DST safety: isoDateInAthens + addCalendarDays compute the window boundary
 * in the Europe/Athens timezone, avoiding off-by-one on DST transitions.
 */
export async function findMembershipsExpiringIn7Days(
  businessId: number
): Promise<ExpiringMembership[]> {
  const now = new Date();
  const nowIso = isoDateInAthens(now);
  const sevenDaysFromNowIso = addCalendarDays(nowIso, 7);
  // WR-06: DST-aware end-of-day in Europe/Athens (replaces hardcoded +02:00).
  const windowEnd = athensEndOfDay(sevenDaysFromNowIso);

  return db
    .select({
      id: memberships.id,
      clientPhone: memberships.clientPhone,
      businessId: memberships.businessId,
      expiresAt: memberships.expiresAt,
      sessionsRemaining: memberships.sessionsRemaining,
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.businessId, businessId),
        eq(memberships.isActive, true),
        lte(memberships.expiresAt, windowEnd),
        gt(memberships.expiresAt, now) // exclude already-expired memberships (RESEARCH.md OQ-3)
      )
    );
}

/**
 * Inserts a dedup row into membership_expiry_notifications. Returns true if
 * the row was newly inserted (notification should be sent), false if the
 * UNIQUE constraint fired (already notified — skip).
 *
 * Uses db (not getConn()) — dedup inserts happen from the sweep, outside any
 * withBusinessContext transaction (T-09-06).
 */
export async function insertMembershipExpiryNotification(
  membershipId: number,
  notificationType: '7_day_client' | '7_day_owner',
  expiryDate: string
): Promise<boolean> {
  const result = await db
    .insert(membershipExpiryNotifications)
    .values({ membershipId, notificationType, expiryDate })
    .onConflictDoNothing()
    .returning({ id: membershipExpiryNotifications.id });

  return result.length > 0;
}
