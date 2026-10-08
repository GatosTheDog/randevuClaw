import * as queries from '../src/database/queries';
import * as sync from '../src/calendar/sync';
import { logger } from '../src/utils/logger';
import { runCalendarSyncSweep, startCalendarSyncPoller } from '../src/calendar/poller';
import { makeBooking, makeBusiness, makeService } from './helpers/calendar-fixtures';

jest.mock('../src/database/queries');
jest.mock('../src/calendar/sync');
jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const mockedListAllBusinessIds = queries.listAllBusinessIds as jest.MockedFunction<
  typeof queries.listAllBusinessIds
>;
const mockedFindBusinessById = queries.findBusinessById as jest.MockedFunction<
  typeof queries.findBusinessById
>;
const mockedFindServiceById = queries.findServiceById as jest.MockedFunction<
  typeof queries.findServiceById
>;
const mockedFindBookingsNeedingCalendarSync = queries.findBookingsNeedingCalendarSync as jest.MockedFunction<
  typeof queries.findBookingsNeedingCalendarSync
>;
const mockedIncrementCalendarSyncRetryCount = queries.incrementCalendarSyncRetryCount as jest.MockedFunction<
  typeof queries.incrementCalendarSyncRetryCount
>;
const mockedUpdateCalendarSyncStatus = queries.updateCalendarSyncStatus as jest.MockedFunction<
  typeof queries.updateCalendarSyncStatus
>;
const mockedSyncBookingToCalendar = sync.syncBookingToCalendar as jest.MockedFunction<
  typeof sync.syncBookingToCalendar
>;
const mockedDeleteBookingFromCalendar = sync.deleteBookingFromCalendar as jest.MockedFunction<
  typeof sync.deleteBookingFromCalendar
>;

const SERVICE = makeService();

