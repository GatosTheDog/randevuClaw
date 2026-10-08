/**
 * Conversation memory wired through the REAL aiOnboardingAgent + REAL memory
 * module (debug: bot-loses-conversation-memory). Only the DB layer is faked:
 * an in-memory Map stands in for the conversation_memory table.
 *
 * Scaffold mirrors tests/onboarding/ai-onboarding-agent.test.ts.
 */

jest.mock('@google/genai', () => {
  const mockCreate = jest.fn();
  return {
    __mockCreate: mockCreate,
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      interactions: { create: mockCreate },
    })),
  };
});

const store = new Map<string, Record<string, unknown>>();
const storeKey = (b: number, r: string, p: string) => `${b}:${r}:${p}`;

jest.mock('../../src/database/queries', () => ({
  ...jest.requireActual('../../src/database/queries'),
  listServicesForBusiness: jest.fn(),
  listBusinessHours: jest.fn(),
  getConn: jest.fn(),
  withBusinessContext: jest.fn(),
  runIsolated: jest.fn(async (fn: (conn: unknown) => Promise<unknown>) => fn({})),
  findConversationMemory: jest.fn(async (b: number, r: string, p: string) => store.get(storeKey(b, r, p)) ?? null),
  upsertConversationMemory: jest.fn(async (b: number, r: string, p: string, values: Record<string, unknown>) => {
    store.set(storeKey(b, r, p), { id: 1, businessId: b, agentRole: r, participantId: p, createdAt: new Date(), ...values });
  }),
}));
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
import * as telegramClient from '../../src/telegram/client';
import * as onboardingQueries from '../../src/onboarding/queries';
import { aiOnboardingAgent } from '../../src/onboarding/ai-onboarding-agent';
import type { Business, BusinessHours, Service } from '../../src/database/queries';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreate = (genai as any).__mockCreate as jest.Mock;
const OWNER_ID = '999999999';
const TODAY = '2026-10-08';

function makeService(): Service {
  return { id: 10, businessId: 1, name: 'Reformer Pilates', durationMin: 50, price: 3500, createdAt: new Date() };
}

const SEVEN_HOUR_ROWS_FOR_TESTS: BusinessHours[] = Array.from({ length: 7 }, (_, day) => ({
  id: day + 1,
  businessId: 1,
  dayOfWeek: day,
  openTime: '09:00',
  closeTime: '18:00',
  openTime2: null,
  closeTime2: null,
  isClosed: false,
  createdAt: new Date(),
}));

function makeBusiness(overrides: Partial<Business> = {}): Business {
  return {
    id: 1,
    name: 'New Business (onboarding)',
    slug: 'pending-abc123',
    phoneNumberId: null,
    ownerTelegramId: OWNER_ID,
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

function storedRow() {
  return store.get(storeKey(1, 'onboarding', OWNER_ID)) as Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockReset();
  store.clear();
  (dbQueries.listServicesForBusiness as jest.Mock).mockResolvedValue([]);
  (dbQueries.listBusinessHours as jest.Mock).mockResolvedValue([]);
});

describe('aiOnboardingAgent conversation memory', () => {
  it('REGRESSION: the owner\'s "ναι" to the onboarding bot\'s question continues the chain instead of restarting the setup chat', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'onb-A',
      output_text: 'Να βάλω ωράριο 09:00-21:00 για όλες τις μέρες;',
      steps: [],
      usage: { total_input_tokens: 4000, total_output_tokens: 25 },
    });
    await aiOnboardingAgent(makeBusiness(), OWNER_ID, 'Δευτέρα με Παρασκευή 9 με 9', TODAY);
    expect(mockCreate.mock.calls[0][0].previous_interaction_id).toBeUndefined();

    mockCreate.mockResolvedValueOnce({ id: 'onb-B', output_text: 'Τέλεια, συνεχίζουμε με τις υπηρεσίες.', steps: [] });
    const reply = await aiOnboardingAgent(makeBusiness(), OWNER_ID, 'ναι', TODAY);

    expect(reply).toBe('Τέλεια, συνεχίζουμε με τις υπηρεσίες.');
    const second = mockCreate.mock.calls[1][0];
    expect(second.previous_interaction_id).toBe('onb-A');
    expect(second.input).toBe('ναι');
    expect(second.system_instruction).toContain('ΜΗΝ χαιρετάς ξανά');
    expect(storedRow()).toMatchObject({ interactionId: 'onb-B', chainTurns: 2 });
  });

  it('finish_onboarding (tool replies itself): one model call, no closing call, chain dropped, exchange recorded', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'onb-call',
      steps: [{ type: 'function_call', name: 'finish_onboarding', arguments: {}, id: 'call-1' }],
    });
    (dbQueries.listServicesForBusiness as jest.Mock).mockResolvedValue([makeService()]);
    (dbQueries.listBusinessHours as jest.Mock).mockResolvedValue(SEVEN_HOUR_ROWS_FOR_TESTS);
    (dbQueries.withBusinessContext as jest.Mock).mockImplementation(async (_id: number, cb: () => Promise<unknown>) => cb());
    (dbQueries.getConn as jest.Mock).mockReturnValue({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue(undefined),
    });
    (telegramClient.registerBotWebhook as jest.Mock).mockResolvedValue(undefined);
    (telegramClient.unregisterBotWebhook as jest.Mock).mockResolvedValue(undefined);
    (onboardingQueries.activateBusiness as jest.Mock).mockResolvedValue(undefined);
    (telegramClient.sendTelegramMessage as jest.Mock).mockResolvedValue({ messageId: 1 });

    const reply = await aiOnboardingAgent(makeBusiness({ name: 'Pilates Athens' }), OWNER_ID, 'Τελείωσα', TODAY);

    expect(reply).toBe('');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(storedRow()!.interactionId).toBeNull();
    expect(JSON.parse(storedRow()!.recentExchanges)[0]).toMatchObject({ u: 'Τελείωσα' });
    expect(JSON.parse(storedRow()!.recentExchanges)[0].a).toContain('finish_onboarding');
  });

  it('a stored chain Gemini rejects (404) restarts once on a seeded fresh chain', async () => {
    store.set(storeKey(1, 'onboarding', OWNER_ID), {
      id: 1,
      businessId: 1,
      agentRole: 'onboarding',
      participantId: OWNER_ID,
      interactionId: 'expired',
      summary: null,
      contextTokens: 100,
      chainTurns: 1,
      recentExchanges: JSON.stringify([{ u: 'Pilates Athens', a: 'Ωραίο όνομα! Ποιο είναι το ωράριο;', at: '' }]),
      lastActiveAt: new Date(),
      createdAt: new Date(),
    });
    mockCreate.mockRejectedValueOnce({ status: 404 }).mockResolvedValueOnce({ id: 'onb-new', output_text: 'ok', steps: [] });

    const reply = await aiOnboardingAgent(makeBusiness(), OWNER_ID, '9 με 5', TODAY);

    expect(reply).toBe('ok');
    expect(mockCreate.mock.calls[1][0].previous_interaction_id).toBeUndefined();
    expect(mockCreate.mock.calls[1][0].input).toContain('Βοηθός: Ωραίο όνομα! Ποιο είναι το ωράριο;');
    expect(storedRow()!.interactionId).toBe('onb-new');
  });
});
