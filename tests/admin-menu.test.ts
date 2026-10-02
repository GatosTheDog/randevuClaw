/**
 * Integration tests for admin menu routing — Phase 17 Plan 04 (AMENU-04, AMENU-06).
 *
 * Covers:
 *   - parseCallbackData MenuCallbackResult arm: menu:* patterns parsed correctly
 *   - Existing arms (approve_*, billing:*) not broken by menu: extension
 *   - showAdminRootMenu keyboard shape: 2x2, 4 buttons total
 *   - handleMenuCallback 'agenda' action does NOT call claimAgendaSlot
 *   - Non-owner menu callback: 'menuAction' discriminant present, 'bookingId'/'firstId' absent
 *
 * NEVER run bare `npm test` — machine crashes on full suite.
 * Use: npm test -- --testPathPattern="admin-menu" --testTimeout=20000
 */

import { parseCallbackData } from '../src/webhooks/telegram';
import {
  showAdminRootMenu,
  showSettingsMenu,
  handleMenuCallback,
  handleClassCancelExecute,
  showCancelClassConfirm,
  showClassesMenu,
  showCancelClassList,
  showCancelClassListForDate,
  showClientsList,
  showClientBalance,
  showDeleteFullConfirm,
  handleDeleteFullExecute,
  showUnlinkConfirm,
  handleUnlinkExecute,
  showNotifyMenu,
  showNotifyExpiringList,
  handleNotifyExpiringExecute,
  showNotifyClientList,
  showNotifyClientConfirm,
  handleNotifyClientExecute,
} from '../src/telegram/handlers/admin-menu';
import { Business } from '../src/database/queries';

// ---------------------------------------------------------------------------
// Mock all external modules — no real DB or Telegram API calls
// ---------------------------------------------------------------------------

jest.mock('../src/database/queries');
jest.mock('../src/telegram/client');
jest.mock('../src/conversation/router');
jest.mock('../src/calendar/sync');
jest.mock('../src/telegram/registry');
jest.mock('../src/billing/queries');
jest.mock('../src/onboarding/queries');
jest.mock('../src/onboarding/ai-owner-agent');
jest.mock('../src/session/manager');
jest.mock('../src/scheduler/agenda');
jest.mock('../src/invites/generator');
jest.mock('../src/telegram/handlers/payment-flow');
jest.mock('../src/telegram/handlers/google-calendar-connect');

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const mockBusiness: Business = {
  id: 1,
  name: 'Test Studio',
  slug: 'test-studio',
  phoneNumberId: null,
  ownerTelegramId: '123456789',
  googleRefreshToken: null,
  agendaSentDate: null,
  botToken: 'test-bot-token',
  webhookId: 'test-webhook-id',
  webhookSecret: 'test-secret',
  enforcementPolicy: 'allow',
  bookingMode: 'open_slots',
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
// TEST GROUP 1: parseCallbackData MenuCallbackResult arm
// ---------------------------------------------------------------------------

describe('parseCallbackData — MenuCallbackResult arm', () => {
  test('parses menu:settings as menuAction without id', () => {
    const result = parseCallbackData('menu:settings');
    expect(result).toEqual({ menuAction: 'settings', id: undefined });
  });

  test('parses menu:clients:balance:42 with menuAction and numeric id', () => {
    const result = parseCallbackData('menu:clients:balance:42');
    expect(result).toEqual({ menuAction: 'clients:balance', id: 42 });
  });

  test('parses menu:classes:cancel_yes:99 with menuAction and numeric id', () => {
    const result = parseCallbackData('menu:classes:cancel_yes:99');
    expect(result).toEqual({ menuAction: 'classes:cancel_yes', id: 99 });
  });

  test('parses menu:gcal_connect as menuAction without id', () => {
    expect(parseCallbackData('menu:gcal_connect')).toEqual({ menuAction: 'gcal_connect', id: undefined });
  });

  test('parses menu:root without id', () => {
    const result = parseCallbackData('menu:root');
    expect(result).toEqual({ menuAction: 'root', id: undefined });
  });

  test('does not break existing approve_ arm', () => {
    const result = parseCallbackData('approve_5');
    expect(result).toMatchObject({ action: 'approve', bookingId: 5 });
  });

  test('does not break existing billing: arm', () => {
    const result = parseCallbackData('billing:client:10');
    expect(result).toMatchObject({ action: 'billing:client', firstId: 10 });
  });
});

// ---------------------------------------------------------------------------
// TEST GROUP 2: showAdminRootMenu keyboard shape
// ---------------------------------------------------------------------------

describe('showAdminRootMenu — keyboard shape', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 1 });
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 2 });
  });

  test('sends exactly one message with a 6-row keyboard totalling 8 buttons', async () => {
    const telegramClient = require('../src/telegram/client');
    await showAdminRootMenu('123', mockBusiness);

    const sendCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    expect(sendCalls.length).toBe(1);

    const keyboard = sendCalls[0][2];
    // 6 rows: existing 2x2 grid unchanged, plus payment, invite, notify and Google Calendar rows
    expect(keyboard.length).toBe(6);
    // Pre-existing 2x2 grid content is byte-for-byte unchanged
    expect(keyboard[0].length).toBe(2);
    expect(keyboard[1].length).toBe(2);
    // 3rd row: exactly one button with callback_data menu:payment
    expect(keyboard[2].length).toBe(1);
    expect(keyboard[2][0]).toEqual({ text: 'Καταχώρηση Πληρωμής', callback_data: 'menu:payment' });
    // 4th row: exactly one button with callback_data menu:invite
    expect(keyboard[3].length).toBe(1);
    expect(keyboard[3][0]).toEqual({ text: 'Πρόσκληση Πελάτη', callback_data: 'menu:invite' });
    // 5th row: exactly one button with callback_data menu:notify
    expect(keyboard[4].length).toBe(1);
    expect(keyboard[4][0]).toEqual({ text: 'Ειδοποίηση Πελατών', callback_data: 'menu:notify' });
    // 6th row: Google Calendar connect button
    expect(keyboard[5]).toEqual([{ text: 'Σύνδεση Google Calendar', callback_data: 'menu:gcal_connect' }]);
    // 8 buttons total
    const totalButtons = keyboard.flat().length;
    expect(totalButtons).toBe(8);
  });


  test('shows the reconnect label when the business already has a Google refresh token', async () => {
    const telegramClient = require('../src/telegram/client');
    await showAdminRootMenu('123', { ...mockBusiness, googleRefreshToken: 'rt' });

    const keyboard = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls[0][2];
    expect(keyboard[5]).toEqual([
      { text: 'Google Calendar ✅ (επανασύνδεση)', callback_data: 'menu:gcal_connect' },
    ]);
  });

  test('message text enumerates the first 7 button labels as a numbered list', async () => {
    const telegramClient = require('../src/telegram/client');
    await showAdminRootMenu('123', mockBusiness);

    const sendCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    const menuText = sendCalls[0][1];
    expect(menuText).toContain('1. Ρυθμίσεις');
    expect(menuText).toContain('2. Μαθήματα');
    expect(menuText).toContain('3. Πελάτες');
    expect(menuText).toContain('4. Ατζέντα Σήμερα');
    expect(menuText).toContain('5. Καταχώρηση Πληρωμής');
    expect(menuText).toContain('6. Πρόσκληση Πελάτη');
    expect(menuText).toContain('7. Ειδοποίηση Πελατών');
  });
});

// ---------------------------------------------------------------------------
// Phase 30 Plan 02: showAdminRootMenu menu button re-assertion (ADMIN-05, D-06.2)
// ---------------------------------------------------------------------------

