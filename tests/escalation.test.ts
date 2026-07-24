/**
 * Unit tests for src/telegram/escalation.ts — Phase 20 Plan 01 (ESCL-01, ESCL-02).
 *
 * Covers:
 *   - buildEscalationKeyboard returns approve + reply buttons when instanceId is defined
 *   - buildEscalationKeyboard returns only reply button when instanceId is absent
 *   - callback_data strings are under 64 bytes
 *   - sendEscalationToAdmin calls botTokenStore.run with the correct message
 *   - sendEscalationToAdmin resolves client name from findClientBusinessRelationship
 *   - sendEscalationToAdmin falls back to clientTelegramId when clientName is null
 *   - sendEscalationToAdmin does not throw when botToken is missing (best-effort)
 *   - sendEscalationToAdmin does not throw when ownerTelegramId is missing (best-effort)
 *   - sendEscalationToAdmin does not throw when the Telegram send fails (best-effort)
 *   - EscalationReason maps to correct Greek phrase in message
 *
 * NEVER run bare `npm test` — machine crashes on full suite.
 * Use: npm test -- --testPathPattern="escalation" --testTimeout=20000
 */

import { buildEscalationKeyboard, sendEscalationToAdmin } from '../src/telegram/escalation';
import { Business } from '../src/database/queries';

// ---------------------------------------------------------------------------
// Mock all external modules — no real DB or Telegram API calls
// ---------------------------------------------------------------------------

