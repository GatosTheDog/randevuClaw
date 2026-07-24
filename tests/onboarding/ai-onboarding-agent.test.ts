/**
 * tests/onboarding/ai-onboarding-agent.test.ts
 *
 * Unit tests for src/onboarding/ai-onboarding-agent.ts (Phase 21, D-01/D-02/D-03).
 *
 * Task 1 covers ONBOARDING_TOOLS shape and buildOnboardingSystemPrompt
 * (DB-state-derived completeness detection). Task 2 extends this file with
 * executeOnboardingTool and aiOnboardingAgent Gemini-loop tests.
 */

import { ONBOARDING_TOOLS, buildOnboardingSystemPrompt } from '../../src/onboarding/ai-onboarding-agent';
import type { Business, Service, BusinessHours } from '../../src/database/queries';

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
