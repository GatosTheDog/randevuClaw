/**
 * tests/onboarding/steps.test.ts
 *
 * Unit tests for the class_setup_* step handlers in src/onboarding/steps.ts.
 * Covers CLSS-01/02/03/04 behaviours:
 *   CLSS-01: class_setup_query Ναι→service step, Όχι→handleActivate (skip)
 *   CLSS-02: class_setup_service matches by name/number, advances to weekdays
 *   CLSS-03: class_setup_weekdays parses Greek names + 'καθημερινά' shorthand
 *   CLSS-03: class_setup_time validates HH:MM, class_setup_capacity validates 1-99
 *   CLSS-04: class_setup_more Ναι resets/reuses flow, Όχι calls handleActivate
 *   CLSS-05: handleConfigLastSessionThresholdStep branches on bookingMode
 */

import * as onboardingQueries from '../../src/onboarding/queries';
import * as telegramClient from '../../src/telegram/client';
import * as registryModule from '../../src/telegram/registry';
import * as dbModule from '../../src/database/db';
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
// Typed mocks
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

function makeSession(currentStep: string, collectedData: string | null = null): OnboardingSession {
  return {
    id: 1,
    businessId: 1,
    currentStep,
    collectedData,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeBusiness(overrides: Partial<Business> = {}): Business {
  return {
    id: 1,
    name: 'Test Business',
    slug: 'test',
    phoneNumberId: null,
    ownerTelegramId: '999',
    botToken: 'bot-token',
    webhookId: 'wh-id',
    webhookSecret: 'secret',
    googleRefreshToken: null,
    agendaSentDate: null,
    enforcementPolicy: 'allow',
    bookingMode: 'fixed_sessions',
    allowMultiBooking: false,
    cancellationCutoffEnabled: false,
    cancellationCutoffHours: 0,
    slotlessRequestsEnabled: false,
    lastSessionThresholdEnabled: false,
    lastSessionThresholdCount: 0,
    onboardingCompleted: false,
    createdAt: new Date(),
    ...overrides,
  };
}

const OWNER_ID = '999';

const FAKE_SERVICE = {
  id: 42,
  businessId: 1,
  name: 'Reformer Pilates',
  durationMin: 60,
  price: 2000,
  createdAt: new Date(),
};

// ---------------------------------------------------------------------------
// beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  if (registryModule.clearBotRegistry) registryModule.clearBotRegistry();
  jest.clearAllMocks();

  mockedUpdateOnboardingStep.mockResolvedValue(undefined);
  mockedSendTelegramMessage.mockResolvedValue({ messageId: 1 });
  mockedSendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
  mockedActivateBusiness.mockResolvedValue(undefined);
  mockedRegisterBotWebhook.mockResolvedValue(undefined);
  mockedUnregisterBotWebhook.mockResolvedValue(undefined);

  mockedListServicesForBusiness.mockResolvedValue([FAKE_SERVICE]);
  mockedFindServiceById.mockResolvedValue(FAKE_SERVICE);
  mockedBuildRRuleString.mockReturnValue('FREQ=WEEKLY;BYDAY=MO,WE,FR');
  mockedCreateSessionCatalogWithExpansion.mockResolvedValue({ catalogId: 10, instanceCount: 13 });

  (telegramClient.botTokenStore?.run as jest.Mock | undefined)?.mockImplementation(
    (_value: string, callback: () => Promise<unknown>) => callback()
  );
});

// ---------------------------------------------------------------------------
// handleClassSetupQuery
// ---------------------------------------------------------------------------

