import * as queries from '../src/database/queries';
import * as availability from '../src/business/availability';
import * as telegramClient from '../src/telegram/client';
import * as calendarSync from '../src/calendar/sync';
import * as billingQueries from '../src/billing/queries';
import { executeTool, ToolContext } from '../src/conversation/function-executor';

jest.mock('../src/database/queries');
jest.mock('../src/business/availability');
jest.mock('../src/telegram/client');
jest.mock('../src/calendar/sync');
// Phase 8: mock billing queries so enforcement/deduction/restore functions do not reach real DB
jest.mock('../src/billing/queries', () => ({
  getActiveMembershipForDeduction: jest.fn(),
  findMembershipByBooking: jest.fn(),
  deductSession: jest.fn(),
  restoreCredit: jest.fn(),
  getClientName: jest.fn(),
}));

const mockedFindServiceById = queries.findServiceById as jest.MockedFunction<typeof queries.findServiceById>;
const mockedInsertBooking = queries.insertBooking as jest.MockedFunction<typeof queries.insertBooking>;
const mockedFindBookingByRequestId = queries.findBookingByRequestId as jest.MockedFunction<
  typeof queries.findBookingByRequestId
>;
const mockedFindBookingById = queries.findBookingById as jest.MockedFunction<typeof queries.findBookingById>;
const mockedUpdateBookingStatus = queries.updateBookingStatus as jest.MockedFunction<
  typeof queries.updateBookingStatus
>;
const mockedUpdateBookingOwnerMessageId = queries.updateBookingOwnerMessageId as jest.MockedFunction<
  typeof queries.updateBookingOwnerMessageId
>;
const mockedCheckAvailability = availability.checkAvailability as jest.MockedFunction<
  typeof availability.checkAvailability
>;
const mockedSendTelegramMessage = telegramClient.sendTelegramMessage as jest.MockedFunction<
  typeof telegramClient.sendTelegramMessage
>;
const mockedSendTelegramMessageWithKeyboard = telegramClient.sendTelegramMessageWithKeyboard as jest.MockedFunction<
  typeof telegramClient.sendTelegramMessageWithKeyboard
>;
const mockedFindBusinessById = queries.findBusinessById as jest.MockedFunction<typeof queries.findBusinessById>;
const mockedDeleteBookingFromCalendar = calendarSync.deleteBookingFromCalendar as jest.MockedFunction<
  typeof calendarSync.deleteBookingFromCalendar
>;
// Phase 8: billing mock variables
const mockedGetActiveMembership = billingQueries.getActiveMembershipForDeduction as jest.MockedFunction<
  typeof billingQueries.getActiveMembershipForDeduction
>;
const mockedFindMembershipByBooking = billingQueries.findMembershipByBooking as jest.MockedFunction<
  typeof billingQueries.findMembershipByBooking
>;
const mockedDeductSession = billingQueries.deductSession as jest.MockedFunction<
  typeof billingQueries.deductSession
>;
const mockedRestoreCredit = billingQueries.restoreCredit as jest.MockedFunction<
  typeof billingQueries.restoreCredit
>;
const mockedGetClientName = billingQueries.getClientName as jest.MockedFunction<
  typeof billingQueries.getClientName
>;

const BUSINESS: ToolContext['business'] = { id: 1, name: 'Pilates Athens', ownerTelegramId: '999' };
const CONTEXT: ToolContext = { business: BUSINESS, clientPhone: 'c1', requestId: 'r1', idempotencyKey: 'ik1' };

const SERVICE = {
  id: 2,
  businessId: 1,
  name: 'Reformer Pilates',
  durationMin: 50,
  price: 3500,
  createdAt: new Date(),
};

function makeBooking(overrides: Partial<queries.Booking> = {}): queries.Booking {
  return {
    id: 42,
    businessId: 1,
    clientPhone: 'c1',
    serviceId: 2,
    calendarDate: '2026-07-10',
    calendarTime: '10:00',
    bookingStatus: 'pending_owner_approval',
    requestId: 'r1',
    ownerTelegramMessageId: null,
    rescheduledFromBookingId: null,
    calendarSyncStatus: 'pending',
    googleCalendarEventId: null,
    calendarSyncRetryCount: 0,
    reminder24hSentAt: null,
    reminder1hSentAt: null,
    createdAt: new Date(),
    expiresAt: new Date(),
    ...overrides,
  };
}

