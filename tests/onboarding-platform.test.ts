import request from 'supertest';
import app from '../src/server';
import * as queries from '../src/database/queries';
import * as onboardingQueries from '../src/onboarding/queries';
import * as telegramClient from '../src/telegram/client';
import * as registryModule from '../src/telegram/registry';
import * as onboardingRouter from '../src/onboarding/router';

jest.mock('../src/database/queries');
jest.mock('../src/onboarding/queries');
jest.mock('../src/telegram/client');
jest.mock('../src/telegram/registry');
jest.mock('../src/onboarding/router');
// Mock db to prevent real connections; platform.ts does a direct db.update in the re-registration path.
jest.mock('../src/database/db', () => ({
  db: {
    update: jest.fn(() => ({
      set: jest.fn(() => ({
        where: jest.fn(() => Promise.resolve([])),
      })),
    })),
    select: jest.fn(() => ({
      from: jest.fn(() => Promise.resolve([])),
    })),
    insert: jest.fn(() => ({
      values: jest.fn(() => ({
        onConflictDoNothing: jest.fn(() => Promise.resolve(undefined)),
        onConflictDoUpdate: jest.fn(() => ({
          returning: jest.fn(() => Promise.resolve([])),
        })),
        returning: jest.fn(() => Promise.resolve([])),
      })),
    })),
  },
  pool: { end: jest.fn() },
  appPool: { end: jest.fn() },
  appDb: {},
}));

// ─── Constants ───────────────────────────────────────────────────────────────

const PLATFORM_SECRET = 'test-platform-webhook-secret'; // matches PLATFORM_WEBHOOK_SECRET in jest.setup.ts
const NEW_OWNER_ID = 12345678;
const VALID_BOT_TOKEN = '1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ';

// ─── Typed mocks ─────────────────────────────────────────────────────────────

const mockedInsertOrIgnoreTelegramUpdate = queries.insertOrIgnoreTelegramUpdate as jest.MockedFunction<
  typeof queries.insertOrIgnoreTelegramUpdate
>;
const mockedFindActiveSessionByOwnerTelegramId =
  onboardingQueries.findActiveSessionByOwnerTelegramId as jest.MockedFunction<
    typeof onboardingQueries.findActiveSessionByOwnerTelegramId
  >;
const mockedFindBusinessByOwnerTelegramId =
  onboardingQueries.findBusinessByOwnerTelegramId as jest.MockedFunction<
    typeof onboardingQueries.findBusinessByOwnerTelegramId
  >;
const mockedCreateBusinessForOnboarding =
  onboardingQueries.createBusinessForOnboarding as jest.MockedFunction<
    typeof onboardingQueries.createBusinessForOnboarding
  >;
const mockedCreateOrResetOnboardingSession =
  onboardingQueries.createOrResetOnboardingSession as jest.MockedFunction<
    typeof onboardingQueries.createOrResetOnboardingSession
  >;
const mockedActivateBusiness = onboardingQueries.activateBusiness as jest.MockedFunction<
  typeof onboardingQueries.activateBusiness
>;
const mockedGetMeBotInfo = telegramClient.getMeBotInfo as jest.MockedFunction<
  typeof telegramClient.getMeBotInfo
>;
const mockedSendTelegramMessage = telegramClient.sendTelegramMessage as jest.MockedFunction<
  typeof telegramClient.sendTelegramMessage
>;
const mockedUnregisterBotWebhook = telegramClient.unregisterBotWebhook as jest.MockedFunction<
  typeof telegramClient.unregisterBotWebhook
>;
const mockedDispatchOnboardingStep = onboardingRouter.dispatchOnboardingStep as jest.MockedFunction<
  typeof onboardingRouter.dispatchOnboardingStep
>;

// ─── Test fixtures ───────────────────────────────────────────────────────────

