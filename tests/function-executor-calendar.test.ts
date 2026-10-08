// Phase 25.1 plan 06 Task 1: cancel notes (CAL-06) and calendar handling in
// reschedule_session (CAL-05/07). Factory mocks only: tests/function-executor.test.ts
// is stale and is deliberately left alone.
import { executeTool, ToolContext } from '../src/conversation/function-executor';
import * as queries from '../src/database/queries';
import * as telegramClient from '../src/telegram/client';
import * as calendarSync from '../src/calendar/sync';
import * as confirmation from '../src/calendar/confirmation';
import * as billingQueries from '../src/billing/queries';
import * as sessionManager from '../src/session/manager';
import { CALENDAR_REMOVE_NOTE_GREEK, CALENDAR_RESCHEDULE_NOTE_GREEK } from '../src/calendar/client-link';
import { makeBooking, makeBusiness } from './helpers/calendar-fixtures';

jest.mock('../src/database/queries', () => ({
  findServiceById: jest.fn(),
  findBookingById: jest.fn(),
  findBusinessById: jest.fn(),
  updateBookingStatus: jest.fn(),
  insertBooking: jest.fn(),
  findBookingByRequestId: jest.fn(),
  updateBookingOwnerMessageId: jest.fn(),
  listClientBookings: jest.fn(),
}));
jest.mock('../src/telegram/client', () => ({
  sendTelegramMessage: jest.fn(),
  sendTelegramMessageWithKeyboard: jest.fn(),
}));
jest.mock('../src/calendar/sync', () => ({ deleteBookingFromCalendar: jest.fn() }));
jest.mock('../src/calendar/confirmation', () => ({ processBookingConfirmedForCalendar: jest.fn() }));
jest.mock('../src/billing/queries', () => ({
  getClientActiveMembership: jest.fn(),
  getActiveMembershipForDeduction: jest.fn(),
  deductSession: jest.fn(),
  getClientName: jest.fn(),
  findMembershipByBooking: jest.fn(),
  restoreCredit: jest.fn(),
  linkRescheduledBooking: jest.fn(),
}));
jest.mock('../src/billing/enforcement', () => ({ checkEnforcementAndGetMembership: jest.fn() }));
jest.mock('../src/session/manager', () => ({ listSessions: jest.fn(), bookSessionInstance: jest.fn() }));
jest.mock('../src/session/slotless-requests', () => ({
  insertSlotlessRequest: jest.fn(),
  countSlotlessRequestsSinceCheckin: jest.fn(),
}));
jest.mock('../src/business/availability', () => ({ checkAvailability: jest.fn() }));
jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mFindBookingById = queries.findBookingById as jest.Mock;
const mFindBusinessById = queries.findBusinessById as jest.Mock;
const mFindServiceById = queries.findServiceById as jest.Mock;
const mUpdateStatus = queries.updateBookingStatus as jest.Mock;
const mSend = telegramClient.sendTelegramMessage as jest.Mock;
const mDelete = calendarSync.deleteBookingFromCalendar as jest.Mock;
const mProcess = confirmation.processBookingConfirmedForCalendar as jest.Mock;
const mFindMembership = billingQueries.findMembershipByBooking as jest.Mock;
const mGetActive = billingQueries.getActiveMembershipForDeduction as jest.Mock;
const mGetClientActive = billingQueries.getClientActiveMembership as jest.Mock;
const mListSessions = sessionManager.listSessions as jest.Mock;
const mBookSession = sessionManager.bookSessionInstance as jest.Mock;

const FULL_BUSINESS = makeBusiness();

function makeContext(overrides: Partial<ToolContext['business']> = {}): ToolContext {
  return {
    business: {
      id: 1,
      name: 'Pilates Athens',
      ownerTelegramId: '999',
      enforcementPolicy: 'allow',
      bookingMode: 'fixed_sessions',
      allowMultiBooking: false,
      cancellationCutoffEnabled: false,
      cancellationCutoffHours: 8,
      slotlessRequestsEnabled: false,
      ...overrides,
    },
    clientPhone: '3941234567',
    requestId: 'r1',
    idempotencyKey: 'ik1',
  };
}

function clientMessages(): string[] {
  return mSend.mock.calls.filter((c) => c[0] === '3941234567').map((c) => c[1] as string);
}

beforeEach(() => {
  jest.clearAllMocks();
  mFindBusinessById.mockResolvedValue(FULL_BUSINESS);
  mFindServiceById.mockResolvedValue({ id: 2, businessId: 1, name: 'Reformer Pilates', durationMin: 50, price: 3500, createdAt: new Date() });
  mFindMembership.mockResolvedValue(null);
  mGetActive.mockResolvedValue(null);
  mGetClientActive.mockResolvedValue(null);
  mUpdateStatus.mockResolvedValue(undefined);
  mSend.mockResolvedValue(undefined);
  mDelete.mockResolvedValue(undefined);
});

