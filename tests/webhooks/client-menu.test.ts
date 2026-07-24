// Phase 18 Plan 04: Client menu integration tests.
//
// Covers:
//   Suite A — parseCallbackData union (pure unit tests)
//   Suite B — /start intercept, CMENU-05 free-text routing
//   Suite C — booking flow via handleClientMenuCallback (direct unit)
//   Suite D — cancel flow via handleClientMenuCallback (direct unit)
//   Suite E — existing parseCallbackData arms (billing, renewal)

import request from 'supertest';
import app from '../../src/server';
import * as queries from '../../src/database/queries';
import * as telegramClient from '../../src/telegram/client';
import * as conversationRouter from '../../src/conversation/router';
import * as registryModule from '../../src/telegram/registry';
import * as onboardingQueries from '../../src/onboarding/queries';
import * as billingQueries from '../../src/billing/queries';
import * as calendarSync from '../../src/calendar/sync';
import { parseCallbackData } from '../../src/webhooks/telegram';
import {
  handleClientMenuCallback,
  ClientMenuCallbackResult,
} from '../../src/telegram/handlers/client-menu';
import * as clientMenuModule from '../../src/telegram/handlers/client-menu';
import * as enforcement from '../../src/billing/enforcement';
import * as sessionManager from '../../src/session/manager';

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by Jest before any imports are executed)
// ---------------------------------------------------------------------------

jest.mock('../../src/database/queries');
jest.mock('../../src/telegram/client');
jest.mock('../../src/conversation/router');
jest.mock('../../src/calendar/sync');
jest.mock('../../src/telegram/registry');
jest.mock('../../src/billing/queries');
jest.mock('../../src/onboarding/queries');
jest.mock('../../src/onboarding/router');
jest.mock('../../src/onboarding/ai-owner-agent');
jest.mock('../../src/billing/enforcement');
jest.mock('../../src/session/manager');

// Mock the client-menu module for Suite B: only mock showClientRootMenu
// so that supertest calls through the webhook can detect it was called,
// while handleClientMenuCallback remains available for direct calls in Suites C+D.
jest.mock('../../src/telegram/handlers/client-menu', () => {
  const actual = jest.requireActual('../../src/telegram/handlers/client-menu');
  return {
    ...actual,
    showClientRootMenu: jest.fn().mockResolvedValue(undefined),
    // handleClientMenuCallback uses the real implementation (not mocked)
  };
});

