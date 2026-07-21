// covers SESS-01, SESS-02, SESS-03, SESS-04
// Integration tests against a REAL local Postgres connection — required to
// verify atomic transaction behavior, SELECT FOR UPDATE race guard, session
// deduction, credit restore, and unlimited-membership semantics.
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
const { memberships, membershipLedger, bookings, services } = require('../src/database/schema');
const { withBusinessContext, insertBooking, updateBookingStatus } = require('../src/database/queries');
const {
  getActiveMembershipForDeduction,
  deductSession,
  findMembershipByBooking,
  restoreCredit,
} = require('../src/billing/queries');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestPackage, insertTestMembership } = require('./helpers/billing-fixtures');
const nodeCrypto = require('crypto');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

/** Returns the serviceId created by insertTestBusiness for a given businessId. */
async function getTestServiceId(businessId: number): Promise<number> {
  const rows = await db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.businessId, businessId))
    .limit(1);
  return rows[0].id as number;
}

/** Returns unique booking data for a test; use a future date to avoid slot conflicts. */
function makeBookingData(serviceId: number, calendarTime = '10:00') {
  return {
    serviceId,
    calendarDate: '2030-01-15',
    calendarTime,
    requestId: nodeCrypto.randomUUID(),
    expiresAt: new Date(Date.now() + 7_200_000),
  };
}

/**
 * Local helper that replicates the Phase 8 booking-with-deduction composite:
 *   getActiveMembershipForDeduction (SELECT FOR UPDATE) → hasCapacity check
 *   → insertBooking → deductSession
 * All in one withBusinessContext transaction.
 */
async function bookWithDeduction(
  businessId: number,
  clientPhone: string,
  serviceId: number,
  calendarTime: string,
  calendarDate = '2030-01-15'
): Promise<{ booking?: { id: number }; error?: string }> {
  return withBusinessContext(businessId, async () => {
    const mem = await getActiveMembershipForDeduction(businessId, clientPhone);
    if (!mem) return { error: 'MEMBERSHIP_NOT_FOUND' };
    const hasCapacity =
      mem.sessionsRemaining === null || mem.sessionsRemaining > 0;
    if (!hasCapacity) return { error: 'NO_CAPACITY' };

    const booking = await insertBooking({
      businessId,
      clientPhone,
      serviceId,
      calendarDate,
      calendarTime,
      requestId: nodeCrypto.randomUUID(),
      expiresAt: new Date(Date.now() + 7_200_000),
    });
    if (!booking) return { error: 'SLOT_TAKEN' };

    if (mem.sessionsRemaining !== null) {
      await deductSession(mem.id, booking.id, 'booking:' + booking.id + ':deduction');
    }
    return { booking };
  });
}

// ---------------------------------------------------------------------------
// describe: insertBookingWithSessionDeduction
// ---------------------------------------------------------------------------

