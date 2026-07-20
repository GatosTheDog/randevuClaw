// covers SESS-01, SESS-02, SESS-03, SESS-04
// Integration tests against a REAL local Postgres connection — required to
// verify atomic transaction behavior, idempotency key uniqueness enforcement,
// and session deduction/credit-restore semantics for the membership_ledger table.
//
// Setup (one-time, local dev machine):
//   psql postgresql://manolis@localhost:5432/randevuclaw_test \
//     -f migrations/0006_billing_schema.sql
//   psql postgresql://manolis@localhost:5432/randevuclaw_test \
//     -f migrations/0007_enforcement_policy.sql
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
const {
  deductSession,
  restoreCredit,
  findMembershipByBooking,
} = require('../src/billing/queries');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestPackage, insertTestMembership } = require('./helpers/billing-fixtures');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

/**
 * Inserts a minimal bookings row for test purposes.
 * Uses 'cancelled' status to avoid the unique_active_slot_per_business partial
 * unique index (which only applies to pending_owner_approval and confirmed).
 * Uses admin db (same as other helpers) — bypasses RLS for test setup.
 */
async function insertTestBooking(
  businessId: number,
  clientPhone: string,
  serviceId: number
): Promise<number> {
  const rows = await db
    .insert(bookings)
    .values({
      businessId,
      clientPhone,
      serviceId,
      calendarDate: '2026-07-21',
      calendarTime: '10:00',
      bookingStatus: 'cancelled',
      requestId: `test-req-${Date.now()}-${Math.random()}`,
    })
    .returning({ id: bookings.id });
  return rows[0].id as number;
}

/**
 * Gets the service ID created by insertTestBusiness for a given businessId.
 */
async function getTestServiceId(businessId: number): Promise<number> {
  const rows = await db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.businessId, businessId))
    .limit(1);
  return rows[0].id as number;
}

describe('session deduction — SESS-01', () => {
  let businessId: number;
  let packageId: number;
  let serviceId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;
    serviceId = await getTestServiceId(businessId);
    const pkg = await insertTestPackage(businessId, {
      name: `SESS-01 Package ${Date.now()}`,
      validDays: 30,
      sessionCount: 5,
    });
    packageId = pkg.id;
  });

  it('deducts 1 session atomically on booking insert', async () => {
    const clientPhone = `deduct-test-${Date.now()}-${Math.random()}`;
    const membership = await insertTestMembership(businessId, clientPhone, packageId, {
      sessionsRemaining: 5,
    });
    const bookingId = await insertTestBooking(businessId, clientPhone, serviceId);
    const idempotencyKey = `booking:${bookingId}:deduction`;

    await withBusinessContext(businessId, () =>
      deductSession(membership.id, bookingId, idempotencyKey)
    );

    // Assert sessionsRemaining decremented by 1
    const membershipRows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id));
    expect(membershipRows[0].sessionsRemaining).toBe(4);

    // Assert ledger row was inserted with correct operation type
    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(
        and(
          eq(membershipLedger.membershipId, membership.id),
          eq(membershipLedger.operationType, 'session_deducted')
        )
      );
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].sessionsDeducted).toBe(1);
  });

  it('deduction is idempotent on replay (same idempotency_key)', async () => {
    const clientPhone = `idempotency-test-${Date.now()}-${Math.random()}`;
    const membership = await insertTestMembership(businessId, clientPhone, packageId, {
      sessionsRemaining: 5,
    });
    const bookingId = await insertTestBooking(businessId, clientPhone, serviceId);
    const idempotencyKey = `booking:${bookingId}:deduction`;

    // First call — deducts
    await withBusinessContext(businessId, () =>
      deductSession(membership.id, bookingId, idempotencyKey)
    );
    // Second call with same idempotency_key — no-op
    await withBusinessContext(businessId, () =>
      deductSession(membership.id, bookingId, idempotencyKey)
    );

    // Assert sessionsRemaining decremented exactly once
    const membershipRows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id));
    expect(membershipRows[0].sessionsRemaining).toBe(4);

    // Assert exactly 1 ledger row for that idempotency_key
    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(eq(membershipLedger.idempotencyKey, idempotencyKey));
    expect(ledgerRows).toHaveLength(1);
  });
});