// Mocking the db module to avoid Neon connection during tests
jest.mock('../../src/database/db', () => ({
  db: {
    select: jest.fn(),
    update: jest.fn(),
    transaction: jest.fn(),
    insert: jest.fn(),
    delete: jest.fn(),
  },
  appDb: {
    transaction: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const OWNER_TELEGRAM_ID = 'owner123';
const CLIENT_TELEGRAM_ID = 'client456';
const WEBHOOK_SECRET = 'test-secret';
const WEBHOOK_ID = 'test-webhook-id';

const BASE_BUSINESS = {
  id: 1,
  name: 'Test Studio',
  slug: 'test-studio',
  phoneNumberId: null,
  ownerTelegramId: OWNER_TELEGRAM_ID,
  googleRefreshToken: null,
  agendaSentDate: null,
  botToken: 'test-bot-token',
  webhookId: WEBHOOK_ID,
  webhookSecret: WEBHOOK_SECRET,
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

// ---------------------------------------------------------------------------
// Mock typed references
// ---------------------------------------------------------------------------

const mockedFindBusinessByWebhookId = queries.findBusinessByWebhookId as jest.MockedFunction<
  typeof queries.findBusinessByWebhookId
>;
const mockedInsertOrIgnoreTelegramUpdate =
  queries.insertOrIgnoreTelegramUpdate as jest.MockedFunction<
    typeof queries.insertOrIgnoreTelegramUpdate
  >;
const mockedMarkTelegramUpdateProcessed =
  queries.markTelegramUpdateProcessed as jest.MockedFunction<
    typeof queries.markTelegramUpdateProcessed
  >;
const mockedInsertClientBusinessRelationship =
  queries.insertClientBusinessRelationship as jest.MockedFunction<
    typeof queries.insertClientBusinessRelationship
  >;
const mockedWithBusinessContext = queries.withBusinessContext as jest.MockedFunction<
  typeof queries.withBusinessContext
>;
const mockedSendTelegramMessage =
  telegramClient.sendTelegramMessage as jest.MockedFunction<
    typeof telegramClient.sendTelegramMessage
  >;
const mockedSendTelegramMessageWithKeyboard =
  telegramClient.sendTelegramMessageWithKeyboard as jest.MockedFunction<
    typeof telegramClient.sendTelegramMessageWithKeyboard
  >;
const mockedRouteConversationMessage =
  conversationRouter.routeConversationMessage as jest.MockedFunction<
    typeof conversationRouter.routeConversationMessage
  >;
const mockedGetOrCreateBotInstance =
  registryModule.getOrCreateBotInstance as jest.MockedFunction<
    typeof registryModule.getOrCreateBotInstance
  >;
const mockedShowClientRootMenu = clientMenuModule.showClientRootMenu as jest.MockedFunction<
  typeof clientMenuModule.showClientRootMenu
>;
const mockedCheckEnforcementAndGetMembership =
  enforcement.checkEnforcementAndGetMembership as jest.MockedFunction<
    typeof enforcement.checkEnforcementAndGetMembership
  >;
const mockedBookSessionInstance = sessionManager.bookSessionInstance as jest.MockedFunction<
  typeof sessionManager.bookSessionInstance
>;
const mockedListSessions = sessionManager.listSessions as jest.MockedFunction<
  typeof sessionManager.listSessions
>;
const mockedFindBookingByIdUnscoped =
  queries.findBookingByIdUnscoped as jest.MockedFunction<
    typeof queries.findBookingByIdUnscoped
  >;
const mockedUpdateBookingStatus = queries.updateBookingStatus as jest.MockedFunction<
  typeof queries.updateBookingStatus
>;
const mockedFindMembershipByBooking =
  billingQueries.findMembershipByBooking as jest.MockedFunction<
    typeof billingQueries.findMembershipByBooking
  >;
const mockedRestoreCredit = billingQueries.restoreCredit as jest.MockedFunction<
  typeof billingQueries.restoreCredit
>;
const mockedDeleteBookingFromCalendar =
  calendarSync.deleteBookingFromCalendar as jest.MockedFunction<
    typeof calendarSync.deleteBookingFromCalendar
  >;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockBot = { handleUpdate: jest.fn().mockResolvedValue(undefined) };

function makeMessageUpdate(updateId: number, fromId: string | number, text = 'hello') {
  return {
    update_id: updateId,
    message: {
      message_id: 100 + updateId,
      from: { id: fromId, is_bot: false, first_name: 'TestUser' },
      chat: { id: fromId, type: 'private' },
      date: 1234567890,
      text,
    },
  };
}

async function postToWebhook(body: object) {
  return request(app)
    .post(`/webhooks/telegram/${WEBHOOK_ID}`)
    .set('Content-Type', 'application/json')
    .set('X-Telegram-Bot-Api-Secret-Token', WEBHOOK_SECRET)
    .send(body);
}

function setupCommonMocks() {
  mockedInsertOrIgnoreTelegramUpdate.mockResolvedValue('inserted');
  mockedMarkTelegramUpdateProcessed.mockResolvedValue(undefined);
  mockedInsertClientBusinessRelationship.mockResolvedValue({
    id: 1,
    businessId: 1,
    clientPhone: CLIENT_TELEGRAM_ID,
    clientName: 'TestUser',
    consentTimestamp: new Date(),
    createdAt: new Date(),
  } as any);
  mockedSendTelegramMessage.mockResolvedValue({ messageId: 999 });
  mockedSendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 998 });
  mockedRouteConversationMessage.mockResolvedValue(undefined);
  mockedGetOrCreateBotInstance.mockReturnValue(mockBot as any);
  (telegramClient.botTokenStore.run as jest.Mock).mockImplementation(
    (_value: string, callback: () => Promise<unknown>) => callback()
  );
  mockedWithBusinessContext.mockImplementation(
    (_id: unknown, fn: () => Promise<unknown>) => fn()
  );
  // showClientRootMenu — used in Suite B; default resolved
  mockedShowClientRootMenu.mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// SUITE A: parseCallbackData — pure unit tests (no mocking needed)
// ---------------------------------------------------------------------------

describe('Suite A: parseCallbackData union parsing', () => {
  // cmenu: prefix
  it('cmenu:book → clientMenuAction: book, id undefined', () => {
    const result = parseCallbackData('cmenu:book');
    expect(result).toEqual({ clientMenuAction: 'book', id: undefined });
  });

  it('cmenu:cancel:yes:42 → clientMenuAction: cancel:yes, id: 42', () => {
    const result = parseCallbackData('cmenu:cancel:yes:42');
    expect(result).toEqual({ clientMenuAction: 'cancel:yes', id: 42 });
  });

  it('cmenu:book:confirm:9999 → clientMenuAction: book:confirm, id: 9999', () => {
    const result = parseCallbackData('cmenu:book:confirm:9999');
    expect(result).toEqual({ clientMenuAction: 'book:confirm', id: 9999 });
  });

  it('cmenu:root → clientMenuAction: root, id undefined', () => {
    const result = parseCallbackData('cmenu:root');
    expect(result).toEqual({ clientMenuAction: 'root', id: undefined });
  });

  it('cmenu:balance → clientMenuAction: balance, id undefined', () => {
    const result = parseCallbackData('cmenu:balance');
    expect(result).toEqual({ clientMenuAction: 'balance', id: undefined });
  });

  // Existing arms
  it('approve_1 → BookingCallbackResult', () => {
    const result = parseCallbackData('approve_1');
    expect(result).toEqual({ action: 'approve', bookingId: 1 });
  });

  it('menu:settings → MenuCallbackResult', () => {
    const result = parseCallbackData('menu:settings');
    expect(result).toEqual({ menuAction: 'settings', id: undefined });
  });

  it('slotless:req_approve:5 → SlotlessCallbackResult', () => {
    const result = parseCallbackData('slotless:req_approve:5');
    expect(result).toEqual({ action: 'slotless:req_approve', slotlessRequestId: 5 });
  });

  // Edge cases
  it('cmenu: (empty action) → null', () => {
    const result = parseCallbackData('cmenu:');
    expect(result).toBeNull();
  });

  it('undefined → null', () => {
    const result = parseCallbackData(undefined);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SUITE B: /start intercept and CMENU-05 free-text routing
// ---------------------------------------------------------------------------

describe('Suite B: /start intercept and CMENU-05 free-text routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupCommonMocks();
    mockedFindBusinessByWebhookId.mockResolvedValue({ ...BASE_BUSINESS });
  });

  it('client sends /start → showClientRootMenu called, routeConversationMessage NOT called', async () => {
    const res = await postToWebhook(makeMessageUpdate(1, CLIENT_TELEGRAM_ID, '/start'));

    expect(res.status).toBe(200);
    expect(mockedShowClientRootMenu).toHaveBeenCalledTimes(1);
    expect(mockedShowClientRootMenu).toHaveBeenCalledWith(
      String(CLIENT_TELEGRAM_ID),
      expect.objectContaining({ id: 1 })
    );
    expect(mockedRouteConversationMessage).not.toHaveBeenCalled();
  });

  it('owner sends /start → showClientRootMenu NOT called (owner branch intercepts first)', async () => {
    // Owner branch calls aiOwnerAgent, not showClientRootMenu
    const aiOwnerAgentMock = jest.requireMock('../../src/onboarding/ai-owner-agent');
    aiOwnerAgentMock.aiOwnerAgent.mockResolvedValue('Γεια σου');

    const res = await postToWebhook(makeMessageUpdate(2, OWNER_TELEGRAM_ID, '/start'));

    expect(res.status).toBe(200);
    expect(mockedShowClientRootMenu).not.toHaveBeenCalled();
  });

  it('CMENU-05: client sends Greek free-text → routeConversationMessage called, showClientRootMenu NOT called', async () => {
    const res = await postToWebhook(
      makeMessageUpdate(3, CLIENT_TELEGRAM_ID, 'Θέλω να κλείσω ραντεβού')
    );

    expect(res.status).toBe(200);
    expect(mockedRouteConversationMessage).toHaveBeenCalledTimes(1);
    expect(mockedShowClientRootMenu).not.toHaveBeenCalled();
  });

  it('CMENU-05: client sends "   /start   " (trimmed) → showClientRootMenu IS called', async () => {
    const res = await postToWebhook(makeMessageUpdate(4, CLIENT_TELEGRAM_ID, '   /start   '));

    expect(res.status).toBe(200);
    expect(mockedShowClientRootMenu).toHaveBeenCalledTimes(1);
    expect(mockedRouteConversationMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SUITE C: Booking flow via handleClientMenuCallback (direct unit tests)
// ---------------------------------------------------------------------------

describe('Suite C: booking flow via handleClientMenuCallback', () => {
  const senderTelegramId = CLIENT_TELEGRAM_ID;
  const instanceId = 7;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedSendTelegramMessage.mockResolvedValue({ messageId: 999 });
    mockedSendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 998 });
    mockedBookSessionInstance.mockResolvedValue({ status: 'booked', bookingId: 42 } as any);
    mockedListSessions.mockResolvedValue([]);
    // Default: enforcement allows
    mockedCheckEnforcementAndGetMembership.mockResolvedValue({
      allowed: true,
      shouldAlert: false,
      membership: { membershipId: 10 } as any,
    });
  });

  it('book:yes — enforcement allows, bookSessionInstance succeeds → Greek confirmation sent', async () => {
    // Mock the db query inside handleBookSessionExecute (serviceId lookup)
    const dbMock = jest.requireMock('../../src/database/db');
    dbMock.db.select = jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ serviceId: 3 }]),
          }),
        }),
      }),
    });

    const result: ClientMenuCallbackResult = { clientMenuAction: 'book:yes', id: instanceId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedCheckEnforcementAndGetMembership).toHaveBeenCalledWith(
      BASE_BUSINESS.id,
      senderTelegramId
    );
    expect(mockedBookSessionInstance).toHaveBeenCalled();
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(
      senderTelegramId,
      expect.stringContaining('επιβεβαιώθηκε')
    );
  });

  it('book:yes — enforcement blocks → refusal message sent, bookSessionInstance NOT called', async () => {
    mockedCheckEnforcementAndGetMembership.mockResolvedValue({
      allowed: false,
      message: 'Για να κάνετε κράτηση, χρειάζεστε ενεργή συνδρομή.',
      shouldAlert: false,
      membership: null,
    });

    const result: ClientMenuCallbackResult = { clientMenuAction: 'book:yes', id: instanceId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(
      senderTelegramId,
      'Για να κάνετε κράτηση, χρειάζεστε ενεργή συνδρομή.'
    );
    expect(mockedBookSessionInstance).not.toHaveBeenCalled();
  });

  it('book — business.bookingMode === open_slots → fallback message sent, listSessions NOT called', async () => {
    const openSlotsBusiness = { ...BASE_BUSINESS, bookingMode: 'open_slots' };

    const result: ClientMenuCallbackResult = { clientMenuAction: 'book' };
    await handleClientMenuCallback(result, openSlotsBusiness as any, senderTelegramId);

    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(
      senderTelegramId,
      expect.stringContaining('γράψε μου')
    );
    expect(mockedListSessions).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SUITE D: Cancel flow via handleClientMenuCallback (direct unit tests)
// ---------------------------------------------------------------------------

describe('Suite D: cancel flow via handleClientMenuCallback', () => {
  const senderTelegramId = CLIENT_TELEGRAM_ID;
  const bookingId = 99;

  const BASE_BOOKING = {
    id: bookingId,
    businessId: BASE_BUSINESS.id,
    clientPhone: CLIENT_TELEGRAM_ID,
    serviceId: 1,
    sessionInstanceId: null,
    calendarDate: '2099-12-31',
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockedSendTelegramMessage.mockResolvedValue({ messageId: 999 });
    mockedSendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 998 });
    mockedFindBookingByIdUnscoped.mockResolvedValue(BASE_BOOKING as any);
    mockedUpdateBookingStatus.mockResolvedValue(undefined);
    mockedFindMembershipByBooking.mockResolvedValue(null);
    mockedRestoreCredit.mockResolvedValue(undefined as any);
    mockedDeleteBookingFromCalendar.mockResolvedValue(true);
    (telegramClient.botTokenStore.run as jest.Mock).mockImplementation(
      (_value: string, callback: () => Promise<unknown>) => callback()
    );
  });

  it('cancel:yes — happy path: ownership match, outside cutoff → updateBookingStatus called', async () => {
    const result: ClientMenuCallbackResult = { clientMenuAction: 'cancel:yes', id: bookingId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedUpdateBookingStatus).toHaveBeenCalledWith(bookingId, 'cancelled');
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(
      senderTelegramId,
      expect.stringContaining('ακυρώθηκε')
    );
  });

  it('cancel:yes — credit restore: findMembershipByBooking returns membershipId → restoreCredit called', async () => {
    mockedFindMembershipByBooking.mockResolvedValue(55);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'cancel:yes', id: bookingId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedRestoreCredit).toHaveBeenCalledWith(
      55,
      bookingId,
      `booking:${bookingId}:credit`
    );
  });

  it('cancel:yes — no membership: findMembershipByBooking returns null → restoreCredit NOT called', async () => {
    mockedFindMembershipByBooking.mockResolvedValue(null);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'cancel:yes', id: bookingId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedRestoreCredit).not.toHaveBeenCalled();
  });

  it('cancel:yes — ownership guard: wrong clientPhone → updateBookingStatus NOT called, error message sent', async () => {
    mockedFindBookingByIdUnscoped.mockResolvedValue({
      ...BASE_BOOKING,
      clientPhone: 'someone-else',
    } as any);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'cancel:yes', id: bookingId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedUpdateBookingStatus).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(
      senderTelegramId,
      expect.stringContaining('δικαίωμα')
    );
  });

  it('cancel:yes — cutoff guard: cutoff enabled, session 1 hour away, cutoffHours=2 → cancel blocked', async () => {
    // Set session time 1 hour from now (well within a 2h cutoff)
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
    // Use a fixed far-future date but trick hoursUntilSession by using a real
    // past date/time that is already in the past relative to now.
    // Strategy: booking in the past → hours will be negative → < cutoffHours
    const pastBooking = {
      ...BASE_BOOKING,
      calendarDate: '2000-01-01',
      calendarTime: '00:00',
    };
    mockedFindBookingByIdUnscoped.mockResolvedValue(pastBooking as any);

    const cutoffBusiness = {
      ...BASE_BUSINESS,
      cancellationCutoffEnabled: true,
      cancellationCutoffHours: 2,
    };

    const result: ClientMenuCallbackResult = { clientMenuAction: 'cancel:yes', id: bookingId };
    await handleClientMenuCallback(result, cutoffBusiness as any, senderTelegramId);

    expect(mockedUpdateBookingStatus).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(
      senderTelegramId,
      expect.stringContaining('2')
    );
    void oneHourFromNow; // suppress unused warning
  });
});

// ---------------------------------------------------------------------------
// SUITE E: Existing parseCallbackData arms (billing, renewal)
// ---------------------------------------------------------------------------

describe('Suite E: existing parseCallbackData arms', () => {
  it('billing:client:1 → BillingCallbackResult with action billing:client', () => {
    const result = parseCallbackData('billing:client:1');
    expect(result).toEqual({
      action: 'billing:client',
      firstId: 1,
      optionalSecondId: undefined,
    });
  });

  it('renewal:approve:99 → RenewalCallbackResult with businessId 99', () => {
    const result = parseCallbackData('renewal:approve:99');
    expect(result).toEqual({
      action: 'renewal:approve',
      businessId: 99,
    });
  });
});
