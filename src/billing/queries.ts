// Phase 7: Billing Configuration & Payment Recording — database query layer.
// All DB operations for billing_packages, memberships, and membership_ledger go
// through this module. Read functions use getConn() for RLS-enforced connections
// (T-07-03); write mutations in createMembership use db.transaction() for atomicity.

import { and, desc, eq, gt, gte, sql } from 'drizzle-orm';
import { db } from '../database/db';
import {
  billingPackages,
  memberships,
  membershipLedger,
  clientBusinessRelationships,
  bookings,
  services,
  businesses,
} from '../database/schema';
import { getConn } from '../database/queries';
import { isoDateInAthens, addCalendarDays } from '../utils/timezone';
import { logger } from '../utils/logger';

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
 */
export async function activatePackage(packageId: number): Promise<boolean> {
  const rows = await db
    .update(billingPackages)
    .set({ isActive: true })
    .where(and(eq(billingPackages.id, packageId), eq(billingPackages.isActive, false)))
    .returning({ id: billingPackages.id });
  return rows.length > 0;
}

/**
 * Deletes a pending (isActive=false) package. No-op if the package is already
 * active or does not exist. Used in the D-03 cancel-confirmation path.
 */
export async function cancelPendingPackage(packageId: number): Promise<void> {
  await db
    .delete(billingPackages)
    .where(and(eq(billingPackages.id, packageId), eq(billingPackages.isActive, false)));
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
 */
export async function deactivatePackage(packageId: number): Promise<void> {
  await db
    .update(billingPackages)
    .set({ isActive: false })
    .where(eq(billingPackages.id, packageId));
}

/**
 * Returns a single billing package by ID, or null if not found.
 * Used by payment-flow.ts handlers to fetch package details for confirmation
 * messages and success replies without re-running the full list query.
 * Uses getConn() for RLS enforcement (T-07-03).
 */
export async function getPackageById(packageId: number): Promise<BillingPackage | null> {
  const rows = await getConn()
    .select()
    .from(billingPackages)
    .where(eq(billingPackages.id, packageId))
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
 * The idempotencyKey `${businessId}:${clientPhone}:payment_recorded:${purchaseDate}`
 * is deterministic — a second call with the same inputs on the same purchase date
 * will fail on the UNIQUE constraint, causing the transaction to roll back the
 * duplicate membership upsert (T-07-04 mitigation).
 */
export async function createMembership(
  businessId: number,
  clientPhone: string,
  packageId: number
): Promise<{ memberId: number; expiresAtDate: string; sessionsRemaining: number | null }> {
  return db.transaction(async (tx) => {
    // Fetch the billing package
    const pkgRows = await tx
      .select()
      .from(billingPackages)
      .where(eq(billingPackages.id, packageId))
      .limit(1);

    const pkg = pkgRows[0];
    if (!pkg) throw new Error(`Package ${packageId} not found`);

    // Compute purchase date and expiry in Europe/Athens timezone (DST-safe)
    const purchaseDate = isoDateInAthens(new Date());
    const expiresAtDate = addCalendarDays(purchaseDate, pkg.validDays);
    // End-of-day in Athens. +02:00 is the Athens winter offset (UTC+2).
    // During Greek DST summer (UTC+3), this means the stored UTC timestamp is
    // 1 hour later than strict end-of-day, which is acceptable for an expiry field.
    const expiresAt = new Date(`${expiresAtDate}T23:59:59+02:00`);

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
    // Deterministic idempotency key — T-07-04 replay prevention
    const idempotencyKey = `${businessId}:${clientPhone}:payment_recorded:${purchaseDate}`;

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
