// Quick task 261008-h82: set_client_slots owner tool — declaration, name-based
// dispatch, no confirmation keyboard, and system-prompt rule.
//
// Mocking scaffold copied from tests/ai-owner-name-matching.test.ts.

// ---------------------------------------------------------------------------
// Module mocks (hoisted before imports by Jest)
// ---------------------------------------------------------------------------

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

jest.mock('../src/database/queries', () => ({
  listServicesForBusiness: jest.fn().mockResolvedValue([]),
  listBusinessHours: jest.fn().mockResolvedValue([]),
  withBusinessContext: jest
    .fn()
    .mockImplementation((_id: number, cb: () => Promise<unknown>) => cb()),
  getConn: jest.fn(),
  findServiceById: jest.fn(),
  listBookingsForDate: jest.fn().mockResolvedValue([]),
  setBookingMode: jest.fn(),
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
  handleViewClientMembership: jest.fn().mockResolvedValue('__MEMBERSHIP_TEXT__'),
  handleSetClientSlots: jest.fn().mockResolvedValue('__SLOTS_TEXT__'),
  handleSetEnforcementPolicy: jest.fn().mockResolvedValue(''),
  handleSetCancellationCutoff: jest.fn().mockResolvedValue(''),
  handleSetLastSessionThreshold: jest.fn().mockResolvedValue(''),
}));

jest.mock('../src/billing/queries', () => ({
  listPackages: jest.fn().mockResolvedValue([]),
  getClientActiveMembership: jest.fn(),
  getAllClientsForBusiness: jest.fn(),
}));

jest.mock('../src/session/manager', () => ({
  listSessions: jest.fn(),
  cancelSession: jest.fn(),
  cascadeCancelSessionBookings: jest.fn(),
  createSessionCatalogWithExpansion: jest.fn(),
  buildRRuleString: jest.fn(),
  bookSessionInstance: jest.fn(),
}));

jest.mock('../src/session/slotless-requests', () => ({
  listSlotlessRequestsForClient: jest.fn(),
}));

