/**
 * tests/onboarding/class-setup-steps.test.ts
 *
 * 14 targeted tests (A–N) for the class_setup_* step handlers in
 * src/onboarding/steps.ts.  All DB mutations and Telegram API calls are
 * mocked — no real DB or network access occurs.
 *
 * Test coverage:
 *   A  handleClassSetupQuery Όχι → does NOT advance to class_setup_service
 *   B  handleClassSetupQuery Ναι → advances to class_setup_service
 *   C  handleClassSetupServiceStep name match → advances to class_setup_weekdays
 *   D  handleClassSetupServiceStep no match → re-ask, step NOT advanced
 *   E  handleClassSetupWeekdaysStep 'καθημερινά' → 5 weekdays
 *   F  handleClassSetupWeekdaysStep explicit 2 days → 2 weekdays
 *   G  handleClassSetupTimeStep valid '09:00' → advances to class_setup_capacity
 *   H  handleClassSetupTimeStep invalid 'abc' → step NOT advanced
 *   I  handleClassSetupCapacityStep '4' → createSessionCatalogWithExpansion called
 *   J  handleClassSetupCapacityStep '0' → step NOT advanced
 *   K  handleClassSetupMoreStep Ναι → advances to class_setup_service
 *   L  handleClassSetupMoreStep Όχι → handleActivate (activateBusiness called)
 *   M  handleConfigLastSessionThresholdStep fixed_sessions → class_setup_query
 *   N  handleConfigLastSessionThresholdStep open_slots → handleActivate
 *
 * NEVER run bare `npm test` — machine crashes on full suite.
 * Use: npm test -- --testPathPattern="class-setup-steps" --testTimeout=20000
 */

import * as onboardingQueries from '../../src/onboarding/queries';
import * as telegramClient from '../../src/telegram/client';
import * as registryModule from '../../src/telegram/registry';
import * as dbQueries from '../../src/database/queries';
import * as sessionManager from '../../src/session/manager';
import {
  handleClassSetupQuery,
  handleClassSetupServiceStep,
  handleClassSetupWeekdaysStep,
  handleClassSetupTimeStep,
  handleClassSetupCapacityStep,
  handleClassSetupMoreStep,
  handleConfigLastSessionThresholdStep,
} from '../../src/onboarding/steps';
import type { OnboardingSession } from '../../src/onboarding/queries';
import type { Business } from '../../src/database/queries';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

jest.mock('../../src/onboarding/queries');
jest.mock('../../src/telegram/client');
jest.mock('../../src/telegram/registry');
jest.mock('../../src/database/queries');
jest.mock('../../src/session/manager');

