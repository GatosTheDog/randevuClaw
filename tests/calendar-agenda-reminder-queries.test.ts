// Phase 3 calendar-sync/agenda/reminder query layer tests. Same
// jest.mock('../src/database/db', ...) chain-builder mocking style as
// tests/fixtures.test.ts — none of these functions rely on a unique-index
// constraint to prove correctness, so a mocked db is sufficient (unlike
// tests/booking-queries.test.ts, which needs a real Postgres connection).

import {
  claimAgendaSlot,
  claimReminder24hSlot,
  claimReminder1hSlot,
  incrementCalendarSyncRetryCount,
  findBookingsNeedingCalendarSync,
  listBookingsForDate,
  findBookingsNeedingReminder,
} from '../src/database/queries';
import { db } from '../src/database/db';
import { bookings } from '../src/database/schema';

jest.mock('../src/database/db', () => ({
  db: {
    select: jest.fn(),
    update: jest.fn(),
  },
}));

interface SelectChain {
  from: jest.Mock;
  where: jest.Mock;
  orderBy: jest.Mock;
  then: (resolve: (value: unknown) => void) => void;
}

function makeSelectChain(result: unknown[]): SelectChain {
  const chain = {} as SelectChain;
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.orderBy = jest.fn().mockResolvedValue(result);
  // Makes the chain itself awaitable when no .orderBy() is chained.
  chain.then = (resolve) => resolve(result);
  return chain;
}

interface UpdateChain {
  set: jest.Mock;
  where: jest.Mock;
  returning: jest.Mock;
}

function makeUpdateChain(returningResult: unknown[]): UpdateChain {
  const chain = {} as UpdateChain;
  chain.set = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.returning = jest.fn().mockResolvedValue(returningResult);
  return chain;
}

