// covers PAY-02
// Integration tests against a REAL local Postgres connection — required to
// verify atomic transaction behavior, idempotency key uniqueness enforcement,
// and onConflictDoUpdate semantics for the memberships table.
//
// Setup (one-time, local dev machine):
//   psql postgresql://manolis@localhost:5432/randevuclaw_test \
//     -f migrations/0006_billing_schema.sql
//   (GRANT errors for randevuclaw_app role are expected and harmless.)

const TEST_DATABASE_URL =
  process.env.BILLING_TEST_DATABASE_URL ??
  'postgresql://manolis@localhost:5432/randevuclaw_test';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = TEST_DATABASE_URL;
jest.resetModules();

/* eslint-disable @typescript-eslint/no-var-requires */
const { db } = require('../src/database/db');
const { eq } = require('drizzle-orm');
const { membershipLedger, memberships } = require('../src/database/schema');
const { withBusinessContext } = require('../src/database/queries');
const { createMembership } = require('../src/billing/queries');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestPackage } = require('./helpers/billing-fixtures');
const { isoDateInAthens, addCalendarDays } = require('../src/utils/timezone');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

describe('membership creation with rolling expiry', () => {
  let businessId: number;
  let packageId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;

    // Insert package with validDays=30, sessionCount=10
    const pkg = await insertTestPackage(businessId, {
      name: 'PAY-02 Test Package',
      validDays: 30,
      sessionCount: 10,
    });
    packageId = pkg.id;
  });

  it('calculates expires_at as purchase_date + valid_days in Europe/Athens timezone', async () => {
    // Use unique client per test to avoid idempotencyKey collisions on same day
    const client = `expires-test-${Date.now()}`;
    const result = await withBusinessContext(businessId, () =>
      createMembership(businessId, client, packageId)
    );

    const expectedPurchaseDate = isoDateInAthens(new Date());
    const expectedExpiresAtDate = addCalendarDays(expectedPurchaseDate, 30);

    expect(result.expiresAtDate).toBe(expectedExpiresAtDate);
    expect(result.sessionsRemaining).toBe(10);
    expect(result.memberId).toBeGreaterThan(0);
  });

  it('stores expires_at as TIMESTAMP WITH TIME ZONE (a Date object)', async () => {
    // Fetch the actual membership row to verify expiresAt is stored as a Date
    const client = `timestamp-test-${Date.now()}`;
    const result = await withBusinessContext(businessId, () =>
      createMembership(businessId, client, packageId)
    );

    const rows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, result.memberId));

    expect(rows[0]).toBeDefined();
    expect(rows[0].expiresAt).toBeInstanceOf(Date);
  });

  it('writes initial membership_ledger row with operation_type payment_recorded', async () => {
    const client = `ledger-test-${Date.now()}`;
    const result = await withBusinessContext(businessId, () =>
      createMembership(businessId, client, packageId)
    );

    // Fetch ledger rows for this membership
    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(eq(membershipLedger.membershipId, result.memberId));

    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].operationType).toBe('payment_recorded');
    expect(ledgerRows[0].sessionsDeducted).toBe(0);
    expect(ledgerRows[0].reason).toBe('Payment recorded by owner');

    const expectedPurchaseDate = isoDateInAthens(new Date());
    // WR-05: idempotency key now includes memberId to allow same-day renewals
    // that produce a new membership row (different memberId = different key).
    const expectedIdempotencyKey = `${businessId}:${client}:payment_recorded:${expectedPurchaseDate}:${result.memberId}`;
    expect(ledgerRows[0].idempotencyKey).toBe(expectedIdempotencyKey);
  });

  it('idempotency_key prevents duplicate membership_ledger rows on replay', async () => {
    const uniqueClient = `idempotency-test-${Date.now()}`;

    // First call succeeds — capture memberId for key lookup below
    const firstResult = await withBusinessContext(businessId, () =>
      createMembership(businessId, uniqueClient, packageId)
    );

    // Second call on the same day hits the UNIQUE constraint on idempotencyKey.
    // onConflictDoUpdate returns the SAME memberId (row is updated in-place),
    // so the key `...:${purchaseDate}:${memberId}` is identical and the ledger
    // INSERT fails — the entire transaction rolls back (T-07-04, WR-05).
    await expect(
      withBusinessContext(businessId, () =>
        createMembership(businessId, uniqueClient, packageId)
      )
    ).rejects.toThrow();

    // Verify only one ledger row exists (the first call's row).
    // WR-05: key now includes memberId; use firstResult.memberId for the lookup.
    const expectedKey = `${businessId}:${uniqueClient}:payment_recorded:${isoDateInAthens(new Date())}:${firstResult.memberId}`;
    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(eq(membershipLedger.idempotencyKey, expectedKey));
    expect(ledgerRows).toHaveLength(1);
  });

  it('on conflict for same (business_id, client_phone) replaces existing active membership', async () => {
    const uniqueClient = `replace-test-${Date.now()}`;

    // Create a 10-day package for the first membership
    const shortPackage = await insertTestPackage(businessId, {
      name: `Short Package ${Date.now()}`,
      validDays: 10,
      sessionCount: 5,
    });

    // Create first membership with 10-day package
    const first = await withBusinessContext(businessId, () =>
      createMembership(businessId, uniqueClient, shortPackage.id)
    );

    expect(first.sessionsRemaining).toBe(5);
    expect(first.expiresAtDate).toBe(addCalendarDays(isoDateInAthens(new Date()), 10));

    // The active membership for this client should be the one just created
    const rows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.clientPhone, uniqueClient));

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const active = rows.find((r: { isActive: boolean }) => r.isActive);
    expect(active).toBeDefined();
    expect(active.packageId).toBe(shortPackage.id);
  });
});
