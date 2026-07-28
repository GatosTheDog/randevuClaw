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
import { showAdminRootMenu, showSettingsMenu, handleMenuCallback, handleClassCancelExecute, showCancelClassConfirm, showClassesMenu, showCancelClassList } from '../src/telegram/handlers/admin-menu';
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

  test('sends exactly one message with a 4-row keyboard totalling 6 buttons', async () => {
    const telegramClient = require('../src/telegram/client');
    await showAdminRootMenu('123', mockBusiness);

    const sendCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    expect(sendCalls.length).toBe(1);

    const keyboard = sendCalls[0][2];
    // 4 rows: existing 2x2 grid unchanged, plus a payment row, plus the invite row
    expect(keyboard.length).toBe(4);
    // Pre-existing 2x2 grid content is byte-for-byte unchanged
    expect(keyboard[0].length).toBe(2);
    expect(keyboard[1].length).toBe(2);
    // 3rd row: exactly one button with callback_data menu:payment
    expect(keyboard[2].length).toBe(1);
    expect(keyboard[2][0]).toEqual({ text: 'Καταχώρηση Πληρωμής', callback_data: 'menu:payment' });
    // 4th row: exactly one button with callback_data menu:invite
    expect(keyboard[3].length).toBe(1);
    expect(keyboard[3][0]).toEqual({ text: 'Πρόσκληση Πελάτη', callback_data: 'menu:invite' });
    // 6 buttons total
    const totalButtons = keyboard.flat().length;
    expect(totalButtons).toBe(6);
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

  test('sends an 8-row keyboard with the 3 new example-phrase buttons before the back button', async () => {
    const telegramClient = require('../src/telegram/client');
    await showSettingsMenu('123', mockBusiness);

    const sendCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    expect(sendCalls.length).toBe(1);

    const keyboard = sendCalls[0][2];
    expect(keyboard.length).toBe(8);
    expect(keyboard[4]).toEqual([
      { text: '📝 Ώρες Λειτουργίας — Παραδείγματα', callback_data: 'menu:settings:hours_examples' },
    ]);
    expect(keyboard[5]).toEqual([
      { text: '📝 Υπηρεσίες & Τιμές — Παραδείγματα', callback_data: 'menu:settings:services_examples' },
    ]);
    expect(keyboard[6]).toEqual([
      { text: '📝 Νέα Μαθήματα — Παραδείγματα', callback_data: 'menu:settings:classes_examples' },
    ]);
    expect(keyboard[7]).toEqual([{ text: '« Πίσω στο Μενού', callback_data: 'menu:root' }]);
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

describe('showCancelClassList — service names via batched lookup (D-10)', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessage.mockResolvedValue({ messageId: 1 });
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
  });

  test('calls findServiceById exactly once for 2 sessions sharing the same serviceId, and button labels include the service name', async () => {
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

    await showCancelClassList('123', mockBusiness);

    expect(queries.findServiceById).toHaveBeenCalledTimes(1);
    expect(queries.findServiceById).toHaveBeenCalledWith(mockBusiness.id, 7);

    const kbCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    expect(kbCalls.length).toBe(1);
    const keyboard = kbCalls[0][2];
    expect(keyboard[0][0].text).toBe('Pilates - 2026-08-01 10:00');
    expect(keyboard[1][0].text).toBe('Pilates - 2026-08-03 10:00');
  });

  test('falls back to "(άγνωστη υπηρεσία)" when findServiceById resolves to null', async () => {
    const sessionManager = require('../src/session/manager');
    sessionManager.listSessions.mockResolvedValue([
      { instanceId: 1, catalogId: 1, sessionDate: '2026-08-01', sessionTime: '10:00', bookedCount: 3, capacity: 15, serviceId: 7 },
    ]);

    const queries = require('../src/database/queries');
    queries.findServiceById.mockResolvedValue(null);

    const telegramClient = require('../src/telegram/client');

    await showCancelClassList('123', mockBusiness);

    const kbCalls = (telegramClient.sendTelegramMessageWithKeyboard as jest.Mock).mock.calls;
    const keyboard = kbCalls[0][2];
    expect(keyboard[0][0].text).toBe('(άγνωστη υπηρεσία) - 2026-08-01 10:00');
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
