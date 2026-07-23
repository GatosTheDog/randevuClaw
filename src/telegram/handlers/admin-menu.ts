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
import { listSessions, cancelSession } from '../../session/manager';
import { InlineKeyboard, sendTelegramMessage, sendTelegramMessageWithKeyboard } from '../client';

// Exported so telegram.ts can use it in the parseCallbackData return union.
// Discriminant field: menuAction — unique across all existing result types
// (bookingId, firstId, slotlessRequestId, businessId) per RESEARCH.md Pitfall 1.
export type MenuCallbackResult = {
  menuAction: string;
  id?: number;
};

// Mirrors the 64-byte callback_data guard from payment-flow.ts (T-17-05).
function assertCallbackDataSize(data: string): void {
  if (Buffer.byteLength(data, 'utf8') > 64) {
    logger.warn(
      { data, bytes: Buffer.byteLength(data, 'utf8') },
      'callback_data exceeds 64 bytes — Telegram will reject'
    );
  }
}

/**
 * Sends the four-button 2x2 admin root menu keyboard to the owner (AMENU-01).
 */
export async function showAdminRootMenu(chatId: string, business: Business): Promise<void> {
  const callbackDataSettings = 'menu:settings';
  const callbackDataClasses = 'menu:classes';
  const callbackDataClients = 'menu:clients';
  const callbackDataAgenda = 'menu:agenda';

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

export async function handleSettingsToggle(
  action: string,
  business: Business,
  chatId: string
): Promise<void> {
  let confirmationMessage: string;

  switch (action) {
    case 'slotless_on':
      await db.update(businesses).set({ slotlessRequestsEnabled: true }).where(eq(businesses.id, business.id));
      confirmationMessage = 'Τα αιτήματα χωρίς slot ενεργοποιήθηκαν.';
      break;
    case 'slotless_off':
      await db.update(businesses).set({ slotlessRequestsEnabled: false }).where(eq(businesses.id, business.id));
      confirmationMessage = 'Τα αιτήματα χωρίς slot απενεργοποιήθηκαν.';
      break;
    case 'cutoff_on':
      await db.update(businesses).set({ cancellationCutoffEnabled: true }).where(eq(businesses.id, business.id));
      confirmationMessage = 'Η πολιτική ακύρωσης ενεργοποιήθηκε.';
      break;
    case 'cutoff_off':
      await db.update(businesses).set({ cancellationCutoffEnabled: false }).where(eq(businesses.id, business.id));
      confirmationMessage = 'Η πολιτική ακύρωσης απενεργοποιήθηκε.';
      break;
    case 'multibooking_on':
      await db.update(businesses).set({ allowMultiBooking: true }).where(eq(businesses.id, business.id));
      confirmationMessage = 'Οι πολλαπλές κρατήσεις επιτρέπονται.';
      break;
    case 'multibooking_off':
      await db.update(businesses).set({ allowMultiBooking: false }).where(eq(businesses.id, business.id));
      confirmationMessage = 'Οι πολλαπλές κρατήσεις δεν επιτρέπονται.';
      break;
    case 'threshold_on':
      await db.update(businesses).set({ lastSessionThresholdEnabled: true }).where(eq(businesses.id, business.id));
      confirmationMessage = 'Η ειδοποίηση τελευταίου μαθήματος ενεργοποιήθηκε.';
      break;
    case 'threshold_off':
      await db.update(businesses).set({ lastSessionThresholdEnabled: false }).where(eq(businesses.id, business.id));
      confirmationMessage = 'Η ειδοποίηση τελευταίου μαθήματος απενεργοποιήθηκε.';
      break;
    default:
      await sendTelegramMessage(chatId, 'Άγνωστη ρύθμιση.');
      return;
  }

  await sendTelegramMessage(chatId, confirmationMessage);
  const updatedBusiness = await findBusinessByOwnerTelegramId(chatId);
  if (!updatedBusiness) {
    logger.warn({ chatId }, 'handleSettingsToggle: could not re-fetch business after toggle');
    return;
  }
  await showSettingsMenu(chatId, updatedBusiness);
}

// ---------------------------------------------------------------------------
// Plan 17-02: Today's Agenda on-demand (AMENU-05)
// CRITICAL: claimAgendaSlot is NOT called here (RESEARCH.md Pitfall 2).
// ---------------------------------------------------------------------------

export async function showTodaysAgenda(chatId: string, business: Business): Promise<void> {
  const today = isoDateInAthens(new Date());
  const bookingList = await listBookingsForDate(business.id, today, [
    'confirmed',
    'pending_owner_approval',
  ]);

  const serviceNamesById = new Map<number, string>();
  for (const booking of bookingList) {
    if (!serviceNamesById.has(booking.serviceId)) {
      const service = await findServiceById(business.id, booking.serviceId);
      serviceNamesById.set(booking.serviceId, service?.name ?? 'Άγνωστη υπηρεσία');
    }
  }

  const message =
    bookingList.length > 0
      ? formatAgendaMessage(bookingList, serviceNamesById)
      : 'Δεν υπάρχουν ραντεβού για σήμερα.';

  await sendTelegramMessage(chatId, message);

  const backCallbackData = 'menu:root';
  assertCallbackDataSize(backCallbackData);
  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', [
    [{ text: '« Πίσω στο Μενού', callback_data: backCallbackData }],
  ]);
}

