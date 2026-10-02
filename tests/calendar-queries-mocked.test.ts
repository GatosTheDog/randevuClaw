// Phase 25.1 (plan 01) Postgres-free tests for the new calendar-connect query
// helpers and for the getConn() transaction-join fix (T-25.1-07). Real-SQL
// behaviour (atomic single-use DELETE, expiry, sweep predicates) is covered by
// tests/calendar-queries.test.ts, which needs a local Postgres.

import {
  claimGoogleCalendarNudge,
  clearBusinessGoogleRefreshToken,
  consumeGoogleOauthState,
  findBookingsNeedingCalendarSync,
  incrementCalendarSyncRetryCount,
  updateBookingGoogleEventId,
  updateCalendarSyncStatus,
  withBusinessContext,
} from '../src/database/queries';
import { db, runInTransaction } from '../src/database/db';

jest.mock('../src/database/db', () => {
  const fakeTx = {
    execute: jest.fn().mockResolvedValue(undefined),
    update: jest.fn(),
  };
  return {
    db: {
      select: jest.fn(),
      update: jest.fn(),
      insert: jest.fn(),
      delete: jest.fn(),
    },
    appPool: {},
    __fakeTx: fakeTx,
    runInTransaction: jest.fn((_pool: unknown, cb: (tx: unknown) => Promise<unknown>) =>
      cb(fakeTx)
    ),
  };
});

const mockedDb = db as unknown as {
  select: jest.Mock;
  update: jest.Mock;
  insert: jest.Mock;
  delete: jest.Mock;
};
const fakeTx = (jest.requireMock('../src/database/db') as { __fakeTx: { execute: jest.Mock; update: jest.Mock } })
  .__fakeTx;
const mockedRunInTransaction = runInTransaction as unknown as jest.Mock;

// Thenable chain: awaiting it directly or after .returning() both resolve.
interface WriteChain {
  set: jest.Mock;
  where: jest.Mock;
  returning: jest.Mock;
  then: (resolve: (value: unknown) => void) => void;
}

function makeWriteChain(returningResult: unknown[]): WriteChain {
  const chain = {} as WriteChain;
  chain.set = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.returning = jest.fn().mockResolvedValue(returningResult);
  chain.then = (resolve) => resolve(undefined);
  return chain;
}

beforeEach(() => {
  jest.clearAllMocks();
  fakeTx.execute.mockResolvedValue(undefined);
  mockedRunInTransaction.mockImplementation((_pool, cb) => cb(fakeTx));
});

describe('claimGoogleCalendarNudge', () => {
  it('Test 1: true when the UPDATE returns a row, false when it returns none', async () => {
    mockedDb.update.mockReturnValueOnce(makeWriteChain([{ id: 1 }]));
    expect(await claimGoogleCalendarNudge(1)).toBe(true);

    mockedDb.update.mockReturnValueOnce(makeWriteChain([]));
    expect(await claimGoogleCalendarNudge(1)).toBe(false);
  });
});

describe('clearBusinessGoogleRefreshToken', () => {
  it('Test 2: true only when a token was actually cleared', async () => {
    mockedDb.update.mockReturnValueOnce(makeWriteChain([{ id: 1 }]));
    expect(await clearBusinessGoogleRefreshToken(1)).toBe(true);

    mockedDb.update.mockReturnValueOnce(makeWriteChain([]));
    expect(await clearBusinessGoogleRefreshToken(1)).toBe(false);
  });
});

describe('consumeGoogleOauthState', () => {
  it('Test 3: resolves the bound businessId when the DELETE returns a row, otherwise null', async () => {
    mockedDb.delete.mockReturnValueOnce(makeWriteChain([{ businessId: 7 }]));
    expect(await consumeGoogleOauthState('hash-a')).toBe(7);

    mockedDb.delete.mockReturnValueOnce(makeWriteChain([]));
    expect(await consumeGoogleOauthState('hash-a')).toBeNull();
  });
});

describe('calendar status writes join the webhook transaction (T-25.1-07)', () => {
  it('Test 4: inside withBusinessContext all three go through the tx, never the admin db', async () => {
    fakeTx.update
      .mockReturnValueOnce(makeWriteChain([]))
      .mockReturnValueOnce(makeWriteChain([]))
      .mockReturnValueOnce(makeWriteChain([{ calendarSyncRetryCount: 2 }]));

    const count = await withBusinessContext(1, async () => {
      await updateCalendarSyncStatus(10, 'synced');
      await updateBookingGoogleEventId(10, 'evt-1');
      return incrementCalendarSyncRetryCount(10);
    });

    expect(count).toBe(2);
    expect(fakeTx.update).toHaveBeenCalledTimes(3);
    expect(mockedDb.update).not.toHaveBeenCalled();
  });

  it('Test 5: outside withBusinessContext the same three use the admin db', async () => {
    mockedDb.update
      .mockReturnValueOnce(makeWriteChain([]))
      .mockReturnValueOnce(makeWriteChain([]))
      .mockReturnValueOnce(makeWriteChain([{ calendarSyncRetryCount: 5 }]));

    await updateCalendarSyncStatus(10, 'failed');
    await updateBookingGoogleEventId(10, 'evt-2');
    const count = await incrementCalendarSyncRetryCount(10);

    expect(count).toBe(5);
    expect(mockedDb.update).toHaveBeenCalledTimes(3);
    expect(fakeTx.update).not.toHaveBeenCalled();
  });
});

describe('findBookingsNeedingCalendarSync', () => {
  it('Test 6: ends with a .limit(50) call by default and honours an explicit limit', async () => {
    const rows = [{ id: 1 }];
    const chain = {} as {
      from: jest.Mock;
      where: jest.Mock;
      orderBy: jest.Mock;
      limit: jest.Mock;
    };
    chain.from = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockReturnValue(chain);
    chain.orderBy = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockResolvedValue(rows);
    mockedDb.select.mockReturnValue(chain);

    expect(await findBookingsNeedingCalendarSync(1, '2026-07-09')).toEqual(rows);
    expect(chain.limit).toHaveBeenLastCalledWith(50);

    await findBookingsNeedingCalendarSync(1, '2026-07-09', 5);
    expect(chain.limit).toHaveBeenLastCalledWith(5);
    expect(chain.orderBy).toHaveBeenCalled();
  });
});
