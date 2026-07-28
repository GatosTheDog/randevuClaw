// covers CONF-01
// Phase 26 Plan 02 Task 2 — tests for the uniform confirm-before-mutate
// policy across the 5 CONF-01 destructive owner actions:
//   (a) the 4 Task-1 send-confirmation cases (close_day, update_service_price,
//       delete_service, assign_client_to_session) — each sends an otc:*
//       confirmation keyboard and returns '' without mutating on the first
//       Gemini-triggered tool call.
//   (b) handleOwnerToolConfirmCallback's confirmed=true paths for svc_del and
//       hrs_close — the actual DB mutation only runs after a real owner
//       button tap.
//   (c) handleOwnerToolConfirmCallback's confirmed=false path — no mutation,
//       correct Greek cancellation reply.
//   (d) svc_price's "never staged" case — an expired/not-found reply with no
//       mutation.
//   (e) svc_price's success case — driving update_service_price through
//       aiOwnerAgent first (to populate the pending map as a real side
//       effect), then confirming it via handleOwnerToolConfirmCallback.
//
// cancel_session's confirmation (D-04, reused admin-menu contract) is
// covered separately in tests/ai-owner-cancel-session.test.ts.

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
  getClientName: jest.fn().mockResolvedValue(null),
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
  sendBusinessInvite: jest.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { aiOwnerAgent, handleOwnerToolConfirmCallback } from '../src/onboarding/ai-owner-agent';
import * as dbQueries from '../src/database/queries';
import * as telegramClient from '../src/telegram/client';
import * as sessionManager from '../src/session/manager';
import * as billingQueries from '../src/billing/queries';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreate = (require('@google/genai') as any)._mockCreate as jest.Mock;
const mockedGetConn = dbQueries.getConn as jest.MockedFunction<typeof dbQueries.getConn>;
const mockedFindServiceById = dbQueries.findServiceById as jest.MockedFunction<
  typeof dbQueries.findServiceById
>;
const mockedListServicesForBusiness = dbQueries.listServicesForBusiness as jest.Mock;
const mockedSendTelegramMessage = telegramClient.sendTelegramMessage as jest.MockedFunction<
  typeof telegramClient.sendTelegramMessage
>;
const mockedSendTelegramMessageWithKeyboard =
  telegramClient.sendTelegramMessageWithKeyboard as jest.MockedFunction<
    typeof telegramClient.sendTelegramMessageWithKeyboard
  >;
const mockListSessions = sessionManager.listSessions as jest.Mock;
const mockBookSessionInstance = sessionManager.bookSessionInstance as jest.Mock;
const mockedGetClientName = billingQueries.getClientName as jest.MockedFunction<
  typeof billingQueries.getClientName
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

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue(GEMINI_TEXT_RESPONSE);
  mockedGetClientName.mockResolvedValue(null);
  mockedListServicesForBusiness.mockResolvedValue([]);
  const chainable = {
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockResolvedValue(undefined),
    onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedGetConn.mockReturnValue(chainable as any);
});

// ---------------------------------------------------------------------------
// (a) Task-1 send-confirmation cases
// ---------------------------------------------------------------------------

describe('Task 1 send-confirmation cases (CONF-01)', () => {
  it('close_day sends an otc:hrs_close confirmation keyboard and returns without mutating', async () => {
    mockCreate.mockResolvedValueOnce(makeToolCall('close_day', { day_of_week: 0 }));

    const reply = await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Κλείσε την Κυριακή',
      '2026-07-28'
    );

    expect(reply).toBe('');
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      OWNER_TELEGRAM_ID,
      expect.any(String),
      [
        [
          { text: 'Επιβεβαίωση', callback_data: 'otc:hrs_close:0:yes' },
          { text: 'Άκυρο', callback_data: 'otc:hrs_close:0:no' },
        ],
      ]
    );
    expect(mockedGetConn).not.toHaveBeenCalled();
  });

  it('update_service_price sends an otc:svc_price confirmation keyboard and returns without mutating', async () => {
    mockedListServicesForBusiness.mockResolvedValueOnce([
      { id: 5, businessId: 1, name: 'Pilates', durationMin: 55, price: 1000, createdAt: new Date() },
    ]);
    mockCreate.mockResolvedValueOnce(
      makeToolCall('update_service_price', { service_name: 'Pilates', new_price_cents: 2000 })
    );

    const reply = await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Άλλαξε την τιμή του Pilates σε 20 ευρώ',
      '2026-07-28'
    );

    expect(reply).toBe('');
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      OWNER_TELEGRAM_ID,
      expect.stringContaining('20.00€'),
      [
        [
          { text: 'Επιβεβαίωση', callback_data: 'otc:svc_price:5:yes' },
          { text: 'Άκυρο', callback_data: 'otc:svc_price:5:no' },
        ],
      ]
    );
    expect(mockedGetConn).not.toHaveBeenCalled();
  });

  it('delete_service sends an otc:svc_del confirmation keyboard and returns without mutating', async () => {
    mockedListServicesForBusiness.mockResolvedValueOnce([
      { id: 5, businessId: 1, name: 'Pilates', durationMin: 55, price: 1000, createdAt: new Date() },
    ]);
    mockCreate.mockResolvedValueOnce(makeToolCall('delete_service', { service_name: 'Pilates' }));

    const reply = await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Διάγραψε το Pilates',
      '2026-07-28'
    );

    expect(reply).toBe('');
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      OWNER_TELEGRAM_ID,
      expect.any(String),
      [
        [
          { text: 'Διαγραφή', callback_data: 'otc:svc_del:5:yes' },
          { text: 'Άκυρο', callback_data: 'otc:svc_del:5:no' },
        ],
      ]
    );
    expect(mockedGetConn).not.toHaveBeenCalled();
  });

  it('assign_client_to_session sends an otc:assign confirmation keyboard and returns without mutating', async () => {
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
    mockedGetClientName.mockResolvedValueOnce('Μαρία');
    mockCreate.mockResolvedValueOnce(
      makeToolCall('assign_client_to_session', {
        client_phone: '123456789',
        session_date: '2026-08-01',
        session_time: '10:00',
      })
    );

    const reply = await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Όρισε τη Μαρία στο μάθημα',
      '2026-07-28'
    );

    expect(reply).toBe('');
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      OWNER_TELEGRAM_ID,
      expect.stringContaining('Μαρία'),
      [
        [
          { text: 'Επιβεβαίωση', callback_data: 'otc:assign:9:123456789:yes' },
          { text: 'Άκυρο', callback_data: 'otc:assign:9:123456789:no' },
        ],
      ]
    );
    expect(mockBookSessionInstance).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (b)/(c)/(d)/(e) handleOwnerToolConfirmCallback dispatcher