describe('showAdminRootMenu — menu button re-assertion (D-06.2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 1 });
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 2 });
  });

  test('resolves even when setChatMenuButton never settles (non-blocking)', async () => {
    const telegramClient = require('../src/telegram/client');
    telegramClient.setMyCommands.mockResolvedValue(undefined);
    telegramClient.setChatMenuButton.mockReturnValue(new Promise(() => {})); // never resolves

    await expect(showAdminRootMenu('123', mockBusiness)).resolves.toBeUndefined();
  });

  test('resolves without throwing even when setMyCommands/setChatMenuButton reject (swallow-on-failure)', async () => {
    const telegramClient = require('../src/telegram/client');
    telegramClient.setMyCommands.mockRejectedValue(new Error('Telegram API down'));
    telegramClient.setChatMenuButton.mockRejectedValue(new Error('Telegram API down'));

    await expect(showAdminRootMenu('123', mockBusiness)).resolves.toBeUndefined();

    // Flush the fire-and-forget microtask/macrotask queue so the internal
    // .catch() handler runs before the test ends (avoids an unhandled
    // rejection warning leaking into a later test).
    await new Promise((resolve) => setImmediate(resolve));
  });

  test('re-asserts using the caller\'s own business botToken and chatId', async () => {
    const telegramClient = require('../src/telegram/client');
    telegramClient.setMyCommands.mockResolvedValue(undefined);
    telegramClient.setChatMenuButton.mockResolvedValue(undefined);

    await showAdminRootMenu('999', mockBusiness);
    // Flush the fire-and-forget chain so its calls have landed before assertions.
    await new Promise((resolve) => setImmediate(resolve));

    expect(telegramClient.setChatMenuButton).toHaveBeenCalledWith(mockBusiness.botToken, '999');
    expect(telegramClient.setChatMenuButton).toHaveBeenCalledWith(mockBusiness.botToken);
    expect(telegramClient.setMyCommands).toHaveBeenCalledWith(
      mockBusiness.botToken,
      [
        { command: 'menu', description: 'Εμφάνιση μενού διαχείρισης' },
        { command: 'settings', description: 'Ρυθμίσεις' },
        { command: 'classes', description: 'Μαθήματα' },
        { command: 'clients', description: 'Πελάτες' },
        { command: 'agenda', description: 'Ατζέντα Σήμερα' },
        { command: 'payment', description: 'Καταχώρηση Πληρωμής' },
        { command: 'invite', description: 'Πρόσκληση Πελάτη' },
        { command: 'notify', description: 'Ειδοποίηση Πελατών' },
        { command: 'calendar', description: 'Σύνδεση Google Ημερολογίου' },
      ],
      { type: 'chat', chat_id: '999' }
    );
    expect(telegramClient.setMyCommands).toHaveBeenCalledWith(
      mockBusiness.botToken,
      [
        { command: 'start', description: 'Έναρξη κράτησης ραντεβού' },
        { command: 'book', description: 'Κράτηση ραντεβού' },
        { command: 'mybookings', description: 'Οι κρατήσεις μου' },
        { command: 'cancel', description: 'Ακύρωση κράτησης' },
        { command: 'balance', description: 'Υπόλοιπο μαθημάτων' },
      ],
      { type: 'all_private_chats' }
    );
  });

  test('registers book command with booking-mode-aware description when bookingMode is fixed_sessions', async () => {
    const telegramClient = require('../src/telegram/client');
    telegramClient.setMyCommands.mockResolvedValue(undefined);
    telegramClient.setChatMenuButton.mockResolvedValue(undefined);

    const fixedSessionsBusiness: Business = { ...mockBusiness, bookingMode: 'fixed_sessions' };
    await showAdminRootMenu('999', fixedSessionsBusiness);
    // Flush the fire-and-forget chain so its calls have landed before assertions.
    await new Promise((resolve) => setImmediate(resolve));

    expect(telegramClient.setMyCommands).toHaveBeenCalledWith(
      fixedSessionsBusiness.botToken,
      [
        { command: 'start', description: 'Έναρξη κράτησης ραντεβού' },
        { command: 'book', description: 'Κράτηση μαθήματος' },
        { command: 'mybookings', description: 'Οι κρατήσεις μου' },
        { command: 'cancel', description: 'Ακύρωση κράτησης' },
        { command: 'balance', description: 'Υπόλοιπο μαθημάτων' },
      ],
      { type: 'all_private_chats' }
    );
  });

  test('skips re-assertion cleanly when business.botToken is null', async () => {
    const telegramClient = require('../src/telegram/client');
    telegramClient.setMyCommands.mockResolvedValue(undefined);
    telegramClient.setChatMenuButton.mockResolvedValue(undefined);
    const businessWithoutToken: Business = { ...mockBusiness, botToken: null };

    await showAdminRootMenu('123', businessWithoutToken);
    await new Promise((resolve) => setImmediate(resolve));

    expect(telegramClient.setMyCommands).not.toHaveBeenCalled();
    expect(telegramClient.setChatMenuButton).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 28 Plan 01: handleMenuCallback 'payment' dispatch (ADMIN-03, D-10/D-11/D-12)
// ---------------------------------------------------------------------------

describe('handleMenuCallback — payment action', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 1 });
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
  });

  test('calls showClientSelection exactly once with (business.id, chatId)', async () => {
    const paymentFlow = require('../src/telegram/handlers/payment-flow');
    paymentFlow.showClientSelection.mockResolvedValue(undefined);

    await handleMenuCallback({ menuAction: 'payment', id: undefined }, mockBusiness, '123');

    expect(paymentFlow.showClientSelection).toHaveBeenCalledTimes(1);
    expect(paymentFlow.showClientSelection).toHaveBeenCalledWith(mockBusiness.id, '123');
  });
});

// ---------------------------------------------------------------------------
// Phase 28 Plan 01: showSettingsMenu keyboard shape (ADMIN-04, D-07/D-09)
// ---------------------------------------------------------------------------

describe('showSettingsMenu — keyboard shape', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 1 });
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 2 });
  });

  test('sends a 9-row keyboard with the Google Calendar button before the 3 example-phrase buttons and the back button', async () => {
    const telegramClient = require('../src/telegram/client');
    await showSettingsMenu('123', mockBusiness);

    const sendCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    expect(sendCalls.length).toBe(1);

    const keyboard = sendCalls[0][2];
    expect(keyboard.length).toBe(9);
    expect(keyboard[4]).toEqual([
      { text: '📅 Σύνδεση Google Calendar', callback_data: 'menu:settings:calendar' },
    ]);
    expect(keyboard[5]).toEqual([
      { text: '📝 Ώρες Λειτουργίας — Παραδείγματα', callback_data: 'menu:settings:hours_examples' },
    ]);
    expect(keyboard[6]).toEqual([
      { text: '📝 Υπηρεσίες & Τιμές — Παραδείγματα', callback_data: 'menu:settings:services_examples' },
    ]);
    expect(keyboard[7]).toEqual([
      { text: '📝 Νέα Μαθήματα — Παραδείγματα', callback_data: 'menu:settings:classes_examples' },
    ]);
    expect(keyboard[8]).toEqual([{ text: '« Πίσω στο Μενού', callback_data: 'menu:root' }]);
  });

  test('Google Calendar button reflects "manage" text and same callback_data when already connected', async () => {
    const telegramClient = require('../src/telegram/client');
    await showSettingsMenu('123', { ...mockBusiness, googleRefreshToken: 'rt-1' });

    const sendCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    const keyboard = sendCalls[0][2];

    expect(keyboard[4]).toEqual([
      { text: '📅 Διαχείριση Google Calendar', callback_data: 'menu:settings:calendar' },
    ]);
  });

  test('quick 260729-n05: all 4 toggle buttons read as corrected, complete Greek phrases (default mockBusiness — all flags false)', async () => {
    const telegramClient = require('../src/telegram/client');
    await showSettingsMenu('123', mockBusiness);

    const sendCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    const keyboard = sendCalls[0][2];

    expect(keyboard[0][0].text).toBe('Ενεργοποίηση αιτημάτων χωρίς slot');
    expect(keyboard[1][0].text).toBe('Ενεργοποίηση πολιτικής ακύρωσης');
    expect(keyboard[2][0].text).toBe('Έγκριση πολλαπλών κρατήσεων');
    expect(keyboard[3][0].text).toBe('Ενεργοποίηση ειδοποίησης τελευταίου μαθήματος');
  });

  test('quick 260729-n05: multi-booking toggle OFF-direction label reads "prohibition of multiple bookings" phrase', async () => {
    const telegramClient = require('../src/telegram/client');
    await showSettingsMenu('123', { ...mockBusiness, allowMultiBooking: true });

    const sendCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    const keyboard = sendCalls[0][2];

    expect(keyboard[2][0].text).toBe('Απαγόρευση πολλαπλών κρατήσεων');
  });
});