describe('executeTool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Phase 8: safe defaults — no membership exists; no deduction row; client name not registered
    mockedGetActiveMembership.mockResolvedValue(null);
    mockedFindMembershipByBooking.mockResolvedValue(null);
    mockedDeductSession.mockResolvedValue(undefined);
    mockedRestoreCredit.mockResolvedValue(undefined);
    mockedGetClientName.mockResolvedValue(null);
  });

  it('Test 1: check_availability delegates to checkAvailability unchanged', async () => {
    mockedCheckAvailability.mockResolvedValue({ availableSlots: ['09:00'], closed: false });

    const result = await executeTool(
      'check_availability',
      { business_id: 1, service_id: 2, calendar_date: '2026-07-10' },
      CONTEXT
    );

    expect(mockedCheckAvailability).toHaveBeenCalledWith(1, 2, '2026-07-10');
    expect(result).toEqual({ availableSlots: ['09:00'], closed: false });
  });

  it('Test 2: business_id mismatch -> cross_tenant_denied for two different tool names, no downstream call', async () => {
    const result1 = await executeTool(
      'check_availability',
      { business_id: 999, service_id: 2, calendar_date: '2026-07-10' },
      CONTEXT
    );
    const result2 = await executeTool(
      'book_appointment',
      { business_id: 999, service_id: 2, calendar_date: '2026-07-10', calendar_time: '10:00' },
      CONTEXT
    );

    expect(result1).toEqual({ error: 'cross_tenant_denied' });
    expect(result2).toEqual({ error: 'cross_tenant_denied' });
    expect(mockedCheckAvailability).not.toHaveBeenCalled();
    expect(mockedInsertBooking).not.toHaveBeenCalled();
  });

  it('Test 3: book_appointment success -> owner alert with keyboard, ownerMessageId stored, structured success', async () => {
    mockedFindServiceById.mockResolvedValue(SERVICE);
    const booking = makeBooking();
    mockedInsertBooking.mockResolvedValue(booking);
    mockedSendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 555 });

    const result = await executeTool(
      'book_appointment',
      { business_id: 1, service_id: 2, calendar_date: '2026-07-10', calendar_time: '10:00' },
      CONTEXT
    );

    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledTimes(1);
    const [chatId, text, keyboard] = mockedSendTelegramMessageWithKeyboard.mock.calls[0];
    expect(chatId).toBe('999');
    expect(text).toContain('Reformer Pilates');
    expect(text).toContain('2026-07-10');
    expect(text).toContain('10:00');
    expect(keyboard).toEqual([
      [
        { text: 'Αποδοχή', callback_data: 'approve_42' },
        { text: 'Απόρριψη', callback_data: 'reject_42' },
      ],
    ]);
    expect(mockedUpdateBookingOwnerMessageId).toHaveBeenCalledWith(42, 555);
    expect(result).toEqual({ success: true, booking_id: 42, status: 'pending_owner_approval' });

    // CR-02: insertBooking's requestId field must be the per-call
    // idempotencyKey ('ik1'), never the turn-constant requestId ('r1') —
    // otherwise a second distinct booking in the same turn would collide.
    expect(mockedInsertBooking).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: CONTEXT.idempotencyKey })
    );
    expect(mockedInsertBooking).not.toHaveBeenCalledWith(
      expect.objectContaining({ requestId: CONTEXT.requestId })
    );
  });

  it('Test 4: book_appointment with unknown service_id -> service_not_found, no insert/alert', async () => {
    mockedFindServiceById.mockResolvedValue(null);

    const result = await executeTool(
      'book_appointment',
      { business_id: 1, service_id: 999, calendar_date: '2026-07-10', calendar_time: '10:00' },
      CONTEXT
    );

    expect(result).toEqual({ success: false, error: 'service_not_found' });
    expect(mockedInsertBooking).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessageWithKeyboard).not.toHaveBeenCalled();
  });

  it('Test 5: book_appointment idempotent retry (insertBooking null, findBookingByRequestId finds prior row) -> no duplicate alert', async () => {
    mockedFindServiceById.mockResolvedValue(SERVICE);
    mockedInsertBooking.mockResolvedValue(null);
    mockedFindBookingByRequestId.mockResolvedValue(makeBooking({ id: 42, bookingStatus: 'pending_owner_approval' }));

    const result = await executeTool(
      'book_appointment',
      { business_id: 1, service_id: 2, calendar_date: '2026-07-10', calendar_time: '10:00' },
      CONTEXT
    );

    expect(result).toEqual({ success: true, booking_id: 42, status: 'pending_owner_approval' });
    expect(mockedSendTelegramMessageWithKeyboard).not.toHaveBeenCalled();
  });

  it('Test 6: book_appointment genuine slot conflict (insertBooking null, no prior request row) -> slot_taken, no alert', async () => {
    mockedFindServiceById.mockResolvedValue(SERVICE);
    mockedInsertBooking.mockResolvedValue(null);
    mockedFindBookingByRequestId.mockResolvedValue(null);

    const result = await executeTool(
      'book_appointment',
      { business_id: 1, service_id: 2, calendar_date: '2026-07-10', calendar_time: '10:00' },
      CONTEXT
    );

    expect(result).toEqual({ success: false, error: 'slot_taken' });
    expect(mockedSendTelegramMessageWithKeyboard).not.toHaveBeenCalled();
  });

  it('Test 7: cancel_appointment (own booking, confirmed) -> status update, owner FYI (no keyboard), client confirmation', async () => {
    mockedFindBookingById.mockResolvedValue(makeBooking({ bookingStatus: 'confirmed' }));
    mockedFindServiceById.mockResolvedValue(SERVICE);

    const result = await executeTool('cancel_appointment', { business_id: 1, booking_id: 42 }, CONTEXT);

    expect(mockedUpdateBookingStatus).toHaveBeenCalledWith(42, 'cancelled');
    expect(mockedSendTelegramMessage).toHaveBeenCalledTimes(2);
    const [ownerChatId, ownerText] = mockedSendTelegramMessage.mock.calls[0];
    expect(ownerChatId).toBe('999');
    expect(ownerText).not.toContain('Αποδοχή');
    const [clientChatId] = mockedSendTelegramMessage.mock.calls[1];
    expect(clientChatId).toBe('c1');
    expect(result).toEqual({ success: true, booking_id: 42 });
  });

  it('Test 13 (CR-03a): cancel_appointment still reports success when the Telegram notification fails after the DB mutation lands', async () => {
    mockedFindBookingById.mockResolvedValue(makeBooking({ bookingStatus: 'confirmed' }));
    mockedFindServiceById.mockResolvedValue(SERVICE);
    mockedSendTelegramMessage.mockRejectedValueOnce(new Error('telegram down'));

    const result = await executeTool('cancel_appointment', { business_id: 1, booking_id: 42 }, CONTEXT);

    expect(mockedUpdateBookingStatus).toHaveBeenCalledWith(42, 'cancelled');
    expect(result).toEqual({ success: true, booking_id: 42 });
  });

  it('Test 15 (Plan 03-02): cancel_appointment fetches the full Business row and calls deleteBookingFromCalendar; a rejected delete still reports success', async () => {
    mockedFindBookingById.mockResolvedValue(makeBooking({ bookingStatus: 'confirmed' }));
    mockedFindServiceById.mockResolvedValue(SERVICE);
    const fullBusiness: queries.Business = {
      id: 1,
      name: 'Pilates Athens',
      slug: 'pilates-athens',
      phoneNumberId: null,
      ownerTelegramId: '999',
      googleRefreshToken: 'rt-1',
      agendaSentDate: null,
      botToken: null,
      webhookId: null,
      webhookSecret: null,
      enforcementPolicy: 'allow',
      createdAt: new Date(),
    };
    mockedFindBusinessById.mockResolvedValue(fullBusiness);
    mockedDeleteBookingFromCalendar.mockRejectedValueOnce(new Error('calendar down'));

    const result = await executeTool('cancel_appointment', { business_id: 1, booking_id: 42 }, CONTEXT);

    expect(mockedFindBusinessById).toHaveBeenCalledWith(1);
    expect(mockedDeleteBookingFromCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42 }),
      fullBusiness
    );
    expect(result).toEqual({ success: true, booking_id: 42 });
  });

  it('Test 8: cancel_appointment for a booking belonging to a different client -> not_your_booking, no mutation', async () => {
    mockedFindBookingById.mockResolvedValue(makeBooking({ clientPhone: 'someone-else' }));

    const result = await executeTool('cancel_appointment', { business_id: 1, booking_id: 42 }, CONTEXT);

    expect(result).toEqual({ success: false, error: 'not_your_booking' });
    expect(mockedUpdateBookingStatus).not.toHaveBeenCalled();
  });

  it('Test 9: cancel_appointment for a nonexistent booking -> booking_not_found', async () => {
    mockedFindBookingById.mockResolvedValue(null);

    const result = await executeTool('cancel_appointment', { business_id: 1, booking_id: 999 }, CONTEXT);

    expect(result).toEqual({ success: false, error: 'booking_not_found' });
  });

  it('Test 10: reschedule_appointment success -> new booking references original, keyboard encodes NEW id, original untouched', async () => {
    const original = makeBooking({ id: 7, bookingStatus: 'confirmed' });
    mockedFindBookingById.mockResolvedValue(original);
    mockedFindServiceById.mockResolvedValue(SERVICE);
    const newBooking = makeBooking({ id: 99, rescheduledFromBookingId: 7 });
    mockedInsertBooking.mockResolvedValue(newBooking);
    mockedSendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 777 });

    const result = await executeTool(
      'reschedule_appointment',
      { business_id: 1, booking_id: 7, service_id: 2, calendar_date: '2026-07-11', calendar_time: '11:00' },
      CONTEXT
    );

    expect(mockedInsertBooking).toHaveBeenCalledWith(
      expect.objectContaining({ rescheduledFromBookingId: 7 })
    );
    const [, , keyboard] = mockedSendTelegramMessageWithKeyboard.mock.calls[0];
    expect(keyboard).toEqual([
      [
        { text: 'Αποδοχή', callback_data: 'approve_99' },
        { text: 'Απόρριψη', callback_data: 'reject_99' },
      ],
    ]);
    expect(mockedUpdateBookingStatus).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, booking_id: 99, status: 'pending_owner_approval' });

    // CR-02: reschedule's insertBooking must also key off the per-call
    // idempotencyKey, not the turn-constant requestId.
    expect(mockedInsertBooking).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: CONTEXT.idempotencyKey })
    );
  });

  it('Test 14 (CR-03b): reschedule_appointment still reports success when the owner-alert Telegram send fails after the new booking already landed', async () => {
    const original = makeBooking({ id: 7, bookingStatus: 'confirmed' });
    mockedFindBookingById.mockResolvedValue(original);
    mockedFindServiceById.mockResolvedValue(SERVICE);
    const newBooking = makeBooking({ id: 99, rescheduledFromBookingId: 7 });
    mockedInsertBooking.mockResolvedValue(newBooking);
    mockedSendTelegramMessageWithKeyboard.mockRejectedValueOnce(new Error('telegram down'));

    const result = await executeTool(
      'reschedule_appointment',
      { business_id: 1, booking_id: 7, service_id: 2, calendar_date: '2026-07-11', calendar_time: '11:00' },
      CONTEXT
    );

    expect(mockedInsertBooking).toHaveBeenCalledWith(
      expect.objectContaining({ rescheduledFromBookingId: 7 })
    );
    expect(result).toEqual({ success: true, booking_id: 99, status: 'pending_owner_approval' });
  });

  it('Test 11: reschedule_appointment for a booking belonging to a different client -> not_your_booking, no insert', async () => {
    mockedFindBookingById.mockResolvedValue(makeBooking({ clientPhone: 'someone-else' }));

    const result = await executeTool(
      'reschedule_appointment',
      { business_id: 1, booking_id: 7, service_id: 2, calendar_date: '2026-07-11', calendar_time: '11:00' },
      CONTEXT
    );

    expect(result).toEqual({ success: false, error: 'not_your_booking' });
    expect(mockedInsertBooking).not.toHaveBeenCalled();
  });

  it('Test 12: unknown tool name -> structured not-found error', async () => {
    const result = await executeTool('not_a_real_tool', {}, CONTEXT);

    expect(result).toEqual({ error: "Tool 'not_a_real_tool' not found" });
  });
});

