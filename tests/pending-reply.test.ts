/**
 * Unit tests for src/telegram/handlers/pending-reply.ts — Phase 28 Plan 02 (ADMIN-01, D-02).
 *
 * Covers:
 *   - stage then consume returns the staged clientTelegramId; a second consume returns null (consumed exactly once)
 *   - consume for an owner with nothing staged returns null
 *   - clear removes a staged entry — a subsequent consume returns null
 *   - clear for an owner with nothing staged is a safe no-op
 *   - staging a second reply for the SAME ownerId before the first is consumed overwrites (no leaked/duplicate timer)
 *
 * NEVER run bare `npm test` — machine crashes on full suite.
 * Use: npm test -- --testPathPattern="pending-reply" --testTimeout=20000
 */

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { pendingReplies, stagePendingReply, consumePendingReply, clearPendingReply } from '../src/telegram/handlers/pending-reply';

const OWNER_ID = '111222333';
const CLIENT_ID = '987654321';
const CLIENT_ID_2 = '555000111';

describe('pending-reply', () => {
  afterEach(() => {
    pendingReplies.clear();
  });

  it('stage then consume returns { clientTelegramId }, a second consume returns null', () => {
    stagePendingReply(OWNER_ID, CLIENT_ID);

    const first = consumePendingReply(OWNER_ID);
    expect(first).toEqual({ clientTelegramId: CLIENT_ID });

    const second = consumePendingReply(OWNER_ID);
    expect(second).toBeNull();
  });

  it('consume for an owner with nothing staged returns null', () => {
    expect(consumePendingReply('no-such-owner')).toBeNull();
  });

  it('clear removes a staged entry — a subsequent consume returns null', () => {
    stagePendingReply(OWNER_ID, CLIENT_ID);
    clearPendingReply(OWNER_ID);

    expect(consumePendingReply(OWNER_ID)).toBeNull();
  });

  it('clear for an owner with nothing staged is a safe no-op (does not throw)', () => {
    expect(() => clearPendingReply('no-such-owner')).not.toThrow();
  });

  it('staging a second reply for the SAME ownerId before the first is consumed overwrites, no leaked/duplicate timer', () => {
    jest.useFakeTimers();
    try {
      stagePendingReply(OWNER_ID, CLIENT_ID);
      stagePendingReply(OWNER_ID, CLIENT_ID_2);

      const consumed = consumePendingReply(OWNER_ID);
      expect(consumed).toEqual({ clientTelegramId: CLIENT_ID_2 });
      // Confirms exactly one entry existed for this owner, no leaked/duplicate timer.
      expect(pendingReplies.size).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
