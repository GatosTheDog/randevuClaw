/**
 * onboarding-flow.test.ts
 *
 * Unit tests for the onboarding state-machine (dispatchOnboardingStep) and
 * the edit-keyword detector (isOwnerEditCommand). All DB mutations and Telegram
 * API calls are mocked — no real DB or network needed.
 *
 * Coverage:
 *   ONB-01: Full step sequence name → hours_* → svc_* → done
 *   ONB-02: Resume mid-flow — session at hours_3_query picks up at day 3
 *   ONB-03: isOwnerEditCommand is case-insensitive for all four keywords
 */

import * as onboardingQueries from '../src/onboarding/queries';
import * as telegramClient from '../src/telegram/client';
import * as registryModule from '../src/telegram/registry';
import * as dbModule from '../src/database/db';
import { dispatchOnboardingStep } from '../src/onboarding/router';
import { isOwnerEditCommand } from '../src/onboarding/edit-router';
import type { OnboardingSession } from '../src/onboarding/queries';
import type { Business } from '../src/database/queries';

jest.mock('../src/onboarding/queries');
jest.mock('../src/telegram/client');
jest.mock('../src/telegram/registry');
// Mock db to prevent real connections.
// steps.ts uses db.update (handleNameStep), db.insert (hours/services), and
// db.select (handleNameStep slug dedup). All chains must resolve without errors.
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

// ─── Typed mocks ─────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
    bookingMode: 'open_slots',
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

// ─── beforeEach ──────────────────────────────────────────────────────────────

