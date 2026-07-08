import * as queries from '../src/database/queries';
import * as telegramClient from '../src/telegram/client';
import { logger } from '../src/utils/logger';
import { runExpirySweep, startExpiryPoller } from '../src/conversation/expiry-poller';

jest.mock('../src/database/queries');
jest.mock('../src/telegram/client');
jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const mockedListAllBusinessIds = queries.listAllBusinessIds as jest.MockedFunction<
  typeof queries.listAllBusinessIds
>;
const mockedExpireStalePendingBookings = queries.expireStalePendingBookings as jest.MockedFunction<
  typeof queries.expireStalePendingBookings
>;
const mockedFindBusinessById = queries.findBusinessById as jest.MockedFunction<
  typeof queries.findBusinessById
>;
const mockedSendTelegramMessage = telegramClient.sendTelegramMessage as jest.MockedFunction<
  typeof telegramClient.sendTelegramMessage
>;
const mockedEditTelegramMessageReplyMarkup = telegramClient.editTelegramMessageReplyMarkup as jest.MockedFunction<
  typeof telegramClient.editTelegramMessageReplyMarkup
>;

function makeExpiredBooking(overrides: Partial<queries.Booking> = {}): queries.Booking {
  return {
    id: 5,
    businessId: 1,
    clientPhone: 'c5',
    serviceId: 1,
    calendarDate: '2026-08-01',
    calendarTime: '10:00',
    bookingStatus: 'expired',
    requestId: 'req-5',
    ownerTelegramMessageId: 111,
    rescheduledFromBookingId: null,
    createdAt: new Date(),
    expiresAt: new Date(),
    ...overrides,
  };
}

const OWNER_BUSINESS_1 = {
  id: 1,
  name: 'Pilates Athens',
  slug: 'pilates-athens',
  phoneNumberId: null,
  ownerTelegramId: 'owner1',
  createdAt: new Date(),
};

describe('runExpirySweep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSendTelegramMessage.mockResolvedValue({ messageId: 1 });
    mockedEditTelegramMessageReplyMarkup.mockResolvedValue(undefined);
  });

  it('Test 1: sweeps every business with the D-09 2-hour cutoff', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1, 2]);
    mockedExpireStalePendingBookings.mockResolvedValue([]);

    await runExpirySweep();

    expect(mockedExpireStalePendingBookings).toHaveBeenCalledWith(1, 7200000);
    expect(mockedExpireStalePendingBookings).toHaveBeenCalledWith(2, 7200000);
  });

  it('Test 2: notifies the client and clears owner alert buttons per expired booking, returns the notified count', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1, 2]);
    const expiredBooking = makeExpiredBooking();
    mockedExpireStalePendingBookings.mockImplementation(async (businessId: number) =>
      businessId === 1 ? [expiredBooking] : []
    );
    mockedFindBusinessById.mockResolvedValue(OWNER_BUSINESS_1);

    const count = await runExpirySweep();

    expect(mockedSendTelegramMessage).toHaveBeenCalledTimes(1);
    const [clientId, text] = mockedSendTelegramMessage.mock.calls[0];
    expect(clientId).toBe('c5');
    expect(text).toMatch(/δεν επιβεβαιώθηκε εγκαίρως/);
    expect(mockedEditTelegramMessageReplyMarkup).toHaveBeenCalledWith('owner1', 111, []);
    expect(count).toBe(1);
  });

  it('Test 3: an expired booking with no owner alert message id skips the button-clearing call', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1]);
    mockedExpireStalePendingBookings.mockResolvedValue([
      makeExpiredBooking({ ownerTelegramMessageId: null }),
    ]);

    const count = await runExpirySweep();

    expect(mockedSendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(mockedEditTelegramMessageReplyMarkup).not.toHaveBeenCalled();
    expect(count).toBe(1);
  });

  it('Test 4: one business failing does not stop the sweep for others, and is logged (error isolation)', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1, 2]);
    mockedExpireStalePendingBookings.mockImplementation(async (businessId: number) => {
      if (businessId === 1) throw new Error('db down');
      return [];
    });

    await expect(runExpirySweep()).resolves.toBe(0);
    expect(mockedExpireStalePendingBookings).toHaveBeenCalledWith(2, 7200000);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('startExpiryPoller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockedListAllBusinessIds.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('Test 5: schedules runExpirySweep repeatedly at the given interval, and stops when cleared', async () => {
    const handle = startExpiryPoller(1000);

    await jest.advanceTimersByTimeAsync(3000);
    expect(mockedListAllBusinessIds).toHaveBeenCalledTimes(3);

    clearInterval(handle);
    await jest.advanceTimersByTimeAsync(3000);
    expect(mockedListAllBusinessIds).toHaveBeenCalledTimes(3);
  });

  it('Test 6: defaults to a 5-minute (300000ms) interval when called with no argument', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    const handle = startExpiryPoller();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 300000);
    clearInterval(handle);
  });
});
