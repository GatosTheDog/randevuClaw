// covers CLSS-07
// Real-DB integration tests for cascadeCancelSessionBookings — Phase 23 Plan 01.
// Covers status flip, idempotent credit restore (incl. unlimited-membership
// skip), capacity release, Greek business-initiated notification wording,
// cross-tenant scoping (T-23-01), idempotent replay (T-23-02), and
// per-client notification isolation (T-23-03).
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
  bookings,
  memberships,
  membershipLedger,
  services,
} = require('../src/database/schema');
const { cascadeCancelSessionBookings } = require('../src/session/manager');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestPackage, insertTestMembership } = require('./helpers/billing-fixtures');
const {
  insertTestSessionCatalog,
  insertTestSessionInstance,
  insertTestSessionBooking,
} = require('./helpers/session-fixtures');
const telegramClient = require('../src/telegram/client');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function getBookingStatus(bookingId: number): Promise<string> {
  const rows = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  return rows[0].bookingStatus as string;
}

function uniquePhone(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function insertDeductionLedgerRow(membershipId: number, bookingId: number): Promise<void> {
  await db.insert(membershipLedger).values({
    membershipId,
    bookingId,
    operationType: 'session_deducted',
    sessionsDeducted: 1,
    idempotencyKey: `test-cascade-deduct-${bookingId}-${Date.now()}-${Math.random()}`,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  telegramClient.botTokenStore.run.mockImplementation(
    (_token: string, cb: () => Promise<unknown>) => cb()
  );
  telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 42 });
});