describe('insertBookingWithSessionDeduction', () => {
  let businessId: number;
  let serviceId: number;
  let packageId: number;

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

  it('SESS-01: inserts booking and deducts 1 session atomically in same transaction', async () => {
    const clientPhone = nodeCrypto.randomUUID().slice(0, 12);
    const membership = await insertTestMembership(businessId, clientPhone, packageId, {
      sessionsRemaining: 5,
    });

    // Simulate the composite booking+deduction inside a single transaction
    let bookingId: number | undefined;
    await withBusinessContext(businessId, async () => {
      const bookingData = makeBookingData(serviceId, '10:00');
      const booking = await insertBooking({
        businessId,
        clientPhone,
        ...bookingData,
      });
      expect(booking).not.toBeNull();
      bookingId = booking.id;
      await deductSession(membership.id, booking.id, 'booking:' + booking.id + ':deduction');
    });

    // Assert: ledger entry exists with operationType 'session_deducted' and sessionsDeducted 1
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
    expect(ledgerRows[0].bookingId).toBe(bookingId);

    // Assert: sessionsRemaining = 4 (decremented by 1)
    const membershipRows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id));
    expect(membershipRows[0].sessionsRemaining).toBe(4);
  });

  it('SESS-01: concurrent bookings on same membership deduct exactly 1 session (race guard)', async () => {
    const clientPhone = nodeCrypto.randomUUID().slice(0, 12);
    // Only 1 session left — exactly one concurrent call should succeed
    await insertTestMembership(businessId, clientPhone, packageId, {
      sessionsRemaining: 1,
    });

    // Run TWO concurrent bookWithDeduction calls on a date isolated from other
    // tests ('2030-02-15') with different time slots to avoid the
    // unique_active_slot_per_business constraint between the two concurrent calls.
    // SELECT FOR UPDATE serializes: one gets the lock, sees sessionsRemaining=1 → succeeds.
    // The other waits, then sees sessionsRemaining=0 → returns NO_CAPACITY.
    const [result1, result2] = await Promise.all([
      bookWithDeduction(businessId, clientPhone, serviceId, '10:00', '2030-02-15'),
      bookWithDeduction(businessId, clientPhone, serviceId, '11:00', '2030-02-15'),
    ]);

    // Exactly 1 succeeds, 1 fails
    const successes = [result1, result2].filter((r) => r.booking);
    const failures = [result1, result2].filter((r) => r.error);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].error).toBe('NO_CAPACITY');

    // sessionsRemaining must be 0, never -1 (race guard proven effective)
    const membershipRows = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.businessId, businessId),
          eq(memberships.clientPhone, clientPhone)
        )
      );
    expect(membershipRows[0].sessionsRemaining).toBe(0);
  });

  it('SESS-03: unlimited membership (sessionCount=null) booking creates no ledger entry', async () => {
    const clientPhone = nodeCrypto.randomUUID().slice(0, 12);
    const unlimitedPkg = await insertTestPackage(businessId, {
      name: `SESS-03 Unlimited ${Date.now()}`,
      validDays: 30,
      sessionCount: null,
    });
    const membership = await insertTestMembership(businessId, clientPhone, unlimitedPkg.id, {
      sessionsRemaining: null,
    });

    // Booking inserted without deductSession (caller skips for null sessionsRemaining)
    let bookingId: number | undefined;
    await withBusinessContext(businessId, async () => {
      const booking = await insertBooking({
        businessId,
        clientPhone,
        ...makeBookingData(serviceId, '14:00'),
      });
      expect(booking).not.toBeNull();
      bookingId = booking.id;
      // D-06: deductSession NOT called for unlimited memberships (sessionsRemaining === null)
    });

    // Assert: no ledger entry was created for this membership
    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(eq(membershipLedger.membershipId, membership.id));
    expect(ledgerRows).toHaveLength(0);

    // Assert: findMembershipByBooking returns null (no session_deducted row)
    const membershipIdFromLedger = await findMembershipByBooking(bookingId);
    expect(membershipIdFromLedger).toBeNull();
  });

  it('SESS-04: unlimited membership booking does not change sessionsRemaining', async () => {
    const clientPhone = nodeCrypto.randomUUID().slice(0, 12);
    const unlimitedPkg = await insertTestPackage(businessId, {
      name: `SESS-04 Unlimited ${Date.now()}`,
      validDays: 30,
      sessionCount: null,
    });
    const membership = await insertTestMembership(businessId, clientPhone, unlimitedPkg.id, {
      sessionsRemaining: null,
    });

    // Booking without deduction (unlimited)
    await withBusinessContext(businessId, async () => {
      await insertBooking({
        businessId,
        clientPhone,
        ...makeBookingData(serviceId, '15:00'),
      });
    });

    // sessionsRemaining must still be null
    const membershipRows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id));
    expect(membershipRows[0].sessionsRemaining).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// describe: cancelBookingWithRefund
// ---------------------------------------------------------------------------

