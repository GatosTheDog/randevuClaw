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

import * as genai from '@google/genai';
import * as queries from '../src/database/queries';
import * as functionExecutor from '../src/conversation/function-executor';
import { aiBookingAgent, RATE_LIMIT_REPLY_GREEK } from '../src/conversation/ai-agent';

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
});
