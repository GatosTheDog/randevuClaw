// tests/helpers/billing-fixtures.ts
// Phase 7: test fixture helpers for billing_packages and memberships tables.
//
// These helpers bypass the D-03 confirmation flow to directly insert rows for
// test setup. Use admin db (not appDb) so RLS context is not required for
// test setup writes — mirrors the pattern established by test-business.ts.

import { db } from '../../src/database/db';
import { billingPackages, memberships } from '../../src/database/schema';
import type { BillingPackage, Membership } from '../../src/billing/queries';
import { isoDateInAthens } from '../../src/utils/timezone';

export interface TestPackageOptions {
  name?: string;
  priceCents?: number;
  validDays?: number;
  sessionCount?: number | null;
  isActive?: boolean;
}

export interface TestMembershipOptions {
  purchaseDate?: string;
  expiresAt?: Date;
  sessionsRemaining?: number | null;
  isActive?: boolean;
}

/**
 * Inserts a billing_packages row directly for test setup.
 * Defaults: name='Test Package', priceCents=5000, validDays=30, sessionCount=10, isActive=true.
 * Bypasses the D-03 confirmation flow (isActive defaults to true here for test convenience).
 */
export async function insertTestPackage(
  businessId: number,
  overrides?: TestPackageOptions
): Promise<BillingPackage> {
  const rows = await db
    .insert(billingPackages)
    .values({
      businessId,
      name: overrides?.name ?? 'Test Package',
      priceCents: overrides?.priceCents ?? 5000,
      validDays: overrides?.validDays ?? 30,
      sessionCount: overrides?.sessionCount !== undefined ? overrides.sessionCount : 10,
      isActive: overrides?.isActive !== undefined ? overrides.isActive : true,
    })
    .returning();
  return rows[0] as BillingPackage;
}

/**
 * Inserts a memberships row directly for test setup.
 * Defaults: purchaseDate=today in Athens, expiresAt=30 days from now,
 * sessionsRemaining=10, isActive=true.
 */
export async function insertTestMembership(
  businessId: number,
  clientPhone: string,
  packageId: number,
  overrides?: TestMembershipOptions
): Promise<Membership> {
  const purchaseDate = isoDateInAthens(new Date());
  const defaultExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const rows = await db
    .insert(memberships)
    .values({
      businessId,
      clientPhone,
      packageId,
      purchaseDate: overrides?.purchaseDate ?? purchaseDate,
      expiresAt: overrides?.expiresAt ?? defaultExpiresAt,
      sessionsRemaining:
        overrides?.sessionsRemaining !== undefined ? overrides.sessionsRemaining : 10,
      isActive: overrides?.isActive !== undefined ? overrides.isActive : true,
    })
    .returning();
  return rows[0] as Membership;
}
