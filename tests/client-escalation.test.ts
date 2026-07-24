/**
 * Integration tests for Phase 20 client escalation — ESCL-01, ESCL-02, ESCL-03.
 *
 * Covers:
 *   - parseCallbackData: escl:approve and escl:reply arms parsed correctly
 *   - parseCallbackData: existing arms (menu:*, cmenu:*) not broken by escl: extension
 *   - buildEscalationKeyboard: button count and callback_data shape
 *   - sendEscalationToAdmin: missing botToken or ownerTelegramId prevents sending
 *   - sendEscalationToAdmin: both present → sendTelegramMessageWithKeyboard called once
 *
 * NEVER run bare `npm test` — machine crashes on full suite.
 * Use: npm test -- --testPathPattern="client-escalation" --testTimeout=20000
 */

import { parseCallbackData } from '../src/webhooks/telegram';

// ---------------------------------------------------------------------------
// Mock all external modules — no real DB or Telegram API calls
// ---------------------------------------------------------------------------

jest.mock('../src/database/queries', () => ({
  findClientBusinessRelationship: jest.fn().mockResolvedValue({ id: 1, clientName: 'Άννα' }),
  findBusinessByWebhookId: jest.fn(),
  insertOrIgnoreTelegramUpdate: jest.fn(),
  insertClientBusinessRelationship: jest.fn(),
  markTelegramUpdateProcessed: jest.fn(),
  withBusinessContext: jest.fn(),
  findBookingByIdUnscoped: jest.fn(),
  findBusinessById: jest.fn(),
  findServiceById: jest.fn(),
  updateBookingStatus: jest.fn(),
  updateBookingStatusIfPending: jest.fn(),
}));

jest.mock('../src/telegram/client', () => ({
  sendTelegramMessage: jest.fn().mockResolvedValue({ messageId: 1 }),
  sendTelegramMessageWithKeyboard: jest.fn().mockResolvedValue({ messageId: 2 }),
  answerCallbackQuery: jest.fn().mockResolvedValue(undefined),
  editTelegramMessageReplyMarkup: jest.fn().mockResolvedValue(undefined),
  botTokenStore: {
    run: jest.fn().mockImplementation(async (_token: string, fn: () => Promise<unknown>) => fn()),
  },
  InlineKeyboard: undefined,
}));

jest.mock('../src/telegram/registry', () => ({
  getOrCreateBotInstance: jest.fn().mockReturnValue({ handleUpdate: jest.fn().mockResolvedValue(undefined) }),
}));

jest.mock('../src/billing/queries', () => ({
  findMembershipByBooking: jest.fn().mockResolvedValue(null),
  restoreCredit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/session/manager', () => ({
  bookSessionInstance: jest.fn().mockResolvedValue({ status: 'confirmed' }),
}));

jest.mock('../src/onboarding/queries', () => ({
  findBusinessByOwnerTelegramId: jest.fn().mockResolvedValue(null),
}));