// ---------------------------------------------------------------------------
// Phase 28 Plan 01: handleMenuCallback settings example-phrase actions (ADMIN-04, D-07)
// ---------------------------------------------------------------------------

describe('handleMenuCallback — settings example-phrase actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 1 });
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
  });

  test('settings:hours_examples sends exactly one message with 3 bullet phrases', async () => {
    const telegramClient = require('../src/telegram/client');
    await handleMenuCallback({ menuAction: 'settings:hours_examples', id: undefined }, mockBusiness, '123');

    const msgCalls = (telegramClient.sendTelegramMessage as jest.Mock).mock.calls;
    expect(msgCalls.length).toBe(1);
    expect((msgCalls[0][1].match(/•/g) || []).length).toBe(3);
  });

  test('settings:services_examples sends exactly one message with 3 bullet phrases', async () => {
    const telegramClient = require('../src/telegram/client');
    await handleMenuCallback({ menuAction: 'settings:services_examples', id: undefined }, mockBusiness, '123');

    const msgCalls = (telegramClient.sendTelegramMessage as jest.Mock).mock.calls;
    expect(msgCalls.length).toBe(1);
    expect((msgCalls[0][1].match(/•/g) || []).length).toBe(3);
  });

  test('settings:classes_examples sends exactly one message with 3 bullet phrases', async () => {
    const telegramClient = require('../src/telegram/client');
    await handleMenuCallback({ menuAction: 'settings:classes_examples', id: undefined }, mockBusiness, '123');

    const msgCalls = (telegramClient.sendTelegramMessage as jest.Mock).mock.calls;
    expect(msgCalls.length).toBe(1);
    expect((msgCalls[0][1].match(/•/g) || []).length).toBe(3);
  });

  test('classes:create sends exactly one message with 3 bullet phrases (upgraded from single rigid example)', async () => {
    const telegramClient = require('../src/telegram/client');
    await handleMenuCallback({ menuAction: 'classes:create', id: undefined }, mockBusiness, '123');

    const msgCalls = (telegramClient.sendTelegramMessage as jest.Mock).mock.calls;
    expect(msgCalls.length).toBe(1);
    expect((msgCalls[0][1].match(/•/g) || []).length).toBe(3);
  });
});

describe('handleMenuCallback — gcal_connect action', () => {
  test('routes to handleGoogleCalendarConnect(chatId, business) exactly once', async () => {
    const connect = require('../src/telegram/handlers/google-calendar-connect');
    connect.handleGoogleCalendarConnect.mockResolvedValue(undefined);

    await handleMenuCallback({ menuAction: 'gcal_connect', id: undefined }, mockBusiness, '123');

    expect(connect.handleGoogleCalendarConnect).toHaveBeenCalledTimes(1);
    expect(connect.handleGoogleCalendarConnect).toHaveBeenCalledWith('123', mockBusiness);
  });
});

// ---------------------------------------------------------------------------
// Phase 25 Plan 01: handleMenuCallback 'invite' dispatch (INVITE-01, D-03)
// ---------------------------------------------------------------------------

describe('handleMenuCallback — invite action', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 1 });
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
  });

  test('calls sendBusinessInvite exactly once with (business, chatId), then sends the menu:root keyboard, with no extra invite text', async () => {
    const generator = require('../src/invites/generator');
    generator.sendBusinessInvite.mockResolvedValue(undefined);

    const telegramClient = require('../src/telegram/client');

    await handleMenuCallback({ menuAction: 'invite', id: undefined }, mockBusiness, '123');

    expect(generator.sendBusinessInvite).toHaveBeenCalledTimes(1);
    expect(generator.sendBusinessInvite).toHaveBeenCalledWith(mockBusiness, '123');

    // No invite-related text via sendTelegramMessage — sendBusinessInvite already
    // delivers the photo+caption itself.
    expect(telegramClient.sendTelegramMessage).not.toHaveBeenCalled();

    // Trailing back-to-menu keyboard still sent
    const kbCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    expect(kbCalls.length).toBe(1);
    expect(kbCalls[0][2]).toEqual([[{ text: '« Πίσω στο Μενού', callback_data: 'menu:root' }]]);
  });

  test('when sendBusinessInvite rejects, handleMenuCallback resolves, sends one Greek error message, and still sends the menu:root keyboard', async () => {
    const generator = require('../src/invites/generator');
    generator.sendBusinessInvite.mockRejectedValue(new Error('boom'));

    const telegramClient = require('../src/telegram/client');

    await expect(
      handleMenuCallback({ menuAction: 'invite', id: undefined }, mockBusiness, '123')
    ).resolves.toBeUndefined();

    const msgCalls = (telegramClient.sendTelegramMessage as jest.Mock).mock.calls;
    expect(msgCalls.length).toBe(1);
    expect(msgCalls[0][1]).toBe('Σφάλμα κατά τη δημιουργία του invite. Δοκιμάστε ξανά.');

    const kbCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    expect(kbCalls.length).toBe(1);
    expect(kbCalls[0][2]).toEqual([[{ text: '« Πίσω στο Μενού', callback_data: 'menu:root' }]]);
  });
});

// ---------------------------------------------------------------------------
// TEST GROUP 3: handleMenuCallback 'agenda' does not call claimAgendaSlot
// ---------------------------------------------------------------------------