// ---------------------------------------------------------------------------
// Plan 17-03: Classes sub-menu (AMENU-03, AMENU-06)
// ---------------------------------------------------------------------------

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

export async function showCancelClassList(chatId: string, business: Business): Promise<void> {
  const sessions = await listSessions(business.id, 30);
  const backButton = { text: '« Πίσω στο Μενού', callback_data: 'menu:root' };

  if (sessions.length === 0) {
    await sendTelegramMessageWithKeyboard(chatId, 'Δεν υπάρχουν επερχόμενα μαθήματα.', [[backButton]]);
    return;
  }

  const capped = sessions.slice(0, 10);
  const keyboard: InlineKeyboard = capped.map((s) => {
    const cbData = `menu:classes:cancel_confirm_req:${s.instanceId}`;
    assertCallbackDataSize(cbData);
    return [{ text: `${s.sessionDate} ${s.sessionTime}`, callback_data: cbData }];
  });

  keyboard.push([backButton]);
  const prompt =
    sessions.length > 10
      ? `Επίλεξε μάθημα για ακύρωση: (εμφανίζονται τα πρώτα 10 από ${sessions.length})`
      : 'Επίλεξε μάθημα για ακύρωση:';

  await sendTelegramMessageWithKeyboard(chatId, prompt, keyboard);
}

export async function showCancelClassConfirm(chatId: string, instanceId: number): Promise<void> {
  const cancelConfirmData = `menu:classes:cancel_yes:${instanceId}`;
  const cancelAbortData = `menu:classes:cancel_no:${instanceId}`;
  assertCallbackDataSize(cancelConfirmData);
  assertCallbackDataSize(cancelAbortData);

  await sendTelegramMessageWithKeyboard(
    chatId,
    `Να ακυρωθεί το μάθημα #${instanceId};`,
    [[
      { text: 'Ναι', callback_data: cancelConfirmData },
      { text: 'Όχι', callback_data: cancelAbortData },
    ]]
  );
}

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
  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', [
    [{ text: '« Πίσω στο Μενού', callback_data: 'menu:root' }],
  ]);
}

// ---------------------------------------------------------------------------
// Central dispatcher (Plans 17-01 + 17-02 + 17-03)
// Plan 17-04 will add 'clients' and sub-action cases.
// ---------------------------------------------------------------------------

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

    case menuAction === 'classes':
      await showClassesMenu(chatId, business);
      break;

    case menuAction === 'classes:cancel_list':
      await showCancelClassList(chatId, business);
      break;

    case menuAction === 'classes:create':
      await sendTelegramMessage(
        chatId,
        'Για να δημιουργήσεις νέο επαναλαμβανόμενο μάθημα, γράψε μου στο chat ' +
          '(π.χ. "Δημιούργησε Pilates Δευτέρα Τετάρτη 10:00 15 θέσεις").'
      );
      break;

    case menuAction === 'classes:cancel_confirm_req': {
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: λείπει το αναγνωριστικό μαθήματος.');
        return;
      }
      await showCancelClassConfirm(chatId, result.id);
      break;
    }

    case menuAction === 'classes:cancel_yes': {
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: λείπει το αναγνωριστικό μαθήματος.');
        return;
      }
      await handleClassCancelExecute(chatId, business, result.id);
      break;
    }

    case menuAction === 'classes:cancel_no': {
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
      // Plan 17-04 will add 'clients' cases here.
      await sendTelegramMessage(chatId, 'Άγνωστη ενέργεια μενού.');
      break;
  }
}
