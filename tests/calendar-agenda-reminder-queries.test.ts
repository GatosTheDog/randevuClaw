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
