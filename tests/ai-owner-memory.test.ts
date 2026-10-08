// Conversation memory wired through the REAL aiOwnerAgent + REAL memory module
// (debug: bot-loses-conversation-memory). Only the DB layer is faked, by an
// in-memory Map standing in for the conversation_memory table, so these tests
// exercise the actual turn lifecycle: beginTurn -> Gemini call(s) -> finishTurn.
//
// Mocking scaffold follows tests/ai-owner-send-invite.test.ts.

jest.mock('@google/genai', () => {
  const createFn = jest.fn();
  return {
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      interactions: { create: createFn },
    })),
    _mockCreate: createFn,
  };
});

jest.mock('../src/config', () => ({
  config: { geminiApiKey: 'test-gemini-key', logLevel: 'silent' },
}));

// In-memory stand-in for the conversation_memory table.
const store = new Map<string, Record<string, unknown>>();
const storeKey = (b: number, r: string, p: string) => `${b}:${r}:${p}`;
let storeFailing = false;

jest.mock('../src/database/queries', () => ({
  listServicesForBusiness: jest.fn().mockResolvedValue([]),
  listBusinessHours: jest.fn().mockResolvedValue([]),
  withBusinessContext: jest
    .fn()
    .mockImplementation((_id: number, cb: () => Promise<unknown>) => cb()),
  runIsolated: jest.fn(async (fn: (conn: unknown) => Promise<unknown>) => {
    if (storeFailing) throw new Error('conversation_memory unavailable');
    return fn({});
  }),
  findConversationMemory: jest.fn(async (b: number, r: string, p: string) => store.get(storeKey(b, r, p)) ?? null),
  upsertConversationMemory: jest.fn(async (b: number, r: string, p: string, values: Record<string, unknown>) => {
    store.set(storeKey(b, r, p), { id: 1, businessId: b, agentRole: r, participantId: p, createdAt: new Date(), ...values });
  }),
}));

jest.mock('../src/telegram/client', () => ({
  sendTelegramMessage: jest.fn().mockResolvedValue({ messageId: 1 }),
  sendTelegramMessageWithKeyboard: jest.fn().mockResolvedValue({ messageId: 1 }),
}));

jest.mock('../src/telegram/handlers/payment-flow', () => ({
  showClientSelection: jest.fn().mockResolvedValue(undefined),
  showPackageSelection: jest.fn().mockResolvedValue(undefined),
  showMembershipConfirmation: jest.fn().mockResolvedValue(undefined),
  handleConfirmMembership: jest.fn().mockResolvedValue(undefined),
  handleCancelPackage: jest.fn().mockResolvedValue(undefined),
  handleConfirmPackage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/billing/tools', () => ({
  handleCreatePackage: jest.fn(),
  handleListPackages: jest.fn().mockResolvedValue(''),
  handleDeactivatePackage: jest.fn().mockResolvedValue(''),
  handleViewClientMembership: jest.fn().mockResolvedValue(''),
  handleSetEnforcementPolicy: jest.fn().mockResolvedValue(''),
  handleSetCancellationCutoff: jest.fn().mockResolvedValue(''),
  handleSetLastSessionThreshold: jest.fn().mockResolvedValue(''),
}));

jest.mock('../src/session/manager', () => ({
  listSessions: jest.fn(),
  cancelSession: jest.fn(),
  cascadeCancelSessionBookings: jest.fn(),
  createSessionCatalogWithExpansion: jest.fn(),
  buildRRuleString: jest.fn(),
  bookSessionInstance: jest.fn(),
}));

jest.mock('../src/invites/generator', () => ({
  sendBusinessInvite: jest.fn(),
}));

import { aiOwnerAgent } from '../src/onboarding/ai-owner-agent';
import { CONTEXT_TOKEN_BUDGET, TOOL_REPLY_ALREADY_SENT_RESULT } from '../src/conversation/memory';
import * as generator from '../src/invites/generator';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreate = (require('@google/genai') as any)._mockCreate as jest.Mock;
const mockSendBusinessInvite = generator.sendBusinessInvite as jest.Mock;

