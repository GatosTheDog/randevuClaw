// covers UX-03
// Phase 30 Plan 01 Task 1 — proves the 4 previously raw-ID-requiring owner
// tools (view_client_membership, assign_client_to_session,
// send_renewal_reminder, list_slotless_requests) now resolve clients by
// name via the shared resolveClientByName helper, with D-01 through D-05
// disambiguation semantics and T-30-01 cross-business isolation.
//
// Mocking scaffold copied verbatim from tests/ai-owner-confirmation-policy.test.ts.

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

import { aiOwnerAgent } from '../src/onboarding/ai-owner-agent';
import * as billingQueries from '../src/billing/queries';
import * as billingTools from '../src/billing/tools';
import * as telegramClient from '../src/telegram/client';
import * as sessionManager from '../src/session/manager';
import * as slotlessRequests from '../src/session/slotless-requests';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreate = (require('@google/genai') as any)._mockCreate as jest.Mock;
const mockedGetAllClientsForBusiness = billingQueries.getAllClientsForBusiness as jest.MockedFunction<
  typeof billingQueries.getAllClientsForBusiness
>;
const mockedGetClientActiveMembership = billingQueries.getClientActiveMembership as jest.MockedFunction<
  typeof billingQueries.getClientActiveMembership
>;
const mockedHandleViewClientMembership = billingTools.handleViewClientMembership as jest.MockedFunction<
  typeof billingTools.handleViewClientMembership
>;
const mockedSendTelegramMessage = telegramClient.sendTelegramMessage as jest.MockedFunction<
  typeof telegramClient.sendTelegramMessage
>;
const mockedSendTelegramMessageWithKeyboard =
  telegramClient.sendTelegramMessageWithKeyboard as jest.MockedFunction<
    typeof telegramClient.sendTelegramMessageWithKeyboard
  >;
const mockListSessions = sessionManager.listSessions as jest.Mock;
const mockedListSlotlessRequestsForClient =
  slotlessRequests.listSlotlessRequestsForClient as jest.MockedFunction<
    typeof slotlessRequests.listSlotlessRequestsForClient
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
  mockedHandleViewClientMembership.mockResolvedValue('__MEMBERSHIP_TEXT__');
});

// ---------------------------------------------------------------------------
// view_client_membership — full behavior coverage
// ---------------------------------------------------------------------------

