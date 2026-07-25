import request from 'supertest';
import app from '../../src/server';
import * as queries from '../../src/database/queries';
import * as telegramClient from '../../src/telegram/client';
import * as conversationRouter from '../../src/conversation/router';
import * as registryModule from '../../src/telegram/registry';
import * as aiOwnerAgentModule from '../../src/onboarding/ai-owner-agent';
import * as aiOnboardingAgentModule from '../../src/onboarding/ai-onboarding-agent';

jest.mock('../../src/database/queries');
jest.mock('../../src/telegram/client');
jest.mock('../../src/conversation/router');
jest.mock('../../src/calendar/sync');
jest.mock('../../src/telegram/registry');
jest.mock('../../src/billing/queries');
jest.mock('../../src/onboarding/queries');
jest.mock('../../src/onboarding/ai-owner-agent');
jest.mock('../../src/onboarding/ai-onboarding-agent');

const OWNER_TELEGRAM_ID = 'owner-123';
const CLIENT_TELEGRAM_ID = 'client-456';
const WEBHOOK_SECRET = 'test-onboarding-webhook-secret';

const BASE_BUSINESS = {
  id: 42,
  name: 'Test Pilates',
  slug: 'test-pilates',
  phoneNumberId: null,
  ownerTelegramId: OWNER_TELEGRAM_ID,
  googleRefreshToken: null,
  agendaSentDate: null,
  botToken: 'test-onboarding-bot-token',
  webhookId: 'test-onboarding-webhook-id',
  webhookSecret: WEBHOOK_SECRET,
  enforcementPolicy: 'allow',
  bookingMode: 'open_slots',
  allowMultiBooking: false,
  cancellationCutoffEnabled: false,
  cancellationCutoffHours: 24,
  slotlessRequestsEnabled: false,
  lastSessionThresholdEnabled: false,
  lastSessionThresholdCount: 2,
  onboardingCompleted: false,
  createdAt: new Date(),
};

const mockBot = { handleUpdate: jest.fn().mockResolvedValue(undefined) };

const mockedFindBusinessByWebhookId = queries.findBusinessByWebhookId as jest.MockedFunction<
  typeof queries.findBusinessByWebhookId
>;
const mockedInsertOrIgnoreTelegramUpdate = queries.insertOrIgnoreTelegramUpdate as jest.MockedFunction<
  typeof queries.insertOrIgnoreTelegramUpdate
>;
const mockedMarkTelegramUpdateProcessed = queries.markTelegramUpdateProcessed as jest.MockedFunction<
  typeof queries.markTelegramUpdateProcessed
>;
const mockedInsertClientBusinessRelationship = queries.insertClientBusinessRelationship as jest.MockedFunction<
  typeof queries.insertClientBusinessRelationship
>;
const mockedWithBusinessContext = queries.withBusinessContext as jest.MockedFunction<
  typeof queries.withBusinessContext
>;
const mockedSendTelegramMessage = telegramClient.sendTelegramMessage as jest.MockedFunction<
  typeof telegramClient.sendTelegramMessage
>;
const mockedAnswerCallbackQuery = telegramClient.answerCallbackQuery as jest.MockedFunction<
  typeof telegramClient.answerCallbackQuery
>;
const mockedEditTelegramMessageReplyMarkup = telegramClient.editTelegramMessageReplyMarkup as jest.MockedFunction<
  typeof telegramClient.editTelegramMessageReplyMarkup
>;
const mockedRouteConversationMessage = conversationRouter.routeConversationMessage as jest.MockedFunction<
  typeof conversationRouter.routeConversationMessage
>;
const mockedGetOrCreateBotInstance = registryModule.getOrCreateBotInstance as jest.MockedFunction<
  typeof registryModule.getOrCreateBotInstance
>;
const mockedAiOwnerAgent = aiOwnerAgentModule.aiOwnerAgent as jest.MockedFunction<
  typeof aiOwnerAgentModule.aiOwnerAgent
>;
const mockedAiOnboardingAgent = aiOnboardingAgentModule.aiOnboardingAgent as jest.MockedFunction<
  typeof aiOnboardingAgentModule.aiOnboardingAgent
>;

function makeMessageUpdate(updateId: number, fromId: string | number, text = 'hello') {
  return {
    update_id: updateId,
    message: {
      message_id: 100 + updateId,
      from: { id: fromId, is_bot: false, first_name: 'TestUser' },
      chat: { id: fromId, type: 'private' },
      date: 1234567890,
      text,
    },
  };
}

function makeCallbackQueryUpdate(updateId: number, fromId: number | string, data: string) {
  return {
    update_id: updateId,
    callback_query: {
      id: 'cbq-1',
      from: { id: fromId, is_bot: false, first_name: 'Owner' },
      message: { message_id: 500 + updateId, chat: { id: fromId, type: 'private' } },
      data,
    },
  };
}