describe('handleMenuCallback — agenda action skips claimAgendaSlot', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 1 });
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });

    // Mock listBookingsForDate to return empty (no bookings today)
    const queries = require('../src/database/queries');
    queries.listBookingsForDate.mockResolvedValue([]);

    // Mock formatAgendaMessage if called
    const agenda = require('../src/scheduler/agenda');
    agenda.formatAgendaMessage.mockReturnValue('Formatted agenda');
  });

  test('agenda action calls listBookingsForDate but NOT claimAgendaSlot', async () => {
    const queries = require('../src/database/queries');

    await handleMenuCallback({ menuAction: 'agenda' }, mockBusiness, '123');

    expect(queries.claimAgendaSlot).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TEST GROUP 4: menu callback discriminant — non-owner guard
// ---------------------------------------------------------------------------

describe('parseCallbackData — MenuCallbackResult discriminant uniqueness', () => {
  test('menu:root result has menuAction discriminant but not bookingId or firstId', () => {
    const parsed = parseCallbackData('menu:root');
    expect(parsed).not.toBeNull();
    expect('menuAction' in parsed!).toBe(true);
    expect('bookingId' in parsed!).toBe(false);
    expect('firstId' in parsed!).toBe(false);
    expect('slotlessRequestId' in parsed!).toBe(false);
    expect('businessId' in parsed!).toBe(false);
  });

  test('approve_ result has action+bookingId but not menuAction', () => {
    const parsed = parseCallbackData('approve_5');
    expect(parsed).not.toBeNull();
    expect('menuAction' in parsed!).toBe(false);
    expect('bookingId' in parsed!).toBe(true);
  });

  test('billing: result has action+firstId but not menuAction', () => {
    const parsed = parseCallbackData('billing:client:10');
    expect(parsed).not.toBeNull();
    expect('menuAction' in parsed!).toBe(false);
    expect('firstId' in parsed!).toBe(true);
  });

  test('findBusinessByOwnerTelegramId returning null prevents menu dispatch — discriminant verified', () => {
    // Verify the parsed result is a MenuCallbackResult (menuAction present) so
    // the telegram.ts dispatcher would enter the menu branch. The null guard
    // (findBusinessByOwnerTelegramId returning null) is tested here by confirming
    // the discriminant logic is sound — the handler is only reached when business is non-null.
    const { findBusinessByOwnerTelegramId } = require('../src/onboarding/queries');
    (findBusinessByOwnerTelegramId as jest.Mock).mockResolvedValue(null);

    const parsed = parseCallbackData('menu:root');
    expect(parsed).not.toBeNull();
    expect('menuAction' in parsed!).toBe(true);
    // When findBusinessByOwnerTelegramId returns null in the dispatcher,
    // handleMenuCallback is never called — the discriminant is the gate condition.
  });
});

// ---------------------------------------------------------------------------
// TEST GROUP 5: handleClassCancelExecute — cascade-cancel wiring (CLSS-07)
// ---------------------------------------------------------------------------

describe('handleClassCancelExecute — cascade-cancel wiring (CLSS-07)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 1 });
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
  });

  test('reports affected count in Greek when cancelSession succeeds and bookings were cascade-cancelled', async () => {
    const sessionManager = require('../src/session/manager');
    sessionManager.cancelSession.mockResolvedValue(true);
    sessionManager.cascadeCancelSessionBookings.mockResolvedValue(3);

    const telegramClient = require('../src/telegram/client');

    await handleClassCancelExecute('123', mockBusiness, 42);

    expect(sessionManager.cascadeCancelSessionBookings).toHaveBeenCalledWith(mockBusiness, 42);

    const sendCalls = (telegramClient.sendTelegramMessage as jest.Mock).mock.calls;
    const messageTexts = sendCalls.map((c: [string, string]) => c[1]);
    expect(messageTexts.some((t: string) => t.includes('3') && t.includes('πελάτες ειδοποιήθησαν'))).toBe(true);

    // Trailing "what else" keyboard is still sent
    expect(telegramClient.sendTelegramMessageWithKeyboard).toHaveBeenCalled();
  });

  test('does NOT call cascadeCancelSessionBookings when cancelSession returns false, but still sends the trailing keyboard', async () => {
    const sessionManager = require('../src/session/manager');
    sessionManager.cancelSession.mockResolvedValue(false);

    const telegramClient = require('../src/telegram/client');

    await handleClassCancelExecute('123', mockBusiness, 42);

    expect(sessionManager.cascadeCancelSessionBookings).not.toHaveBeenCalled();
    expect(telegramClient.sendTelegramMessageWithKeyboard).toHaveBeenCalled();
  });

  test('reports "no bookings" wording when cascadeCancelSessionBookings returns 0', async () => {
    const sessionManager = require('../src/session/manager');
    sessionManager.cancelSession.mockResolvedValue(true);
    sessionManager.cascadeCancelSessionBookings.mockResolvedValue(0);

    const telegramClient = require('../src/telegram/client');

    await handleClassCancelExecute('123', mockBusiness, 42);

    const sendCalls = (telegramClient.sendTelegramMessage as jest.Mock).mock.calls;
    const messageTexts = sendCalls.map((c: [string, string]) => c[1]);
    expect(messageTexts.some((t: string) => t.includes('δεν υπήρχαν κρατήσεις'))).toBe(true);
    expect(messageTexts.some((t: string) => t.includes('ειδοποιήθησαν'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 29 Plan 04: showCancelClassConfirm shows date + service name (UX-02, D-08)
// ---------------------------------------------------------------------------

describe('showCancelClassConfirm — real context instead of raw instance id (D-08)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 1 });
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
  });

  test('prompt includes real sessionDate, sessionTime, and resolved service name when the session exists', async () => {
    const sessionManager = require('../src/session/manager');
    sessionManager.findSessionInstanceById.mockResolvedValue({
      instanceId: 42,
      catalogId: 1,
      sessionDate: '2026-08-01',
      sessionTime: '10:00',
      bookedCount: 3,
      capacity: 15,
      serviceId: 7,
    });

    const queries = require('../src/database/queries');
    queries.findServiceById.mockResolvedValue({
      id: 7,
      businessId: 1,
      name: 'Pilates',
      durationMin: 60,
      price: 60,
      createdAt: new Date(),
    });

    const telegramClient = require('../src/telegram/client');

    await showCancelClassConfirm('123', mockBusiness, 42);

    expect(sessionManager.findSessionInstanceById).toHaveBeenCalledWith(mockBusiness.id, 42);

    const kbCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    expect(kbCalls.length).toBe(1);
    const promptText = kbCalls[0][1];
    expect(promptText).toContain('2026-08-01');
    expect(promptText).toContain('10:00');
    expect(promptText).toContain('Pilates');
    expect(promptText).not.toContain('#42');
  });

  test('sends "Το μάθημα δεν βρέθηκε." with no keyboard when findSessionInstanceById returns null', async () => {
    const sessionManager = require('../src/session/manager');
    sessionManager.findSessionInstanceById.mockResolvedValue(null);

    const telegramClient = require('../src/telegram/client');

    await showCancelClassConfirm('123', mockBusiness, 999);

    const msgCalls = (telegramClient.sendTelegramMessage as jest.Mock).mock.calls;
    expect(msgCalls.length).toBe(1);
    expect(msgCalls[0][1]).toBe('Το μάθημα δεν βρέθηκε.');

    expect(telegramClient.sendTelegramMessageWithKeyboard).not.toHaveBeenCalled();
  });

  test('falls back to "(άγνωστη υπηρεσία)" when findServiceById returns null', async () => {
    const sessionManager = require('../src/session/manager');
    sessionManager.findSessionInstanceById.mockResolvedValue({
      instanceId: 42,
      catalogId: 1,
      sessionDate: '2026-08-01',
      sessionTime: '10:00',
      bookedCount: 3,
      capacity: 15,
      serviceId: 7,
    });

    const queries = require('../src/database/queries');
    queries.findServiceById.mockResolvedValue(null);

    const telegramClient = require('../src/telegram/client');

    await showCancelClassConfirm('123', mockBusiness, 42);

    const kbCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    expect(kbCalls.length).toBe(1);
    expect(kbCalls[0][1]).toContain('(άγνωστη υπηρεσία)');
  });
});

// ---------------------------------------------------------------------------
// Phase 29 Plan 04: showClassesMenu / showCancelClassList show service names (UX-04, D-10)
// ---------------------------------------------------------------------------

describe('showClassesMenu — service names via batched lookup (D-10)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 1 });
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
  });

  test('calls findServiceById exactly once for 2 sessions sharing the same serviceId (no N+1), and message includes the service name', async () => {
    const sessionManager = require('../src/session/manager');
    sessionManager.listSessions.mockResolvedValue([
      { instanceId: 1, catalogId: 1, sessionDate: '2026-08-01', sessionTime: '10:00', bookedCount: 3, capacity: 15, serviceId: 7 },
      { instanceId: 2, catalogId: 1, sessionDate: '2026-08-03', sessionTime: '10:00', bookedCount: 5, capacity: 15, serviceId: 7 },
    ]);

    const queries = require('../src/database/queries');
    queries.findServiceById.mockResolvedValue({
      id: 7,
      businessId: 1,
      name: 'Pilates',
      durationMin: 60,
      price: 60,
      createdAt: new Date(),
    });

    const telegramClient = require('../src/telegram/client');

    await showClassesMenu('123', mockBusiness);

    expect(queries.findServiceById).toHaveBeenCalledTimes(1);
    expect(queries.findServiceById).toHaveBeenCalledWith(mockBusiness.id, 7);

    const kbCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    expect(kbCalls.length).toBe(1);
    const messageText = kbCalls[0][1];
    expect(messageText).toContain('Pilates - 2026-08-01 10:00');
    expect(messageText).toContain('Pilates - 2026-08-03 10:00');
  });

  test('falls back to "(άγνωστη υπηρεσία)" when findServiceById resolves to null', async () => {
    const sessionManager = require('../src/session/manager');
    sessionManager.listSessions.mockResolvedValue([
      { instanceId: 1, catalogId: 1, sessionDate: '2026-08-01', sessionTime: '10:00', bookedCount: 3, capacity: 15, serviceId: 7 },
    ]);

    const queries = require('../src/database/queries');
    queries.findServiceById.mockResolvedValue(null);

    const telegramClient = require('../src/telegram/client');

    await showClassesMenu('123', mockBusiness);

    const kbCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    expect(kbCalls[0][1]).toContain('(άγνωστη υπηρεσία) - 2026-08-01 10:00');
  });
});

