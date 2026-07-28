// covers CLSS-05
// Integration tests for listSessions — bookedCount aggregation, filtering,
// and result format verification.
// listSessions: returns upcoming non-cancelled sessions for a business, ordered
// by date/time. Joins sessionCatalog for capacity and serviceId.
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
const { bookings, services } = require('../src/database/schema');
const { listSessions } = require('../src/session/manager');
const { isoDateInAthens, addCalendarDays } = require('../src/utils/timezone');
const { insertTestBusiness } = require('./helpers/test-business');
const {
  insertTestSessionCatalog,
  insertTestSessionInstance,
} = require('./helpers/session-fixtures');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

describe('list upcoming sessions with booking counts', () => {
  let businessId: number;
  let serviceId: number;
  let catalogId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;

    const svcRows = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.businessId, businessId))
      .limit(1);
    serviceId = svcRows[0].id;

    // Insert a test session catalog
    const catalog = await insertTestSessionCatalog(businessId, serviceId);
    catalogId = catalog.id;
  });

  it('listSessions aggregates bookedCount correctly for each sessionInstance', async () => {
    const today = isoDateInAthens(new Date());
    const futureA = addCalendarDays(today, 5);
    const futureB = addCalendarDays(today, 6);

    // Insert two instances
    const instanceA = await insertTestSessionInstance(catalogId, {
      sessionDate: futureA,
      sessionTime: '09:00',
      bookedCount: 0,
      idempotencyKey: `test:listA:${catalogId}:${Date.now()}`,
    });
    const instanceB = await insertTestSessionInstance(catalogId, {
      sessionDate: futureB,
      sessionTime: '09:00',
      bookedCount: 0,
      idempotencyKey: `test:listB:${catalogId}:${Date.now()}`,
    });

    // Book 1 client into instance A (bookedCount field in sessionInstances is the
    // denormalized count updated by bookSessionInstance; listSessions reads it directly)
    const clientPhone = `list-client-${Date.now()}`;
    await db.insert(bookings).values({
      businessId,
      clientPhone,
      serviceId,
      sessionInstanceId: instanceA.id,
      calendarDate: futureA,
      calendarTime: '09:00',
      bookingStatus: 'confirmed',
      requestId: `list-agg:${instanceA.id}:${clientPhone}`,
      expiresAt: null,
    });
    // Manually update bookedCount to reflect the booking (normally done by bookSessionInstance)
    await db
      .update(require('../src/database/schema').sessionInstances)
      .set({ bookedCount: 1 })
      .where(eq(require('../src/database/schema').sessionInstances.id, instanceA.id));

    const sessions = await listSessions(businessId);

    const rowA = sessions.find((s: { instanceId: number }) => s.instanceId === instanceA.id);
    const rowB = sessions.find((s: { instanceId: number }) => s.instanceId === instanceB.id);

    expect(rowA).toBeDefined();
    expect(rowA.bookedCount).toBe(1);
    expect(rowB).toBeDefined();
    expect(rowB.bookedCount).toBe(0);
  });

  it('listSessions excludes cancelled instances (isCancelled=true) from results', async () => {
    const today = isoDateInAthens(new Date());
    const futureDate = addCalendarDays(today, 7);

    // Insert a cancelled instance
    const cancelledInstance = await insertTestSessionInstance(catalogId, {
      sessionDate: futureDate,
      sessionTime: '11:00',
      isCancelled: true,
      idempotencyKey: `test:list-cancel:${catalogId}:${Date.now()}`,
    });

    const sessions = await listSessions(businessId);

    // The cancelled instance must not appear in results
    const found = sessions.find(
      (s: { instanceId: number }) => s.instanceId === cancelledInstance.id
    );
    expect(found).toBeUndefined();
  });

  it('listSessions excludes instances with sessionDate in the past', async () => {
    const today = isoDateInAthens(new Date());
    const yesterday = addCalendarDays(today, -1);

    // Insert a past instance — direct insert bypasses the "today or future" filter in listSessions
    const pastInstance = await insertTestSessionInstance(catalogId, {
      sessionDate: yesterday,
      sessionTime: '12:00',
      isCancelled: false,
      idempotencyKey: `test:list-past:${catalogId}:${Date.now()}`,
    });

    const sessions = await listSessions(businessId);

    // Past instances must not appear in results
    const found = sessions.find(
      (s: { instanceId: number }) => s.instanceId === pastInstance.id
    );
    expect(found).toBeUndefined();
  });

  it('listSessions result format includes sessionDate, sessionTime, bookedCount, capacity for each row', async () => {
    const today = isoDateInAthens(new Date());
    const futureDate = addCalendarDays(today, 10);

    await insertTestSessionInstance(catalogId, {
      sessionDate: futureDate,
      sessionTime: '14:00',
      idempotencyKey: `test:list-format:${catalogId}:${Date.now()}`,
    });

    const sessions = await listSessions(businessId);

    // Each result row must include all 4 required fields with correct types
    expect(sessions.length).toBeGreaterThan(0);
    for (const session of sessions) {
      expect(typeof session.sessionDate).toBe('string');
      expect(session.sessionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof session.sessionTime).toBe('string');
      expect(session.sessionTime).toMatch(/^\d{2}:\d{2}$/);
      expect(typeof session.bookedCount).toBe('number');
      expect(session.bookedCount).toBeGreaterThanOrEqual(0);
      expect(typeof session.capacity).toBe('number');
      expect(session.capacity).toBeGreaterThan(0);
    }
  });

  it('listSessions returns empty array when no active upcoming sessions exist', async () => {
    // Create a fresh business with no session instances
    const freshBusiness = await insertTestBusiness();
    const freshSvcRows = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.businessId, freshBusiness.id))
      .limit(1);
    const freshServiceId = freshSvcRows[0].id;

    // Insert a catalog but no instances
    await insertTestSessionCatalog(freshBusiness.id, freshServiceId);

    const sessions = await listSessions(freshBusiness.id);
    expect(sessions).toEqual([]);
  });
});