describe('cascadeCancelSessionBookings (CLSS-07)', () => {
  let business: any;
  let serviceId: number;
  let catalogId: number;

  beforeAll(async () => {
    business = await insertTestBusiness();
    serviceId = await getTestServiceId(business.id);
    const catalog = await insertTestSessionCatalog(business.id, serviceId, { capacity: 5 });
    catalogId = catalog.id;
  });

  it('(a) cascade-cancels all active bookings for the instance: status flip, credit restore, capacity release', async () => {
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: '2099-08-01',
      bookedCount: 2,
      idempotencyKey: `cascade-a:${catalogId}:${Date.now()}`,
    });

    const pkg = await insertTestPackage(business.id, { name: `Cascade-A pkg ${Date.now()}`, sessionCount: 10 });

    const clientA = uniquePhone('cascade-a-client-a');
    const membershipA = await insertTestMembership(business.id, clientA, pkg.id, { sessionsRemaining: 4 });
    const bookingA = await insertTestSessionBooking(business.id, instance.id, clientA, serviceId, {
      bookingStatus: 'confirmed',
      calendarTime: '11:01',
    });
    await insertDeductionLedgerRow(membershipA.id, bookingA.id);

    const clientB = uniquePhone('cascade-a-client-b');
    const membershipB = await insertTestMembership(business.id, clientB, pkg.id, { sessionsRemaining: 7 });
    const bookingB = await insertTestSessionBooking(business.id, instance.id, clientB, serviceId, {
      bookingStatus: 'pending_owner_approval',
      calendarTime: '11:02',
    });
    await insertDeductionLedgerRow(membershipB.id, bookingB.id);

    const result = await cascadeCancelSessionBookings(business, instance.id);

    expect(result).toBe(2);
    expect(await getBookingStatus(bookingA.id)).toBe('cancelled');
    expect(await getBookingStatus(bookingB.id)).toBe('cancelled');
    expect(await getSessionsRemaining(membershipA.id)).toBe(5);
    expect(await getSessionsRemaining(membershipB.id)).toBe(8);
    expect(await getBookedCount(instance.id)).toBe(0);
  });

  it('(b) unlimited membership (sessionsRemaining null) is silently skipped — booking still cancelled, capacity still released', async () => {
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: '2099-08-02',
      bookedCount: 1,
      idempotencyKey: `cascade-b:${catalogId}:${Date.now()}`,
    });

    const pkg = await insertTestPackage(business.id, { name: `Cascade-B pkg ${Date.now()}`, sessionCount: null });
    const client = uniquePhone('cascade-b-client');
    // Unlimited membership: sessionsRemaining null, deliberately NO session_deducted ledger row.
    const membership = await insertTestMembership(business.id, client, pkg.id, { sessionsRemaining: null });
    const booking = await insertTestSessionBooking(business.id, instance.id, client, serviceId, {
      bookingStatus: 'confirmed',
      calendarTime: '11:03',
    });

    const result = await cascadeCancelSessionBookings(business, instance.id);

    expect(result).toBe(1);
    expect(await getBookingStatus(booking.id)).toBe('cancelled');
    expect(await getBookedCount(instance.id)).toBe(0);
    expect(await getSessionsRemaining(membership.id)).toBe(null);

    const restoredRows = await db
      .select()
      .from(membershipLedger)
      .where(
        and(
          eq(membershipLedger.bookingId, booking.id),
          eq(membershipLedger.operationType, 'credit_restored')
        )
      );
    expect(restoredRows).toHaveLength(0);
  });

  it('(c) sends a Greek business-initiated notification per booking, distinct from the poller wording', async () => {
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: '2099-08-03',
      bookedCount: 2,
      idempotencyKey: `cascade-c:${catalogId}:${Date.now()}`,
    });

    const client1 = uniquePhone('cascade-c-client-1');
    const client2 = uniquePhone('cascade-c-client-2');
    await insertTestSessionBooking(business.id, instance.id, client1, serviceId, {
      bookingStatus: 'confirmed',
      calendarTime: '11:04',
    });
    await insertTestSessionBooking(business.id, instance.id, client2, serviceId, {
      bookingStatus: 'confirmed',
      calendarTime: '11:05',
    });

    const result = await cascadeCancelSessionBookings(business, instance.id);

    expect(result).toBe(2);
    expect(telegramClient.sendTelegramMessage).toHaveBeenCalledTimes(2);
    const messages = telegramClient.sendTelegramMessage.mock.calls.map((c: [string, string]) => c[1]);
    messages.forEach((msg: string) => {
      expect(msg).toContain('ακυρώθηκε από την επιχείρηση');
      expect(msg).not.toContain('επικοινωνήστε μαζί μας');
    });
  });

  it('(d) cross-tenant scoping (T-23-01): cascade-cancelling one business instance never touches another business', async () => {
    const otherBusiness = await insertTestBusiness();
    const otherServiceId = await getTestServiceId(otherBusiness.id);
    const otherCatalog = await insertTestSessionCatalog(otherBusiness.id, otherServiceId, { capacity: 5 });
    const otherInstance = await insertTestSessionInstance(otherCatalog.id, {
      bookedCount: 1,
      idempotencyKey: `cascade-d-other:${otherCatalog.id}:${Date.now()}`,
    });
    const otherPkg = await insertTestPackage(otherBusiness.id, { name: `Cascade-D other pkg ${Date.now()}`, sessionCount: 10 });
    const otherClient = uniquePhone('cascade-d-other-client');
    const otherMembership = await insertTestMembership(otherBusiness.id, otherClient, otherPkg.id, { sessionsRemaining: 3 });
    const otherBooking = await insertTestSessionBooking(otherBusiness.id, otherInstance.id, otherClient, otherServiceId, {
      bookingStatus: 'confirmed',
    });
    await insertDeductionLedgerRow(otherMembership.id, otherBooking.id);

    const ourInstance = await insertTestSessionInstance(catalogId, {
      sessionDate: '2099-08-04',
      bookedCount: 1,
      idempotencyKey: `cascade-d-ours:${catalogId}:${Date.now()}`,
    });
    const ourClient = uniquePhone('cascade-d-our-client');
    const ourBooking = await insertTestSessionBooking(business.id, ourInstance.id, ourClient, serviceId, {
      bookingStatus: 'confirmed',
      calendarTime: '11:06',
    });

    const result = await cascadeCancelSessionBookings(business, ourInstance.id);

    expect(result).toBe(1);
    expect(await getBookingStatus(ourBooking.id)).toBe('cancelled');

    // The other business's booking/membership/capacity must be completely untouched.
    expect(await getBookingStatus(otherBooking.id)).toBe('confirmed');
    expect(await getSessionsRemaining(otherMembership.id)).toBe(3);
    expect(await getBookedCount(otherInstance.id)).toBe(1);
  });

  it('(e) zero-booking instance: returns 0 and sends no notification', async () => {
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: '2099-08-05',
      bookedCount: 0,
      idempotencyKey: `cascade-e:${catalogId}:${Date.now()}`,
    });

    const result = await cascadeCancelSessionBookings(business, instance.id);

    expect(result).toBe(0);
    expect(telegramClient.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it('(f) idempotent replay (T-23-02): a second call on the same instance is a safe no-op', async () => {
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: '2099-08-06',
      bookedCount: 1,
      idempotencyKey: `cascade-f:${catalogId}:${Date.now()}`,
    });

    const pkg = await insertTestPackage(business.id, { name: `Cascade-F pkg ${Date.now()}`, sessionCount: 10 });
    const client = uniquePhone('cascade-f-client');
    const membership = await insertTestMembership(business.id, client, pkg.id, { sessionsRemaining: 4 });
    const booking = await insertTestSessionBooking(business.id, instance.id, client, serviceId, {
      bookingStatus: 'confirmed',
      calendarTime: '11:07',
    });
    await insertDeductionLedgerRow(membership.id, booking.id);

    const firstResult = await cascadeCancelSessionBookings(business, instance.id);
    expect(firstResult).toBeGreaterThan(0);

    const remainingAfterFirst = await getSessionsRemaining(membership.id);
    const bookedCountAfterFirst = await getBookedCount(instance.id);

    const secondResult = await cascadeCancelSessionBookings(business, instance.id);
    expect(secondResult).toBe(0);

    expect(await getSessionsRemaining(membership.id)).toBe(remainingAfterFirst);
    expect(await getBookedCount(instance.id)).toBe(bookedCountAfterFirst);
  });

  it('(g) per-client notification isolation (T-23-03): one failed send never blocks processing of the other bookings', async () => {
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: '2099-08-07',
      bookedCount: 2,
      idempotencyKey: `cascade-g:${catalogId}:${Date.now()}`,
    });

    const pkg = await insertTestPackage(business.id, { name: `Cascade-G pkg ${Date.now()}`, sessionCount: 10 });

    const clientA = uniquePhone('cascade-g-client-a');
    const membershipA = await insertTestMembership(business.id, clientA, pkg.id, { sessionsRemaining: 5 });
    const bookingA = await insertTestSessionBooking(business.id, instance.id, clientA, serviceId, {
      bookingStatus: 'confirmed',
      calendarTime: '11:08',
    });
    await insertDeductionLedgerRow(membershipA.id, bookingA.id);

    const clientB = uniquePhone('cascade-g-client-b');
    const membershipB = await insertTestMembership(business.id, clientB, pkg.id, { sessionsRemaining: 6 });
    const bookingB = await insertTestSessionBooking(business.id, instance.id, clientB, serviceId, {
      bookingStatus: 'confirmed',
      calendarTime: '11:09',
    });
    await insertDeductionLedgerRow(membershipB.id, bookingB.id);

    let callCount = 0;
    telegramClient.sendTelegramMessage.mockImplementation(async (_chatId: string, _msg: string) => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('Telegram API error: 403 Forbidden');
      }
      return { messageId: 99 };
    });

    await expect(cascadeCancelSessionBookings(business, instance.id)).resolves.not.toThrow();

    expect(telegramClient.sendTelegramMessage).toHaveBeenCalledTimes(2);
    expect(await getBookingStatus(bookingA.id)).toBe('cancelled');
    expect(await getBookingStatus(bookingB.id)).toBe('cancelled');
    expect(await getSessionsRemaining(membershipA.id)).toBe(6);
    expect(await getSessionsRemaining(membershipB.id)).toBe(7);
    expect(await getBookedCount(instance.id)).toBe(0);
  });
});