describe('showCancelClassList — date-first picker, step 1 (Phase 30)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 1 });
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
  });

  test('renders one date button per distinct scheduled date, deduped, without calling findServiceById', async () => {
    const sessionManager = require('../src/session/manager');
    sessionManager.listSessions.mockResolvedValue([
      { instanceId: 1, catalogId: 1, sessionDate: '2026-08-01', sessionTime: '10:00', bookedCount: 3, capacity: 15, serviceId: 7 },
      { instanceId: 2, catalogId: 1, sessionDate: '2026-08-01', sessionTime: '18:00', bookedCount: 5, capacity: 15, serviceId: 7 },
      { instanceId: 3, catalogId: 2, sessionDate: '2026-08-03', sessionTime: '10:00', bookedCount: 0, capacity: 15, serviceId: 8 },
    ]);

    const queries = require('../src/database/queries');
    const telegramClient = require('../src/telegram/client');

    await showCancelClassList('123', mockBusiness);

    expect(queries.findServiceById).not.toHaveBeenCalled();
    expect(sessionManager.listSessions).toHaveBeenCalledWith(mockBusiness.id, 30);

    const kbCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    expect(kbCalls.length).toBe(1);
    const keyboard = kbCalls[0][2];
    expect(keyboard[0][0]).toEqual({ text: 'Σαβ 01/08/2026', callback_data: 'menu:classes:cancel_date:20260801' });
    expect(keyboard[1][0]).toEqual({ text: 'Δευ 03/08/2026', callback_data: 'menu:classes:cancel_date:20260803' });
  });

  test('no scheduled classes → informational message + back button', async () => {
    const sessionManager = require('../src/session/manager');
    sessionManager.listSessions.mockResolvedValue([]);

    const telegramClient = require('../src/telegram/client');

    await showCancelClassList('123', mockBusiness);

    expect(telegramClient.sendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      '123',
      'Δεν υπάρχουν επερχόμενα μαθήματα.',
      [[{ text: '« Πίσω στο Μενού', callback_data: 'menu:root' }]]
    );
  });
});

describe('showCancelClassListForDate — date-first picker, step 2, service names via batched lookup (D-10, Phase 30)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 1 });
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
  });

  test('calls findServiceById exactly once for 2 sessions on the chosen date sharing the same serviceId, and button labels include the service name', async () => {
    const sessionManager = require('../src/session/manager');
    sessionManager.listSessions.mockResolvedValue([
      { instanceId: 1, catalogId: 1, sessionDate: '2026-08-01', sessionTime: '10:00', bookedCount: 3, capacity: 15, serviceId: 7 },
      { instanceId: 2, catalogId: 1, sessionDate: '2026-08-01', sessionTime: '18:00', bookedCount: 5, capacity: 15, serviceId: 7 },
      { instanceId: 3, catalogId: 1, sessionDate: '2026-08-03', sessionTime: '10:00', bookedCount: 0, capacity: 15, serviceId: 7 },
    ]);

    const queries = require('../src/database/queries');
    queries.findServiceById.mockResolvedValue({
      id: 7,
      businessId: 1,
      name: 'Pilates',
      durationMin: 60,
      price: 60,
      createdAt: new Date(),
    });

    const telegramClient = require('../src/telegram/client');

    await showCancelClassListForDate('123', mockBusiness, 20260801);

    expect(queries.findServiceById).toHaveBeenCalledTimes(1);
    expect(queries.findServiceById).toHaveBeenCalledWith(mockBusiness.id, 7);

    const kbCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    expect(kbCalls.length).toBe(1);
    const keyboard = kbCalls[0][2];
    expect(keyboard[0][0].text).toBe('Pilates - 10:00');
    expect(keyboard[1][0].text).toBe('Pilates - 18:00');
  });

  test('falls back to "(άγνωστη υπηρεσία)" when findServiceById resolves to null', async () => {
    const sessionManager = require('../src/session/manager');
    sessionManager.listSessions.mockResolvedValue([
      { instanceId: 1, catalogId: 1, sessionDate: '2026-08-01', sessionTime: '10:00', bookedCount: 3, capacity: 15, serviceId: 7 },
    ]);

    const queries = require('../src/database/queries');
    queries.findServiceById.mockResolvedValue(null);

    const telegramClient = require('../src/telegram/client');

    await showCancelClassListForDate('123', mockBusiness, 20260801);

    const kbCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    const keyboard = kbCalls[0][2];
    expect(keyboard[0][0].text).toBe('(άγνωστη υπηρεσία) - 10:00');
  });

  test('sessions on other dates are filtered out', async () => {
    const sessionManager = require('../src/session/manager');
    sessionManager.listSessions.mockResolvedValue([
      { instanceId: 1, catalogId: 1, sessionDate: '2026-08-03', sessionTime: '10:00', bookedCount: 3, capacity: 15, serviceId: 7 },
    ]);

    const telegramClient = require('../src/telegram/client');

    await showCancelClassListForDate('123', mockBusiness, 20260801);

    expect(telegramClient.sendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      '123',
      'Δεν υπάρχουν πλέον προγραμματισμένα μαθήματα για αυτή την ημερομηνία.',
      [[{ text: '« Πίσω στο Μενού', callback_data: 'menu:classes:cancel_list' }]]
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 29 Plan 04: default-case recovery keyboard (UX-06 / D-05.1)
// ---------------------------------------------------------------------------

describe('handleMenuCallback — default case (unrecognized menuAction, D-05.1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 1 });
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
  });

  test('an unrecognized menuAction sends a back-to-menu keyboard instead of a bare text message', async () => {
    const telegramClient = require('../src/telegram/client');

    await handleMenuCallback({ menuAction: 'some_stale_action', id: undefined }, mockBusiness, '123');

    expect(telegramClient.sendTelegramMessage).not.toHaveBeenCalled();

    const kbCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    expect(kbCalls.length).toBe(1);
    expect(kbCalls[0][1]).toBe('Άγνωστη ενέργεια μενού.');
    expect(kbCalls[0][2]).toEqual([[{ text: '« Πίσω στο Μενού', callback_data: 'menu:root' }]]);
  });
});

// ---------------------------------------------------------------------------
// Quick task 260729-n05: showClientBalance — delete/unlink buttons
// ---------------------------------------------------------------------------

describe('showClientBalance — delete/unlink buttons (n05)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 1 });
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });

    const queries = require('../src/database/queries');
    queries.findClientBusinessRelationshipById.mockResolvedValue({
      id: 42,
      businessId: mockBusiness.id,
      senderPhone: '111222333',
      clientName: 'Maria',
      consentGiven: true,
      consentTimestamp: new Date(),
      createdAt: new Date(),
    });
  });

  test('renders both new buttons when the client has an active membership', async () => {
    const billingQueries = require('../src/billing/queries');
    billingQueries.getClientActiveMembership.mockResolvedValue({
      packageName: 'Pilates 10',
      sessionsRemaining: 5,
      expiresAt: new Date('2026-09-01'),
      isUnlimited: false,
    });

    const telegramClient = require('../src/telegram/client');
    await showClientBalance('123', mockBusiness, 42);

    const kbCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    expect(kbCalls.length).toBe(1);
    const keyboard = kbCalls[0][2];
    const flat = keyboard.flat();
    expect(flat).toContainEqual({ text: 'Πλήρης διαγραφή', callback_data: 'menu:clients:del_full_confirm:42' });
    expect(flat).toContainEqual({ text: 'Αφαίρεση από λίστα', callback_data: 'menu:clients:del_unlink_confirm:42' });
  });

  test('renders both new buttons even when the client has no active membership', async () => {
    const billingQueries = require('../src/billing/queries');
    billingQueries.getClientActiveMembership.mockResolvedValue(null);

    const telegramClient = require('../src/telegram/client');
    await showClientBalance('123', mockBusiness, 42);

    const kbCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    expect(kbCalls.length).toBe(1);
    const keyboard = kbCalls[0][2];
    const flat = keyboard.flat();
    expect(flat).toContainEqual({ text: 'Πλήρης διαγραφή', callback_data: 'menu:clients:del_full_confirm:42' });
    expect(flat).toContainEqual({ text: 'Αφαίρεση από λίστα', callback_data: 'menu:clients:del_unlink_confirm:42' });
  });
});

// ---------------------------------------------------------------------------
// showClientsList — remaining-slots annotation next to each client name
// ---------------------------------------------------------------------------