const mockedDb = db as unknown as { select: jest.Mock; update: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('claimAgendaSlot', () => {
  it('Test 1: returns true when the UPDATE matches a still-eligible row', async () => {
    mockedDb.update.mockReturnValueOnce(makeUpdateChain([{ id: 1 }]));
    const result = await claimAgendaSlot(1, '2026-07-09');
    expect(result).toBe(true);
  });

  it('Test 2: returns false when the UPDATE matches zero rows (already claimed today)', async () => {
    mockedDb.update.mockReturnValueOnce(makeUpdateChain([]));
    const result = await claimAgendaSlot(1, '2026-07-09');
    expect(result).toBe(false);
  });
});

describe('claimReminder24hSlot / claimReminder1hSlot', () => {
  it('Test 3a: claimReminder24hSlot returns true on non-empty returning() and false on empty', async () => {
    mockedDb.update.mockReturnValueOnce(makeUpdateChain([{ id: 42 }]));
    expect(await claimReminder24hSlot(42)).toBe(true);

    mockedDb.update.mockReturnValueOnce(makeUpdateChain([]));
    expect(await claimReminder24hSlot(42)).toBe(false);
  });

  it('Test 3b: claimReminder1hSlot returns true on non-empty returning() and false on empty, independently of claimReminder24hSlot', async () => {
    mockedDb.update.mockReturnValueOnce(makeUpdateChain([{ id: 42 }]));
    expect(await claimReminder1hSlot(42)).toBe(true);

    mockedDb.update.mockReturnValueOnce(makeUpdateChain([]));
    expect(await claimReminder1hSlot(42)).toBe(false);
  });
});

describe('incrementCalendarSyncRetryCount', () => {
  it('Test 4: returns the numeric value of the returning() row calendarSyncRetryCount field', async () => {
    mockedDb.update.mockReturnValueOnce(makeUpdateChain([{ calendarSyncRetryCount: 3 }]));
    const result = await incrementCalendarSyncRetryCount(42);
    expect(result).toBe(3);
  });
});

describe('findBookingsNeedingCalendarSync', () => {
  it('Test 5: resolves to exactly the mocked select().from(bookings).where(...) result, invoked against bookings', async () => {
    const fakeRows = [{ id: 1 }, { id: 2 }];
    const chain = makeSelectChain(fakeRows);
    mockedDb.select.mockReturnValueOnce(chain);

    const result = await findBookingsNeedingCalendarSync(1);

    expect(result).toEqual(fakeRows);
    expect(chain.from).toHaveBeenCalledWith(bookings);
  });
});

describe('listBookingsForDate', () => {
  it("Test 6: called with no third argument resolves the mocked chain's result and invokes .orderBy", async () => {
    const fakeRows = [{ id: 1, calendarTime: '10:00' }];
    const chain = makeSelectChain(fakeRows);
    mockedDb.select.mockReturnValueOnce(chain);

    const result = await listBookingsForDate(1, '2026-07-09');

    expect(result).toEqual(fakeRows);
    expect(chain.orderBy).toHaveBeenCalled();
  });
});

describe('findBookingsNeedingReminder', () => {
  it('Test 7: resolves to the mocked chain result for a 2-element calendarDates array', async () => {
    const fakeRows = [{ id: 1 }, { id: 2 }];
    const chain = makeSelectChain(fakeRows);
    mockedDb.select.mockReturnValueOnce(chain);

    const result = await findBookingsNeedingReminder(1, ['2026-07-09', '2026-07-10']);

    expect(result).toEqual(fakeRows);
  });
});

// Regression coverage for a silent scope bug: runAgendaSweep's call to
// listBookingsForDate previously omitted the third `statuses` argument,
// silently falling back to listBookingsForDate's own ['confirmed'] default
// and excluding pending_owner_approval bookings from the 08:00 auto-push
// agenda -- unlike admin-menu.ts's showTodaysAgenda and ai-owner-agent.ts's
// view_todays_schedule case, which both pass ['confirmed',
// 'pending_owner_approval'] explicitly. This describe block mocks
// '../src/database/queries' and '../src/telegram/client' via
// jest.isolateModules + jest.doMock, scoped to this one test only, so it
// does not disturb this file's other describes (which deliberately mock
// only '../src/database/db' and exercise queries.ts's real implementations).
describe('runAgendaSweep status filter regression (agenda.ts)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // 2026-07-09T12:00:00Z = 15:00 Athens (UTC+3) -- well past the 08:00
    // AGENDA_HOUR_THRESHOLD bail-out gate, so the sweep proceeds to the
    // listBookingsForDate call under test.
    jest.setSystemTime(new Date('2026-07-09T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("Test 8: runAgendaSweep calls listBookingsForDate with ['confirmed', 'pending_owner_approval'] as the third argument", async () => {
    let mockedListBookingsForDate!: jest.Mock;
    let isolatedRunAgendaSweep!: () => Promise<number>;

    jest.isolateModules(() => {
      const claimAgendaSlot = jest.fn().mockResolvedValue(true);
      const findBusinessById = jest.fn().mockResolvedValue({
        id: 1,
        ownerTelegramId: 'owner1',
        botToken: 'test-bot-token',
      });
      const findServiceById = jest.fn().mockResolvedValue({ id: 2, name: 'Reformer Pilates' });
      const listAllBusinessIds = jest.fn().mockResolvedValue([1]);
      mockedListBookingsForDate = jest.fn().mockResolvedValue([
        { id: 42, businessId: 1, serviceId: 2, calendarTime: '10:00', clientPhone: 'c1' },
      ]);
      const sendTelegramMessage = jest.fn().mockResolvedValue({ messageId: 1 });
      const botTokenStoreRun = jest.fn((_token: string, fn: () => Promise<unknown>) => fn());

      jest.doMock('../src/database/queries', () => ({
        claimAgendaSlot,
        findBusinessById,
        findServiceById,
        listAllBusinessIds,
        listBookingsForDate: mockedListBookingsForDate,
      }));
      jest.doMock('../src/telegram/client', () => ({
        sendTelegramMessage,
        botTokenStore: { run: botTokenStoreRun },
      }));
      jest.doMock('../src/utils/logger', () => ({
        logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
      }));

      ({ runAgendaSweep: isolatedRunAgendaSweep } = require('../src/scheduler/agenda'));
    });

    await isolatedRunAgendaSweep();

    expect(mockedListBookingsForDate).toHaveBeenCalledWith(expect.anything(), expect.anything(), [
      'confirmed',
      'pending_owner_approval',
    ]);
  });

  it('shows resolved client name when a clientBusinessRelationship with clientName exists', async () => {
    let mockedSendTelegramMessage!: jest.Mock;
    let isolatedRunAgendaSweep!: () => Promise<number>;

    jest.isolateModules(() => {
      const claimAgendaSlot = jest.fn().mockResolvedValue(true);
      const findBusinessById = jest.fn().mockResolvedValue({
        id: 1,
        ownerTelegramId: 'owner1',
        botToken: 'test-bot-token',
      });
      const findServiceById = jest.fn().mockResolvedValue({ id: 2, name: 'Reformer Pilates' });
      const listAllBusinessIds = jest.fn().mockResolvedValue([1]);
      const listBookingsForDate = jest.fn().mockResolvedValue([
        { id: 42, businessId: 1, serviceId: 2, calendarTime: '10:00', clientPhone: 'c1' },
      ]);
      const findClientBusinessRelationship = jest.fn().mockResolvedValue({
        id: 1,
        businessId: 1,
        senderPhone: 'c1',
        clientName: 'Μαρία Παπαδοπούλου',
        consentGiven: true,
        consentTimestamp: new Date(),
        createdAt: new Date(),
      });
      mockedSendTelegramMessage = jest.fn().mockResolvedValue({ messageId: 1 });
      const botTokenStoreRun = jest.fn((_token: string, fn: () => Promise<unknown>) => fn());

      jest.doMock('../src/database/queries', () => ({
        claimAgendaSlot,
        findBusinessById,
        findClientBusinessRelationship,
        findServiceById,
        listAllBusinessIds,
        listBookingsForDate,
      }));
      jest.doMock('../src/telegram/client', () => ({
        sendTelegramMessage: mockedSendTelegramMessage,
        botTokenStore: { run: botTokenStoreRun },
      }));
      jest.doMock('../src/utils/logger', () => ({
        logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
      }));

      ({ runAgendaSweep: isolatedRunAgendaSweep } = require('../src/scheduler/agenda'));
    });

    await isolatedRunAgendaSweep();

    expect(mockedSendTelegramMessage).toHaveBeenCalledTimes(1);
    const message = mockedSendTelegramMessage.mock.calls[0][1] as string;
    expect(message).toContain('Μαρία Παπαδοπούλου');
    // Region-scope the negative check to the parenthesized client-name
    // segment of the line, since other fields in this fixture are not
    // phone-shaped and could otherwise produce a false positive.
    const clientSegmentMatch = message.match(/\(([^)]*)\)/);
    expect(clientSegmentMatch?.[1]).not.toBe('c1');
  });

  it('falls back to the raw phone when no clientBusinessRelationship exists', async () => {
    let mockedSendTelegramMessage!: jest.Mock;
    let isolatedRunAgendaSweep!: () => Promise<number>;

    jest.isolateModules(() => {
      const claimAgendaSlot = jest.fn().mockResolvedValue(true);
      const findBusinessById = jest.fn().mockResolvedValue({
        id: 1,
        ownerTelegramId: 'owner1',
        botToken: 'test-bot-token',
      });
      const findServiceById = jest.fn().mockResolvedValue({ id: 2, name: 'Reformer Pilates' });
      const listAllBusinessIds = jest.fn().mockResolvedValue([1]);
      const listBookingsForDate = jest.fn().mockResolvedValue([
        { id: 42, businessId: 1, serviceId: 2, calendarTime: '10:00', clientPhone: 'c1' },
      ]);
      const findClientBusinessRelationship = jest.fn().mockResolvedValue(null);
      mockedSendTelegramMessage = jest.fn().mockResolvedValue({ messageId: 1 });
      const botTokenStoreRun = jest.fn((_token: string, fn: () => Promise<unknown>) => fn());

      jest.doMock('../src/database/queries', () => ({
        claimAgendaSlot,
        findBusinessById,
        findClientBusinessRelationship,
        findServiceById,
        listAllBusinessIds,
        listBookingsForDate,
      }));
      jest.doMock('../src/telegram/client', () => ({
        sendTelegramMessage: mockedSendTelegramMessage,
        botTokenStore: { run: botTokenStoreRun },
      }));
      jest.doMock('../src/utils/logger', () => ({
        logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
      }));

      ({ runAgendaSweep: isolatedRunAgendaSweep } = require('../src/scheduler/agenda'));
    });

    await isolatedRunAgendaSweep();

    expect(mockedSendTelegramMessage).toHaveBeenCalledTimes(1);
    const message = mockedSendTelegramMessage.mock.calls[0][1] as string;
    expect(message).toContain('c1');
  });
});