jest.mock('../src/invites/generator', () => ({
  sendBusinessInvite: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { aiOwnerAgent, OWNER_TOOLS } from '../src/onboarding/ai-owner-agent';
import * as billingQueries from '../src/billing/queries';
import * as billingTools from '../src/billing/tools';
import * as telegramClient from '../src/telegram/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreate = (require('@google/genai') as any)._mockCreate as jest.Mock;
const mockedGetAllClientsForBusiness = billingQueries.getAllClientsForBusiness as jest.MockedFunction<
  typeof billingQueries.getAllClientsForBusiness
>;
const mockedHandleSetClientSlots = billingTools.handleSetClientSlots as jest.MockedFunction<
  typeof billingTools.handleSetClientSlots
>;
const mockedSendTelegramMessageWithKeyboard =
  telegramClient.sendTelegramMessageWithKeyboard as jest.MockedFunction<
    typeof telegramClient.sendTelegramMessageWithKeyboard
  >;

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_BUSINESS = {
  id: 1,
  name: 'Test Business',
  slug: 'test',
  phoneNumberId: null,
  ownerTelegramId: 'owner-telegram-id',
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
} as const;

// A different business, used to prove T-30-01 cross-business isolation.
const OTHER_BUSINESS_ID = 999;

const OWNER_TELEGRAM_ID = 'owner-telegram-id';

/** Gemini response with no function calls (exits loop). */
const GEMINI_TEXT_RESPONSE = {
  id: 'interaction-text',
  output_text: 'OK',
  steps: [] as Array<unknown>,
};

function makeToolCall(name: string, args: Record<string, unknown>, id = 'call-1') {
  return {
    id: 'interaction-1',
    steps: [{ type: 'function_call', name, id, arguments: args }],
  };
}

/** Extracts the function-result text fed back to Gemini on the given call index. */
function extractToolResultText(callIndex: number, toolName: string): string | undefined {
  const callArgs = mockCreate.mock.calls[callIndex][0];
  const functionResults = callArgs.input as Array<{ name: string; result: Array<{ text: string }> }>;
  return functionResults.find((r) => r.name === toolName)?.result[0]?.text;
}

const SINGLE_CLIENT = {
  clientBusinessRelationshipId: 1,
  clientName: 'Γιώργος',
  senderPhone: '111111111',
};

const AMBIGUOUS_CLIENTS = [
  { clientBusinessRelationshipId: 1, clientName: 'Γιώργος', senderPhone: '111111111' },
  { clientBusinessRelationshipId: 2, clientName: 'Γιώργος Παπαδόπουλος', senderPhone: '222222222' },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue(GEMINI_TEXT_RESPONSE);
  mockedHandleSetClientSlots.mockResolvedValue('__SLOTS_TEXT__');
});

async function runOwner(message = 'Δώσε στον Γιώργο 4 παραπάνω μαθήματα') {
  return aiOwnerAgent(
    MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    OWNER_TELEGRAM_ID,
    message,
    '2026-07-29'
  );
}

describe('set_client_slots owner tool (quick-261008-h82)', () => {
  it('1. declares set_client_slots with required client_name, mode (set|add) and integer sessions', () => {
    const tool = (OWNER_TOOLS as any[]).find((t) => t.name === 'set_client_slots'); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(tool).toBeDefined();
    expect([...tool.parameters.required].sort()).toEqual(['client_name', 'mode', 'sessions']);
    expect(tool.parameters.properties.mode.enum).toEqual(['set', 'add']);
    expect(tool.parameters.properties.sessions.type).toBe('integer');
    expect(tool.parameters.properties.business_id).toBeUndefined();
    expect(tool.parameters.properties.client_phone).toBeUndefined();
  });

  it('2. single match: calls handler once inside withBusinessContext with the owner business only', async () => {
    mockedGetAllClientsForBusiness.mockResolvedValueOnce([SINGLE_CLIENT]);
    mockCreate.mockResolvedValueOnce(
      makeToolCall('set_client_slots', { client_name: 'Γιώργος', mode: 'add', sessions: 4 })
    );

    const reply = await runOwner();

    expect(reply).toBe('OK');
    expect(mockedGetAllClientsForBusiness).toHaveBeenCalledWith(MOCK_BUSINESS.id);
    expect(mockedHandleSetClientSlots).toHaveBeenCalledTimes(1);
    expect(mockedHandleSetClientSlots).toHaveBeenCalledWith(
      MOCK_BUSINESS.id,
      SINGLE_CLIENT.senderPhone,
      'Γιώργος',
      { mode: 'add', sessions: 4 }
    );
    expect(extractToolResultText(1, 'set_client_slots')).toBe('__SLOTS_TEXT__');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const withBusinessContext = require('../src/database/queries').withBusinessContext as jest.Mock;
    expect(withBusinessContext).toHaveBeenCalledWith(MOCK_BUSINESS.id, expect.any(Function));
  });

  it('3. no match: returns the generic not-found text and does not call the handler', async () => {
    mockedGetAllClientsForBusiness.mockResolvedValueOnce([]);
    mockCreate.mockResolvedValueOnce(
      makeToolCall('set_client_slots', { client_name: 'Αλέξανδρος', mode: 'set', sessions: 5 })
    );

    await runOwner();

    expect(extractToolResultText(1, 'set_client_slots')).toBe(
      'Δεν βρέθηκε πελάτης με αυτό το όνομα.'
    );
    expect(mockedHandleSetClientSlots).not.toHaveBeenCalled();
  });

  it('4. ambiguous: names-only disambiguation, no raw phone, handler not called', async () => {
    mockedGetAllClientsForBusiness.mockResolvedValueOnce(AMBIGUOUS_CLIENTS);
    mockCreate.mockResolvedValueOnce(
      makeToolCall('set_client_slots', { client_name: 'Γιώργος', mode: 'add', sessions: 4 })
    );

    await runOwner();

    const text = extractToolResultText(1, 'set_client_slots');
    expect(text).toContain('Γιώργος');
    expect(text).toContain('Γιώργος Παπαδόπουλος');
    expect(text).not.toContain('111111111');
    expect(text).not.toContain('222222222');
    expect(mockedHandleSetClientSlots).not.toHaveBeenCalled();
  });

  it('5. sends no confirmation keyboard and the loop continues to the Gemini text reply', async () => {
    mockedGetAllClientsForBusiness.mockResolvedValueOnce([SINGLE_CLIENT]);
    mockCreate.mockResolvedValueOnce(
      makeToolCall('set_client_slots', { client_name: 'Γιώργος', mode: 'set', sessions: 12 })
    );

    const reply = await runOwner();

    expect(mockedSendTelegramMessageWithKeyboard).not.toHaveBeenCalled();
    expect(reply).toBe('OK');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('6. system prompt documents set_client_slots and both modes', async () => {
    await runOwner();

    const systemInstruction = mockCreate.mock.calls[0][0].system_instruction as string;
    expect(systemInstruction).toContain('set_client_slots');
    expect(systemInstruction).toContain('mode add');
    expect(systemInstruction).toContain('mode set');
  });
});
