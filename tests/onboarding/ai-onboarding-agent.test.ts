/**
 * tests/onboarding/ai-onboarding-agent.test.ts
 *
 * Unit tests for src/onboarding/ai-onboarding-agent.ts (Phase 21, D-01/D-02/D-03).
 *
 * Task 1 covers ONBOARDING_TOOLS shape and buildOnboardingSystemPrompt
 * (DB-state-derived completeness detection). Task 2 extends this file with
 * executeOnboardingTool and aiOnboardingAgent Gemini-loop tests.
 */

// The real @google/genai class is auto-mocked, but `ai.interactions` is a
// getter (not a plain prototype method), so a plain `jest.mock('@google/genai')`
// automock would leave `.interactions` undefined. Provide a manual factory
// whose `GoogleGenAI` constructor always returns an object exposing
// `interactions.create` as a jest.fn() reachable via the module's exports
// (`__mockCreate`) — same pattern as tests/ai-agent.test.ts.
jest.mock('@google/genai', () => {
  const mockCreate = jest.fn();
  return {
    __mockCreate: mockCreate,
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      interactions: { create: mockCreate },
    })),
  };
});

jest.mock('../../src/database/queries', () => ({
  ...jest.requireActual('../../src/database/queries'),
  listServicesForBusiness: jest.fn(),
  listBusinessHours: jest.fn(),
  getConn: jest.fn(),
  withBusinessContext: jest.fn(),
}));
// CR-01 regression coverage: set_business_name's cross-tenant slug lookup
// uses the admin `db` connection directly (RLS would scope getConn() to
// just this business's own row), so it needs its own mock distinct from
// the getConn() chainable used by every other tool case.
jest.mock('../../src/database/db', () => ({
  db: { select: jest.fn() },
}));
jest.mock('../../src/database/seed');
jest.mock('../../src/billing/tools');
jest.mock('../../src/session/manager');
jest.mock('../../src/telegram/client');
jest.mock('../../src/onboarding/queries');

import * as genai from '@google/genai';
import * as dbQueries from '../../src/database/queries';
import { db as mockDb } from '../../src/database/db';
import * as seedModule from '../../src/database/seed';
import * as billingTools from '../../src/billing/tools';
import * as sessionManager from '../../src/session/manager';
import * as telegramClient from '../../src/telegram/client';
import * as onboardingQueries from '../../src/onboarding/queries';
import {
  ONBOARDING_TOOLS,
  buildOnboardingSystemPrompt,
  executeOnboardingTool,
  aiOnboardingAgent,
} from '../../src/onboarding/ai-onboarding-agent';
import type { Business, Service, BusinessHours } from '../../src/database/queries';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreate = (genai as any).__mockCreate as jest.Mock;

const mockedListServicesForBusiness = dbQueries.listServicesForBusiness as jest.MockedFunction<
  typeof dbQueries.listServicesForBusiness
>;
const mockedListBusinessHours = dbQueries.listBusinessHours as jest.MockedFunction<
  typeof dbQueries.listBusinessHours
>;
const mockedGetConn = dbQueries.getConn as jest.MockedFunction<typeof dbQueries.getConn>;
const mockedDbSelect = mockDb.select as jest.Mock;
const mockedWithBusinessContext = dbQueries.withBusinessContext as jest.MockedFunction<
  typeof dbQueries.withBusinessContext
>;
const mockedGenerateSlug = seedModule.generateSlug as jest.MockedFunction<typeof seedModule.generateSlug>;
const mockedHandleSetCancellationCutoff = billingTools.handleSetCancellationCutoff as jest.MockedFunction<
  typeof billingTools.handleSetCancellationCutoff
>;
const mockedHandleSetLastSessionThreshold = billingTools.handleSetLastSessionThreshold as jest.MockedFunction<
  typeof billingTools.handleSetLastSessionThreshold
>;
const mockedCreateSessionCatalogWithExpansion =
  sessionManager.createSessionCatalogWithExpansion as jest.MockedFunction<
    typeof sessionManager.createSessionCatalogWithExpansion
  >;