describe('cancel_appointment calendar notes (CAL-06)', () => {
  it('confirmed booking: deletes the event and appends the remove note', async () => {
    const booking = makeBooking({ id: 42, bookingStatus: 'confirmed' });
    mFindBookingById.mockResolvedValue(booking);

    const res = await executeTool('cancel_appointment', { business_id: 1, booking_id: 42 }, makeContext());

    expect(res).toEqual({ success: true, booking_id: 42 });
    expect(mDelete).toHaveBeenCalledWith(booking, FULL_BUSINESS);
    expect(clientMessages()).toEqual([`Το ραντεβού σας ακυρώθηκε.\n\n${CALENDAR_REMOVE_NOTE_GREEK}`]);
  });

  it('pending booking: exact original text, no note', async () => {
    mFindBookingById.mockResolvedValue(makeBooking({ id: 42, bookingStatus: 'pending_owner_approval' }));

    await executeTool('cancel_appointment', { business_id: 1, booking_id: 42 }, makeContext());

    expect(clientMessages()).toEqual(['Το ραντεβού σας ακυρώθηκε.']);
  });

  it('forfeiture branch: explanation message also ends with the remove note', async () => {
    const booking = makeBooking({ id: 42, bookingStatus: 'confirmed', calendarDate: '2020-01-01', calendarTime: '10:00' });
    mFindBookingById.mockResolvedValue(booking);

    const res = await executeTool(
      'cancel_appointment',
      { business_id: 1, booking_id: 42, confirmed: true },
      makeContext({ cancellationCutoffEnabled: true, cancellationCutoffHours: 8 })
    );

    expect(res).toMatchObject({ success: true, credit_forfeited: true });
    expect(mDelete).toHaveBeenCalledWith(booking, FULL_BUSINESS);
    const [msg] = clientMessages();
    expect(msg).toContain('Το session δεν επιστράφηκε λόγω ακύρωσης εντός 8 ωρών.');
    expect(msg.endsWith(CALENDAR_REMOVE_NOTE_GREEK)).toBe(true);
  });
});

describe('reschedule_session calendar handling (CAL-05/07)', () => {
  const original = makeBooking({ id: 10, bookingStatus: 'confirmed', sessionInstanceId: 5, googleCalendarEventId: 'evt-old' });
  const newBooking = makeBooking({ id: 11, bookingStatus: 'confirmed', sessionInstanceId: 6, calendarDate: '2026-07-17', calendarTime: '18:00' });
  const args = { business_id: 1, booking_id: 10, new_session_instance_id: 6 };

  beforeEach(() => {
    mFindBookingById.mockImplementation(async (_b: number, id: number) => (id === 10 ? original : id === 11 ? newBooking : null));
    mListSessions.mockResolvedValue([
      { instanceId: 6, catalogId: 1, sessionDate: '2026-07-17', sessionTime: '18:00', bookedCount: 1, capacity: 8, serviceId: 2 },
    ]);
  });

  it('success: deletes old event, processes new booking as reschedule, sends the link message', async () => {
    mBookSession.mockResolvedValue({ status: 'success', bookingId: 11 });
    const linkMsg = `\n\n📅 Προσθήκη στο Google Calendar σας (πατήστε τον σύνδεσμο):\nhttps://calendar.google.com/x\n\n${CALENDAR_RESCHEDULE_NOTE_GREEK}`;
    mProcess.mockResolvedValue({ clientCalendarMessage: linkMsg, ownerSynced: true });

    const res = await executeTool('reschedule_session', args, makeContext());

    expect(res).toEqual({
      success: true,
      booking_id: 11,
      cancelled_booking_id: 10,
      new_session_date: '2026-07-17',
      new_session_time: '18:00',
    });
    expect(mDelete).toHaveBeenCalledWith(original, FULL_BUSINESS);
    expect(mProcess).toHaveBeenCalledTimes(1);
    expect(mProcess).toHaveBeenCalledWith({ booking: newBooking, business: FULL_BUSINESS, isReschedule: true });
    const msgs = clientMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toBe(linkMsg.trim());
    expect(msgs[0]).toContain('https://calendar.google.com/x');
    expect(msgs[0]).toContain(CALENDAR_RESCHEDULE_NOTE_GREEK);
  });

  it('new session full: old event still deleted, helper not called, no link message', async () => {
    mBookSession.mockResolvedValue({ status: 'full' });

    const res = await executeTool('reschedule_session', args, makeContext());

    expect(res).toMatchObject({ success: false, error: 'reschedule_failed_full' });
    expect(mDelete).toHaveBeenCalledWith(original, FULL_BUSINESS);
    expect(mProcess).not.toHaveBeenCalled();
    expect(clientMessages()).toEqual([]);
  });

  it('helper rejecting never turns a successful reschedule into an error', async () => {
    mBookSession.mockResolvedValue({ status: 'success', bookingId: 11 });
    mProcess.mockRejectedValue(new Error('boom'));

    const res = await executeTool('reschedule_session', args, makeContext());

    expect(res).toMatchObject({ success: true, booking_id: 11 });
    expect(clientMessages()).toEqual([]);
  });

  it('empty helper message sends nothing and stays successful', async () => {
    mBookSession.mockResolvedValue({ status: 'success', bookingId: 11 });
    mProcess.mockResolvedValue({ clientCalendarMessage: '', ownerSynced: false });

    const res = await executeTool('reschedule_session', args, makeContext());

    expect(res).toMatchObject({ success: true, booking_id: 11 });
    expect(clientMessages()).toEqual([]);
  });

  it('old-event delete failure does not block the reschedule', async () => {
    mBookSession.mockResolvedValue({ status: 'success', bookingId: 11 });
    mProcess.mockResolvedValue({ clientCalendarMessage: '', ownerSynced: false });
    mDelete.mockRejectedValue(new Error('google down'));

    const res = await executeTool('reschedule_session', args, makeContext());

    expect(res).toMatchObject({ success: true, booking_id: 11 });
    expect(mProcess).toHaveBeenCalledTimes(1);
  });

  it('link send failure is swallowed', async () => {
    mBookSession.mockResolvedValue({ status: 'success', bookingId: 11 });
    mProcess.mockResolvedValue({ clientCalendarMessage: '\n\nlink', ownerSynced: true });
    mSend.mockRejectedValue(new Error('telegram down'));

    const res = await executeTool('reschedule_session', args, makeContext());

    expect(res).toMatchObject({ success: true, booking_id: 11 });
  });
});