// ---------------------------------------------------------------------------

describe('handleOwnerToolConfirmCallback', () => {
  it('svc_del confirmed=true deletes the service inside withBusinessContext and replies with success', async () => {
    mockedFindServiceById.mockResolvedValueOnce({
      id: 5,
      businessId: 1,
      name: 'Pilates',
      durationMin: 55,
      price: 1000,
      createdAt: new Date(),
    });
    const deleteMock = jest.fn().mockReturnThis();
    const whereMock = jest.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedGetConn.mockReturnValue({ delete: deleteMock, where: whereMock } as any);

    await handleOwnerToolConfirmCallback(
      { otcAction: 'svc_del', id: 5, confirmed: true },
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID
    );

    expect(deleteMock).toHaveBeenCalled();
    expect(whereMock).toHaveBeenCalled();
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(
      OWNER_TELEGRAM_ID,
      expect.stringContaining('Pilates')
    );
  });

  it('hrs_close confirmed=true upserts businessHours inside withBusinessContext and replies with success', async () => {
    const insertMock = jest.fn().mockReturnThis();
    const valuesMock = jest.fn().mockReturnThis();
    const onConflictMock = jest.fn().mockResolvedValue(undefined);
    mockedGetConn.mockReturnValue({
      insert: insertMock,
      values: valuesMock,
      onConflictDoUpdate: onConflictMock,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await handleOwnerToolConfirmCallback(
      { otcAction: 'hrs_close', id: 0, confirmed: true },
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID
    );

    expect(insertMock).toHaveBeenCalled();
    expect(onConflictMock).toHaveBeenCalled();
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(
      OWNER_TELEGRAM_ID,
      expect.stringContaining('Κυριακή')
    );
  });

  it('confirmed=false (svc_del) sends the Greek cancellation reply and never touches getConn()', async () => {
    await handleOwnerToolConfirmCallback(
      { otcAction: 'svc_del', id: 5, confirmed: false },
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID
    );

    expect(mockedGetConn).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(OWNER_TELEGRAM_ID, 'Η διαγραφή ματαιώθηκε.');
  });

  it('svc_price confirmed=true for a serviceId that was never staged replies expired/not-found and performs no mutation', async () => {
    await handleOwnerToolConfirmCallback(
      { otcAction: 'svc_price', id: 999, confirmed: true },
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID
    );

    expect(mockedGetConn).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(OWNER_TELEGRAM_ID, expect.any(String));
  });

  it('svc_price success case: aiOwnerAgent stages the pending price, then handleOwnerToolConfirmCallback confirms and applies it', async () => {
    mockedListServicesForBusiness.mockResolvedValueOnce([
      { id: 7, businessId: 1, name: 'Yoga', durationMin: 60, price: 1500, createdAt: new Date() },
    ]);
    mockCreate.mockResolvedValueOnce(
      makeToolCall('update_service_price', { service_name: 'Yoga', new_price_cents: 2500 })
    );

    // Drive the real staging side effect via the actual tool call, not a mock.
    await aiOwnerAgent(
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID,
      'Άλλαξε την τιμή στο Yoga σε 25 ευρώ',
      '2026-07-28'
    );

    const updateMock = jest.fn().mockReturnThis();
    const setMock = jest.fn().mockReturnThis();
    const whereMock = jest.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedGetConn.mockReturnValue({ update: updateMock, set: setMock, where: whereMock } as any);
    mockedFindServiceById.mockResolvedValueOnce({
      id: 7,
      businessId: 1,
      name: 'Yoga',
      durationMin: 60,
      price: 2500,
      createdAt: new Date(),
    });

    await handleOwnerToolConfirmCallback(
      { otcAction: 'svc_price', id: 7, confirmed: true },
      MOCK_BUSINESS as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      OWNER_TELEGRAM_ID
    );

    expect(updateMock).toHaveBeenCalled();
    expect(setMock).toHaveBeenCalledWith({ price: 2500 });
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(
      OWNER_TELEGRAM_ID,
      expect.stringContaining('25.00€')
    );
  });
});
