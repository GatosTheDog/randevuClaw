// covers INVITE-01
// Unit tests for the send_invite tool case wiring in ai-owner-agent.ts —
// Phase 25 Plan 01 Task 3. Proves the free-chat trigger calls the exact same
// shared sendBusinessInvite orchestration function as the admin-menu path
// (D-03), with zero duplicated Greek copy or deep-link construction.
//
// Mocking scaffold copied verbatim from tests/ai-owner-cancel-session.test.ts.

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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { aiOwnerAgent, OWNER_TOOLS } from '../src/onboarding/ai-owner-agent';
import * as generator from '../src/invites/generator';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreate = (require('@google/genai') as any)._mockCreate as jest.Mock;
const mockSendBusinessInvite = generator.sendBusinessInvite as jest.Mock;

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

const OWNER_TELEGRAM_ID = 'owner-telegram-id';

/** Gemini response with no function calls (exits loop) */
const GEMINI_TEXT_RESPONSE = {
  id: 'interaction-text',
  output_text: 'OK',
  steps: [] as Array<unknown>,
};

/** Build a Gemini response that calls send_invite with empty arguments */
function makeSendInviteCall(id = 'call-1') {
  return {
    id: 'interaction-1',
    steps: [{ type: 'function_call', name: 'send_invite', id, arguments: {} }],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: second Gemini call exits the loop (no more function calls)
  mockCreate.mockResolvedValue(GEMINI_TEXT_RESPONSE);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('send_invite tool — OWNER_TOOLS schema', () => {
  it('registers a zero-arg send_invite entry matching the shape of other zero-arg tools', () => {
    const tool = OWNER_TOOLS.find((t) => t.name === 'send_invite');
    expect(tool).toBeDefined();
    expect(tool?.type).toBe('function');
    expect(tool?.parameters).toEqual({ type: 'object', properties: {}, required: [] });
  });
});

describe('send_invite tool case — free-chat trigger wiring (INVITE-01, D-03)', () => {
  it('calls sendBusinessInvite exactly once with (business, ownerTelegramId) and resolves to empty string', async () => {
    mockSendBusinessInvite.mockResolvedValue(undefined);
    mockCreate.mockResolvedValueOnce(makeSendInviteCall());

    const result = await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Στείλε μου invite',
      '2026-07-27'
    );

    expect(mockSendBusinessInvite).toHaveBeenCalledTimes(1);
    expect(mockSendBusinessInvite).toHaveBeenCalledWith(MOCK_BUSINESS, OWNER_TELEGRAM_ID);
    expect(result).toBe('');
  });

  it('surfaces a sendBusinessInvite rejection via the shared generic Greek error string, with no new error-handling code', async () => {
    mockSendBusinessInvite.mockRejectedValue(new Error('boom'));
    mockCreate.mockResolvedValueOnce(makeSendInviteCall());

    const result = await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Στείλε μου invite',
      '2026-07-27'
    );

    expect(mockSendBusinessInvite).toHaveBeenCalledTimes(1);
    // aiOwnerAgent's 2nd round exits with GEMINI_TEXT_RESPONSE.output_text ('OK'),
    // but the function_result fed to Gemini for round 2 proves executeOwnerTool's
    // shared outer catch (no new code in the send_invite case) produced the same
    // generic Greek error string every other tool's uncaught failure produces.
    expect(result).toBe('OK');
    const secondCallArgs = mockCreate.mock.calls[1][0];
    const functionResults = secondCallArgs.input as Array<{ name: string; result: Array<{ text: string }> }>;
    const sendInviteResult = functionResults.find((r) => r.name === 'send_invite');
    expect(sendInviteResult?.result[0].text).toBe('Σφάλμα κατά την εκτέλεση. Δοκιμάστε ξανά.');
  });
});
