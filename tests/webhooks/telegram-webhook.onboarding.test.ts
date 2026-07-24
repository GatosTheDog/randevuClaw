import request from 'supertest';
import app from '../../src/server';
import * as queries from '../../src/database/queries';
import * as telegramClient from '../../src/telegram/client';
import * as conversationRouter from '../../src/conversation/router';
import * as registryModule from '../../src/telegram/registry';
import * as onboardingQueries from '../../src/onboarding/queries';
import * as onboardingRouter from '../../src/onboarding/router';
import * as aiOwnerAgentModule from '../../src/onboarding/ai-owner-agent';

jest.mock('../../src/database/queries');
jest.mock('../../src/telegram/client');
jest.mock('../../src/conversation/router');
jest.mock('../../src/calendar/sync');
jest.mock('../../src/telegram/registry');
jest.mock('../../src/billing/queries');
jest.mock('../../src/onboarding/queries');
jest.mock('../../src/onboarding/router');
jest.mock('../../src/onboarding/ai-owner-agent');

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

const ACTIVE_ONBOARDING_SESSION = {
  id: 1,
  businessId: 42,
  currentStep: 'name',
  collectedData: null,
  createdAt: new Date(),
  updatedAt: new Date(),
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
const mockedRouteConversationMessage = conversationRouter.routeConversationMessage as jest.MockedFunction<
  typeof conversationRouter.routeConversationMessage
>;
const mockedGetOrCreateBotInstance = registryModule.getOrCreateBotInstance as jest.MockedFunction<
  typeof registryModule.getOrCreateBotInstance
>;
const mockedFindActiveSessionByOwnerTelegramId =
  onboardingQueries.findActiveSessionByOwnerTelegramId as jest.MockedFunction<
    typeof onboardingQueries.findActiveSessionByOwnerTelegramId
  >;
const mockedCreateOrResetOnboardingSession =
  onboardingQueries.createOrResetOnboardingSession as jest.MockedFunction<
    typeof onboardingQueries.createOrResetOnboardingSession
  >;
const mockedDispatchOnboardingStep = onboardingRouter.dispatchOnboardingStep as jest.MockedFunction<
  typeof onboardingRouter.dispatchOnboardingStep
>;
const mockedAiOwnerAgent = aiOwnerAgentModule.aiOwnerAgent as jest.MockedFunction<
  typeof aiOwnerAgentModule.aiOwnerAgent
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
  mockedRouteConversationMessage.mockResolvedValue(undefined);
  mockedDispatchOnboardingStep.mockResolvedValue(undefined);
  mockedCreateOrResetOnboardingSession.mockResolvedValue(ACTIVE_ONBOARDING_SESSION as any);
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
// Owner with onboarding incomplete AND active session → dispatchOnboardingStep
// ---------------------------------------------------------------------------
describe('Scenario A: owner with incomplete onboarding, active session → dispatchOnboardingStep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupCommonMocks();
    mockedFindBusinessByWebhookId.mockResolvedValue({ ...BASE_BUSINESS, onboardingCompleted: false });
    mockedFindActiveSessionByOwnerTelegramId.mockResolvedValue({
      session: ACTIVE_ONBOARDING_SESSION,
      business: BASE_BUSINESS,
    });
  });

  it('calls dispatchOnboardingStep with session and step name, does not call aiOwnerAgent', async () => {
    const res = await postToWebhook(makeMessageUpdate(1, OWNER_TELEGRAM_ID, 'Pilates Studio'));

    expect(res.status).toBe(200);
    expect(mockedDispatchOnboardingStep).toHaveBeenCalledTimes(1);
    expect(mockedDispatchOnboardingStep).toHaveBeenCalledWith(
      ACTIVE_ONBOARDING_SESSION,
      BASE_BUSINESS,
      OWNER_TELEGRAM_ID,
      'Pilates Studio'
    );
    expect(mockedAiOwnerAgent).not.toHaveBeenCalled();
    expect(mockedMarkTelegramUpdateProcessed).toHaveBeenCalledWith('1', 42);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO B — ARCH-03
// Owner with onboarding incomplete AND NO active session → createOrResetOnboardingSession + welcome
// ---------------------------------------------------------------------------
describe('Scenario B: owner with incomplete onboarding, no session → create session + welcome message', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupCommonMocks();
    mockedFindBusinessByWebhookId.mockResolvedValue({ ...BASE_BUSINESS, onboardingCompleted: false });
    mockedFindActiveSessionByOwnerTelegramId.mockResolvedValue(null);
  });

  it('calls createOrResetOnboardingSession with name step and sends welcome message', async () => {
    const res = await postToWebhook(makeMessageUpdate(2, OWNER_TELEGRAM_ID));

    expect(res.status).toBe(200);
    expect(mockedCreateOrResetOnboardingSession).toHaveBeenCalledWith(42, 'name');
    const welcomeCall = mockedSendTelegramMessage.mock.calls[0];
    expect(welcomeCall[0]).toBe(OWNER_TELEGRAM_ID);
    expect(welcomeCall[1]).toContain('Καλωσήρθατε');
    expect(mockedDispatchOnboardingStep).not.toHaveBeenCalled();
    expect(mockedAiOwnerAgent).not.toHaveBeenCalled();
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

  it('routes to aiOwnerAgent and sends reply, does not call dispatchOnboardingStep', async () => {
    const res = await postToWebhook(makeMessageUpdate(3, OWNER_TELEGRAM_ID, 'Τι έχω σήμερα;'));

    expect(res.status).toBe(200);
    expect(mockedAiOwnerAgent).toHaveBeenCalledTimes(1);
    expect(mockedDispatchOnboardingStep).not.toHaveBeenCalled();
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
    expect(mockedDispatchOnboardingStep).not.toHaveBeenCalled();
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
    expect(mockedDispatchOnboardingStep).not.toHaveBeenCalled();
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
    expect(mockedDispatchOnboardingStep).not.toHaveBeenCalled();
    expect(mockedAiOwnerAgent).not.toHaveBeenCalled();
  });
});
