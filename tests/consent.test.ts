import request from 'supertest';
import crypto from 'crypto';
import app from '../src/server';
import * as queries from '../src/database/queries';
import * as whatsappClient from '../src/whatsapp/client';
import * as checker from '../src/consent/checker';
import { CONSENT_NOTICE_GREEK_TEMPLATE } from '../src/consent/checker';

jest.mock('../src/database/queries');
jest.mock('../src/whatsapp/client');

const KNOWN_BUSINESS = { id: 1, name: 'Pilates Athens', slug: 'pilates-athens', phoneNumberId: null, ownerTelegramId: null, googleRefreshToken: null, agendaSentDate: null, botToken: null, webhookId: null, webhookSecret: null, enforcementPolicy: 'allow', createdAt: new Date() };

const mockedFindBusinessBySlug = queries.findBusinessBySlug as jest.MockedFunction<
  typeof queries.findBusinessBySlug
>;
const mockedInsertOrIgnoreMessage = queries.insertOrIgnoreMessage as jest.MockedFunction<
  typeof queries.insertOrIgnoreMessage
>;
const mockedMarkMessageProcessed = queries.markMessageProcessed as jest.MockedFunction<
  typeof queries.markMessageProcessed
>;
const mockedSendWhatsAppMessage = whatsappClient.sendWhatsAppMessage as jest.MockedFunction<
  typeof whatsappClient.sendWhatsAppMessage
>;

const APP_SECRET = 'test-app-secret';

function signPayload(bodyStr: string): string {
  return 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(bodyStr).digest('hex');
}

function makeTextPayload(msgId: string): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              messages: [{ id: msgId, from: '306900000000', type: 'text', text: { body: 'pilates-athens' } }],
            },
            field: 'messages',
          },
        ],
      },
    ],
  });
}

async function postWebhook(body: string) {
  return request(app)
    .post('/webhooks/whatsapp')
    .set('Content-Type', 'application/json')
    .set('x-hub-signature-256', signPayload(body))
    .send(body);
}

// Unit tests for getOrCreateClientRelationship
describe('getOrCreateClientRelationship unit tests', () => {
  const mockedFindCBR = queries.findClientBusinessRelationship as jest.MockedFunction<
    typeof queries.findClientBusinessRelationship
  >;
  const mockedInsertCBR = queries.insertClientBusinessRelationship as jest.MockedFunction<
    typeof queries.insertClientBusinessRelationship
  >;

  const mockRow = {
    id: 1, businessId: 1, senderPhone: '306900000000', clientName: null,
    consentGiven: true, consentTimestamp: new Date(), createdAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Test 1: no existing row → returns isFirstContact=true and calls insertClientBusinessRelationship once', async () => {
    mockedFindCBR.mockResolvedValue(null);
    mockedInsertCBR.mockResolvedValue(mockRow);

    const result = await checker.getOrCreateClientRelationship(1, '306900000000');

    expect(result).toEqual({ isFirstContact: true, consentGiven: true });
    expect(mockedInsertCBR).toHaveBeenCalledTimes(1);
    expect(mockedInsertCBR).toHaveBeenCalledWith(1, '306900000000');
  });

  it('Test 2: existing row → returns isFirstContact=false and does NOT call insertClientBusinessRelationship', async () => {
    mockedFindCBR.mockResolvedValue(mockRow);

    const result = await checker.getOrCreateClientRelationship(1, '306900000000');

    expect(result).toEqual({ isFirstContact: false, consentGiven: true });
    expect(mockedInsertCBR).not.toHaveBeenCalled();
  });
});

// Webhook-level integration tests for consent notice
describe('Test 3 (webhook level): consent notice in reply', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFindBusinessBySlug.mockResolvedValue(KNOWN_BUSINESS);
    mockedInsertOrIgnoreMessage.mockResolvedValue('inserted');
    mockedMarkMessageProcessed.mockResolvedValue(undefined);
    mockedSendWhatsAppMessage.mockResolvedValue({ messageId: 'wamid.reply', status: 'sent' });
  });

  it('first contact: reply = consent notice + business-found reply in one message', async () => {
    // Mock queries so first-contact branch fires
    const mockedFindCBR = queries.findClientBusinessRelationship as jest.MockedFunction<
      typeof queries.findClientBusinessRelationship
    >;
    const mockedInsertCBR = queries.insertClientBusinessRelationship as jest.MockedFunction<
      typeof queries.insertClientBusinessRelationship
    >;
    mockedFindCBR.mockResolvedValue(null);
    mockedInsertCBR.mockResolvedValue({
      id: 1, businessId: 1, senderPhone: '306900000000', clientName: null,
      consentGiven: true, consentTimestamp: new Date(), createdAt: new Date(),
    });

    const body = makeTextPayload('wamid.FIRST001');
    await postWebhook(body);

    const [, replyText] = mockedSendWhatsAppMessage.mock.calls[0];
    const expectedNotice = CONSENT_NOTICE_GREEK_TEMPLATE('Pilates Athens');
    expect(replyText).toContain(expectedNotice);
    expect(replyText).toContain('Καλωσορίσατε στο Pilates Athens');
    // One message only, not two separate sends
    expect(mockedSendWhatsAppMessage).toHaveBeenCalledTimes(1);
  });

  it('second contact: reply = business-found reply only, no consent notice', async () => {
    const mockedFindCBR = queries.findClientBusinessRelationship as jest.MockedFunction<
      typeof queries.findClientBusinessRelationship
    >;
    mockedFindCBR.mockResolvedValue({
      id: 1, businessId: 1, senderPhone: '306900000000', clientName: null,
      consentGiven: true, consentTimestamp: new Date(), createdAt: new Date(),
    });

    const body = makeTextPayload('wamid.SECOND001');
    await postWebhook(body);

    const [, replyText] = mockedSendWhatsAppMessage.mock.calls[0];
    expect(replyText).toContain('Καλωσορίσατε στο Pilates Athens');
    expect(replyText).not.toContain(CONSENT_NOTICE_GREEK_TEMPLATE('Pilates Athens'));
  });
});