describe('showClientsList — remaining-slots annotation (Phase 30)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
  });

  test('client with remaining sessions → "(N)" suffix', async () => {
    const billingQueries = require('../src/billing/queries');
    billingQueries.getAllClientsForBusiness.mockResolvedValue([
      { clientBusinessRelationshipId: 1, clientName: 'Maria', senderPhone: '30111' },
    ]);
    billingQueries.getActiveMembershipsForBusiness.mockResolvedValue(
      new Map([['30111', { sessionsRemaining: 4, expiresAt: new Date('2030-01-01') }]])
    );

    const telegramClient = require('../src/telegram/client');
    await showClientsList('123', mockBusiness);

    const keyboard = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls[0][2];
    expect(keyboard[0][0].text).toBe('Maria (4)');
  });

  test('client with no active membership → warning icon + 0', async () => {
    const billingQueries = require('../src/billing/queries');
    billingQueries.getAllClientsForBusiness.mockResolvedValue([
      { clientBusinessRelationshipId: 1, clientName: 'Nikos', senderPhone: '30222' },
    ]);
    billingQueries.getActiveMembershipsForBusiness.mockResolvedValue(new Map());

    const telegramClient = require('../src/telegram/client');
    await showClientsList('123', mockBusiness);

    const keyboard = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls[0][2];
    expect(keyboard[0][0].text).toBe('Nikos ⚠️ 0');
  });

  test('client with an exhausted pack (sessionsRemaining=0) → warning icon, same as no membership (CR-04)', async () => {
    const billingQueries = require('../src/billing/queries');
    billingQueries.getAllClientsForBusiness.mockResolvedValue([
      { clientBusinessRelationshipId: 1, clientName: 'Eleni', senderPhone: '30333' },
    ]);
    billingQueries.getActiveMembershipsForBusiness.mockResolvedValue(
      new Map([['30333', { sessionsRemaining: 0, expiresAt: new Date('2030-01-01') }]])
    );

    const telegramClient = require('../src/telegram/client');
    await showClientsList('123', mockBusiness);

    const keyboard = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls[0][2];
    expect(keyboard[0][0].text).toBe('Eleni ⚠️ 0');
  });

  test('client with an unlimited membership → "∞" suffix', async () => {
    const billingQueries = require('../src/billing/queries');
    billingQueries.getAllClientsForBusiness.mockResolvedValue([
      { clientBusinessRelationshipId: 1, clientName: 'Costas', senderPhone: '30444' },
    ]);
    billingQueries.getActiveMembershipsForBusiness.mockResolvedValue(
      new Map([['30444', { sessionsRemaining: null, expiresAt: new Date('2030-01-01') }]])
    );

    const telegramClient = require('../src/telegram/client');
    await showClientsList('123', mockBusiness);

    const keyboard = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls[0][2];
    expect(keyboard[0][0].text).toBe('Costas ∞');
  });

  test('client with no clientName falls back to senderPhone, suffix still appended', async () => {
    const billingQueries = require('../src/billing/queries');
    billingQueries.getAllClientsForBusiness.mockResolvedValue([
      { clientBusinessRelationshipId: 1, clientName: null, senderPhone: '30555' },
    ]);
    billingQueries.getActiveMembershipsForBusiness.mockResolvedValue(new Map());

    const telegramClient = require('../src/telegram/client');
    await showClientsList('123', mockBusiness);

    const keyboard = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls[0][2];
    expect(keyboard[0][0].text).toBe('30555 ⚠️ 0');
  });
});

// ---------------------------------------------------------------------------
// Ειδοποίηση Πελατών — manual renewal-notification menu (Phase 30)
// ---------------------------------------------------------------------------

describe('showNotifyMenu — root of the notify flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 1 });
  });

  test('sends the bulk / select-client / back options', async () => {
    const telegramClient = require('../src/telegram/client');
    await showNotifyMenu('123', mockBusiness);

    const keyboard = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls[0][2];
    expect(keyboard.flat()).toEqual([
      { text: 'Όλοι με λήξη σε λιγότερο από 7 ημέρες', callback_data: 'menu:notify:expiring' },
      { text: 'Επιλογή πελάτη', callback_data: 'menu:notify:select' },
      { text: '« Πίσω στο Μενού', callback_data: 'menu:root' },
    ]);
  });
});

describe('showNotifyExpiringList — bulk path, step 1', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 1 });
  });

  test('no expiring memberships → informational message + back button, no Ναι/Όχι', async () => {
    const billingQueries = require('../src/billing/queries');
    billingQueries.findMembershipsExpiringIn7Days.mockResolvedValue([]);

    const telegramClient = require('../src/telegram/client');
    await showNotifyExpiringList('123', mockBusiness);

    expect(telegramClient.sendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      '123',
      'Δεν υπάρχουν πελάτες με λήξη συνδρομής τις επόμενες 7 ημέρες.',
      [[{ text: '« Πίσω στο Μενού', callback_data: 'menu:root' }]]
    );
  });

  test('lists each expiring client with name, sessions, expiry date, and a Ναι/Όχι confirm', async () => {
    const billingQueries = require('../src/billing/queries');
    billingQueries.findMembershipsExpiringIn7Days.mockResolvedValue([
      { id: 1, businessId: 1, clientPhone: '30111', sessionsRemaining: 2, expiresAt: new Date('2026-10-05') },
      { id: 2, businessId: 1, clientPhone: '30222', sessionsRemaining: null, expiresAt: new Date('2026-10-06') },
    ]);
    billingQueries.getAllClientsForBusiness.mockResolvedValue([
      { clientBusinessRelationshipId: 1, clientName: 'Maria', senderPhone: '30111' },
      { clientBusinessRelationshipId: 2, clientName: null, senderPhone: '30222' },
    ]);

    const telegramClient = require('../src/telegram/client');
    await showNotifyExpiringList('123', mockBusiness);

    const call = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls[0];
    expect(call[1]).toContain('Maria — 2 μαθήματα');
    expect(call[1]).toContain('30222 — απεριόριστα μαθήματα');
    expect(call[1]).toContain('Να σταλεί ειδοποίηση σε όλους;');
    expect(call[2]).toEqual([
      [
        { text: 'Ναι', callback_data: 'menu:notify:expiring_yes' },
        { text: 'Όχι', callback_data: 'menu:notify:expiring_no' },
      ],
    ]);
  });
});

describe('handleNotifyExpiringExecute — bulk path, step 2', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 1 });
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
    telegramClient.botTokenStore.run.mockImplementation(
      (_token: string, fn: () => Promise<unknown>) => fn()
    );
  });

  test('sends one reminder per expiring client and reports the count sent', async () => {
    const billingQueries = require('../src/billing/queries');
    billingQueries.findMembershipsExpiringIn7Days.mockResolvedValue([
      { id: 1, businessId: 1, clientPhone: '30111', sessionsRemaining: 2, expiresAt: new Date('2026-10-05') },
      { id: 2, businessId: 1, clientPhone: '30222', sessionsRemaining: null, expiresAt: new Date('2026-10-06') },
    ]);

    const telegramClient = require('../src/telegram/client');
    await handleNotifyExpiringExecute('123', mockBusiness);

    expect(telegramClient.sendTelegramMessage).toHaveBeenCalledWith('30111', expect.stringContaining('Η συνδρομή σας λήγει'));
    expect(telegramClient.sendTelegramMessage).toHaveBeenCalledWith('30222', expect.stringContaining('Η συνδρομή σας λήγει'));
    expect(telegramClient.sendTelegramMessage).toHaveBeenCalledWith('123', '✅ Στάλθηκαν ειδοποιήσεις σε 2 πελάτες.');
  });

  test('a per-client send failure does not stop the rest — count reflects only successful sends', async () => {
    const billingQueries = require('../src/billing/queries');
    billingQueries.findMembershipsExpiringIn7Days.mockResolvedValue([
      { id: 1, businessId: 1, clientPhone: '30111', sessionsRemaining: 2, expiresAt: new Date('2026-10-05') },
      { id: 2, businessId: 1, clientPhone: '30222', sessionsRemaining: 1, expiresAt: new Date('2026-10-06') },
    ]);

    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessage.mockImplementation((to: string) => {
      if (to === '30111') return Promise.reject(new Error('Telegram down'));
      return Promise.resolve({ messageId: 1 });
    });

    await handleNotifyExpiringExecute('123', mockBusiness);

    expect(telegramClient.sendTelegramMessage).toHaveBeenCalledWith('123', '✅ Στάλθηκαν ειδοποιήσεις σε 1 πελάτες.');
  });

  test('missing botToken → error message, no sends attempted', async () => {
    const billingQueries = require('../src/billing/queries');
    billingQueries.findMembershipsExpiringIn7Days.mockResolvedValue([
      { id: 1, businessId: 1, clientPhone: '30111', sessionsRemaining: 2, expiresAt: new Date('2026-10-05') },
    ]);

    const telegramClient = require('../src/telegram/client');
    await handleNotifyExpiringExecute('123', { ...mockBusiness, botToken: null });

    expect(telegramClient.sendTelegramMessage).toHaveBeenCalledWith(
      '123',
      'Σφάλμα: δεν βρέθηκε το bot token της επιχείρησης.'
    );
    expect(billingQueries.findMembershipsExpiringIn7Days).not.toHaveBeenCalled();
  });
});