async function postToWebhook(body: object) {
  return request(app)
    .post(`/webhooks/telegram/test-onboarding-webhook-id`)
    .set('Content-Type', 'application/json')
    .set('X-Telegram-Bot-Api-Secret-Token', WEBHOOK_SECRET)
    .send(body);
}

function setupCommonMocks() {
  mockedInsertOrIgnoreTelegramUpdate.mockResolvedValue('inserted');
  mockedMarkTelegramUpdateProcessed.mockResolvedValue(undefined);
  mockedInsertClientBusinessRelationship.mockResolvedValue({ id: 1, businessId: 42, clientPhone: CLIENT_TELEGRAM_ID, clientName: 'TestUser', consentTimestamp: new Date(), createdAt: new Date() } as any);
  mockedSendTelegramMessage.mockResolvedValue({ messageId: 999 });
  mockedAnswerCallbackQuery.mockResolvedValue(undefined);
  mockedEditTelegramMessageReplyMarkup.mockResolvedValue(undefined);
  mockedRouteConversationMessage.mockResolvedValue(undefined);
  mockedAiOnboardingAgent.mockResolvedValue('Γεια σου, ξεκινάμε!');
  mockedAiOwnerAgent.mockResolvedValue('Γεια σου');
  mockedGetOrCreateBotInstance.mockReturnValue(mockBot as any);
  (telegramClient.botTokenStore.run as jest.Mock).mockImplementation(
    (_value: string, callback: () => Promise<unknown>) => callback()
  );
  mockedWithBusinessContext.mockImplementation(
    (_id: unknown, fn: () => Promise<unknown>) => fn()
  );
}

