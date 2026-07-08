import request from 'supertest';
import app from '../src/server';
import * as queries from '../src/database/queries';
import * as telegramClient from '../src/telegram/client';
import * as router from '../src/conversation/router';

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

function makeCallbackQueryUpdate(updateId: number, fromId = 111222333) {
  return {
    update_id: updateId,
    callback_query: {
      id: 'cbq-1',
      from: { id: fromId, is_bot: false, first_name: 'Owner' },
      message: { message_id: 42, chat: { id: fromId, type: 'private' } },
      data: 'approve_7',
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
