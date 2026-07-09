import * as queries from '../src/database/queries';
import * as telegramClient from '../src/telegram/client';
import { logger } from '../src/utils/logger';
import { runReminderSweep, startReminderPoller } from '../src/scheduler/reminders';

jest.mock('../src/database/queries');
jest.mock('../src/telegram/client');
jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const mockedListAllBusinessIds = queries.listAllBusinessIds as jest.MockedFunction<
  typeof queries.listAllBusinessIds
>;
const mockedFindBookingsNeedingReminder = queries.findBookingsNeedingReminder as jest.MockedFunction<
  typeof queries.findBookingsNeedingReminder
>;
const mockedClaimReminder24hSlot = queries.claimReminder24hSlot as jest.MockedFunction<
  typeof queries.claimReminder24hSlot
>;
const mockedClaimReminder1hSlot = queries.claimReminder1hSlot as jest.MockedFunction<
  typeof queries.claimReminder1hSlot
>;
const mockedSendTelegramMessage = telegramClient.sendTelegramMessage as jest.MockedFunction<
  typeof telegramClient.sendTelegramMessage
>;

// Build a booking fixture. By default the booking was created 3 days before a
// 10:00 appointment tomorrow (Athens local 2026-07-10T10:00) from the
// perspective of a sweep running "today" (2026-07-09).
// All Athens-local instants are expressed as UTC dates that land at the same
// Athens wall-clock time for both UTC+2 and UTC+3 — we use UTC+3 (summer DST).
function makeBooking(overrides: Partial<queries.Booking> = {}): queries.Booking {
  return {
    id: 42,
    businessId: 1,
    clientPhone: 'c1',
    serviceId: 2,
    calendarDate: '2026-07-10', // appointment is "tomorrow" from 2026-07-09
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
    // Created 3 days before the appointment -- both D-14 gates pass
    createdAt: new Date('2026-07-07T07:00:00Z'), // 2026-07-07 10:00 Athens (UTC+3)
    expiresAt: null,
    ...overrides,
  };
}

