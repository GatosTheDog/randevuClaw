// Quick task 260729-n05: real-DB integration tests proving the client
// full-erase cascade delete is FK-safe against the actual migrated schema,
// and that unlink-only preserves booking/membership history.
//
// Mirrors the bootstrap pattern from tests/booking-queries.test.ts /
// tests/billing-membership-creation.test.ts: point DATABASE_URL at a local
// randevuclaw_test Postgres DB, jest.resetModules(), require() (not import)
// modules fresh so db.ts's Pool connects to the test DB.
//
// NEVER run bare `npm test` — machine crashes on full suite.
// Use: npm test -- --testPathPattern="client-delete-queries" --testTimeout=20000

const TEST_DATABASE_URL =
  process.env.CLIENT_DELETE_TEST_DATABASE_URL ??
  'postgresql://manolis@localhost:5432/randevuclaw_test';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

process.env.DATABASE_URL = TEST_DATABASE_URL;
jest.resetModules();

/* eslint-disable @typescript-eslint/no-var-requires */
const { db, pool } = require('../src/database/db');
const schema = require('../src/database/schema');
const queries = require('../src/database/queries');
const billingQueries = require('../src/billing/queries');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestPackage, insertTestMembership } = require('./helpers/billing-fixtures');
/* eslint-enable @typescript-eslint/no-var-requires */

const { eq, and } = require('drizzle-orm');

const RUN_ID = `n05-client-delete-${Date.now()}`;

const businessIds: number[] = [];

afterAll(async () => {
  for (const businessId of businessIds) {
    // Best-effort cleanup across every affected table, scoped by businessId.
    const membershipRows = await db
      .select({ id: schema.memberships.id })
      .from(schema.memberships)
      .where(eq(schema.memberships.businessId, businessId));
    const membershipIds = membershipRows.map((r: { id: number }) => r.id);

    if (membershipIds.length > 0) {
      const { inArray } = require('drizzle-orm');
      await db.delete(schema.membershipLedger).where(inArray(schema.membershipLedger.membershipId, membershipIds));
      await db
        .delete(schema.membershipExpiryNotifications)
        .where(inArray(schema.membershipExpiryNotifications.membershipId, membershipIds));
      await db
        .delete(schema.renewalNudgeNotifications)
        .where(inArray(schema.renewalNudgeNotifications.membershipId, membershipIds));
    }

    await db.delete(schema.memberships).where(eq(schema.memberships.businessId, businessId));
    await db.delete(schema.slotlessRequests).where(eq(schema.slotlessRequests.businessId, businessId));
    await db.delete(schema.bookings).where(eq(schema.bookings.businessId, businessId));
    await db.delete(schema.conversationTurns).where(eq(schema.conversationTurns.businessId, businessId));
    await db
      .delete(schema.clientBusinessRelationships)
      .where(eq(schema.clientBusinessRelationships.businessId, businessId));
    await db.delete(schema.billingPackages).where(eq(schema.billingPackages.businessId, businessId));
    await db.delete(schema.services).where(eq(schema.services.businessId, businessId));
    await db.delete(schema.businessHours).where(eq(schema.businessHours.businessId, businessId));
    await db.delete(schema.businesses).where(eq(schema.businesses.id, businessId));
  }

  await pool.end();
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

async function getDefaultServiceId(businessId: number): Promise<number> {
  const rows = await db
    .select({ id: schema.services.id })
    .from(schema.services)
    .where(eq(schema.services.businessId, businessId));
  return rows[0].id;
}

function futureExpiry(): Date {
  return new Date(Date.now() + 2 * 60 * 60 * 1000);
}

describe('Full erase cascade', () => {
  it('deletes every row across all 8 tables with zero FK-violation errors', async () => {
    const clientPhone = `${RUN_ID}-full-erase`;

    const business = await insertTestBusiness({ name: 'N05 Full Erase Biz', slug: `${RUN_ID}-full` });
    businessIds.push(business.id);

    const pkg = await insertTestPackage(business.id);
    const membership = await insertTestMembership(business.id, clientPhone, pkg.id);

    // Directly insert one row into each of the 3 billing-notification tables,
    // referencing the membership id from above.
    await db.insert(schema.membershipLedger).values({
      membershipId: membership.id,
      operationType: 'payment_recorded',
      sessionsDeducted: 0,
      idempotencyKey: `${RUN_ID}-ledger-full-erase`,
    });
    await db.insert(schema.membershipExpiryNotifications).values({
      membershipId: membership.id,
      notificationType: '7_day_client',
      expiryDate: '2026-08-15',
    });
    await db.insert(schema.renewalNudgeNotifications).values({
      membershipId: membership.id,
      nudgeDate: '2026-08-01',
    });

    const serviceId = await getDefaultServiceId(business.id);

    let relId!: number;
    let bookingId!: number;

    await queries.withBusinessContext(business.id, async () => {
      const rel = await queries.insertClientBusinessRelationship(business.id, clientPhone);
      relId = rel.id;

      const booking = await queries.insertBooking({
        businessId: business.id,
        clientPhone,
        serviceId,
        calendarDate: '2026-08-10',
        calendarTime: '09:00',
        requestId: `${RUN_ID}-req-full-erase`,
        expiresAt: futureExpiry(),
      });
      bookingId = booking.id;

      await db.insert(schema.slotlessRequests).values({
        businessId: business.id,
        clientPhone,
        requestedSessionDate: '2026-08-11',
        requestedSessionTime: '10:00',
        serviceId,
        idempotencyKey: `${RUN_ID}-slotless-full-erase`,
      });

      await db.insert(schema.conversationTurns).values({
        businessId: business.id,
        clientPhone,
        interactionId: null,
        requestId: `${RUN_ID}-conv-full-erase`,
        messageText: 'test message',
        responseText: 'test response',
        toolCalls: null,
      });
    });

    await expect(
      queries.withBusinessContext(business.id, async () => {
        await billingQueries.deleteClientBillingData(business.id, clientPhone);
        await queries.deleteClientBookingData(business.id, clientPhone);
        await queries.deleteClientBusinessRelationship(relId, business.id);
      })
    ).resolves.not.toThrow();

    const remainingLedger = await db
      .select()
      .from(schema.membershipLedger)
      .where(eq(schema.membershipLedger.membershipId, membership.id));
    expect(remainingLedger).toEqual([]);

    const remainingExpiryNotifications = await db
      .select()
      .from(schema.membershipExpiryNotifications)
      .where(eq(schema.membershipExpiryNotifications.membershipId, membership.id));
    expect(remainingExpiryNotifications).toEqual([]);

    const remainingNudgeNotifications = await db
      .select()
      .from(schema.renewalNudgeNotifications)
      .where(eq(schema.renewalNudgeNotifications.membershipId, membership.id));
    expect(remainingNudgeNotifications).toEqual([]);

    const remainingMemberships = await db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.businessId, business.id), eq(schema.memberships.clientPhone, clientPhone)));
    expect(remainingMemberships).toEqual([]);

    const remainingSlotlessRequests = await db
      .select()
      .from(schema.slotlessRequests)
      .where(
        and(eq(schema.slotlessRequests.businessId, business.id), eq(schema.slotlessRequests.clientPhone, clientPhone))
      );
    expect(remainingSlotlessRequests).toEqual([]);

    const remainingBookings = await db
      .select()
      .from(schema.bookings)
      .where(and(eq(schema.bookings.businessId, business.id), eq(schema.bookings.clientPhone, clientPhone)));
    expect(remainingBookings).toEqual([]);

    const remainingConversationTurns = await db
      .select()
      .from(schema.conversationTurns)
      .where(
        and(eq(schema.conversationTurns.businessId, business.id), eq(schema.conversationTurns.clientPhone, clientPhone))
      );
    expect(remainingConversationTurns).toEqual([]);

    const remainingRelationship = await db
      .select()
      .from(schema.clientBusinessRelationships)
      .where(eq(schema.clientBusinessRelationships.id, relId));
    expect(remainingRelationship).toEqual([]);

    // bookingId is referenced above only to prove the insert succeeded; no
    // further assertion needed beyond the bookings-table check above.
    expect(bookingId).toBeGreaterThan(0);
  });
});