describe('credit restore — SESS-02/SESS-03', () => {
  let businessId: number;
  let packageId: number;
  let serviceId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;
    serviceId = await getTestServiceId(businessId);
    const pkg = await insertTestPackage(businessId, {
      name: `SESS-02/03 Package ${Date.now()}`,
      validDays: 30,
      sessionCount: 5,
    });
    packageId = pkg.id;
  });

  it('restores credit on cancel within validity window (SESS-02)', async () => {
    const clientPhone = `restore-test-${Date.now()}-${Math.random()}`;
    // Membership with 4 sessions remaining, expires 30 days from now
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const membership = await insertTestMembership(businessId, clientPhone, packageId, {
      sessionsRemaining: 4,
      expiresAt,
    });
    const bookingId = await insertTestBooking(businessId, clientPhone, serviceId);

    // Insert a prior deduction ledger row to simulate that a session was deducted
    await db.insert(membershipLedger).values({
      membershipId: membership.id,
      operationType: 'session_deducted',
      sessionsDeducted: 1,
      bookingId,
      idempotencyKey: `booking:${bookingId}:deduction`,
    });

    const creditKey = `booking:${bookingId}:credit`;
    await withBusinessContext(businessId, () =>
      restoreCredit(membership.id, bookingId, creditKey)
    );

    // Assert sessionsRemaining incremented by 1
    const membershipRows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id));
    expect(membershipRows[0].sessionsRemaining).toBe(5);

    // Assert credit_restored ledger row exists
    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(
        and(
          eq(membershipLedger.membershipId, membership.id),
          eq(membershipLedger.operationType, 'credit_restored')
        )
      );
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].sessionsDeducted).toBe(-1);
  });

  it('no credit restore when membership expired at cancel time (SESS-03)', async () => {
    const clientPhone = `expired-restore-test-${Date.now()}-${Math.random()}`;
    // Membership expired 1 day in the past
    const expiresAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const membership = await insertTestMembership(businessId, clientPhone, packageId, {
      sessionsRemaining: 4,
      expiresAt,
    });
    const bookingId = await insertTestBooking(businessId, clientPhone, serviceId);

    const creditKey = `booking:${bookingId}:credit`;
    await withBusinessContext(businessId, () =>
      restoreCredit(membership.id, bookingId, creditKey)
    );

    // Assert sessionsRemaining is UNCHANGED (still 4)
    const membershipRows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id));
    expect(membershipRows[0].sessionsRemaining).toBe(4);

    // Assert no credit_restored ledger row was inserted
    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(
        and(
          eq(membershipLedger.membershipId, membership.id),
          eq(membershipLedger.operationType, 'credit_restored')
        )
      );
    expect(ledgerRows).toHaveLength(0);
  });
});

describe('unlimited membership — SESS-04', () => {
  let businessId: number;
  let packageId: number;
  let serviceId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;
    serviceId = await getTestServiceId(businessId);
    const pkg = await insertTestPackage(businessId, {
      name: `SESS-04 Unlimited Package ${Date.now()}`,
      validDays: 30,
      sessionCount: null,
    });
    packageId = pkg.id;
  });

  it('unlimited membership: no deduction row, no counter change', async () => {
    const clientPhone = `unlimited-test-${Date.now()}-${Math.random()}`;
    const bookingId = await insertTestBooking(businessId, clientPhone, serviceId);

    // findMembershipByBooking returns null when no session_deducted ledger row exists
    const membershipIdFromLedger = await findMembershipByBooking(bookingId);
    expect(membershipIdFromLedger).toBeNull();

    // Create an unlimited membership (sessionsRemaining=null)
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const membership = await insertTestMembership(businessId, clientPhone, packageId, {
      sessionsRemaining: null,
      expiresAt,
    });

    const creditKey = `booking:${bookingId}:credit`;
    // restoreCredit on unlimited membership should be a no-op
    await withBusinessContext(businessId, () =>
      restoreCredit(membership.id, bookingId, creditKey)
    );

    // Assert sessionsRemaining is still null (unchanged)
    const membershipRows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id));
    expect(membershipRows[0].sessionsRemaining).toBeNull();

    // Assert no ledger rows were inserted for this membership
    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(eq(membershipLedger.membershipId, membership.id));
    expect(ledgerRows).toHaveLength(0);
  });
});
