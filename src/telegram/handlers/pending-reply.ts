// ---------------------------------------------------------------------------
// Phase 28 (ADMIN-01, D-01/D-02/D-03): escalation "reply to client" relay
// staging area.
// ---------------------------------------------------------------------------
// When an owner taps the "Απάντηση πελάτη" button on an escalation
// notification, the owner's NEXT free-text message must be relayed verbatim
// to the escalating client instead of being routed to aiOwnerAgent (D-01).
// This module stages that intent in-process (mirroring
// ai-owner-agent.ts's pendingServicePriceChanges precedent, D-02) — keyed by
// a `${businessId}:${ownerTelegramId}` composite so one owner's pending
// reply is structurally unreachable from another owner's consumePendingReply
// call (T-28-05) AND scoped per-business, mirroring every other owner-scoped
// branch in telegram.ts (menuAction, sbkAction, otcAction), which all reuse
// the webhook-scoped `business` param instead of re-deriving business from
// senderTelegramId — because a single Telegram account can own more than
// one business (CR-01 fix: the original ownerTelegramId-only key allowed a
// reply staged for Business A to be consumed by an unrelated free-text
// message sent to Business B's bot, relaying Business A's client content
// through Business B's bot identity).
//
// D-02 accepted tradeoff: this Map is never persisted to the database. A
// process restart silently drops all pending replies; the owner's only
// recourse is to re-tap the escalation reply button. This is intentional —
// not a bug — and mirrors the same non-persistence tradeoff already accepted
// for pendingServicePriceChanges.
import { logger } from '../../utils/logger';

const PENDING_REPLY_TTL_MS = 10 * 60 * 1000; // 10 minutes, matching pendingServicePriceChanges's TTL (D-02)

function pendingReplyKey(businessId: number, ownerTelegramId: string): string {
  return `${businessId}:${ownerTelegramId}`;
}

export const pendingReplies = new Map<
  string, // `${businessId}:${ownerTelegramId}`
  { clientTelegramId: string; timer: ReturnType<typeof setTimeout> }
>();

/**
 * Stage a pending reply for (businessId, ownerTelegramId), targeting
 * clientTelegramId. Mirrors setPendingServicePriceChange's WR-01 overwrite
 * pattern exactly: any existing entry for this business+owner has its timer
 * cleared first, so staging a second reply before the first is consumed can
 * never leave a dangling early-deletion timer scheduled against the newer
 * entry.
 */
export function stagePendingReply(
  businessId: number,
  ownerTelegramId: string,
  clientTelegramId: string
): void {
  const key = pendingReplyKey(businessId, ownerTelegramId);
  const existing = pendingReplies.get(key);
  if (existing) clearTimeout(existing.timer);

  // Calling unref on this timer is load-bearing (mirrors the Rule-3 precedent
  // in ai-owner-agent.ts's setPendingServicePriceChange): without it, a Jest
  // worker process exercising this module would hang past its test-suite
  // timeout waiting for this 10-minute timer to fire. Production behavior
  // (the entry still self-expires after 10 minutes) is unaffected.
  const timer = setTimeout(() => {
    pendingReplies.delete(key);
    logger.debug({ businessId, ownerTelegramId }, 'Pending reply expired');
  }, PENDING_REPLY_TTL_MS).unref();

  pendingReplies.set(key, { clientTelegramId, timer });
  logger.debug({ businessId, ownerTelegramId, clientTelegramId }, 'Pending reply staged');
}

/**
 * Consume (read + remove) the pending reply staged for (businessId,
 * ownerTelegramId). Returns null when nothing is staged for this business.
 * Consuming an entry clears its expiry timer and deletes it from the Map —
 * a second call immediately after always returns null.
 */
export function consumePendingReply(
  businessId: number,
  ownerTelegramId: string
): { clientTelegramId: string } | null {
  const key = pendingReplyKey(businessId, ownerTelegramId);
  const entry = pendingReplies.get(key);
  if (!entry) return null;

  clearTimeout(entry.timer);
  pendingReplies.delete(key);
  logger.debug({ businessId, ownerTelegramId }, 'Pending reply consumed');
  return { clientTelegramId: entry.clientTelegramId };
}

/**
 * Peek (read-only, non-consuming) whether a pending reply is currently
 * staged for (businessId, ownerTelegramId). WR-03: lets callers distinguish
 * "no reply staged, route normally" from "a reply IS staged but this
 * particular incoming message can't be relayed" (e.g. a non-text
 * photo/sticker/voice message, which arrives as messageText === '') without
 * consuming (and thus destroying) the staged entry in the latter case.
 */
export function hasPendingReply(businessId: number, ownerTelegramId: string): boolean {
  return pendingReplies.has(pendingReplyKey(businessId, ownerTelegramId));
}

/**
 * Clear any pending reply staged for (businessId, ownerTelegramId) without
 * consuming it (D-03: called when the owner navigates via /menu or /start
 * before typing their reply, so a stale pending reply never accidentally
 * relays a later, unrelated message to the wrong client). Safe no-op when
 * nothing is staged.
 */
export function clearPendingReply(businessId: number, ownerTelegramId: string): void {
  const key = pendingReplyKey(businessId, ownerTelegramId);
  const entry = pendingReplies.get(key);
  if (!entry) return;

  clearTimeout(entry.timer);
  pendingReplies.delete(key);
  logger.debug({ businessId, ownerTelegramId }, 'Pending reply cleared (navigation)');
}
