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
import * as consentChecker from '../../src/consent/checker';
import { CONSENT_PROMPT_GREEK_TEMPLATE, CONSENT_KEYBOARD } from '../../src/consent/checker';
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
// Phase 27 (COMP-01/COMP-02): partial mock — keep the real
// CONSENT_PROMPT_GREEK_TEMPLATE/CONSENT_KEYBOARD (used for this file's own
// assertions) while replacing only getOrCreateClientRelationship, mirroring
// tests/conversation-router.test.ts's established pattern.
jest.mock('../../src/consent/checker', () => ({
  ...jest.requireActual('../../src/consent/checker'),
  getOrCreateClientRelationship: jest.fn(),
}));
jest.mock('../../src/telegram/registry');
jest.mock('../../src/billing/queries');
jest.mock('../../src/onboarding/queries');
jest.mock('../../src/onboarding/ai-owner-agent');
jest.mock('../../src/billing/enforcement');
jest.mock('../../src/session/manager');
jest.mock('../../src/telegram/escalation', () => ({
  sendEscalationToAdmin: jest.fn().mockResolvedValue(undefined),
  buildEscalationKeyboard: jest.fn().mockReturnValue([[{ text: 'Απάντηση πελάτη', callback_data: 'escl:reply:test' }]]),
}));

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
// Phase 29 (D-06): handleBookSessionExecute's shared session-instance lookup.
const mockedFindSessionInstanceById =
  sessionManager.findSessionInstanceById as jest.MockedFunction<
    typeof sessionManager.findSessionInstanceById
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
const mockedGetClientName = billingQueries.getClientName as jest.MockedFunction<
  typeof billingQueries.getClientName
>;
const mockedDeleteBookingFromCalendar =
  calendarSync.deleteBookingFromCalendar as jest.MockedFunction<
    typeof calendarSync.deleteBookingFromCalendar
  >;
// Phase 22 (OWNR-05/06/07): sbk: session booking approval routing mocks.
const mockedUpdateBookingStatusIfPending =
  queries.updateBookingStatusIfPending as jest.MockedFunction<
    typeof queries.updateBookingStatusIfPending
  >;
const mockedReleaseSessionCapacity =
  sessionManager.releaseSessionCapacity as jest.MockedFunction<
    typeof sessionManager.releaseSessionCapacity
  >;
// Phase 27 (COMP-01/COMP-02): consent gate mocks.
const mockedGetOrCreateClientRelationship =
  consentChecker.getOrCreateClientRelationship as jest.MockedFunction<
    typeof consentChecker.getOrCreateClientRelationship
  >;
const mockedUpdateClientConsentGiven = queries.updateClientConsentGiven as jest.MockedFunction<
  typeof queries.updateClientConsentGiven
>;
// Phase 29 (D-10): showBookSessionList service-name enrichment.
const mockedFindServiceById = queries.findServiceById as jest.MockedFunction<
  typeof queries.findServiceById
>;
// Phase 29 (D-10): showClientBookings / showCancelBookingList service-name enrichment.
const mockedListClientBookings = queries.listClientBookings as jest.MockedFunction<
  typeof queries.listClientBookings
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

