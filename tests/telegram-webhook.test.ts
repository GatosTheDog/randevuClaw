import request from 'supertest';
import app from '../src/server';
import * as queries from '../src/database/queries';
import * as telegramClient from '../src/telegram/client';
import * as router from '../src/conversation/router';
import { parseCallbackData } from '../src/webhooks/telegram';

jest.mock('../src/database/queries');
jest.mock('../src/telegram/client');
jest.mock('../src/conversation/router');

const SECRET = 'test-telegram-webhook-secret';

const KNOWN_BUSINESS = {
  id: 1,
  name: 'Pilates Athens',
  slug: 'pilates-athens',
  phoneNumberId: null,
  ownerTelegramId: '999999999',
  googleRefreshToken: null,
  agendaSentDate: null,
  createdAt: new Date(),
};

const mockedFindBusinessBySlug = queries.findBusinessBySlug as jest.MockedFunction<
  typeof queries.findBusinessBySlug
>;
const mockedInsertOrIgnoreTelegramUpdate = queries.insertOrIgnoreTelegramUpdate as jest.MockedFunction<
  typeof queries.insertOrIgnoreTelegramUpdate
>;
const mockedMarkTelegramUpdateProcessed = queries.markTelegramUpdateProcessed as jest.MockedFunction<
  typeof queries.markTelegramUpdateProcessed
>;
const mockedSendTelegramMessage = telegramClient.sendTelegramMessage as jest.MockedFunction<
  typeof telegramClient.sendTelegramMessage
>;
const mockedRouteConversationMessage = router.routeConversationMessage as jest.MockedFunction<
  typeof router.routeConversationMessage
>;
const mockedFindBookingByIdUnscoped = queries.findBookingByIdUnscoped as jest.MockedFunction<
  typeof queries.findBookingByIdUnscoped
>;
const mockedFindBusinessById = queries.findBusinessById as jest.MockedFunction<
  typeof queries.findBusinessById
>;
const mockedUpdateBookingStatus = queries.updateBookingStatus as jest.MockedFunction<
  typeof queries.updateBookingStatus
>;
const mockedUpdateBookingStatusIfPending = queries.updateBookingStatusIfPending as jest.MockedFunction<
  typeof queries.updateBookingStatusIfPending
>;
const mockedFindServiceById = queries.findServiceById as jest.MockedFunction<
  typeof queries.findServiceById
>;
const mockedAnswerCallbackQuery = telegramClient.answerCallbackQuery as jest.MockedFunction<
  typeof telegramClient.answerCallbackQuery
>;
const mockedEditTelegramMessageReplyMarkup = telegramClient.editTelegramMessageReplyMarkup as jest.MockedFunction<
  typeof telegramClient.editTelegramMessageReplyMarkup
>;

function makeMessageUpdate(updateId: number, text: string, fromId = 111222333) {
  return {
    update_id: updateId,
    message: {
      message_id: 500 + updateId,
      from: { id: fromId, is_bot: false, first_name: 'Test' },
      chat: { id: fromId, type: 'private' },
      date: 1234567890,
      text,
    },
  };
}

function makeCallbackQueryUpdate(
  updateId: number,
  fromId: number | string = 111222333,
  data = 'approve_7'
) {
  return {
    update_id: updateId,
    callback_query: {
      id: 'cbq-1',
      from: { id: fromId, is_bot: false, first_name: 'Owner' },
      message: { message_id: 42, chat: { id: fromId, type: 'private' } },
      data,
    },
  };
}

// `secret` uses `null` (not `undefined`) as the "omit the header" sentinel:
// a default parameter is only substituted when the caller omits the argument
// or passes `undefined` explicitly, so passing `undefined` here would
// silently fall back to SECRET instead of testing the missing-header case.
async function postWebhook(body: object, secret: string | null = SECRET) {
  const req = request(app).post('/webhooks/telegram').set('Content-Type', 'application/json');
  if (secret !== null) req.set('X-Telegram-Bot-Api-Secret-Token', secret);
  return req.send(body);
}

