// covers quick-260813-ji5 Task 2
// Integration tests against a REAL local Postgres connection — required to
// verify the LEFT JOIN + isNull "no matching ledger row" query behavior for
// getUnbilledBookingsForClient (src/billing/queries.ts).
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
const { bookings, membershipLedger, services } = require('../src/database/schema');
const { withBusinessContext } = require('../src/database/queries');
const { getUnbilledBookingsForClient } = require('../src/billing/queries');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestPackage, insertTestMembership } = require('./helpers/billing-fixtures');
const nodeCrypto = require('crypto');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

describe('getUnbilledBookingsForClient', () => {
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

  it('returns a confirmed booking with no matching session_deducted ledger row', async () => {
    const clientPhone = nodeCrypto.randomUUID().slice(0, 12);
    const [booking] = await db
      .insert(bookings)
      .values({
        businessId,
        clientPhone,
        serviceId,
        calendarDate: '2026-09-01',
        calendarTime: '10:00',
        bookingStatus: 'confirmed',
        requestId: `req-${clientPhone}-1`,
      })
      .returning();

    const result = await withBusinessContext(businessId, () =>
      getUnbilledBookingsForClient(businessId, clientPhone)
    );

    expect(result.map((r: { id: number }) => r.id)).toContain(booking.id);
  });

  it('does not return a booking that already has a session_deducted ledger row', async () => {
    const clientPhone = nodeCrypto.randomUUID().slice(0, 12);
    const pkg = await insertTestPackage(businessId, {
      name: `Unbilled Test Package ${clientPhone}`,
      validDays: 30,
      sessionCount: 10,
    });
    const membership = await insertTestMembership(businessId, clientPhone, pkg.id);

    const [booking] = await db
      .insert(bookings)
      .values({
        businessId,
        clientPhone,
        serviceId,
        calendarDate: '2026-09-02',
        calendarTime: '10:00',
        bookingStatus: 'confirmed',
        requestId: `req-${clientPhone}-1`,
      })
      .returning();

    await db.insert(membershipLedger).values({
      membershipId: membership.id,
      operationType: 'session_deducted',
      sessionsDeducted: 1,
      bookingId: booking.id,
      idempotencyKey: `booking:${booking.id}:deduction`,
    });

    const result = await withBusinessContext(businessId, () =>
      getUnbilledBookingsForClient(businessId, clientPhone)
    );

    expect(result.map((r: { id: number }) => r.id)).not.toContain(booking.id);
  });

  it('does not return a cancelled booking even with no ledger row', async () => {
    const clientPhone = nodeCrypto.randomUUID().slice(0, 12);
    const [booking] = await db
      .insert(bookings)
      .values({
        businessId,
        clientPhone,
        serviceId,
        calendarDate: '2026-09-03',
        calendarTime: '10:00',
        bookingStatus: 'cancelled',
        requestId: `req-${clientPhone}-1`,
      })
      .returning();

    const result = await withBusinessContext(businessId, () =>
      getUnbilledBookingsForClient(businessId, clientPhone)
    );

    expect(result.map((r: { id: number }) => r.id)).not.toContain(booking.id);
  });

  it('returns a pending_owner_approval booking (both active statuses count as unbilled)', async () => {
    const clientPhone = nodeCrypto.randomUUID().slice(0, 12);
    const [booking] = await db
      .insert(bookings)
      .values({
        businessId,
        clientPhone,
        serviceId,
        calendarDate: '2026-09-04',
        calendarTime: '10:00',
        bookingStatus: 'pending_owner_approval',
        requestId: `req-${clientPhone}-1`,
      })
      .returning();

    const result = await withBusinessContext(businessId, () =>
      getUnbilledBookingsForClient(businessId, clientPhone)
    );

    expect(result.map((r: { id: number }) => r.id)).toContain(booking.id);
  });
});