const TEST_BUSINESS = {
  id: 1,
  name: 'Test Business',
  slug: 'test-business',
  phoneNumberId: null,
  ownerTelegramId: String(NEW_OWNER_ID),
  botToken: VALID_BOT_TOKEN,
  webhookId: 'existing-webhook-id',
  webhookSecret: 'existing-webhook-secret',
  googleRefreshToken: null,
  agendaSentDate: null,
  createdAt: new Date(),
};

const TEST_SESSION = {
  id: 1,
  businessId: 1,
  currentStep: 'name',
  collectedData: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal TelegramUpdate with a message from `fromId` carrying `text`.
 * Uses the same shape that platform.ts reads: update_id, message.from.id,
 * message.chat.id, message.text.
 */
function makeMessageUpdate(updateId: number, fromId: number, text: string) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: fromId },
      chat: { id: fromId },
      text,
    },
  };
}

/**
 * POST to /webhooks/telegram/platform.
 * `secret = null` means the header is omitted entirely (tests the missing-header path).
 */
async function postPlatformWebhook(body: object, secret: string | null = PLATFORM_SECRET) {
  const req = request(app)
    .post('/webhooks/telegram/platform')
    .set('Content-Type', 'application/json');
  if (secret !== null) req.set('X-Telegram-Bot-Api-Secret-Token', secret);
  return req.send(body);
}

// ─── beforeEach ──────────────────────────────────────────────────────────────