describe('POST /webhooks/telegram', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedInsertOrIgnoreTelegramUpdate.mockResolvedValue('inserted');
    mockedMarkTelegramUpdateProcessed.mockResolvedValue(undefined);
    mockedSendTelegramMessage.mockResolvedValue({ messageId: 999 });
    mockedRouteConversationMessage.mockResolvedValue(undefined);
  });

  it('Test 1: recognized business code -> 200 + routeConversationMessage called with the channel adapter, not a direct reply', async () => {
    mockedFindBusinessBySlug.mockResolvedValue(KNOWN_BUSINESS);

    const res = await postWebhook(makeMessageUpdate(1, 'pilates-athens'));

    expect(res.status).toBe(200);
    expect(mockedRouteConversationMessage).toHaveBeenCalledTimes(1);
    const [business, senderId, messageText, channel] = mockedRouteConversationMessage.mock.calls[0];
    expect(business).toEqual(KNOWN_BUSINESS);
    expect(senderId).toBe('111222333');
    expect(messageText).toBe('pilates-athens');
    expect(channel.sendMessage).toBe(mockedSendTelegramMessage);
    expect(mockedSendTelegramMessage).not.toHaveBeenCalled();
    expect(mockedMarkTelegramUpdateProcessed).toHaveBeenCalledWith('1', 1);
  });

  it('Test 2: unrecognized business code -> 200 + BUSINESS_NOT_FOUND_REPLY_GREEK direct reply, routeConversationMessage never called', async () => {
    mockedFindBusinessBySlug.mockResolvedValue(null);

    const res = await postWebhook(makeMessageUpdate(2, 'unknown-business'));

    expect(res.status).toBe(200);
    expect(mockedSendTelegramMessage).toHaveBeenCalledTimes(1);
    const [, replyText] = mockedSendTelegramMessage.mock.calls[0];
    expect(replyText).toContain('Δεν αναγνωρίσαμε');
    expect(mockedRouteConversationMessage).not.toHaveBeenCalled();
  });

  it('Test 3: duplicate update_id -> routeConversationMessage called exactly once, not twice', async () => {
    mockedFindBusinessBySlug.mockResolvedValue(KNOWN_BUSINESS);

    mockedInsertOrIgnoreTelegramUpdate.mockResolvedValueOnce('inserted');
    await postWebhook(makeMessageUpdate(3, 'pilates-athens'));

    mockedInsertOrIgnoreTelegramUpdate.mockResolvedValueOnce('ignored');
    await postWebhook(makeMessageUpdate(3, 'pilates-athens'));

    expect(mockedRouteConversationMessage).toHaveBeenCalledTimes(1);
  });

  it('Test 4: missing/wrong secret token -> 403, neither sendTelegramMessage nor routeConversationMessage called', async () => {
    mockedFindBusinessBySlug.mockResolvedValue(KNOWN_BUSINESS);

    const resMissing = await postWebhook(makeMessageUpdate(4, 'pilates-athens'), null);
    expect(resMissing.status).toBe(403);

    const resWrong = await postWebhook(makeMessageUpdate(5, 'pilates-athens'), 'wrong-secret');
    expect(resWrong.status).toBe(403);

    expect(mockedSendTelegramMessage).not.toHaveBeenCalled();
    expect(mockedRouteConversationMessage).not.toHaveBeenCalled();
  });

  it('Test 6: callback_query update -> 200, no reply, no AI routing, still deduped by update_id', async () => {
    const res = await postWebhook(makeCallbackQueryUpdate(7));

    expect(res.status).toBe(200);
    expect(mockedSendTelegramMessage).not.toHaveBeenCalled();
    expect(mockedRouteConversationMessage).not.toHaveBeenCalled();
    expect(mockedInsertOrIgnoreTelegramUpdate).toHaveBeenCalledWith(
      '7',
      null,
      '111222333',
      'callback_query'
    );
  });
});

describe('parseCallbackData', () => {
  it('Test 4: parses valid approve/reject data, returns null for malformed/unknown-action/undefined/empty', () => {
    expect(parseCallbackData('approve_42')).toEqual({ action: 'approve', bookingId: 42 });
    expect(parseCallbackData('reject_7')).toEqual({ action: 'reject', bookingId: 7 });
    expect(parseCallbackData('approve_abc')).toBeNull();
    expect(parseCallbackData('delete_42')).toBeNull();
    expect(parseCallbackData(undefined)).toBeNull();
    expect(parseCallbackData('')).toBeNull();
  });
});