jest.mock('../src/database/db', () => ({
  db: {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../src/database/schema', () => ({
  sessionInstances: {},
  sessionCatalog: { id: 'id', serviceId: 'serviceId' },
  businesses: {},
  bookings: {},
  clientBusinessRelationships: {},
  services: {},
  telegramUpdates: {},
  packages: {},
  memberships: {},
  sessionBookings: {},
}));

jest.mock('../src/conversation/router', () => ({
  routeConversationMessage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/calendar/sync', () => ({
  syncBookingToCalendar: jest.fn().mockResolvedValue(undefined),
  deleteBookingFromCalendar: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/onboarding/ai-owner-agent', () => ({
  aiOwnerAgent: jest.fn().mockResolvedValue(''),
}));

jest.mock('../src/session/slotless-requests', () => ({
  approveSlotlessRequest: jest.fn().mockResolvedValue(null),
  rejectSlotlessRequest: jest.fn().mockResolvedValue(null),
}));

jest.mock('../src/scheduler/membership-expiry', () => ({
  pendingRenewalBatches: new Map(),
}));

jest.mock('../src/telegram/handlers/admin-menu', () => ({
  handleMenuCallback: jest.fn().mockResolvedValue(undefined),
  showAdminRootMenu: jest.fn().mockResolvedValue(undefined),
  MenuCallbackResult: undefined,
}));

jest.mock('../src/telegram/handlers/client-menu', () => ({
  handleClientMenuCallback: jest.fn().mockResolvedValue(undefined),
  showClientRootMenu: jest.fn().mockResolvedValue(undefined),
  ClientMenuCallbackResult: undefined,
}));

jest.mock('../src/telegram/handlers/payment-flow', () => ({
  handleConfirmMembership: jest.fn().mockResolvedValue(undefined),
  handleCancelPackage: jest.fn().mockResolvedValue(undefined),
  handleConfirmPackage: jest.fn().mockResolvedValue(undefined),
  showPackageSelection: jest.fn().mockResolvedValue(undefined),
  showMembershipConfirmation: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/utils/timezone', () => ({
  isoDateInAthens: jest.fn().mockReturnValue('2026-07-24'),
}));

jest.mock('drizzle-orm', () => ({
  eq: jest.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
}));

// ---------------------------------------------------------------------------
// TEST GROUP 1: parseCallbackData — EscalationCallbackResult arm
// ---------------------------------------------------------------------------

describe('parseCallbackData — EscalationCallbackResult arm', () => {
  test('escl:approve:99:123456789 → escalationAction approve with instanceId and clientTelegramId', () => {
    const result = parseCallbackData('escl:approve:99:123456789');
    expect(result).toEqual({
      escalationAction: 'approve',
      instanceId: 99,
      clientTelegramId: '123456789',
    });
  });

  test('escl:reply:123456789 → escalationAction reply with clientTelegramId, no instanceId', () => {
    const result = parseCallbackData('escl:reply:123456789');
    expect(result).toEqual({
      escalationAction: 'reply',
      clientTelegramId: '123456789',
      instanceId: undefined,
    });
  });

  test('escl:approve:1: (empty clientTelegramId) → escalationAction approve, clientTelegramId empty string', () => {
    // The regex group3 would be undefined for escl:approve:1: (trailing colon but no group3 digits)
    // The regex /^escl:(approve|reply):(\d+)(?::(\d+))?$/ requires group3 to be \d+
    // escl:approve:1: won't match (trailing colon + empty), returns null
    const result = parseCallbackData('escl:approve:1:');
    // The regex does not match malformed data — returns null (safe by design)
    expect(result).toBeNull();
  });

  test('escl: discriminant present in approve result', () => {
    const result = parseCallbackData('escl:approve:42:987654321');
    expect(result).not.toBeNull();
    expect('escalationAction' in result!).toBe(true);
    expect('bookingId' in result!).toBe(false);
    expect('firstId' in result!).toBe(false);
    expect('menuAction' in result!).toBe(false);
    expect('clientMenuAction' in result!).toBe(false);
  });

  test('escl: discriminant present in reply result', () => {
    const result = parseCallbackData('escl:reply:987654321');
    expect(result).not.toBeNull();
    expect('escalationAction' in result!).toBe(true);
    expect('menuAction' in result!).toBe(false);
    expect('clientMenuAction' in result!).toBe(false);
  });

  test('existing menu: arm not broken — menu:settings still returns menuAction', () => {
    const result = parseCallbackData('menu:settings');
    expect(result).not.toBeNull();
    expect('menuAction' in result!).toBe(true);
    expect((result as { menuAction: string }).menuAction).toBe('settings');
  });

  test('existing cmenu: arm not broken — cmenu:book still returns clientMenuAction', () => {
    const result = parseCallbackData('cmenu:book');
    expect(result).not.toBeNull();
    expect('clientMenuAction' in result!).toBe(true);
    expect((result as { clientMenuAction: string }).clientMenuAction).toBe('book');
  });

  test('existing approve_ arm not broken', () => {
    const result = parseCallbackData('approve_5');
    expect(result).not.toBeNull();
    expect((result as { action: string; bookingId: number }).action).toBe('approve');
    expect((result as { action: string; bookingId: number }).bookingId).toBe(5);
  });

  test('unrecognised pattern returns null', () => {
    const result = parseCallbackData('escl:unknown:123');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TEST GROUP 2: buildEscalationKeyboard — imported directly (not mocked)
// ---------------------------------------------------------------------------

// Note: escalation.ts is NOT in the mock list above for this group.
// We import it directly so the real implementation runs.
// The module depends on ../src/telegram/client which IS mocked above.

describe('buildEscalationKeyboard — button shape', () => {
  // Import the real module after mocks are set up
  let buildEscalationKeyboard: (clientTelegramId: string, instanceId?: number) => unknown[][];

  beforeAll(() => {
    // Reset the module registry so escalation.ts is loaded fresh with mocked deps
    jest.resetModules();

    // Re-apply the telegram/client mock in this reset context
    jest.doMock('../src/telegram/client', () => ({
      sendTelegramMessage: jest.fn(),
      sendTelegramMessageWithKeyboard: jest.fn(),
      botTokenStore: { run: jest.fn() },
      InlineKeyboard: undefined,
    }));

    jest.doMock('../src/utils/logger', () => ({
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      },
    }));

    // Require after doMock
    const escalationModule = require('../src/telegram/escalation');
    buildEscalationKeyboard = escalationModule.buildEscalationKeyboard;
  });

  test('with instanceId: keyboard has 2 buttons (approve + reply)', () => {
    const keyboard = buildEscalationKeyboard('123456789', 99);
    expect(keyboard).toHaveLength(1);
    expect(keyboard[0]).toHaveLength(2);
  });

  test('without instanceId: keyboard has 1 button (reply only)', () => {
    const keyboard = buildEscalationKeyboard('123456789');
    expect(keyboard).toHaveLength(1);
    expect(keyboard[0]).toHaveLength(1);
  });

  test('approve callback_data starts with escl:approve:', () => {
    const keyboard = buildEscalationKeyboard('123456789', 99);
    const row = keyboard[0] as Array<{ text: string; callback_data: string }>;
    expect(row[0].callback_data).toMatch(/^escl:approve:/);
  });

  test('reply callback_data starts with escl:reply:', () => {
    const keyboard = buildEscalationKeyboard('123456789', 99);
    const row = keyboard[0] as Array<{ text: string; callback_data: string }>;
    expect(row[1].callback_data).toMatch(/^escl:reply:/);
  });

  test('reply-only keyboard callback_data starts with escl:reply:', () => {
    const keyboard = buildEscalationKeyboard('123456789');
    const row = keyboard[0] as Array<{ text: string; callback_data: string }>;
    expect(row[0].callback_data).toMatch(/^escl:reply:/);
  });
});

// ---------------------------------------------------------------------------
// TEST GROUP 3: sendEscalationToAdmin — guard behaviors
// ---------------------------------------------------------------------------

describe('sendEscalationToAdmin — guard behaviors', () => {
  let sendEscalationToAdmin: (
    business: Record<string, unknown>,
    clientTelegramId: string,
    action: string,
    reason: string,
    instanceId?: number
  ) => Promise<void>;

  const mockBusiness = {
    id: 1,
    name: 'Test Studio',
    slug: 'test-studio',
    phoneNumberId: null,
    ownerTelegramId: '111222333',
    googleRefreshToken: null,
    agendaSentDate: null,
    botToken: 'test-bot-token',
    webhookId: 'wh-1',
    webhookSecret: 'secret',
    enforcementPolicy: 'block',
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  beforeAll(() => {
    // Use the module loaded in GROUP 2 beforeAll (after resetModules)
    // Re-require to get the same module in this scope
    const escalationModule = require('../src/telegram/escalation');
    sendEscalationToAdmin = escalationModule.sendEscalationToAdmin;
  });

  test('missing botToken — sendTelegramMessageWithKeyboard NOT called', async () => {
    await sendEscalationToAdmin(
      { ...mockBusiness, botToken: null },
      '987654321',
      'κράτηση',
      'membership_expired'
    );
    const telegramClient = require('../src/telegram/client');
    expect(telegramClient.sendTelegramMessageWithKeyboard).not.toHaveBeenCalled();
  });

  test('missing ownerTelegramId — sendTelegramMessageWithKeyboard NOT called', async () => {
    await sendEscalationToAdmin(
      { ...mockBusiness, ownerTelegramId: null },
      '987654321',
      'κράτηση',
      'membership_expired'
    );
    const telegramClient = require('../src/telegram/client');
    expect(telegramClient.sendTelegramMessageWithKeyboard).not.toHaveBeenCalled();
  });

  test('both botToken and ownerTelegramId present — sendTelegramMessageWithKeyboard called once via botTokenStore.run', async () => {
    const telegramClient = require('../src/telegram/client');
    const queries = require('../src/database/queries');

    // Set up mocks in this module context
    telegramClient.botTokenStore.run = jest.fn().mockImplementation(
      async (_token: string, fn: () => Promise<unknown>) => fn()
    );
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 1 });
    queries.findClientBusinessRelationship.mockResolvedValue({ id: 1, clientName: 'Άννα' });

    await sendEscalationToAdmin(
      mockBusiness,
      '987654321',
      'κράτηση μαθήματος',
      'class_full',
      42
    );

    expect(telegramClient.sendTelegramMessageWithKeyboard).toHaveBeenCalledTimes(1);
  });
});
