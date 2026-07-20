import request from 'supertest';
import crypto from 'crypto';
import app from '../src/server';
import * as queries from '../src/database/queries';
import * as whatsappClient from '../src/whatsapp/client';
import * as checker from '../src/consent/checker';

jest.mock('../src/database/queries');
jest.mock('../src/whatsapp/client');
jest.mock('../src/consent/checker');

const mockedInsertOrIgnoreMessage = queries.insertOrIgnoreMessage as jest.MockedFunction<
  typeof queries.insertOrIgnoreMessage
>;
const mockedMarkMessageProcessed = queries.markMessageProcessed as jest.MockedFunction<
  typeof queries.markMessageProcessed
>;
const mockedFindBusinessBySlug = queries.findBusinessBySlug as jest.MockedFunction<
  typeof queries.findBusinessBySlug
>;
const mockedFindMessageByWhatsappId = queries.findMessageByWhatsappId as jest.MockedFunction<
  typeof queries.findMessageByWhatsappId
>;
const mockedSendWhatsAppMessage = whatsappClient.sendWhatsAppMessage as jest.MockedFunction<
  typeof whatsappClient.sendWhatsAppMessage
>;
const mockedGetOrCreateClientRelationship =
  checker.getOrCreateClientRelationship as jest.MockedFunction<
    typeof checker.getOrCreateClientRelationship
  >;

const APP_SECRET = 'test-app-secret';
const KNOWN_BUSINESS = { id: 1, name: 'Pilates Athens', slug: 'pilates-athens', phoneNumberId: null, ownerTelegramId: null, googleRefreshToken: null, agendaSentDate: null, botToken: null, webhookId: null, webhookSecret: null, enforcementPolicy: 'allow', createdAt: new Date() };

function signPayload(bodyStr: string): string {
  return 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(bodyStr).digest('hex');
}

function makeTextPayload(msgId: string, messageBody: string): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              messages: [{ id: msgId, from: '306900000000', type: 'text', text: { body: messageBody } }],
            },
            field: 'messages',
          },
        ],
      },
    ],
  });
}

function makeNotFoundPayload(msgId: string): string {
  return makeTextPayload(msgId, 'zzz-not-a-business');
}

async function postWebhook(body: string) {
  return request(app)
    .post('/webhooks/whatsapp')
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', signPayload(body))
    .send(body);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedSendWhatsAppMessage.mockResolvedValue({ messageId: 'wamid.reply', status: 'sent' });
  mockedMarkMessageProcessed.mockResolvedValue(undefined);
  mockedGetOrCreateClientRelationship.mockResolvedValue({ isFirstContact: false, consentGiven: true });
});

describe('Test 1: duplicate business-found message is silently no-op-ed', () => {
  it('first delivery replies; second delivery with same message ID is ignored', async () => {
    mockedFindBusinessBySlug.mockResolvedValue(KNOWN_BUSINESS);
    mockedInsertOrIgnoreMessage
      .mockResolvedValueOnce('inserted') // first delivery
      .mockResolvedValueOnce('ignored'); // duplicate delivery

    const body = makeTextPayload('wamid.DUP001', 'pilates-athens');

    const res1 = await postWebhook(body);
    expect(res1.status).toBe(200);
    expect(mockedSendWhatsAppMessage).toHaveBeenCalledTimes(1);

    const res2 = await postWebhook(body);
    expect(res2.status).toBe(200);
    // Second delivery must NOT trigger another reply
    expect(mockedSendWhatsAppMessage).toHaveBeenCalledTimes(1);
  });
});

describe('Test 2: markMessageProcessed called only after sendWhatsAppMessage succeeds', () => {
  it('if sendWhatsAppMessage throws, markMessageProcessed is never called', async () => {
    mockedFindBusinessBySlug.mockResolvedValue(KNOWN_BUSINESS);
    mockedInsertOrIgnoreMessage.mockResolvedValue('inserted');
    mockedSendWhatsAppMessage.mockRejectedValue(new Error('network error'));

    const body = makeTextPayload('wamid.FAIL001', 'pilates-athens');
    const res = await postWebhook(body);

    expect(res.status).toBe(200); // Meta must always get 200
    expect(mockedMarkMessageProcessed).not.toHaveBeenCalled();
  });

  it('if sendWhatsAppMessage succeeds, markMessageProcessed IS called', async () => {
    mockedFindBusinessBySlug.mockResolvedValue(KNOWN_BUSINESS);
    mockedInsertOrIgnoreMessage.mockResolvedValue('inserted');

    const body = makeTextPayload('wamid.OK001', 'pilates-athens');
    await postWebhook(body);

    expect(mockedSendWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(mockedMarkMessageProcessed).toHaveBeenCalledWith('wamid.OK001');
  });
});

describe('Test 3: business-not-found path — no insertOrIgnoreMessage, existence check before reply', () => {
  it('when no prior row exists, sends BUSINESS_NOT_FOUND_REPLY_GREEK', async () => {
    mockedFindBusinessBySlug.mockResolvedValue(null);
    mockedFindMessageByWhatsappId.mockResolvedValue(null); // no prior row

    const body = makeNotFoundPayload('wamid.NF001');
    const res = await postWebhook(body);

    expect(res.status).toBe(200);
    expect(mockedInsertOrIgnoreMessage).not.toHaveBeenCalled();
    expect(mockedSendWhatsAppMessage).toHaveBeenCalledTimes(1);
    const [, replyText] = mockedSendWhatsAppMessage.mock.calls[0];
    expect(replyText).toContain('Δεν αναγνωρίσαμε');
  });

  it('when a prior row already exists (found→not-found race), suppresses the not-found reply', async () => {
    mockedFindBusinessBySlug.mockResolvedValue(null);
    mockedFindMessageByWhatsappId.mockResolvedValue({ id: 42 }); // prior row exists

    const body = makeNotFoundPayload('wamid.RACE001');
    const res = await postWebhook(body);

    expect(res.status).toBe(200);
    expect(mockedInsertOrIgnoreMessage).not.toHaveBeenCalled();
    expect(mockedSendWhatsAppMessage).not.toHaveBeenCalled();
  });
});