describe('Unlink only preserves history', () => {
  it('deletes only the relationship row — membership and booking rows remain', async () => {
    const clientPhone = `${RUN_ID}-unlink-only`;

    const business = await insertTestBusiness({ name: 'N05 Unlink Only Biz', slug: `${RUN_ID}-unlink` });
    businessIds.push(business.id);

    const pkg = await insertTestPackage(business.id);
    const membership = await insertTestMembership(business.id, clientPhone, pkg.id);
    const serviceId = await getDefaultServiceId(business.id);

    let relId!: number;
    let bookingId!: number;

    await queries.withBusinessContext(business.id, async () => {
      const rel = await queries.insertClientBusinessRelationship(business.id, clientPhone);
      relId = rel.id;

      const booking = await queries.insertBooking({
        businessId: business.id,
        clientPhone,
        serviceId,
        calendarDate: '2026-08-12',
        calendarTime: '09:00',
        requestId: `${RUN_ID}-req-unlink-only`,
        expiresAt: futureExpiry(),
      });
      bookingId = booking.id;
    });

    const deleted = await queries.deleteClientBusinessRelationship(relId, business.id);
    expect(deleted).toBe(true);

    const remainingRelationship = await db
      .select()
      .from(schema.clientBusinessRelationships)
      .where(eq(schema.clientBusinessRelationships.id, relId));
    expect(remainingRelationship).toEqual([]);

    const remainingMemberships = await db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, membership.id));
    expect(remainingMemberships.length).toBe(1);

    const remainingBookings = await db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, bookingId));
    expect(remainingBookings.length).toBe(1);
  });

  it('returns false and leaves the row untouched when relId belongs to a different business (cross-tenant guard)', async () => {
    const clientPhone = `${RUN_ID}-cross-tenant`;

    const businessA = await insertTestBusiness({ name: 'N05 Cross Tenant A', slug: `${RUN_ID}-cta` });
    const businessB = await insertTestBusiness({ name: 'N05 Cross Tenant B', slug: `${RUN_ID}-ctb` });
    businessIds.push(businessA.id, businessB.id);

    let relId!: number;
    await queries.withBusinessContext(businessA.id, async () => {
      const rel = await queries.insertClientBusinessRelationship(businessA.id, clientPhone);
      relId = rel.id;
    });

    const deleted = await queries.deleteClientBusinessRelationship(relId, businessB.id);
    expect(deleted).toBe(false);

    const stillExists = await db
      .select()
      .from(schema.clientBusinessRelationships)
      .where(eq(schema.clientBusinessRelationships.id, relId));
    expect(stillExists.length).toBe(1);
  });
});