const OWNER_ID = 'owner-telegram-id';
const MOCK_BUSINESS = {
  id: 1,
  name: 'Test Business',
  slug: 'test',
  phoneNumberId: null,
  ownerTelegramId: OWNER_ID,
  googleRefreshToken: null,
  agendaSentDate: null,
  botToken: 'test-bot-token',
  webhookId: null,
  webhookSecret: null,
  enforcementPolicy: 'allow',
  bookingMode: 'fixed_sessions',
  allowMultiBooking: false,
  cancellationCutoffEnabled: false,
  cancellationCutoffHours: 24,
  slotlessRequestsEnabled: false,
  lastSessionThresholdEnabled: false,
  lastSessionThresholdCount: 1,
  onboardingCompleted: true,
  createdAt: new Date(),
};

function ask(text: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return aiOwnerAgent(MOCK_BUSINESS as any, OWNER_ID, text, '2026-10-08');
}

function textResponse(id: string, text: string, usage?: { in: number; out: number }) {
  return {
    id,
    output_text: text,
    steps: [],
    ...(usage ? { usage: { total_input_tokens: usage.in, total_output_tokens: usage.out } } : {}),
  };
}

function storedRow() {
  return store.get(storeKey(1, 'owner', OWNER_ID)) as Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockReset();
  store.clear();
  storeFailing = false;
});

