// covers CLSS-04
// Integration tests against a REAL local Postgres connection — required to
// verify SELECT FOR UPDATE capacity race guard, atomic bookedCount increment,
// and cancelled-session conflict handling in bookSessionInstance.
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
const { sessionInstances, sessionCatalog, bookings, services } = require('../src/database/schema');
const { bookSessionInstance } = require('../src/session/manager');
const { insertTestBusiness } = require('./helpers/test-business');
const {
  insertTestSessionCatalog,
  insertTestSessionInstance,
} = require('./helpers/session-fixtures');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

describe('direct client assignment to session', () => {
  let businessId: number;
  let serviceId: number;
  let catalogId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;

    // Fetch the default service inserted by insertTestBusiness
    const svcRows = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.businessId, businessId))
      .limit(1);
    serviceId = svcRows[0].id;

    // Insert a test session catalog (FREQ=WEEKLY;BYDAY=MO, capacity=10)
    const catalog = await insertTestSessionCatalog(businessId, serviceId);
    catalogId = catalog.id;
  });

  it('assign_client_to_session inserts booking row with correct sessionInstanceId FK', async () => {
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: '2099-11-10',
      idempotencyKey: `test:fk:${catalogId}:${Date.now()}`,
    });

    const clientPhone = `test-client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const idempotencyKey = `assign-test:${instance.id}:${clientPhone}`;

    const result = await bookSessionInstance(
      businessId,
      instance.id,
      clientPhone,
      serviceId,
      idempotencyKey
    );

    expect(result.status).toBe('success');
    expect(result.bookingId).toBeGreaterThan(0);

    // Verify the booking row has the correct sessionInstanceId FK
    const bookingRows = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, result.bookingId!));

    expect(bookingRows).toHaveLength(1);
    expect(bookingRows[0].sessionInstanceId).toBe(instance.id);
    expect(bookingRows[0].clientPhone).toBe(clientPhone);
    expect(bookingRows[0].businessId).toBe(businessId);
  });

  it('assign_client_to_session atomically increments sessionInstances.bookedCount by 1', async () => {
    // Use a fresh instance to start from bookedCount=0
    const freshInstance = await insertTestSessionInstance(catalogId, {
      sessionDate: '2099-11-11',
      idempotencyKey: `test:count:${catalogId}:${Date.now()}`,
    });

    // Verify starting bookedCount
    const beforeRows = await db
      .select({ bookedCount: sessionInstances.bookedCount })
      .from(sessionInstances)
      .where(eq(sessionInstances.id, freshInstance.id));
    expect(beforeRows[0].bookedCount).toBe(0);

    const clientPhone = `test-client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const idempotencyKey = `count-test:${freshInstance.id}:${clientPhone}`;

    const result = await bookSessionInstance(
      businessId,
      freshInstance.id,
      clientPhone,
      serviceId,
      idempotencyKey
    );

    expect(result.status).toBe('success');

    // Verify bookedCount incremented to 1
    const afterRows = await db
      .select({ bookedCount: sessionInstances.bookedCount })
      .from(sessionInstances)
      .where(eq(sessionInstances.id, freshInstance.id));
    expect(afterRows[0].bookedCount).toBe(1);
  });

  it('capacity race guard: two concurrent assignments on same full session — exactly one succeeds, one returns full', async () => {
    // Insert a fresh instance with bookedCount=9 (capacity=10, so exactly one slot left)
    const raceInstance = await insertTestSessionInstance(catalogId, {
      sessionDate: '2099-11-12',
      idempotencyKey: `test:race:${catalogId}:${Date.now()}`,
      bookedCount: 9,
    });

    // Confirm the instance's catalog has capacity=10
    const catalogRows = await db
      .select({ capacity: sessionCatalog.capacity })
      .from(sessionCatalog)
      .where(eq(sessionCatalog.id, catalogId));
    expect(catalogRows[0].capacity).toBe(10);

    // Two concurrent clients race to book the last slot
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2);
    const clientA = `race-a-${ts}-${rand}`;
    const clientB = `race-b-${ts}-${rand}`;

    const [resultA, resultB] = await Promise.all([
      bookSessionInstance(businessId, raceInstance.id, clientA, serviceId, `race:${raceInstance.id}:${clientA}`),
      bookSessionInstance(businessId, raceInstance.id, clientB, serviceId, `race:${raceInstance.id}:${clientB}`),
    ]);

    const statuses = [resultA.status, resultB.status].sort();
    // Exactly one 'full' and one 'success' — SELECT FOR UPDATE serializes concurrent access
    expect(statuses).toEqual(['full', 'success']);
  });

  it('assign_client_to_session on cancelled session returns conflict status, no booking inserted', async () => {
    // Insert a cancelled session instance
    const cancelledInstance = await insertTestSessionInstance(catalogId, {
      sessionDate: '2099-11-13',
      isCancelled: true,
      idempotencyKey: `test:cancelled:${catalogId}:${Date.now()}`,
    });

    const clientPhone = `test-client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const idempotencyKey = `cancelled-test:${cancelledInstance.id}:${clientPhone}`;

    const result = await bookSessionInstance(
      businessId,
      cancelledInstance.id,
      clientPhone,
      serviceId,
      idempotencyKey
    );

    expect(result.status).toBe('conflict');
    expect(result.bookingId).toBeUndefined();

    // Verify no booking row was inserted
    const bookingRows = await db
      .select()
      .from(bookings)
      .where(eq(bookings.requestId, idempotencyKey));
    expect(bookingRows).toHaveLength(0);
  });
});
