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
import { listSessions, cancelSession } from '../../session/manager';

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

// ---------------------------------------------------------------------------
// AMENU-03: Classes sub-menu
// ---------------------------------------------------------------------------

/**
 * Shows upcoming sessions for the next 7 days as message text, plus three
 * action buttons: Cancel a class, New class (chat redirect), Back.
 *
 * listSessions uses RLS-enforced connection when called within withBusinessContext;
 * business.id here is always re-derived from senderTelegramId in telegram.ts
 * (cross-tenant guard, T-17-11).
 */
export async function showClassesMenu(chatId: string, business: Business): Promise<void> {
  const sessions = await listSessions(business.id, 7);

  let messageText: string;
  if (sessions.length > 0) {
    const lines = sessions.map(
      (s) => `${s.sessionDate} ${s.sessionTime} — ${s.bookedCount}/${s.capacity} θέσεις`
    );
    messageText = 'Επερχόμενα μαθήματα (7 ημέρες):\n\n' + lines.join('\n');
  } else {
    messageText = 'Δεν υπάρχουν προγραμματισμένα μαθήματα για τις επόμενες 7 ημέρες.';
  }

  const cancelListData = 'menu:classes:cancel_list';
  const createData = 'menu:classes:create';
  const backData = 'menu:root';
  assertCallbackDataSize(cancelListData);
  assertCallbackDataSize(createData);
  assertCallbackDataSize(backData);

  const keyboard: InlineKeyboard = [
    [{ text: 'Ακύρωση μαθήματος', callback_data: cancelListData }],
    [{ text: 'Νέο μάθημα (chat)', callback_data: createData }],
    [{ text: '« Πίσω στο Μενού', callback_data: backData }],
  ];

  await sendTelegramMessageWithKeyboard(chatId, messageText, keyboard);
}

/**
 * Shows upcoming sessions (up to 30 days forward, capped at 10) as inline
 * buttons for selection. Owner taps a session to trigger Ναι/Όχι confirmation.
 *
 * 'menu:classes:cancel_confirm_req:9999999' = 38 bytes — within Telegram 64-byte limit.
 */
export async function showCancelClassList(chatId: string, business: Business): Promise<void> {
  const sessions = await listSessions(business.id, 30);

  const backButton = { text: '« Πίσω στο Μενού', callback_data: 'menu:root' };

  if (sessions.length === 0) {
    await sendTelegramMessageWithKeyboard(chatId, 'Δεν υπάρχουν επερχόμενα μαθήματα.', [
      [backButton],
    ]);
    return;
  }

  const capped = sessions.slice(0, 10);
  const keyboard: InlineKeyboard = capped.map((s) => {
    const cbData = `menu:classes:cancel_confirm_req:${s.instanceId}`;
    assertCallbackDataSize(cbData);
    return [{ text: `${s.sessionDate} ${s.sessionTime}`, callback_data: cbData }];
  });

  if (sessions.length > 10) {
    keyboard.push([backButton]);
    await sendTelegramMessageWithKeyboard(
      chatId,
      `Επίλεξε μάθημα για ακύρωση: (εμφανίζονται τα πρώτα 10 από ${sessions.length})`,
      keyboard
    );
  } else {
    keyboard.push([backButton]);
    await sendTelegramMessageWithKeyboard(chatId, 'Επίλεξε μάθημα για ακύρωση:', keyboard);
  }
}

// ---------------------------------------------------------------------------
// AMENU-06: Ναι/Όχι cancel confirmation flow
// ---------------------------------------------------------------------------

/**
 * Sends a Ναι/Όχι confirmation keyboard for the selected session instance (AMENU-06).
 *
 * 'menu:classes:cancel_yes:9999999' = 35 bytes — within 64-byte limit.
 * 'menu:classes:cancel_no:9999999'  = 34 bytes — within 64-byte limit.
 */
export async function showCancelClassConfirm(chatId: string, instanceId: number): Promise<void> {
  const cancelConfirmData = `menu:classes:cancel_yes:${instanceId}`;
  const cancelAbortData = `menu:classes:cancel_no:${instanceId}`;
  assertCallbackDataSize(cancelConfirmData);
  assertCallbackDataSize(cancelAbortData);

  await sendTelegramMessageWithKeyboard(
    chatId,
    `Να ακυρωθεί το μάθημα #${instanceId};`,
    [
      [
        { text: 'Ναι', callback_data: cancelConfirmData },
        { text: 'Όχι', callback_data: cancelAbortData },
      ],
    ]
  );
}

/**
 * Calls cancelSession and sends a Greek result message.
 *
 * Cross-tenant safety: cancelSession validates ownership via the businessId
 * FK chain on sessionCatalog (RESEARCH.md Pitfall 5). business.id is always
 * re-derived from senderTelegramId in telegram.ts (T-17-10, T-17-11).
 */
export async function handleClassCancelExecute(
  chatId: string,
  business: Business,
  instanceId: number
): Promise<void> {
  const cancelled = await cancelSession(business.id, instanceId);
  if (cancelled) {
    await sendTelegramMessage(chatId, 'Το μάθημα ακυρώθηκε.');
  } else {
    await sendTelegramMessage(chatId, 'Το μάθημα δεν βρέθηκε ή είχε ήδη ακυρωθεί.');
  }
  // After result, show back button
  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', [
    [{ text: '« Πίσω στο Μενού', callback_data: 'menu:root' }],
  ]);
}

/**
 * Central dispatcher for all admin menu callback_query events.
 * Called from handleCallbackQuery in telegram.ts after 'menuAction' in parsed
 * discriminates to MenuCallbackResult.
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

    // AMENU-03: Classes sub-menu entry point
    case 'classes':
      await showClassesMenu(chatId, business);
      break;

    // AMENU-03: Show upcoming sessions as selectable inline buttons for cancellation
    case 'classes:cancel_list':
      await showCancelClassList(chatId, business);
      break;

    // AMENU-03: Create recurring class — redirect to chat (aiOwnerAgent handles it)
    case 'classes:create':
      await sendTelegramMessage(
        chatId,
        'Για να δημιουργήσεις νέο επαναλαμβανόμενο μάθημα, γράψε μου στο chat ' +
          '(π.χ. "Δημιούργησε Pilates Δευτέρα Τετάρτη 10:00 15 θέσεις").'
      );
      break;

    // AMENU-06: Session selected from cancel list — show Ναι/Όχι confirmation
    case 'classes:cancel_confirm_req': {
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: λείπει το αναγνωριστικό μαθήματος.');
        return;
      }
      await showCancelClassConfirm(chatId, result.id);
      break;
    }

    // AMENU-06: Owner confirmed cancellation (Ναι)
    case 'classes:cancel_yes': {
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: λείπει το αναγνωριστικό μαθήματος.');
        return;
      }
      await handleClassCancelExecute(chatId, business, result.id);
      break;
    }

    // AMENU-06: Owner aborted cancellation (Όχι)
    case 'classes:cancel_no': {
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: λείπει το αναγνωριστικό μαθήματος.');
        return;
      }
      await sendTelegramMessage(chatId, 'Η ακύρωση ματαιώθηκε.');
      await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', [
        [{ text: '« Πίσω στο Μενού', callback_data: 'menu:root' }],
      ]);
      break;
    }

    default:
      // Unknown menu action — Plans 17-02 and 17-04 will fill in the remaining cases.
      await sendTelegramMessage(chatId, 'Άγνωστη ενέργεια μενού.');
      break;
  }
}
