// Phase 18: Client menu handler module.
//
// This module owns all client menu rendering and callback dispatch for Phase 18.
// Plans 18-02, 18-03, and 18-04 will add handler functions to this file.
//
// Security contract (T-18-01, T-18-02, T-18-03):
// - business is received from handleCallbackQuery which receives it from
//   handleTelegramWebhookPost (HMAC-verified). clientMenuAction is a route selector
//   only — no business data is read from callback_data.
// - /start pre-emption in handleFoundBusiness client branch validates that
//   the sender is NOT the owner before reaching showClientRootMenu.

import { Business } from '../../database/queries';
import { InlineKeyboard, sendTelegramMessage, sendTelegramMessageWithKeyboard } from '../client';
import { logger } from '../../utils/logger';

// Exported so telegram.ts can use it in the parseCallbackData return union.
// Discriminant field: clientMenuAction — unique across all existing result types
// (bookingId/action, firstId, slotlessRequestId, businessId, menuAction) per RESEARCH.md.
export type ClientMenuCallbackResult = {
  clientMenuAction: string;
  id?: number;
};

// Mirrors the 64-byte callback_data guard from admin-menu.ts (T-17-05 / T-18-05).
// Copied verbatim — not imported from admin-menu.ts because it is not exported there
// (adding an export would create unnecessary coupling per RESEARCH.md Pitfall 4).
function assertCallbackDataSize(data: string): void {
  if (Buffer.byteLength(data, 'utf8') > 64) {
    logger.warn(
      { data, bytes: Buffer.byteLength(data, 'utf8') },
      'callback_data exceeds 64 bytes — Telegram will reject'
    );
  }
}

/**
 * Sends the four-button 2x2 client root menu keyboard (CMENU-01).
 * Shown when the client sends /start.
 */
export async function showClientRootMenu(chatId: string, business: Business): Promise<void> {
  const callbackDataBook = 'cmenu:book';
  const callbackDataBookings = 'cmenu:bookings';
  const callbackDataCancel = 'cmenu:cancel';
  const callbackDataBalance = 'cmenu:balance';

  assertCallbackDataSize(callbackDataBook);
  assertCallbackDataSize(callbackDataBookings);
  assertCallbackDataSize(callbackDataCancel);
  assertCallbackDataSize(callbackDataBalance);

  const keyboard: InlineKeyboard = [
    [
      { text: 'Κράτηση μαθήματος', callback_data: callbackDataBook },
      { text: 'Οι κρατήσεις μου', callback_data: callbackDataBookings },
    ],
    [
      { text: 'Ακύρωση κράτησης', callback_data: callbackDataCancel },
      { text: 'Υπόλοιπο μαθημάτων', callback_data: callbackDataBalance },
    ],
  ];

  await sendTelegramMessageWithKeyboard(
    chatId,
    `Καλώς ήρθες! Τι θέλεις να κάνεις;`,
    keyboard
  );

  // Suppress unused variable warning — business will be used in later plans
  void business;
}

// ---------------------------------------------------------------------------
// Central dispatcher (Plan 18-01 skeleton; 18-02, 18-03, 18-04 add cases)
// ---------------------------------------------------------------------------

export async function handleClientMenuCallback(
  result: ClientMenuCallbackResult,
  business: Business,
  chatId: string
): Promise<void> {
  const { clientMenuAction } = result;

  switch (true) {
    case clientMenuAction === 'root':
      await showClientRootMenu(chatId, business);
      break;

    default:
      await sendTelegramMessage(chatId, 'Άγνωστη ενέργεια.');
      break;
  }
}
