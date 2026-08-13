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
const { eq, and } = require('drizzle-orm');
const { membershipLedger, memberships, bookings, services } = require('../src/database/schema');
const { withBusinessContext } = require('../src/database/queries');
const { createMembership } = require('../src/billing/queries');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestPackage } = require('./helpers/billing-fixtures');
const { isoDateInAthens, addCalendarDays } = require('../src/utils/timezone');
const nodeCrypto = require('crypto');
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
      createMembership(businessId, client, packageId, `key-${client}-1`)
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
      createMembership(businessId, client, packageId, `key-${client}-1`)
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
    const idempotencyKey = `key-${client}-1`;
    const result = await withBusinessContext(businessId, () =>
      createMembership(businessId, client, packageId, idempotencyKey)
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
    // Debug (renewed-sub-cant-book): idempotencyKey is now caller-supplied verbatim
    // rather than derived from business/date/memberId.
    expect(ledgerRows[0].idempotencyKey).toBe(idempotencyKey);
  });

  it('idempotency_key prevents duplicate membership_ledger rows on exact replay (same key)', async () => {
    const uniqueClient = `idempotency-test-${Date.now()}`;
    const replayKey = `key-${uniqueClient}-replay`;

    // First call succeeds.
    const firstResult = await withBusinessContext(businessId, () =>
      createMembership(businessId, uniqueClient, packageId, replayKey)
    );

    // Second call reuses the SAME idempotencyKey (simulating a webhook redelivery
    // of the same Telegram tap) — hits the UNIQUE constraint on idempotencyKey,
    // the ledger INSERT fails, and the entire transaction rolls back (T-07-04).
    await expect(
      withBusinessContext(businessId, () =>
        createMembership(businessId, uniqueClient, packageId, replayKey)
      )
    ).rejects.toThrow();

    // Verify only one ledger row exists (the first call's row).
    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(eq(membershipLedger.idempotencyKey, replayKey));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].membershipId).toBe(firstResult.memberId);
  });

  // Debug (renewed-sub-cant-book) regression test: a same-day SECOND renewal for
  // the same client — using a DIFFERENT idempotencyKey (as a distinct Telegram tap
  // would produce) — must succeed and correctly overwrite expiresAt/sessionsRemaining,
  // instead of colliding with the first renewal's ledger row and rolling back.
  it('two same-day renewals with different idempotency keys both succeed and the second overwrites membership fields', async () => {
    const uniqueClient = `same-day-renewal-test-${Date.now()}`;

    const shortPackage = await insertTestPackage(businessId, {
      name: `Same Day Short Package ${Date.now()}`,
      validDays: 10,
      sessionCount: 1,
    });
    const longPackage = await insertTestPackage(businessId, {
      name: `Same Day Long Package ${Date.now()}`,
      validDays: 30,
      sessionCount: 10,
    });

    // First renewal (e.g. client buys a 1-session pack in the morning).
    const first = await withBusinessContext(businessId, () =>
      createMembership(businessId, uniqueClient, shortPackage.id, `key-${uniqueClient}-1`)
    );
    expect(first.sessionsRemaining).toBe(1);

    // Second renewal, same client, same calendar day, DIFFERENT idempotencyKey
    // (e.g. client exhausts the 1-session pack and owner records a fresh payment
    // the same afternoon). Prior to the fix this collided with the first call's
    // derived key and rolled back silently.
    const second = await withBusinessContext(businessId, () =>
      createMembership(businessId, uniqueClient, longPackage.id, `key-${uniqueClient}-2`)
    );
    expect(second.sessionsRemaining).toBe(10);
    // Same row updated in place (onConflictDoUpdate) — same memberId both times.
    expect(second.memberId).toBe(first.memberId);

    // Verify the DB row now reflects the SECOND renewal's values, not the first's.
    const rows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, first.memberId));
    expect(rows[0].packageId).toBe(longPackage.id);
    expect(rows[0].sessionsRemaining).toBe(10);
    expect(rows[0].isActive).toBe(true);

    // Both ledger rows exist (no row was rolled back).
    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(eq(membershipLedger.membershipId, first.memberId));
    expect(ledgerRows).toHaveLength(2);
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
      createMembership(businessId, uniqueClient, shortPackage.id, `key-${uniqueClient}-1`)
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

describe('unbilled-booking reconciliation (quick 260813-ji5)', () => {
  let businessId: number;
  let serviceId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;

    const serviceRows = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.businessId, businessId))
      .limit(1);
    serviceId = serviceRows[0].id;
  });

  it('retroactively deducts one unbilled booking, is idempotent across renewal, and never double-deducts', async () => {
    const clientPhone = `recon-${nodeCrypto.randomUUID().slice(0, 12)}`;

    const [booking] = await db
      .insert(bookings)
      .values({
        businessId,
        clientPhone,
        serviceId,
        calendarDate: '2026-09-10',
        calendarTime: '11:00',
        bookingStatus: 'confirmed',
        requestId: `req-${clientPhone}-1`,
      })
      .returning();

    const pkg = await insertTestPackage(businessId, {
      name: `Reconciliation Test Package ${clientPhone}`,
      validDays: 30,
      sessionCount: 8,
    });

    const first = await withBusinessContext(businessId, () =>
      createMembership(businessId, clientPhone, pkg.id, `key-${clientPhone}-1`)
    );

    expect(first.sessionsRemaining).toBe(7);
    expect(first.retroactiveSessionsDeducted).toBe(1);

    const ledgerAfterFirst = await db
      .select()
      .from(membershipLedger)
      .where(
        and(
          eq(membershipLedger.bookingId, booking.id),
          eq(membershipLedger.operationType, 'session_deducted')
        )
      );
    expect(ledgerAfterFirst).toHaveLength(1);

    // Simulate a renewal (e.g. same client buys the same package again) —
    // must NOT re-deduct the already-reconciled booking.
    const second = await withBusinessContext(businessId, () =>
      createMembership(businessId, clientPhone, pkg.id, `key-${clientPhone}-2`)
    );

    expect(second.sessionsRemaining).toBe(8);
    expect(second.retroactiveSessionsDeducted).toBe(0);

    const ledgerAfterSecond = await db
      .select()
      .from(membershipLedger)
      .where(
        and(
          eq(membershipLedger.bookingId, booking.id),
          eq(membershipLedger.operationType, 'session_deducted')
        )
      );
    expect(ledgerAfterSecond).toHaveLength(1);
  });

  it('never runs reconciliation for unlimited (sessionCount: null) packages', async () => {
    const clientPhone = `recon-unlimited-${nodeCrypto.randomUUID().slice(0, 12)}`;

    await db.insert(bookings).values({
      businessId,
      clientPhone,
      serviceId,
      calendarDate: '2026-09-11',
      calendarTime: '11:00',
      bookingStatus: 'confirmed',
      requestId: `req-${clientPhone}-1`,
    });

    const unlimitedPkg = await insertTestPackage(businessId, {
      name: `Unlimited Reconciliation Test Package ${clientPhone}`,
      validDays: 30,
      sessionCount: null,
    });

    const result = await withBusinessContext(businessId, () =>
      createMembership(businessId, clientPhone, unlimitedPkg.id, `key-${clientPhone}-1`)
    );

    expect(result.sessionsRemaining).toBeNull();
    expect(result.retroactiveSessionsDeducted).toBe(0);
  });
});