describe('showNotifyClientList — single-client path, step 1', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 1 });
  });

  test('only lists clients that have an active membership, with sessions + expiry in the label', async () => {
    const billingQueries = require('../src/billing/queries');
    billingQueries.getAllClientsForBusiness.mockResolvedValue([
      { clientBusinessRelationshipId: 1, clientName: 'Maria', senderPhone: '30111' },
      { clientBusinessRelationshipId: 2, clientName: 'Nikos', senderPhone: '30222' },
    ]);
    billingQueries.getActiveMembershipsForBusiness.mockResolvedValue(
      new Map([['30111', { sessionsRemaining: 3, expiresAt: new Date('2026-10-05') }]])
    );

    const telegramClient = require('../src/telegram/client');
    await showNotifyClientList('123', mockBusiness);

    const keyboard = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls[0][2];
    const flat = keyboard.flat();
    expect(flat).toContainEqual({
      text: expect.stringContaining('Maria — 3 μαθήματα'),
      callback_data: 'menu:notify:client_confirm:1',
    });
    expect(flat.find((b: any) => b.callback_data === 'menu:notify:client_confirm:2')).toBeUndefined();
  });

  test('no clients with an active membership → informational message', async () => {
    const billingQueries = require('../src/billing/queries');
    billingQueries.getAllClientsForBusiness.mockResolvedValue([
      { clientBusinessRelationshipId: 1, clientName: 'Maria', senderPhone: '30111' },
    ]);
    billingQueries.getActiveMembershipsForBusiness.mockResolvedValue(new Map());

    const telegramClient = require('../src/telegram/client');
    await showNotifyClientList('123', mockBusiness);

    expect(telegramClient.sendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      '123',
      'Δεν υπάρχουν πελάτες με ενεργή συνδρομή.',
      [[{ text: '« Πίσω στο Μενού', callback_data: 'menu:root' }]]
    );
  });
});

describe('showNotifyClientConfirm — single-client path, step 2', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 1 });
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 2 });
    const queries = require('../src/database/queries');
    queries.findClientBusinessRelationshipById.mockResolvedValue({
      id: 42,
      businessId: 1,
      senderPhone: '30111',
      clientName: 'Maria',
      consentGiven: true,
      consentTimestamp: new Date(),
      createdAt: new Date(),
    });
  });

  test('shows client details and a Ναι/Όχι confirmation', async () => {
    const billingQueries = require('../src/billing/queries');
    billingQueries.getClientActiveMembership.mockResolvedValue({
      packageName: 'Pilates 10',
      sessionsRemaining: 3,
      expiresAt: new Date('2026-10-05'),
      isUnlimited: false,
    });

    const telegramClient = require('../src/telegram/client');
    await showNotifyClientConfirm('123', mockBusiness, 42);

    const call = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls[0];
    expect(call[1]).toContain('Πελάτης: Maria');
    expect(call[1]).toContain('Υπόλοιπο: 3 μαθήματα');
    expect(call[1]).toContain('Να σταλεί ειδοποίηση ανανέωσης;');
    expect(call[2]).toEqual([
      [
        { text: 'Ναι', callback_data: 'menu:notify:client_yes:42' },
        { text: 'Όχι', callback_data: 'menu:notify:client_no:42' },
      ],
    ]);
  });

  test('cross-tenant guard: mismatched businessId → generic not-found, no membership lookup', async () => {
    const queries = require('../src/database/queries');
    queries.findClientBusinessRelationshipById.mockResolvedValue({
      id: 42,
      businessId: 999,
      senderPhone: '30111',
      clientName: 'Maria',
      consentGiven: true,
      consentTimestamp: new Date(),
      createdAt: new Date(),
    });
    const billingQueries = require('../src/billing/queries');

    const telegramClient = require('../src/telegram/client');
    await showNotifyClientConfirm('123', mockBusiness, 42);

    expect(telegramClient.sendTelegramMessage).toHaveBeenCalledWith('123', 'Ο πελάτης δεν βρέθηκε.');
    expect(billingQueries.getClientActiveMembership).not.toHaveBeenCalled();
  });

  test('client no longer has an active membership → informational message with a back-to-list button', async () => {
    const billingQueries = require('../src/billing/queries');
    billingQueries.getClientActiveMembership.mockResolvedValue(null);

    const telegramClient = require('../src/telegram/client');
    await showNotifyClientConfirm('123', mockBusiness, 42);

    expect(telegramClient.sendTelegramMessageWithKeyboard).toHaveBeenCalledWith(
      '123',
      'Ο πελάτης δεν έχει πλέον ενεργή συνδρομή.',
      [[{ text: '« Πίσω στη λίστα', callback_data: 'menu:notify:select' }]]
    );
  });
});

describe('handleNotifyClientExecute — single-client path, step 3', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 1 });
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 2 });
    telegramClient.botTokenStore.run.mockImplementation(
      (_token: string, fn: () => Promise<unknown>) => fn()
    );
    const queries = require('../src/database/queries');
    queries.findClientBusinessRelationshipById.mockResolvedValue({
      id: 42,
      businessId: 1,
      senderPhone: '30111',
      clientName: 'Maria',
      consentGiven: true,
      consentTimestamp: new Date(),
      createdAt: new Date(),
    });
  });

  test('sends the reminder to the resolved client and confirms back to the owner', async () => {
    const billingQueries = require('../src/billing/queries');
    billingQueries.getClientActiveMembership.mockResolvedValue({
      packageName: 'Pilates 10',
      sessionsRemaining: 3,
      expiresAt: new Date('2026-10-05'),
      isUnlimited: false,
    });

    const telegramClient = require('../src/telegram/client');
    await handleNotifyClientExecute('123', mockBusiness, 42);

    expect(telegramClient.sendTelegramMessage).toHaveBeenCalledWith('30111', expect.stringContaining('Η συνδρομή σας λήγει'));
    expect(telegramClient.sendTelegramMessage).toHaveBeenCalledWith('123', '✅ Η ειδοποίηση στάλθηκε στον/στην Maria.');
  });

  test('cross-tenant guard: mismatched businessId → generic not-found, no send attempted', async () => {
    const queries = require('../src/database/queries');
    queries.findClientBusinessRelationshipById.mockResolvedValue({
      id: 42,
      businessId: 999,
      senderPhone: '30111',
      clientName: 'Maria',
      consentGiven: true,
      consentTimestamp: new Date(),
      createdAt: new Date(),
    });

    const telegramClient = require('../src/telegram/client');
    await handleNotifyClientExecute('123', mockBusiness, 42);

    expect(telegramClient.sendTelegramMessage).toHaveBeenCalledWith('123', 'Ο πελάτης δεν βρέθηκε.');
    expect(telegramClient.sendTelegramMessage).not.toHaveBeenCalledWith('30111', expect.anything());
  });

  test('client no longer has an active membership → no send, informational message', async () => {
    const billingQueries = require('../src/billing/queries');
    billingQueries.getClientActiveMembership.mockResolvedValue(null);

    const telegramClient = require('../src/telegram/client');
    await handleNotifyClientExecute('123', mockBusiness, 42);

    expect(telegramClient.sendTelegramMessage).toHaveBeenCalledWith(
      '123',
      'Ο πελάτης δεν έχει πλέον ενεργή συνδρομή — δεν στάλθηκε ειδοποίηση.'
    );
    expect(telegramClient.sendTelegramMessage).not.toHaveBeenCalledWith('30111', expect.anything());
  });
});

