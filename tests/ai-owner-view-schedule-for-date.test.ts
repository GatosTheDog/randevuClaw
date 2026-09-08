// covers quick-260908-dxa
// Unit tests for the new view_schedule_for_date owner tool — proves the
// owner can ask about any date (explicit DD/MM, Greek weekday name, or a
// relative-day word) via free text, and the tool's own reply always states
// the correct resolved Greek weekday name explicitly, so Gemini never has
// to compute a date/weekday itself.
//
// Deliberately does NOT mock ../src/conversation/greek-preprocessor or
// ../src/utils/timezone — the real deterministic date logic from Task 1
// must run so this is a true wiring test, not a mocked stub.
//
// Mocking scaffold copied verbatim from tests/ai-owner-name-matching.test.ts.

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
  handleViewClientMembership: jest.fn().mockResolvedValue(''),
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
import * as databaseQueries from '../src/database/queries';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreate = (require('@google/genai') as any)._mockCreate as jest.Mock;
const mockedListBookingsForDate = databaseQueries.listBookingsForDate as jest.MockedFunction<
  typeof databaseQueries.listBookingsForDate
>;
const mockedFindServiceById = databaseQueries.findServiceById as jest.MockedFunction<
  typeof databaseQueries.findServiceById
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

const OWNER_TELEGRAM_ID = 'owner-telegram-id';

// A Wednesday — matches the greek-preprocessor.test.ts REFERENCE_DATE fixture.
const TODAY = '2026-07-08';

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

const MOCK_BOOKING = {
  id: 1,
  businessId: MOCK_BUSINESS.id,
  clientPhone: '111111111',
  serviceId: 5,
  sessionInstanceId: null,
  calendarDate: '2026-09-07',
  calendarTime: '10:00',
  bookingStatus: 'confirmed',
  requestId: 'req-1',
  ownerTelegramMessageId: null,
  rescheduledFromBookingId: null,
  calendarSyncStatus: 'pending',
  googleCalendarEventId: null,
  calendarSyncRetryCount: 0,
  reminder24hSentAt: null,
  reminder1hSentAt: null,
  createdAt: new Date(),
  expiresAt: null,
};

/** Gemini response with no function calls (exits loop) */
const GEMINI_TEXT_RESPONSE = {
  id: 'interaction-text',
  output_text: 'OK',
  steps: [] as Array<unknown>,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue(GEMINI_TEXT_RESPONSE);
  mockedListBookingsForDate.mockResolvedValue([]);
});

describe('view_schedule_for_date tool — deterministic date resolution + explicit weekday statement', () => {
  it('"7/9" resolves to 2026-09-07 (Δευτέρα) and lists that date\'s bookings', async () => {
    mockedListBookingsForDate.mockResolvedValueOnce([MOCK_BOOKING as any]); // eslint-disable-line @typescript-eslint/no-explicit-any
    mockedFindServiceById.mockResolvedValueOnce({ id: 5, name: 'Pilates' } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    mockCreate.mockResolvedValueOnce(makeToolCall('view_schedule_for_date', { date_query: '7/9' }));

    await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Τι έχω στις 7/9;',
      TODAY
    );

    expect(mockedListBookingsForDate).toHaveBeenCalledWith(
      MOCK_BUSINESS.id,
      '2026-09-07',
      ['pending_owner_approval', 'confirmed']
    );
    const resultText = extractToolResultText(1, 'view_schedule_for_date');
    expect(resultText).toContain('Δευτέρα');
    expect(resultText).toContain('07/09/2026');
    expect(resultText).toContain('10:00');
    expect(resultText).toContain('Pilates');
  });

  it('"1/1" rolls to 2027-01-01 (Παρασκευή) and reports the empty-day message', async () => {
    mockedListBookingsForDate.mockResolvedValueOnce([]);
    mockCreate.mockResolvedValueOnce(makeToolCall('view_schedule_for_date', { date_query: '1/1' }));

    await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Τι έχω την 1/1;',
      TODAY
    );

    expect(mockedListBookingsForDate).toHaveBeenCalledWith(
      MOCK_BUSINESS.id,
      '2027-01-01',
      ['pending_owner_approval', 'confirmed']
    );
    const resultText = extractToolResultText(1, 'view_schedule_for_date');
    expect(resultText).toContain('Παρασκευή');
    expect(resultText).toContain('01/01/2027');
    expect(resultText).toContain('Δεν υπάρχουν ραντεβού');
  });

  it('"Δευτέρα" resolves to the nearest upcoming Monday (2026-07-13)', async () => {
    mockedListBookingsForDate.mockResolvedValueOnce([]);
    mockCreate.mockResolvedValueOnce(makeToolCall('view_schedule_for_date', { date_query: 'Δευτέρα' }));

    await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Τι έχω τη Δευτέρα;',
      TODAY
    );

    expect(mockedListBookingsForDate).toHaveBeenCalledWith(
      MOCK_BUSINESS.id,
      '2026-07-13',
      ['pending_owner_approval', 'confirmed']
    );
    const resultText = extractToolResultText(1, 'view_schedule_for_date');
    expect(resultText).toContain('Δευτέρα');
    expect(resultText).toContain('13/07/2026');
  });

  it('unparseable date_query returns a Greek clarification message without ever querying the database', async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolCall('view_schedule_for_date', { date_query: 'ένα τυχαίο μήνυμα χωρίς ημερομηνία' })
    );

    await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'ένα τυχαίο μήνυμα χωρίς ημερομηνία',
      TODAY
    );

    expect(mockedListBookingsForDate).not.toHaveBeenCalled();
    const resultText = extractToolResultText(1, 'view_schedule_for_date');
    expect(resultText).not.toMatch(/Δευτέρα|Τρίτη|Τετάρτη|Πέμπτη|Παρασκευή|Σάββατο|Κυριακή/);
  });
});