describe('runCalendarSyncSweep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFindServiceById.mockResolvedValue(SERVICE);
  });

  it('Test 1: skips a business with googleRefreshToken null entirely (no findBookingsNeedingCalendarSync call)', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1, 2]);
    mockedFindBusinessById.mockImplementation(async (id: number) =>
      id === 1 ? makeBusiness({ id: 1, googleRefreshToken: 'rt' }) : makeBusiness({ id: 2, googleRefreshToken: null })
    );
    mockedFindBookingsNeedingCalendarSync.mockResolvedValue([]);

    await runCalendarSyncSweep();

    expect(mockedListAllBusinessIds).toHaveBeenCalledTimes(1);
    expect(mockedFindBookingsNeedingCalendarSync).toHaveBeenCalledWith(1, expect.any(String));
    expect(mockedFindBookingsNeedingCalendarSync).not.toHaveBeenCalledWith(2, expect.anything());
  });

  it('Test 2a: confirmed candidate -> findServiceById + syncBookingToCalendar; success -> no increment, counted', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1]);
    mockedFindBusinessById.mockResolvedValue(makeBusiness());
    const booking = makeBooking({ bookingStatus: 'confirmed' });
    mockedFindBookingsNeedingCalendarSync.mockResolvedValue([booking]);
    mockedSyncBookingToCalendar.mockResolvedValue(true);

    const count = await runCalendarSyncSweep();

    expect(mockedFindServiceById).toHaveBeenCalledWith(1, 2);
    expect(mockedSyncBookingToCalendar).toHaveBeenCalledWith(booking, expect.objectContaining({ id: 1 }), SERVICE);
    expect(mockedDeleteBookingFromCalendar).not.toHaveBeenCalled();
    expect(mockedIncrementCalendarSyncRetryCount).not.toHaveBeenCalled();
    expect(count).toBe(1);
  });

  it('Test 2b: cancelled candidate -> deleteBookingFromCalendar instead; success -> no increment, counted', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1]);
    mockedFindBusinessById.mockResolvedValue(makeBusiness());
    const booking = makeBooking({ bookingStatus: 'cancelled' });
    mockedFindBookingsNeedingCalendarSync.mockResolvedValue([booking]);
    mockedDeleteBookingFromCalendar.mockResolvedValue(true);

    const count = await runCalendarSyncSweep();

    expect(mockedDeleteBookingFromCalendar).toHaveBeenCalledWith(booking, expect.objectContaining({ id: 1 }));
    expect(mockedSyncBookingToCalendar).not.toHaveBeenCalled();
    expect(mockedIncrementCalendarSyncRetryCount).not.toHaveBeenCalled();
    expect(count).toBe(1);
  });

  it('Test 3: failed attempt with retryCount < 10 -> updateCalendarSyncStatus(...,"failed") NOT called (still retrying)', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1]);
    mockedFindBusinessById.mockResolvedValue(makeBusiness());
    const booking = makeBooking({ bookingStatus: 'confirmed' });
    mockedFindBookingsNeedingCalendarSync.mockResolvedValue([booking]);
    mockedSyncBookingToCalendar.mockResolvedValue(false);
    mockedIncrementCalendarSyncRetryCount.mockResolvedValue(3);

    const count = await runCalendarSyncSweep();

    expect(mockedIncrementCalendarSyncRetryCount).toHaveBeenCalledWith(42);
    expect(mockedUpdateCalendarSyncStatus).not.toHaveBeenCalledWith(42, 'failed');
    expect(count).toBe(0);
  });

  it('Test 4: failed attempt with retryCount >= 10 -> updateCalendarSyncStatus(...,"failed") IS called (permanent abandonment), not counted as synced', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1]);
    mockedFindBusinessById.mockResolvedValue(makeBusiness());
    const booking = makeBooking({ bookingStatus: 'confirmed' });
    mockedFindBookingsNeedingCalendarSync.mockResolvedValue([booking]);
    mockedSyncBookingToCalendar.mockResolvedValue(false);
    mockedIncrementCalendarSyncRetryCount.mockResolvedValue(10);

    const count = await runCalendarSyncSweep();

    expect(mockedUpdateCalendarSyncStatus).toHaveBeenCalledWith(42, 'failed');
    expect(count).toBe(0);
  });

  it('Test 5: one business failing does not stop the sweep from processing the next business (error isolation)', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1, 2]);
    mockedFindBusinessById.mockResolvedValue(makeBusiness());
    mockedFindBookingsNeedingCalendarSync.mockImplementation(async (businessId: number) => {
      if (businessId === 1) throw new Error('db down');
      return [];
    });

    await expect(runCalendarSyncSweep()).resolves.toBe(0);
    expect(mockedFindBookingsNeedingCalendarSync).toHaveBeenCalledWith(2, expect.any(String));
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('runCalendarSyncSweep (phase 25.1 additions)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFindServiceById.mockResolvedValue(SERVICE);
  });

  it('Test 13: queries with the business id and today in Athens (ISO date)', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1]);
    mockedFindBusinessById.mockResolvedValue(makeBusiness());
    mockedFindBookingsNeedingCalendarSync.mockResolvedValue([]);

    await runCalendarSyncSweep();

    expect(mockedFindBookingsNeedingCalendarSync).toHaveBeenCalledWith(1, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it('Test 14: a confirmed session booking is synced with its service', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1]);
    mockedFindBusinessById.mockResolvedValue(makeBusiness());
    const booking = makeBooking({ sessionInstanceId: 100, serviceId: 7 });
    mockedFindBookingsNeedingCalendarSync.mockResolvedValue([booking]);
    mockedSyncBookingToCalendar.mockResolvedValue(true);

    await runCalendarSyncSweep();

    expect(mockedFindServiceById).toHaveBeenCalledWith(1, 7);
    expect(mockedSyncBookingToCalendar).toHaveBeenCalledWith(booking, expect.objectContaining({ id: 1 }), SERVICE);
  });

  it('Test 15: token cleared mid-sweep stops that business without incrementing retries, next business still runs', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1, 2]);
    let business1Reads = 0;
    mockedFindBusinessById.mockImplementation(async (id: number) => {
      if (id === 1) {
        business1Reads += 1;
        // First read (sweep start) has a token; later reads (after failure) do not.
        return makeBusiness({ id: 1, googleRefreshToken: business1Reads === 1 ? 'rt' : null });
      }
      return makeBusiness({ id: 2 });
    });
    const b1a = makeBooking({ id: 10, businessId: 1 });
    const b1b = makeBooking({ id: 11, businessId: 1 });
    const b2 = makeBooking({ id: 20, businessId: 2 });
    mockedFindBookingsNeedingCalendarSync.mockImplementation(async (businessId: number) =>
      businessId === 1 ? [b1a, b1b] : [b2]
    );
    mockedSyncBookingToCalendar.mockImplementation(async (booking) => booking.id === 20);

    const count = await runCalendarSyncSweep();

    expect(mockedSyncBookingToCalendar).toHaveBeenCalledTimes(2);
    expect(mockedSyncBookingToCalendar).not.toHaveBeenCalledWith(b1b, expect.anything(), expect.anything());
    expect(mockedIncrementCalendarSyncRetryCount).not.toHaveBeenCalled();
    expect(mockedSyncBookingToCalendar).toHaveBeenCalledWith(b2, expect.objectContaining({ id: 2 }), SERVICE);
    expect(count).toBe(1);
  });
});

describe('startCalendarSyncPoller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockedListAllBusinessIds.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('schedules runCalendarSyncSweep repeatedly at the given interval, and stops when cleared', async () => {
    const handle = startCalendarSyncPoller(1000);

    await jest.advanceTimersByTimeAsync(3000);
    expect(mockedListAllBusinessIds).toHaveBeenCalledTimes(3);

    clearInterval(handle);
    await jest.advanceTimersByTimeAsync(3000);
    expect(mockedListAllBusinessIds).toHaveBeenCalledTimes(3);
  });

  it('defaults to a 5-minute (300000ms) interval when called with no argument', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    const handle = startCalendarSyncPoller();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 300000);
    clearInterval(handle);
  });
});
