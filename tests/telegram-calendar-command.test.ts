/**
 * Tests for the /calendar command / Settings menu Google Calendar
 * connect-disconnect flow — Phase 31 Plan 01 (D-01, D-02, D-06, D-07).
 *
 * Mirrors tests/admin-menu.test.ts's mock/fixture conventions. src/google/oauth
 * is left REAL (mirrors tests/google-oauth.test.ts's pattern of mocking only
 * the underlying `googleapis` package) so signOAuthState/getOAuth2AuthUrl
 * exercise genuine behavior instead of a stubbed signature check.
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

import { signOAuthState } from '../src/google/oauth';
import { handleCalendarCommand, handleCalendarDisconnect } from '../src/telegram/handlers/calendar-connect';
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
    mockGenerateAuthUrl.mockImplementation(
      (opts: { state: string }) => `https://accounts.google.com/o/oauth2/v2/auth?state=${opts.state}`
    );
  });

  test('sends an OAuth URL containing the exact state from signOAuthState when disconnected', async () => {
    const expectedState = signOAuthState(mockBusiness.id);

    await handleCalendarCommand('123', { ...mockBusiness, googleRefreshToken: null });

    expect(mockGenerateAuthUrl).toHaveBeenCalledWith(expect.objectContaining({ state: expectedState }));
    const msgCalls = mockedSendTelegramMessage.mock.calls;
    expect(msgCalls.some((call) => call[1].includes(expectedState))).toBe(true);
  });

  test('sends a disconnect-offer message with a menu:settings:calendar_disconnect button when already connected', async () => {
    await handleCalendarCommand('123', { ...mockBusiness, googleRefreshToken: 'rt-1' });

    expect(mockGenerateAuthUrl).not.toHaveBeenCalled();
    const kbCalls = mockedSendTelegramMessageWithKeyboard.mock.calls;
    expect(kbCalls[0][2]).toEqual([
      [{ text: 'Αποσύνδεση Google Calendar', callback_data: 'menu:settings:calendar_disconnect' }],
    ]);
  });

  test('always ends with the back-to-menu keyboard, in both states', async () => {
    await handleCalendarCommand('123', { ...mockBusiness, googleRefreshToken: null });
    let kbCalls = mockedSendTelegramMessageWithKeyboard.mock.calls;
    expect(kbCalls[kbCalls.length - 1][2]).toEqual([[{ text: '« Πίσω στο Μενού', callback_data: 'menu:root' }]]);

    jest.clearAllMocks();
    mockedSendTelegramMessage.mockResolvedValue({ messageId: 1 });
    mockedSendTelegramMessageWithKeyboard.mockResolvedValue({ messageId: 2 });

    await handleCalendarCommand('123', { ...mockBusiness, googleRefreshToken: 'rt-1' });
    kbCalls = mockedSendTelegramMessageWithKeyboard.mock.calls;
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
    mockGenerateAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?state=x');
  });

  test("dispatches 'settings:calendar' to handleCalendarCommand, not handleSettingsToggle's default branch", async () => {
    await handleMenuCallback(
      { menuAction: 'settings:calendar', id: undefined },
      { ...mockBusiness, googleRefreshToken: null },
      '123'
    );

    const msgCalls = mockedSendTelegramMessage.mock.calls;
    expect(msgCalls.some((call) => call[1].includes('accounts.google.com'))).toBe(true);
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
