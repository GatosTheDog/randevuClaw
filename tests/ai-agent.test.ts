// The real @google/genai class is auto-mocked, but `ai.interactions` is a
// getter (not a plain prototype method), so a plain `jest.mock('@google/genai')`
// automock would leave `.interactions` undefined. Instead, provide a manual
// factory whose `GoogleGenAI` constructor always returns an object exposing
// `interactions.create` as a jest.fn() we can grab a reference to from the
// module's exports (`__mockCreate`), since `ai-agent.ts` constructs its
// `GoogleGenAI` instance once at module load time.
jest.mock('@google/genai', () => {
  const mockCreate = jest.fn();
  return {
    __mockCreate: mockCreate,
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      interactions: { create: mockCreate },
    })),
  };
});

jest.mock('../src/conversation/function-executor');
jest.mock('../src/database/queries', () => ({
  ...jest.requireActual('../src/database/queries'),
  listServicesForBusiness: jest.fn(),
  listBusinessHours: jest.fn(),
}));
// Unified conversation memory: the pure helpers stay real, the three entry
// points that would touch the DB are stubbed so these unit tests never open a
// pg connection (pg-pool's connect timer would also pollute the setTimeout spy
// in Test 6). Real persistence is covered by tests/conversation-memory*.test.ts.
jest.mock('../src/conversation/memory', () => ({
  ...jest.requireActual('../src/conversation/memory'),
  beginTurn: jest.fn(),
  finishTurn: jest.fn(),
  restartChain: jest.fn(),
}));
// Spread of jest.requireActual keeps the real botTokenStore so .run() actually
// invokes its callback — a plain automock would make .run() a no-op (Phase
// 04-05 "explicit call-through mock" lesson, STATE.md).
jest.mock('../src/telegram/client', () => ({
  ...jest.requireActual('../src/telegram/client'),
  sendTelegramMessage: jest.fn(),
}));

import * as genai from '@google/genai';
import * as queries from '../src/database/queries';
import * as functionExecutor from '../src/conversation/function-executor';
import { sendTelegramMessage } from '../src/telegram/client';
import * as memory from '../src/conversation/memory';
import { aiBookingAgent, RATE_LIMIT_REPLY_GREEK, AGENT_ERROR_REPLY_GREEK } from '../src/conversation/ai-agent';

const mockedBeginTurn = memory.beginTurn as jest.MockedFunction<typeof memory.beginTurn>;
const mockedFinishTurn = memory.finishTurn as jest.MockedFunction<typeof memory.finishTurn>;
const mockedRestartChain = memory.restartChain as jest.MockedFunction<typeof memory.restartChain>;