jest.mock('../src/database/queries');
jest.mock('../src/telegram/client');
jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const mockBusiness: Business = {
  id: 1,
  name: 'Test Studio',
  slug: 'test-studio',
  phoneNumberId: null,
  ownerTelegramId: '111222333',
  googleRefreshToken: null,
  agendaSentDate: null,
  botToken: 'test-bot-token-xyz',
  webhookId: 'test-webhook-id',
  webhookSecret: 'test-secret',
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

const CLIENT_TELEGRAM_ID = '987654321';
const INSTANCE_ID = 42;

// ---------------------------------------------------------------------------
// buildEscalationKeyboard
// ---------------------------------------------------------------------------

describe('buildEscalationKeyboard', () => {
  it('returns two buttons (approve + reply) when instanceId is provided', () => {
    const keyboard = buildEscalationKeyboard(CLIENT_TELEGRAM_ID, INSTANCE_ID);
    expect(keyboard).toHaveLength(1);
    expect(keyboard[0]).toHaveLength(2);
    const [approveBtn, replyBtn] = keyboard[0];
    expect(approveBtn.text).toBe('Εγκρίνω εξαίρεση');
    expect(approveBtn.callback_data).toBe(`escl:approve:${INSTANCE_ID}:${CLIENT_TELEGRAM_ID}`);
    expect(replyBtn.text).toBe('Απάντηση πελάτη');
    expect(replyBtn.callback_data).toBe(`escl:reply:${CLIENT_TELEGRAM_ID}`);
  });

  it('returns only reply button when instanceId is absent', () => {
    const keyboard = buildEscalationKeyboard(CLIENT_TELEGRAM_ID);
    expect(keyboard).toHaveLength(1);
    expect(keyboard[0]).toHaveLength(1);
    const [replyBtn] = keyboard[0];
    expect(replyBtn.text).toBe('Απάντηση πελάτη');
    expect(replyBtn.callback_data).toBe(`escl:reply:${CLIENT_TELEGRAM_ID}`);
  });

  it('callback_data strings are under 64 bytes when instanceId is provided', () => {
    const keyboard = buildEscalationKeyboard(CLIENT_TELEGRAM_ID, INSTANCE_ID);
    for (const row of keyboard) {
      for (const btn of row) {
        expect(Buffer.byteLength(btn.callback_data, 'utf8')).toBeLessThanOrEqual(64);
      }
    }
  });

  it('callback_data for reply-only is also under 64 bytes', () => {
    const keyboard = buildEscalationKeyboard(CLIENT_TELEGRAM_ID);
    for (const row of keyboard) {
      for (const btn of row) {
        expect(Buffer.byteLength(btn.callback_data, 'utf8')).toBeLessThanOrEqual(64);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// sendEscalationToAdmin
// ---------------------------------------------------------------------------

describe('sendEscalationToAdmin', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // botTokenStore.run executes the callback immediately
    const telegramClient = require('../src/telegram/client');
    telegramClient.botTokenStore.run = jest.fn().mockImplementation(
      async (_token: string, fn: () => Promise<unknown>) => fn()
    );
    telegramClient.sendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 1 });

    // Default: resolved relationship with clientName
    const queries = require('../src/database/queries');
    queries.findClientBusinessRelationship.mockResolvedValue({
      id: 10,
      businessId: 1,
      senderPhone: CLIENT_TELEGRAM_ID,
      clientName: 'Άννα Παπαδοπούλου',
    });
  });

  it('uses resolved clientName in the admin message', async () => {
    await sendEscalationToAdmin(mockBusiness, CLIENT_TELEGRAM_ID, 'κράτηση μαθήματος', 'membership_expired');
    const telegramClient = require('../src/telegram/client');
    expect(telegramClient.sendTelegramMessageWithKeyboard).toHaveBeenCalledTimes(1);
    const msgText = telegramClient.sendTelegramMessageWithKeyboard.mock.calls[0][1] as string;
    expect(msgText).toContain('Άννα Παπαδοπούλου');
    expect(msgText).toContain('κράτηση μαθήματος');
    expect(msgText).toContain('η συνδρομή έχει λήξει ή εξαντληθεί');
  });

  it('falls back to clientTelegramId when clientName is null', async () => {
    const queries = require('../src/database/queries');
    queries.findClientBusinessRelationship.mockResolvedValue({
      id: 10,
      businessId: 1,
      senderPhone: CLIENT_TELEGRAM_ID,
      clientName: null,
    });
    await sendEscalationToAdmin(mockBusiness, CLIENT_TELEGRAM_ID, 'κράτηση μαθήματος', 'class_full');
    const telegramClient = require('../src/telegram/client');
    const msgText = telegramClient.sendTelegramMessageWithKeyboard.mock.calls[0][1] as string;
    expect(msgText).toContain(CLIENT_TELEGRAM_ID);
    expect(msgText).toContain('το μάθημα είναι πλήρες');
  });

  it('falls back to clientTelegramId when relationship not found', async () => {
    const queries = require('../src/database/queries');
    queries.findClientBusinessRelationship.mockResolvedValue(null);
    await sendEscalationToAdmin(mockBusiness, CLIENT_TELEGRAM_ID, 'κράτηση μαθήματος', 'slotless_disabled');
    const telegramClient = require('../src/telegram/client');
    const msgText = telegramClient.sendTelegramMessageWithKeyboard.mock.calls[0][1] as string;
    expect(msgText).toContain(CLIENT_TELEGRAM_ID);
    expect(msgText).toContain('οι αιτήσεις χωρίς slot δεν είναι ενεργές');
  });

  it('maps class_full reason to correct Greek phrase', async () => {
    await sendEscalationToAdmin(mockBusiness, CLIENT_TELEGRAM_ID, 'κράτηση μαθήματος', 'class_full', INSTANCE_ID);
    const telegramClient = require('../src/telegram/client');
    const msgText = telegramClient.sendTelegramMessageWithKeyboard.mock.calls[0][1] as string;
    expect(msgText).toContain('το μάθημα είναι πλήρες');
  });

  it('maps slotless_disabled reason to correct Greek phrase', async () => {
    await sendEscalationToAdmin(mockBusiness, CLIENT_TELEGRAM_ID, 'αίτηση', 'slotless_disabled');
    const telegramClient = require('../src/telegram/client');
    const msgText = telegramClient.sendTelegramMessageWithKeyboard.mock.calls[0][1] as string;
    expect(msgText).toContain('οι αιτήσεις χωρίς slot δεν είναι ενεργές');
  });

  it('includes approve + reply buttons when instanceId is provided', async () => {
    await sendEscalationToAdmin(mockBusiness, CLIENT_TELEGRAM_ID, 'κράτηση μαθήματος', 'class_full', INSTANCE_ID);
    const telegramClient = require('../src/telegram/client');
    const keyboard = telegramClient.sendTelegramMessageWithKeyboard.mock.calls[0][2];
    expect(keyboard[0]).toHaveLength(2);
    expect(keyboard[0][0].callback_data).toBe(`escl:approve:${INSTANCE_ID}:${CLIENT_TELEGRAM_ID}`);
    expect(keyboard[0][1].callback_data).toBe(`escl:reply:${CLIENT_TELEGRAM_ID}`);
  });

  it('includes only reply button when instanceId is absent', async () => {
    await sendEscalationToAdmin(mockBusiness, CLIENT_TELEGRAM_ID, 'κράτηση μαθήματος', 'membership_expired');
    const telegramClient = require('../src/telegram/client');
    const keyboard = telegramClient.sendTelegramMessageWithKeyboard.mock.calls[0][2];
    expect(keyboard[0]).toHaveLength(1);
    expect(keyboard[0][0].callback_data).toBe(`escl:reply:${CLIENT_TELEGRAM_ID}`);
  });

  it('sends to ownerTelegramId via botTokenStore.run', async () => {
    await sendEscalationToAdmin(mockBusiness, CLIENT_TELEGRAM_ID, 'κράτηση μαθήματος', 'membership_expired');
    const telegramClient = require('../src/telegram/client');
    expect(telegramClient.botTokenStore.run).toHaveBeenCalledWith(
      mockBusiness.botToken,
      expect.any(Function)
    );
    const chatId = telegramClient.sendTelegramMessageWithKeyboard.mock.calls[0][0] as string;
    expect(chatId).toBe(mockBusiness.ownerTelegramId);
  });

  it('does not throw and skips send when botToken is missing', async () => {
    const businessNoBotToken = { ...mockBusiness, botToken: null };
    await expect(
      sendEscalationToAdmin(businessNoBotToken, CLIENT_TELEGRAM_ID, 'κράτηση μαθήματος', 'membership_expired')
    ).resolves.toBeUndefined();
    const telegramClient = require('../src/telegram/client');
    expect(telegramClient.sendTelegramMessageWithKeyboard).not.toHaveBeenCalled();
  });

  it('does not throw and skips send when ownerTelegramId is missing', async () => {
    const businessNoOwner = { ...mockBusiness, ownerTelegramId: null };
    await expect(
      sendEscalationToAdmin(businessNoOwner, CLIENT_TELEGRAM_ID, 'κράτηση μαθήματος', 'membership_expired')
    ).resolves.toBeUndefined();
    const telegramClient = require('../src/telegram/client');
    expect(telegramClient.sendTelegramMessageWithKeyboard).not.toHaveBeenCalled();
  });

  it('does not throw when Telegram send fails (best-effort)', async () => {
    const telegramClient = require('../src/telegram/client');
    telegramClient.sendTelegramMessageWithKeyboard.mockRejectedValue(new Error('Telegram error'));
    await expect(
      sendEscalationToAdmin(mockBusiness, CLIENT_TELEGRAM_ID, 'κράτηση μαθήματος', 'membership_expired')
    ).resolves.toBeUndefined();
  });
});