describe('handleClassSetupQuery', () => {
  it('Ναι → advances to class_setup_service and lists services', async () => {
    await handleClassSetupQuery(
      makeSession('class_setup_query'),
      makeBusiness(),
      OWNER_ID,
      'Ναι'
    );

    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(1, 'class_setup_service', null);
    // A message listing services must be sent
    const allTexts = [
      ...mockedSendTelegramMessage.mock.calls.map((c) => c[1] ?? ''),
      ...mockedSendTelegramMessageWithKeyboard.mock.calls.map((c) => c[1] ?? ''),
    ];
    expect(allTexts.some((t) => t.toLowerCase().includes('υπηρεσ'))).toBe(true);
  });

  it('Όχι → calls handleActivate (session advances to done), does NOT advance to class_setup_service', async () => {
    await handleClassSetupQuery(
      makeSession('class_setup_query'),
      makeBusiness(),
      OWNER_ID,
      'Όχι'
    );

    // handleActivate sets step to 'done'
    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(1, 'done', null);
    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalledWith(1, 'class_setup_service', null);
  });

  it('Unrecognized → re-sends Ναι/Όχι keyboard without advancing', async () => {
    await handleClassSetupQuery(
      makeSession('class_setup_query'),
      makeBusiness(),
      OWNER_ID,
      'ίσως'
    );

    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleClassSetupServiceStep
// ---------------------------------------------------------------------------

describe('handleClassSetupServiceStep', () => {
  it('Name match → stores serviceId in collectedData, advances to class_setup_weekdays', async () => {
    const cd = JSON.stringify({});
    await handleClassSetupServiceStep(
      makeSession('class_setup_service', cd),
      makeBusiness(),
      OWNER_ID,
      'Reformer Pilates'
    );

    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(
      1,
      'class_setup_weekdays',
      expect.stringContaining('"serviceId":42')
    );
  });

  it('Numeric selection "1" → selects first service, advances to class_setup_weekdays', async () => {
    await handleClassSetupServiceStep(
      makeSession('class_setup_service', null),
      makeBusiness(),
      OWNER_ID,
      '1'
    );

    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(
      1,
      'class_setup_weekdays',
      expect.stringContaining('"serviceId":42')
    );
  });

  it('No match → sends numbered list and does NOT advance', async () => {
    await handleClassSetupServiceStep(
      makeSession('class_setup_service', null),
      makeBusiness(),
      OWNER_ID,
      'Yoga' // does not match 'Reformer Pilates'
    );

    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalled();
    const allTexts = [
      ...mockedSendTelegramMessage.mock.calls.map((c) => c[1] ?? ''),
      ...mockedSendTelegramMessageWithKeyboard.mock.calls.map((c) => c[1] ?? ''),
    ];
    expect(allTexts.some((t) => t.includes('1.') || t.includes('1)'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleClassSetupWeekdaysStep
// ---------------------------------------------------------------------------

describe('handleClassSetupWeekdaysStep', () => {
  const cd = JSON.stringify({ classSetup: { serviceId: 42 } });

  it('"Δευτέρα, Τετάρτη, Παρασκευή" → stores 3 weekdays, advances to class_setup_time', async () => {
    await handleClassSetupWeekdaysStep(
      makeSession('class_setup_weekdays', cd),
      makeBusiness(),
      OWNER_ID,
      'Δευτέρα, Τετάρτη, Παρασκευή'
    );

    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(
      1,
      'class_setup_time',
      expect.stringContaining('Δευτέρα')
    );
    const payload = mockedUpdateOnboardingStep.mock.calls[0][2] as string;
    const parsed = JSON.parse(payload);
    expect(parsed.classSetup.weekdays).toHaveLength(3);
  });

  it('"καθημερινά" → stores 5 weekdays (Mon-Fri), advances to class_setup_time', async () => {
    await handleClassSetupWeekdaysStep(
      makeSession('class_setup_weekdays', cd),
      makeBusiness(),
      OWNER_ID,
      'καθημερινά'
    );

    const payload = mockedUpdateOnboardingStep.mock.calls[0][2] as string;
    const parsed = JSON.parse(payload);
    expect(parsed.classSetup.weekdays).toHaveLength(5);
    expect(parsed.classSetup.weekdays).toContain('Δευτέρα');
    expect(parsed.classSetup.weekdays).toContain('Παρασκευή');
  });

  it('Unrecognized text → does NOT advance, sends re-ask message', async () => {
    await handleClassSetupWeekdaysStep(
      makeSession('class_setup_weekdays', cd),
      makeBusiness(),
      OWNER_ID,
      'Monday' // English — not in GREEK_DAY_NAMES
    );

    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalled();
    const allTexts = mockedSendTelegramMessage.mock.calls.map((c) => c[1] ?? '');
    expect(allTexts.some((t) => t.includes('αναγνωρ') || t.includes('μέρες'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleClassSetupTimeStep
// ---------------------------------------------------------------------------

describe('handleClassSetupTimeStep', () => {
  const cd = JSON.stringify({ classSetup: { serviceId: 42, weekdays: ['Δευτέρα'] } });

  it('"09:00" → stores startTime, advances to class_setup_capacity', async () => {
    await handleClassSetupTimeStep(
      makeSession('class_setup_time', cd),
      makeBusiness(),
      OWNER_ID,
      '09:00'
    );

    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(
      1,
      'class_setup_capacity',
      expect.stringContaining('"startTime":"09:00"')
    );
  });

  it('"9am" (invalid) → does NOT advance, sends error', async () => {
    await handleClassSetupTimeStep(
      makeSession('class_setup_time', cd),
      makeBusiness(),
      OWNER_ID,
      '9am'
    );

    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalled();
    const allTexts = mockedSendTelegramMessage.mock.calls.map((c) => c[1] ?? '');
    expect(allTexts.some((t) => t.includes('ΩΩ:ΛΛ') || t.includes('έγκυρ'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleClassSetupCapacityStep
// ---------------------------------------------------------------------------

describe('handleClassSetupCapacityStep', () => {
  const cd = JSON.stringify({
    classSetup: { serviceId: 42, weekdays: ['Δευτέρα', 'Τετάρτη', 'Παρασκευή'], startTime: '10:00' },
  });

  it('"4" → calls buildRRuleString + createSessionCatalogWithExpansion, advances to class_setup_more', async () => {
    await handleClassSetupCapacityStep(
      makeSession('class_setup_capacity', cd),
      makeBusiness(),
      OWNER_ID,
      '4'
    );

    expect(mockedBuildRRuleString).toHaveBeenCalledWith(
      ['Δευτέρα', 'Τετάρτη', 'Παρασκευή'],
      '10:00'
    );
    expect(mockedCreateSessionCatalogWithExpansion).toHaveBeenCalledWith(
      1, 42, 'FREQ=WEEKLY;BYDAY=MO,WE,FR', '10:00', 4
    );
    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(
      1,
      'class_setup_more',
      null
    );
    // Confirmation message with instance count
    const allTexts = mockedSendTelegramMessageWithKeyboard.mock.calls.map((c) => c[1] ?? '');
    expect(allTexts.some((t) => t.includes('13') || t.includes('Δημιουργήθηκ'))).toBe(true);
  });

  it('"0" (invalid capacity) → does NOT advance, sends error', async () => {
    await handleClassSetupCapacityStep(
      makeSession('class_setup_capacity', cd),
      makeBusiness(),
      OWNER_ID,
      '0'
    );

    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalled();
    const allTexts = mockedSendTelegramMessage.mock.calls.map((c) => c[1] ?? '');
    expect(allTexts.some((t) => t.includes('1-99') || t.includes('έγκυρ'))).toBe(true);
  });

  it('"100" (out of range) → does NOT advance, sends error', async () => {
    await handleClassSetupCapacityStep(
      makeSession('class_setup_capacity', cd),
      makeBusiness(),
      OWNER_ID,
      '100'
    );

    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleClassSetupMoreStep
// ---------------------------------------------------------------------------

describe('handleClassSetupMoreStep', () => {
  it('Ναι → resets classSetup, advances to class_setup_service', async () => {
    const cd = JSON.stringify({ classSetup: { serviceId: 42, weekdays: ['Δευτέρα'], startTime: '10:00', capacity: 4 } });
    await handleClassSetupMoreStep(
      makeSession('class_setup_more', cd),
      makeBusiness(),
      OWNER_ID,
      'Ναι'
    );

    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(
      1,
      'class_setup_service',
      expect.any(String)
    );
    // The classSetup in collectedData should be cleared
    const payload = mockedUpdateOnboardingStep.mock.calls[0][2] as string;
    const parsed = JSON.parse(payload);
    expect(parsed.classSetup).toBeDefined();
    // serviceId should be cleared
    expect(parsed.classSetup.serviceId).toBeUndefined();
  });

  it('Όχι → calls handleActivate, session reaches done', async () => {
    await handleClassSetupMoreStep(
      makeSession('class_setup_more'),
      makeBusiness(),
      OWNER_ID,
      'Όχι'
    );

    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(1, 'done', null);
    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalledWith(1, 'class_setup_service', null);
  });

  it('Unrecognized → re-sends keyboard without advancing', async () => {
    await handleClassSetupMoreStep(
      makeSession('class_setup_more'),
      makeBusiness(),
      OWNER_ID,
      'maybe'
    );

    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleConfigLastSessionThresholdStep — bookingMode branch
// ---------------------------------------------------------------------------

describe('handleConfigLastSessionThresholdStep — bookingMode branch', () => {
  it('fixed_sessions mode → advances to class_setup_query with Ναι/Όχι keyboard', async () => {
    await handleConfigLastSessionThresholdStep(
      makeSession('config_last_session_threshold'),
      makeBusiness({ bookingMode: 'fixed_sessions' }),
      OWNER_ID,
      'παράλειψη'
    );

    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(1, 'class_setup_query', null);
    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalledWith(1, 'done', null);
    // Must send Ναι/Όχι keyboard prompt about class schedule
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalled();
    const sentText = mockedSendTelegramMessageWithKeyboard.mock.calls[0]?.[1] ?? '';
    expect(sentText.toLowerCase()).toMatch(/πρόγραμμα|μαθημάτ/);
  });

  it('open_slots mode → calls handleActivate (session reaches done)', async () => {
    await handleConfigLastSessionThresholdStep(
      makeSession('config_last_session_threshold'),
      makeBusiness({ bookingMode: 'open_slots' }),
      OWNER_ID,
      'παράλειψη'
    );

    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(1, 'done', null);
    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalledWith(1, 'class_setup_query', null);
  });
});
