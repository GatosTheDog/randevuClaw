// Phase 25.1 plan 06 Task 2: the Greek "remove the event" note on client-visible
// cancellations (CAL-06) -- client-menu cancel and owner-cancelled class cascade.
import { handleCancelExecute } from '../src/telegram/handlers/client-menu';
import { cascadeCancelSessionBookings } from '../src/session/manager';
import * as queries from '../src/database/queries';
import * as telegramClient from '../src/telegram/client';
import * as calendarSync from '../src/calendar/sync';
import { CALENDAR_REMOVE_NOTE_GREEK } from '../src/calendar/client-link';
import { makeBooking, makeBusiness } from './helpers/calendar-fixtures';

jest.mock('../src/database/db', () => ({ db: {}, appDb: {} }));
jest.mock('../src/database/queries', () => ({
  findBookingByIdUnscoped: jest.fn(),
  updateBookingStatus: jest.fn(),
  listClientBookings: jest.fn(),
  updateBookingOwnerMessageId: jest.fn(),
  withBusinessContext: jest.fn(async (_id: number, fn: () => Promise<unknown>) => fn()),
  getConn: jest.fn(),
  findActiveBookingsForSessionInstance: jest.fn(),
}));
jest.mock('../src/billing/queries', () => ({
  getClientActiveMembership: jest.fn(),
  findMembershipByBooking: jest.fn().mockResolvedValue(null),
  restoreCredit: jest.fn(),
  getClientName: jest.fn().mockResolvedValue('Maria'),
  getActiveMembershipForDeduction: jest.fn(),
  deductSession: jest.fn(),
}));
jest.mock('../src/billing/enforcement', () => ({ checkEnforcementAndGetMembership: jest.fn() }));
jest.mock('../src/calendar/sync', () => ({ deleteBookingFromCalendar: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/telegram/escalation', () => ({
  sendEscalationToAdmin: jest.fn(),
  buildEscalationKeyboard: jest.fn(),
}));
jest.mock('../src/telegram/client', () => ({
  sendTelegramMessage: jest.fn().mockResolvedValue(undefined),
  sendTelegramMessageWithKeyboard: jest.fn().mockResolvedValue(undefined),
  botTokenStore: {
    run: jest.fn((_token: string, cb: () => Promise<unknown>) => cb()),
    getStore: jest.fn().mockReturnValue('bot-token-1'),
  },
}));
jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mFindBookingUnscoped = queries.findBookingByIdUnscoped as jest.Mock;
const mFindActive = queries.findActiveBookingsForSessionInstance as jest.Mock;
const mGetConn = queries.getConn as jest.Mock;
const mSend = telegramClient.sendTelegramMessage as jest.Mock;
const mDelete = calendarSync.deleteBookingFromCalendar as jest.Mock;

const CLIENT = '3941234567';
const BUSINESS = makeBusiness();

beforeEach(() => {
  mSend.mockClear();
  mDelete.mockClear();
  mFindBookingUnscoped.mockReset();
  mFindActive.mockReset();
  mGetConn.mockReset();
});

describe('handleCancelExecute remove-event note (CAL-06)', () => {
  it('confirmed booking: deletes the event and appends the note', async () => {
    const booking = makeBooking({ id: 7, clientPhone: CLIENT, bookingStatus: 'confirmed' });
    mFindBookingUnscoped.mockResolvedValue(booking);

    await handleCancelExecute(CLIENT, BUSINESS, CLIENT, 7);

    expect(mDelete).toHaveBeenCalledWith(booking, BUSINESS);
    const clientTexts = mSend.mock.calls.filter((c) => c[0] === CLIENT).map((c) => c[1]);
    expect(clientTexts).toEqual([`Η κράτησή σας ακυρώθηκε.\n\n${CALENDAR_REMOVE_NOTE_GREEK}`]);
  });

  it('pending booking: exact original text, no note', async () => {
    mFindBookingUnscoped.mockResolvedValue(
      makeBooking({ id: 7, clientPhone: CLIENT, bookingStatus: 'pending_owner_approval' })
    );

    await handleCancelExecute(CLIENT, BUSINESS, CLIENT, 7);

    const clientTexts = mSend.mock.calls.filter((c) => c[0] === CLIENT).map((c) => c[1]);
    expect(clientTexts).toEqual(['Η κράτησή σας ακυρώθηκε.']);
  });
});

describe('cascadeCancelSessionBookings remove-event note (CAL-03/07)', () => {
  it('deletes events for both bookings, note only on the confirmed client message', async () => {
    const confirmed = makeBooking({ id: 1, clientPhone: 'client-confirmed', bookingStatus: 'confirmed', sessionInstanceId: 9 });
    const pending = makeBooking({ id: 2, clientPhone: 'client-pending', bookingStatus: 'pending_owner_approval', sessionInstanceId: 9 });
    mFindActive.mockResolvedValue([confirmed, pending]);

    // getConn().update(...) is used twice per booking: the CAS (needs .returning)
    // and releaseSessionCapacity (awaited directly). A hybrid chain serves both.
    mGetConn.mockImplementation(() => ({
      update: jest.fn(() => {
        const hybrid: Record<string, unknown> = {};
        hybrid.set = jest.fn(() => hybrid);
        hybrid.where = jest.fn(() => hybrid);
        hybrid.returning = jest.fn(async () => [{ id: 1 }]);
        hybrid.then = (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve);
        return hybrid;
      }),
    }));

    const count = await cascadeCancelSessionBookings(BUSINESS, 9);

    expect(count).toBe(2);
    expect(mDelete).toHaveBeenCalledTimes(2);
    expect(mDelete).toHaveBeenCalledWith(confirmed, BUSINESS);
    expect(mDelete).toHaveBeenCalledWith(pending, BUSINESS);

    const byClient = (phone: string) => mSend.mock.calls.filter((c) => c[0] === phone).map((c) => c[1] as string);
    const [confirmedMsg] = byClient('client-confirmed');
    const [pendingMsg] = byClient('client-pending');
    expect(confirmedMsg).toContain('ακυρώθηκε από την επιχείρηση');
    expect(confirmedMsg).toContain(CALENDAR_REMOVE_NOTE_GREEK);
    expect(pendingMsg).toContain('ακυρώθηκε από την επιχείρηση');
    expect(pendingMsg).not.toContain(CALENDAR_REMOVE_NOTE_GREEK);
  });
});
