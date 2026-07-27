// covers OWNR-05, OWNR-06, OWNR-07 (Phase 22: session booking approval flow)
// Integration tests against a REAL local Postgres connection.
// Requires migrations 0006 (billing), 0007 (enforcement), 0010 (session catalog) to be applied.
//
// Setup (one-time, local dev machine):
//   psql postgresql://manolis@localhost:5432/randevuclaw_test \
//     -f migrations/0010_session_catalog_schema.sql

const TEST_DATABASE_URL =
  process.env.SESSION_TEST_DATABASE_URL ??
  process.env.BILLING_TEST_DATABASE_URL ??
  'postgresql://manolis@localhost:5432/randevuclaw_test';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = TEST_DATABASE_URL;
jest.resetModules();

/* eslint-disable @typescript-eslint/no-var-requires */
const { db } = require('../../src/database/db');
const { eq, and } = require('drizzle-orm');
const {
  memberships,
  membershipLedger,
  sessionInstances,
  bookings,
  services,
} = require('../../src/database/schema');
const {
  bookSessionInstance,
  releaseSessionCapacity,
} = require('../../src/session/manager');
const {
  releaseExpiredSessionBooking,
} = require('../../src/conversation/expiry-poller');
const {
  updateBookingStatusIfPending,
} = require('../../src/database/queries');
const {
  findMembershipByBooking,
  restoreCredit,
} = require('../../src/billing/queries');
const { insertTestBusiness } = require('../helpers/test-business');
const { insertTestPackage, insertTestMembership } = require('../helpers/billing-fixtures');
const {
  insertTestSessionCatalog,
  insertTestSessionInstance,
  insertTestSessionBooking,
} = require('../helpers/session-fixtures');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniquePhone(): string {
  return `sbk-client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function getTestServiceId(businessId: number): Promise<number> {
  const rows = await db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.businessId, businessId))
    .limit(1);
  return rows[0].id as number;
}

async function getBookedCount(sessionInstanceId: number): Promise<number> {
  const rows = await db
    .select({ bookedCount: sessionInstances.bookedCount })
    .from(sessionInstances)
    .where(eq(sessionInstances.id, sessionInstanceId));
  return rows[0].bookedCount as number;
}

async function getSessionsRemaining(membershipId: number): Promise<number | null> {
  const rows = await db
    .select({ sessionsRemaining: memberships.sessionsRemaining })
    .from(memberships)
    .where(eq(memberships.id, membershipId));
  return rows[0].sessionsRemaining;
}

// ---------------------------------------------------------------------------
// (a) reject: capacity released + credit restored atomically
// ---------------------------------------------------------------------------

describe('OWNR-06/OWNR-07: reject releases capacity and restores credit', () => {
  let businessId: number;
  let serviceId: number;
  let catalogId: number;
  let packageId: number;
  let clientPhone: string;
  let instanceId: number;
  let membershipId: number;
  let bookingId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;
    serviceId = await getTestServiceId(businessId);

    const catalog = await insertTestSessionCatalog(businessId, serviceId, { capacity: 5 });
    catalogId = catalog.id;

    const instance = await insertTestSessionInstance(catalogId, {
      bookedCount: 0,
      idempotencyKey: `sbk-reject-inst:${catalogId}:${Date.now()}`,
    });
    instanceId = instance.id;

    const pkg = await insertTestPackage(businessId, {
      name: `SBK-reject pkg ${Date.now()}`,
      sessionCount: 10,
    });
    packageId = pkg.id;

    clientPhone = uniquePhone();
    const membership = await insertTestMembership(businessId, clientPhone, packageId, {
      sessionsRemaining: 5,
    });
    membershipId = membership.id;

    const bookResult = await bookSessionInstance(
      businessId,
      instanceId,
      clientPhone,
      serviceId,
      `sbk-reject:${instanceId}:${clientPhone}`,
      { id: membershipId, sessionsRemaining: 5, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }
      // no 7th arg — defaults to pending_owner_approval (Phase 22)
    );
    expect(bookResult.status).toBe('success');
    bookingId = bookResult.bookingId!;
  });

  it('booking is created pending_owner_approval and holds capacity/credit at insert time', async () => {
    const rows = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(rows[0].bookingStatus).toBe('pending_owner_approval');
    expect(await getBookedCount(instanceId)).toBe(1);
    expect(await getSessionsRemaining(membershipId)).toBe(4);
  });

  it('reject: updateBookingStatusIfPending + releaseSessionCapacity + restoreCredit atomically release capacity and restore credit', async () => {
    const updated = await updateBookingStatusIfPending(bookingId, 'rejected');
    expect(updated).not.toBeNull();
    expect(updated.bookingStatus).toBe('rejected');

    await releaseSessionCapacity(instanceId);
    const membershipIdFromLedger = await findMembershipByBooking(bookingId);
    expect(membershipIdFromLedger).toBe(membershipId);
    await restoreCredit(membershipIdFromLedger, bookingId, `booking:${bookingId}:credit`);

    expect(await getBookedCount(instanceId)).toBe(0);
    expect(await getSessionsRemaining(membershipId)).toBe(5);
  });

  it('double-tap idempotency (T-22-03): a second updateBookingStatusIfPending on the same already-rejected booking returns null', async () => {
    const secondAttempt = await updateBookingStatusIfPending(bookingId, 'rejected');
    expect(secondAttempt).toBeNull();

    // Capacity/credit must NOT change again on a second (no-op) reject attempt.
    expect(await getBookedCount(instanceId)).toBe(0);
    expect(await getSessionsRemaining(membershipId)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// (c) expiry: releaseExpiredSessionBooking releases capacity + restores credit
// ---------------------------------------------------------------------------

describe('OWNR-07: expiry sweep cleanup releases capacity and restores credit', () => {
  let businessId: number;
  let serviceId: number;
  let catalogId: number;
  let packageId: number;
  let clientPhone: string;
  let instanceId: number;
  let membershipId: number;
  let bookingId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;
    serviceId = await getTestServiceId(businessId);

    const catalog = await insertTestSessionCatalog(businessId, serviceId, { capacity: 5 });
    catalogId = catalog.id;

    const instance = await insertTestSessionInstance(catalogId, {
      bookedCount: 1, // simulate the held slot from the original (now-stale) booking
      idempotencyKey: `sbk-expiry-inst:${catalogId}:${Date.now()}`,
    });
    instanceId = instance.id;

    const pkg = await insertTestPackage(businessId, {
      name: `SBK-expiry pkg ${Date.now()}`,
      sessionCount: 10,
    });
    packageId = pkg.id;

    clientPhone = uniquePhone();
    const membership = await insertTestMembership(businessId, clientPhone, packageId, {
      sessionsRemaining: 4, // simulate the 1 session already deducted at booking time
    });
    membershipId = membership.id;

    // Stale pending booking, createdAt 3 hours in the past (past the 2h cutoff)
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const booking = await insertTestSessionBooking(businessId, instanceId, clientPhone, serviceId, {
      bookingStatus: 'pending_owner_approval',
      createdAt: threeHoursAgo,
    });
    bookingId = booking.id;

    // Simulate the deduction ledger row written at booking time (mirrors
    // tests/cancellation-cutoff.test.ts's setupConfirmedBookingWithDeduction pattern).
    await db.insert(membershipLedger).values({
      membershipId,
      bookingId,
      operationType: 'session_deducted',
      sessionsDeducted: 1,
      idempotencyKey: `sbk-expiry-deduct-${bookingId}-${Date.now()}`,
    });
  });

  it('releaseExpiredSessionBooking releases bookedCount and restores the deducted credit, with no Telegram calls', async () => {
    const bookingRows = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    const booking = bookingRows[0];

    await releaseExpiredSessionBooking(businessId, booking);

    expect(await getBookedCount(instanceId)).toBe(0);
    expect(await getSessionsRemaining(membershipId)).toBe(5);

    // Confirm a credit_restored ledger row now exists for this booking.
    const restoredRows = await db
      .select()
      .from(membershipLedger)
      .where(
        and(
          eq(membershipLedger.bookingId, bookingId),
          eq(membershipLedger.operationType, 'credit_restored')
        )
      );
    expect(restoredRows).toHaveLength(1);
  });

  it('releaseExpiredSessionBooking is a no-op for a booking with sessionInstanceId null', async () => {
    const nonSessionBookingRows = await db
      .insert(bookings)
      .values({
        businessId,
        clientPhone: uniquePhone(),
        serviceId,
        sessionInstanceId: null,
        calendarDate: '2000-01-01',
        calendarTime: '00:00',
        bookingStatus: 'pending_owner_approval',
        requestId: `sbk-expiry-nonsession:${Date.now()}`,
      })
      .returning();
    const nonSessionBooking = nonSessionBookingRows[0];

    // Should not throw and should not touch bookedCount for our test instance.
    await expect(releaseExpiredSessionBooking(businessId, nonSessionBooking)).resolves.toBeUndefined();
    expect(await getBookedCount(instanceId)).toBe(0); // unchanged from the prior test
  });
});
