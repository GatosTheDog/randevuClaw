// Phase 17: Admin menu handler module.
//
// This module owns all admin menu rendering and callback dispatch for Phase 17.
// Plans 17-02, 17-03, and 17-04 will add handler functions to this file.
//
// Security contract (T-17-01, T-17-02, T-17-03):
// - All DB lookups inside menu handlers re-derive businessId from senderTelegramId
//   via findBusinessByOwnerTelegramId — never trust an ID in callback_data as a
//   business identifier (cross-tenant guard, mirrors billing/slotless patterns).
// - /menu pre-emption in handleFoundBusiness already validates ownerTelegramId
//   before reaching showAdminRootMenu.

import { Business } from '../../database/queries';
import { InlineKeyboard, sendTelegramMessage, sendTelegramMessageWithKeyboard } from '../client';
import { logger } from '../../utils/logger';

// Exported so telegram.ts can use it in the parseCallbackData return union.
// Discriminant field: menuAction — unique across all existing result types
// (bookingId, firstId, slotlessRequestId, businessId) per RESEARCH.md Pitfall 1.
export type MenuCallbackResult = {
  menuAction: string;
  id?: number;
};

// Mirrors the 64-byte callback_data guard from payment-flow.ts (T-17-05).
// Logs a warning if a proposed callback_data string exceeds Telegram's 64-byte
// limit. Never throws — a warning is the correct response here since all
// proposed strings were verified at design time to be well under the limit.
function assertCallbackDataSize(data: string): void {
  if (Buffer.byteLength(data, 'utf8') > 64) {
    logger.warn(
      { data, bytes: Buffer.byteLength(data, 'utf8') },
      'callback_data exceeds 64 bytes — Telegram will reject'
    );
  }
}

/**
 * Sends the four-button 2x2 admin root menu keyboard to the owner.
 * Called when the owner sends exactly '/menu' (AMENU-01).
 * Also called via handleMenuCallback when 'menu:root' callback is received,
 * allowing the owner to navigate back to the root from any sub-menu.
 *
 * Keyboard layout (2 rows of 2):
 *   Row 1: Ρυθμίσεις | Μαθήματα
 *   Row 2: Πελάτες   | Ατζέντα Σήμερα
 */
export async function showAdminRootMenu(chatId: string, business: Business): Promise<void> {
  const callbackDataSettings = 'menu:settings';
  const callbackDataClasses = 'menu:classes';
  const callbackDataClients = 'menu:clients';
  const callbackDataAgenda = 'menu:agenda';

  // Validate all four callback_data strings (project convention from payment-flow.ts).
  // All are well under 64 bytes but the check is enforced as a guard.
  assertCallbackDataSize(callbackDataSettings);
  assertCallbackDataSize(callbackDataClasses);
  assertCallbackDataSize(callbackDataClients);
  assertCallbackDataSize(callbackDataAgenda);

  const keyboard: InlineKeyboard = [
    [
      { text: 'Ρυθμίσεις', callback_data: callbackDataSettings },
      { text: 'Μαθήματα', callback_data: callbackDataClasses },
    ],
    [
      { text: 'Πελάτες', callback_data: callbackDataClients },
      { text: 'Ατζέντα Σήμερα', callback_data: callbackDataAgenda },
    ],
  ];

  await sendTelegramMessageWithKeyboard(
    chatId,
    `Πίνακας Ελέγχου — ${business.name}`,
    keyboard
  );
}

/**
 * Central dispatcher for all admin menu callback_query events.
 * Called from handleCallbackQuery in telegram.ts after 'menuAction' in parsed
 * discriminates to MenuCallbackResult.
 *
 * In Plan 17-01 only the 'root' case is handled.
 * Plans 17-02, 17-03, and 17-04 add 'settings', 'agenda', 'classes',
 * 'clients', and their sub-action cases.
 *
 * NOTE: answerCallbackQuery has already been called by the time this function
 * is reached (RESEARCH.md Pitfall 4). Do NOT call it again here.
 */
export async function handleMenuCallback(
  result: MenuCallbackResult,
  business: Business,
  chatId: string
): Promise<void> {
  switch (result.menuAction) {
    case 'root':
      await showAdminRootMenu(chatId, business);
      break;
    default:
      // Unknown menu action — Plans 17-02/17-03/17-04 will fill in the remaining cases.
      await sendTelegramMessage(chatId, 'Άγνωστη ενέργεια μενού.');
      break;
  }
}
