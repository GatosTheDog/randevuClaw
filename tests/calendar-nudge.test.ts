jest.mock('../src/database/queries', () => ({
  claimGoogleCalendarNudge: jest.fn(),
  releaseGoogleCalendarNudgeClaim: jest.fn(),
  clearBusinessGoogleRefreshToken: jest.fn(),
}));

jest.mock('../src/telegram/client', () => ({
  botTokenStore: { run: jest.fn((_token: string, cb: () => unknown) => cb()) },
  sendTelegramMessageWithKeyboard: jest.fn().mockResolvedValue({ messageId: 1 }),
}));

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  claimGoogleCalendarNudge,
  releaseGoogleCalendarNudgeClaim,
  clearBusinessGoogleRefreshToken,
} from '../src/database/queries';
import { botTokenStore, sendTelegramMessageWithKeyboard } from '../src/telegram/client';
import { logger } from '../src/utils/logger';
import {
  maybeSendGoogleCalendarNudge,
  handleGoogleAuthRevoked,
  GCAL_NUDGE_GREEK,
  GCAL_REVOKED_GREEK,
} from '../src/calendar/owner-nudge';
import { makeBusiness } from './helpers/calendar-fixtures';

const mockClaim = claimGoogleCalendarNudge as jest.MockedFunction<typeof claimGoogleCalendarNudge>;
const mockRelease = releaseGoogleCalendarNudgeClaim as jest.MockedFunction<
  typeof releaseGoogleCalendarNudgeClaim
>;
const mockClear = clearBusinessGoogleRefreshToken as jest.MockedFunction<
  typeof clearBusinessGoogleRefreshToken
>;
const mockSend = sendTelegramMessageWithKeyboard as jest.MockedFunction<
  typeof sendTelegramMessageWithKeyboard
>;
const mockRun = botTokenStore.run as unknown as jest.Mock;

const EXPECTED_KEYBOARD = [[{ text: 'Σύνδεση Google Calendar', callback_data: 'menu:gcal_connect' }]];

describe('src/calendar/owner-nudge.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClaim.mockResolvedValue(true);
    mockRelease.mockResolvedValue(undefined);
    mockClear.mockResolvedValue(true);
    mockSend.mockResolvedValue({ messageId: 1 });
    mockRun.mockImplementation((_t: string, cb: () => unknown) => cb());
  });

  describe('maybeSendGoogleCalendarNudge', () => {
    it('Test 1: returns false and claims nothing when the business already has a token', async () => {
      const result = await maybeSendGoogleCalendarNudge(makeBusiness({ googleRefreshToken: 'rt' }));
      expect(result).toBe(false);
      expect(mockClaim).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('Test 2: returns false and claims nothing when ownerTelegramId or botToken is missing', async () => {
      expect(
        await maybeSendGoogleCalendarNudge(makeBusiness({ googleRefreshToken: null, ownerTelegramId: null }))
      ).toBe(false);
      expect(
        await maybeSendGoogleCalendarNudge(makeBusiness({ googleRefreshToken: null, botToken: null }))
      ).toBe(false);
      expect(mockClaim).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('Test 3: claim wins -> one keyboard message with the connect button, inside botTokenStore.run', async () => {
      const business = makeBusiness({ googleRefreshToken: null });
      const result = await maybeSendGoogleCalendarNudge(business);

      expect(result).toBe(true);
      expect(mockClaim).toHaveBeenCalledWith(business.id);
      expect(mockRun).toHaveBeenCalledWith(business.botToken, expect.any(Function));
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith(business.ownerTelegramId, GCAL_NUDGE_GREEK, EXPECTED_KEYBOARD);
    });

    it('Test 4: claim loses -> nothing is sent', async () => {
      mockClaim.mockResolvedValue(false);
      const result = await maybeSendGoogleCalendarNudge(makeBusiness({ googleRefreshToken: null }));
      expect(result).toBe(false);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('Test 5: send rejects -> claim released, resolves false without throwing', async () => {
      mockSend.mockRejectedValue(new Error('telegram down'));
      const business = makeBusiness({ googleRefreshToken: null });

      await expect(maybeSendGoogleCalendarNudge(business)).resolves.toBe(false);
      expect(mockRelease).toHaveBeenCalledWith(business.id);
    });

    it('Test 5b: claim query rejecting never throws', async () => {
      mockClaim.mockRejectedValue(new Error('db down'));
      await expect(
        maybeSendGoogleCalendarNudge(makeBusiness({ googleRefreshToken: null }))
      ).resolves.toBe(false);
    });
  });

  describe('handleGoogleAuthRevoked', () => {
    it('Test 6a: clears the token, claims the flag and sends the reconnect message', async () => {
      const business = makeBusiness();
      await handleGoogleAuthRevoked(business);

      expect(mockClear).toHaveBeenCalledWith(business.id);
      expect(mockClaim).toHaveBeenCalledWith(business.id);
      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith(business.ownerTelegramId, GCAL_REVOKED_GREEK, EXPECTED_KEYBOARD);
    });

    it('Test 6b: token already cleared by another caller -> nothing sent', async () => {
      mockClear.mockResolvedValue(false);
      await handleGoogleAuthRevoked(makeBusiness());
      expect(mockClaim).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('Test 6c: never throws when clear or send fails', async () => {
      mockClear.mockRejectedValue(new Error('db down'));
      await expect(handleGoogleAuthRevoked(makeBusiness())).resolves.toBeUndefined();

      mockClear.mockResolvedValue(true);
      mockSend.mockRejectedValue(new Error('telegram down'));
      await expect(handleGoogleAuthRevoked(makeBusiness())).resolves.toBeUndefined();
    });
  });

  it('Test 7: no logger call contains the refresh token or the bot token', async () => {
    const business = makeBusiness({
      googleRefreshToken: 'SECRET_REFRESH_TOKEN_XYZ',
      botToken: 'SECRET_BOT_TOKEN_ABC',
    });
    mockSend.mockRejectedValue(new Error('telegram down'));
    mockClear.mockResolvedValue(true);
    await handleGoogleAuthRevoked(business);

    const nudgeBusiness = makeBusiness({ googleRefreshToken: null, botToken: 'SECRET_BOT_TOKEN_ABC' });
    await maybeSendGoogleCalendarNudge(nudgeBusiness);

    const logged = JSON.stringify([
      (logger.info as jest.Mock).mock.calls,
      (logger.warn as jest.Mock).mock.calls,
      (logger.error as jest.Mock).mock.calls,
    ]);
    expect(logged).not.toContain('SECRET_REFRESH_TOKEN_XYZ');
    expect(logged).not.toContain('SECRET_BOT_TOKEN_ABC');
  });
});