const mockedBuildRRuleString = sessionManager.buildRRuleString as jest.MockedFunction<
  typeof sessionManager.buildRRuleString
>;
const mockedListSessions = sessionManager.listSessions as jest.MockedFunction<typeof sessionManager.listSessions>;
const mockedSendTelegramMessage = telegramClient.sendTelegramMessage as jest.MockedFunction<
  typeof telegramClient.sendTelegramMessage
>;
const mockedRegisterBotWebhook = telegramClient.registerBotWebhook as jest.MockedFunction<
  typeof telegramClient.registerBotWebhook
>;
const mockedUnregisterBotWebhook = telegramClient.unregisterBotWebhook as jest.MockedFunction<
  typeof telegramClient.unregisterBotWebhook
>;
const mockedSetMyCommands = telegramClient.setMyCommands as jest.MockedFunction<typeof telegramClient.setMyCommands>;
const mockedSetChatMenuButton = telegramClient.setChatMenuButton as jest.MockedFunction<
  typeof telegramClient.setChatMenuButton
>;
const mockedActivateBusiness = onboardingQueries.activateBusiness as jest.MockedFunction<
  typeof onboardingQueries.activateBusiness
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PLACEHOLDER_NAME = 'New Business (onboarding)';

function makeBusiness(overrides: Partial<Business> = {}): Business {
  return {
    id: 1,
    name: PLACEHOLDER_NAME,
    slug: 'pending-abc123',
    phoneNumberId: null,
    ownerTelegramId: '999999999',
    googleRefreshToken: null,
    agendaSentDate: null,
    botToken: 'bot-token-xyz',
    webhookId: null,
    webhookSecret: null,
    enforcementPolicy: 'allow',
    bookingMode: 'open_slots',
    allowMultiBooking: false,
    cancellationCutoffEnabled: false,
    cancellationCutoffHours: 8,
    slotlessRequestsEnabled: false,
    lastSessionThresholdEnabled: false,
    lastSessionThresholdCount: 1,
    onboardingCompleted: false,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeService(overrides: Partial<Service> = {}): Service {
  return {
    id: 10,
    businessId: 1,
    name: 'Reformer Pilates',
    durationMin: 50,
    price: 3500,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeHourRow(dayOfWeek: number, overrides: Partial<BusinessHours> = {}): BusinessHours {
  return {
    id: dayOfWeek + 1,
    businessId: 1,
    dayOfWeek,
    openTime: '09:00',
    closeTime: '18:00',
    openTime2: null,
    closeTime2: null,
    isClosed: false,
    createdAt: new Date(),
    ...overrides,
  };
}

const SEVEN_HOUR_ROWS: BusinessHours[] = Array.from({ length: 7 }, (_, day) => makeHourRow(day));

const TODAY = '2026-07-25';

// ---------------------------------------------------------------------------
// buildOnboardingSystemPrompt (Task 1)
// ---------------------------------------------------------------------------

describe('buildOnboardingSystemPrompt', () => {
  it('signals a missing name in the missing-items list when name is still the placeholder', () => {
    const business = makeBusiness({ name: PLACEHOLDER_NAME });
    const prompt = buildOnboardingSystemPrompt(business, [], [], TODAY);

    expect(prompt).toContain('Λείπουν ακόμα:');
    expect(prompt).toContain('όνομα επιχείρησης');
  });

  it('does not list "όνομα επιχείρησης" among missing items once name/hours/services are complete', () => {
    const business = makeBusiness({ name: 'Pilates Athens' });
    const prompt = buildOnboardingSystemPrompt(business, [makeService()], SEVEN_HOUR_ROWS, TODAY);

    // "Λείπουν ακόμα" section must not exist at all once everything is complete —
    // the placeholder-missing text uses lowercase "όνομα" (distinct from the
    // "Όνομα επιχείρησης:" state label above, which uses capital Ό).
    expect(prompt).not.toContain('Λείπουν ακόμα');
    expect(prompt).not.toContain('όνομα επιχείρησης');
  });

  it('always contains the mandatory Greek-only rule line', () => {
    const businessIncomplete = makeBusiness();
    const businessComplete = makeBusiness({ name: 'Pilates Athens' });

    expect(buildOnboardingSystemPrompt(businessIncomplete, [], [], TODAY)).toContain('Μιλάς ΠΑΝΤΑ Ελληνικά');
    expect(buildOnboardingSystemPrompt(businessComplete, [makeService()], SEVEN_HOUR_ROWS, TODAY)).toContain(
      'Μιλάς ΠΑΝΤΑ Ελληνικά'
    );
  });

  it('flags incomplete hours (less than 7 rows) as missing', () => {
    const business = makeBusiness({ name: 'Pilates Athens' });
    const prompt = buildOnboardingSystemPrompt(business, [makeService()], SEVEN_HOUR_ROWS.slice(0, 3), TODAY);

    expect(prompt).toContain('πλήρες εβδομαδιαίο ωράριο');
  });

  it('flags missing services when svcList is empty', () => {
    const business = makeBusiness({ name: 'Pilates Athens' });
    const prompt = buildOnboardingSystemPrompt(business, [], SEVEN_HOUR_ROWS, TODAY);

    expect(prompt).toContain('τουλάχιστον 1 υπηρεσία');
  });
});

// ---------------------------------------------------------------------------
// ONBOARDING_TOOLS shape sanity checks
// ---------------------------------------------------------------------------

describe('ONBOARDING_TOOLS', () => {
  it('declares exactly 10 tools', () => {
    expect(ONBOARDING_TOOLS).toHaveLength(10);
  });

  it('includes finish_onboarding with no required parameters', () => {
    const finish = ONBOARDING_TOOLS.find((t) => t.name === 'finish_onboarding');
    expect(finish).toBeDefined();
    expect(finish?.parameters.required).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// executeOnboardingTool (Task 2)
// ---------------------------------------------------------------------------

describe('executeOnboardingTool', () => {
  const OWNER_TELEGRAM_ID = '999999999';
  let chainableSelectMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // withBusinessContext immediately invokes its callback (same style used by
    // the pre-Phase-21 step-machine tests, deleted in this phase — see git history).
    mockedWithBusinessContext.mockImplementation(async (_businessId, callback) => callback());

    // getConn() returns a chainable mock covering insert/update/select builder shapes.
    chainableSelectMock = jest.fn(() => ({ from: jest.fn().mockResolvedValue([]) }));
    const chainable = {
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      select: chainableSelectMock,
      values: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue(undefined),
      onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
      onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
      returning: jest.fn().mockResolvedValue([]),
    };
    mockedGetConn.mockReturnValue(chainable as unknown as ReturnType<typeof dbQueries.getConn>);
    mockedDbSelect.mockReturnValue({ from: jest.fn().mockResolvedValue([]) });

    mockedGenerateSlug.mockReturnValue('pilates-athens');
    mockedListServicesForBusiness.mockResolvedValue([]);
    mockedListBusinessHours.mockResolvedValue([]);
    mockedListSessions.mockResolvedValue([]);
    mockedBuildRRuleString.mockReturnValue('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    mockedCreateSessionCatalogWithExpansion.mockResolvedValue({ catalogId: 1, instanceCount: 12 });
    mockedHandleSetCancellationCutoff.mockResolvedValue('OK: cutoff set');
    mockedHandleSetLastSessionThreshold.mockResolvedValue('OK: threshold set');
    mockedSendTelegramMessage.mockResolvedValue({ messageId: 1 });
    mockedRegisterBotWebhook.mockResolvedValue(undefined);
    mockedUnregisterBotWebhook.mockResolvedValue(undefined);
    mockedActivateBusiness.mockResolvedValue(undefined);
    mockedSetMyCommands.mockResolvedValue(undefined);
    mockedSetChatMenuButton.mockResolvedValue(undefined);
  });

  it('set_business_name updates name+slug inside withBusinessContext', async () => {
    const business = makeBusiness();
    const result = await executeOnboardingTool(
      'set_business_name',
      { name: 'Pilates Athens' },
      business,
      TODAY,
      OWNER_TELEGRAM_ID
    );

    expect(mockedWithBusinessContext).toHaveBeenCalledWith(business.id, expect.any(Function));
    expect(mockedGenerateSlug).toHaveBeenCalledWith('Pilates Athens', []);
    expect(result).toContain('Pilates Athens');
  });

  // CR-01 regression: the slug-uniqueness lookup MUST run through the admin
  // `db` connection, never getConn() — getConn() is RLS-scoped to this
  // business's own row, which would silently defeat cross-tenant uniqueness.
  it('set_business_name looks up existing slugs via the admin db connection, not getConn() (CR-01)', async () => {
    const fromMock = jest.fn().mockResolvedValue([{ slug: 'pilates-athens' }, { slug: 'yoga-thessaloniki' }]);
    mockedDbSelect.mockReturnValue({ from: fromMock });
    const business = makeBusiness();

    await executeOnboardingTool('set_business_name', { name: 'Pilates Athens' }, business, TODAY, OWNER_TELEGRAM_ID);

    expect(mockedDbSelect).toHaveBeenCalledTimes(1);
    expect(mockedGenerateSlug).toHaveBeenCalledWith('Pilates Athens', ['pilates-athens', 'yoga-thessaloniki']);
    // The cross-tenant lookup happens before entering the RLS-scoped callback,
    // so getConn()'s select builder is never used for this lookup.
    expect(chainableSelectMock).not.toHaveBeenCalled();
  });

  it('set_business_hours upserts an hours row', async () => {
    const business = makeBusiness();
    const result = await executeOnboardingTool(
      'set_business_hours',
      { day_of_week: 1, open_time: '09:00', close_time: '18:00' },
      business,
      TODAY,
      OWNER_TELEGRAM_ID
    );

    expect(mockedWithBusinessContext).toHaveBeenCalledWith(business.id, expect.any(Function));
    expect(result).toContain('Δευτέρα');
  });

  it('close_day marks a day as closed', async () => {
    const business = makeBusiness();
    const result = await executeOnboardingTool('close_day', { day_of_week: 0 }, business, TODAY, OWNER_TELEGRAM_ID);

    expect(result).toContain('Κυριακή');
  });

  it('add_service inserts a service row', async () => {
    const business = makeBusiness();
    const result = await executeOnboardingTool(
      'add_service',
      { name: 'Yoga', price_cents: 2000, duration_min: 60 },
      business,
      TODAY,
      OWNER_TELEGRAM_ID
    );

    expect(result).toContain('Yoga');
  });

  it('set_booking_mode switches mode without warning when no sessions exist', async () => {
    const business = makeBusiness();
    mockedListSessions.mockResolvedValue([]);
    const result = await executeOnboardingTool(
      'set_booking_mode',
      { mode: 'fixed_sessions' },
      business,
      TODAY,
      OWNER_TELEGRAM_ID
    );

    expect(result).not.toContain('⚠️');
    expect(result.toLowerCase()).toContain('πρόγραμμα τάξεων');
  });

  it('create_class_schedule resolves service by case-insensitive partial match', async () => {
    const business = makeBusiness();
    mockedListServicesForBusiness.mockResolvedValue([makeService({ name: 'Reformer Pilates' })]);

    const result = await executeOnboardingTool(
      'create_class_schedule',
      { service_name: 'pilates', weekdays: ['Δευτέρα'], start_time: '10:00', capacity: 15 },
      business,
      TODAY,
      OWNER_TELEGRAM_ID
    );

    expect(mockedCreateSessionCatalogWithExpansion).toHaveBeenCalledWith(
      business.id,
      10,
      'FREQ=WEEKLY;BYDAY=MO,WE,FR',
      '10:00',
      15
    );
    expect(result).toContain('12');
  });

  it('create_class_schedule returns a not-found string when no service matches', async () => {
    const business = makeBusiness();
    mockedListServicesForBusiness.mockResolvedValue([makeService({ name: 'Yoga' })]);

    const result = await executeOnboardingTool(
      'create_class_schedule',
      { service_name: 'pilates', weekdays: ['Δευτέρα'], start_time: '10:00', capacity: 15 },
      business,
      TODAY,
      OWNER_TELEGRAM_ID
    );

    expect(result).toContain('Δεν βρέθηκε');
    expect(mockedCreateSessionCatalogWithExpansion).not.toHaveBeenCalled();
  });

  it('set_cancellation_cutoff delegates to handleSetCancellationCutoff inside withBusinessContext', async () => {
    const business = makeBusiness();
    const result = await executeOnboardingTool(
      'set_cancellation_cutoff',
      { enabled: true, hours: 8 },
      business,
      TODAY,
      OWNER_TELEGRAM_ID
    );

    expect(mockedHandleSetCancellationCutoff).toHaveBeenCalledWith(business.id, { enabled: true, hours: 8 });
    expect(result).toBe('OK: cutoff set');
  });

  it('set_slotless_requests updates the businesses flag', async () => {
    const business = makeBusiness();
    const result = await executeOnboardingTool(
      'set_slotless_requests',
      { enabled: true },
      business,
      TODAY,
      OWNER_TELEGRAM_ID
    );

    expect(mockedWithBusinessContext).toHaveBeenCalledWith(business.id, expect.any(Function));
    expect(result).toContain('OK');
  });

  it('set_last_session_threshold delegates to handleSetLastSessionThreshold', async () => {
    const business = makeBusiness();
    const result = await executeOnboardingTool(
      'set_last_session_threshold',
      { enabled: true, count: 2 },
      business,
      TODAY,
      OWNER_TELEGRAM_ID
    );

    expect(mockedHandleSetLastSessionThreshold).toHaveBeenCalledWith(business.id, { enabled: true, count: 2 });
    expect(result).toBe('OK: threshold set');
  });

  describe('finish_onboarding', () => {
    it('returns a Greek missing-fields string and performs no webhook/DB mutation when incomplete', async () => {
      const business = makeBusiness({ name: PLACEHOLDER_NAME });
      mockedListServicesForBusiness.mockResolvedValue([]);
      mockedListBusinessHours.mockResolvedValue(SEVEN_HOUR_ROWS.slice(0, 3));

      const result = await executeOnboardingTool('finish_onboarding', {}, business, TODAY, OWNER_TELEGRAM_ID);

      expect(result).toContain('Λείπουν');
      expect(mockedRegisterBotWebhook).not.toHaveBeenCalled();
      expect(mockedUnregisterBotWebhook).not.toHaveBeenCalled();
      expect(mockedActivateBusiness).not.toHaveBeenCalled();
    });

    it('rotates the webhook, activates the business, and sets onboardingCompleted in order when complete', async () => {
      const business = makeBusiness({ name: 'Pilates Athens' });
      mockedListServicesForBusiness.mockResolvedValue([makeService()]);
      mockedListBusinessHours.mockResolvedValue(SEVEN_HOUR_ROWS);

      const result = await executeOnboardingTool('finish_onboarding', {}, business, TODAY, OWNER_TELEGRAM_ID);

      expect(result).toBe('');
      expect(mockedUnregisterBotWebhook).toHaveBeenCalledWith(business.botToken);
      expect(mockedRegisterBotWebhook).toHaveBeenCalled();
      expect(mockedActivateBusiness).toHaveBeenCalledWith(business.id, expect.any(String), expect.any(String));

      // Ordering: unregister -> register -> activateBusiness -> onboardingCompleted update
      // (the update happens inside withBusinessContext, asserted via call presence)
      const unregisterOrder = mockedUnregisterBotWebhook.mock.invocationCallOrder[0];
      const registerOrder = mockedRegisterBotWebhook.mock.invocationCallOrder[0];
      const activateOrder = mockedActivateBusiness.mock.invocationCallOrder[0];
      expect(unregisterOrder).toBeLessThan(registerOrder);
      expect(registerOrder).toBeLessThan(activateOrder);
      expect(mockedWithBusinessContext).toHaveBeenCalledWith(business.id, expect.any(Function));

      expect(mockedSendTelegramMessage).toHaveBeenCalledWith(OWNER_TELEGRAM_ID, expect.any(String));
    });

    it('BOT-06: registers owner + client commands and menu buttons after registerBotWebhook and before activateBusiness', async () => {
      const business = makeBusiness({ name: 'Pilates Athens' });
      mockedListServicesForBusiness.mockResolvedValue([makeService()]);
      mockedListBusinessHours.mockResolvedValue(SEVEN_HOUR_ROWS);

      await executeOnboardingTool('finish_onboarding', {}, business, TODAY, OWNER_TELEGRAM_ID);

      expect(mockedSetMyCommands).toHaveBeenCalledWith(
        business.botToken,
        [{ command: 'menu', description: 'Εμφάνιση μενού διαχείρισης' }],
        { type: 'chat', chat_id: OWNER_TELEGRAM_ID }
      );
      expect(mockedSetMyCommands).toHaveBeenCalledWith(
        business.botToken,
        [{ command: 'start', description: 'Έναρξη κράτησης ραντεβού' }],
        { type: 'all_private_chats' }
      );
      expect(mockedSetChatMenuButton).toHaveBeenCalledWith(business.botToken, OWNER_TELEGRAM_ID);
      expect(mockedSetChatMenuButton).toHaveBeenCalledWith(business.botToken);
      expect(mockedSetMyCommands).toHaveBeenCalledTimes(2);
      expect(mockedSetChatMenuButton).toHaveBeenCalledTimes(2);

      const registerOrder = mockedRegisterBotWebhook.mock.invocationCallOrder[0];
      const activateOrder = mockedActivateBusiness.mock.invocationCallOrder[0];
      const setMyCommandsOrders = mockedSetMyCommands.mock.invocationCallOrder;
      const setChatMenuButtonOrders = mockedSetChatMenuButton.mock.invocationCallOrder;
      for (const order of [...setMyCommandsOrders, ...setChatMenuButtonOrders]) {
        expect(order).toBeGreaterThan(registerOrder);
        expect(order).toBeLessThan(activateOrder);
      }
    });

    it('BOT-06: a rejecting setMyCommands still lets activateBusiness run and finish_onboarding still returns empty string', async () => {
      const business = makeBusiness({ name: 'Pilates Athens' });
      mockedListServicesForBusiness.mockResolvedValue([makeService()]);
      mockedListBusinessHours.mockResolvedValue(SEVEN_HOUR_ROWS);
      mockedSetMyCommands.mockRejectedValueOnce(new Error('Telegram API down'));

      const result = await executeOnboardingTool('finish_onboarding', {}, business, TODAY, OWNER_TELEGRAM_ID);

      expect(result).toBe('');
      expect(mockedActivateBusiness).toHaveBeenCalledWith(business.id, expect.any(String), expect.any(String));
      expect(mockedSendTelegramMessage).toHaveBeenCalledWith(OWNER_TELEGRAM_ID, expect.any(String));
    });
  });

  it('returns a Greek error string for an unknown tool name', async () => {
    const business = makeBusiness();
    const result = await executeOnboardingTool('unknown_tool', {}, business, TODAY, OWNER_TELEGRAM_ID);
    expect(result).toContain('Άγνωστο εργαλείο');
  });
});

// ---------------------------------------------------------------------------
// aiOnboardingAgent Gemini loop (Task 2)
// ---------------------------------------------------------------------------

describe('aiOnboardingAgent', () => {
  const OWNER_TELEGRAM_ID = '999999999';

  beforeEach(() => {
    jest.clearAllMocks();
    mockedListServicesForBusiness.mockResolvedValue([]);
    mockedListBusinessHours.mockResolvedValue([]);
  });

  it('returns output_text directly when Gemini makes no function calls', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'interaction-1',
      output_text: 'Ποιο είναι το όνομα της επιχείρησής σας;',
      steps: [],
    });

    const business = makeBusiness();
    const result = await aiOnboardingAgent(business, OWNER_TELEGRAM_ID, 'Γεια', TODAY);

    expect(result).toBe('Ποιο είναι το όνομα της επιχείρησής σας;');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('feeds previous_interaction_id into the second call after a function_call round', async () => {
    mockCreate
      .mockResolvedValueOnce({
        id: 'interaction-1',
        steps: [{ type: 'function_call', name: 'set_business_name', arguments: { name: 'Pilates Athens' }, id: 'call-1' }],
      })
      .mockResolvedValueOnce({
        id: 'interaction-2',
        output_text: 'Ωραία! Τώρα πείτε μου το ωράριο.',
        steps: [],
      });

    mockedWithBusinessContext.mockImplementation(async (_businessId, callback) => callback());
    const chainable = {
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
      select: jest.fn(() => ({ from: jest.fn().mockResolvedValue([]) })),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue(undefined),
    };
    mockedGetConn.mockReturnValue(chainable as unknown as ReturnType<typeof dbQueries.getConn>);
    mockedGenerateSlug.mockReturnValue('pilates-athens');

    const business = makeBusiness();
    const result = await aiOnboardingAgent(business, OWNER_TELEGRAM_ID, '9 το πρωι με 9 το βραδυ', TODAY);

    expect(result).toBe('Ωραία! Τώρα πείτε μου το ωράριο.');
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[1][0]).toMatchObject({ previous_interaction_id: 'interaction-1' });
  });

  it('stops at MAX_TOOL_ROUNDS and returns the graceful Greek fallback when Gemini keeps calling tools', async () => {
    mockCreate.mockResolvedValue({
      id: 'interaction-loop',
      steps: [{ type: 'function_call', name: 'set_business_name', arguments: { name: 'Pilates Athens' }, id: 'call-x' }],
    });

    mockedWithBusinessContext.mockImplementation(async (_businessId, callback) => callback());
    const chainable = {
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
      select: jest.fn(() => ({ from: jest.fn().mockResolvedValue([]) })),
    };
    mockedGetConn.mockReturnValue(chainable as unknown as ReturnType<typeof dbQueries.getConn>);
    mockedGenerateSlug.mockReturnValue('pilates-athens');

    const business = makeBusiness();
    const result = await aiOnboardingAgent(business, OWNER_TELEGRAM_ID, 'ξανά και ξανά', TODAY);

    expect(result).toBe('Συγγνώμη, κάτι πήγε στραβά. Δοκιμάστε ξανά.');
    expect(mockCreate.mock.calls.length).toBeLessThanOrEqual(5);
  });

  it('returns empty string immediately without a second Gemini call when a tool result is ""', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'interaction-1',
      steps: [{ type: 'function_call', name: 'finish_onboarding', arguments: {}, id: 'call-1' }],
    });

    mockedListServicesForBusiness.mockResolvedValue([makeService()]);
    mockedListBusinessHours.mockResolvedValue(SEVEN_HOUR_ROWS);
    mockedWithBusinessContext.mockImplementation(async (_businessId, callback) => callback());
    const chainable = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue(undefined),
    };
    mockedGetConn.mockReturnValue(chainable as unknown as ReturnType<typeof dbQueries.getConn>);
    mockedRegisterBotWebhook.mockResolvedValue(undefined);
    mockedUnregisterBotWebhook.mockResolvedValue(undefined);
    mockedActivateBusiness.mockResolvedValue(undefined);
    mockedSendTelegramMessage.mockResolvedValue({ messageId: 1 });

    const business = makeBusiness({ name: 'Pilates Athens' });
    const result = await aiOnboardingAgent(business, OWNER_TELEGRAM_ID, 'Τελείωσα', TODAY);

    expect(result).toBe('');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
