/**
 * Integration tests for GET /oauth/callback — Phase 31 Plan 01 (D-03, T-31-01,
 * T-31-03, T-31-05).
 *
 * Mocks database/queries and every module transitively pulled in by
 * src/server.ts -> src/webhooks/telegram.ts (mirrors tests/telegram-webhook.test.ts's
 * mock list) so importing the real exported `app` never reaches a real DB or
 * the real Telegram API. src/google/oauth's signOAuthState/verifyOAuthState
 * are kept REAL (via jest.requireActual) so these tests exercise genuine HMAC
 * round-trips, not a stubbed signature check — only exchangeAuthCodeForTokens
 * and storeGoogleRefreshToken are mocked.
 *
 * NEVER run bare `npm test` — machine crashes on full suite.
 * Use: npm test -- --testPathPattern="google-oauth-callback" --testTimeout=20000
 */

import request from 'supertest';
import app from '../src/server';
import * as queries from '../src/database/queries';
import { signOAuthState, exchangeAuthCodeForTokens, storeGoogleRefreshToken } from '../src/google/oauth';
import { Business } from '../src/database/queries';

jest.mock('../src/database/queries');
jest.mock('../src/telegram/client');
jest.mock('../src/conversation/router');
jest.mock('../src/calendar/sync');
jest.mock('../src/telegram/registry');
jest.mock('../src/billing/queries');
jest.mock('../src/onboarding/ai-owner-agent');
jest.mock('../src/session/manager');
jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../src/google/oauth', () => {
  const actual = jest.requireActual('../src/google/oauth');
  return {
    ...actual,
    exchangeAuthCodeForTokens: jest.fn(),
    storeGoogleRefreshToken: jest.fn(),
  };
});

const KNOWN_BUSINESS: Business = {
  id: 1,
  name: 'Pilates Athens',
  slug: 'pilates-athens',
  phoneNumberId: null,
  ownerTelegramId: '999999999',
  googleRefreshToken: null,
  agendaSentDate: null,
  botToken: 'test-bot-1-token',
  webhookId: 'test-webhook-id-1',
  webhookSecret: 'test-bot-1-webhook-secret',
  enforcementPolicy: 'allow',
  bookingMode: 'open_slots',
  allowMultiBooking: false,
  cancellationCutoffEnabled: false,
  cancellationCutoffHours: 0,
  slotlessRequestsEnabled: false,
  lastSessionThresholdEnabled: false,
  lastSessionThresholdCount: 0,
  onboardingCompleted: true,
  createdAt: new Date(),
};

const mockedFindBusinessById = queries.findBusinessById as jest.MockedFunction<typeof queries.findBusinessById>;
const mockedExchangeAuthCodeForTokens = exchangeAuthCodeForTokens as jest.MockedFunction<
  typeof exchangeAuthCodeForTokens
>;
const mockedStoreGoogleRefreshToken = storeGoogleRefreshToken as jest.MockedFunction<
  typeof storeGoogleRefreshToken
>;

describe('GET /oauth/callback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('succeeds (200, stores token) for a valid code + state matching an existing business, and the response HTML contains the business name', async () => {
    const state = signOAuthState(KNOWN_BUSINESS.id);
    mockedFindBusinessById.mockResolvedValue(KNOWN_BUSINESS);
    mockedExchangeAuthCodeForTokens.mockResolvedValue({ refreshToken: 'rt-1', accessToken: 'at-1' });
    mockedStoreGoogleRefreshToken.mockResolvedValue(undefined);

    const res = await request(app).get('/oauth/callback').query({ code: 'auth-code-1', state });

    expect(res.status).toBe(200);
    expect(res.text).toContain('Pilates Athens');
    expect(mockedExchangeAuthCodeForTokens).toHaveBeenCalledTimes(1);
    expect(mockedExchangeAuthCodeForTokens).toHaveBeenCalledWith('auth-code-1');
    expect(mockedStoreGoogleRefreshToken).toHaveBeenCalledTimes(1);
    expect(mockedStoreGoogleRefreshToken).toHaveBeenCalledWith(KNOWN_BUSINESS.id, 'rt-1');
  });

  it('returns 400 for a tampered state and never calls exchangeAuthCodeForTokens', async () => {
    const state = signOAuthState(KNOWN_BUSINESS.id);
    const lastChar = state.slice(-1);
    const tampered = state.slice(0, -1) + (lastChar === 'a' ? 'b' : 'a');

    const res = await request(app).get('/oauth/callback').query({ code: 'auth-code-1', state: tampered });

    expect(res.status).toBe(400);
    expect(mockedExchangeAuthCodeForTokens).not.toHaveBeenCalled();
    expect(mockedStoreGoogleRefreshToken).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed state and never calls exchangeAuthCodeForTokens', async () => {
    const res = await request(app).get('/oauth/callback').query({ code: 'auth-code-1', state: 'not-a-real-state' });

    expect(res.status).toBe(400);
    expect(mockedExchangeAuthCodeForTokens).not.toHaveBeenCalled();
  });

  it('returns 404 for a valid state whose businessId has no matching business, and never calls exchangeAuthCodeForTokens', async () => {
    const state = signOAuthState(9999);
    mockedFindBusinessById.mockResolvedValue(null);

    const res = await request(app).get('/oauth/callback').query({ code: 'auth-code-1', state });

    expect(res.status).toBe(404);
    expect(mockedExchangeAuthCodeForTokens).not.toHaveBeenCalled();
  });

  it('returns 400 when code is missing', async () => {
    const state = signOAuthState(KNOWN_BUSINESS.id);
    const res = await request(app).get('/oauth/callback').query({ state });

    expect(res.status).toBe(400);
    expect(mockedExchangeAuthCodeForTokens).not.toHaveBeenCalled();
  });

  it('returns 400 when state is missing', async () => {
    const res = await request(app).get('/oauth/callback').query({ code: 'auth-code-1' });

    expect(res.status).toBe(400);
    expect(mockedExchangeAuthCodeForTokens).not.toHaveBeenCalled();
  });

  it('never logs the raw code, state, or refreshToken/accessToken values on any path (success, tampered state, or missing params)', async () => {
    const { logger } = jest.requireMock('../src/utils/logger') as { logger: Record<string, jest.Mock> };

    const secretCode = 'super-secret-auth-code-xyz';
    const secretRefreshToken = 'super-secret-refresh-token-xyz';
    const secretAccessToken = 'super-secret-access-token-xyz';
    const validState = signOAuthState(KNOWN_BUSINESS.id);

    mockedFindBusinessById.mockResolvedValue(KNOWN_BUSINESS);
    mockedExchangeAuthCodeForTokens.mockResolvedValue({
      refreshToken: secretRefreshToken,
      accessToken: secretAccessToken,
    });
    mockedStoreGoogleRefreshToken.mockResolvedValue(undefined);

    await request(app).get('/oauth/callback').query({ code: secretCode, state: validState });
    await request(app)
      .get('/oauth/callback')
      .query({ code: secretCode, state: validState.slice(0, -1) + 'x' });
    await request(app).get('/oauth/callback').query({});

    const allLoggedArgs = [...logger.error.mock.calls, ...logger.warn.mock.calls, ...logger.info.mock.calls];
    const serialized = JSON.stringify(allLoggedArgs);

    expect(serialized).not.toContain(secretCode);
    expect(serialized).not.toContain(secretRefreshToken);
    expect(serialized).not.toContain(secretAccessToken);
    expect(serialized).not.toContain(validState);
  });
});
