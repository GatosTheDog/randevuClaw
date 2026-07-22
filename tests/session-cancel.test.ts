// covers CLSS-03
// Integration tests for session cancellation and poller notification broadcast.
// cancelSession: marks isCancelled=true atomically, idempotent on replay.
// pollSessionCancellations: finds cancelled instances, sends Greek message per booked
// client, inserts dedup row preventing duplicate sends on re-run.
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

// Mock sendTelegramMessage before importing any module that uses it.
// jest.mock hoists to the top of the module scope; botTokenStore is mocked
// to call the callback synchronously, bypassing AsyncLocalStorage setup.
jest.mock('../src/telegram/client', () => ({
  sendTelegramMessage: jest.fn().mockResolvedValue({ messageId: 42 }),
  botTokenStore: {
    run: jest.fn().mockImplementation((_token: string, cb: () => Promise<unknown>) => cb()),
    getStore: jest.fn().mockReturnValue('test-bot-token'),
  },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const { db } = require('../src/database/db');
const { eq, and } = require('drizzle-orm');
const {
  sessionInstances,
  sessionCancellationNotifications,
  bookings,
  clientBusinessRelationships,
  services,
} = require('../src/database/schema');
const { cancelSession } = require('../src/session/manager');
const { pollSessionCancellations } = require('../src/scheduler/session-cancellation');
const telegramClient = require('../src/telegram/client');
const { insertTestBusiness } = require('./helpers/test-business');
const {
  insertTestSessionCatalog,
  insertTestSessionInstance,
} = require('./helpers/session-fixtures');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

describe('session cancellation and broadcast', () => {
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

    const catalog = await insertTestSessionCatalog(businessId, serviceId);
    catalogId = catalog.id;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-establish mock for botTokenStore.run after clearAllMocks
    telegramClient.botTokenStore.run.mockImplementation(
      (_token: string, cb: () => Promise<unknown>) => cb()
    );
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 42 });
  });

  it('cancel_session marks sessionInstance.isCancelled=true atomically', async () => {
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: '2099-10-01',
      idempotencyKey: `test:cancel:${catalogId}:${Date.now()}`,
    });

    // Verify it starts as not cancelled
    const beforeRows = await db
      .select({ isCancelled: sessionInstances.isCancelled })
      .from(sessionInstances)
      .where(eq(sessionInstances.id, instance.id));
    expect(beforeRows[0].isCancelled).toBe(false);

    const result = await cancelSession(businessId, instance.id);
    expect(result).toBe(true);

    // Verify isCancelled is now true
    const afterRows = await db
      .select({ isCancelled: sessionInstances.isCancelled })
      .from(sessionInstances)
      .where(eq(sessionInstances.id, instance.id));
    expect(afterRows[0].isCancelled).toBe(true);
  });

  it('cancel_session on already-cancelled instance is a no-op (idempotent, returns false)', async () => {
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: '2099-10-02',
      isCancelled: true,
      idempotencyKey: `test:idempotent-cancel:${catalogId}:${Date.now()}`,
    });

    // First call on an already-cancelled instance should return false
    const firstResult = await cancelSession(businessId, instance.id);
    expect(firstResult).toBe(false);

    // Second call also returns false (no-op, idempotent)
    const secondResult = await cancelSession(businessId, instance.id);
    expect(secondResult).toBe(false);
  });

  it('poller finds cancelled instances not yet notified and sends Greek message to each booked client', async () => {
    // Insert a cancelled session instance
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: '2099-10-03',
      isCancelled: true,
      idempotencyKey: `test:poller:${catalogId}:${Date.now()}`,
    });

    // Insert 2 booked clients — also insert clientBusinessRelationships rows
    // since the poller JOINs on that table
    const clientA = `poller-client-a-${Date.now()}`;
    const clientB = `poller-client-b-${Date.now()}`;

    // Insert clientBusinessRelationships for both clients
    await db.insert(clientBusinessRelationships).values([
      { businessId, senderPhone: clientA },
      { businessId, senderPhone: clientB },
    ]);

    // Insert confirmed booking rows for both clients.
    // Use distinct calendarTime values to avoid the unique_active_slot_per_business
    // partial index (businessId, calendarDate, calendarTime) — designed for open_slots
    // mode where one client owns a slot; session mode books clients independently.
    await db.insert(bookings).values([
      {
        businessId,
        clientPhone: clientA,
        serviceId,
        sessionInstanceId: instance.id,
        calendarDate: '2099-10-03',
        calendarTime: '10:00',
        bookingStatus: 'confirmed',
        requestId: `poller-a:${instance.id}:${clientA}`,
        expiresAt: null,
      },
      {
        businessId,
        clientPhone: clientB,
        serviceId,
        sessionInstanceId: instance.id,
        calendarDate: '2099-10-03',
        calendarTime: '10:01',
        bookingStatus: 'confirmed',
        requestId: `poller-b:${instance.id}:${clientB}`,
        expiresAt: null,
      },
    ]);

    const notificationCount = await pollSessionCancellations();

    // sendTelegramMessage should have been called once per booked client
    expect(telegramClient.sendTelegramMessage).toHaveBeenCalledTimes(2);
    expect(notificationCount).toBeGreaterThanOrEqual(2);

    // Both calls should include the Greek cancellation message
    const calls = telegramClient.sendTelegramMessage.mock.calls;
    const clients = calls.map((c: [string, string]) => c[0]);
    expect(clients).toContain(clientA);
    expect(clients).toContain(clientB);
    const messages = calls.map((c: [string, string]) => c[1]);
    messages.forEach((msg: string) => {
      expect(msg).toContain('ακυρώθηκε');
    });

    // Verify dedup row was inserted
    const dedupRows = await db
      .select()
      .from(sessionCancellationNotifications)
      .where(eq(sessionCancellationNotifications.sessionInstanceId, instance.id));
    expect(dedupRows).toHaveLength(1);
  });

  it('poller dedup: sessionCancellationNotifications row prevents second notification send on poller re-run', async () => {
    // Insert a cancelled session instance
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: '2099-10-04',
      isCancelled: true,
      idempotencyKey: `test:dedup:${catalogId}:${Date.now()}`,
    });

    const clientC = `dedup-client-c-${Date.now()}`;
    await db.insert(clientBusinessRelationships).values({ businessId, senderPhone: clientC });
    await db.insert(bookings).values({
      businessId,
      clientPhone: clientC,
      serviceId,
      sessionInstanceId: instance.id,
      calendarDate: '2099-10-04',
      calendarTime: '10:00',
      bookingStatus: 'confirmed',
      requestId: `dedup-c:${instance.id}:${clientC}`,
      expiresAt: null,
    });

    // First poller run — sends notification + inserts dedup row
    await pollSessionCancellations();
    const firstCallCount = (telegramClient.sendTelegramMessage as jest.Mock).mock.calls.length;
    expect(firstCallCount).toBeGreaterThanOrEqual(1);

    // Reset call count between runs
    jest.clearAllMocks();
    telegramClient.botTokenStore.run.mockImplementation(
      (_token: string, cb: () => Promise<unknown>) => cb()
    );
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 42 });

    // Second poller run — dedup row exists, sendTelegramMessage must NOT be called again
    await pollSessionCancellations();
    // The dedup row blocks all notifications for this instance
    expect(telegramClient.sendTelegramMessage).not.toHaveBeenCalledWith(
      clientC,
      expect.stringContaining('ακυρώθηκε')
    );
  });

  it('poller partial failure: one client send failure does not block other clients in same session', async () => {
    // Insert a cancelled session instance
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: '2099-10-05',
      isCancelled: true,
      idempotencyKey: `test:partial-fail:${catalogId}:${Date.now()}`,
    });

    const clientD = `partial-client-d-${Date.now()}`;
    const clientE = `partial-client-e-${Date.now()}`;

    await db.insert(clientBusinessRelationships).values([
      { businessId, senderPhone: clientD },
      { businessId, senderPhone: clientE },
    ]);

    await db.insert(bookings).values([
      {
        businessId,
        clientPhone: clientD,
        serviceId,
        sessionInstanceId: instance.id,
        calendarDate: '2099-10-05',
        calendarTime: '10:00',
        bookingStatus: 'confirmed',
        requestId: `partial-d:${instance.id}:${clientD}`,
        expiresAt: null,
      },
      {
        businessId,
        clientPhone: clientE,
        serviceId,
        sessionInstanceId: instance.id,
        calendarDate: '2099-10-05',
        calendarTime: '10:01', // distinct time to avoid unique_active_slot_per_business
        bookingStatus: 'confirmed',
        requestId: `partial-e:${instance.id}:${clientE}`,
        expiresAt: null,
      },
    ]);

    // Mock sendTelegramMessage to throw on the first call, succeed on the second
    let callCount = 0;
    telegramClient.sendTelegramMessage.mockImplementation(async (_chatId: string, _msg: string) => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('Telegram API error: 403 Forbidden');
      }
      return { messageId: 99 };
    });

    // Poller must not throw even though one client send fails
    await expect(pollSessionCancellations()).resolves.not.toThrow();

    // Both clients were attempted (2 sendTelegramMessage calls)
    expect(telegramClient.sendTelegramMessage).toHaveBeenCalledTimes(2);

    // Dedup row is still inserted despite the partial failure
    const dedupRows = await db
      .select()
      .from(sessionCancellationNotifications)
      .where(eq(sessionCancellationNotifications.sessionInstanceId, instance.id));
    expect(dedupRows).toHaveLength(1);
  });
});
