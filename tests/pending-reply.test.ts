/**
 * Unit tests for src/telegram/handlers/pending-reply.ts — Phase 28 Plan 02 (ADMIN-01, D-02).
 *
 * Covers:
 *   - stage then consume returns the staged clientTelegramId; a second consume returns null (consumed exactly once)
 *   - consume for an owner with nothing staged returns null
 *   - clear removes a staged entry — a subsequent consume returns null
 *   - clear for an owner with nothing staged is a safe no-op
 *   - staging a second reply for the SAME businessId+ownerId before the first is consumed overwrites (no leaked/duplicate timer)
 *   - CR-01: a reply staged for businessId A is not visible to consume/clear for businessId B, even with the
 *     same ownerTelegramId (cross-business relay leak regression guard)
 *   - WR-03: hasPendingReply peeks without consuming
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

import { pendingReplies, stagePendingReply, consumePendingReply, clearPendingReply, hasPendingReply } from '../src/telegram/handlers/pending-reply';

const BUSINESS_A = 1;
const BUSINESS_B = 2;
const OWNER_ID = '111222333';
const CLIENT_ID = '987654321';
const CLIENT_ID_2 = '555000111';

describe('pending-reply', () => {
  afterEach(() => {
    pendingReplies.clear();
  });

  it('stage then consume returns { clientTelegramId }, a second consume returns null', () => {
    stagePendingReply(BUSINESS_A, OWNER_ID, CLIENT_ID);

    const first = consumePendingReply(BUSINESS_A, OWNER_ID);
    expect(first).toEqual({ clientTelegramId: CLIENT_ID });

    const second = consumePendingReply(BUSINESS_A, OWNER_ID);
    expect(second).toBeNull();
  });

  it('consume for an owner with nothing staged returns null', () => {
    expect(consumePendingReply(BUSINESS_A, 'no-such-owner')).toBeNull();
  });

  it('clear removes a staged entry — a subsequent consume returns null', () => {
    stagePendingReply(BUSINESS_A, OWNER_ID, CLIENT_ID);
    clearPendingReply(BUSINESS_A, OWNER_ID);

    expect(consumePendingReply(BUSINESS_A, OWNER_ID)).toBeNull();
  });

  it('clear for an owner with nothing staged is a safe no-op (does not throw)', () => {
    expect(() => clearPendingReply(BUSINESS_A, 'no-such-owner')).not.toThrow();
  });

  it('staging a second reply for the SAME businessId+ownerId before the first is consumed overwrites, no leaked/duplicate timer', () => {
    jest.useFakeTimers();
    try {
      stagePendingReply(BUSINESS_A, OWNER_ID, CLIENT_ID);
      stagePendingReply(BUSINESS_A, OWNER_ID, CLIENT_ID_2);

      const consumed = consumePendingReply(BUSINESS_A, OWNER_ID);
      expect(consumed).toEqual({ clientTelegramId: CLIENT_ID_2 });
      // Confirms exactly one entry existed for this owner, no leaked/duplicate timer.
      expect(pendingReplies.size).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('CR-01: a reply staged for businessId A is not visible to consumePendingReply for businessId B, even with the same ownerTelegramId', () => {
    // Same Telegram account (OWNER_ID) owns both Business A and Business B —
    // this is the exact scenario CR-01 describes: staging a reply while
    // handling Business A must never leak into Business B's dispatch.
    stagePendingReply(BUSINESS_A, OWNER_ID, CLIENT_ID);

    expect(consumePendingReply(BUSINESS_B, OWNER_ID)).toBeNull();
    // The Business A entry must still be intact — a failed cross-business
    // consume must not have any side effect on the real entry.
    expect(consumePendingReply(BUSINESS_A, OWNER_ID)).toEqual({ clientTelegramId: CLIENT_ID });
  });

  it('CR-01: clearPendingReply for businessId B does not clear an entry staged for businessId A', () => {
    stagePendingReply(BUSINESS_A, OWNER_ID, CLIENT_ID);

    clearPendingReply(BUSINESS_B, OWNER_ID);

    expect(consumePendingReply(BUSINESS_A, OWNER_ID)).toEqual({ clientTelegramId: CLIENT_ID });
  });

  it('WR-03: hasPendingReply returns true after staging and false after consuming, without itself consuming', () => {
    expect(hasPendingReply(BUSINESS_A, OWNER_ID)).toBe(false);

    stagePendingReply(BUSINESS_A, OWNER_ID, CLIENT_ID);
    expect(hasPendingReply(BUSINESS_A, OWNER_ID)).toBe(true);
    // Peeking must not consume — the entry is still there afterwards.
    expect(hasPendingReply(BUSINESS_A, OWNER_ID)).toBe(true);

    expect(consumePendingReply(BUSINESS_A, OWNER_ID)).toEqual({ clientTelegramId: CLIENT_ID });
    expect(hasPendingReply(BUSINESS_A, OWNER_ID)).toBe(false);
  });
});
