// covers SLOT-01, SLOT-02, SLOT-03, SLOT-04, SLOT-05, SLOT-06
// Integration tests against a REAL local Postgres connection.
// Requires migrations 0010 (session catalog + slotlessRequests table) to be applied.
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
const { db } = require('../src/database/db');
const { eq } = require('drizzle-orm');
const {
  slotlessRequests,
  memberships,
  membershipLedger,
  bookings,
  services,
} = require('../src/database/schema');
const {
  insertSlotlessRequest,
  approveSlotlessRequest,
  rejectSlotlessRequest,
  listSlotlessRequestsForClient,
  countSlotlessRequestsSinceCheckin,
} = require('../src/session/slotless-requests');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestPackage, insertTestMembership } = require('./helpers/billing-fixtures');
const { withBusinessContext } = require('../src/database/queries');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniquePhone(): string {
  return `slotless-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function getTestServiceId(businessId: number): Promise<number> {
  const rows = await db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.businessId, businessId))
    .limit(1);
  return rows[0].id as number;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Slotless Booking Requests', () => {
  // -------------------------------------------------------------------------
  // Test 1 (SLOT-01): insertSlotlessRequest inserts a pending row
  // -------------------------------------------------------------------------
  it('insertSlotlessRequest inserts a pending row', async () => {
    const business = await insertTestBusiness();
    const serviceId = await getTestServiceId(business.id);
    const phone = uniquePhone();

    const row = await insertSlotlessRequest({
      businessId: business.id,
      clientPhone: phone,
      requestedSessionDate: '2026-08-01',
      requestedSessionTime: '10:00',
      serviceId,
      idempotencyKey: `slotless:test:${phone}`,
    });

    expect(row).not.toBeNull();
    expect(row.status).toBe('pending');
    expect(row.bookingId).toBeNull();

    // Cleanup
    await db.delete(slotlessRequests).where(eq(slotlessRequests.clientPhone, phone));
  });

  // -------------------------------------------------------------------------
  // Test 2 (SLOT-01): idempotency — same idempotencyKey returns null on replay
  // -------------------------------------------------------------------------
  it('insertSlotlessRequest is idempotent on same idempotencyKey', async () => {
    const business = await insertTestBusiness();
    const serviceId = await getTestServiceId(business.id);
    const phone = uniquePhone();
    const key = `slotless:test:idem:${phone}`;

    const first = await insertSlotlessRequest({
      businessId: business.id,
      clientPhone: phone,
      requestedSessionDate: '2026-08-02',
      requestedSessionTime: '11:00',
      serviceId,
      idempotencyKey: key,
    });
    expect(first).not.toBeNull();

    const second = await insertSlotlessRequest({
      businessId: business.id,
      clientPhone: phone,
      requestedSessionDate: '2026-08-02',
      requestedSessionTime: '11:00',
      serviceId,
      idempotencyKey: key,
    });
    expect(second).toBeNull();

    // Only 1 row in DB for this key
    const rows = await db
      .select()
      .from(slotlessRequests)
      .where(eq(slotlessRequests.idempotencyKey, key));
    expect(rows).toHaveLength(1);

    // Cleanup
    await db.delete(slotlessRequests).where(eq(slotlessRequests.clientPhone, phone));
  });

  // -------------------------------------------------------------------------
  // Test 3 (SLOT-03): approveSlotlessRequest creates booking and deducts credit
  // -------------------------------------------------------------------------
  it('approveSlotlessRequest creates booking and deducts credit', async () => {
    const business = await insertTestBusiness();
    const pkg = await insertTestPackage(business.id);
    const serviceId = await getTestServiceId(business.id);
    const phone = uniquePhone();

    const membership = await insertTestMembership(business.id, phone, pkg.id, {
      sessionsRemaining: 5,
    });

    const request = await withBusinessContext(business.id, () =>
      insertSlotlessRequest({
        businessId: business.id,
        clientPhone: phone,
        requestedSessionDate: '2026-08-03',
        requestedSessionTime: '09:00',
        serviceId,
        idempotencyKey: `slotless:test:approve:${phone}`,
      })
    );
    expect(request).not.toBeNull();

    const result = await withBusinessContext(business.id, () =>
      approveSlotlessRequest(request.id, business.id)
    );

    expect(result).not.toBeNull();
    expect(result.booking.bookingStatus).toBe('confirmed');

    // slotlessRequests row updated
    const reqRows = await db
      .select()
      .from(slotlessRequests)
      .where(eq(slotlessRequests.id, request.id));
    expect(reqRows[0].status).toBe('approved');
    expect(reqRows[0].bookingId).toBe(result.booking.id);

    // sessionsRemaining decremented by 1
    const memRows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id));
    expect(memRows[0].sessionsRemaining).toBe(4);

    // ledger row created with this booking
    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(eq(membershipLedger.bookingId, result.booking.id));
    expect(ledgerRows.length).toBeGreaterThanOrEqual(1);

    // Cleanup
    await db.delete(bookings).where(eq(bookings.id, result.booking.id));
    await db.delete(slotlessRequests).where(eq(slotlessRequests.clientPhone, phone));
    await db.delete(membershipLedger).where(eq(membershipLedger.membershipId, membership.id));
    await db.delete(memberships).where(eq(memberships.id, membership.id));
  });

  // -------------------------------------------------------------------------
  // Test 4 (SLOT-03): approveSlotlessRequest returns null for lapsed membership
  // -------------------------------------------------------------------------
  it('approveSlotlessRequest returns null for lapsed membership', async () => {
    const business = await insertTestBusiness();
    const pkg = await insertTestPackage(business.id);
    const serviceId = await getTestServiceId(business.id);
    const phone = uniquePhone();

    // Expired yesterday
    await insertTestMembership(business.id, phone, pkg.id, {
      expiresAt: new Date(Date.now() - 86400000),
    });

    const request = await withBusinessContext(business.id, () =>
      insertSlotlessRequest({
        businessId: business.id,
        clientPhone: phone,
        requestedSessionDate: '2026-08-04',
        requestedSessionTime: '10:00',
        serviceId,
        idempotencyKey: `slotless:test:lapsed:${phone}`,
      })
    );
    expect(request).not.toBeNull();

    const result = await withBusinessContext(business.id, () =>
      approveSlotlessRequest(request.id, business.id)
    );

    expect(result).toBeNull();

    // Request still pending
    const reqRows = await db
      .select()
      .from(slotlessRequests)
      .where(eq(slotlessRequests.id, request.id));
    expect(reqRows[0].status).toBe('pending');

    // Cleanup
    await db.delete(slotlessRequests).where(eq(slotlessRequests.clientPhone, phone));
  });

  // -------------------------------------------------------------------------
  // Test 5 (SLOT-04): rejectSlotlessRequest sets status to rejected
  // -------------------------------------------------------------------------
  it('rejectSlotlessRequest sets status to rejected', async () => {
    const business = await insertTestBusiness();
    const serviceId = await getTestServiceId(business.id);
    const phone = uniquePhone();

    const request = await withBusinessContext(business.id, () =>
      insertSlotlessRequest({
        businessId: business.id,
        clientPhone: phone,
        requestedSessionDate: '2026-08-05',
        requestedSessionTime: '11:00',
        serviceId,
        idempotencyKey: `slotless:test:reject:${phone}`,
      })
    );
    expect(request).not.toBeNull();

    const rejected = await rejectSlotlessRequest(request.id);

    expect(rejected).not.toBeNull();
    expect(rejected.status).toBe('rejected');

    // DB confirms
    const reqRows = await db
      .select()
      .from(slotlessRequests)
      .where(eq(slotlessRequests.id, request.id));
    expect(reqRows[0].status).toBe('rejected');

    // Cleanup
    await db.delete(slotlessRequests).where(eq(slotlessRequests.clientPhone, phone));
  });

  // -------------------------------------------------------------------------
  // Test 6 (SLOT-04): rejectSlotlessRequest on already-rejected row returns null
  // -------------------------------------------------------------------------
  it('rejectSlotlessRequest on already-rejected row returns null', async () => {
    const business = await insertTestBusiness();
    const serviceId = await getTestServiceId(business.id);
    const phone = uniquePhone();

    const request = await withBusinessContext(business.id, () =>
      insertSlotlessRequest({
        businessId: business.id,
        clientPhone: phone,
        requestedSessionDate: '2026-08-06',
        requestedSessionTime: '12:00',
        serviceId,
        idempotencyKey: `slotless:test:reject2:${phone}`,
      })
    );
    expect(request).not.toBeNull();

    const first = await rejectSlotlessRequest(request.id);
    expect(first).not.toBeNull();

    const second = await rejectSlotlessRequest(request.id);
    expect(second).toBeNull();

    // Cleanup
    await db.delete(slotlessRequests).where(eq(slotlessRequests.clientPhone, phone));
  });

  // -------------------------------------------------------------------------
  // Test 7 (SLOT-05): listSlotlessRequestsForClient returns requests DESC
  // -------------------------------------------------------------------------
  it('listSlotlessRequestsForClient returns requests in DESC order', async () => {
    const business = await insertTestBusiness();
    const serviceId = await getTestServiceId(business.id);
    const phone = uniquePhone();

    // Insert 3 requests with different dates (in order oldest → newest)
    await withBusinessContext(business.id, async () => {
      await insertSlotlessRequest({
        businessId: business.id,
        clientPhone: phone,
        requestedSessionDate: '2026-08-01',
        requestedSessionTime: '09:00',
        serviceId,
        idempotencyKey: `slotless:test:list1:${phone}`,
      });
    });
    // Small delay to ensure ordering by createdAt is deterministic
    await new Promise((r) => setTimeout(r, 10));
    await withBusinessContext(business.id, async () => {
      await insertSlotlessRequest({
        businessId: business.id,
        clientPhone: phone,
        requestedSessionDate: '2026-08-02',
        requestedSessionTime: '10:00',
        serviceId,
        idempotencyKey: `slotless:test:list2:${phone}`,
      });
    });
    await new Promise((r) => setTimeout(r, 10));
    await withBusinessContext(business.id, async () => {
      await insertSlotlessRequest({
        businessId: business.id,
        clientPhone: phone,
        requestedSessionDate: '2026-08-03',
        requestedSessionTime: '11:00',
        serviceId,
        idempotencyKey: `slotless:test:list3:${phone}`,
      });
    });

    const results = await withBusinessContext(business.id, () =>
      listSlotlessRequestsForClient(business.id, phone)
    );

    expect(results).toHaveLength(3);
    // DESC order: most recent date first
    expect(results[0].requestedSessionDate).toBe('2026-08-03');

    // Cleanup
    await db.delete(slotlessRequests).where(eq(slotlessRequests.clientPhone, phone));
  });

  // -------------------------------------------------------------------------
  // Test 8 (SLOT-06): countSlotlessRequestsSinceCheckin returns correct count
  // -------------------------------------------------------------------------
  it('countSlotlessRequestsSinceCheckin returns correct count', async () => {
    const business = await insertTestBusiness();
    const serviceId = await getTestServiceId(business.id);
    const phone = uniquePhone();

    // Insert 3 requests (created now, so all within "yesterday" window)
    await withBusinessContext(business.id, async () => {
      await insertSlotlessRequest({
        businessId: business.id,
        clientPhone: phone,
        requestedSessionDate: '2026-09-01',
        requestedSessionTime: '09:00',
        serviceId,
        idempotencyKey: `slotless:test:count1:${phone}`,
      });
      await insertSlotlessRequest({
        businessId: business.id,
        clientPhone: phone,
        requestedSessionDate: '2026-09-02',
        requestedSessionTime: '10:00',
        serviceId,
        idempotencyKey: `slotless:test:count2:${phone}`,
      });
      await insertSlotlessRequest({
        businessId: business.id,
        clientPhone: phone,
        requestedSessionDate: '2026-09-03',
        requestedSessionTime: '11:00',
        serviceId,
        idempotencyKey: `slotless:test:count3:${phone}`,
      });
    });

    // Query with yesterday's date — all 3 rows were created today, so all 3 match
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const count = await withBusinessContext(business.id, () =>
      countSlotlessRequestsSinceCheckin(business.id, phone, yesterday)
    );

    expect(count).toBe(3);

    // Cleanup
    await db.delete(slotlessRequests).where(eq(slotlessRequests.clientPhone, phone));
  });
});
