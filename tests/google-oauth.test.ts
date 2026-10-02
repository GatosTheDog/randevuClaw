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
import { google } from 'googleapis';
import {
  getOAuth2AuthUrl,
  exchangeAuthCodeForTokens,
  getOAuth2Client,
  signOAuthState,
  verifyOAuthState,
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
      'https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&prompt=consent&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.events&state=csrf-token-123'
    );

    const url = getOAuth2AuthUrl('csrf-token-123');

    expect(mockGenerateAuthUrl).toHaveBeenCalledWith({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar.events'],
      prompt: 'consent',
      state: 'csrf-token-123',
    });
    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
    expect(url).toContain('calendar');
    expect(url).toContain('csrf-token-123');
  });

  it('Test 2 (ctor): getOAuth2Client() builds OAuth2 with an options object including an 8s transporter timeout', () => {
    getOAuth2Client();

    const ctor = google.auth.OAuth2 as unknown as jest.Mock;
    const args = ctor.mock.calls[ctor.mock.calls.length - 1];
    expect(args).toHaveLength(1);
    expect(args[0]).toEqual({
      clientId: expect.any(String),
      clientSecret: expect.any(String),
      redirectUri: expect.any(String),
      transporterOptions: { timeout: 8000 },
    });
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

// Phase 31 (T-31-01): pure functions -- no new module mocks needed, they only
// use config.googleClientSecret (already available via tests/jest.setup.ts).
describe('signOAuthState / verifyOAuthState', () => {
  it('signOAuthState(5) returns "5.<64-hex-char>" and round-trips through verifyOAuthState', () => {
    const state = signOAuthState(5);
    expect(state).toMatch(/^5\.[0-9a-f]{64}$/);
    expect(verifyOAuthState(state)).toBe(5);
  });

  it('returns null when the HMAC portion has one hex character flipped', () => {
    const state = signOAuthState(5);
    const [businessIdPart, hmacPart] = state.split('.');
    const flippedChar = hmacPart[0] === 'a' ? 'b' : 'a';
    const tampered = `${businessIdPart}.${flippedChar}${hmacPart.slice(1)}`;
    expect(verifyOAuthState(tampered)).toBeNull();
  });

  it('returns null for a state missing the separator, with too many separators, or a non-numeric/zero/negative businessId portion', () => {
    const validHmacLength = signOAuthState(5).split('.')[1].length;
    const fillerHex = 'a'.repeat(validHmacLength);

    expect(verifyOAuthState('no-separator-here')).toBeNull();
    expect(verifyOAuthState(`5.${fillerHex}.extra`)).toBeNull();
    expect(verifyOAuthState(`abc.${fillerHex}`)).toBeNull();
    expect(verifyOAuthState(`0.${fillerHex}`)).toBeNull();
    expect(verifyOAuthState(`-5.${fillerHex}`)).toBeNull();
  });

  it('never throws for any input, including empty string, garbage input, and a wrong-length HMAC portion', () => {
    expect(() => verifyOAuthState('')).not.toThrow();
    expect(verifyOAuthState('')).toBeNull();

    expect(() => verifyOAuthState('not-a-state-at-all')).not.toThrow();
    expect(verifyOAuthState('not-a-state-at-all')).toBeNull();

    expect(() => verifyOAuthState('5.abcd')).not.toThrow();
    expect(verifyOAuthState('5.abcd')).toBeNull();
  });
});
