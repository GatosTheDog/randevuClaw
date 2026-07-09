import request from 'supertest';
import crypto from 'crypto';
import app from '../src/server';
import * as queries from '../src/database/queries';
import * as whatsappClient from '../src/whatsapp/client';

jest.mock('../src/database/queries');
jest.mock('../src/whatsapp/client');

const mockedFindBusinessBySlug = queries.findBusinessBySlug as jest.MockedFunction<
  typeof queries.findBusinessBySlug
>;
const mockedSendWhatsAppMessage = whatsappClient.sendWhatsAppMessage as jest.MockedFunction<
  typeof whatsappClient.sendWhatsAppMessage
>;

const APP_SECRET = 'test-app-secret';

function signPayload(bodyStr: string): string {
  return (
    'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(bodyStr).digest('hex')
  );
}

function makeTextPayload(messageBody: string): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550000000',
                phone_number_id: 'test-phone-number-id',
              },
              messages: [
                {
                  id: 'wamid.test123',
                  from: '306900000000',
                  type: 'text',
                  text: { body: messageBody },
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  });
}

function makeNonTextPayload(): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              messages: [
                {
                  id: 'wamid.img123',
                  from: '306900000000',
                  type: 'image',
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  });
}

describe('GET /webhooks/whatsapp', () => {
  it('Test 1: returns 200 with hub.challenge when verify_token matches', async () => {
    const res = await request(app).get('/webhooks/whatsapp').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'test-verify-token',
      'hub.challenge': 'my-challenge-123',
    });
    expect(res.status).toBe(200);
    expect(res.text).toBe('my-challenge-123');
  });

  it('Test 2: returns 403 when verify_token does not match', async () => {
    const res = await request(app).get('/webhooks/whatsapp').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong-token',
      'hub.challenge': 'my-challenge-123',
    });
    expect(res.status).toBe(403);
  });
});

describe('POST /webhooks/whatsapp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSendWhatsAppMessage.mockResolvedValue({ messageId: 'wamid.reply', status: 'sent' });
  });

  it('Test 3: recognized slug → 200 + Greek business-found reply containing business name', async () => {
    mockedFindBusinessBySlug.mockResolvedValue({
      id: 1,
      name: 'Pilates Athens',
      slug: 'pilates-athens',
      phoneNumberId: null,
      ownerTelegramId: null,
      googleRefreshToken: null,
      agendaSentDate: null,
      createdAt: new Date(),
    });
    const body = makeTextPayload('pilates-athens');
    const res = await request(app)
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', signPayload(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(mockedSendWhatsAppMessage).toHaveBeenCalledTimes(1);
    const [, replyText] = mockedSendWhatsAppMessage.mock.calls[0];
    expect(replyText).toContain('Pilates Athens');
  });

  it('Test 4: unrecognized code → 200 + BUSINESS_NOT_FOUND_REPLY_GREEK', async () => {
    mockedFindBusinessBySlug.mockResolvedValue(null);
    const body = makeTextPayload('unknown-business');
    const res = await request(app)
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', signPayload(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(mockedSendWhatsAppMessage).toHaveBeenCalledTimes(1);
    const [, replyText] = mockedSendWhatsAppMessage.mock.calls[0];
    expect(replyText).toContain('Δεν αναγνωρίσαμε');
  });

  it('Test 5a: missing x-hub-signature-256 → 403, sendWhatsAppMessage never called', async () => {
    const body = makeTextPayload('pilates-athens');
    const res = await request(app)
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(res.status).toBe(403);
    expect(mockedSendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('Test 5b: malformed/short signature → 403 (no timingSafeEqual crash)', async () => {
    const body = makeTextPayload('pilates-athens');
    const res = await request(app)
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', 'sha256=abc')
      .send(body);

    expect(res.status).toBe(403);
    expect(mockedSendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('Test 6: non-text message type → 200, sendWhatsAppMessage never called', async () => {
    const body = makeNonTextPayload();
    const res = await request(app)
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', signPayload(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(mockedSendWhatsAppMessage).not.toHaveBeenCalled();
  });
});

describe('GET /healthz', () => {
  it('Test 7: returns 200', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
  });
});
