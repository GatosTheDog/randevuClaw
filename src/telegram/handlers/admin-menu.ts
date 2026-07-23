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

import { eq } from 'drizzle-orm';
import { db } from '../../database/db';
import { Business, findServiceById, listBookingsForDate } from '../../database/queries';
import { businesses } from '../../database/schema';
import { formatAgendaMessage } from '../../scheduler/agenda';
import { isoDateInAthens } from '../../utils/timezone';
import { logger } from '../../utils/logger';
import { findBusinessByOwnerTelegramId } from '../../onboarding/queries';
import { InlineKeyboard, sendTelegramMessage, sendTelegramMessageWithKeyboard } from '../client';

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
// Plan 17-02: Settings sub-menu (AMENU-02, AMENU-06)
// ---------------------------------------------------------------------------

/**
 * Sends the settings sub-menu for the given business. Shows current values for
 * all six configuration areas and provides toggle buttons for binary settings.
 * Free-text settings (hours, services, prices, numeric values) show a chat
 * redirect instruction — no inline editing (RESEARCH.md Pattern 3).
 *
 * AMENU-02 + AMENU-06 (Ναι/Όχι binary toggle buttons).
 */
export async function showSettingsMenu(chatId: string, business: Business): Promise<void> {
  const slotlessStatus = business.slotlessRequestsEnabled ? '✅ Ενεργό' : '❌ Ανενεργό';
  const bookingModeLabel =
    business.bookingMode === 'fixed_sessions' ? 'Συγκεκριμένα μαθήματα' : 'Ελεύθερες ώρες';
  const cutoffStatus = business.cancellationCutoffEnabled
    ? `✅ Ενεργή (${business.cancellationCutoffHours}ω πριν)`
    : '❌ Ανενεργή';
  const multiBookingStatus = business.allowMultiBooking ? '✅ Επιτρέπονται' : '❌ Δεν επιτρέπονται';
  const thresholdStatus = business.lastSessionThresholdEnabled
    ? `✅ Ενεργή (${business.lastSessionThresholdCount} μαθήματα)`
    : '❌ Ανενεργή';

  const messageText = `Ρυθμίσεις — ${business.name}

Ώρες λειτουργίας: (γράψε στο chat για αλλαγή)
Υπηρεσίες & τιμές: (γράψε στο chat για αλλαγή)

Αποδοχή αιτημάτων χωρίς slot: ${slotlessStatus}
Λειτουργία κράτησης: ${bookingModeLabel}
Πολιτική ακύρωσης: ${cutoffStatus}
Πολλαπλές κρατήσεις: ${multiBookingStatus}
Ειδοποίηση τελευταίου μαθήματος: ${thresholdStatus}

Για αλλαγή ωρών, υπηρεσιών ή αριθμητικών τιμών: γράψε μου στο chat.`;

  // Build toggle buttons — one row per binary setting, plus back button.
  const slotlessCallbackData = business.slotlessRequestsEnabled
    ? 'menu:settings:slotless_off'
    : 'menu:settings:slotless_on';
  const slotlessText = business.slotlessRequestsEnabled
    ? 'Απενεργοποίηση αιτημάτων slot'
    : 'Ενεργοποίηση αιτημάτων slot';

  const cutoffCallbackData = business.cancellationCutoffEnabled
    ? 'menu:settings:cutoff_off'
    : 'menu:settings:cutoff_on';
  const cutoffText = business.cancellationCutoffEnabled
    ? 'Απενεργοποίηση cutoff'
    : 'Ενεργοποίηση cutoff';

  const multiCallbackData = business.allowMultiBooking
    ? 'menu:settings:multibooking_off'
    : 'menu:settings:multibooking_on';
  const multiText = business.allowMultiBooking
    ? 'Απαγόρευση πολλαπλών'
    : 'Επιτροπή πολλαπλών';

  const thresholdCallbackData = business.lastSessionThresholdEnabled
    ? 'menu:settings:threshold_off'
    : 'menu:settings:threshold_on';
  const thresholdText = business.lastSessionThresholdEnabled
    ? 'Απενεργοποίηση ειδοποίησης'
    : 'Ενεργοποίηση ειδοποίησης';

  const backCallbackData = 'menu:root';

  // Assert all callback_data strings are within 64-byte limit (T-17-05 / T-17-06).
  assertCallbackDataSize(slotlessCallbackData);
  assertCallbackDataSize(cutoffCallbackData);
  assertCallbackDataSize(multiCallbackData);
  assertCallbackDataSize(thresholdCallbackData);
  assertCallbackDataSize(backCallbackData);

  const keyboard: InlineKeyboard = [
    [{ text: slotlessText, callback_data: slotlessCallbackData }],
    [{ text: cutoffText, callback_data: cutoffCallbackData }],
    [{ text: multiText, callback_data: multiCallbackData }],
    [{ text: thresholdText, callback_data: thresholdCallbackData }],
    [{ text: '« Πίσω στο Μενού', callback_data: backCallbackData }],
  ];

  await sendTelegramMessageWithKeyboard(chatId, messageText, keyboard);
}