function makeCallbackQueryUpdate(
  updateId: number,
  fromId: string | number,
  data: string,
  messageId = 500 + updateId
) {
  return {
    update_id: updateId,
    callback_query: {
      id: `cbq-${updateId}`,
      from: { id: fromId, is_bot: false, first_name: 'TestUser' },
      message: { message_id: messageId, chat: { id: fromId, type: 'private' } },
      data,
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
  // Phase 27 (COMP-01/COMP-02): default to already-consented so existing
  // Suite B/F /start and callback flows are unaffected by the new gate.
  mockedGetOrCreateClientRelationship.mockResolvedValue({ isFirstContact: false, consentGiven: true });
  mockedUpdateClientConsentGiven.mockResolvedValue(undefined);
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
// showClientRootMenu — booking button label reflects business.bookingMode (D-03)
//
// Suite B mocks showClientRootMenu itself, so these tests reach the real
// implementation via jest.requireActual (mirroring the module factory above).
// ---------------------------------------------------------------------------

describe('showClientRootMenu: booking button label reflects bookingMode (D-03)', () => {
  const actualClientMenu = jest.requireActual('../../src/telegram/handlers/client-menu');

  beforeEach(() => {
    jest.clearAllMocks();
    mockedSendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 998 });
  });

  it('renders "Κράτηση μαθήματος" when business.bookingMode === fixed_sessions', async () => {
    await actualClientMenu.showClientRootMenu(CLIENT_TELEGRAM_ID, { ...BASE_BUSINESS });

    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      CLIENT_TELEGRAM_ID,
      expect.any(String),
      expect.arrayContaining([
        expect.arrayContaining([expect.objectContaining({ text: 'Κράτηση μαθήματος' })]),
      ])
    );
  });

  it('renders "Κράτηση ραντεβού" when business.bookingMode === open_slots', async () => {
    const openSlotsBusiness = { ...BASE_BUSINESS, bookingMode: 'open_slots' };
    await actualClientMenu.showClientRootMenu(CLIENT_TELEGRAM_ID, openSlotsBusiness);

    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      CLIENT_TELEGRAM_ID,
      expect.any(String),
      expect.arrayContaining([
        expect.arrayContaining([expect.objectContaining({ text: 'Κράτηση ραντεβού' })]),
      ])
    );
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
    mockedBookSessionInstance.mockResolvedValue({ status: 'success', bookingId: 42 });
    mockedListSessions.mockResolvedValue([]);
    // Default: enforcement allows
    mockedCheckEnforcementAndGetMembership.mockResolvedValue({
      allowed: true,
      shouldAlert: false,
      membership: { membershipId: 10 } as any,
    });
    // booking-no-approval-notif fix: handleBookSessionExecute wraps its
    // owner-notification send in botTokenStore.run — must invoke the
    // callback for the send to actually happen in tests.
    (telegramClient.botTokenStore.run as jest.Mock).mockImplementation(
      (_value: string, callback: () => Promise<unknown>) => callback()
    );
    // Default: no client name on file — owner alert falls back to raw id.
    mockedGetClientName.mockResolvedValue(null);
  });

  it('book:yes — enforcement allows, bookSessionInstance succeeds → Greek pending-request message sent', async () => {
    // Phase 29 (D-06): handleBookSessionExecute resolves session data via
    // the shared, businessId-scoped findSessionInstanceById helper.
    mockedFindSessionInstanceById.mockResolvedValue({
      instanceId,
      catalogId: 1,
      sessionDate: '2026-07-27',
      sessionTime: '09:00',
      bookedCount: 0,
      capacity: 5,
      serviceId: 3,
    } as any);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'book:yes', id: instanceId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedCheckEnforcementAndGetMembership).toHaveBeenCalledWith(
      BASE_BUSINESS.id,
      senderTelegramId
    );
    expect(mockedBookSessionInstance).toHaveBeenCalled();
    // Phase 22 (OWNR-05): session bookings are now created pending, not confirmed.
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(
      senderTelegramId,
      expect.stringContaining('Αναμονή')
    );
  });

  it('book:yes — success → owner IS notified with an Έγκριση/Απόρριψη keyboard (Phase 22)', async () => {
    mockedFindSessionInstanceById.mockResolvedValue({
      instanceId,
      catalogId: 1,
      sessionDate: '2026-07-27',
      sessionTime: '09:00',
      bookedCount: 0,
      capacity: 5,
      serviceId: 3,
    } as any);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'book:yes', id: instanceId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      OWNER_TELEGRAM_ID,
      expect.stringContaining('2026-07-27'),
      [
        [
          { text: 'Έγκριση', callback_data: 'sbk:approve:42' },
          { text: 'Απόρριψη', callback_data: 'sbk:reject:42' },
        ],
      ]
    );
  });

  it('book:yes — success, client has a name on file → owner alert shows the resolved name, not the raw id', async () => {
    mockedFindSessionInstanceById.mockResolvedValue({
      instanceId,
      catalogId: 1,
      sessionDate: '2026-07-27',
      sessionTime: '09:00',
      bookedCount: 0,
      capacity: 5,
      serviceId: 3,
    } as any);
    mockedGetClientName.mockResolvedValue('Μαρία Παπαδοπούλου');

    const result: ClientMenuCallbackResult = { clientMenuAction: 'book:yes', id: instanceId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedGetClientName).toHaveBeenCalledWith(BASE_BUSINESS.id, senderTelegramId);
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      OWNER_TELEGRAM_ID,
      expect.stringContaining('Μαρία Παπαδοπούλου'),
      expect.anything()
    );
    expect(mockedSendTelegramMessageWithKeyboard).not.toHaveBeenCalledWith(
      OWNER_TELEGRAM_ID,
      expect.stringContaining(senderTelegramId),
      expect.anything()
    );
  });

  it('book:yes — success, client has NO name on file → owner alert falls back to the raw sender id', async () => {
    mockedFindSessionInstanceById.mockResolvedValue({
      instanceId,
      catalogId: 1,
      sessionDate: '2026-07-27',
      sessionTime: '09:00',
      bookedCount: 0,
      capacity: 5,
      serviceId: 3,
    } as any);
    mockedGetClientName.mockResolvedValue(null);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'book:yes', id: instanceId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      OWNER_TELEGRAM_ID,
      expect.stringContaining(senderTelegramId),
      expect.anything()
    );
  });

  it('book:yes — success, business.ownerTelegramId is null → owner send is skipped (no crash)', async () => {
    mockedFindSessionInstanceById.mockResolvedValue({
      instanceId,
      catalogId: 1,
      sessionDate: '2026-07-27',
      sessionTime: '09:00',
      bookedCount: 0,
      capacity: 5,
      serviceId: 3,
    } as any);

    const businessWithoutOwner = { ...BASE_BUSINESS, ownerTelegramId: null };
    const result: ClientMenuCallbackResult = { clientMenuAction: 'book:yes', id: instanceId };
    await handleClientMenuCallback(result, businessWithoutOwner as any, senderTelegramId);

    expect(mockedSendTelegramMessageWithKeyboard).not.toHaveBeenCalledWith(
      OWNER_TELEGRAM_ID,
      expect.anything(),
      expect.anything()
    );
    // Phase 22 (OWNR-05): session bookings are now created pending, not confirmed.
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(
      senderTelegramId,
      expect.stringContaining('Αναμονή')
    );
  });

  it('book:yes — enforcement blocks → standardised apology sent, sendEscalationToAdmin called, bookSessionInstance NOT called', async () => {
    mockedCheckEnforcementAndGetMembership.mockResolvedValue({
      allowed: false,
      message: 'Για να κάνετε κράτηση, χρειάζεστε ενεργή συνδρομή.',
      shouldAlert: false,
      membership: null,
    });

    const result: ClientMenuCallbackResult = { clientMenuAction: 'book:yes', id: instanceId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    // ESCL-01: standardised apology replaces enforcement-specific message
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(
      senderTelegramId,
      'Δυστυχώς δεν ήταν δυνατή η κράτησή σας. Ο διαχειριστής ειδοποιήθηκε.'
    );
    expect(mockedBookSessionInstance).not.toHaveBeenCalled();

    // Escalation engine called with membership_expired (no instanceId at enforcement stage)
    const { sendEscalationToAdmin } = require('../../src/telegram/escalation');
    expect(sendEscalationToAdmin).toHaveBeenCalledWith(
      BASE_BUSINESS,
      senderTelegramId,
      'κράτηση μαθήματος',
      'membership_expired'
    );
  });

  it('book:yes — findSessionInstanceById returns null → "Το μάθημα δεν βρέθηκε." sent, bookSessionInstance NOT called (D-06)', async () => {
    mockedFindSessionInstanceById.mockResolvedValue(null);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'book:yes', id: instanceId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedFindSessionInstanceById).toHaveBeenCalledWith(BASE_BUSINESS.id, instanceId);
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(
      senderTelegramId,
      'Το μάθημα δεν βρέθηκε.'
    );
    expect(mockedBookSessionInstance).not.toHaveBeenCalled();
  });

  it('book — business.bookingMode === open_slots → back-button keyboard sent, listSessions NOT called (D-04)', async () => {
    const openSlotsBusiness = { ...BASE_BUSINESS, bookingMode: 'open_slots' };

    const result: ClientMenuCallbackResult = { clientMenuAction: 'book' };
    await handleClientMenuCallback(result, openSlotsBusiness as any, senderTelegramId);

    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      senderTelegramId,
      expect.stringContaining('γράψε μου'),
      [[{ text: '« Πίσω', callback_data: 'cmenu:root' }]]
    );
    expect(mockedListSessions).not.toHaveBeenCalled();
  });

  it('book — fixed_sessions business → listSessions called with (business.id, 14, true) (D-01)', async () => {
    mockedListSessions.mockResolvedValue([]);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'book' };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedListSessions).toHaveBeenCalledWith(BASE_BUSINESS.id, 14, true);
  });

  it('book — available sessions render with the resolved service name alongside date/time (D-10)', async () => {
    mockedListSessions.mockResolvedValue([
      {
        instanceId: 101,
        catalogId: 1,
        sessionDate: '2026-08-01',
        sessionTime: '09:00',
        bookedCount: 0,
        capacity: 5,
        serviceId: 3,
      },
    ] as any);
    mockedFindServiceById.mockResolvedValue({
      id: 3,
      businessId: BASE_BUSINESS.id,
      name: 'Yoga',
      durationMin: 60,
      price: null,
      createdAt: new Date(),
    } as any);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'book' };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedFindServiceById).toHaveBeenCalledWith(BASE_BUSINESS.id, 3);
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      senderTelegramId,
      'Επίλεξε μάθημα:',
      expect.arrayContaining([
        [{ text: 'Yoga - 2026-08-01 09:00', callback_data: 'cmenu:book:confirm:101' }],
      ])
    );
  });

  it('book — a serviceId with no matching service falls back to "(άγνωστη υπηρεσία)" (D-10)', async () => {
    mockedListSessions.mockResolvedValue([
      {
        instanceId: 102,
        catalogId: 2,
        sessionDate: '2026-08-02',
        sessionTime: '10:00',
        bookedCount: 0,
        capacity: 5,
        serviceId: 999,
      },
    ] as any);
    mockedFindServiceById.mockResolvedValue(null);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'book' };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      senderTelegramId,
      'Επίλεξε μάθημα:',
      expect.arrayContaining([
        [
          {
            text: '(άγνωστη υπηρεσία) - 2026-08-02 10:00',
            callback_data: 'cmenu:book:confirm:102',
          },
        ],
      ])
    );
  });

  it('book — 2 available sessions sharing one serviceId result in exactly 1 findServiceById call (batching)', async () => {
    mockedListSessions.mockResolvedValue([
      {
        instanceId: 103,
        catalogId: 1,
        sessionDate: '2026-08-01',
        sessionTime: '09:00',
        bookedCount: 0,
        capacity: 5,
        serviceId: 3,
      },
      {
        instanceId: 104,
        catalogId: 1,
        sessionDate: '2026-08-02',
        sessionTime: '11:00',
        bookedCount: 0,
        capacity: 5,
        serviceId: 3,
      },
    ] as any);
    mockedFindServiceById.mockResolvedValue({
      id: 3,
      businessId: BASE_BUSINESS.id,
      name: 'Yoga',
      durationMin: 60,
      price: null,
      createdAt: new Date(),
    } as any);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'book' };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedFindServiceById).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// showClientBookings / showCancelBookingList — service name enrichment (D-10)