/** A memory turn as beginTurn would return it. `disabled` mimics an unreachable store. */
function memoryTurn(overrides: Partial<memory.TurnMemory> = {}): memory.TurnMemory {
  return {
    key: { businessId: 1, role: 'client', participantId: 'c1' },
    enabled: true,
    state: memory.emptyState(),
    previousInteractionId: undefined,
    seed: null,
    startedFreshChain: false,
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreate = (genai as any).__mockCreate as jest.Mock;
const mockedListServicesForBusiness = queries.listServicesForBusiness as jest.MockedFunction<
  typeof queries.listServicesForBusiness
>;
const mockedListBusinessHours = queries.listBusinessHours as jest.MockedFunction<
  typeof queries.listBusinessHours
>;
const mockedExecuteTool = functionExecutor.executeTool as jest.MockedFunction<
  typeof functionExecutor.executeTool
>;
const mockedSendTelegramMessage = sendTelegramMessage as jest.MockedFunction<typeof sendTelegramMessage>;

const BUSINESS = {
  id: 1,
  name: 'Pilates Athens',
  slug: 'pilates-athens',
  phoneNumberId: null,
  ownerTelegramId: '999999999',
  googleRefreshToken: null,
  agendaSentDate: null,
  botToken: null,
  webhookId: null,
  webhookSecret: null,
  enforcementPolicy: 'allow',
  bookingMode: 'open_slots',
  allowMultiBooking: false,
  cancellationCutoffEnabled: false,
  cancellationCutoffHours: 0,
  slotlessRequestsEnabled: false,
  lastSessionThresholdEnabled: false,
  lastSessionThresholdCount: 0,
  onboardingCompleted: true,
  createdAt: new Date(),
};

const SERVICES = [
  {
    id: 2,
    businessId: 1,
    name: 'Reformer Pilates',
    durationMin: 50,
    price: 3500,
    createdAt: new Date(),
  },
];

const HOURS = [
  { id: 1, businessId: 1, dayOfWeek: 1, openTime: '09:00', closeTime: '20:00', openTime2: null, closeTime2: null, isClosed: false, createdAt: new Date() },
];

describe('aiBookingAgent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedListServicesForBusiness.mockResolvedValue(SERVICES);
    mockedListBusinessHours.mockResolvedValue(HOURS);
    mockedSendTelegramMessage.mockResolvedValue({ messageId: 1 });
    // Default: memory store unreachable -> agent behaves statelessly except for
    // the legacy conversation_turns chain id (exactly the pre-memory behaviour).
    mockedBeginTurn.mockImplementation(async (_key, opts) =>
      memoryTurn({ enabled: false, previousInteractionId: opts?.legacyInteractionId ?? undefined })
    );
    mockedFinishTurn.mockResolvedValue(undefined);
    mockedRestartChain.mockImplementation(async (turn) => ({
      ...turn,
      previousInteractionId: undefined,
      seed: null,
      startedFreshChain: true,
    }));
  });

  it('Test 1: no function calls -> returns text/interactionId directly, executeTool never called', async () => {
    mockCreate.mockResolvedValueOnce({ id: 'int1', steps: [], output_text: 'Γεια σας!' });

    const result = await aiBookingAgent('γεια', BUSINESS, 'c1', null);

    expect(result.text).toBe('Γεια σας!');
    expect(result.interactionId).toBe('int1');
    expect(typeof result.requestId).toBe('string');
    expect(result.requestId.length).toBeGreaterThan(0);
    expect(result.toolCalls).toEqual([]);
    expect(mockedExecuteTool).not.toHaveBeenCalled();
  });

  it('Test 2: one function_call round then final text -> second call includes previous_interaction_id, toolCalls recorded', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'int1',
      steps: [
        {
          type: 'function_call',
          name: 'check_availability',
          arguments: { business_id: 1, service_id: 2, calendar_date: '2026-07-10' },
          id: 'call1',
        },
      ],
    });
    mockedExecuteTool.mockResolvedValueOnce({ availableSlots: ['09:00'], closed: false });
    mockCreate.mockResolvedValueOnce({ id: 'int2', steps: [], output_text: 'Έχουμε 09:00 ελεύθερο.' });

    const result = await aiBookingAgent('θέλω pilates', BUSINESS, 'c1', null);

    expect(result.interactionId).toBe('int2');
    expect(result.toolCalls).toEqual([
      { name: 'check_availability', args: { business_id: 1, service_id: 2, calendar_date: '2026-07-10' } },
    ]);
    const secondCallParams = mockCreate.mock.calls[1][0];
    expect(secondCallParams.previous_interaction_id).toBe('int1');
  });

  it('Test 3: two function_call steps in one batch execute sequentially, never concurrently', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'int1',
      steps: [
        { type: 'function_call', name: 'check_availability', arguments: { business_id: 1 }, id: 'call1' },
        { type: 'function_call', name: 'check_availability', arguments: { business_id: 1 }, id: 'call2' },
      ],
    });
    mockCreate.mockResolvedValueOnce({ id: 'int2', steps: [], output_text: 'ok' });

    const timings: Array<{ start: number; end: number }> = [];
    mockedExecuteTool.mockImplementation(async () => {
      const start = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 20));
      timings.push({ start, end: Date.now() });
      return {};
    });

    await aiBookingAgent('θέλω pilates', BUSINESS, 'c1', null);

    expect(timings).toHaveLength(2);
    expect(timings[1].start).toBeGreaterThanOrEqual(timings[0].end);
  });

  it('Test 4: the same requestId is passed to executeTool for every call within one invocation', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'int1',
      steps: [
        { type: 'function_call', name: 'check_availability', arguments: { business_id: 1 }, id: 'call1' },
      ],
    });
    mockedExecuteTool.mockResolvedValueOnce({});
    mockCreate.mockResolvedValueOnce({
      id: 'int2',
      steps: [
        { type: 'function_call', name: 'book_appointment', arguments: { business_id: 1 }, id: 'call2' },
      ],
    });
    mockedExecuteTool.mockResolvedValueOnce({});
    mockCreate.mockResolvedValueOnce({ id: 'int3', steps: [], output_text: 'ok' });

    await aiBookingAgent('θέλω pilates', BUSINESS, 'c1', null);

    const requestIds = mockedExecuteTool.mock.calls.map((call) => call[2].requestId);
    expect(requestIds).toHaveLength(2);
    expect(requestIds[0]).toBe(requestIds[1]);
  });

  it('Test 5: previous_interaction_id is set from the passed-in id, or omitted (never literal "null")', async () => {
    mockCreate.mockResolvedValueOnce({ id: 'int1', steps: [], output_text: 'ok' });
    await aiBookingAgent('γεια', BUSINESS, 'c1', 'priorInt123');
    expect(mockCreate.mock.calls[0][0].previous_interaction_id).toBe('priorInt123');

    jest.clearAllMocks();
    mockedListServicesForBusiness.mockResolvedValue(SERVICES);
    mockedListBusinessHours.mockResolvedValue(HOURS);
    mockCreate.mockResolvedValueOnce({ id: 'int2', steps: [], output_text: 'ok' });
    await aiBookingAgent('γεια', BUSINESS, 'c1', null);
    const field = mockCreate.mock.calls[0][0].previous_interaction_id;
    expect(field === undefined || field !== 'null').toBe(true);
    expect(field).toBeUndefined();
  });

  it('Test 6: retries twice on 429 then succeeds on the 3rd attempt with strictly increasing backoff delays', async () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    mockCreate
      .mockRejectedValueOnce({ status: 429 })
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce({ id: 'int3', steps: [], output_text: 'ok' });

    const resultPromise = aiBookingAgent('γεια', BUSINESS, 'c1', null);
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.interactionId).toBe('int3');
    expect(mockCreate).toHaveBeenCalledTimes(3);

    const delays = setTimeoutSpy.mock.calls
      .map(([, ms]) => ms as number)
      .filter((ms): ms is number => typeof ms === 'number');
    expect(delays.length).toBeGreaterThanOrEqual(2);
    expect(delays[1]).toBeGreaterThan(delays[0]);

    setTimeoutSpy.mockRestore();
    jest.useRealTimers();
  });

  it('Test 7: 429 on every attempt (4 total) -> resolves with RATE_LIMIT_REPLY_GREEK, never throws', async () => {
    jest.useFakeTimers();

    mockCreate.mockRejectedValue({ status: 429 });

    const resultPromise = aiBookingAgent('γεια', BUSINESS, 'c1', null);
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(mockCreate).toHaveBeenCalledTimes(4);
    expect(result.text).toBe(RATE_LIMIT_REPLY_GREEK);
    expect(result.interactionId).toBeNull();

    jest.useRealTimers();
  });

  it('Test 12 (debug: webhook-hang-no-reply): a non-429 error (e.g. TimeoutError from the bounded per-call timeout) resolves with AGENT_ERROR_REPLY_GREEK instead of throwing', async () => {
    const timeoutErr = new Error('The operation was aborted due to timeout');
    timeoutErr.name = 'TimeoutError';
    mockCreate.mockRejectedValue(timeoutErr);

    const result = await aiBookingAgent('γεια', BUSINESS, 'c1', null);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.text).toBe(AGENT_ERROR_REPLY_GREEK);
    expect(result.interactionId).toBeNull();
  });

  it('DIAG-01: generic/unrecoverable failure sends exactly one owner diagnostic containing requestId + error type, client text unchanged', async () => {
    const businessWithBot = { ...BUSINESS, botToken: 'bot-token-xyz' };
    const timeoutErr = new Error('The operation was aborted due to timeout');
    timeoutErr.name = 'TimeoutError';
    mockCreate.mockRejectedValue(timeoutErr);

    const result = await aiBookingAgent('γεια', businessWithBot, 'c1', null);

    expect(result.text).toBe(AGENT_ERROR_REPLY_GREEK);
    expect(mockedSendTelegramMessage).toHaveBeenCalledTimes(1);
    const [ownerChatId, diagnosticText] = mockedSendTelegramMessage.mock.calls[0];
    expect(ownerChatId).toBe(businessWithBot.ownerTelegramId);
    expect(diagnosticText).toContain(result.requestId);
    expect(diagnosticText).toContain('TimeoutError');
  });

  it('DIAG-01: a rejecting owner-notification sendTelegramMessage never changes the resolved result', async () => {
    const businessWithBot = { ...BUSINESS, botToken: 'bot-token-xyz' };
    const timeoutErr = new Error('The operation was aborted due to timeout');
    timeoutErr.name = 'TimeoutError';
    mockCreate.mockRejectedValue(timeoutErr);
    mockedSendTelegramMessage.mockRejectedValueOnce(new Error('Telegram API down'));

    const result = await aiBookingAgent('γεια', businessWithBot, 'c1', null);

    expect(result.text).toBe(AGENT_ERROR_REPLY_GREEK);
    expect(result.interactionId).toBeNull();
  });

  it('DIAG-01: the rate-limit (429-exhausted) branch never calls sendTelegramMessage for an owner diagnostic', async () => {
    jest.useFakeTimers();
    const businessWithBot = { ...BUSINESS, botToken: 'bot-token-xyz' };
    mockCreate.mockRejectedValue({ status: 429 });

    const resultPromise = aiBookingAgent('γεια', businessWithBot, 'c1', null);
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.text).toBe(RATE_LIMIT_REPLY_GREEK);
    expect(mockedSendTelegramMessage).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('Test 10 (CR-01): a Gemini mock that never stops returning function_call steps still returns within MAX_TOOL_ROUNDS calls, with the graceful bail-out text', async () => {
    const MAX_TOOL_ROUNDS = 6;
    let callCount = 0;
    mockCreate.mockImplementation(async () => {
      callCount += 1;
      return {
        id: `int${callCount}`,
        steps: [
          { type: 'function_call', name: 'check_availability', arguments: { business_id: 1 }, id: `call${callCount}` },
        ],
      };
    });
    mockedExecuteTool.mockResolvedValue({});

    const result = await aiBookingAgent('θέλω pilates', BUSINESS, 'c1', null);

    expect(mockCreate).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
    expect(result.text).toBe('Συγγνώμη, κάτι πήγε στραβά. Δοκιμάστε ξανά.');
  });

  it('Test 11 (CR-02): two function_call steps in the same round get distinct idempotencyKey values derived from their own call.id, while requestId stays constant', async () => {
    mockCreate.mockResolvedValueOnce({
      id: 'int1',
      steps: [
        { type: 'function_call', name: 'book_appointment', arguments: { business_id: 1 }, id: 'call1' },
        { type: 'function_call', name: 'book_appointment', arguments: { business_id: 1 }, id: 'call2' },
      ],
    });
    mockedExecuteTool.mockResolvedValue({});
    mockCreate.mockResolvedValueOnce({ id: 'int2', steps: [], output_text: 'ok' });

    await aiBookingAgent('θέλω δύο ραντεβού', BUSINESS, 'c1', null);

    expect(mockedExecuteTool).toHaveBeenCalledTimes(2);
    const contexts = mockedExecuteTool.mock.calls.map((call) => call[2]);
    expect(contexts[0].requestId).toBe(contexts[1].requestId);
    expect(contexts[0].idempotencyKey).not.toBe(contexts[1].idempotencyKey);
    expect(contexts[0].idempotencyKey).toBe(`${contexts[0].requestId}:call1`);
    expect(contexts[1].idempotencyKey).toBe(`${contexts[1].requestId}:call2`);
  });

  it('Test 8: system prompt is grounded in the business name and at least one real service name', async () => {
    mockCreate.mockResolvedValueOnce({ id: 'int1', steps: [], output_text: 'ok' });

    await aiBookingAgent('γεια', BUSINESS, 'c1', null);

    const systemInstruction = mockCreate.mock.calls[0][0].system_instruction as string;
    expect(systemInstruction).toContain(BUSINESS.name);
    expect(systemInstruction).toContain(SERVICES[0].name);
  });

  it('Test 9: system prompt hard-codes the D-07 "never say confirmed" rule as a literal instruction', async () => {
    mockCreate.mockResolvedValueOnce({ id: 'int1', steps: [], output_text: 'ok' });

    await aiBookingAgent('γεια', BUSINESS, 'c1', null);

    const systemInstruction = mockCreate.mock.calls[0][0].system_instruction as string;
    expect(systemInstruction).toContain('αναμονή έγκρισης');

    const lines = systemInstruction.split('\n');
    const confirmationLines = lines.filter((line) => line.toLowerCase().includes('επιβεβαιώθηκε'));
    expect(confirmationLines.length).toBeGreaterThan(0);
    for (const line of confirmationLines) {
      expect(line.toLowerCase()).toContain('μην');
    }
  });

  describe('unified conversation memory (debug: bot-loses-conversation-memory)', () => {
    it('M1: a bare "ναι" continues the stored chain (previous_interaction_id from memory, not the legacy id)', async () => {
      mockedBeginTurn.mockResolvedValueOnce(memoryTurn({ previousInteractionId: 'memChain' }));
      mockCreate.mockResolvedValueOnce({ id: 'int2', steps: [], output_text: 'Κλείστηκε!' });

      await aiBookingAgent('ναι', BUSINESS, 'c1', 'legacyChain');

      expect(mockedBeginTurn).toHaveBeenCalledWith(
        { businessId: 1, role: 'client', participantId: 'c1' },
        { legacyInteractionId: 'legacyChain' }
      );
      const params = mockCreate.mock.calls[0][0];
      expect(params.previous_interaction_id).toBe('memChain');
      expect(params.input).toBe('ναι'); // no seed on a continued chain
    });

    it('M2: a fresh chain (budget rollover / expiry) sends the seed in front of the new message', async () => {
      mockedBeginTurn.mockResolvedValueOnce(
        memoryTurn({ seed: '[ΠΛΑΙΣΙΟ]\nΒοηθός: Θέλεις Τρίτη 18:00;\n[ΤΕΛΟΣ ΠΛΑΙΣΙΟΥ]', startedFreshChain: true })
      );
      mockCreate.mockResolvedValueOnce({ id: 'int9', steps: [], output_text: 'ok' });

      await aiBookingAgent('ναι', BUSINESS, 'c1', null);

      const params = mockCreate.mock.calls[0][0];
      expect(params.previous_interaction_id).toBeUndefined();
      expect(params.input).toContain('Θέλεις Τρίτη 18:00;');
      expect(params.input).toContain('[Νέο μήνυμα χρήστη]\nναι');
    });

    it('M3: records the finished turn (chain head, reply text, prompt tokens) after the final answer', async () => {
      mockedBeginTurn.mockResolvedValueOnce(memoryTurn({ previousInteractionId: 'memChain' }));
      mockCreate.mockResolvedValueOnce({
        id: 'int2',
        steps: [],
        output_text: 'Έγινε!',
        usage: { total_input_tokens: 3000, total_output_tokens: 40 },
      });

      await aiBookingAgent('ναι', BUSINESS, 'c1', null);

      expect(mockedFinishTurn).toHaveBeenCalledTimes(1);
      expect(mockedFinishTurn.mock.calls[0][1]).toEqual({
        userText: 'ναι',
        botText: 'Έγινε!',
        interactionId: 'int2',
        contextTokens: 3040,
      });
    });

    it('M4: a rejected stored chain (404 expired / 400 dangling) restarts ONCE on a seeded fresh chain', async () => {
      for (const status of [404, 400]) {
        jest.clearAllMocks();
        mockedListServicesForBusiness.mockResolvedValue(SERVICES);
        mockedListBusinessHours.mockResolvedValue(HOURS);
        mockedFinishTurn.mockResolvedValue(undefined);
        const initial = memoryTurn({ previousInteractionId: 'deadChain' });
        const restarted = memoryTurn({ previousInteractionId: undefined, seed: 'SEED', startedFreshChain: true });
        mockedBeginTurn.mockResolvedValueOnce(initial);
        mockedRestartChain.mockResolvedValueOnce(restarted);
        mockCreate
          .mockRejectedValueOnce({ status })
          .mockResolvedValueOnce({ id: 'int2', steps: [], output_text: 'ok' });

        const result = await aiBookingAgent('ναι', BUSINESS, 'c1', null);

        expect(mockedRestartChain).toHaveBeenCalledWith(initial);
        expect(mockCreate).toHaveBeenCalledTimes(2);
        expect(mockCreate.mock.calls[0][0].previous_interaction_id).toBe('deadChain');
        expect(mockCreate.mock.calls[1][0].previous_interaction_id).toBeUndefined();
        expect(mockCreate.mock.calls[1][0].input).toBe('SEED\n\n[Νέο μήνυμα χρήστη]\nναι');
        expect(result.text).toBe('ok');
        expect(result.interactionId).toBe('int2');
      }
    });

    it('M5: a turn that executed tools but aborts (MAX_TOOL_ROUNDS) is recorded with interactionId null so the next turn re-seeds instead of continuing a dangling chain', async () => {
      mockedBeginTurn.mockResolvedValueOnce(memoryTurn({ previousInteractionId: 'memChain' }));
      mockCreate.mockResolvedValue({
        id: 'intLoop',
        steps: [{ type: 'function_call', name: 'check_availability', arguments: {}, id: 'cX' }],
      });
      mockedExecuteTool.mockResolvedValue({});

      const result = await aiBookingAgent('θέλω ραντεβού', BUSINESS, 'c1', null);

      expect(result.text).toBe('Συγγνώμη, κάτι πήγε στραβά. Δοκιμάστε ξανά.');
      expect(mockedFinishTurn).toHaveBeenCalledTimes(1);
      const outcome = mockedFinishTurn.mock.calls[0][1];
      expect(outcome.interactionId).toBeNull();
      expect(outcome.botText).toContain('check_availability');
    });

    it('M6: a failure on round 1 (no tool executed, chain untouched) records nothing', async () => {
      mockedBeginTurn.mockResolvedValueOnce(memoryTurn({ previousInteractionId: 'memChain' }));
      const timeoutErr = new Error('timeout');
      timeoutErr.name = 'TimeoutError';
      mockCreate.mockRejectedValue(timeoutErr);

      const result = await aiBookingAgent('ναι', BUSINESS, 'c1', null);

      expect(result.text).toBe(AGENT_ERROR_REPLY_GREEK);
      expect(mockedFinishTurn).not.toHaveBeenCalled();
    });

    it('M7: the system prompt tells the model to continue from its own last message instead of re-greeting', async () => {
      mockCreate.mockResolvedValueOnce({ id: 'int1', steps: [], output_text: 'ok' });

      await aiBookingAgent('ναι', BUSINESS, 'c1', null);

      const systemInstruction = mockCreate.mock.calls[0][0].system_instruction as string;
      expect(systemInstruction).toContain('ΜΗΝ χαιρετάς ξανά');
    });
  });
});
