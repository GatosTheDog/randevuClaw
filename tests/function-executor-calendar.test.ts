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
import { CALENDAR_REMOVE_NOTE_GREEK } from '../src/calendar/client-link';
import { makeBooking, makeBusiness } from './helpers/calendar-fixtures';

jest.mock('../src/database/queries', () => ({
  findServiceById: jest.fn(),
  findBookingById: jest.fn(),
  findBusinessById: jest.fn(),
  updateBookingStatus: jest.fn(),
  insertBooking: jest.fn(),
  findBookingByRequestId: jest.fn(),
  updateBookingOwnerMessageId: jest.fn().mockResolvedValue(undefined),
  listClientBookings: jest.fn(),
}));
jest.mock('../src/telegram/client', () => ({
  sendTelegramMessage: jest.fn(),
  sendTelegramMessageWithKeyboard: jest.fn().mockResolvedValue({ messageId: 1 }),
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
jest.mock('../src/session/manager', () => ({
  listSessions: jest.fn(),
  bookSessionInstance: jest.fn(),
  releaseSessionCapacity: jest.fn(),
}));
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
const mUpdateOwnerMessageId = queries.updateBookingOwnerMessageId as jest.Mock;
const mSend = telegramClient.sendTelegramMessage as jest.Mock;
const mSendKeyboard = telegramClient.sendTelegramMessageWithKeyboard as jest.Mock;
const mDelete = calendarSync.deleteBookingFromCalendar as jest.Mock;
const mProcess = confirmation.processBookingConfirmedForCalendar as jest.Mock;
const mFindMembership = billingQueries.findMembershipByBooking as jest.Mock;
const mGetActive = billingQueries.getActiveMembershipForDeduction as jest.Mock;
const mGetClientActive = billingQueries.getClientActiveMembership as jest.Mock;
const mLinkRescheduled = billingQueries.linkRescheduledBooking as jest.Mock;
const mListSessions = sessionManager.listSessions as jest.Mock;
const mBookSession = sessionManager.bookSessionInstance as jest.Mock;
const mReleaseCapacity = sessionManager.releaseSessionCapacity as jest.Mock;

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

// Bug fix (git-sync session): a client cancelling a fixed_sessions booking
// via cancel_appointment never freed the session instance's held seat —
// bookedCount stayed incremented forever, so a popular recurring class would
// silently show as full even with real no-shows. Mirrors the already-proven
// releaseExpiredSessionBooking guard (conversation/expiry-poller.ts).
describe('cancel_appointment releases session capacity (bug fix)', () => {
  it('normal cancel: releases capacity for a session-class booking (sessionInstanceId set)', async () => {
    const booking = makeBooking({ id: 42, bookingStatus: 'confirmed', sessionInstanceId: 7 });
    mFindBookingById.mockResolvedValue(booking);

    await executeTool('cancel_appointment', { business_id: 1, booking_id: 42 }, makeContext());

    expect(mReleaseCapacity).toHaveBeenCalledWith(7);
  });

  it('normal cancel: never calls releaseSessionCapacity for an open-slot booking (sessionInstanceId null)', async () => {
    const booking = makeBooking({ id: 42, bookingStatus: 'confirmed', sessionInstanceId: null });
    mFindBookingById.mockResolvedValue(booking);

    await executeTool('cancel_appointment', { business_id: 1, booking_id: 42 }, makeContext());

    expect(mReleaseCapacity).not.toHaveBeenCalled();
  });

  it('forfeiture branch (within cutoff): still releases capacity even though the credit is forfeited', async () => {
    const booking = makeBooking({
      id: 42,
      bookingStatus: 'confirmed',
      sessionInstanceId: 7,
      calendarDate: '2020-01-01',
      calendarTime: '10:00',
    });
    mFindBookingById.mockResolvedValue(booking);

    const res = await executeTool(
      'cancel_appointment',
      { business_id: 1, booking_id: 42, confirmed: true },
      makeContext({ cancellationCutoffEnabled: true, cancellationCutoffHours: 8 })
    );

    expect(res).toMatchObject({ success: true, credit_forfeited: true });
    expect(mReleaseCapacity).toHaveBeenCalledWith(7);
  });
});

// Merge note (git-sync, Phase 26/CONF-02 kept over a stale pre-Phase-26 draft):
// reschedule_session no longer touches the calendar directly at all — it
// creates the new booking as pending_owner_approval and leaves the OLD
// booking completely untouched (no delete, no cancel) until the owner taps
// Έγκριση/Απόρριψη. Calendar sync (processBookingConfirmedForCalendar) and the
// old booking's cascade-cancel both happen later, in the sbk:approve handler
// (webhooks/telegram.ts, covered by tests/telegram-webhook.test.ts) — a
// reject must never destroy the client's only active booking (CONF-02).
describe('reschedule_session pending-approval behavior (Phase 26/CONF-02)', () => {
  const original = makeBooking({ id: 10, bookingStatus: 'confirmed', sessionInstanceId: 5, googleCalendarEventId: 'evt-old' });
  const args = { business_id: 1, booking_id: 10, new_session_instance_id: 6 };

  beforeEach(() => {
    mFindBookingById.mockImplementation(async (_b: number, id: number) => (id === 10 ? original : null));
    mListSessions.mockResolvedValue([
      { instanceId: 6, catalogId: 1, sessionDate: '2026-07-17', sessionTime: '18:00', bookedCount: 1, capacity: 8, serviceId: 2 },
    ]);
  });

  it('success: new booking created pending approval; old booking and calendar are untouched; owner gets an Έγκριση/Απόρριψη prompt', async () => {
    mBookSession.mockResolvedValue({ status: 'success', bookingId: 11 });
    mFindMembership.mockResolvedValue(77);

    const res = await executeTool('reschedule_session', args, makeContext());

    expect(res).toEqual({
      success: true,
      booking_id: 11,
      status: 'pending_owner_approval',
      new_session_date: '2026-07-17',
      new_session_time: '18:00',
      message:
        'Το αίτημα μετακίνησης στάλθηκε στην επιχείρηση για έγκριση. Η αρχική σας κράτηση παραμένει ενεργή μέχρι να απαντήσει η επιχείρηση.',
    });
    // Calendar and old-booking mutation are deferred to sbk:approve — neither
    // runs here.
    expect(mDelete).not.toHaveBeenCalled();
    expect(mProcess).not.toHaveBeenCalled();
    expect(mUpdateStatus).not.toHaveBeenCalled();
    // bookSessionInstance is called credit-neutral (null membership) and
    // linked (not re-deducted) to the original's ledger row.
    expect(mBookSession).toHaveBeenCalledWith(1, 6, '3941234567', 2, expect.any(String), null, undefined, 10);
    expect(mLinkRescheduled).toHaveBeenCalledWith(77, 11);
    // Owner gets the approve/reject keyboard, not a plain FYI message.
    expect(mSendKeyboard).toHaveBeenCalledWith(
      '999',
      expect.stringContaining('2026-07-17'),
      [[
        { text: 'Έγκριση', callback_data: 'sbk:approve:11' },
        { text: 'Απόρριψη', callback_data: 'sbk:reject:11' },
      ]]
    );
    expect(mUpdateOwnerMessageId).toHaveBeenCalledWith(11, 1);
  });

  it('new session full: no booking created, old booking untouched, no owner prompt sent', async () => {
    mBookSession.mockResolvedValue({ status: 'full' });

    const res = await executeTool('reschedule_session', args, makeContext());

    expect(res).toMatchObject({ success: false, error: 'reschedule_failed_full' });
    expect(mDelete).not.toHaveBeenCalled();
    expect(mProcess).not.toHaveBeenCalled();
    expect(mUpdateStatus).not.toHaveBeenCalled();
    expect(mSendKeyboard).not.toHaveBeenCalled();
  });

  it('owner alert failure never turns a successful reschedule into an error', async () => {
    mBookSession.mockResolvedValue({ status: 'success', bookingId: 11 });
    mSendKeyboard.mockRejectedValueOnce(new Error('telegram down'));

    const res = await executeTool('reschedule_session', args, makeContext());

    expect(res).toMatchObject({ success: true, booking_id: 11, status: 'pending_owner_approval' });
  });
});
