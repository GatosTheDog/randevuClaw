import { pool, appPool } from '../src/database/db';
import { logger } from '../src/utils/logger';
import { runKeepAlivePing, startKeepAlivePoller } from '../src/database/keepalive';

jest.mock('../src/database/db', () => ({
  pool: { query: jest.fn() },
  appPool: { query: jest.fn() },
}));
jest.mock('../src/utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn() },
}));

const mockedPoolQuery = pool.query as unknown as jest.Mock;
const mockedAppPoolQuery = appPool.query as unknown as jest.Mock;
const mockedWarn = logger.warn as jest.MockedFunction<typeof logger.warn>;
const mockedError = logger.error as jest.MockedFunction<typeof logger.error>;

describe('runKeepAlivePing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('both pools resolve -> pings both pools exactly once each, never logs', async () => {
    mockedPoolQuery.mockResolvedValue(undefined);
    mockedAppPoolQuery.mockResolvedValue(undefined);

    await runKeepAlivePing();

    expect(mockedPoolQuery).toHaveBeenCalledTimes(1);
    expect(mockedPoolQuery).toHaveBeenCalledWith('SELECT 1');
    expect(mockedAppPoolQuery).toHaveBeenCalledTimes(1);
    expect(mockedAppPoolQuery).toHaveBeenCalledWith('SELECT 1');
    expect(mockedWarn).not.toHaveBeenCalled();
    expect(mockedError).not.toHaveBeenCalled();
  });

  it('admin pool rejects, app pool resolves -> app pool still pinged (isolation), resolves, warns once', async () => {
    mockedPoolQuery.mockRejectedValue(new Error('Connection terminated unexpectedly'));
    mockedAppPoolQuery.mockResolvedValue(undefined);

    await expect(runKeepAlivePing()).resolves.toBeUndefined();

    expect(mockedAppPoolQuery).toHaveBeenCalledTimes(1);
    expect(mockedWarn).toHaveBeenCalledTimes(1);
  });

  it('both pools reject -> still resolves, warns twice', async () => {
    mockedPoolQuery.mockRejectedValue(new Error('Connection terminated unexpectedly'));
    mockedAppPoolQuery.mockRejectedValue(new Error('Connection terminated unexpectedly'));

    await expect(runKeepAlivePing()).resolves.toBeUndefined();

    expect(mockedWarn).toHaveBeenCalledTimes(2);
  });
});

describe('startKeepAlivePoller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockedPoolQuery.mockResolvedValue(undefined);
    mockedAppPoolQuery.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('schedules runKeepAlivePing repeatedly at the given interval, and stops when cleared', async () => {
    const handle = startKeepAlivePoller(1000);

    await jest.advanceTimersByTimeAsync(3000);
    expect(mockedPoolQuery).toHaveBeenCalledTimes(3);

    clearInterval(handle);
    await jest.advanceTimersByTimeAsync(3000);
    expect(mockedPoolQuery).toHaveBeenCalledTimes(3);
  });

  it('defaults to a 90000ms interval when called with no argument', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    const handle = startKeepAlivePoller();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 90000);
    clearInterval(handle);
  });
});
