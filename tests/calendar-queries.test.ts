// Phase 25.1 (plan 01) integration tests against a REAL Postgres connection.
//
// Precondition: a local Postgres database (default randevuclaw_test) with the
// current schema and migration 0013 applied:
//   DATABASE_URL=postgresql://manolis@localhost:5432/randevuclaw_test npx drizzle-kit push
//   DATABASE_URL=postgresql://manolis@localhost:5432/randevuclaw_test \
//     npm run db:apply-sql -- migrations/0013_google_calendar_connect.sql
// This suite is NOT part of the automated gate on machines without Postgres;
// the Postgres-free coverage lives in tests/calendar-queries-mocked.test.ts.

const TEST_DATABASE_URL =
  process.env.BOOKING_QUERIES_TEST_DATABASE_URL ??
  'postgresql://manolis@localhost:5432/randevuclaw_test';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

process.env.DATABASE_URL = TEST_DATABASE_URL;
jest.resetModules();

/* eslint-disable @typescript-eslint/no-var-requires */
const schema = require('../src/database/schema');
const { db, pool } = require('../src/database/db');
const queries = require('../src/database/queries');
/* eslint-enable @typescript-eslint/no-var-requires */

const { eq } = require('drizzle-orm');

const RUN_ID = `test-calendar-queries-${Date.now()}`;

let businessId: number;
let otherBusinessId: number;
let serviceId: number;

beforeAll(async () => {
  const [business] = await db
    .insert(schema.businesses)
    .values({ name: 'Calendar Queries Test Biz', slug: RUN_ID })
    .returning();
  businessId = business.id;

  const [other] = await db
    .insert(schema.businesses)
    .values({ name: 'Calendar Queries Other Biz', slug: `${RUN_ID}-other` })
    .returning();
  otherBusinessId = other.id;

  const [service] = await db
    .insert(schema.services)
    .values({ businessId, name: 'Cal Service', durationMin: 30 })
    .returning();
  serviceId = service.id;
});

afterAll(async () => {
  for (const id of [businessId, otherBusinessId]) {
    await db.delete(schema.googleOauthStates).where(eq(schema.googleOauthStates.businessId, id));
  }
  await db.delete(schema.bookings).where(eq(schema.bookings.businessId, businessId));
  await db.delete(schema.services).where(eq(schema.services.businessId, businessId));
  await db.delete(schema.businesses).where(eq(schema.businesses.id, businessId));
  await db.delete(schema.businesses).where(eq(schema.businesses.id, otherBusinessId));
  await pool.end();
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

describe('google oauth state', () => {
  it('Test 1: consume is single use and returns the bound businessId', async () => {
    const hash = `${RUN_ID}-single`;
    await queries.insertGoogleOauthState(hash, businessId, new Date(Date.now() + 60_000));

    expect(await queries.consumeGoogleOauthState(hash)).toBe(businessId);
    expect(await queries.consumeGoogleOauthState(hash)).toBeNull();
  });

  it('Test 2: an expired state returns null and is cleaned up by deleteExpired', async () => {
    const hash = `${RUN_ID}-expired`;
    await queries.insertGoogleOauthState(hash, businessId, new Date(Date.now() - 1_000));

    expect(await queries.consumeGoogleOauthState(hash)).toBeNull();
    expect(await queries.deleteExpiredGoogleOauthStates()).toBeGreaterThanOrEqual(1);
  });

  it('Test 3: the state is bound to the businessId it was inserted with', async () => {
    const hash = `${RUN_ID}-bound`;
    await queries.insertGoogleOauthState(hash, otherBusinessId, new Date(Date.now() + 60_000));

    expect(await queries.consumeGoogleOauthState(hash)).toBe(otherBusinessId);
  });

  it('Test 4: an unknown state returns null', async () => {
    expect(await queries.consumeGoogleOauthState(`${RUN_ID}-nope`)).toBeNull();
  });
});

describe('claimGoogleCalendarNudge', () => {
  it('Test 5: true once, then false; release re-arms the claim', async () => {
    expect(await queries.claimGoogleCalendarNudge(businessId)).toBe(true);
    expect(await queries.claimGoogleCalendarNudge(businessId)).toBe(false);

    await queries.releaseGoogleCalendarNudgeClaim(businessId);
    expect(await queries.claimGoogleCalendarNudge(businessId)).toBe(true);
  });
});

describe('clearBusinessGoogleRefreshToken', () => {
  it('Test 6: true only when a token existed', async () => {
    expect(await queries.clearBusinessGoogleRefreshToken(businessId)).toBe(false);
    await db
      .update(schema.businesses)
      .set({ googleRefreshToken: 'tok' })
      .where(eq(schema.businesses.id, businessId));
    expect(await queries.clearBusinessGoogleRefreshToken(businessId)).toBe(true);
    expect(await queries.clearBusinessGoogleRefreshToken(businessId)).toBe(false);
  });
});

describe('findBookingsNeedingCalendarSync (bounded sweep)', () => {
  const TODAY = '2026-07-09';
  let seq = 0;

  async function seed(opts: {
    date: string;
    status: string;
    syncStatus?: string;
    eventId?: string | null;
  }): Promise<number> {
    seq += 1;
    const [row] = await db
      .insert(schema.bookings)
      .values({
        businessId,
        clientPhone: `client-${seq}`,
        serviceId,
        calendarDate: opts.date,
        // Distinct time per row so the active-slot unique index never collides.
        calendarTime: `${String(8 + (seq % 12)).padStart(2, '0')}:${seq < 12 ? '00' : '30'}`,
        bookingStatus: opts.status,
        requestId: `${RUN_ID}-req-${seq}`,
        calendarSyncStatus: opts.syncStatus ?? 'pending',
        googleCalendarEventId: opts.eventId ?? null,
      })
      .returning();
    return row.id;
  }

  it('Test 7: applies the date / event-id / sync-status predicates', async () => {
    const pastConfirmed = await seed({ date: '2026-07-01', status: 'confirmed' });
    const todayConfirmed = await seed({ date: TODAY, status: 'confirmed' });
    const futureConfirmed = await seed({ date: '2026-07-20', status: 'confirmed' });
    const cancelledWithEvent = await seed({
      date: '2026-07-02',
      status: 'cancelled',
      eventId: 'evt-x',
    });
    const cancelledNoEvent = await seed({ date: '2026-07-03', status: 'cancelled' });
    const synced = await seed({ date: '2026-07-21', status: 'confirmed', syncStatus: 'synced' });

    const rows = await queries.findBookingsNeedingCalendarSync(businessId, TODAY);
    const ids = rows.map((r: { id: number }) => r.id);

    expect(ids).toEqual(expect.arrayContaining([todayConfirmed, futureConfirmed, cancelledWithEvent]));
    expect(ids).not.toContain(pastConfirmed);
    expect(ids).not.toContain(cancelledNoEvent);
    expect(ids).not.toContain(synced);

    // Ordered by calendar_date then id.
    const dates = rows.map((r: { calendarDate: string }) => r.calendarDate);
    expect([...dates].sort()).toEqual(dates);
  });

  it('Test 8: respects the limit argument', async () => {
    const rows = await queries.findBookingsNeedingCalendarSync(businessId, TODAY, 1);
    expect(rows).toHaveLength(1);
  });

  it('Test 9: does not return another business\'s bookings', async () => {
    const rows = await queries.findBookingsNeedingCalendarSync(otherBusinessId, TODAY);
    expect(rows).toHaveLength(0);
  });
});