describe('runReminderSweep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockedSendTelegramMessage.mockResolvedValue({ messageId: 1 });
    mockedClaimReminder24hSlot.mockResolvedValue(true);
    mockedClaimReminder1hSlot.mockResolvedValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // Test 1: 24h window — when "now" is exactly the day before the appointment
  // at or after the appointment's calendarTime, the 24h reminder fires.
  it('Test 1: sends 24h reminder when now is 24h or less before appointment time (same clock hour)', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1]);
    // Appointment: 2026-07-10 10:00 Athens (UTC+3) = 2026-07-10T07:00:00Z
    // "Now" = 2026-07-09 10:00 Athens = 2026-07-09T07:00:00Z => exactly 24h before
    const booking = makeBooking({
      calendarDate: '2026-07-10',
      calendarTime: '10:00',
      reminder24hSentAt: null,
      reminder1hSentAt: null,
    });
    mockedFindBookingsNeedingReminder.mockResolvedValue([booking]);

    // Freeze "now" to exactly 24h before the appointment (Athens: 2026-07-09 10:00)
    jest.setSystemTime(new Date('2026-07-09T07:00:00Z')); // 10:00 Athens (UTC+3)

    await runReminderSweep();

    expect(mockedClaimReminder24hSlot).toHaveBeenCalledWith(42);
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(
      'c1',
      expect.stringMatching(/αύριο|10:00/)
    );
  });

  it('Test 1b: does NOT send 24h reminder when now is more than 24h before appointment', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1]);
    const booking = makeBooking({
      calendarDate: '2026-07-10',
      calendarTime: '10:00',
      reminder24hSentAt: null,
      reminder1hSentAt: null,
    });
    mockedFindBookingsNeedingReminder.mockResolvedValue([booking]);

    // "Now" = 2026-07-09 09:00 Athens = 2026-07-09T06:00:00Z => 25h before, outside window
    jest.setSystemTime(new Date('2026-07-09T06:00:00Z')); // 09:00 Athens (UTC+3)

    await runReminderSweep();

    expect(mockedClaimReminder24hSlot).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessage).not.toHaveBeenCalled();
  });

  // Test 2 (D-14, 24h skip): booking created only 20h before appointment.
  // claimReminder24hSlot must NEVER be called regardless of when the sweep runs.
  it('Test 2 (D-14): booking created 20h before appointment never gets 24h reminder', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1]);
    // Appointment: 2026-07-10 10:00 Athens
    // Created: 2026-07-09 14:00 Athens = 2026-07-09T11:00:00Z (20h before)
    const booking = makeBooking({
      calendarDate: '2026-07-10',
      calendarTime: '10:00',
      createdAt: new Date('2026-07-09T11:00:00Z'), // 14:00 Athens (UTC+3)
      reminder24hSentAt: null,
      reminder1hSentAt: null,
    });
    mockedFindBookingsNeedingReminder.mockResolvedValue([booking]);

    // Simulate sweep running at 24h window (2026-07-09 10:00 Athens)
    jest.setSystemTime(new Date('2026-07-09T07:00:00Z')); // 10:00 Athens

    await runReminderSweep();

    expect(mockedClaimReminder24hSlot).not.toHaveBeenCalled();
  });

  // Test 3 (D-14, 1h skip): booking created only 30 minutes before appointment.
  // Neither claimReminder24hSlot NOR claimReminder1hSlot are ever called.
  it('Test 3 (D-14): booking created 30 min before appointment never gets either reminder', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1]);
    // Appointment: 2026-07-10 10:00 Athens
    // Created: 2026-07-10 09:30 Athens = 2026-07-10T06:30:00Z (30min before)
    const booking = makeBooking({
      calendarDate: '2026-07-10',
      calendarTime: '10:00',
      createdAt: new Date('2026-07-10T06:30:00Z'), // 09:30 Athens (UTC+3)
      reminder24hSentAt: null,
      reminder1hSentAt: null,
    });
    mockedFindBookingsNeedingReminder.mockResolvedValue([booking]);

    // Simulate sweep running within 1h window (09:30 Athens -- still before appointment)
    jest.setSystemTime(new Date('2026-07-10T06:30:00Z')); // 09:30 Athens

    await runReminderSweep();

    expect(mockedClaimReminder24hSlot).not.toHaveBeenCalled();
    expect(mockedClaimReminder1hSlot).not.toHaveBeenCalled();
  });

  // Test 4: 1h reminder fires within 60 min before appointment (same day);
  // does NOT fire once the appointment has passed.
  it('Test 4: sends 1h reminder when within 60 min before appointment on appointment day', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1]);
    // Appointment: 2026-07-10 10:00 Athens; created 3 days before (D-14 clear)
    const booking = makeBooking({
      calendarDate: '2026-07-10',
      calendarTime: '10:00',
      reminder24hSentAt: new Date('2026-07-09T07:00:00Z'), // already sent
      reminder1hSentAt: null,
    });
    mockedFindBookingsNeedingReminder.mockResolvedValue([booking]);

    // "Now" = 2026-07-10 09:30 Athens = 2026-07-10T06:30:00Z (30min before -- inside 60min window)
    jest.setSystemTime(new Date('2026-07-10T06:30:00Z'));

    await runReminderSweep();

    expect(mockedClaimReminder1hSlot).toHaveBeenCalledWith(42);
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(
      'c1',
      expect.stringMatching(/1 ώρα|10:00/)
    );
  });

  it('Test 4b: does NOT send 1h reminder after appointment has already passed', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1]);
    const booking = makeBooking({
      calendarDate: '2026-07-10',
      calendarTime: '10:00',
      reminder24hSentAt: new Date('2026-07-09T07:00:00Z'),
      reminder1hSentAt: null,
    });
    mockedFindBookingsNeedingReminder.mockResolvedValue([booking]);

    // "Now" = 2026-07-10 10:05 Athens = 2026-07-10T07:05:00Z (5min AFTER -- past)
    jest.setSystemTime(new Date('2026-07-10T07:05:00Z'));

    await runReminderSweep();

    expect(mockedClaimReminder1hSlot).not.toHaveBeenCalled();
  });

  // Test 5 (late-night booking edge case): appointment at 01:00 "tomorrow"
  // relative to createdAt (several days earlier, D-14 gates pass).
  // At 01:05 on the appointment day (5 min AFTER), claimReminder1hSlot must NOT fire.
  it('Test 5 (late-night edge case): 01:05 on appointment day is past a 01:00 appointment -- no 1h reminder', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1]);
    // Appointment: 2026-07-10 01:00 Athens; created 3 days earlier (D-14 clear)
    const booking = makeBooking({
      calendarDate: '2026-07-10',
      calendarTime: '01:00',
      // Created 3 days before: 2026-07-07 01:00 Athens = 2026-07-06T22:00:00Z
      createdAt: new Date('2026-07-06T22:00:00Z'),
      reminder24hSentAt: new Date('2026-07-09T22:00:00Z'), // already sent
      reminder1hSentAt: null,
    });
    mockedFindBookingsNeedingReminder.mockResolvedValue([booking]);

    // "Now" = 2026-07-10 01:05 Athens = 2026-07-09T22:05:00Z (5min past appointment)
    jest.setSystemTime(new Date('2026-07-09T22:05:00Z')); // 01:05 Athens (UTC+3)

    await runReminderSweep();

    expect(mockedClaimReminder1hSlot).not.toHaveBeenCalled();
  });

  // Test 6: claim returning false means sendTelegramMessage is never called for that type.
  it('Test 6: claimReminder24hSlot false prevents send; same independently for claimReminder1hSlot false', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1]);

    // A booking in the 24h window and also in the 1h window (both eligible).
    // Appointment: 2026-07-10 10:00, "now" = 2026-07-10 09:30 Athens (inside 1h window),
    // which is also inside the 24h window (< 24h until appointment).
    // Created 3 days ago (D-14 passes for both thresholds).
    const booking = makeBooking({
      calendarDate: '2026-07-10',
      calendarTime: '10:00',
      reminder24hSentAt: null,
      reminder1hSentAt: null,
    });
    mockedFindBookingsNeedingReminder.mockResolvedValue([booking]);

    // Both claims return false (already claimed by another sweep)
    mockedClaimReminder24hSlot.mockResolvedValue(false);
    mockedClaimReminder1hSlot.mockResolvedValue(false);

    // "Now" = 2026-07-10 09:30 Athens (inside both 24h and 1h window)
    jest.setSystemTime(new Date('2026-07-10T06:30:00Z')); // 09:30 Athens

    const count = await runReminderSweep();

    expect(mockedSendTelegramMessage).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  // Test 7: one business's findBookingsNeedingReminder rejecting does NOT stop
  // the sweep from processing the next business.
  it('Test 7: error isolation -- one business failing does not stop processing of the next', async () => {
    mockedListAllBusinessIds.mockResolvedValue([1, 2]);
    mockedFindBookingsNeedingReminder.mockImplementation(
      async (businessId: number, _calendarDates: string[]) => {
        if (businessId === 1) throw new Error('db error');
        return [];
      }
    );

    await expect(runReminderSweep()).resolves.toBe(0);
    expect(mockedFindBookingsNeedingReminder).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalled();
  });

  // Test 8a: startReminderPoller() defaults to 900000ms (15 minutes).
  // Test 8b: startReminderPoller(1000) fires repeatedly and stops on clearInterval.
});

describe('startReminderPoller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockedListAllBusinessIds.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('Test 8a: defaults to a 15-minute (900000ms) interval when called with no argument', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    const handle = startReminderPoller();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 900000);
    clearInterval(handle);
  });

  it('Test 8b: schedules runReminderSweep repeatedly at the given interval, stops on clearInterval', async () => {
    const handle = startReminderPoller(1000);

    await jest.advanceTimersByTimeAsync(3000);
    expect(mockedListAllBusinessIds).toHaveBeenCalledTimes(3);

    clearInterval(handle);
    await jest.advanceTimersByTimeAsync(3000);
    expect(mockedListAllBusinessIds).toHaveBeenCalledTimes(3);
  });
});