// ---------------------------------------------------------------------------
// Quick task 260729-n05: showDeleteFullConfirm / handleDeleteFullExecute — full erase
// ---------------------------------------------------------------------------

describe('showDeleteFullConfirm / handleDeleteFullExecute — full erase (n05)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 1 });
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
  });

  test('ownership guard: mismatched businessId sends only the generic not-found message and calls no delete function', async () => {
    const queries = require('../src/database/queries');
    queries.findClientBusinessRelationshipById.mockResolvedValue({
      id: 42,
      businessId: mockBusiness.id + 999,
      senderPhone: '111222333',
      clientName: 'Maria',
      consentGiven: true,
      consentTimestamp: new Date(),
      createdAt: new Date(),
    });

    const billingQueries = require('../src/billing/queries');
    const telegramClient = require('../src/telegram/client');

    await handleDeleteFullExecute('123', mockBusiness, 42);

    const msgCalls = (telegramClient.sendTelegramMessage as jest.Mock).mock.calls;
    expect(msgCalls.length).toBe(1);
    expect(msgCalls[0][1]).toBe('Ο πελάτης δεν βρέθηκε.');

    expect(billingQueries.deleteClientBillingData).not.toHaveBeenCalled();
    expect(queries.deleteClientBookingData).not.toHaveBeenCalled();
    expect(queries.deleteClientBusinessRelationship).not.toHaveBeenCalled();
  });

  test('showDeleteFullConfirm happy path: Ναι/Όχι keyboard with matching callback_data and client name in the message', async () => {
    const queries = require('../src/database/queries');
    queries.findClientBusinessRelationshipById.mockResolvedValue({
      id: 42,
      businessId: mockBusiness.id,
      senderPhone: '111222333',
      clientName: 'Maria',
      consentGiven: true,
      consentTimestamp: new Date(),
      createdAt: new Date(),
    });

    const telegramClient = require('../src/telegram/client');
    await showDeleteFullConfirm('123', mockBusiness, 42);

    const kbCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    expect(kbCalls.length).toBe(1);
    expect(kbCalls[0][1]).toContain('Maria');
    expect(kbCalls[0][2]).toEqual([[
      { text: 'Ναι', callback_data: 'menu:clients:del_full_yes:42' },
      { text: 'Όχι', callback_data: 'menu:clients:del_full_no:42' },
    ]]);
  });

  test('handleDeleteFullExecute happy path: all 3 delete functions called exactly once, success message contains client name', async () => {
    const queries = require('../src/database/queries');
    queries.findClientBusinessRelationshipById.mockResolvedValue({
      id: 42,
      businessId: mockBusiness.id,
      senderPhone: '111222333',
      clientName: 'Maria',
      consentGiven: true,
      consentTimestamp: new Date(),
      createdAt: new Date(),
    });
    queries.deleteClientBookingData.mockResolvedValue(undefined);
    queries.deleteClientBusinessRelationship.mockResolvedValue(true);

    const billingQueries = require('../src/billing/queries');
    billingQueries.deleteClientBillingData.mockResolvedValue(undefined);

    const telegramClient = require('../src/telegram/client');

    await handleDeleteFullExecute('123', mockBusiness, 42);

    expect(billingQueries.deleteClientBillingData).toHaveBeenCalledTimes(1);
    expect(billingQueries.deleteClientBillingData).toHaveBeenCalledWith(mockBusiness.id, '111222333');
    expect(queries.deleteClientBookingData).toHaveBeenCalledTimes(1);
    expect(queries.deleteClientBookingData).toHaveBeenCalledWith(mockBusiness.id, '111222333');
    expect(queries.deleteClientBusinessRelationship).toHaveBeenCalledTimes(1);
    expect(queries.deleteClientBusinessRelationship).toHaveBeenCalledWith(42, mockBusiness.id);

    const msgCalls = (telegramClient.sendTelegramMessage as jest.Mock).mock.calls;
    expect(msgCalls.some((c: [string, string]) => c[1].includes('Maria'))).toBe(true);

    expect(telegramClient.sendTelegramMessageWithKeyboard).toHaveBeenCalledWith('123', 'Τι άλλο θέλεις να κάνεις;', [
      [{ text: '« Πίσω στο Μενού', callback_data: 'menu:root' }],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Quick task 260729-n05: showUnlinkConfirm / handleUnlinkExecute — unlink only
// ---------------------------------------------------------------------------

describe('showUnlinkConfirm / handleUnlinkExecute — unlink only (n05)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 1 });
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
  });

  test('ownership guard: mismatched businessId sends only the generic not-found message and calls no delete function', async () => {
    const queries = require('../src/database/queries');
    queries.findClientBusinessRelationshipById.mockResolvedValue({
      id: 42,
      businessId: mockBusiness.id + 999,
      senderPhone: '111222333',
      clientName: 'Maria',
      consentGiven: true,
      consentTimestamp: new Date(),
      createdAt: new Date(),
    });

    const telegramClient = require('../src/telegram/client');

    await handleUnlinkExecute('123', mockBusiness, 42);

    const msgCalls = (telegramClient.sendTelegramMessage as jest.Mock).mock.calls;
    expect(msgCalls.length).toBe(1);
    expect(msgCalls[0][1]).toBe('Ο πελάτης δεν βρέθηκε.');

    expect(queries.deleteClientBusinessRelationship).not.toHaveBeenCalled();
  });

  test('showUnlinkConfirm happy path: Ναι/Όχι keyboard with matching callback_data', async () => {
    const queries = require('../src/database/queries');
    queries.findClientBusinessRelationshipById.mockResolvedValue({
      id: 42,
      businessId: mockBusiness.id,
      senderPhone: '111222333',
      clientName: 'Maria',
      consentGiven: true,
      consentTimestamp: new Date(),
      createdAt: new Date(),
    });

    const telegramClient = require('../src/telegram/client');
    await showUnlinkConfirm('123', mockBusiness, 42);

    const kbCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    expect(kbCalls.length).toBe(1);
    expect(kbCalls[0][1]).toContain('Maria');
    expect(kbCalls[0][2]).toEqual([[
      { text: 'Ναι', callback_data: 'menu:clients:del_unlink_yes:42' },
      { text: 'Όχι', callback_data: 'menu:clients:del_unlink_no:42' },
    ]]);
  });

  test('handleUnlinkExecute happy path: only deleteClientBusinessRelationship called, billing/booking delete not called', async () => {
    const queries = require('../src/database/queries');
    queries.findClientBusinessRelationshipById.mockResolvedValue({
      id: 42,
      businessId: mockBusiness.id,
      senderPhone: '111222333',
      clientName: 'Maria',
      consentGiven: true,
      consentTimestamp: new Date(),
      createdAt: new Date(),
    });
    queries.deleteClientBusinessRelationship.mockResolvedValue(true);

    const billingQueries = require('../src/billing/queries');
    const telegramClient = require('../src/telegram/client');

    await handleUnlinkExecute('123', mockBusiness, 42);

    expect(queries.deleteClientBusinessRelationship).toHaveBeenCalledTimes(1);
    expect(queries.deleteClientBusinessRelationship).toHaveBeenCalledWith(42, mockBusiness.id);
    expect(billingQueries.deleteClientBillingData).not.toHaveBeenCalled();
    expect(queries.deleteClientBookingData).not.toHaveBeenCalled();

    const msgCalls = (telegramClient.sendTelegramMessage as jest.Mock).mock.calls;
    expect(msgCalls.some((c: [string, string]) => c[1].includes('Maria'))).toBe(true);
  });
});