describe('view_client_membership (UX-03 name matching)', () => {
  it('resolves a single name match and proceeds exactly like the old raw-ID path', async () => {
    mockedGetAllClientsForBusiness.mockResolvedValueOnce([SINGLE_CLIENT]);
    mockCreate.mockResolvedValueOnce(
      makeToolCall('view_client_membership', { client_name: 'Γιώργος' })
    );

    const reply = await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Δες τη συνδρομή του Γιώργου',
      '2026-07-29'
    );

    expect(reply).toBe('OK');
    expect(mockedGetAllClientsForBusiness).toHaveBeenCalledWith(MOCK_BUSINESS.id);
    expect(mockedHandleViewClientMembership).toHaveBeenCalledWith(
      MOCK_BUSINESS.id,
      SINGLE_CLIENT.senderPhone
    );
    expect(extractToolResultText(1, 'view_client_membership')).toBe('__MEMBERSHIP_TEXT__');
  });

  it('returns the generic not-found message on zero matches, with no membership lookup', async () => {
    mockedGetAllClientsForBusiness.mockResolvedValueOnce([]);
    mockCreate.mockResolvedValueOnce(
      makeToolCall('view_client_membership', { client_name: 'Αλέξανδρος' })
    );

    await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Δες τη συνδρομή του Αλέξανδρου',
      '2026-07-29'
    );

    expect(extractToolResultText(1, 'view_client_membership')).toBe(
      'Δεν βρέθηκε πελάτης με αυτό το όνομα.'
    );
    expect(mockedHandleViewClientMembership).not.toHaveBeenCalled();
  });

  it('returns a names-only disambiguation list on 2+ matches, with no membership lookup', async () => {
    mockedGetAllClientsForBusiness.mockResolvedValueOnce(AMBIGUOUS_CLIENTS);
    mockCreate.mockResolvedValueOnce(
      makeToolCall('view_client_membership', { client_name: 'Γιώργος' })
    );

    await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Δες τη συνδρομή του Γιώργου',
      '2026-07-29'
    );

    const resultText = extractToolResultText(1, 'view_client_membership');
    expect(resultText).toContain('Γιώργος');
    expect(resultText).toContain('Γιώργος Παπαδόπουλος');
    // D-05: never leaks the raw Telegram ID/phone
    expect(resultText).not.toContain('111111111');
    expect(resultText).not.toContain('222222222');
    expect(mockedHandleViewClientMembership).not.toHaveBeenCalled();
  });

  it('matches case-insensitively regardless of the case the owner types', async () => {
    mockedGetAllClientsForBusiness.mockResolvedValueOnce([SINGLE_CLIENT]);
    mockCreate.mockResolvedValueOnce(
      makeToolCall('view_client_membership', { client_name: 'γιώργος' })
    );

    await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Δες τη συνδρομή',
      '2026-07-29'
    );

    expect(mockedHandleViewClientMembership).toHaveBeenCalledWith(
      MOCK_BUSINESS.id,
      SINGLE_CLIENT.senderPhone
    );
  });

  it('T-30-01: a name that only matches a client under a DIFFERENT business never resolves', async () => {
    // getAllClientsForBusiness branches on the businessId argument — a client
    // named 'Γιώργος' exists only under OTHER_BUSINESS_ID, never under
    // MOCK_BUSINESS.id.
    mockedGetAllClientsForBusiness.mockImplementation(async (businessId: number) => {
      if (businessId === OTHER_BUSINESS_ID) return [SINGLE_CLIENT];
      return [];
    });
    mockCreate.mockResolvedValueOnce(
      makeToolCall('view_client_membership', { client_name: 'Γιώργος' })
    );

    await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Δες τη συνδρομή του Γιώργου',
      '2026-07-29'
    );

    expect(mockedGetAllClientsForBusiness).toHaveBeenCalledWith(MOCK_BUSINESS.id);
    expect(mockedGetAllClientsForBusiness).not.toHaveBeenCalledWith(OTHER_BUSINESS_ID);
    expect(extractToolResultText(1, 'view_client_membership')).toBe(
      'Δεν βρέθηκε πελάτης με αυτό το όνομα.'
    );
    expect(mockedHandleViewClientMembership).not.toHaveBeenCalled();
  });

  it('V5: rejects an empty client_name before any DB call, resolving to the generic not-found message', async () => {
    mockCreate.mockResolvedValueOnce(makeToolCall('view_client_membership', { client_name: '' }));

    await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Δες τη συνδρομή',
      '2026-07-29'
    );

    expect(mockedGetAllClientsForBusiness).not.toHaveBeenCalled();
    expect(extractToolResultText(1, 'view_client_membership')).toBe(
      'Δεν βρέθηκε πελάτης με αυτό το όνομα.'
    );
  });

  it('V5: rejects a >100-char client_name before any DB call', async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolCall('view_client_membership', { client_name: 'a'.repeat(101) })
    );

    await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Δες τη συνδρομή',
      '2026-07-29'
    );

    expect(mockedGetAllClientsForBusiness).not.toHaveBeenCalled();
    expect(extractToolResultText(1, 'view_client_membership')).toBe(
      'Δεν βρέθηκε πελάτης με αυτό το όνομα.'
    );
  });
});

// ---------------------------------------------------------------------------
// assign_client_to_session — single-match and zero-match wiring
// ---------------------------------------------------------------------------

