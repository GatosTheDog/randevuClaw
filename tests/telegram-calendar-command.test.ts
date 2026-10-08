/**
 * Tests for the /calendar command / Settings menu Google Calendar
 * connect-disconnect flow — Phase 31 Plan 01 (D-01, D-02, D-06, D-07).
 *
 * Merge note (post git-sync): the connect/reconnect link generation now
 * delegates to handleGoogleCalendarConnect (DB-backed single-use OAuth
 * state, google-calendar-connect.ts) — mocked wholesale here, since its real
 * implementation does its own DB write. This file only still exercises the
 * genuine googleapis-backed revokeToken() call (handleCalendarDisconnect),
 * the one capability this file retains independently of that flow.
 *
 * NEVER run bare `npm test` — machine crashes on full suite.
 * Use: npm test -- --testPathPattern="telegram-calendar-command" --testTimeout=20000
 */

const mockGenerateAuthUrl = jest.fn();
const mockRevokeToken = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        generateAuthUrl: mockGenerateAuthUrl,
        revokeToken: mockRevokeToken,
      })),
    },
  },
}));

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

import { handleCalendarCommand, handleCalendarDisconnect } from '../src/telegram/handlers/calendar-connect';
import { handleGoogleCalendarConnect } from '../src/telegram/handlers/google-calendar-connect';
import { handleMenuCallback, showSettingsMenu } from '../src/telegram/handlers/admin-menu';
import { Business, updateBusinessGoogleRefreshToken } from '../src/database/queries';
import { sendTelegramMessage, sendTelegramMessageWithKeyboard } from '../src/telegram/client';

const mockedSendTelegramMessage = sendTelegramMessage as jest.MockedFunction<typeof sendTelegramMessage>;
const mockedSendTelegramMessageWithKeyboard = sendTelegramMessageWithKeyboard as jest.MockedFunction<
  typeof sendTelegramMessageWithKeyboard
>;
const mockedUpdateBusinessGoogleRefreshToken = updateBusinessGoogleRefreshToken as jest.MockedFunction<
  typeof updateBusinessGoogleRefreshToken
>;
const mockedHandleGoogleCalendarConnect = handleGoogleCalendarConnect as jest.MockedFunction<
  typeof handleGoogleCalendarConnect
>;

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

describe('handleCalendarCommand', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSendTelegramMessage.mockResolvedValue({ messageId: 1 });
    mockedSendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
    mockedHandleGoogleCalendarConnect.mockResolvedValue(undefined);
  });

  // Merge note (post git-sync): the disconnected branch now delegates to
  // handleGoogleCalendarConnect (DB-backed single-use OAuth state) instead of
  // generating the link inline via signOAuthState — see calendar-connect.ts.
  test('delegates to handleGoogleCalendarConnect(chatId, business) when disconnected', async () => {
    const business = { ...mockBusiness, googleRefreshToken: null };
    await handleCalendarCommand('123', business);

    expect(mockedHandleGoogleCalendarConnect).toHaveBeenCalledTimes(1);
    expect(mockedHandleGoogleCalendarConnect).toHaveBeenCalledWith('123', business);
    // The disconnected branch returns immediately after delegating — it must
    // never also send its own messages (that's handleGoogleCalendarConnect's job).
    expect(mockedSendTelegramMessage).not.toHaveBeenCalled();
    expect(mockedSendTelegramMessageWithKeyboard).not.toHaveBeenCalled();
  });

  test('sends a disconnect-offer message with a menu:settings:calendar_disconnect button when already connected', async () => {
    await handleCalendarCommand('123', { ...mockBusiness, googleRefreshToken: 'rt-1' });

    expect(mockGenerateAuthUrl).not.toHaveBeenCalled();
    const kbCalls = mockedSendTelegramMessageWithKeyboard.mock.calls;
    expect(kbCalls[0][2]).toEqual([
      [{ text: 'Αποσύνδεση Google Calendar', callback_data: 'menu:settings:calendar_disconnect' }],
    ]);
  });

  // Note: the disconnected branch no longer sends its own back-to-menu
  // keyboard — it fully delegates to handleGoogleCalendarConnect and returns
  // (covered by the delegation test above). Only the connected/disconnect-
  // offer branch still owns a trailing back-to-menu keyboard.
  test('ends with the back-to-menu keyboard when already connected', async () => {
    await handleCalendarCommand('123', { ...mockBusiness, googleRefreshToken: 'rt-1' });
    const kbCalls = mockedSendTelegramMessageWithKeyboard.mock.calls;
    expect(kbCalls[kbCalls.length - 1][2]).toEqual([[{ text: '« Πίσω στο Μενού', callback_data: 'menu:root' }]]);
  });
});