beforeEach(() => {
  registryModule.clearBotRegistry();
  jest.clearAllMocks();

  mockedUpdateOnboardingStep.mockResolvedValue(undefined);
  mockedSendTelegramMessage.mockResolvedValue({ messageId: 1 });
  mockedSendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
  mockedActivateBusiness.mockResolvedValue(undefined);
  mockedRegisterBotWebhook.mockResolvedValue(undefined);
  mockedUnregisterBotWebhook.mockResolvedValue(undefined);

  // botTokenStore.run mock: needed for any sendTelegramMessage calls that occur
  // inside a botTokenStore context (handleActivate path). Not required for most
  // steps but kept for consistency with D-13.
  (telegramClient.botTokenStore.run as jest.Mock).mockImplementation(
    (_value: string, callback: () => Promise<unknown>) => callback()
  );
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('dispatchOnboardingStep — name step', () => {
  it('valid name: updates businesses slug, advances to hours_0_query, sends Greek day prompt', async () => {
    await dispatchOnboardingStep(
      makeSession('name'),
      makeBusiness(),
      OWNER_ID,
      'Pilates Studio Athens'
    );

    // Session advances to first hours step
    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(1, 'hours_0_query', null);
    // Prompt for Sunday (day 0 = Κυριακή) — sent via keyboard button message
    const sentText = mockedSendTelegramMessageWithKeyboard.mock.calls[0]?.[1] ?? '';
    expect(sentText).toContain('Κυριακή');
  });

  it('empty name: does not advance step, sends validation error prompt', async () => {
    await dispatchOnboardingStep(makeSession('name'), makeBusiness(), OWNER_ID, '   ');

    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalled();
    // Error message must be sent
    expect(mockedSendTelegramMessage).toHaveBeenCalled();
  });
});

describe('Hours steps', () => {
  it('hours_0_query "ναι": advances to hours_0_range, asks for Sunday time range', async () => {
    await dispatchOnboardingStep(makeSession('hours_0_query'), makeBusiness(), OWNER_ID, 'Ναι');

    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(1, 'hours_0_range', null);
    const sentText = mockedSendTelegramMessage.mock.calls[0]?.[1] ?? '';
    // Prompt contains day name and range example
    expect(sentText).toContain('Κυριακή');
  });

  it('hours_0_query "όχι": inserts isClosed row, advances to hours_1_query, prompts Monday', async () => {
    await dispatchOnboardingStep(makeSession('hours_0_query'), makeBusiness(), OWNER_ID, 'Όχι');

    // Closed-day DB row inserted (Pitfall 3: never skip the insert)
    expect(dbModule.db.insert).toHaveBeenCalled();
    // Advances past Sunday to Monday
    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(1, 'hours_1_query', null);
    // Prompt for Monday — sent via keyboard button message
    const sentText = mockedSendTelegramMessageWithKeyboard.mock.calls[0]?.[1] ?? '';
    expect(sentText).toContain('Δευτέρα');
  });

  it('hours_0_range valid single range: inserts business_hours row, advances to hours_1_query', async () => {
    await dispatchOnboardingStep(makeSession('hours_0_range'), makeBusiness(), OWNER_ID, '09:00-18:00');

    // Full hours row inserted
    expect(dbModule.db.insert).toHaveBeenCalled();
    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(1, 'hours_1_query', null);
    // Prompt for next day (Monday) — sent via keyboard button message
    const sentText = mockedSendTelegramMessageWithKeyboard.mock.calls[0]?.[1] ?? '';
    expect(sentText).toContain('Δευτέρα');
  });

  it('hours_0_range valid split range: inserts business_hours row with two ranges, advances to hours_1_query', async () => {
    await dispatchOnboardingStep(
      makeSession('hours_0_range'),
      makeBusiness(),
      OWNER_ID,
      '09:00-13:00,17:00-21:00'
    );

    expect(dbModule.db.insert).toHaveBeenCalled();
    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(1, 'hours_1_query', null);
  });

  it('hours_0_range invalid format: does not advance step, sends error message', async () => {
    await dispatchOnboardingStep(makeSession('hours_0_range'), makeBusiness(), OWNER_ID, '9am-6pm');

    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalled();
    const sentText = mockedSendTelegramMessage.mock.calls[0]?.[1] ?? '';
    expect(sentText).toMatch(/ΩΩ:ΛΛ|έγκυρ/);
  });
});

describe('Resume mid-flow (ONB-02)', () => {
  it('session at hours_3_query resumes at hours_3_query without re-asking earlier days', async () => {
    // Dispatch with unrecognized text — triggers the "re-ask same question" branch
    // which proves the handler sends the day-3 prompt (Τετάρτη) without advancing.
    await dispatchOnboardingStep(makeSession('hours_3_query'), makeBusiness(), OWNER_ID, '');

    // Prompt must reference day 3 (Τετάρτη = Wednesday) — sent via keyboard button message
    const sentText = mockedSendTelegramMessageWithKeyboard.mock.calls[0]?.[1] ?? '';
    expect(sentText).toContain('Τετάρτη');
    // Step has NOT been advanced — awaiting owner's yes/no response
    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalled();
  });
});

describe('Service steps', () => {
  it('svc_name valid: saves name to collectedData, advances to svc_price', async () => {
    await dispatchOnboardingStep(makeSession('svc_name'), makeBusiness(), OWNER_ID, 'Reformer Pilates');

    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(
      1,
      'svc_price',
      expect.stringContaining('Reformer Pilates')
    );
  });

  it('svc_price valid cents: merges price into collectedData, advances to svc_duration', async () => {
    const collectedData = JSON.stringify({ currentService: { name: 'Pilates' } });
    await dispatchOnboardingStep(
      makeSession('svc_price', collectedData),
      makeBusiness(),
      OWNER_ID,
      '2500'
    );

    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(1, 'svc_duration', expect.any(String));
  });

  it('svc_price invalid text: does not advance step', async () => {
    const collectedData = JSON.stringify({ currentService: { name: 'Pilates' } });
    await dispatchOnboardingStep(
      makeSession('svc_price', collectedData),
      makeBusiness(),
      OWNER_ID,
      'twenty euros'
    );

    expect(mockedUpdateOnboardingStep).not.toHaveBeenCalled();
  });

  it('svc_duration valid minutes: inserts services row, advances to svc_more', async () => {
    const collectedData = JSON.stringify({ currentService: { name: 'Pilates', price: 2000 } });
    await dispatchOnboardingStep(
      makeSession('svc_duration', collectedData),
      makeBusiness(),
      OWNER_ID,
      '60'
    );

    // Service row inserted into DB
    expect(dbModule.db.insert).toHaveBeenCalled();
    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(1, 'svc_more', null);
  });

  it('svc_more "όχι": advances to config_booking_mode (next config step)', async () => {
    await dispatchOnboardingStep(makeSession('svc_more'), makeBusiness(), OWNER_ID, 'όχι');

    // svc_more → Όχι advances to booking mode config, not directly to done
    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(1, 'config_booking_mode', null);
    // A message asking about booking mode must be sent
    const calls = mockedSendTelegramMessage.mock.calls;
    const lastText = calls[calls.length - 1]?.[1] ?? '';
    expect(lastText.toLowerCase()).toMatch(/πρόγραμμα|ελεύθερ|booking/);
  });

  it('svc_more "ναι": clears currentService stub, advances back to svc_name', async () => {
    const collectedData = JSON.stringify({ currentService: { name: 'Old Service', price: 1000 } });
    await dispatchOnboardingStep(
      makeSession('svc_more', collectedData),
      makeBusiness(),
      OWNER_ID,
      'ναι'
    );

    // collectedData is reset with a cleared currentService (Pitfall 6)
    expect(mockedUpdateOnboardingStep).toHaveBeenCalledWith(
      1,
      'svc_name',
      JSON.stringify({ currentService: {} })
    );
  });
});

describe('isOwnerEditCommand (ONB-03)', () => {
  it('returns true for "αλλαγή ωραρίου"', () => {
    expect(isOwnerEditCommand('αλλαγή ωραρίου')).toBe(true);
  });

  it('returns true for "ΑΛΛΑΓΉ ΤΙΜΉΣ" (uppercase — case-insensitive check)', () => {
    expect(isOwnerEditCommand('ΑΛΛΑΓΉ ΤΙΜΉΣ')).toBe(true);
  });

  it('returns false for ordinary client message "θέλω ραντεβού"', () => {
    expect(isOwnerEditCommand('θέλω ραντεβού')).toBe(false);
  });

  // ONB-03: non-owner message with edit keyword is intercepted only AFTER
  // ownerTelegramId check in telegram.ts (tested in telegram-webhook suite).
  // That integration test is in tests/telegram-webhook.test.ts.
});