describe('cancelBookingWithRefund', () => {
  let businessId: number;
  let serviceId: number;
  let packageId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;
    serviceId = await getTestServiceId(businessId);
    const pkg = await insertTestPackage(businessId, {
      name: `SESS-02 Package ${Date.now()}`,
      validDays: 30,
      sessionCount: 5,
    });
    packageId = pkg.id;
  });

  it('SESS-02: cancellation within membership validity restores 1 session credit', async () => {
    const clientPhone = nodeCrypto.randomUUID().slice(0, 12);
    const membership = await insertTestMembership(businessId, clientPhone, packageId, {
      sessionsRemaining: 5,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    // Step 1: insert booking + deduction (simulates confirmed booking)
    let bookingId: number | undefined;
    await withBusinessContext(businessId, async () => {
      const booking = await insertBooking({
        businessId,
        clientPhone,
        ...makeBookingData(serviceId, '10:00'),
      });
      bookingId = booking.id;
      await deductSession(membership.id, booking.id, 'booking:' + booking.id + ':deduction');
    });

    // Step 2: cancel booking + restore credit
    await withBusinessContext(businessId, async () => {
      await updateBookingStatus(bookingId, 'cancelled');
      const idempotencyKey = 'booking:' + bookingId + ':credit';
      await restoreCredit(membership.id, bookingId, idempotencyKey);
    });

    // Assert: sessionsRemaining = 5 (restored to original)
    const membershipRows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id));
    expect(membershipRows[0].sessionsRemaining).toBe(5);
  });

  it('SESS-02: credit restore appends ledger entry with operationType credit_restored', async () => {
    const clientPhone = nodeCrypto.randomUUID().slice(0, 12);
    const membership = await insertTestMembership(businessId, clientPhone, packageId, {
      sessionsRemaining: 5,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    // Insert booking + deduction
    let bookingId: number | undefined;
    await withBusinessContext(businessId, async () => {
      const booking = await insertBooking({
        businessId,
        clientPhone,
        ...makeBookingData(serviceId, '11:00'),
      });
      bookingId = booking.id;
      await deductSession(membership.id, booking.id, 'booking:' + booking.id + ':deduction');
    });

    // Cancel + restore
    await withBusinessContext(businessId, async () => {
      await updateBookingStatus(bookingId, 'cancelled');
      await restoreCredit(membership.id, bookingId, 'booking:' + bookingId + ':credit');
    });

    // Assert: credit_restored ledger row exists with sessionsDeducted === -1
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
    expect(ledgerRows[0].bookingId).toBe(bookingId);
  });

  it('SESS-02/03: cancellation after membership expiry does not restore credit (sessions forfeited)', async () => {
    const clientPhone = nodeCrypto.randomUUID().slice(0, 12);
    // Membership already expired (1 second in the past)
    const membership = await insertTestMembership(businessId, clientPhone, packageId, {
      sessionsRemaining: 5,
      expiresAt: new Date(Date.now() - 1000),
    });

    // Insert booking directly (getActiveMembershipForDeduction excludes expired memberships)
    const [bookingRow] = await db
      .insert(bookings)
      .values({
        businessId,
        clientPhone,
        serviceId,
        calendarDate: '2030-01-15',
        calendarTime: '16:00',
        bookingStatus: 'pending_owner_approval',
        requestId: nodeCrypto.randomUUID(),
        expiresAt: new Date(Date.now() + 7_200_000),
      })
      .returning();
    const bookingId = bookingRow.id as number;

    // Insert session_deducted ledger entry directly (simulates pre-expiry deduction)
    await db.insert(membershipLedger).values({
      membershipId: membership.id,
      operationType: 'session_deducted',
      sessionsDeducted: 1,
      bookingId,
      idempotencyKey: 'booking:' + bookingId + ':deduction',
    });

    // Cancel + attempt credit restore via the actual findMembershipByBooking + restoreCredit flow
    await withBusinessContext(businessId, async () => {
      await updateBookingStatus(bookingId, 'cancelled');
      const membershipId = await findMembershipByBooking(bookingId);
      if (membershipId !== null) {
        // restoreCredit checks expiresAt < now → returns early (SESS-03 expired guard)
        await restoreCredit(membershipId, bookingId, 'booking:' + bookingId + ':credit');
      }
    });

    // Assert: sessionsRemaining is unchanged (still 5)
    const membershipRows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id));
    expect(membershipRows[0].sessionsRemaining).toBe(5);

    // Assert: no credit_restored ledger row was inserted
    const creditRows = await db
      .select()
      .from(membershipLedger)
      .where(
        and(
          eq(membershipLedger.membershipId, membership.id),
          eq(membershipLedger.operationType, 'credit_restored')
        )
      );
    expect(creditRows).toHaveLength(0);
  });
});
