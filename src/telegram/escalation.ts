// Phase 20: Client escalation engine (ESCL-01, ESCL-02).
//
// Sends a rich admin notification whenever a client booking is blocked by
// the enforcement gate or a full-capacity session. The escalation is
// best-effort — failures must never surface to the client response path.
//
// Security contract (T-20-01, T-20-03):
// - clientTelegramId is derived from senderTelegramId (HMAC-verified upstream).
//   It is never sourced from callback_data.
// - sendEscalationToAdmin wraps every send in try/catch and never throws.
// - botTokenStore.run scopes sends to the correct per-business bot.

import { Business, findClientBusinessRelationship } from '../database/queries';
import {
  InlineKeyboard,
  sendTelegramMessageWithKeyboard,
  botTokenStore,
} from './client';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EscalationReason = 'membership_expired' | 'class_full' | 'slotless_disabled';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Mirrors the 64-byte callback_data guard from admin-menu.ts and client-menu.ts.
// Module-local — not exported (no cross-module coupling needed).
function assertCallbackDataSize(data: string): void {
  if (Buffer.byteLength(data, 'utf8') > 64) {
    logger.warn(
      { data, bytes: Buffer.byteLength(data, 'utf8') },
      'callback_data exceeds 64 bytes — Telegram will reject'
    );
  }
}

const REASON_PHRASES: Record<EscalationReason, string> = {
  membership_expired: 'η συνδρομή έχει λήξει ή εξαντληθεί',
  class_full: 'το μάθημα είναι πλήρες',
  slotless_disabled: 'οι αιτήσεις χωρίς slot δεν είναι ενεργές',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the escalation inline keyboard for an admin notification.
 *
 * When instanceId is defined: [[approveButton, replyButton]]
 * When instanceId is absent:  [[replyButton]]
 *
 * callback_data format:
 *   approve: `escl:approve:<instanceId>:<clientTelegramId>`
 *   reply:   `escl:reply:<clientTelegramId>`
 */
export function buildEscalationKeyboard(
  clientTelegramId: string,
  instanceId?: number
): InlineKeyboard {
  const replyData = `escl:reply:${clientTelegramId}`;
  assertCallbackDataSize(replyData);
  const replyButton = { text: 'Απάντηση πελάτη', callback_data: replyData };

  if (instanceId !== undefined) {
    const approveData = `escl:approve:${instanceId}:${clientTelegramId}`;
    assertCallbackDataSize(approveData);
    const approveButton = { text: 'Εγκρίνω εξαίρεση', callback_data: approveData };
    return [[approveButton, replyButton]];
  }

  return [[replyButton]];
}

/**
 * Sends an escalation notification to the business owner's Telegram chat.
 *
 * Best-effort: this function never throws. Any error is caught and logged.
 *
 * Guards:
 * - If business.botToken is missing → log warn + return (cannot send)
 * - If business.ownerTelegramId is missing → log warn + return (no target)
 *
 * Message format:
 * "Πελάτης <displayName> προσπάθησε <action> και μπλοκαρίστηκε: <greekReason>."
 */
export async function sendEscalationToAdmin(
  business: Business,
  clientTelegramId: string,
  action: string,
  reason: EscalationReason,
  instanceId?: number
): Promise<void> {
  // Guard: cannot send without bot token or owner target
  if (!business.botToken) {
    logger.warn(
      { businessId: business.id, clientTelegramId },
      'sendEscalationToAdmin: missing botToken — skipping escalation'
    );
    return;
  }
  if (!business.ownerTelegramId) {
    logger.warn(
      { businessId: business.id, clientTelegramId },
      'sendEscalationToAdmin: missing ownerTelegramId — skipping escalation'
    );
    return;
  }

  try {
    // Resolve client display name from the relationship table
    const relationship = await findClientBusinessRelationship(business.id, clientTelegramId);
    const displayName = relationship?.clientName ?? clientTelegramId;

    const greekReason = REASON_PHRASES[reason];
    const message = `Πελάτης ${displayName} προσπάθησε ${action} και μπλοκαρίστηκε: ${greekReason}.`;

    const keyboard = buildEscalationKeyboard(clientTelegramId, instanceId);

    await botTokenStore.run(business.botToken, async () => {
      await sendTelegramMessageWithKeyboard(business.ownerTelegramId!, message, keyboard);
    });
  } catch (err) {
    logger.error(
      { err, businessId: business.id, clientTelegramId, reason },
      'sendEscalationToAdmin: failed to send escalation (best-effort, swallowing error)'
    );
  }
}
