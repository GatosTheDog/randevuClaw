import fs from 'fs';
import path from 'path';
import express from 'express';
import request from 'supertest';

jest.mock('../src/google/oauth-state', () => ({ consumeOAuthState: jest.fn() }));
jest.mock('../src/google/oauth', () => ({
  exchangeAuthCodeForTokens: jest.fn(),
  storeGoogleRefreshToken: jest.fn(),
}));
jest.mock('../src/database/queries', () => ({ findBusinessById: jest.fn() }));
jest.mock('../src/telegram/client', () => ({
  botTokenStore: { run: jest.fn((_t: string, cb: () => unknown) => cb()) },
  sendTelegramMessage: jest.fn(),
}));
jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { config } from '../src/config';
import { logger } from '../src/utils/logger';
import { botTokenStore, sendTelegramMessage } from '../src/telegram/client';
import { findBusinessById } from '../src/database/queries';
import { consumeOAuthState } from '../src/google/oauth-state';
import { exchangeAuthCodeForTokens, storeGoogleRefreshToken } from '../src/google/oauth';
import {
  handleGoogleOAuthCallback,
  getGoogleOAuthCallbackPath,
  GCAL_CONNECTED_GREEK,
  GCAL_DENIED_GREEK,
  GCAL_CONNECT_FAILED_GREEK,
} from '../src/google/callback';

const mockConsume = consumeOAuthState as jest.Mock;
const mockFind = findBusinessById as jest.Mock;
const mockExchange = exchangeAuthCodeForTokens as jest.Mock;
const mockStore = storeGoogleRefreshToken as jest.Mock;
const mockSend = sendTelegramMessage as jest.Mock;
const mockRun = botTokenStore.run as unknown as jest.Mock;

const STATE = 'ab'.repeat(32);

interface FakeRes {
  statusCode?: number;
  headers: Record<string, string>;
  body?: string;
  headersSent: boolean;
  status: jest.Mock;
  set: jest.Mock;
  send: jest.Mock;
}

function makeRes(): FakeRes {
  const res = { headers: {}, headersSent: false } as FakeRes;
  res.status = jest.fn((c: number) => {
    res.statusCode = c;
    return res;
  });
  res.set = jest.fn((h: Record<string, string>) => {
    Object.assign(res.headers, h);
    return res;
  });
  res.send = jest.fn((b: string) => {
    res.body = b;
    return res;
  });
  return res;
}

async function call(query: Record<string, unknown>): Promise<FakeRes> {
  const res = makeRes();
  await handleGoogleOAuthCallback({ query } as never, res as never);
  return res;
}

function allLogs(): string {
  const l = logger as unknown as Record<string, jest.Mock>;
  return JSON.stringify([l.info.mock.calls, l.warn.mock.calls, l.error.mock.calls]);
}

const business = { id: 7, ownerTelegramId: '555', botToken: 'bot-tok' };