// Phase 29 (D-01): listSessions' new 3rd param, excludePastToday. Uses real
// wall-clock time (no jest fake timers) — sessionDate/sessionTime are set as
// explicit offsets from the real "now" so the filter's own real-time
// comparison (via hoursUntilSession) is exercised end-to-end against Postgres.
describe('listSessions excludePastToday (Phase 29, D-01/D-02)', () => {
  // Returns the Athens-local {date, time} for "now" offset by `minutes`.
  function athensNowOffsetMinutes(minutes: number): { date: string; time: string } {
    const d = new Date(Date.now() + minutes * 60_000);
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Athens',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Athens',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
    return { date, time };
  }

  // Each test gets its own fresh business (+ auto-created default service):
  // the "one active catalog per (businessId, serviceId)" unique constraint
  // means catalogs can't safely be shared across tests in this describe
  // block, and the (catalogId, sessionDate, sessionTime) unique constraint
  // means two tests both anchored on "now" (minute resolution) could
  // otherwise collide if they landed in the same Athens minute.
  async function setupBusinessWithCatalog(): Promise<{ businessId: number; catalogId: number }> {
    const business = await insertTestBusiness();
    const svcRows = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.businessId, business.id))
      .limit(1);
    const catalog = await insertTestSessionCatalog(business.id, svcRows[0].id);
    return { businessId: business.id, catalogId: catalog.id };
  }

  it('excludes a same-day instance whose sessionTime is 5 minutes in the past (Athens) when excludePastToday=true', async () => {
    const { businessId, catalogId } = await setupBusinessWithCatalog();
    const { date, time } = athensNowOffsetMinutes(-5);
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: date,
      sessionTime: time,
      idempotencyKey: `test:excl-past:${catalogId}:${Date.now()}`,
    });

    const sessions = await listSessions(businessId, 90, true);
    const found = sessions.find((s: { instanceId: number }) => s.instanceId === instance.id);
    expect(found).toBeUndefined();
  });

  it('includes a same-day instance whose sessionTime is 5 minutes in the future (Athens) when excludePastToday=true', async () => {
    const { businessId, catalogId } = await setupBusinessWithCatalog();
    const { date, time } = athensNowOffsetMinutes(5);
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: date,
      sessionTime: time,
      idempotencyKey: `test:excl-future:${catalogId}:${Date.now()}`,
    });

    const sessions = await listSessions(businessId, 90, true);
    const found = sessions.find((s: { instanceId: number }) => s.instanceId === instance.id);
    expect(found).toBeDefined();
  });

  it('excludes a same-day instance whose sessionTime equals the current Athens minute exactly (boundary: strict > 0, not >= 0) when excludePastToday=true', async () => {
    const { businessId, catalogId } = await setupBusinessWithCatalog();
    const { date, time } = athensNowOffsetMinutes(0);
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: date,
      sessionTime: time,
      idempotencyKey: `test:excl-now:${catalogId}:${Date.now()}`,
    });

    const sessions = await listSessions(businessId, 90, true);
    const found = sessions.find((s: { instanceId: number }) => s.instanceId === instance.id);
    expect(found).toBeUndefined();
  });

  it('still includes a same-day instance 5 minutes in the past when excludePastToday is omitted (default false — owner-facing regression guard)', async () => {
    const { businessId, catalogId } = await setupBusinessWithCatalog();
    const { date, time } = athensNowOffsetMinutes(-5);
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: date,
      sessionTime: time,
      idempotencyKey: `test:default-false:${catalogId}:${Date.now()}`,
    });

    const sessions = await listSessions(businessId, 90);
    const found = sessions.find((s: { instanceId: number }) => s.instanceId === instance.id);
    expect(found).toBeDefined();
  });
});