/**
 * Dispatches binary toggle mutations for the settings sub-menu.
 *
 * @param action - The toggle action string extracted after 'menu:settings:' prefix
 *                 (e.g. 'slotless_on', 'cutoff_off').
 * @param business - The current business object (pre-toggle values).
 * @param chatId   - The owner's Telegram chat ID.
 *
 * Security: business.id is re-derived from senderTelegramId in telegram.ts
 * before this function is called (T-17-07). The action string is validated
 * against known values; unknown actions are inert (T-17-06).
 *
 * Each toggle uses db (admin connection) directly, consistent with
 * setLastSessionThreshold / setBookingMode patterns in billing/queries.ts and
 * queries.ts — these boolean fields do not require withBusinessContext RLS
 * since the businessId guard is enforced by the WHERE clause.
 */
export async function handleSettingsToggle(
  action: string,
  business: Business,
  chatId: string
): Promise<void> {
  let confirmationMessage: string;

  switch (action) {
    case 'slotless_on':
      await db
        .update(businesses)
        .set({ slotlessRequestsEnabled: true })
        .where(eq(businesses.id, business.id));
      confirmationMessage = 'Τα αιτήματα χωρίς slot ενεργοποιήθηκαν.';
      break;

    case 'slotless_off':
      await db
        .update(businesses)
        .set({ slotlessRequestsEnabled: false })
        .where(eq(businesses.id, business.id));
      confirmationMessage = 'Τα αιτήματα χωρίς slot απενεργοποιήθηκαν.';
      break;

    case 'cutoff_on':
      await db
        .update(businesses)
        .set({ cancellationCutoffEnabled: true })
        .where(eq(businesses.id, business.id));
      confirmationMessage = 'Η πολιτική ακύρωσης ενεργοποιήθηκε.';
      break;

    case 'cutoff_off':
      await db
        .update(businesses)
        .set({ cancellationCutoffEnabled: false })
        .where(eq(businesses.id, business.id));
      confirmationMessage = 'Η πολιτική ακύρωσης απενεργοποιήθηκε.';
      break;

    case 'multibooking_on':
      await db
        .update(businesses)
        .set({ allowMultiBooking: true })
        .where(eq(businesses.id, business.id));
      confirmationMessage = 'Οι πολλαπλές κρατήσεις επιτρέπονται.';
      break;

    case 'multibooking_off':
      await db
        .update(businesses)
        .set({ allowMultiBooking: false })
        .where(eq(businesses.id, business.id));
      confirmationMessage = 'Οι πολλαπλές κρατήσεις δεν επιτρέπονται.';
      break;

    case 'threshold_on':
      await db
        .update(businesses)
        .set({ lastSessionThresholdEnabled: true })
        .where(eq(businesses.id, business.id));
      confirmationMessage = 'Η ειδοποίηση τελευταίου μαθήματος ενεργοποιήθηκε.';
      break;

    case 'threshold_off':
      await db
        .update(businesses)
        .set({ lastSessionThresholdEnabled: false })
        .where(eq(businesses.id, business.id));
      confirmationMessage = 'Η ειδοποίηση τελευταίου μαθήματος απενεργοποιήθηκε.';
      break;

    default:
      // Unknown toggle action — send error and return without any DB mutation (T-17-06).
      await sendTelegramMessage(chatId, 'Άγνωστη ρύθμιση.');
      return;
  }

  // Send confirmation then re-fetch updated business to show the refreshed settings screen.
  await sendTelegramMessage(chatId, confirmationMessage);

  // Re-fetch the updated business record so showSettingsMenu reflects the new values.
  const updatedBusiness = await findBusinessByOwnerTelegramId(chatId);
  if (!updatedBusiness) {
    logger.warn({ chatId }, 'handleSettingsToggle: could not re-fetch business after toggle');
    return;
  }

  await showSettingsMenu(chatId, updatedBusiness);
}

