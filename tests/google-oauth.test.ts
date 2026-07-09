const mockGenerateAuthUrl = jest.fn();
const mockGetToken = jest.fn();
const mockSetCredentials = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        generateAuthUrl: mockGenerateAuthUrl,
        getToken: mockGetToken,
        setCredentials: mockSetCredentials,
      })),
    },
  },
}));

jest.mock('../src/database/queries', () => ({
  updateBusinessGoogleRefreshToken: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { updateBusinessGoogleRefreshToken } from '../src/database/queries';
import { logger } from '../src/utils/logger';
import {
  getOAuth2AuthUrl,
  exchangeAuthCodeForTokens,
  getOAuth2Client,
} from '../src/google/oauth';

const mockedUpdateBusinessGoogleRefreshToken = updateBusinessGoogleRefreshToken as jest.MockedFunction<
  typeof updateBusinessGoogleRefreshToken
>;

describe('src/google/oauth.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Test 1: getOAuth2AuthUrl(state) returns a URL string containing access_type=offline, prompt=consent, calendar scope, and the exact state value', () => {
    mockGenerateAuthUrl.mockReturnValue(
      'https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&prompt=consent&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar&state=csrf-token-123'
    );

    const url = getOAuth2AuthUrl('csrf-token-123');

    expect(mockGenerateAuthUrl).toHaveBeenCalledWith({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar'],
      prompt: 'consent',
      state: 'csrf-token-123',
    });
    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
    expect(url).toContain('calendar');
    expect(url).toContain('csrf-token-123');
  });

  it('Test 2: exchangeAuthCodeForTokens(code) throws mentioning "refresh token" when no refresh_token is returned', async () => {
    mockGetToken.mockResolvedValue({ tokens: { access_token: 'x' } });

    await expect(exchangeAuthCodeForTokens('some-code')).rejects.toThrow(/refresh token/);
  });

  it('exchangeAuthCodeForTokens(code) returns refreshToken/accessToken when Google returns both', async () => {
    mockGetToken.mockResolvedValue({
      tokens: { refresh_token: 'rt-1', access_token: 'at-1' },
    });

    const result = await exchangeAuthCodeForTokens('some-code');

    expect(result).toEqual({ refreshToken: 'rt-1', accessToken: 'at-1' });
  });

  it('getOAuth2Client() constructs an OAuth2 client', () => {
    const client = getOAuth2Client();
    expect(client).toBeDefined();
  });

  it('storeGoogleRefreshToken calls updateBusinessGoogleRefreshToken and logs on success', async () => {
    const { storeGoogleRefreshToken } = await import('../src/google/oauth');
    mockedUpdateBusinessGoogleRefreshToken.mockResolvedValue(undefined);

    await storeGoogleRefreshToken(1, 'rt-1');

    expect(mockedUpdateBusinessGoogleRefreshToken).toHaveBeenCalledWith(1, 'rt-1');
    expect(logger.info).toHaveBeenCalledWith({ businessId: 1 }, 'Google refresh token stored');
  });
});
