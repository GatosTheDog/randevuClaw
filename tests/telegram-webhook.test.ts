import request from 'supertest';
import app from '../src/server';
import * as queries from '../src/database/queries';
import * as telegramClient from '../src/telegram/client';
import { CONSENT_NOTICE_GREEK_TEMPLATE } from '../src/consent/checker';

jest.mock('../src/database/queries');
jest.mock('../src/telegram/client');

const SECRET = 'test-telegram-webhook-secret';

const KNOWN_BUSINESS = {
  id: 1,
  name: 'Pilates Athens',
  slug: 'pilates-athens',
  phoneNumberId: null,
  ownerTelegramId: '999999999',
  createdAt: new Date(),
};

const EXISTING_RELATIONSHIP = {
  id: 1,
  businessId: 1,
  senderPhone: '111222333',
  consentGiven: true,
  consentTimestamp: new Date(),
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
const mockedFindClientBusinessRelationship = queries.findClientBusinessRelationship as jest.MockedFunction<
  typeof queries.findClientBusinessRelationship
>;
const mockedInsertClientBusinessRelationship = queries.insertClientBusinessRelationship as jest.MockedFunction<
  typeof queries.insertClientBusinessRelationship
>;
const mockedSendTelegramMessage = telegramClient.sendTelegramMessage as jest.MockedFunction<
  typeof telegramClient.sendTelegramMessage
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

async function postWebhook(body: object, secret: string | undefined = SECRET) {
  const req = request(app).post('/webhooks/telegram').set('Content-Type', 'application/json');
  if (secret !== undefined) req.set('X-Telegram-Bot-Api-Secret-Token', secret);
  return req.send(body);
}

describe('POST /webhooks/telegram', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedInsertOrIgnoreTelegramUpdate.mockResolvedValue('inserted');
    mockedMarkTelegramUpdateProcessed.mockResolvedValue(undefined);
    mockedSendTelegramMessage.mockResolvedValue({ messageId: 999 });
    mockedFindClientBusinessRelationship.mockResolvedValue(EXISTING_RELATIONSHIP);
  });

  it('Test 1: recognized business code -> 200 + Greek reply containing business name', async () => {
    mockedFindBusinessBySlug.mockResolvedValue(KNOWN_BUSINESS);

    const res = await postWebhook(makeMessageUpdate(1, 'pilates-athens'));

    expect(res.status).toBe(200);
    expect(mockedSendTelegramMessage).toHaveBeenCalledTimes(1);
    const [, replyText] = mockedSendTelegramMessage.mock.calls[0];
    expect(replyText).toContain('Pilates Athens');
  });

  it('Test 2: unrecognized business code -> 200 + BUSINESS_NOT_FOUND_REPLY_GREEK', async () => {
    mockedFindBusinessBySlug.mockResolvedValue(null);

    const res = await postWebhook(makeMessageUpdate(2, 'unknown-business'));

    expect(res.status).toBe(200);
    expect(mockedSendTelegramMessage).toHaveBeenCalledTimes(1);
    const [, replyText] = mockedSendTelegramMessage.mock.calls[0];
    expect(replyText).toContain('Δεν αναγνωρίσαμε');
  });

  it('Test 3: duplicate update_id -> exactly one reply, not two', async () => {
    mockedFindBusinessBySlug.mockResolvedValue(KNOWN_BUSINESS);

    mockedInsertOrIgnoreTelegramUpdate.mockResolvedValueOnce('inserted');
    await postWebhook(makeMessageUpdate(3, 'pilates-athens'));

    mockedInsertOrIgnoreTelegramUpdate.mockResolvedValueOnce('ignored');
    await postWebhook(makeMessageUpdate(3, 'pilates-athens'));

    expect(mockedSendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it('Test 4: missing/wrong secret token -> 403, sendTelegramMessage never called', async () => {
    mockedFindBusinessBySlug.mockResolvedValue(KNOWN_BUSINESS);

    const resMissing = await postWebhook(makeMessageUpdate(4, 'pilates-athens'), undefined);
    expect(resMissing.status).toBe(403);

    const resWrong = await postWebhook(makeMessageUpdate(5, 'pilates-athens'), 'wrong-secret');
    expect(resWrong.status).toBe(403);

    expect(mockedSendTelegramMessage).not.toHaveBeenCalled();
  });

  it('Test 5: first-contact client receives consent notice prepended to business-found reply', async () => {
    mockedFindBusinessBySlug.mockResolvedValue(KNOWN_BUSINESS);
    mockedFindClientBusinessRelationship.mockResolvedValue(null);
    mockedInsertClientBusinessRelationship.mockResolvedValue({
      id: 2,
      businessId: 1,
      senderPhone: '111222333',
      consentGiven: true,
      consentTimestamp: new Date(),
      createdAt: new Date(),
    });

    const res = await postWebhook(makeMessageUpdate(6, 'pilates-athens'));

    expect(res.status).toBe(200);
    expect(mockedSendTelegramMessage).toHaveBeenCalledTimes(1);
    const [, replyText] = mockedSendTelegramMessage.mock.calls[0];
    expect(replyText).toContain(CONSENT_NOTICE_GREEK_TEMPLATE('Pilates Athens'));
    expect(replyText).toContain('Pilates Athens');
  });

  it('Test 6: callback_query update -> 200, no reply, still deduped by update_id', async () => {
    const res = await postWebhook(makeCallbackQueryUpdate(7));

    expect(res.status).toBe(200);
    expect(mockedSendTelegramMessage).not.toHaveBeenCalled();
    expect(mockedInsertOrIgnoreTelegramUpdate).toHaveBeenCalledWith(
      '7',
      null,
      '111222333',
      'callback_query'
    );
  });
});