describe('handleGoogleOAuthCallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRun.mockImplementation((_t: string, cb: () => unknown) => cb());
    mockConsume.mockResolvedValue(7);
    mockFind.mockResolvedValue(business);
    mockExchange.mockResolvedValue({ refreshToken: 'rt-new', accessToken: 'at' });
    mockStore.mockResolvedValue(undefined);
    mockSend.mockResolvedValue({ messageId: 1 });
  });

  it('Test 1: happy path stores the token and confirms to the owner via the business bot', async () => {
    const res = await call({ state: STATE, code: 'auth-code' });

    expect(mockExchange).toHaveBeenCalledWith('auth-code');
    expect(mockStore).toHaveBeenCalledWith(7, 'rt-new');
    expect(mockRun).toHaveBeenCalledWith('bot-tok', expect.any(Function));
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith('555', GCAL_CONNECTED_GREEK);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('lang="el"');
  });

  it('Test 2: ignores business_id/owner_id query parameters (cross-tenant guard)', async () => {
    await call({ state: STATE, code: 'c', business_id: '99', owner_id: 'x' });

    expect(mockFind).toHaveBeenCalledWith(7);
    expect(mockStore).toHaveBeenCalledWith(7, 'rt-new');
  });

  it('Test 3: unknown/expired state -> 400, no exchange, state not echoed', async () => {
    mockConsume.mockResolvedValue(null);
    const res = await call({ state: STATE, code: 'c' });

    expect(res.statusCode).toBe(400);
    expect(mockExchange).not.toHaveBeenCalled();
    expect(mockStore).not.toHaveBeenCalled();
    expect(res.body).not.toContain(STATE);
  });

  it('Test 4: missing or non-string state/code -> 400 and consume never gets a non-string', async () => {
    const missing = await call({ code: 'c' });
    expect(missing.statusCode).toBe(400);

    const arr = await call({ state: [STATE, STATE], code: 'c' });
    expect(arr.statusCode).toBe(400);
    const obj = await call({ state: { a: 'b' }, code: 'c' });
    expect(obj.statusCode).toBe(400);

    expect(mockConsume).not.toHaveBeenCalled();

    // non-string code with valid state: no exchange
    const badCode = await call({ state: STATE, code: ['x'] });
    expect(badCode.statusCode).toBe(400);
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it('Test 5: replay -> second request 400, exchange called once overall', async () => {
    mockConsume.mockResolvedValueOnce(7).mockResolvedValueOnce(null);
    const first = await call({ state: STATE, code: 'c' });
    const second = await call({ state: STATE, code: 'c' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(400);
    expect(mockExchange).toHaveBeenCalledTimes(1);
  });

  it('Test 6: access_denied consumes the state, skips exchange, notifies owner', async () => {
    const res = await call({ state: STATE, error: 'access_denied' });

    expect(mockConsume).toHaveBeenCalledTimes(1);
    expect(mockExchange).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(mockSend).toHaveBeenCalledWith('555', GCAL_DENIED_GREEK);
  });

  it('Test 7: valid state without code -> 400, no exchange', async () => {
    const res = await call({ state: STATE });

    expect(res.statusCode).toBe(400);
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it('Test 8: exchange failure -> 502, failure message, no store, secrets not logged', async () => {
    mockExchange.mockRejectedValue(
      Object.assign(new Error('invalid request'), {
        config: { data: 'refresh_token=SECRET_TOKEN_123' },
        response: { status: 400, data: { error: 'invalid_grant' } },
      })
    );
    const res = await call({ state: STATE, code: 'c' });

    expect(res.statusCode).toBe(502);
    expect(mockStore).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledWith('555', GCAL_CONNECT_FAILED_GREEK);
    expect(allLogs()).not.toContain('SECRET_TOKEN_123');
  });

  it('Test 9: XSS payload in error is not echoed', async () => {
    const res = await call({ state: STATE, error: '<script>alert(1)</script>' });

    expect(res.body).not.toContain('<script>');
    expect(res.body).not.toContain('alert(1)');
  });

  it('Test 10: logs contain neither the new token nor the raw state', async () => {
    await call({ state: STATE, code: 'c' });
    await call({ state: STATE, error: 'access_denied' });
    mockConsume.mockResolvedValueOnce(null);
    await call({ state: STATE, code: 'c' });

    const logs = allLogs();
    expect(logs).not.toContain('rt-new');
    expect(logs).not.toContain(STATE);
    expect(logs).toContain('"businessId":7');
  });

  it('Test 11: every response carries the hardening headers', async () => {
    const responses = [
      await call({ state: STATE, code: 'c' }),
      await call({}),
      await call({ state: STATE, error: 'access_denied' }),
    ];
    for (const res of responses) {
      expect(res.headers['Cache-Control']).toBe('no-store');
      expect(res.headers['Referrer-Policy']).toBe('no-referrer');
      expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
      expect(res.headers['Content-Security-Policy']).toMatch(/^default-src 'none'/);
    }
  });

  it('Test 12: route path follows GOOGLE_REDIRECT_URI and is wired in server.ts', async () => {
    const callbackPath = getGoogleOAuthCallbackPath();
    expect(callbackPath).toBe(new URL(config.googleRedirectUri).pathname);

    const app = express();
    app.get(callbackPath, handleGoogleOAuthCallback);
    const response = await request(app).get(callbackPath).query({ state: STATE, code: 'c' });
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');

    const serverSource = fs.readFileSync(path.join(__dirname, '../src/server.ts'), 'utf8');
    expect(serverSource).toContain('app.get(getGoogleOAuthCallbackPath(), handleGoogleOAuthCallback)');
  });

  it('never throws: unexpected failure yields 500 page', async () => {
    mockConsume.mockRejectedValue(new Error('db down'));
    const res = await call({ state: STATE, code: 'c' });
    expect(res.statusCode).toBe(500);
  });
});
