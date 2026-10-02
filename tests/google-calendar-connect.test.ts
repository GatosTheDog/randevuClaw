jest.mock('../src/google/oauth-state', () => ({ createOAuthStateForBusiness: jest.fn() }));
jest.mock('../src/google/oauth', () => ({ getOAuth2AuthUrl: jest.fn() }));
jest.mock('../src/telegram/client', () => ({ sendTelegramMessage: jest.fn() }));
jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { logger } from '../src/utils/logger';
import { sendTelegramMessage } from '../src/telegram/client';
import { createOAuthStateForBusiness } from '../src/google/oauth-state';
import { getOAuth2AuthUrl } from '../src/google/oauth';
import {
  handleGoogleCalendarConnect,
  GCAL_CONNECT_INSTRUCTIONS_GREEK,
  GCAL_RECONNECT_INSTRUCTIONS_GREEK,
} from '../src/telegram/handlers/google-calendar-connect';
import { Business } from '../src/database/queries';

const mockCreate = createOAuthStateForBusiness as jest.Mock;
const mockUrl = getOAuth2AuthUrl as jest.Mock;
const mockSend = sendTelegramMessage as jest.Mock;

const FAKE_URL = 'https://accounts.google.com/o/oauth2/v2/auth?state=SECRETSTATE';
const business = { id: 7, googleRefreshToken: null } as unknown as Business;

describe('handleGoogleCalendarConnect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue('SECRETSTATE');
    mockUrl.mockReturnValue(FAKE_URL);
    mockSend.mockResolvedValue({ messageId: 1 });
  });

  it('Test 1: state bound to business.id, one message with instructions and the auth URL', async () => {
    await handleGoogleCalendarConnect('123', business);

    expect(mockCreate).toHaveBeenCalledWith(7);
    expect(mockUrl).toHaveBeenCalledWith('SECRETSTATE');
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [chatId, text] = mockSend.mock.calls[0];
    expect(chatId).toBe('123');
    expect(text).toContain(GCAL_CONNECT_INSTRUCTIONS_GREEK);
    expect(text).toContain(FAKE_URL);
  });

  it('Test 2: reconnect wording when a refresh token already exists', async () => {
    await handleGoogleCalendarConnect('123', { ...business, googleRefreshToken: 'rt' } as Business);

    expect(mockSend.mock.calls[0][1]).toContain(GCAL_RECONNECT_INSTRUCTIONS_GREEK);
  });

  it('Test 3: failure sends one short Greek message, resolves, and logs no url/state', async () => {
    mockCreate.mockRejectedValue(new Error('db down'));

    await expect(handleGoogleCalendarConnect('123', business)).resolves.toBeUndefined();

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][1]).toContain('Δεν ήταν δυνατή');
    const l = logger as unknown as Record<string, jest.Mock>;
    const logs = JSON.stringify([l.info.mock.calls, l.warn.mock.calls, l.error.mock.calls]);
    expect(logs).not.toContain('SECRETSTATE');
    expect(logs).not.toContain('accounts.google.com');
  });

  it('Test 3b: send failure is contained too', async () => {
    mockSend.mockRejectedValue(new Error('telegram down'));
    await expect(handleGoogleCalendarConnect('123', business)).resolves.toBeUndefined();
  });
});
