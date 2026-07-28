// covers CLSS-07, CONF-01
// Unit tests for the cancel_session tool case wiring in ai-owner-agent.ts —
// originally Phase 23 Plan 01 Task 3, updated in Phase 26 Plan 02 Task 1
// (D-04): the free-chat cancel_session tool call no longer calls
// cancelSession/cascadeCancelSessionBookings directly — it sends the EXACT
// same menu:classes:cancel_yes/no confirmation the admin-menu path already
// uses (showCancelClassConfirm), so telegram.ts's existing menuAction routing
// + handleClassCancelExecute execute the actual cancellation only after a
// real owner button tap.
//
// Architecture tested:
//   owner text → aiOwnerAgent → Gemini (mocked) → executeOwnerTool (cancel_session)
//   → listSessions (mocked, session/manager) → sendTelegramMessageWithKeyboard
//     (mocked, telegram/client) with menu:classes:cancel_yes/no callback_data

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

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { aiOwnerAgent } from '../src/onboarding/ai-owner-agent';
import * as sessionManager from '../src/session/manager';
import * as telegramClient from '../src/telegram/client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreate = (require('@google/genai') as any)._mockCreate as jest.Mock;
const mockListSessions = sessionManager.listSessions as jest.Mock;
const mockCancelSession = sessionManager.cancelSession as jest.Mock;
const mockCascadeCancel = sessionManager.cascadeCancelSessionBookings as jest.Mock;
const mockSendTelegramMessageWithKeyboard =
  telegramClient.sendTelegramMessageWithKeyboard as jest.Mock;

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

/** Build a Gemini response that calls cancel_session with given args */
function makeCancelSessionCall(args: Record<string, unknown>, id = 'call-1') {
  return {
    id: 'interaction-1',
    steps: [{ type: 'function_call', name: 'cancel_session', id, arguments: args }],
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

describe('cancel_session tool case — free-chat confirmation reuses admin-menu contract (CONF-01/D-04)', () => {
  it('sends the menu:classes:cancel_yes/no confirmation keyboard when a matching session is found, and does NOT call cancelSession/cascadeCancelSessionBookings directly', async () => {
    mockListSessions.mockResolvedValue([
      { instanceId: 7, catalogId: 1, sessionDate: '2026-08-01', sessionTime: '10:00', bookedCount: 2, capacity: 5, serviceId: 1 },
    ]);

    mockCreate.mockResolvedValueOnce(
      makeCancelSessionCall({ session_date: '2026-08-01', session_time: '10:00' })
    );

    const reply = await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Ακύρωσε το μάθημα της 1/8 στις 10:00',
      '2026-07-27'
    );

    expect(reply).toBe('');
    expect(mockSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      OWNER_TELEGRAM_ID,
      expect.any(String),
      [
        [
          { text: 'Ναι', callback_data: 'menu:classes:cancel_yes:7' },
          { text: 'Όχι', callback_data: 'menu:classes:cancel_no:7' },
        ],
      ]
    );
    expect(mockCancelSession).not.toHaveBeenCalled();
    expect(mockCascadeCancel).not.toHaveBeenCalled();
  });

  it('confirmation prompt restates the session date/time (D-06 contextual detail)', async () => {
    mockListSessions.mockResolvedValue([
      { instanceId: 7, catalogId: 1, sessionDate: '2026-08-01', sessionTime: '10:00', bookedCount: 2, capacity: 5, serviceId: 1 },
    ]);

    mockCreate.mockResolvedValueOnce(
      makeCancelSessionCall({ session_date: '2026-08-01', session_time: '10:00' })
    );

    await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Ακύρωσε το μάθημα της 1/8 στις 10:00',
      '2026-07-27'
    );

    const [, promptText] = mockSendTelegramMessageWithKeyboard.mock.calls[0];
    expect(promptText).toContain('2026-08-01');
    expect(promptText).toContain('10:00');
  });

  it('calls neither cancelSession nor cascadeCancelSessionBookings when no matching session is found', async () => {
    mockListSessions.mockResolvedValue([]);

    mockCreate.mockResolvedValueOnce(
      makeCancelSessionCall({ session_date: '2026-08-01', session_time: '10:00' })
    );

    await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Ακύρωσε το μάθημα της 1/8 στις 10:00',
      '2026-07-27'
    );

    expect(mockCancelSession).not.toHaveBeenCalled();
    expect(mockCascadeCancel).not.toHaveBeenCalled();
  });
});