describe('handleCalendarDisconnect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSendTelegramMessage.mockResolvedValue({ messageId: 1 });
    mockedSendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
    mockedUpdateBusinessGoogleRefreshToken.mockResolvedValue(undefined);
  });

  test('calls updateBusinessGoogleRefreshToken(business.id, null) exactly once and completes even when revokeToken rejects', async () => {
    mockRevokeToken.mockRejectedValue(new Error('revoke failed'));

    await handleCalendarDisconnect('123', { ...mockBusiness, googleRefreshToken: 'rt-1' });

    expect(mockedUpdateBusinessGoogleRefreshToken).toHaveBeenCalledTimes(1);
    expect(mockedUpdateBusinessGoogleRefreshToken).toHaveBeenCalledWith(mockBusiness.id, null);
  });

  test('sends the "nothing to disconnect" message and never calls updateBusinessGoogleRefreshToken when already disconnected', async () => {
    await handleCalendarDisconnect('123', { ...mockBusiness, googleRefreshToken: null });

    expect(mockedUpdateBusinessGoogleRefreshToken).not.toHaveBeenCalled();
    const msgCalls = mockedSendTelegramMessage.mock.calls;
    expect(msgCalls[0][1]).toBe('Δεν υπάρχει συνδεδεμένο Google Calendar προς αποσύνδεση.');
  });
});

describe('showSettingsMenu — Google Calendar button reflects connection state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSendTelegramMessage.mockResolvedValue({ messageId: 1 });
    mockedSendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
  });

  test('shows "Σύνδεση" text when disconnected', async () => {
    await showSettingsMenu('123', { ...mockBusiness, googleRefreshToken: null });

    const keyboard = mockedSendTelegramMessageWithKeyboard.mock.calls[0][2];
    const calendarRow = keyboard.find((row) => row[0]?.callback_data === 'menu:settings:calendar');
    expect(calendarRow).toEqual([{ text: '📅 Σύνδεση Google Calendar', callback_data: 'menu:settings:calendar' }]);
  });

  test('shows "Διαχείριση" text when connected', async () => {
    await showSettingsMenu('123', { ...mockBusiness, googleRefreshToken: 'rt-1' });

    const keyboard = mockedSendTelegramMessageWithKeyboard.mock.calls[0][2];
    const calendarRow = keyboard.find((row) => row[0]?.callback_data === 'menu:settings:calendar');
    expect(calendarRow).toEqual([{ text: '📅 Διαχείριση Google Calendar', callback_data: 'menu:settings:calendar' }]);
  });
});

describe('handleMenuCallback — calendar dispatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSendTelegramMessage.mockResolvedValue({ messageId: 1 });
    mockedSendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });
    mockedUpdateBusinessGoogleRefreshToken.mockResolvedValue(undefined);
    mockedHandleGoogleCalendarConnect.mockResolvedValue(undefined);
  });

  test("dispatches 'settings:calendar' to handleCalendarCommand, not handleSettingsToggle's default branch", async () => {
    const business = { ...mockBusiness, googleRefreshToken: null };
    await handleMenuCallback({ menuAction: 'settings:calendar', id: undefined }, business, '123');

    expect(mockedHandleGoogleCalendarConnect).toHaveBeenCalledWith('123', business);
    const msgCalls = mockedSendTelegramMessage.mock.calls;
    expect(msgCalls.some((call) => call[1] === 'Άγνωστη ρύθμιση.')).toBe(false);
  });

  test("dispatches 'settings:calendar_disconnect' to handleCalendarDisconnect, not handleSettingsToggle's default branch", async () => {
    await handleMenuCallback(
      { menuAction: 'settings:calendar_disconnect', id: undefined },
      { ...mockBusiness, googleRefreshToken: 'rt-1' },
      '123'
    );

    expect(mockedUpdateBusinessGoogleRefreshToken).toHaveBeenCalledWith(mockBusiness.id, null);
    const msgCalls = mockedSendTelegramMessage.mock.calls;
    expect(msgCalls.some((call) => call[1] === 'Άγνωστη ρύθμιση.')).toBe(false);
  });
});