describe('POST /webhooks/telegram — callback_query owner approval (Plan 02-05)', () => {
  const PENDING_BOOKING = {
    id: 42,
    businessId: 1,
    clientPhone: 'c1',
    serviceId: 3,
    calendarDate: '2026-07-10',
    calendarTime: '10:00',
    bookingStatus: 'pending_owner_approval',
    requestId: 'req-42',
    ownerTelegramMessageId: 555,
    rescheduledFromBookingId: null,
    calendarSyncStatus: 'pending',
    googleCalendarEventId: null,
    calendarSyncRetryCount: 0,
    reminder24hSentAt: null,
    reminder1hSentAt: null,
    createdAt: new Date(),
    expiresAt: new Date(),
  };

  const OWNER_BUSINESS = {
    id: 1,
    name: 'Pilates Athens',
    slug: 'pilates-athens',
    phoneNumberId: null,
    ownerTelegramId: 'owner1',
    googleRefreshToken: null,
    agendaSentDate: null,
    createdAt: new Date(),
  };

  const SERVICE = {
    id: 3,
    businessId: 1,
    name: 'Ομαδικό Pilates',
    durationMin: 55,
    price: 1500,
    createdAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedInsertOrIgnoreTelegramUpdate.mockResolvedValue('inserted');
    mockedAnswerCallbackQuery.mockResolvedValue(undefined);
    mockedSendTelegramMessage.mockResolvedValue({ messageId: 999 });
    mockedUpdateBookingStatus.mockResolvedValue(undefined);
    mockedEditTelegramMessageReplyMarkup.mockResolvedValue(undefined);
    mockedFindServiceById.mockResolvedValue(SERVICE);
  });

  it('Test 5: approves a pending booking — acks first, confirms, notifies client, clears buttons', async () => {
    mockedFindBookingByIdUnscoped.mockResolvedValue(PENDING_BOOKING);
    mockedFindBusinessById.mockResolvedValue(OWNER_BUSINESS);
    mockedUpdateBookingStatusIfPending.mockResolvedValue({
      ...PENDING_BOOKING,
      bookingStatus: 'confirmed',
    });

    const res = await postWebhook(makeCallbackQueryUpdate(100, 'owner1', 'approve_42'));

    expect(res.status).toBe(200);
    expect(mockedAnswerCallbackQuery).toHaveBeenCalledWith('cbq-1', expect.any(String));
    expect(mockedUpdateBookingStatusIfPending).toHaveBeenCalledWith(42, 'confirmed');
    const [clientId, clientText] = mockedSendTelegramMessage.mock.calls[0];
    expect(clientId).toBe('c1');
    expect(clientText).toContain('Ομαδικό Pilates');
    expect(clientText).toContain('2026-07-10');
    expect(clientText).toContain('10:00');
    expect(mockedEditTelegramMessageReplyMarkup).toHaveBeenCalledWith('owner1', 555, []);

    // answerCallbackQuery must be the FIRST Telegram/DB call in the branch
    // (RESEARCH.md Pitfall 4) — verified via jest's global call-order counter.
    const ackOrder = mockedAnswerCallbackQuery.mock.invocationCallOrder[0];
    const bookingLookupOrder = mockedFindBookingByIdUnscoped.mock.invocationCallOrder[0];
    const updateOrder = mockedUpdateBookingStatusIfPending.mock.invocationCallOrder[0];
    expect(ackOrder).toBeLessThan(bookingLookupOrder);
    expect(ackOrder).toBeLessThan(updateOrder);
  });

  it('Test 6: rejects a pending booking — declines, notifies client, clears buttons, no cascade', async () => {
    mockedFindBookingByIdUnscoped.mockResolvedValue(PENDING_BOOKING);
    mockedFindBusinessById.mockResolvedValue(OWNER_BUSINESS);
    mockedUpdateBookingStatusIfPending.mockResolvedValue({
      ...PENDING_BOOKING,
      bookingStatus: 'rejected',
    });

    const res = await postWebhook(makeCallbackQueryUpdate(101, 'owner1', 'reject_42'));

    expect(res.status).toBe(200);
    expect(mockedUpdateBookingStatusIfPending).toHaveBeenCalledWith(42, 'rejected');
    expect(mockedUpdateBookingStatus).not.toHaveBeenCalled();
    const [clientId, clientText] = mockedSendTelegramMessage.mock.calls[0];
    expect(clientId).toBe('c1');
    expect(clientText.length).toBeGreaterThan(0);
    expect(mockedEditTelegramMessageReplyMarkup).toHaveBeenCalledWith('owner1', 555, []);
  });

  it('Test 7: reschedule approval cascades — confirms the new booking AND cancels the original', async () => {
    const rescheduleBooking = { ...PENDING_BOOKING, id: 99, rescheduledFromBookingId: 42 };
    mockedFindBookingByIdUnscoped.mockResolvedValue(rescheduleBooking);
    mockedFindBusinessById.mockResolvedValue(OWNER_BUSINESS);
    mockedUpdateBookingStatusIfPending.mockResolvedValue({
      ...rescheduleBooking,
      bookingStatus: 'confirmed',
    });

    await postWebhook(makeCallbackQueryUpdate(102, 'owner1', 'approve_99'));

    expect(mockedUpdateBookingStatusIfPending).toHaveBeenCalledWith(99, 'confirmed');
    expect(mockedUpdateBookingStatus).toHaveBeenCalledWith(42, 'cancelled');
  });

  it('Test 8: reschedule rejection does NOT cascade — only the new booking is touched', async () => {
    const rescheduleBooking = { ...PENDING_BOOKING, id: 99, rescheduledFromBookingId: 42 };
    mockedFindBookingByIdUnscoped.mockResolvedValue(rescheduleBooking);
    mockedFindBusinessById.mockResolvedValue(OWNER_BUSINESS);
    mockedUpdateBookingStatusIfPending.mockResolvedValue({
      ...rescheduleBooking,
      bookingStatus: 'rejected',
    });

    await postWebhook(makeCallbackQueryUpdate(103, 'owner1', 'reject_99'));

    expect(mockedUpdateBookingStatusIfPending).toHaveBeenCalledWith(99, 'rejected');
    expect(mockedUpdateBookingStatus).not.toHaveBeenCalled();
  });

  it('Test 9: malformed callback data — acks (dismiss spinner) but never looks up or mutates a booking', async () => {
    const res = await postWebhook(makeCallbackQueryUpdate(104, 'owner1', 'garbage'));

    expect(res.status).toBe(200);
    expect(mockedAnswerCallbackQuery).toHaveBeenCalledWith('cbq-1', undefined);
    expect(mockedFindBookingByIdUnscoped).not.toHaveBeenCalled();
    expect(mockedUpdateBookingStatus).not.toHaveBeenCalled();
  });

  it('Test 10: nonexistent booking id — no crash, no mutation, still 200', async () => {
    mockedFindBookingByIdUnscoped.mockResolvedValue(null);

    const res = await postWebhook(makeCallbackQueryUpdate(105, 'owner1', 'approve_9999'));

    expect(res.status).toBe(200);
    expect(mockedUpdateBookingStatus).not.toHaveBeenCalled();
  });

  it('Test 11: wrong owner / spoofed tap — no mutation, no client message', async () => {
    mockedFindBookingByIdUnscoped.mockResolvedValue(PENDING_BOOKING);
    mockedFindBusinessById.mockResolvedValue(OWNER_BUSINESS);

    const res = await postWebhook(makeCallbackQueryUpdate(106, 'someone-else', 'approve_42'));

    expect(res.status).toBe(200);
    expect(mockedUpdateBookingStatus).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessage).not.toHaveBeenCalled();
  });

  it('Test 12: already-resolved booking (re-tap) — no second transition, no duplicate client message', async () => {
    mockedFindBookingByIdUnscoped.mockResolvedValue({ ...PENDING_BOOKING, bookingStatus: 'confirmed' });
    mockedFindBusinessById.mockResolvedValue(OWNER_BUSINESS);
    // Simulates the atomic update finding no matching pending row: the
    // booking was already resolved by a prior tap.
    mockedUpdateBookingStatusIfPending.mockResolvedValue(null);

    const res = await postWebhook(makeCallbackQueryUpdate(107, 'owner1', 'approve_42'));

    expect(res.status).toBe(200);
    expect(mockedUpdateBookingStatusIfPending).toHaveBeenCalledWith(42, 'confirmed');
    expect(mockedUpdateBookingStatus).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessage).not.toHaveBeenCalled();
    expect(mockedEditTelegramMessageReplyMarkup).not.toHaveBeenCalled();
  });

  it('Test 13: concurrent double-tap on the same booking — exactly one client notification across both requests (WR-05)', async () => {
    mockedFindBookingByIdUnscoped.mockResolvedValue(PENDING_BOOKING);
    mockedFindBusinessById.mockResolvedValue(OWNER_BUSINESS);
    // First request "wins" the atomic compare-and-swap; the second, racing
    // in with the same callback data (a double-tap or Telegram redelivery),
    // "loses" and gets null back.
    mockedUpdateBookingStatusIfPending
      .mockResolvedValueOnce({ ...PENDING_BOOKING, bookingStatus: 'confirmed' })
      .mockResolvedValueOnce(null);

    const [firstRes, secondRes] = await Promise.all([
      postWebhook(makeCallbackQueryUpdate(200, 'owner1', 'approve_42')),
      postWebhook(makeCallbackQueryUpdate(201, 'owner1', 'approve_42')),
    ]);

    expect(firstRes.status).toBe(200);
    expect(secondRes.status).toBe(200);
    expect(mockedUpdateBookingStatusIfPending).toHaveBeenCalledTimes(2);
    expect(mockedSendTelegramMessage).toHaveBeenCalledTimes(1);
  });
});