// Mock db to prevent real connections. steps.ts uses db.update and db.insert.
jest.mock('../../src/database/db', () => ({
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

// ---------------------------------------------------------------------------
// Typed mock references
// ---------------------------------------------------------------------------

const mockedUpdateOnboardingStep = onboardingQueries.updateOnboardingStep as jest.MockedFunction<
  typeof onboardingQueries.updateOnboardingStep
>;
const mockedActivateBusiness = onboardingQueries.activateBusiness as jest.MockedFunction<
  typeof onboardingQueries.activateBusiness
>;
const mockedSendTelegramMessage = telegramClient.sendTelegramMessage as jest.MockedFunction<
  typeof telegramClient.sendTelegramMessage
>;
const mockedSendTelegramMessageWithKeyboard = telegramClient.sendTelegramMessageWithKeyboard as jest.MockedFunction<
  typeof telegramClient.sendTelegramMessageWithKeyboard
>;
const mockedRegisterBotWebhook = telegramClient.registerBotWebhook as jest.MockedFunction<
  typeof telegramClient.registerBotWebhook
>;
const mockedUnregisterBotWebhook = telegramClient.unregisterBotWebhook as jest.MockedFunction<
  typeof telegramClient.unregisterBotWebhook
>;
const mockedListServicesForBusiness = dbQueries.listServicesForBusiness as jest.MockedFunction<
  typeof dbQueries.listServicesForBusiness
>;
const mockedFindServiceById = dbQueries.findServiceById as jest.MockedFunction<
  typeof dbQueries.findServiceById
>;
const mockedBuildRRuleString = sessionManager.buildRRuleString as jest.MockedFunction<
  typeof sessionManager.buildRRuleString
>;
const mockedCreateSessionCatalogWithExpansion = sessionManager.createSessionCatalogWithExpansion as jest.MockedFunction<
  typeof sessionManager.createSessionCatalogWithExpansion
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OWNER_TG = 'owner-123';

function buildSession(
  step: string,
  collectedData: Record<string, unknown> = {}
): OnboardingSession {
  return {
    id: 1,
    businessId: 99,
    currentStep: step,
    collectedData: JSON.stringify(collectedData),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildBusiness(bookingMode = 'fixed_sessions'): Business {
  return {
    id: 99,
    name: 'Studio',
    slug: 'studio',
    phoneNumberId: null,
    ownerTelegramId: OWNER_TG,
    googleRefreshToken: null,
    agendaSentDate: null,
    botToken: 'tok',
    webhookId: null,
    webhookSecret: null,
    enforcementPolicy: 'allow',
    bookingMode,
    allowMultiBooking: false,
    cancellationCutoffEnabled: false,
    cancellationCutoffHours: 0,
    slotlessRequestsEnabled: false,
    lastSessionThresholdEnabled: false,
    lastSessionThresholdCount: 0,
    onboardingCompleted: false,
    createdAt: new Date(),
  };
}

const FAKE_SERVICE = {
  id: 42,
  businessId: 99,
  name: 'Pilates Reformer',
  durationMin: 60,
  price: 2000,
  createdAt: new Date(),
};

// ---------------------------------------------------------------------------
// beforeEach — reset mocks and set default return values
// ---------------------------------------------------------------------------

beforeEach(() => {
  if (registryModule.clearBotRegistry) registryModule.clearBotRegistry();
  jest.clearAllMocks();

  mockedUpdateOnboardingStep.mockResolvedValue(undefined);
  mockedActivateBusiness.mockResolvedValue(undefined);
  mockedSendTelegramMessage.mockResolvedValue({ messageId: 1 });
  mockedSendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
  mockedRegisterBotWebhook.mockResolvedValue(undefined);
  mockedUnregisterBotWebhook.mockResolvedValue(undefined);

  mockedListServicesForBusiness.mockResolvedValue([FAKE_SERVICE]);
  mockedFindServiceById.mockResolvedValue(FAKE_SERVICE);
  mockedBuildRRuleString.mockReturnValue('FREQ=WEEKLY;BYDAY=MO,WE');
  mockedCreateSessionCatalogWithExpansion.mockResolvedValue({ catalogId: 1, instanceCount: 12 });

  // botTokenStore.run mock: needed for handleActivate path
  (telegramClient.botTokenStore?.run as jest.Mock | undefined)?.mockImplementation(
    (_value: string, callback: () => Promise<unknown>) => callback()
  );
});

// ---------------------------------------------------------------------------
// Test A — handleClassSetupQuery skip path (Όχι → handleActivate, NOT class_setup_service)
// ---------------------------------------------------------------------------

describe('Test A — handleClassSetupQuery skip (Όχι)', () => {
  it('Όχι: does NOT call updateOnboardingStep with class_setup_service', async () => {
    await handleClassSetupQuery(
      buildSession('class_setup_query'),
      buildBusiness(),
      OWNER_TG,
      'όχι'
    );

    // handleActivate sets step to 'done', never to 'class_setup_service'
    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalledWith(
      expect.anything(),
      'class_setup_service',
      expect.anything()
    );
    // handleActivate must reach activation (activateBusiness called)
    expect(mockedActivateBusiness).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test B — handleClassSetupQuery advance path (Ναι → class_setup_service)
// ---------------------------------------------------------------------------

describe('Test B — handleClassSetupQuery advance (Ναι)', () => {
  it('Ναι: calls updateOnboardingStep with class_setup_service', async () => {
    await handleClassSetupQuery(
      buildSession('class_setup_query'),
      buildBusiness(),
      OWNER_TG,
      'ναι'
    );

    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(
      1,
      'class_setup_service',
      null
    );
  });
});

// ---------------------------------------------------------------------------
// Test C — handleClassSetupServiceStep name match → class_setup_weekdays
// ---------------------------------------------------------------------------

describe('Test C — handleClassSetupServiceStep name match', () => {
  it('matching service name → advances to class_setup_weekdays', async () => {
    await handleClassSetupServiceStep(
      buildSession('class_setup_service'),
      buildBusiness(),
      OWNER_TG,
      'Pilates Reformer'
    );

    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(
      1,
      'class_setup_weekdays',
      expect.any(String)
    );
  });
});

// ---------------------------------------------------------------------------
// Test D — handleClassSetupServiceStep no match → re-ask, step NOT advanced
// ---------------------------------------------------------------------------

describe('Test D — handleClassSetupServiceStep no match', () => {
  it('unrecognized name → step NOT advanced, sendTelegramMessage called', async () => {
    await handleClassSetupServiceStep(
      buildSession('class_setup_service'),
      buildBusiness(),
      OWNER_TG,
      'nonexistent'
    );

    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessage).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test E — handleClassSetupWeekdaysStep 'καθημερινά' → 5 weekdays
// ---------------------------------------------------------------------------

describe('Test E — handleClassSetupWeekdaysStep καθημερινά', () => {
  it('καθημερινά: collectedData.classSetup.weekdays has 5 items', async () => {
    await handleClassSetupWeekdaysStep(
      buildSession('class_setup_weekdays', { classSetup: { serviceId: 42 } }),
      buildBusiness(),
      OWNER_TG,
      'καθημερινά'
    );

    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(
      1,
      'class_setup_time',
      expect.any(String)
    );
    const payload = mockedUpdateOnboardingStep.mock.calls[0][2] as string;
    const parsed = JSON.parse(payload);
    expect(parsed.classSetup.weekdays).toHaveLength(5);
    expect(parsed.classSetup.weekdays).toContain('Δευτέρα');
    expect(parsed.classSetup.weekdays).toContain('Παρασκευή');
  });
});

// ---------------------------------------------------------------------------
// Test F — handleClassSetupWeekdaysStep explicit 2 days → 2 weekdays
// ---------------------------------------------------------------------------

describe('Test F — handleClassSetupWeekdaysStep explicit days', () => {
  it('"Δευτέρα, Τετάρτη" → weekdays has 2 items', async () => {
    await handleClassSetupWeekdaysStep(
      buildSession('class_setup_weekdays', { classSetup: { serviceId: 42 } }),
      buildBusiness(),
      OWNER_TG,
      'Δευτέρα, Τετάρτη'
    );

    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(
      1,
      'class_setup_time',
      expect.any(String)
    );
    const payload = mockedUpdateOnboardingStep.mock.calls[0][2] as string;
    const parsed = JSON.parse(payload);
    expect(parsed.classSetup.weekdays).toHaveLength(2);
    expect(parsed.classSetup.weekdays).toContain('Δευτέρα');
    expect(parsed.classSetup.weekdays).toContain('Τετάρτη');
  });
});

// ---------------------------------------------------------------------------
// Test G — handleClassSetupTimeStep valid '09:00' → class_setup_capacity
// ---------------------------------------------------------------------------

describe('Test G — handleClassSetupTimeStep valid', () => {
  it('"09:00" → advances to class_setup_capacity', async () => {
    await handleClassSetupTimeStep(
      buildSession('class_setup_time', { classSetup: { serviceId: 42, weekdays: ['Δευτέρα'] } }),
      buildBusiness(),
      OWNER_TG,
      '09:00'
    );

    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(
      1,
      'class_setup_capacity',
      expect.stringContaining('"startTime":"09:00"')
    );
  });
});

// ---------------------------------------------------------------------------
// Test H — handleClassSetupTimeStep invalid 'abc' → step NOT advanced
// ---------------------------------------------------------------------------

describe('Test H — handleClassSetupTimeStep invalid', () => {
  it('"abc" (invalid) → updateOnboardingStep NOT called', async () => {
    await handleClassSetupTimeStep(
      buildSession('class_setup_time', { classSetup: { serviceId: 42, weekdays: ['Δευτέρα'] } }),
      buildBusiness(),
      OWNER_TG,
      'abc'
    );

    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessage).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test I — handleClassSetupCapacityStep '4' → createSessionCatalogWithExpansion called
// ---------------------------------------------------------------------------

describe('Test I — handleClassSetupCapacityStep valid capacity', () => {
  it('"4" → createSessionCatalogWithExpansion called with (99, 42, rrule, startTime, 4)', async () => {
    await handleClassSetupCapacityStep(
      buildSession('class_setup_capacity', {
        classSetup: { serviceId: 42, weekdays: ['Δευτέρα'], startTime: '09:00' },
      }),
      buildBusiness(),
      OWNER_TG,
      '4'
    );

    expect(mockedCreateSessionCatalogWithExpansion).toHaveBeenCalledWith(
      99,
      42,
      expect.any(String),
      '09:00',
      4
    );
    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(
      1,
      'class_setup_more',
      null
    );
  });
});

// ---------------------------------------------------------------------------
// Test J — handleClassSetupCapacityStep '0' → step NOT advanced
// ---------------------------------------------------------------------------

describe('Test J — handleClassSetupCapacityStep invalid capacity', () => {
  it('"0" → updateOnboardingStep NOT called', async () => {
    await handleClassSetupCapacityStep(
      buildSession('class_setup_capacity', {
        classSetup: { serviceId: 42, weekdays: ['Δευτέρα'], startTime: '09:00' },
      }),
      buildBusiness(),
      OWNER_TG,
      '0'
    );

    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessage).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test K — handleClassSetupMoreStep Ναι → class_setup_service
// ---------------------------------------------------------------------------

describe('Test K — handleClassSetupMoreStep Ναι', () => {
  it('Ναι → advances to class_setup_service', async () => {
    await handleClassSetupMoreStep(
      buildSession('class_setup_more'),
      buildBusiness(),
      OWNER_TG,
      'ναι'
    );

    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(
      1,
      'class_setup_service',
      expect.any(String)
    );
  });
});

// ---------------------------------------------------------------------------
// Test L — handleClassSetupMoreStep Όχι → handleActivate (activateBusiness called)
// ---------------------------------------------------------------------------

describe('Test L — handleClassSetupMoreStep Όχι', () => {
  it('Όχι → activateBusiness called (handleActivate path)', async () => {
    await handleClassSetupMoreStep(
      buildSession('class_setup_more'),
      buildBusiness(),
      OWNER_TG,
      'όχι'
    );

    expect(mockedActivateBusiness).toHaveBeenCalled();
    // handleActivate sets step to 'done'
    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(1, 'done', null);
  });
});

// ---------------------------------------------------------------------------
// Test M — handleConfigLastSessionThresholdStep fixed_sessions → class_setup_query
// ---------------------------------------------------------------------------

describe('Test M — handleConfigLastSessionThresholdStep fixed_sessions', () => {
  it('bookingMode=fixed_sessions → advances to class_setup_query', async () => {
    await handleConfigLastSessionThresholdStep(
      buildSession('config_last_session_threshold'),
      buildBusiness('fixed_sessions'),
      OWNER_TG,
      '3'
    );

    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(1, 'class_setup_query', null);
    // Must NOT have gone straight to 'done'
    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalledWith(1, 'done', null);
  });
});

// ---------------------------------------------------------------------------
// Test N — handleConfigLastSessionThresholdStep open_slots → handleActivate
// ---------------------------------------------------------------------------

describe('Test N — handleConfigLastSessionThresholdStep open_slots', () => {
  it('bookingMode=open_slots → activateBusiness called (handleActivate path)', async () => {
    await handleConfigLastSessionThresholdStep(
      buildSession('config_last_session_threshold'),
      buildBusiness('open_slots'),
      OWNER_TG,
      '3'
    );

    expect(mockedActivateBusiness).toHaveBeenCalled();
    // handleActivate advances step to 'done'
    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(1, 'done', null);
    // Must NOT have gone to class_setup_query
    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalledWith(1, 'class_setup_query', null);
  });
});
