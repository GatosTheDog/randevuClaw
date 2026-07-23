// covers RENW-01, RENW-02, RENW-03, RENW-04, RENW-05
// Integration tests against a REAL local Postgres connection.
// Requires migration 0012 (renewal_nudge_notifications table) to be applied.
//
// Setup (one-time, local dev machine):
//   psql postgresql://manolis@localhost:5432/randevuclaw_test \
//     -f migrations/0012_renewal_nudge_notifications.sql
//
// ECONNREFUSED is expected when no local Postgres is running. The tests must
// compile without TypeScript errors — that is the primary gate for CI.

const TEST_DATABASE_URL =
  process.env.SESSION_TEST_DATABASE_URL ??
  process.env.BILLING_TEST_DATABASE_URL ??
  'postgresql://manolis@localhost:5432/randevuclaw_test';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = TEST_DATABASE_URL;
jest.resetModules();

/* eslint-disable @typescript-eslint/no-var-requires */
const { db } = require('../src/database/db');
const { eq } = require('drizzle-orm');
const { renewalNudgeNotifications, memberships, businesses } = require('../src/database/schema');
const {
  setLastSessionThreshold,
  findMembershipsAtThreshold,
  insertRenewalNudgeNotification,
} = require('../src/billing/queries');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestPackage, insertTestMembership } = require('./helpers/billing-fixtures');
const { withBusinessContext } = require('../src/database/queries');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

function uniquePhone(): string {
  return 'renew-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

describe('Renewal Nudge Notifications', () => {
  // ---------------------------------------------------------------------------
  // RENW-01: setLastSessionThreshold enables threshold with count
  // ---------------------------------------------------------------------------
  it('setLastSessionThreshold enables threshold with count', async () => {
    const business = await insertTestBusiness();
    await setLastSessionThreshold(business.id, true, 3);

    const rows = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, business.id));
    const row = rows[0];
    expect(row.lastSessionThresholdEnabled).toBe(true);
    expect(row.lastSessionThresholdCount).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // RENW-02: setLastSessionThreshold can disable threshold
  // ---------------------------------------------------------------------------
  it('setLastSessionThreshold can disable threshold', async () => {
    const business = await insertTestBusiness();
    // Enable first
    await setLastSessionThreshold(business.id, true, 3);
    // Then disable
    await setLastSessionThreshold(business.id, false, 1);

    const rows = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, business.id));
    const row = rows[0];
    expect(row.lastSessionThresholdEnabled).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // RENW-03: insertRenewalNudgeNotification is idempotent
  // ---------------------------------------------------------------------------
  it('insertRenewalNudgeNotification is idempotent', async () => {
    const business = await insertTestBusiness();
    const pkg = await insertTestPackage(business.id);
    const clientPhone = uniquePhone();
    const membership = await insertTestMembership(business.id, clientPhone, pkg.id, {
      sessionsRemaining: 2,
    });

    const firstResult = await insertRenewalNudgeNotification(membership.id, '2026-08-01');
    expect(firstResult).toBe(true);

    // Same call again — should be a no-op (dedup via unique index)
    const secondResult = await insertRenewalNudgeNotification(membership.id, '2026-08-01');
    expect(secondResult).toBe(false);

    // Cleanup
    await db
      .delete(renewalNudgeNotifications)
      .where(eq(renewalNudgeNotifications.membershipId, membership.id));
  });

  // ---------------------------------------------------------------------------
  // RENW-04: findMembershipsAtThreshold returns membership when at threshold
  // ---------------------------------------------------------------------------
  it('findMembershipsAtThreshold returns membership when at threshold', async () => {
    const business = await insertTestBusiness();
    // Enable threshold with count=3
    await db
      .update(businesses)
      .set({ lastSessionThresholdEnabled: true, lastSessionThresholdCount: 3 })
      .where(eq(businesses.id, business.id));

    const pkg = await insertTestPackage(business.id);
    const clientPhone = uniquePhone();
    const membership = await insertTestMembership(business.id, clientPhone, pkg.id, {
      sessionsRemaining: 2, // at or below threshold of 3
    });

    const result = await withBusinessContext(business.id, () =>
      findMembershipsAtThreshold(business.id)
    );

    expect(result.length).toBeGreaterThanOrEqual(1);
    const found = result.find(
      (m: { id: number; clientPhone: string }) => m.id === membership.id
    );
    expect(found).toBeDefined();
    expect(found.clientPhone).toBe(membership.clientPhone);
  });

  // ---------------------------------------------------------------------------
  // RENW-04: findMembershipsAtThreshold excludes memberships above threshold
  // ---------------------------------------------------------------------------
  it('findMembershipsAtThreshold excludes memberships above threshold', async () => {
    const business = await insertTestBusiness();
    // Enable threshold with count=3
    await db
      .update(businesses)
      .set({ lastSessionThresholdEnabled: true, lastSessionThresholdCount: 3 })
      .where(eq(businesses.id, business.id));

    const pkg = await insertTestPackage(business.id);
    const clientPhone = uniquePhone();
    const membership = await insertTestMembership(business.id, clientPhone, pkg.id, {
      sessionsRemaining: 5, // above threshold of 3 — should NOT be returned
    });

    const result = await withBusinessContext(business.id, () =>
      findMembershipsAtThreshold(business.id)
    );

    const found = result.find(
      (m: { id: number }) => m.id === membership.id
    );
    expect(found).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // RENW-05: findMembershipsAtThreshold excludes businesses with threshold disabled
  // ---------------------------------------------------------------------------
  it('findMembershipsAtThreshold excludes businesses with threshold disabled', async () => {
    const business = await insertTestBusiness();
    // Threshold NOT enabled — default is false, so no update needed

    const pkg = await insertTestPackage(business.id);
    const clientPhone = uniquePhone();
    const membership = await insertTestMembership(business.id, clientPhone, pkg.id, {
      sessionsRemaining: 1, // would be at threshold if enabled
    });

    const result = await withBusinessContext(business.id, () =>
      findMembershipsAtThreshold(business.id)
    );

    const found = result.find(
      (m: { id: number }) => m.id === membership.id
    );
    expect(found).toBeUndefined();
  });
});