// ---------------------------------------------------------------------------
// Plan 17-02: Today's Agenda on-demand (AMENU-05)
// ---------------------------------------------------------------------------

/**
 * Sends today's booking agenda to the owner on demand.
 *
 * Mirrors the runAgendaSweep logic in scheduler/agenda.ts but deliberately
 * bypasses claimAgendaSlot (RESEARCH.md Pitfall 2 / T-17-09). The on-demand
 * path must never consume the daily agenda slot.
 *
 * CRITICAL: claimAgendaSlot is NOT called here. Code review gate:
 *   grep "claimAgendaSlot" src/telegram/handlers/admin-menu.ts  → must return 0 matches.
 */
export async function showTodaysAgenda(chatId: string, business: Business): Promise<void> {
  // 1. Get today's Athens ISO date.
  const today = isoDateInAthens(new Date());

  // 2. Fetch bookings (confirmed + pending_owner_approval — same statuses as
  //    the scheduled agenda display in runAgendaSweep).
  const bookingList = await listBookingsForDate(business.id, today, [
    'confirmed',
    'pending_owner_approval',
  ]);

  // 3. Build service name map (same pattern as runAgendaSweep in agenda.ts).
  const serviceNamesById = new Map<number, string>();
  for (const booking of bookingList) {
    if (!serviceNamesById.has(booking.serviceId)) {
      const service = await findServiceById(business.id, booking.serviceId);
      serviceNamesById.set(booking.serviceId, service?.name ?? 'Άγνωστη υπηρεσία');
    }
  }

  // 4. Format and send the agenda message.
  const message =
    bookingList.length > 0
      ? formatAgendaMessage(bookingList, serviceNamesById)
      : 'Δεν υπάρχουν ραντεβού για σήμερα.';

  await sendTelegramMessage(chatId, message);

  // 5. Send back button as a separate keyboard message so the owner can navigate back.
  const backCallbackData = 'menu:root';
  assertCallbackDataSize(backCallbackData);
  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', [
    [{ text: '« Πίσω στο Μενού', callback_data: backCallbackData }],
  ]);
}

// ---------------------------------------------------------------------------
// Central dispatcher (Plan 17-01 base + Plan 17-02 extensions)
// ---------------------------------------------------------------------------

/**
 * Central dispatcher for all admin menu callback_query events.
 * Called from handleCallbackQuery in telegram.ts after 'menuAction' in parsed
 * discriminates to MenuCallbackResult.
 *
 * NOTE: answerCallbackQuery has already been called by the time this function
 * is reached (RESEARCH.md Pitfall 4). Do NOT call it again here.
 *
 * Plan 17-01: 'root' case.
 * Plan 17-02: 'settings', 'settings:*' (toggle dispatch), 'agenda' cases.
 * Plans 17-03, 17-04 will add 'classes', 'clients', and sub-action cases.
 */
export async function handleMenuCallback(
  result: MenuCallbackResult,
  business: Business,
  chatId: string
): Promise<void> {
  const { menuAction } = result;

  switch (true) {
    case menuAction === 'root':
      await showAdminRootMenu(chatId, business);
      break;

    case menuAction === 'settings':
      await showSettingsMenu(chatId, business);
      break;

    case menuAction.startsWith('settings:'): {
      const toggleAction = menuAction.slice('settings:'.length);
      await handleSettingsToggle(toggleAction, business, chatId);
      break;
    }

    case menuAction === 'agenda':
      await showTodaysAgenda(chatId, business);
      break;

    default:
      // Unknown menu action — Plans 17-03/17-04 will fill in 'classes'/'clients' cases.
      await sendTelegramMessage(chatId, 'Άγνωστη ενέργεια μενού.');
      break;
  }
}