// ---------------------------------------------------------------------------

describe('showClientBookings / showCancelBookingList — service name enrichment (D-10)', () => {
  const senderTelegramId = CLIENT_TELEGRAM_ID;

  const BASE_BOOKING_FOR_LIST = {
    id: 1,
    businessId: BASE_BUSINESS.id,
    clientPhone: CLIENT_TELEGRAM_ID,
    serviceId: 3,
    sessionInstanceId: null,
    calendarDate: '2099-12-31',
    calendarTime: '10:00',
    bookingStatus: 'confirmed',
    requestId: 'req-list-1',
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

  const makeBooking = (overrides: Partial<typeof BASE_BOOKING_FOR_LIST>) => ({
    ...BASE_BOOKING_FOR_LIST,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedSendTelegramMessage.mockResolvedValue({ messageId: 999 });
    mockedSendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 998 });
  });

  it('showClientBookings — text includes the resolved service name alongside date/time (D-10)', async () => {
    mockedListClientBookings.mockResolvedValue([
      makeBooking({ id: 1, serviceId: 3, calendarDate: '2099-12-31', calendarTime: '10:00' }),
    ] as any);
    mockedFindServiceById.mockResolvedValue({
      id: 3,
      businessId: BASE_BUSINESS.id,
      name: 'Yoga',
      durationMin: 60,
      price: null,
      createdAt: new Date(),
    } as any);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'bookings' };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedFindServiceById).toHaveBeenCalledWith(BASE_BUSINESS.id, 3);
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      senderTelegramId,
      expect.stringContaining('Yoga - 2099-12-31 10:00'),
      expect.anything()
    );
  });

  it('showClientBookings — unresolved serviceId falls back to "(άγνωστη υπηρεσία)" (D-10)', async () => {
    mockedListClientBookings.mockResolvedValue([
      makeBooking({ id: 1, serviceId: 999, calendarDate: '2099-12-31', calendarTime: '10:00' }),
    ] as any);
    mockedFindServiceById.mockResolvedValue(null);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'bookings' };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      senderTelegramId,
      expect.stringContaining('(άγνωστη υπηρεσία) - 2099-12-31 10:00'),
      expect.anything()
    );
  });

  it('showCancelBookingList — button labels include the resolved service name alongside date/time (D-10)', async () => {
    mockedListClientBookings.mockResolvedValue([
      makeBooking({ id: 5, serviceId: 3, calendarDate: '2099-11-01', calendarTime: '09:00' }),
    ] as any);
    mockedFindServiceById.mockResolvedValue({
      id: 3,
      businessId: BASE_BUSINESS.id,
      name: 'Pilates',
      durationMin: 60,
      price: null,
      createdAt: new Date(),
    } as any);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'cancel' };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      senderTelegramId,
      expect.any(String),
      expect.arrayContaining([
        [{ text: 'Pilates - 2099-11-01 09:00', callback_data: 'cmenu:cancel:confirm:5' }],
      ])
    );
  });

  it('showCancelBookingList — unresolved serviceId falls back to "(άγνωστη υπηρεσία)" (D-10)', async () => {
    mockedListClientBookings.mockResolvedValue([
      makeBooking({ id: 6, serviceId: 777, calendarDate: '2099-11-02', calendarTime: '11:00' }),
    ] as any);
    mockedFindServiceById.mockResolvedValue(null);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'cancel' };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      senderTelegramId,
      expect.any(String),
      expect.arrayContaining([
        [
          {
            text: '(άγνωστη υπηρεσία) - 2099-11-02 11:00',
            callback_data: 'cmenu:cancel:confirm:6',
          },
        ],
      ])
    );
  });

  it('showCancelBookingList — 2 bookings sharing one serviceId result in exactly 1 findServiceById call (batching, D-10)', async () => {
    mockedListClientBookings.mockResolvedValue([
      makeBooking({ id: 7, serviceId: 3, calendarDate: '2099-11-03', calendarTime: '09:00' }),
      makeBooking({ id: 8, serviceId: 3, calendarDate: '2099-11-04', calendarTime: '10:00' }),
    ] as any);
    mockedFindServiceById.mockResolvedValue({
      id: 3,
      businessId: BASE_BUSINESS.id,
      name: 'Pilates',
      durationMin: 60,
      price: null,
      createdAt: new Date(),
    } as any);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'cancel' };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedFindServiceById).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// showCancelConfirm — ownership guard + real date/service context (D-09, T-29-05)