beforeEach(() => {
  // Clear registry before mocks so clearBotRegistry mock records the call.
  registryModule.clearBotRegistry();
  jest.clearAllMocks();

  // Default mock stubs — individual tests override as needed.
  mockedInsertOrIgnoreTelegramUpdate.mockResolvedValue('inserted');
  mockedSendTelegramMessage.mockResolvedValue({ messageId: 1 });
  mockedDispatchOnboardingStep.mockResolvedValue(undefined);
  mockedActivateBusiness.mockResolvedValue(undefined);
  mockedCreateOrResetOnboardingSession.mockResolvedValue(TEST_SESSION);

  // botTokenStore.run mock: call the async callback immediately (D-13 pattern).
  (telegramClient.botTokenStore.run as jest.Mock).mockImplementation(
    (_value: string, callback: () => Promise<unknown>) => callback()
  );
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('HMAC verification', () => {
  it('rejects request with missing secret token', async () => {
    const res = await postPlatformWebhook(
      makeMessageUpdate(1, NEW_OWNER_ID, VALID_BOT_TOKEN),
      null // omit header
    );
    expect(res.status).toBe(401);
  });

  it('rejects request with wrong secret token', async () => {
    const res = await postPlatformWebhook(
      makeMessageUpdate(2, NEW_OWNER_ID, VALID_BOT_TOKEN),
      'wrong-secret'
    );
    expect(res.status).toBe(401);
  });

  it('accepts request with correct secret token — returns 200 and starts new-owner flow', async () => {
    mockedFindActiveSessionByOwnerTelegramId.mockResolvedValue(null);
    mockedFindBusinessByOwnerTelegramId.mockResolvedValue(null);
    mockedGetMeBotInfo.mockResolvedValue({ id: 1, username: 'testbot', firstName: 'Test' });
    mockedCreateBusinessForOnboarding.mockResolvedValue(TEST_BUSINESS);
    mockedCreateOrResetOnboardingSession.mockResolvedValue(TEST_SESSION);

    const res = await postPlatformWebhook(makeMessageUpdate(3, NEW_OWNER_ID, VALID_BOT_TOKEN));
    expect(res.status).toBe(200);
  });
});

describe('New owner registration (BOT-01)', () => {
  it('valid bot token: creates business, creates session, sends first Greek prompt', async () => {
    mockedFindActiveSessionByOwnerTelegramId.mockResolvedValue(null);
    mockedFindBusinessByOwnerTelegramId.mockResolvedValue(null);
    mockedGetMeBotInfo.mockResolvedValue({ id: 1, username: 'testbot', firstName: 'Test' });
    mockedCreateBusinessForOnboarding.mockResolvedValue(TEST_BUSINESS);
    mockedCreateOrResetOnboardingSession.mockResolvedValue(TEST_SESSION);

    await postPlatformWebhook(makeMessageUpdate(10, NEW_OWNER_ID, VALID_BOT_TOKEN));

    expect(mockedCreateBusinessForOnboarding).toHaveBeenCalledTimes(1);
    expect(mockedCreateOrResetOnboardingSession).toHaveBeenCalledWith(TEST_BUSINESS.id, 'name');

    // First Greek prompt contains welcome or name-question text
    const [chatId, messageText] = mockedSendTelegramMessage.mock.calls[0]!;
    expect(chatId).toBe(String(NEW_OWNER_ID));
    expect(messageText).toMatch(/Καλωσήρθατε|ονομάζεται/);
  });

  it('invalid bot token: getMeBotInfo throws, sends Greek error, does not create business', async () => {
    mockedFindActiveSessionByOwnerTelegramId.mockResolvedValue(null);
    mockedFindBusinessByOwnerTelegramId.mockResolvedValue(null);
    mockedGetMeBotInfo.mockRejectedValue(new Error('Unauthorized'));

    await postPlatformWebhook(makeMessageUpdate(11, NEW_OWNER_ID, 'invalid-token'));

    expect(mockedCreateBusinessForOnboarding).not.toHaveBeenCalled();
    const [, errorText] = mockedSendTelegramMessage.mock.calls[0]!;
    expect(errorText).toMatch(/Μη έγκυρο/);
  });
});

describe('Resume mid-flow (ONB-02)', () => {
  it('active session found: dispatches to dispatchOnboardingStep without re-creating business', async () => {
    const activeResult = { session: TEST_SESSION, business: TEST_BUSINESS };
    mockedFindActiveSessionByOwnerTelegramId.mockResolvedValue(activeResult);

    await postPlatformWebhook(makeMessageUpdate(20, NEW_OWNER_ID, 'some message'));

    expect(mockedDispatchOnboardingStep).toHaveBeenCalledTimes(1);
    expect(mockedDispatchOnboardingStep).toHaveBeenCalledWith(
      TEST_SESSION,
      TEST_BUSINESS,
      String(NEW_OWNER_ID),
      'some message'
    );
    expect(mockedCreateBusinessForOnboarding).not.toHaveBeenCalled();
  });
});

describe('Re-registration', () => {
  it('owner with done session: unregisterBotWebhook called with old token, session reset to name', async () => {
    mockedFindActiveSessionByOwnerTelegramId.mockResolvedValue(null);
    mockedFindBusinessByOwnerTelegramId.mockResolvedValue(TEST_BUSINESS);
    mockedGetMeBotInfo.mockResolvedValue({ id: 2, username: 'newbot', firstName: 'New' });
    mockedUnregisterBotWebhook.mockResolvedValue(undefined);

    const NEW_TOKEN = '9876543210:ZYXwvuTSRqpONMlkJIHgfeDCBA';
    await postPlatformWebhook(makeMessageUpdate(30, NEW_OWNER_ID, NEW_TOKEN));

    // Old webhook unregistered before creating new one
    expect(mockedUnregisterBotWebhook).toHaveBeenCalledWith(VALID_BOT_TOKEN);
    // Session reset to name step for re-entering the guided flow
    expect(mockedCreateOrResetOnboardingSession).toHaveBeenCalledWith(TEST_BUSINESS.id, 'name');
  });
});

describe('Deduplication', () => {
  it('duplicate update_id is ignored without creating session or business', async () => {
    mockedInsertOrIgnoreTelegramUpdate.mockResolvedValue('ignored');

    await postPlatformWebhook(makeMessageUpdate(40, NEW_OWNER_ID, VALID_BOT_TOKEN));

    expect(mockedCreateOrResetOnboardingSession).not.toHaveBeenCalled();
    expect(mockedCreateBusinessForOnboarding).not.toHaveBeenCalled();
  });
});