describe('aiOwnerAgent conversation memory', () => {
  it('REGRESSION: a bare "ναι" after the bot\'s suggestion continues the same Gemini chain instead of starting from scratch', async () => {
    mockCreate.mockResolvedValueOnce(textResponse('int-A', 'Να κλείσω τη Δευτέρα για αργία;', { in: 5000, out: 30 }));
    const first = await ask('κλείσε τη Δευτέρα');
    expect(first).toBe('Να κλείσω τη Δευτέρα για αργία;');
    // Turn 1 had no history to continue.
    expect(mockCreate.mock.calls[0][0].previous_interaction_id).toBeUndefined();

    mockCreate.mockResolvedValueOnce(textResponse('int-B', 'Έγινε, η Δευτέρα είναι κλειστή.', { in: 5100, out: 20 }));
    const second = await ask('ναι');

    expect(second).toBe('Έγινε, η Δευτέρα είναι κλειστή.');
    const secondParams = mockCreate.mock.calls[1][0];
    expect(secondParams.previous_interaction_id).toBe('int-A');
    expect(secondParams.input).toBe('ναι'); // plain message, no re-seeding needed
    expect(secondParams.system_instruction).toContain('ΜΗΝ χαιρετάς ξανά');

    expect(storedRow()).toMatchObject({ interactionId: 'int-B', chainTurns: 2, contextTokens: 5120 });
  });

  it('a tool that replies by itself (keyboard) closes the dangling function_call so the NEXT message can continue the chain', async () => {
    mockSendBusinessInvite.mockResolvedValue(undefined); // send_invite -> '' (tool sent its own message)
    mockCreate
      .mockResolvedValueOnce({
        id: 'int-call',
        steps: [{ type: 'function_call', name: 'send_invite', id: 'call-1', arguments: {} }],
      })
      // the throw-away closing call
      .mockResolvedValueOnce({ id: 'int-closed', steps: [], output_text: 'ok', usage: { total_input_tokens: 6000, total_output_tokens: 5 } });

    const reply = await ask('στείλε invite');

    expect(reply).toBe(''); // caller must not send an extra message
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const closing = mockCreate.mock.calls[1][0];
    expect(closing.previous_interaction_id).toBe('int-call');
    expect(closing.input).toEqual([
      { type: 'function_result', name: 'send_invite', call_id: 'call-1', result: [{ type: 'text', text: TOOL_REPLY_ALREADY_SENT_RESULT }] },
    ]);
    expect(storedRow()).toMatchObject({ interactionId: 'int-closed', contextTokens: 6005 });
    expect(JSON.parse(storedRow()!.recentExchanges)[0].a).toContain('send_invite');

    // Next message continues from the CLOSED interaction (well-formed chain).
    mockCreate.mockResolvedValueOnce(textResponse('int-next', 'τέλεια'));
    await ask('ευχαριστώ');
    expect(mockCreate.mock.calls[2][0].previous_interaction_id).toBe('int-closed');
  });

  it('skipped sibling calls after a self-replying tool still receive a result (chain stays well-formed)', async () => {
    mockSendBusinessInvite.mockResolvedValue(undefined);
    mockCreate
      .mockResolvedValueOnce({
        id: 'int-call',
        steps: [
          { type: 'function_call', name: 'send_invite', id: 'call-1', arguments: {} },
          { type: 'function_call', name: 'list_packages', id: 'call-2', arguments: {} },
        ],
      })
      .mockResolvedValueOnce({ id: 'int-closed', steps: [], output_text: 'ok' });

    await ask('invite και πακέτα');

    const closingInput = mockCreate.mock.calls[1][0].input as Array<{ call_id: string; result: Array<{ text: string }> }>;
    expect(closingInput.map((r) => r.call_id)).toEqual(['call-1', 'call-2']);
    expect(closingInput[1].result[0].text).toContain('Δεν εκτελέστηκε');
  });

  it('if closing the chain fails, the chain is dropped so the next turn restarts SEEDED with the transcript (not on a malformed chain)', async () => {
    mockSendBusinessInvite.mockResolvedValue(undefined);
    mockCreate
      .mockResolvedValueOnce({
        id: 'int-call',
        steps: [{ type: 'function_call', name: 'send_invite', id: 'call-1', arguments: {} }],
      })
      .mockRejectedValueOnce(new Error('timeout'));

    await ask('στείλε invite');
    expect(storedRow()!.interactionId).toBeNull();

    mockCreate.mockResolvedValueOnce(textResponse('int-fresh', 'ωραία'));
    await ask('ναι');
    const params = mockCreate.mock.calls[2][0];
    expect(params.previous_interaction_id).toBeUndefined();
    expect(params.input).toContain('Χρήστης: στείλε invite');
    expect(params.input).toContain('send_invite');
    expect(params.input).toContain('[Νέο μήνυμα χρήστη]\nναι');
  });

  it('CONTEXT WINDOW: once the prompt exceeds the owner budget the next turn starts a new chain with summary + last exchanges', async () => {
    // Seed the store: 8 stored exchanges and a prompt just over budget.
    const stored = Array.from({ length: 8 }, (_, i) => ({ u: `ερώτηση ${i + 1}`, a: `απάντηση ${i + 1}`, at: new Date().toISOString() }));
    store.set(storeKey(1, 'owner', OWNER_ID), {
      id: 1,
      businessId: 1,
      agentRole: 'owner',
      participantId: OWNER_ID,
      interactionId: 'old-chain',
      summary: 'Παλιά σύνοψη.',
      contextTokens: CONTEXT_TOKEN_BUDGET.owner + 1,
      chainTurns: 8,
      recentExchanges: JSON.stringify(stored),
      lastActiveAt: new Date(),
      createdAt: new Date(),
    });

    mockCreate
      .mockResolvedValueOnce({ id: 'sum', output_text: 'Νέα σύνοψη: ρυθμίσεις ωραρίου.' }) // summarizer call
      .mockResolvedValueOnce(textResponse('new-chain', 'εντάξει', { in: 3000, out: 10 })); // the real turn

    await ask('ναι');

    // Summarizer: unstored, tool-less, folds the 4 oldest exchanges + previous summary.
    const summarizerParams = mockCreate.mock.calls[0][0];
    expect(summarizerParams.store).toBe(false);
    expect(summarizerParams.tools).toBeUndefined();
    expect(summarizerParams.input).toContain('Παλιά σύνοψη.');
    expect(summarizerParams.input).toContain('Χρήστης: ερώτηση 1');
    expect(summarizerParams.input).toContain('Χρήστης: ερώτηση 4');
    expect(summarizerParams.input).not.toContain('Χρήστης: ερώτηση 5');

    // Real turn: NEW chain, seeded with summary + last 4 exchanges + the message.
    const turnParams = mockCreate.mock.calls[1][0];
    expect(turnParams.previous_interaction_id).toBeUndefined();
    expect(turnParams.input).toContain('Νέα σύνοψη: ρυθμίσεις ωραρίου.');
    expect(turnParams.input).toContain('Χρήστης: ερώτηση 5');
    expect(turnParams.input).toContain('Βοηθός: απάντηση 8');
    expect(turnParams.input).not.toContain('Χρήστης: ερώτηση 4');
    expect(turnParams.input).toContain('[Νέο μήνυμα χρήστη]\nναι');

    expect(storedRow()).toMatchObject({ interactionId: 'new-chain', chainTurns: 1, summary: 'Νέα σύνοψη: ρυθμίσεις ωραρίου.' });
    expect(JSON.parse(storedRow()!.recentExchanges)).toHaveLength(5); // 4 carried + this turn
  });

  it('a stored chain Gemini no longer accepts (404) is retired and the same message is retried on a seeded fresh chain', async () => {
    store.set(storeKey(1, 'owner', OWNER_ID), {
      id: 1,
      businessId: 1,
      agentRole: 'owner',
      participantId: OWNER_ID,
      interactionId: 'expired-chain',
      summary: null,
      contextTokens: 1000,
      chainTurns: 1,
      recentExchanges: JSON.stringify([{ u: 'βάλε Pilates', a: 'Να το προσθέσω;', at: '' }]),
      lastActiveAt: new Date(),
      createdAt: new Date(),
    });
    mockCreate
      .mockRejectedValueOnce({ status: 404 })
      .mockResolvedValueOnce(textResponse('recovered', 'Προστέθηκε.'));

    const reply = await ask('ναι');

    expect(reply).toBe('Προστέθηκε.');
    expect(mockCreate.mock.calls[0][0].previous_interaction_id).toBe('expired-chain');
    const retry = mockCreate.mock.calls[1][0];
    expect(retry.previous_interaction_id).toBeUndefined();
    expect(retry.input).toContain('Βοηθός: Να το προσθέσω;');
    expect(retry.input).toContain('[Νέο μήνυμα χρήστη]\nναι');
    expect(storedRow()!.interactionId).toBe('recovered');
  });

  it('BEST-EFFORT: when the memory store is down the agent behaves exactly like before (stateless, single call, no closing call)', async () => {
    storeFailing = true;
    mockSendBusinessInvite.mockResolvedValue(undefined);
    mockCreate.mockResolvedValueOnce({
      id: 'int-call',
      steps: [{ type: 'function_call', name: 'send_invite', id: 'call-1', arguments: {} }],
    });

    const reply = await ask('στείλε invite');

    expect(reply).toBe('');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0].previous_interaction_id).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('isolates owner memory from the same Telegram id acting as a client (role is part of the key)', async () => {
    store.set(storeKey(1, 'client', OWNER_ID), {
      id: 9,
      businessId: 1,
      agentRole: 'client',
      participantId: OWNER_ID,
      interactionId: 'client-chain',
      summary: null,
      contextTokens: 10,
      chainTurns: 1,
      recentExchanges: '[]',
      lastActiveAt: new Date(),
      createdAt: new Date(),
    });
    mockCreate.mockResolvedValueOnce(textResponse('owner-first', 'γεια'));

    await ask('γεια');

    expect(mockCreate.mock.calls[0][0].previous_interaction_id).toBeUndefined();
    expect((store.get(storeKey(1, 'client', OWNER_ID)) as Record<string, unknown>).interactionId).toBe('client-chain');
  });
});