describe('Phase 8: enforcement + session deduction', () => {
  // Business + context with enforcementPolicy for Phase 8 tests
  const PHASE8_BUSINESS: ToolContext['business'] = {
    id: 1,
    name: 'Pilates Athens',
    ownerTelegramId: '999',
    enforcementPolicy: 'block',
  };
  const PHASE8_CONTEXT: ToolContext = {
    business: PHASE8_BUSINESS,
    clientPhone: 'c1',
    requestId: 'r1',
    idempotencyKey: 'ik1',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Phase 8: safe defaults — same as parent describe
    mockedGetActiveMembership.mockResolvedValue(null);
    mockedFindMembershipByBooking.mockResolvedValue(null);
    mockedDeductSession.mockResolvedValue(undefined);
    mockedRestoreCredit.mockResolvedValue(undefined);
    mockedGetClientName.mockResolvedValue(null);
  });

  it('block policy: executeTool(book_appointment) returns Greek refusal and does NOT call insertBooking when client has no active membership', async () => {
    mockedFindServiceById.mockResolvedValue(SERVICE);
    // getActiveMembership returns null (no membership) — default from beforeEach
    // insertBooking is mocked to confirm it is NOT called
    mockedInsertBooking.mockResolvedValue(makeBooking());

    const result = await executeTool(
      'book_appointment',
      { business_id: 1, service_id: 2, calendar_date: '2026-07-10', calendar_time: '10:00' },
      PHASE8_CONTEXT
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('no_membership');
    expect(typeof result.message).toBe('string');
    expect(result.message as string).toContain('ενεργή συνδρομή');
    // ENFC-02: insertBooking must NOT be called when block policy + no membership (D-10)
    expect(mockedInsertBooking.mock.calls.length).toBe(0);
  });

  it('flag policy: executeTool(book_appointment) calls sendTelegramMessage with flag alert BEFORE sendTelegramMessageWithKeyboard when client has no active membership', async () => {
    const flagContext: ToolContext = {
      ...PHASE8_CONTEXT,
      business: { ...PHASE8_BUSINESS, enforcementPolicy: 'flag' },
    };
    mockedFindServiceById.mockResolvedValue(SERVICE);
    // getActiveMembership returns null (no membership) — default from beforeEach
    mockedInsertBooking.mockResolvedValue(makeBooking());
    mockedSendTelegramMessage.mockResolvedValue({ messageId: 100 });
    mockedSendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 200 });

    await executeTool(
      'book_appointment',
      { business_id: 1, service_id: 2, calendar_date: '2026-07-10', calendar_time: '10:00' },
      flagContext
    );

    // Flag alert must have been sent with the owner's telegram ID and contain flag text
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(
      '999',
      expect.stringContaining('χωρίς ενεργή συνδρομή')
    );
    // ENFC-03 / D-11: sendTelegramMessage (flag alert) must fire BEFORE sendTelegramMessageWithKeyboard (owner keyboard)
    const flagCallOrder = mockedSendTelegramMessage.mock.invocationCallOrder[0];
    const keyboardCallOrder = mockedSendTelegramMessageWithKeyboard.mock.invocationCallOrder[0];
    expect(flagCallOrder).toBeLessThan(keyboardCallOrder);
  });

  it('finite membership: executeTool(book_appointment) calls deductSession(membershipId, bookingId, idempotencyKey) after insertBooking succeeds', async () => {
    const allowContext: ToolContext = {
      ...PHASE8_CONTEXT,
      business: { ...PHASE8_BUSINESS, enforcementPolicy: 'allow' },
    };
    mockedFindServiceById.mockResolvedValue(SERVICE);
    mockedGetActiveMembership.mockResolvedValue({
      id: 10,
      sessionsRemaining: 5,
      expiresAt: new Date(Date.now() + 86400000),
    });
    mockedInsertBooking.mockResolvedValue(makeBooking({ id: 42 }));
    mockedSendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 555 });

    await executeTool(
      'book_appointment',
      { business_id: 1, service_id: 2, calendar_date: '2026-07-10', calendar_time: '10:00' },
      allowContext
    );

    expect(mockedDeductSession).toHaveBeenCalledWith(10, 42, 'booking:42:deduction');
  });

  it('unlimited membership (sessionsRemaining: null): executeTool(book_appointment) does NOT call deductSession', async () => {
    const allowContext: ToolContext = {
      ...PHASE8_CONTEXT,
      business: { ...PHASE8_BUSINESS, enforcementPolicy: 'allow' },
    };
    mockedFindServiceById.mockResolvedValue(SERVICE);
    mockedGetActiveMembership.mockResolvedValue({
      id: 10,
      sessionsRemaining: null,
      expiresAt: new Date(Date.now() + 86400000),
    });
    mockedInsertBooking.mockResolvedValue(makeBooking({ id: 42 }));
    mockedSendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 555 });

    await executeTool(
      'book_appointment',
      { business_id: 1, service_id: 2, calendar_date: '2026-07-10', calendar_time: '10:00' },
      allowContext
    );

    // D-06: unlimited membership — deductSession must NOT be called
    expect(mockedDeductSession.mock.calls.length).toBe(0);
  });

  it('executeTool(cancel_appointment) calls restoreCredit(membershipId, bookingId, idempotencyKey) after updateBookingStatus when findMembershipByBooking returns a membershipId', async () => {
    mockedFindBookingById.mockResolvedValue(makeBooking({ id: 42, bookingStatus: 'confirmed' }));
    mockedFindServiceById.mockResolvedValue(SERVICE);
    mockedFindMembershipByBooking.mockResolvedValue(77);
    mockedUpdateBookingStatus.mockResolvedValue(undefined);

    await executeTool('cancel_appointment', { business_id: 1, booking_id: 42 }, CONTEXT);

    expect(mockedRestoreCredit).toHaveBeenCalledWith(77, 42, 'booking:42:credit');
  });

  it('executeTool(cancel_appointment) does NOT call restoreCredit when findMembershipByBooking returns null', async () => {
    mockedFindBookingById.mockResolvedValue(makeBooking({ id: 42, bookingStatus: 'confirmed' }));
    mockedFindServiceById.mockResolvedValue(SERVICE);
    // findMembershipByBooking returns null — default from beforeEach
    mockedUpdateBookingStatus.mockResolvedValue(undefined);

    await executeTool('cancel_appointment', { business_id: 1, booking_id: 42 }, CONTEXT);

    // Pitfall 4: no membership deduction row → restoreCredit must NOT be called
    expect(mockedRestoreCredit.mock.calls.length).toBe(0);
  });
});

