import * as queries from '../src/database/queries';
import * as telegramClient from '../src/telegram/client';
import { logger } from '../src/utils/logger';
import { isoDateInAthens } from '../src/utils/timezone';
import { runAgendaSweep, startAgendaPoller, AGENDA_HOUR_THRESHOLD } from '../src/scheduler/agenda';

jest.mock('../src/database/queries');
jest.mock('../src/telegram/client');
jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const mockedListAllBusinessIds = queries.listAllBusinessIds as jest.MockedFunction<
  typeof queries.listAllBusinessIds
>;
const mockedFindBusinessById = queries.findBusinessById as jest.MockedFunction<
  typeof queries.findBusinessById
>;
const mockedListBookingsForDate = queries.listBookingsForDate as jest.MockedFunction<
  typeof queries.listBookingsForDate
>;
const mockedClaimAgendaSlot = queries.claimAgendaSlot as jest.MockedFunction<
  typeof queries.claimAgendaSlot
>;
const mockedFindServiceById = queries.findServiceById as jest.MockedFunction<
  typeof queries.findServiceById
>;
const mockedSendTelegramMessage = telegramClient.sendTelegramMessage as jest.MockedFunction<
  typeof telegramClient.sendTelegramMessage
>;

function makeBusiness(overrides: Partial<queries.Business> = {}): queries.Business {
  return {
    id: 1,
    name: 'Pilates Athens',
    slug: 'pilates-athens',
    phoneNumberId: null,
    ownerTelegramId: 'owner1',
    googleRefreshToken: null,
    agendaSentDate: null,
    botToken: 'test-bot-token',
    webhookId: 'test-webhook-id',
    webhookSecret: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeBooking(overrides: Partial<queries.Booking> = {}): queries.Booking {
  return {
    id: 42,
    businessId: 1,
    clientPhone: 'c1',
    serviceId: 2,
    calendarDate: '2026-07-10',
    calendarTime: '10:00',
    bookingStatus: 'confirmed',
    requestId: 'req-42',
    ownerTelegramMessageId: null,
    rescheduledFromBookingId: null,
    calendarSyncStatus: 'pending',
    googleCalendarEventId: null,
    calendarSyncRetryCount: 0,
    reminder24hSentAt: null,
    reminder1hSentAt: null,
    createdAt: new Date(),
    expiresAt: null,
    ...overrides,
  };
}

const SERVICE = {
  id: 2,
  businessId: 1,
  name: 'Reformer Pilates',
  durationMin: 50,
  price: 3500,
  createdAt: new Date(),
};

describe('runAgendaSweep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFindServiceById.mockResolvedValue(SERVICE);
    mockedSendTelegramMessage.mockResolvedValue({ messageId: 1 });
    mockedClaimAgendaSlot.mockResolvedValue(true);
    // botTokenStore.run is an AsyncLocalStorage.run() — auto-mock returns undefined
    // without executing the callback. Explicitly mock it as a call-through so
    // sendTelegramMessage calls inside the run() body actually execute.
    (telegramClient.botTokenStore.run as jest.Mock).mockImplementation(
      (_token: string, fn: () => Promise<unknown>) => fn()
    );
  });

  it('Test 1: calls listAllBusinessIds, then findBusinessById for each business id', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1, 2]);
    mockedFindBusinessById.mockResolvedValue(makeBusiness({ ownerTelegramId: null }));

    await runAgendaSweep();

    expect(mockedListAllBusinessIds).toHaveBeenCalledTimes(1);
    expect(mockedFindBusinessById).toHaveBeenCalledWith(1);
    expect(mockedFindBusinessById).toHaveBeenCalledWith(2);
  });

  it('Test 2: a business with ownerTelegramId null is skipped -- claimAgendaSlot/listBookingsForDate never called', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1]);
    mockedFindBusinessById.mockResolvedValue(makeBusiness({ ownerTelegramId: null }));

    await runAgendaSweep();

    expect(mockedListBookingsForDate).not.toHaveBeenCalled();
    expect(mockedClaimAgendaSlot).not.toHaveBeenCalled();
  });

  it('Test 3: no confirmed bookings today -- claimAgendaSlot/sendTelegramMessage never called (no empty-agenda spam)', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1]);
    mockedFindBusinessById.mockResolvedValue(makeBusiness());
    mockedListBookingsForDate.mockResolvedValue([]);

    await runAgendaSweep();

    const todayIso = isoDateInAthens(new Date());
    expect(mockedListBookingsForDate).toHaveBeenCalledWith(1, todayIso);
    expect(mockedClaimAgendaSlot).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessage).not.toHaveBeenCalled();
  });

  it('Test 4: 1+ bookings -- claimAgendaSlot called BEFORE sendTelegramMessage; sendTelegramMessage sent once with calendarTime; counted', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1]);
    mockedFindBusinessById.mockResolvedValue(makeBusiness());
    const booking = makeBooking({ calendarTime: '11:30' });
    mockedListBookingsForDate.mockResolvedValue([booking]);

    const callOrder: string[] = [];
    mockedClaimAgendaSlot.mockImplementation(async () => {
      callOrder.push('claim');
      return true;
    });
    mockedSendTelegramMessage.mockImplementation(async () => {
      callOrder.push('send');
      return { messageId: 1 };
    });

    const count = await runAgendaSweep();

    expect(callOrder).toEqual(['claim', 'send']);
    expect(mockedSendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith('owner1', expect.stringContaining('11:30'));
    expect(count).toBe(1);
  });

  it('Test 5: claimAgendaSlot resolves false -- sendTelegramMessage never called, sweep does not throw', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1]);
    mockedFindBusinessById.mockResolvedValue(makeBusiness());
    mockedListBookingsForDate.mockResolvedValue([makeBooking()]);
    mockedClaimAgendaSlot.mockResolvedValue(false);

    await expect(runAgendaSweep()).resolves.toBe(0);
    expect(mockedSendTelegramMessage).not.toHaveBeenCalled();
  });

  it('Test 6: one business failing does not stop the sweep from processing the next business (error isolation)', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1, 2]);
    mockedFindBusinessById.mockResolvedValue(makeBusiness());
    mockedListBookingsForDate.mockImplementation(async (businessId: number) => {
      if (businessId === 1) throw new Error('db down');
      return [];
    });

    await expect(runAgendaSweep()).resolves.toBe(0);
    expect(mockedListBookingsForDate).toHaveBeenCalledWith(2, expect.any(String));
    expect(logger.error).toHaveBeenCalled();
  });

  describe('8am threshold gate', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      mockedListAllBusinessIds.mockResolvedValue([1]);
      mockedFindBusinessById.mockResolvedValue(makeBusiness({ ownerTelegramId: 'owner1' }));
      mockedListBookingsForDate.mockResolvedValue([makeBooking()]);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('Test 7 (8am gate): runAgendaSweep sends nothing and does NOT call claimAgendaSlot when Athens wall-clock time is before 08:00, even when confirmed bookings exist for today', async () => {
      // 2026-07-09T02:30:00Z = 05:30 Athens (UTC+3), before 08:00
      jest.setSystemTime(new Date('2026-07-09T02:30:00Z'));

      const count = await runAgendaSweep();

      expect(mockedClaimAgendaSlot).not.toHaveBeenCalled();
      expect(mockedSendTelegramMessage).not.toHaveBeenCalled();
      expect(count).toBe(0);
    });

    it('Test 7b (8am gate): runAgendaSweep DOES send when Athens wall-clock time is exactly 08:00 or later', async () => {
      // 2026-07-09T05:00:00Z = 08:00 Athens (UTC+3)
      jest.setSystemTime(new Date('2026-07-09T05:00:00Z'));
      mockedClaimAgendaSlot.mockResolvedValue(true);
      mockedSendTelegramMessage.mockResolvedValue({ messageId: 1 });

      const count = await runAgendaSweep();

      expect(mockedClaimAgendaSlot).toHaveBeenCalled();
      expect(mockedSendTelegramMessage).toHaveBeenCalledTimes(1);
      expect(count).toBe(1);
    });
  });
});

describe('startAgendaPoller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockedListAllBusinessIds.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('Test 7: schedules runAgendaSweep repeatedly at the given interval, and stops when cleared', async () => {
    const handle = startAgendaPoller(1000);

    await jest.advanceTimersByTimeAsync(3000);
    expect(mockedListAllBusinessIds).toHaveBeenCalledTimes(3);

    clearInterval(handle);
    await jest.advanceTimersByTimeAsync(3000);
    expect(mockedListAllBusinessIds).toHaveBeenCalledTimes(3);
  });

  it('Test 8: defaults to a 10-minute (600000ms) interval when called with no argument', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    const handle = startAgendaPoller();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 600000);
    clearInterval(handle);
  });
});