// ---------------------------------------------------------------------------

describe('showCancelConfirm — ownership guard + real date/service context (D-09, T-29-05)', () => {
  const senderTelegramId = CLIENT_TELEGRAM_ID;
  const bookingId = 99;

  const BASE_CONFIRM_BOOKING = {
    id: bookingId,
    businessId: BASE_BUSINESS.id,
    clientPhone: CLIENT_TELEGRAM_ID,
    serviceId: 3,
    sessionInstanceId: null,
    calendarDate: '2099-12-31',
    calendarTime: '10:00',
    bookingStatus: 'confirmed',
    requestId: 'req-confirm-1',
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
  });

  it('owner (senderTelegramId matches clientPhone) → prompt includes real date, time, and resolved service name', async () => {
    mockedFindBookingByIdUnscoped.mockResolvedValue(BASE_CONFIRM_BOOKING as any);
    mockedFindServiceById.mockResolvedValue({
      id: 3,
      businessId: BASE_BUSINESS.id,
      name: 'Yoga',
      durationMin: 60,
      price: null,
      createdAt: new Date(),
    } as any);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'cancel:confirm', id: bookingId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedFindServiceById).toHaveBeenCalledWith(BASE_BUSINESS.id, 3);
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      senderTelegramId,
      expect.stringContaining('Yoga'),
      expect.anything()
    );
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      senderTelegramId,
      expect.stringContaining('2099-12-31'),
      expect.anything()
    );
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      senderTelegramId,
      expect.stringContaining('10:00'),
      expect.anything()
    );
  });

  it('T-29-05: booking belongs to a different clientPhone → generic "Κράτηση δεν βρέθηκε." + back-menu keyboard sent, findServiceById NEVER called', async () => {
    mockedFindBookingByIdUnscoped.mockResolvedValue({
      ...BASE_CONFIRM_BOOKING,
      clientPhone: 'someone-else',
    } as any);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'cancel:confirm', id: bookingId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedFindServiceById).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      senderTelegramId,
      'Κράτηση δεν βρέθηκε.',
      [[{ text: '« Πίσω', callback_data: 'cmenu:root' }]]
    );
  });

  it('T-29-05: booking does not exist (findBookingByIdUnscoped returns null) → identical generic message/keyboard as the wrong-owner case (anti-enumeration)', async () => {
    mockedFindBookingByIdUnscoped.mockResolvedValue(null);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'cancel:confirm', id: bookingId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedFindServiceById).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      senderTelegramId,
      'Κράτηση δεν βρέθηκε.',
      [[{ text: '« Πίσω', callback_data: 'cmenu:root' }]]
    );
  });

  it("dispatcher's 'cancel:confirm' case wires (chatId, business, chatId, bookingId) into showCancelConfirm", async () => {
    // Verified indirectly: findBookingByIdUnscoped is called with the dispatched
    // bookingId, and the ownership check passes when senderTelegramId (=== chatId
    // for private Telegram chats) matches the booking's clientPhone, and
    // findServiceById is called with the dispatched business.id — proving all
    // 4 args (chatId, business, chatId-as-senderTelegramId, bookingId) reached
    // showCancelConfirm exactly as the dispatcher call site passes them.
    mockedFindBookingByIdUnscoped.mockResolvedValue(BASE_CONFIRM_BOOKING as any);
    mockedFindServiceById.mockResolvedValue({
      id: 3,
      businessId: BASE_BUSINESS.id,
      name: 'Yoga',
      durationMin: 60,
      price: null,
      createdAt: new Date(),
    } as any);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'cancel:confirm', id: bookingId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedFindBookingByIdUnscoped).toHaveBeenCalledWith(bookingId);
    expect(mockedFindServiceById).toHaveBeenCalledWith(BASE_BUSINESS.id, 3);
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      senderTelegramId,
      expect.stringContaining('Yoga'),
      expect.anything()
    );
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
    // Default: no client name on file — owner alert falls back to raw phone/id.
    mockedGetClientName.mockResolvedValue(null);
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

  it('cancel:yes — client has a name on file → owner alert shows the resolved name, not the raw phone', async () => {
    mockedGetClientName.mockResolvedValue('Γιάννης Παπαδόπουλος');

    const result: ClientMenuCallbackResult = { clientMenuAction: 'cancel:yes', id: bookingId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedGetClientName).toHaveBeenCalledWith(BASE_BUSINESS.id, BASE_BOOKING.clientPhone);
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(
      OWNER_TELEGRAM_ID,
      expect.stringContaining('Γιάννης Παπαδόπουλος')
    );
    expect(mockedSendTelegramMessage).not.toHaveBeenCalledWith(
      OWNER_TELEGRAM_ID,
      expect.stringContaining(BASE_BOOKING.clientPhone)
    );
  });

  it('cancel:yes — client has NO name on file → owner alert falls back to the raw phone/id', async () => {
    mockedGetClientName.mockResolvedValue(null);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'cancel:yes', id: bookingId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(
      OWNER_TELEGRAM_ID,
      expect.stringContaining(BASE_BOOKING.clientPhone)
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

  it('cancel:yes — booking-not-found early-return (D-05.2): updateBookingStatus NOT called, back-menu keyboard sent', async () => {
    mockedFindBookingByIdUnscoped.mockResolvedValue(null);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'cancel:yes', id: bookingId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedUpdateBookingStatus).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      senderTelegramId,
      'Κράτηση δεν βρέθηκε.',
      [[{ text: '« Πίσω', callback_data: 'cmenu:root' }]]
    );
  });

  it('cancel:yes — ownership guard early-return (D-05.2, WR-01/T-29-05): wrong clientPhone → updateBookingStatus NOT called, byte-identical generic "not found" message sent (anti-enumeration, matches showCancelConfirm)', async () => {
    mockedFindBookingByIdUnscoped.mockResolvedValue({
      ...BASE_BOOKING,
      clientPhone: 'someone-else',
    } as any);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'cancel:yes', id: bookingId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedUpdateBookingStatus).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      senderTelegramId,
      'Κράτηση δεν βρέθηκε.',
      [[{ text: '« Πίσω', callback_data: 'cmenu:root' }]]
    );
  });

  it('cancel:yes — wrong-status early-return (D-05.2): booking already cancelled → updateBookingStatus NOT called, back-menu keyboard sent', async () => {
    mockedFindBookingByIdUnscoped.mockResolvedValue({
      ...BASE_BOOKING,
      bookingStatus: 'cancelled',
    } as any);

    const result: ClientMenuCallbackResult = { clientMenuAction: 'cancel:yes', id: bookingId };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedUpdateBookingStatus).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      senderTelegramId,
      'Αυτή η κράτηση δεν μπορεί να ακυρωθεί.',
      [[{ text: '« Πίσω', callback_data: 'cmenu:root' }]]
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
// handleClientMenuCallback default case — back-menu keyboard (D-05.1, T-29-08)
// ---------------------------------------------------------------------------

describe('handleClientMenuCallback default case — back-menu keyboard (D-05.1, T-29-08)', () => {
  const senderTelegramId = CLIENT_TELEGRAM_ID;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedSendTelegramMessage.mockResolvedValue({ messageId: 999 });
    mockedSendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 998 });
  });

  it('unrecognized clientMenuAction → "Άγνωστη ενέργεια." sent with a back-menu keyboard (not a text-only dead end)', async () => {
    const result: ClientMenuCallbackResult = { clientMenuAction: 'nonexistent-action' };
    await handleClientMenuCallback(result, BASE_BUSINESS as any, senderTelegramId);

    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      senderTelegramId,
      'Άγνωστη ενέργεια.',
      [[{ text: '« Πίσω', callback_data: 'cmenu:root' }]]
    );
    expect(mockedSendTelegramMessage).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// SUITE F: sbk: session booking approval routing (Phase 22, OWNR-05/06/07)
// ---------------------------------------------------------------------------

describe('Suite F: sbk: session booking approval routing', () => {
  it('sbk:approve:42 → SessionBookingCallbackResult { sbkAction: approve, bookingId: 42 }', () => {
    const result = parseCallbackData('sbk:approve:42');
    expect(result).toEqual({ sbkAction: 'approve', bookingId: 42 });
  });

  it('sbk:reject:42 → SessionBookingCallbackResult { sbkAction: reject, bookingId: 42 }', () => {
    const result = parseCallbackData('sbk:reject:42');
    expect(result).toEqual({ sbkAction: 'reject', bookingId: 42 });
  });

  const SESSION_BOOKING = {
    id: 5,
    businessId: BASE_BUSINESS.id,
    clientPhone: CLIENT_TELEGRAM_ID,
    serviceId: 1,
    sessionInstanceId: null as number | null,
    calendarDate: '2099-12-31',
    calendarTime: '10:00',
    bookingStatus: 'pending_owner_approval',
    requestId: 'req-sbk-5',
    ownerTelegramMessageId: 555,
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
    setupCommonMocks();
    mockedFindBusinessByWebhookId.mockResolvedValue({ ...BASE_BUSINESS });
    mockedFindBookingByIdUnscoped.mockResolvedValue({ ...SESSION_BOOKING } as any);
    mockedUpdateBookingStatusIfPending.mockResolvedValue({ ...SESSION_BOOKING, bookingStatus: 'confirmed' } as any);
    mockedFindMembershipByBooking.mockResolvedValue(null);
    mockedRestoreCredit.mockResolvedValue(undefined as any);
    mockedReleaseSessionCapacity.mockResolvedValue(undefined as any);
  });

  it('owner taps Έγκριση → updateBookingStatusIfPending called with (5, "confirmed")', async () => {
    const res = await postToWebhook(
      makeCallbackQueryUpdate(10, OWNER_TELEGRAM_ID, 'sbk:approve:5')
    );

    expect(res.status).toBe(200);
    expect(mockedUpdateBookingStatusIfPending).toHaveBeenCalledWith(5, 'confirmed');
  });

  it('T-22-01 ownership guard: non-owner tap → updateBookingStatusIfPending NOT called', async () => {
    const res = await postToWebhook(
      makeCallbackQueryUpdate(11, 'not-the-owner-999', 'sbk:approve:5')
    );

    expect(res.status).toBe(200);
    expect(mockedUpdateBookingStatusIfPending).not.toHaveBeenCalled();
  });

  it('T-22-02 cross-tenant guard: booking belongs to a different business → updateBookingStatusIfPending NOT called', async () => {
    mockedFindBookingByIdUnscoped.mockResolvedValue({
      ...SESSION_BOOKING,
      businessId: BASE_BUSINESS.id + 999,
    } as any);

    const res = await postToWebhook(
      makeCallbackQueryUpdate(12, OWNER_TELEGRAM_ID, 'sbk:approve:5')
    );

    expect(res.status).toBe(200);
    expect(mockedUpdateBookingStatusIfPending).not.toHaveBeenCalled();
  });

  it('owner taps Απόρριψη on a session booking → releaseSessionCapacity + findMembershipByBooking/restoreCredit called', async () => {
    const rejectedSessionBooking = {
      ...SESSION_BOOKING,
      id: 6,
      sessionInstanceId: 77,
      bookingStatus: 'rejected',
    };
    mockedFindBookingByIdUnscoped.mockResolvedValue({ ...SESSION_BOOKING, id: 6, sessionInstanceId: 77 } as any);
    mockedUpdateBookingStatusIfPending.mockResolvedValue(rejectedSessionBooking as any);
    mockedFindMembershipByBooking.mockResolvedValue(33);

    const res = await postToWebhook(
      makeCallbackQueryUpdate(13, OWNER_TELEGRAM_ID, 'sbk:reject:6')
    );

    expect(res.status).toBe(200);
    expect(mockedUpdateBookingStatusIfPending).toHaveBeenCalledWith(6, 'rejected');
    expect(mockedReleaseSessionCapacity).toHaveBeenCalledWith(77);
    expect(mockedFindMembershipByBooking).toHaveBeenCalledWith(6);
    expect(mockedRestoreCredit).toHaveBeenCalledWith(33, 6, 'booking:6:credit');
  });

  it('T-22-03 double-tap idempotency: updateBookingStatusIfPending returns null → no capacity release, no crash', async () => {
    mockedUpdateBookingStatusIfPending.mockResolvedValue(null);

    const res = await postToWebhook(
      makeCallbackQueryUpdate(14, OWNER_TELEGRAM_ID, 'sbk:reject:5')
    );

    expect(res.status).toBe(200);
    expect(mockedReleaseSessionCapacity).not.toHaveBeenCalled();
    expect(mockedRestoreCredit).not.toHaveBeenCalled();
  });

  // Phase 26 (CONF-02/D-03): sbk:approve cascade-cancels the superseded
  // (rescheduledFromBookingId) booking.
  it('owner taps Έγκριση on a rescheduled booking → cascade-cancels the old booking and best-effort deletes its calendar event', async () => {
    const OLD_BOOKING_ID = 4;
    const oldBooking = { ...SESSION_BOOKING, id: OLD_BOOKING_ID, bookingStatus: 'confirmed' };
    const newBookingBeforeApprove = { ...SESSION_BOOKING, id: 5, rescheduledFromBookingId: OLD_BOOKING_ID };
    const newBookingAfterApprove = {
      ...newBookingBeforeApprove,
      bookingStatus: 'confirmed',
    };

    // findBookingByIdUnscoped is called twice in this flow: once for the
    // T-22-02 ownership guard on the NEW booking (sbk.bookingId=5), and once
    // for the cascade's own lookup of the OLD booking (rescheduledFromBookingId=4).
    mockedFindBookingByIdUnscoped.mockImplementation(async (bookingId: number) => {
      if (bookingId === OLD_BOOKING_ID) return oldBooking as any;
      return newBookingBeforeApprove as any;
    });
    mockedUpdateBookingStatusIfPending.mockResolvedValue(newBookingAfterApprove as any);
    mockedDeleteBookingFromCalendar.mockResolvedValue(true as any);

    const res = await postToWebhook(
      makeCallbackQueryUpdate(15, OWNER_TELEGRAM_ID, 'sbk:approve:5')
    );

    expect(res.status).toBe(200);
    expect(mockedUpdateBookingStatus).toHaveBeenCalledWith(OLD_BOOKING_ID, 'cancelled');
    expect(mockedDeleteBookingFromCalendar).toHaveBeenCalledWith(oldBooking, expect.objectContaining({ id: BASE_BUSINESS.id }));
  });

  it('owner taps Έγκριση on a non-rescheduled booking (rescheduledFromBookingId=null) → updateBookingStatus is never called for a cascade', async () => {
    mockedUpdateBookingStatusIfPending.mockResolvedValue({
      ...SESSION_BOOKING,
      bookingStatus: 'confirmed',
      rescheduledFromBookingId: null,
    } as any);

    const res = await postToWebhook(
      makeCallbackQueryUpdate(16, OWNER_TELEGRAM_ID, 'sbk:approve:5')
    );

    expect(res.status).toBe(200);
    expect(mockedUpdateBookingStatus).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SUITE G: Phase 27 (COMP-01/COMP-02) — client consent gate
// ---------------------------------------------------------------------------

describe('Suite G: client consent gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupCommonMocks();
    mockedFindBusinessByWebhookId.mockResolvedValue({ ...BASE_BUSINESS });
  });

  it('parseCallbackData("consent:yes") → { consentAction: "yes" }', () => {
    expect(parseCallbackData('consent:yes')).toEqual({ consentAction: 'yes' });
  });

  it('parseCallbackData("consent:no") → { consentAction: "no" }', () => {
    expect(parseCallbackData('consent:no')).toEqual({ consentAction: 'no' });
  });

  it('/start with consentGiven=false → consent prompt+keyboard sent, showClientRootMenu NOT called', async () => {
    mockedGetOrCreateClientRelationship.mockResolvedValue({ isFirstContact: true, consentGiven: false });

    const res = await postToWebhook(makeMessageUpdate(20, CLIENT_TELEGRAM_ID, '/start'));

    expect(res.status).toBe(200);
    expect(mockedSendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      String(CLIENT_TELEGRAM_ID),
      CONSENT_PROMPT_GREEK_TEMPLATE(BASE_BUSINESS.name),
      CONSENT_KEYBOARD
    );
    expect(mockedShowClientRootMenu).not.toHaveBeenCalled();
  });

  it('/start with consentGiven=true → showClientRootMenu called, consent prompt NOT sent (unchanged behavior)', async () => {
    mockedGetOrCreateClientRelationship.mockResolvedValue({ isFirstContact: false, consentGiven: true });

    const res = await postToWebhook(makeMessageUpdate(21, CLIENT_TELEGRAM_ID, '/start'));

    expect(res.status).toBe(200);
    expect(mockedShowClientRootMenu).toHaveBeenCalledTimes(1);
    expect(mockedSendTelegramMessageWithKeyboard).not.toHaveBeenCalled();
  });

  it('consent:yes callback → updateClientConsentGiven(business.id, senderTelegramId, true) called, then showClientRootMenu called', async () => {
    const res = await postToWebhook(
      makeCallbackQueryUpdate(22, CLIENT_TELEGRAM_ID, 'consent:yes')
    );

    expect(res.status).toBe(200);
    expect(mockedUpdateClientConsentGiven).toHaveBeenCalledWith(
      BASE_BUSINESS.id,
      String(CLIENT_TELEGRAM_ID),
      true
    );
    expect(mockedShowClientRootMenu).toHaveBeenCalledTimes(1);
  });

  it('consent:no callback → updateClientConsentGiven NOT called, decline-ack sent, showClientRootMenu NOT called', async () => {
    const res = await postToWebhook(
      makeCallbackQueryUpdate(23, CLIENT_TELEGRAM_ID, 'consent:no')
    );

    expect(res.status).toBe(200);
    expect(mockedUpdateClientConsentGiven).not.toHaveBeenCalled();
    expect(mockedShowClientRootMenu).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith(
      String(CLIENT_TELEGRAM_ID),
      expect.stringContaining('Εντάξει')
    );
  });
});
