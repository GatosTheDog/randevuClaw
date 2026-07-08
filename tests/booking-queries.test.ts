// Integration tests against a REAL Postgres connection (not mocked) — required
// to prove the partial unique index (unique_active_slot_per_business) and the
// request-id idempotency index actually behave as designed under real
// constraint enforcement. Phase 1 has no real-DB test precedent (every
// existing test file mocks db), so this file points DATABASE_URL at a local
// test Postgres database with the same migrations applied, per this plan's
// acceptance-criteria fallback.
//
// Setup (one-time, local dev machine): `createdb randevuclaw_test` then apply
// migrations/0000_*.sql and migrations/0001_*.sql to it with psql.

const TEST_DATABASE_URL =
  process.env.BOOKING_QUERIES_TEST_DATABASE_URL ??
  'postgresql://manolis@localhost:5432/randevuclaw_test';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

process.env.DATABASE_URL = TEST_DATABASE_URL;
// Force a fresh require of config/db/schema/queries so db.ts's Pool connects
// to TEST_DATABASE_URL rather than the placeholder set by tests/jest.setup.ts.
jest.resetModules();

/* eslint-disable @typescript-eslint/no-var-requires */
const schema = require('../src/database/schema');
const { db, pool } = require('../src/database/db');
const queries = require('../src/database/queries');
/* eslint-enable @typescript-eslint/no-var-requires */

const { eq } = require('drizzle-orm');

const RUN_ID = `test-booking-queries-${Date.now()}`;

let businessId: number;
let shortServiceId: number; // 30 min
let longServiceId: number; // 90 min

beforeAll(async () => {
  const [business] = await db
    .insert(schema.businesses)
    .values({ name: 'Booking Queries Test Biz', slug: RUN_ID })
    .returning();
  businessId = business.id;

  const [shortService] = await db
    .insert(schema.services)
    .values({ businessId, name: 'Short Service', durationMin: 30 })
    .returning();
  shortServiceId = shortService.id;

  const [longService] = await db
    .insert(schema.services)
    .values({ businessId, name: 'Long Service', durationMin: 90 })
    .returning();
  longServiceId = longService.id;
});