describe('assign_client_to_session (UX-03 name matching)', () => {
  it('resolves a single match and sends the otc:assign confirmation keyboard with the resolved senderPhone', async () => {
    mockedGetAllClientsForBusiness.mockResolvedValueOnce([SINGLE_CLIENT]);
    mockListSessions.mockResolvedValueOnce([
      {
        instanceId: 9,
        catalogId: 1,
        sessionDate: '2026-08-01',
        sessionTime: '10:00',
        bookedCount: 1,
        capacity: 5,
        serviceId: 2,
      },
    ]);
    mockCreate.mockResolvedValueOnce(
      makeToolCall('assign_client_to_session', {
        client_name: 'Γιώργος',
        session_date: '2026-08-01',
        session_time: '10:00',
      })
    );

    const reply = await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Όρισε τον Γιώργο στο μάθημα',
      '2026-07-29'
    );

    expect(reply).toBe('');
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      OWNER_TELEGRAM_ID,
      expect.stringContaining('Γιώργος'),
      [
        [
          { text: 'Επιβεβαίωση', callback_data: `otc:assign:9:${SINGLE_CLIENT.senderPhone}:yes` },
          { text: 'Άκυρο', callback_data: `otc:assign:9:${SINGLE_CLIENT.senderPhone}:no` },
        ],
      ]
    );
  });

  it('returns the generic not-found message on zero matches, with no keyboard sent', async () => {
    mockedGetAllClientsForBusiness.mockResolvedValueOnce([]);
    mockCreate.mockResolvedValueOnce(
      makeToolCall('assign_client_to_session', {
        client_name: 'Αλέξανδρος',
        session_date: '2026-08-01',
        session_time: '10:00',
      })
    );

    await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Όρισε τον Αλέξανδρο στο μάθημα',
      '2026-07-29'
    );

    expect(extractToolResultText(1, 'assign_client_to_session')).toBe(
      'Δεν βρέθηκε πελάτης με αυτό το όνομα.'
    );
    expect(mockedSendTelegramMessageWithKeyboard).not.toHaveBeenCalled();
    expect(mockListSessions).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// send_renewal_reminder — single-match and zero-match wiring
// ---------------------------------------------------------------------------

describe('send_renewal_reminder (UX-03 name matching)', () => {
  it('resolves a single match, checks membership, and sends the Telegram reminder', async () => {
    mockedGetAllClientsForBusiness.mockResolvedValueOnce([SINGLE_CLIENT]);
    mockedGetClientActiveMembership.mockResolvedValueOnce({
      id: 1,
      businessId: MOCK_BUSINESS.id,
      clientPhone: SINGLE_CLIENT.senderPhone,
      sessionsRemaining: 2,
      isActive: true,
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    mockCreate.mockResolvedValueOnce(
      makeToolCall('send_renewal_reminder', { client_name: 'Γιώργος' })
    );

    await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Στείλε υπενθύμιση στον Γιώργο',
      '2026-07-29'
    );

    expect(mockedGetClientActiveMembership).toHaveBeenCalledWith(
      MOCK_BUSINESS.id,
      SINGLE_CLIENT.senderPhone
    );
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(
      SINGLE_CLIENT.senderPhone,
      expect.any(String)
    );
    expect(extractToolResultText(1, 'send_renewal_reminder')).toContain('Γιώργος');
  });

  it('returns the generic not-found message on zero matches, with no membership check or send', async () => {
    mockedGetAllClientsForBusiness.mockResolvedValueOnce([]);
    mockCreate.mockResolvedValueOnce(
      makeToolCall('send_renewal_reminder', { client_name: 'Αλέξανδρος' })
    );

    await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Στείλε υπενθύμιση στον Αλέξανδρο',
      '2026-07-29'
    );

    expect(extractToolResultText(1, 'send_renewal_reminder')).toBe(
      'Δεν βρέθηκε πελάτης με αυτό το όνομα.'
    );
    expect(mockedGetClientActiveMembership).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// list_slotless_requests — single-match and zero-match wiring
// ---------------------------------------------------------------------------

describe('list_slotless_requests (UX-03 name matching)', () => {
  it('resolves a single match and lists that client’s slotless requests', async () => {
    mockedGetAllClientsForBusiness.mockResolvedValueOnce([SINGLE_CLIENT]);
    mockedListSlotlessRequestsForClient.mockResolvedValueOnce([
      {
        id: 1,
        businessId: MOCK_BUSINESS.id,
        clientPhone: SINGLE_CLIENT.senderPhone,
        requestedSessionDate: '2026-08-05',
        requestedSessionTime: '09:00',
        status: 'pending',
        createdAt: new Date(),
      } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    ]);
    mockCreate.mockResolvedValueOnce(
      makeToolCall('list_slotless_requests', { client_name: 'Γιώργος' })
    );

    await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Δες τα αιτήματα χωρίς θέση του Γιώργου',
      '2026-07-29'
    );

    expect(mockedListSlotlessRequestsForClient).toHaveBeenCalledWith(
      MOCK_BUSINESS.id,
      SINGLE_CLIENT.senderPhone
    );
    expect(extractToolResultText(1, 'list_slotless_requests')).toContain('2026-08-05');
  });

  it('returns the generic not-found message on zero matches, with no slotless-requests query', async () => {
    mockedGetAllClientsForBusiness.mockResolvedValueOnce([]);
    mockCreate.mockResolvedValueOnce(
      makeToolCall('list_slotless_requests', { client_name: 'Αλέξανδρος' })
    );

    await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Δες τα αιτήματα χωρίς θέση του Αλέξανδρου',
      '2026-07-29'
    );

    expect(extractToolResultText(1, 'list_slotless_requests')).toBe(
      'Δεν βρέθηκε πελάτης με αυτό το όνομα.'
    );
    expect(mockedListSlotlessRequestsForClient).not.toHaveBeenCalled();
  });
});