// Phase 9: check_membership_balance tool — NOTF-04
describe('check_membership_balance tool — NOTF-04', () => {
  // Reset mock state between tests to prevent leakage
  beforeEach(() => {
    mockedGetActiveMembership.mockReset();
  });

  it('returns no-membership Greek message when getActiveMembershipForDeduction returns null (D-08 scenario 1)', async () => {
    mockedGetActiveMembership.mockResolvedValue(null);

    const result = await executeTool(
      'check_membership_balance',
      { business_id: BUSINESS.id },
      CONTEXT
    );

    expect(result.success).toBe(true);
    expect(typeof result.message).toBe('string');
    expect(result.message as string).toContain('Δεν βρέθηκε ενεργή συνδρομή');
    expect(result.message as string).toContain(BUSINESS.name);
  });

  it('returns unlimited-sessions Greek message when sessionsRemaining is null (D-08 scenario 2)', async () => {
    // Noon UTC on 14/08/2026 = 15:00 Athens (UTC+3 DST) — unambiguously the same Athens calendar day.
    // Using 22:00 UTC would cross midnight in Athens (01:00 +03:00 = 15/08), producing '15/08/2026'.
    mockedGetActiveMembership.mockResolvedValue({
      id: 1,
      sessionsRemaining: null,
      expiresAt: new Date('2026-08-14T12:00:00Z'),
    });

    const result = await executeTool(
      'check_membership_balance',
      { business_id: BUSINESS.id },
      CONTEXT
    );

    expect(result.success).toBe(true);
    expect(result.message as string).toContain('απεριόριστων μαθημάτων');
    expect(result.message as string).toContain('14/08/2026');
  });

  it('returns counted-sessions Greek message with N remaining when sessionsRemaining is a number (D-08 scenario 3)', async () => {
    // Noon UTC — same DST-safe anchor as Test 2 (avoids midnight-in-Athens ambiguity).
    mockedGetActiveMembership.mockResolvedValue({
      id: 2,
      sessionsRemaining: 5,
      expiresAt: new Date('2026-08-14T12:00:00Z'),
    });

    const result = await executeTool(
      'check_membership_balance',
      { business_id: BUSINESS.id },
      CONTEXT
    );

    expect(result.success).toBe(true);
    expect(result.message as string).toContain('5 μαθήματα απομείνει');
    expect(result.message as string).toContain('14/08/2026');
  });

  it('returns cross_tenant_denied when args.business_id differs from context.business.id', async () => {
    const result = await executeTool(
      'check_membership_balance',
      { business_id: 9999 },
      CONTEXT // CONTEXT.business.id is 1, not 9999
    );

    expect(result).toEqual({ error: 'cross_tenant_denied' });
  });
});
