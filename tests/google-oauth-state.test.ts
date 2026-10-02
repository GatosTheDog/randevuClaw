jest.mock('../src/database/queries', () => ({
  insertGoogleOauthState: jest.fn(),
  consumeGoogleOauthState: jest.fn(),
  deleteExpiredGoogleOauthStates: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import {
  insertGoogleOauthState,
  consumeGoogleOauthState,
  deleteExpiredGoogleOauthStates,
} from '../src/database/queries';
import { createOAuthStateForBusiness, consumeOAuthState, hashOAuthState } from '../src/google/oauth-state';

const mockInsert = insertGoogleOauthState as jest.Mock;
const mockConsume = consumeGoogleOauthState as jest.Mock;
const mockPurge = deleteExpiredGoogleOauthStates as jest.Mock;

describe('src/google/oauth-state.ts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Test 3: creates a 64-char hex state, stores only its hash with a ~10 min expiry, purges best-effort', async () => {
    mockPurge.mockRejectedValue(new Error('purge failed'));
    mockInsert.mockResolvedValue(undefined);

    const before = Date.now();
    const state = await createOAuthStateForBusiness(7);

    expect(state).toMatch(/^[a-f0-9]{64}$/);
    expect(mockPurge).toHaveBeenCalledTimes(1);
    const [hash, businessId, expiresAt] = mockInsert.mock.calls[0];
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toBe(state);
    expect(hash).toBe(hashOAuthState(state));
    expect(businessId).toBe(7);
    const delta = (expiresAt as Date).getTime() - before;
    expect(delta).toBeGreaterThan(9 * 60 * 1000);
    expect(delta).toBeLessThan(11 * 60 * 1000);
  });

  it('Test 4: consume rejects non-strings and malformed values without touching the DB', async () => {
    for (const bad of [undefined, null, 42, {}, ['a'.repeat(64)], '', 'xyz', 'A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)]) {
      expect(await consumeOAuthState(bad)).toBeNull();
    }
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it('Test 5: consume looks up by hash (never the raw state) and returns the businessId', async () => {
    const state = 'ab'.repeat(32);
    mockConsume.mockResolvedValue(7);

    expect(await consumeOAuthState(state)).toBe(7);
    expect(mockConsume).toHaveBeenCalledWith(hashOAuthState(state));
    expect(mockConsume).not.toHaveBeenCalledWith(state);
  });

  it('Test 6: single use is delegated to the atomic delete (7 then null)', async () => {
    const state = 'cd'.repeat(32);
    mockConsume.mockResolvedValueOnce(7).mockResolvedValueOnce(null);

    expect(await consumeOAuthState(state)).toBe(7);
    expect(await consumeOAuthState(state)).toBeNull();
  });
});