afterAll(async () => {
  await db
    .delete(schema.telegramUpdates)
    .where(eq(schema.telegramUpdates.businessId, businessId));
  await db.delete(schema.bookings).where(eq(schema.bookings.businessId, businessId));
  await db.delete(schema.services).where(eq(schema.services.businessId, businessId));
  await db.delete(schema.businesses).where(eq(schema.businesses.id, businessId));
  await pool.end();
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

function futureExpiry(): Date {
  return new Date(Date.now() + 2 * 60 * 60 * 1000);
}

describe('insertBooking', () => {
  it('Test 1: returns the inserted row with bookingStatus pending_owner_approval on an empty slot', async () => {
    const result = await queries.insertBooking({
      businessId,
      clientPhone: 'client-1',
      serviceId: shortServiceId,
      calendarDate: '2026-08-03',
      calendarTime: '09:00',
      requestId: `${RUN_ID}-req-1`,
      expiresAt: futureExpiry(),
    });

    expect(result).not.toBeNull();
    expect(result!.bookingStatus).toBe('pending_owner_approval');
  });

  it('Test 2: second insert for the SAME business/date/time with a DIFFERENT requestId returns null', async () => {
    const first = await queries.insertBooking({
      businessId,
      clientPhone: 'client-2a',
      serviceId: shortServiceId,
      calendarDate: '2026-08-03',
      calendarTime: '10:00',
      requestId: `${RUN_ID}-req-2a`,
      expiresAt: futureExpiry(),
    });
    expect(first).not.toBeNull();

    const second = await queries.insertBooking({
      businessId,
      clientPhone: 'client-2b',
      serviceId: shortServiceId,
      calendarDate: '2026-08-03',
      calendarTime: '10:00',
      requestId: `${RUN_ID}-req-2b`,
      expiresAt: futureExpiry(),
    });
    expect(second).toBeNull();
  });

  it('Test 3: second insert with the SAME clientPhone+requestId returns null (request-id index)', async () => {
    const first = await queries.insertBooking({
      businessId,
      clientPhone: 'client-3',
      serviceId: shortServiceId,
      calendarDate: '2026-08-03',
      calendarTime: '11:00',
      requestId: `${RUN_ID}-req-3`,
      expiresAt: futureExpiry(),
    });
    expect(first).not.toBeNull();

    // Same clientPhone + requestId, but a DIFFERENT slot — still must be
    // rejected by unique_request_per_client, proving both index paths
    // trigger the same onConflictDoNothing null result independently.
    const second = await queries.insertBooking({
      businessId,
      clientPhone: 'client-3',
      serviceId: shortServiceId,
      calendarDate: '2026-08-03',
      calendarTime: '12:00',
      requestId: `${RUN_ID}-req-3`,
      expiresAt: futureExpiry(),
    });
    expect(second).toBeNull();
  });

  it('Test 4: a slot released by cancellation can be re-booked (D-11)', async () => {
    const original = await queries.insertBooking({
      businessId,
      clientPhone: 'client-4a',
      serviceId: shortServiceId,
      calendarDate: '2026-08-03',
      calendarTime: '13:00',
      requestId: `${RUN_ID}-req-4a`,
      expiresAt: futureExpiry(),
    });
    expect(original).not.toBeNull();

    await queries.updateBookingStatus(original!.id, 'cancelled');

    const rebooked = await queries.insertBooking({
      businessId,
      clientPhone: 'client-4b',
      serviceId: shortServiceId,
      calendarDate: '2026-08-03',
      calendarTime: '13:00',
      requestId: `${RUN_ID}-req-4b`,
      expiresAt: futureExpiry(),
    });
    expect(rebooked).not.toBeNull();
  });
});

describe('findActiveBookingSlotsForDate', () => {
  it('Test 5: returns each active booking\'s OWN service durationMin via join, not the caller\'s requested duration', async () => {
    const date = '2026-08-04';
    await queries.insertBooking({
      businessId,
      clientPhone: 'client-5',
      serviceId: longServiceId,
      calendarDate: date,
      calendarTime: '14:00',
      requestId: `${RUN_ID}-req-5`,
      expiresAt: futureExpiry(),
    });

    const slots = await queries.findActiveBookingSlotsForDate(businessId, date);
    const slot = slots.find((s: { calendarTime: string }) => s.calendarTime === '14:00');

    expect(slot).toBeDefined();
    expect(slot!.durationMin).toBe(90);
  });
});

describe('expireStalePendingBookings', () => {
  it('Test 6: transitions only stale pending_owner_approval rows, leaves confirmed and recent pending untouched', async () => {
    const staleCreatedAt = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3h ago
    const recentCreatedAt = new Date(); // now

    const [stalePending] = await db
      .insert(schema.bookings)
      .values({
        businessId,
        clientPhone: 'client-6a',
        serviceId: shortServiceId,
        calendarDate: '2026-08-05',
        calendarTime: '09:00',
        bookingStatus: 'pending_owner_approval',
        requestId: `${RUN_ID}-req-6a`,
        createdAt: staleCreatedAt,
      })
      .returning();

    const [recentPending] = await db
      .insert(schema.bookings)
      .values({
        businessId,
        clientPhone: 'client-6b',
        serviceId: shortServiceId,
        calendarDate: '2026-08-05',
        calendarTime: '10:00',
        bookingStatus: 'pending_owner_approval',
        requestId: `${RUN_ID}-req-6b`,
        createdAt: recentCreatedAt,
      })
      .returning();

    const [staleConfirmed] = await db
      .insert(schema.bookings)
      .values({
        businessId,
        clientPhone: 'client-6c',
        serviceId: shortServiceId,
        calendarDate: '2026-08-05',
        calendarTime: '11:00',
        bookingStatus: 'confirmed',
        requestId: `${RUN_ID}-req-6c`,
        createdAt: staleCreatedAt,
      })
      .returning();

    const cutoffMs = 2 * 60 * 60 * 1000; // 2 hours, per D-09
    const expired = await queries.expireStalePendingBookings(businessId, cutoffMs);
    const expiredIds = expired.map((row: { id: number }) => row.id);

    expect(expiredIds).toContain(stalePending.id);
    expect(expiredIds).not.toContain(recentPending.id);
    expect(expiredIds).not.toContain(staleConfirmed.id);

    const refetchedRecent = await queries.findBookingById(businessId, recentPending.id);
    expect(refetchedRecent!.bookingStatus).toBe('pending_owner_approval');

    const refetchedConfirmed = await queries.findBookingById(businessId, staleConfirmed.id);
    expect(refetchedConfirmed!.bookingStatus).toBe('confirmed');
  });
});

describe('insertOrIgnoreTelegramUpdate', () => {
  it('Test 7: returns inserted the first time and ignored on a repeat with the same updateId', async () => {
    const updateId = `${RUN_ID}-update-1`;

    const first = await queries.insertOrIgnoreTelegramUpdate(
      updateId,
      businessId,
      'telegram-user-1',
      'message'
    );
    expect(first).toBe('inserted');

    const second = await queries.insertOrIgnoreTelegramUpdate(
      updateId,
      businessId,
      'telegram-user-1',
      'message'
    );
    expect(second).toBe('ignored');
  });
});