// ---------------------------------------------------------------------------
// SCENARIO A — ARCH-03 / AUTH-01
// Owner with onboarding incomplete → aiOnboardingAgent (message path)
// ---------------------------------------------------------------------------
describe('Scenario A: owner with incomplete onboarding -> aiOnboardingAgent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupCommonMocks();
    mockedFindBusinessByWebhookId.mockResolvedValue({ ...BASE_BUSINESS, onboardingCompleted: false });
  });

  it('calls aiOnboardingAgent with business, senderTelegramId, messageText, today (no legacy step-machine call)', async () => {
    const res = await postToWebhook(makeMessageUpdate(1, OWNER_TELEGRAM_ID, 'Pilates Studio'));

    expect(res.status).toBe(200);
    expect(mockedAiOnboardingAgent).toHaveBeenCalledTimes(1);
    const [business, senderId, messageText, today] = mockedAiOnboardingAgent.mock.calls[0];
    expect(business).toMatchObject({ id: 42, ownerTelegramId: OWNER_TELEGRAM_ID, onboardingCompleted: false });
    expect(senderId).toBe(OWNER_TELEGRAM_ID);
    expect(messageText).toBe('Pilates Studio');
    expect(typeof today).toBe('string');
    expect(mockedAiOwnerAgent).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(OWNER_TELEGRAM_ID, 'Γεια σου, ξεκινάμε!');
    expect(mockedMarkTelegramUpdateProcessed).toHaveBeenCalledWith('1', 42);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO B2
// Owner inline-keyboard tap (callback_query) with onboarding incomplete → aiOnboardingAgent
// ---------------------------------------------------------------------------
describe('Scenario B2: owner callback_query tap with incomplete onboarding -> aiOnboardingAgent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupCommonMocks();
    mockedFindBusinessByWebhookId.mockResolvedValue({ ...BASE_BUSINESS, onboardingCompleted: false });
  });

  it('calls aiOnboardingAgent with the tap data as messageText, after answerCallbackQuery + keyboard-clear', async () => {
    const res = await postToWebhook(makeCallbackQueryUpdate(6, OWNER_TELEGRAM_ID, 'ναι'));

    expect(res.status).toBe(200);
    expect(mockedAnswerCallbackQuery).toHaveBeenCalledWith('cbq-1');
    expect(mockedEditTelegramMessageReplyMarkup).toHaveBeenCalledWith(OWNER_TELEGRAM_ID, 506, []);
    expect(mockedAiOnboardingAgent).toHaveBeenCalledTimes(1);
    const [business, senderId, messageText] = mockedAiOnboardingAgent.mock.calls[0];
    expect(business).toMatchObject({ id: 42, ownerTelegramId: OWNER_TELEGRAM_ID, onboardingCompleted: false });
    expect(senderId).toBe(OWNER_TELEGRAM_ID);
    expect(messageText).toBe('ναι');
    expect(mockedMarkTelegramUpdateProcessed).toHaveBeenCalledWith('6', 42);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO B3
// aiOnboardingAgent returns '' → no reply sent (message path + callback_query path)
// ---------------------------------------------------------------------------
describe('Scenario B3: aiOnboardingAgent returns empty string -> no reply sent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupCommonMocks();
    mockedFindBusinessByWebhookId.mockResolvedValue({ ...BASE_BUSINESS, onboardingCompleted: false });
    mockedAiOnboardingAgent.mockResolvedValue('');
  });

  it('message path: does not call sendTelegramMessage when reply is empty', async () => {
    const res = await postToWebhook(makeMessageUpdate(7, OWNER_TELEGRAM_ID, 'κλείσε τη δραστηριοτητα'));

    expect(res.status).toBe(200);
    expect(mockedAiOnboardingAgent).toHaveBeenCalledTimes(1);
    expect(mockedSendTelegramMessage).not.toHaveBeenCalled();
  });

  it('callback_query path: does not call sendTelegramMessage when reply is empty', async () => {
    const res = await postToWebhook(makeCallbackQueryUpdate(8, OWNER_TELEGRAM_ID, 'όχι'));

    expect(res.status).toBe(200);
    expect(mockedAiOnboardingAgent).toHaveBeenCalledTimes(1);
    expect(mockedSendTelegramMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SCENARIO C — ARCH-02 / AUTH-01
// Owner with onboarding complete → aiOwnerAgent
// ---------------------------------------------------------------------------
describe('Scenario C: owner with completed onboarding → aiOwnerAgent called', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupCommonMocks();
    mockedFindBusinessByWebhookId.mockResolvedValue({ ...BASE_BUSINESS, onboardingCompleted: true });
  });

  it('routes to aiOwnerAgent and sends reply, does not call aiOnboardingAgent', async () => {
    const res = await postToWebhook(makeMessageUpdate(3, OWNER_TELEGRAM_ID, 'Τι έχω σήμερα;'));

    expect(res.status).toBe(200);
    expect(mockedAiOwnerAgent).toHaveBeenCalledTimes(1);
    expect(mockedAiOnboardingAgent).not.toHaveBeenCalled();
    const [recipientId, replyText] = mockedSendTelegramMessage.mock.calls[0];
    expect(recipientId).toBe(OWNER_TELEGRAM_ID);
    expect(replyText).toBe('Γεια σου');
  });
});

// ---------------------------------------------------------------------------
// SCENARIO D — ARCH-04 / AUTH-02
// Non-owner client → routeConversationMessage + insertClientBusinessRelationship
// ---------------------------------------------------------------------------
describe('Scenario D: client (non-owner) → routeConversationMessage + insertClientBusinessRelationship', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupCommonMocks();
    mockedFindBusinessByWebhookId.mockResolvedValue({ ...BASE_BUSINESS, onboardingCompleted: true });
  });

  it('routes client to conversation router and records relationship', async () => {
    const res = await postToWebhook(makeMessageUpdate(4, CLIENT_TELEGRAM_ID, 'Θέλω να κλείσω ώρα'));

    expect(res.status).toBe(200);
    expect(mockedRouteConversationMessage).toHaveBeenCalledTimes(1);
    expect(mockedAiOwnerAgent).not.toHaveBeenCalled();
    expect(mockedAiOnboardingAgent).not.toHaveBeenCalled();
    expect(mockedInsertClientBusinessRelationship).toHaveBeenCalledWith(
      42,
      CLIENT_TELEGRAM_ID,
      'TestUser'
    );
  });

  it('null ownerTelegramId on business → sender treated as client, not owner', async () => {
    mockedFindBusinessByWebhookId.mockResolvedValue({
      ...BASE_BUSINESS,
      ownerTelegramId: null,
      onboardingCompleted: true,
    });

    const res = await postToWebhook(makeMessageUpdate(5, CLIENT_TELEGRAM_ID));

    expect(res.status).toBe(200);
    expect(mockedRouteConversationMessage).toHaveBeenCalledTimes(1);
    expect(mockedAiOwnerAgent).not.toHaveBeenCalled();
    expect(mockedAiOnboardingAgent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SCENARIO E — ARCH-01
// Platform route no longer exists → 404 (or 400)
// ---------------------------------------------------------------------------
describe('Scenario E: /webhooks/telegram/platform route no longer exists (ARCH-01)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupCommonMocks();
    // platform is gone — findBusinessByWebhookId returns null for any non-registered webhookId
    mockedFindBusinessByWebhookId.mockResolvedValue(null);
  });

  it('POST /webhooks/telegram/platform returns 404, not 200 with onboarding behavior', async () => {
    const res = await request(app)
      .post('/webhooks/telegram/platform')
      .set('Content-Type', 'application/json')
      .send({ update_id: 999, message: { from: { id: 'anyone' } } });

    expect(res.status).not.toBe(200);
    expect([400, 404]).toContain(res.status);
    expect(mockedAiOwnerAgent).not.toHaveBeenCalled();
  });
});
