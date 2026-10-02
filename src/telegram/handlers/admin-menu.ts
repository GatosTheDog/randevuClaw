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
import {
  Business,
  findServiceById,
  listBookingsForDate,
  findClientBusinessRelationship,
  findClientBusinessRelationshipById,
  deleteClientBookingData,
  deleteClientBusinessRelationship,
} from '../../database/queries';
import { businesses } from '../../database/schema';
import { formatAgendaMessage } from '../../scheduler/agenda';
import { isoDateInAthens, formatExpiryDateGreek } from '../../utils/timezone';
import { logger } from '../../utils/logger';
import { findBusinessByOwnerTelegramId } from '../../onboarding/queries';
import { listSessions, cancelSession, cascadeCancelSessionBookings, findSessionInstanceById } from '../../session/manager';
import { formatDateButtonLabel, dateToCallbackId, callbackIdToDate } from '../../utils/date-picker';
import {
  InlineKeyboard,
  sendTelegramMessage,
  sendTelegramMessageWithKeyboard,
  botTokenStore,
  setMyCommands,
  setChatMenuButton,
} from '../client';
import {
  getAllClientsForBusiness,
  getClientActiveMembership,
  getActiveMembershipsForBusiness,
  findMembershipsExpiringIn7Days,
  deleteClientBillingData,
} from '../../billing/queries';
import { sendBusinessInvite } from '../../invites/generator';
import { showClientSelection } from './payment-flow';
import { handleCalendarCommand, handleCalendarDisconnect } from './calendar-connect';
import { BACK_MENU_LABELS } from '../../utils/greek-messages';
import { GOOGLE_CONNECT_CALLBACK_DATA, GOOGLE_CONNECT_BUTTON_LABEL } from '../../google/constants';
import { handleGoogleCalendarConnect } from './google-calendar-connect';

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
 * D-06.2: re-asserts the same 4 idempotent Bot-API calls finish_onboarding
 * makes once at onboarding time (BOT-06). Since finish_onboarding fires
 * exactly once in a business's entire lifetime, re-running these idempotent
 * calls on every /menu tap is a cheap, safe hedge against that one-shot call
 * never having a second chance. No retry loop here — a failed re-assertion
 * is cheap to retry naturally the next time the owner taps /menu.
 */
async function reassertMenuButtonAndCommands(
  botToken: string,
  chatId: string,
  business: Business
): Promise<void> {
  const bookingButtonText =
    business.bookingMode === 'fixed_sessions' ? 'Κράτηση μαθήματος' : 'Κράτηση ραντεβού';

  await setMyCommands(
    botToken,
    [
      { command: 'menu', description: 'Εμφάνιση μενού διαχείρισης' },
      { command: 'settings', description: 'Ρυθμίσεις' },
      { command: 'classes', description: 'Μαθήματα' },
      { command: 'clients', description: 'Πελάτες' },
      { command: 'agenda', description: 'Ατζέντα Σήμερα' },
      { command: 'payment', description: 'Καταχώρηση Πληρωμής' },
      { command: 'invite', description: 'Πρόσκληση Πελάτη' },
      { command: 'notify', description: 'Ειδοποίηση Πελατών' },
      { command: 'calendar', description: 'Σύνδεση Google Ημερολογίου' },
    ],
    { type: 'chat', chat_id: chatId }
  );
  await setMyCommands(botToken, [
    { command: 'start', description: 'Έναρξη κράτησης ραντεβού' },
    { command: 'book', description: bookingButtonText },
    { command: 'mybookings', description: 'Οι κρατήσεις μου' },
    { command: 'cancel', description: 'Ακύρωση κράτησης' },
    { command: 'balance', description: 'Υπόλοιπο μαθημάτων' },
  ], { type: 'all_private_chats' });
  await setChatMenuButton(botToken, chatId);
  await setChatMenuButton(botToken);
}

/**
 * Sends the admin root menu keyboard to the owner (AMENU-01): a 2x2 grid, then
 * single-button rows for the client invite and Google Calendar connect/reconnect.
 */
export async function showAdminRootMenu(chatId: string, business: Business): Promise<void> {
  const callbackDataSettings = 'menu:settings';
  const callbackDataClasses = 'menu:classes';
  const callbackDataClients = 'menu:clients';
  const callbackDataAgenda = 'menu:agenda';
  const callbackDataPayment = 'menu:payment';
  const callbackDataInvite = 'menu:invite';
  const callbackDataNotify = 'menu:notify';

  assertCallbackDataSize(callbackDataSettings);
  assertCallbackDataSize(callbackDataClasses);
  assertCallbackDataSize(callbackDataClients);
  assertCallbackDataSize(callbackDataAgenda);
  assertCallbackDataSize(callbackDataPayment);
  assertCallbackDataSize(callbackDataInvite);
  assertCallbackDataSize(callbackDataNotify);
  assertCallbackDataSize(GOOGLE_CONNECT_CALLBACK_DATA);

  const keyboard: InlineKeyboard = [
    [
      { text: 'Ρυθμίσεις', callback_data: callbackDataSettings },
      { text: 'Μαθήματα', callback_data: callbackDataClasses },
    ],
    [
      { text: 'Πελάτες', callback_data: callbackDataClients },
      { text: 'Ατζέντα Σήμερα', callback_data: callbackDataAgenda },
    ],
    [{ text: 'Καταχώρηση Πληρωμής', callback_data: callbackDataPayment }],
    [{ text: 'Πρόσκληση Πελάτη', callback_data: callbackDataInvite }],
    [{ text: 'Ειδοποίηση Πελατών', callback_data: callbackDataNotify }],
    [
      {
        text: business.googleRefreshToken ? 'Google Calendar ✅ (επανασύνδεση)' : GOOGLE_CONNECT_BUTTON_LABEL,
        callback_data: GOOGLE_CONNECT_CALLBACK_DATA,
      },
    ],
  ];

  const menuText = `Πίνακας Ελέγχου — ${business.name}

1. Ρυθμίσεις
2. Μαθήματα
3. Πελάτες
4. Ατζέντα Σήμερα
5. Καταχώρηση Πληρωμής
6. Πρόσκληση Πελάτη
7. Ειδοποίηση Πελατών`;

  await sendTelegramMessageWithKeyboard(
    chatId,
    menuText,
    keyboard
  );

  // D-06.2: fire-and-forget re-assertion — deliberately not awaited so it
  // never delays or can fail the caller's own response. Covers both /menu
  // entry points (the '/menu'/'/start' text-command branch in
  // webhooks/telegram.ts and the menu:root callback branch below), since
  // both call this same function.
  if (business.botToken) {
    reassertMenuButtonAndCommands(business.botToken, chatId, business).catch((err) => {
      logger.warn(
        { err, businessId: business.id },
        'showAdminRootMenu: menu button re-assertion failed (non-blocking)'
      );
    });
  }
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
  const calendarStatus = business.googleRefreshToken ? '✅ Συνδεδεμένο' : '❌ Μη συνδεδεμένο';

  const messageText = `Ρυθμίσεις — ${business.name}

Ώρες λειτουργίας: (γράψε στο chat για αλλαγή)
Υπηρεσίες & τιμές: (γράψε στο chat για αλλαγή)

Αποδοχή αιτημάτων χωρίς slot: ${slotlessStatus}
Λειτουργία κράτησης: ${bookingModeLabel}
Πολιτική ακύρωσης: ${cutoffStatus}
Πολλαπλές κρατήσεις: ${multiBookingStatus}
Ειδοποίηση τελευταίου μαθήματος: ${thresholdStatus}
Google Calendar: ${calendarStatus}

Για αλλαγή ωρών, υπηρεσιών ή αριθμητικών τιμών: γράψε μου στο chat.`;

  const slotlessCallbackData = business.slotlessRequestsEnabled
    ? 'menu:settings:slotless_off'
    : 'menu:settings:slotless_on';
  const slotlessText = business.slotlessRequestsEnabled
    ? 'Απενεργοποίηση αιτημάτων χωρίς slot'
    : 'Ενεργοποίηση αιτημάτων χωρίς slot';

  const cutoffCallbackData = business.cancellationCutoffEnabled
    ? 'menu:settings:cutoff_off'
    : 'menu:settings:cutoff_on';
  const cutoffText = business.cancellationCutoffEnabled
    ? 'Απενεργοποίηση πολιτικής ακύρωσης'
    : 'Ενεργοποίηση πολιτικής ακύρωσης';

  const multiCallbackData = business.allowMultiBooking
    ? 'menu:settings:multibooking_off'
    : 'menu:settings:multibooking_on';
  const multiText = business.allowMultiBooking
    ? 'Απαγόρευση πολλαπλών κρατήσεων'
    : 'Έγκριση πολλαπλών κρατήσεων';

  const thresholdCallbackData = business.lastSessionThresholdEnabled
    ? 'menu:settings:threshold_off'
    : 'menu:settings:threshold_on';
  const thresholdText = business.lastSessionThresholdEnabled
    ? 'Απενεργοποίηση ειδοποίησης τελευταίου μαθήματος'
    : 'Ενεργοποίηση ειδοποίησης τελευταίου μαθήματος';

  // Same callback_data for both connection states — handleCalendarCommand
  // (menu:settings:calendar) branches internally on business.googleRefreshToken.
  const calendarCallbackData = 'menu:settings:calendar';
  const calendarText = business.googleRefreshToken
    ? '📅 Διαχείριση Google Calendar'
    : '📅 Σύνδεση Google Calendar';

  const backCallbackData = 'menu:root';
  const hoursExamplesData = 'menu:settings:hours_examples';
  const servicesExamplesData = 'menu:settings:services_examples';
  const classesExamplesData = 'menu:settings:classes_examples';

  assertCallbackDataSize(slotlessCallbackData);
  assertCallbackDataSize(cutoffCallbackData);
  assertCallbackDataSize(multiCallbackData);
  assertCallbackDataSize(thresholdCallbackData);
  assertCallbackDataSize(calendarCallbackData);
  assertCallbackDataSize(backCallbackData);
  assertCallbackDataSize(hoursExamplesData);
  assertCallbackDataSize(servicesExamplesData);
  assertCallbackDataSize(classesExamplesData);

  const keyboard: InlineKeyboard = [
    [{ text: slotlessText, callback_data: slotlessCallbackData }],
    [{ text: cutoffText, callback_data: cutoffCallbackData }],
    [{ text: multiText, callback_data: multiCallbackData }],
    [{ text: thresholdText, callback_data: thresholdCallbackData }],
    [{ text: calendarText, callback_data: calendarCallbackData }],
    [{ text: '📝 Ώρες Λειτουργίας — Παραδείγματα', callback_data: hoursExamplesData }],
    [{ text: '📝 Υπηρεσίες & Τιμές — Παραδείγματα', callback_data: servicesExamplesData }],
    [{ text: '📝 Νέα Μαθήματα — Παραδείγματα', callback_data: classesExamplesData }],
    [{ text: BACK_MENU_LABELS.ADMIN, callback_data: backCallbackData }],
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

  const clientNamesByPhone = new Map<string, string>();
  for (const booking of bookingList) {
    if (!clientNamesByPhone.has(booking.clientPhone)) {
      const rel = await findClientBusinessRelationship(business.id, booking.clientPhone);
      clientNamesByPhone.set(booking.clientPhone, rel?.clientName ?? booking.clientPhone);
    }
  }

  const message =
    bookingList.length > 0
      ? formatAgendaMessage(bookingList, serviceNamesById, clientNamesByPhone)
      : 'Δεν υπάρχουν ραντεβού για σήμερα.';

  await sendTelegramMessage(chatId, message);

  const backCallbackData = 'menu:root';
  assertCallbackDataSize(backCallbackData);
  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', [
    [{ text: BACK_MENU_LABELS.ADMIN, callback_data: backCallbackData }],
  ]);
}

// ---------------------------------------------------------------------------
// Phase 25 Plan 01: Client invite generator (INVITE-01, D-03 menu entry point)
// ---------------------------------------------------------------------------

/**
 * Generates and sends the business's QR invite (photo + caption) via the
 * shared sendBusinessInvite orchestration function. Any failure is fully
 * contained here — the owner always gets a Greek message and a working
 * back-to-menu button, never a stuck/broken flow.
 */
export async function handleInviteGeneration(chatId: string, business: Business): Promise<void> {
  try {
    await sendBusinessInvite(business, chatId);
  } catch (err) {
    logger.error({ err, businessId: business.id }, 'Failed to generate invite');
    await sendTelegramMessage(chatId, 'Σφάλμα κατά τη δημιουργία του invite. Δοκιμάστε ξανά.');
  }

  const backCallbackData = 'menu:root';
  assertCallbackDataSize(backCallbackData);
  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', [
    [{ text: BACK_MENU_LABELS.ADMIN, callback_data: backCallbackData }],
  ]);
}

// ---------------------------------------------------------------------------
// Plan 17-03: Classes sub-menu (AMENU-03, AMENU-06)
// ---------------------------------------------------------------------------

export async function showClassesMenu(chatId: string, business: Business): Promise<void> {
  const sessions = await listSessions(business.id, 7);

  let messageText: string;
  if (sessions.length > 0) {
    const serviceIds = [...new Set(sessions.map((s) => s.serviceId))];
    const serviceNamesById = new Map<number, string>();
    for (const serviceId of serviceIds) {
      const service = await findServiceById(business.id, serviceId);
      serviceNamesById.set(serviceId, service?.name ?? '(άγνωστη υπηρεσία)');
    }

    const lines = sessions.map(
      (s) => `${serviceNamesById.get(s.serviceId)} - ${s.sessionDate} ${s.sessionTime} — ${s.bookedCount}/${s.capacity} θέσεις`
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
    [{ text: BACK_MENU_LABELS.ADMIN, callback_data: backData }],
  ];

  await sendTelegramMessageWithKeyboard(chatId, messageText, keyboard);
}

/**
 * Step 1 of class cancellation: shows one button per date (next 30 days)
 * that has at least one scheduled class.
 */
export async function showCancelClassList(chatId: string, business: Business): Promise<void> {
  const sessions = await listSessions(business.id, 30);
  const backButton = { text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:root' };

  if (sessions.length === 0) {
    await sendTelegramMessageWithKeyboard(chatId, 'Δεν υπάρχουν επερχόμενα μαθήματα.', [[backButton]]);
    return;
  }

  // listSessions returns rows ordered by sessionDate, so dedup preserves order.
  const dates = [...new Set(sessions.map((s) => s.sessionDate))];

  const keyboard: InlineKeyboard = dates.map((date) => {
    const cbData = `menu:classes:cancel_date:${dateToCallbackId(date)}`;
    assertCallbackDataSize(cbData);
    return [{ text: formatDateButtonLabel(date), callback_data: cbData }];
  });
  keyboard.push([backButton]);

  await sendTelegramMessageWithKeyboard(chatId, 'Επίλεξε ημερομηνία:', keyboard);
}

/**
 * Step 2 of class cancellation: shows up to 10 scheduled classes for the
 * chosen date.
 */
export async function showCancelClassListForDate(
  chatId: string,
  business: Business,
  dateId: number
): Promise<void> {
  const date = callbackIdToDate(dateId);
  const sessions = await listSessions(business.id, 30);
  const backButton = { text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:classes:cancel_list' };

  const forDate = sessions.filter((s) => s.sessionDate === date).slice(0, 10);

  if (forDate.length === 0) {
    await sendTelegramMessageWithKeyboard(
      chatId,
      'Δεν υπάρχουν πλέον προγραμματισμένα μαθήματα για αυτή την ημερομηνία.',
      [[backButton]]
    );
    return;
  }

  const serviceIds = [...new Set(forDate.map((s) => s.serviceId))];
  const serviceNamesById = new Map<number, string>();
  for (const serviceId of serviceIds) {
    const service = await findServiceById(business.id, serviceId);
    serviceNamesById.set(serviceId, service?.name ?? '(άγνωστη υπηρεσία)');
  }

  const keyboard: InlineKeyboard = forDate.map((s) => {
    const cbData = `menu:classes:cancel_confirm_req:${s.instanceId}`;
    assertCallbackDataSize(cbData);
    return [{ text: `${serviceNamesById.get(s.serviceId)} - ${s.sessionTime}`, callback_data: cbData }];
  });
  keyboard.push([backButton]);

  await sendTelegramMessageWithKeyboard(chatId, 'Επίλεξε μάθημα για ακύρωση:', keyboard);
}

export async function showCancelClassConfirm(
  chatId: string,
  business: Business,
  instanceId: number
): Promise<void> {
  const session = await findSessionInstanceById(business.id, instanceId);
  if (!session) {
    await sendTelegramMessage(chatId, 'Το μάθημα δεν βρέθηκε.');
    return;
  }

  const service = await findServiceById(business.id, session.serviceId);
  const serviceName = service?.name ?? '(άγνωστη υπηρεσία)';

  const cancelConfirmData = `menu:classes:cancel_yes:${instanceId}`;
  const cancelAbortData = `menu:classes:cancel_no:${instanceId}`;
  assertCallbackDataSize(cancelConfirmData);
  assertCallbackDataSize(cancelAbortData);

  await sendTelegramMessageWithKeyboard(
    chatId,
    `Να ακυρωθεί το μάθημα:\n${serviceName}\n${session.sessionDate} ${session.sessionTime};`,
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
    const affectedCount = await cascadeCancelSessionBookings(business, instanceId);
    if (affectedCount === 0) {
      await sendTelegramMessage(chatId, 'Το μάθημα ακυρώθηκε (δεν υπήρχαν κρατήσεις).');
    } else {
      await sendTelegramMessage(chatId, `Το μάθημα ακυρώθηκε. ${affectedCount} πελάτες ειδοποιήθησαν.`);
    }
  } else {
    await sendTelegramMessage(chatId, 'Το μάθημα δεν βρέθηκε ή είχε ήδη ακυρωθεί.');
  }
  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', [
    [{ text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:root' }],
  ]);
}

// ---------------------------------------------------------------------------
// Plan 17-04: Clients sub-menu (AMENU-04)
// ---------------------------------------------------------------------------

/**
 * Lists up to 20 clients as inline keyboard buttons (AMENU-04).
 * Cross-tenant guard: business.id is derived from senderTelegramId upstream.
 * getAllClientsForBusiness uses getConn() (RLS-enforced when inside
 * withBusinessContext; safe when called from menu callback handlers too).
 */
export async function showClientsList(chatId: string, business: Business): Promise<void> {
  const clients = await getAllClientsForBusiness(business.id);
  const capped = clients.slice(0, 20);
  const overLimit = clients.length > 20;

  if (clients.length === 0) {
    await sendTelegramMessageWithKeyboard(
      chatId,
      'Δεν υπάρχουν εγγεγραμμένοι πελάτες ακόμη.',
      [[{ text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:root' }]]
    );
    return;
  }

  const headerText =
    `Πελάτες (${Math.min(clients.length, 20)} εμφανίζονται):` +
    (overLimit ? '\n(υπάρχουν κι άλλοι — επικοινώνησε για πλήρη λίστα)' : '');

  // Batched (not per-client) remaining-slots annotation — same "exhausted
  // pack counts as no membership" rule as the client-side booking gate (D-11).
  const membershipsByPhone = await getActiveMembershipsForBusiness(business.id);

  const keyboard: InlineKeyboard = capped.map((client) => {
    const cbData = `menu:clients:balance:${client.clientBusinessRelationshipId}`;
    assertCallbackDataSize(cbData);
    const membership = membershipsByPhone.get(client.senderPhone);
    const slotsLabel =
      !membership || membership.sessionsRemaining === 0
        ? ' ⚠️ 0'
        : membership.sessionsRemaining === null
          ? ' ∞'
          : ` (${membership.sessionsRemaining})`;
    return [
      {
        text: `${client.clientName ?? client.senderPhone}${slotsLabel}`,
        callback_data: cbData,
      },
    ];
  });

  keyboard.push([{ text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:root' }]);

  await sendTelegramMessageWithKeyboard(chatId, headerText, keyboard);
}

/**
 * Shows the selected client's membership status and session balance (AMENU-04).
 * T-17-14/T-17-16: cross-tenant guard via rel.businessId === business.id check
 * after DB lookup — prevents forged relId in callback_data from exposing foreign
 * client data.
 */
export async function showClientBalance(
  chatId: string,
  business: Business,
  relId: number
): Promise<void> {
  const rel = await findClientBusinessRelationshipById(relId);

  // T-17-14/T-17-16: ownership check — rel.businessId must match the owner's business
  if (rel?.businessId !== business.id) {
    await sendTelegramMessage(chatId, 'Ο πελάτης δεν βρέθηκε.');
    return;
  }

  const clientPhone = rel.senderPhone;
  const membership = await getClientActiveMembership(business.id, clientPhone);
  const displayName = rel.clientName ?? clientPhone;

  let messageText: string;
  if (!membership) {
    messageText = `Πελάτης: ${displayName}\nΔεν υπάρχει ενεργή συνδρομή.`;
  } else if (membership.isUnlimited) {
    messageText =
      `Πελάτης: ${displayName}\n` +
      `Πακέτο: ${membership.packageName}\n` +
      `Απεριόριστες συνεδρίες\n` +
      `Λήγει: ${membership.expiresAt.toLocaleDateString('el-GR')}`;
  } else {
    messageText =
      `Πελάτης: ${displayName}\n` +
      `Πακέτο: ${membership.packageName}\n` +
      `Υπόλοιπο: ${membership.sessionsRemaining} μαθήματα\n` +
      `Λήγει: ${membership.expiresAt.toLocaleDateString('el-GR')}`;
  }

  const backButton = { text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:root' };
  const deleteFullData = `menu:clients:del_full_confirm:${relId}`;
  const unlinkData = `menu:clients:del_unlink_confirm:${relId}`;
  assertCallbackDataSize(deleteFullData);
  assertCallbackDataSize(unlinkData);

  let keyboard: InlineKeyboard;

  if (membership) {
    const nudgeData = `menu:clients:nudge:${relId}`;
    assertCallbackDataSize(nudgeData);
    keyboard = [
      [{ text: 'Αποστολή υπενθύμισης', callback_data: nudgeData }],
      [{ text: 'Πλήρης διαγραφή', callback_data: deleteFullData }],
      [{ text: 'Αφαίρεση από λίστα', callback_data: unlinkData }],
      [backButton],
    ];
  } else {
    keyboard = [
      [{ text: 'Πλήρης διαγραφή', callback_data: deleteFullData }],
      [{ text: 'Αφαίρεση από λίστα', callback_data: unlinkData }],
      [backButton],
    ];
  }

  await sendTelegramMessageWithKeyboard(chatId, messageText, keyboard);
}

/**
 * Sends a renewal reminder to the client via the business bot (AMENU-04).
 * T-17-15/T-17-17: senderPhone resolved from DB row (not from callback_data);
 * ownership checked before sending; botTokenStore.run ensures correct per-business bot.
 */
export async function handleRenewalNudge(
  chatId: string,
  business: Business,
  relId: number
): Promise<void> {
  const rel = await findClientBusinessRelationshipById(relId);

  // T-17-15: ownership check — rel.businessId must match the owner's business
  if (rel?.businessId !== business.id) {
    await sendTelegramMessage(chatId, 'Ο πελάτης δεν βρέθηκε.');
    return;
  }

  const membership = await getClientActiveMembership(business.id, rel.senderPhone);
  if (!membership) {
    await sendTelegramMessage(
      chatId,
      'Δεν υπάρχει ενεργή συνδρομή — η υπενθύμιση δεν στάλθηκε.'
    );
    return;
  }

  if (!business.botToken) {
    await sendTelegramMessage(chatId, 'Σφάλμα: δεν βρέθηκε το bot token της επιχείρησης.');
    return;
  }

  // T-17-17: senderPhone is resolved from DB row (not from callback_data) and
  // botTokenStore.run scopes the send to the correct per-business bot token.
  await botTokenStore.run(business.botToken, async () => {
    await sendTelegramMessage(
      rel.senderPhone,
      'Υπενθύμιση: Τα μαθήματά σας τελειώνουν σύντομα! Επικοινωνήστε για ανανέωση.'
    );
  });

  await sendTelegramMessage(chatId, `Υπενθύμιση στάλθηκε στον ${rel.clientName ?? rel.senderPhone}.`);

  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', [
    [{ text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:root' }],
  ]);
}

// ---------------------------------------------------------------------------
// Phase 30: Ειδοποίηση Πελατών (manual renewal-notification menu) — bulk
// "all expiring within 7 days" and single-client paths, each gated behind a
// Ναι/Όχι confirmation before anything is sent, mirroring the show*Confirm /
// handle*Execute split used everywhere else in this file (cancel class,
// delete client, etc.). Independent of the automatic 6-hourly sweep in
// scheduler/membership-expiry.ts — this is an owner-triggered send, so it
// deliberately does NOT touch that sweep's dedup table: an owner explicitly
// confirming "send" should always send, even if the automatic sweep already
// notified this client today.
// ---------------------------------------------------------------------------

function buildExpiryReminderMessage(sessionsRemaining: number | null, expiresAt: Date): string {
  const sessionsText =
    sessionsRemaining !== null ? ` Έχετε ${sessionsRemaining} μαθήματα απομείνει.` : '';
  return `Υπενθύμιση: Η συνδρομή σας λήγει στις ${formatExpiryDateGreek(expiresAt)}.${sessionsText}`;
}

/**
 * Root of the notify menu (AMENU-07): bulk vs single-client paths.
 */
export async function showNotifyMenu(chatId: string, business: Business): Promise<void> {
  const expiringData = 'menu:notify:expiring';
  const selectData = 'menu:notify:select';
  const backData = 'menu:root';
  assertCallbackDataSize(expiringData);
  assertCallbackDataSize(selectData);
  assertCallbackDataSize(backData);

  const keyboard: InlineKeyboard = [
    [{ text: 'Όλοι με λήξη σε λιγότερο από 7 ημέρες', callback_data: expiringData }],
    [{ text: 'Επιλογή πελάτη', callback_data: selectData }],
    [{ text: BACK_MENU_LABELS.ADMIN, callback_data: backData }],
  ];

  await sendTelegramMessageWithKeyboard(chatId, 'Ειδοποίηση Πελατών — τι θέλεις να κάνεις;', keyboard);
}

/**
 * Bulk path, step 1: lists every client whose membership expires within 7
 * days and asks for one Ναι/Όχι confirmation before notifying all of them.
 */
export async function showNotifyExpiringList(chatId: string, business: Business): Promise<void> {
  const backButton = { text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:root' };
  const expiring = await findMembershipsExpiringIn7Days(business.id);

  if (expiring.length === 0) {
    await sendTelegramMessageWithKeyboard(
      chatId,
      'Δεν υπάρχουν πελάτες με λήξη συνδρομής τις επόμενες 7 ημέρες.',
      [[backButton]]
    );
    return;
  }

  // Batched name lookup (not per-client) — same pattern as showClientsList.
  const allClients = await getAllClientsForBusiness(business.id);
  const nameByPhone = new Map(allClients.map((c) => [c.senderPhone, c.clientName]));

  const lines = expiring.map((m, i) => {
    const name = nameByPhone.get(m.clientPhone) ?? m.clientPhone;
    const sessionsText = m.sessionsRemaining !== null ? `${m.sessionsRemaining} μαθήματα` : 'απεριόριστα μαθήματα';
    return `${i + 1}. ${name} — ${sessionsText}, λήγει ${formatExpiryDateGreek(m.expiresAt)}`;
  });

  const yesData = 'menu:notify:expiring_yes';
  const noData = 'menu:notify:expiring_no';
  assertCallbackDataSize(yesData);
  assertCallbackDataSize(noData);

  await sendTelegramMessageWithKeyboard(
    chatId,
    `Πελάτες με λήξη συνδρομής σε λιγότερο από 7 ημέρες:\n\n${lines.join('\n')}\n\nΝα σταλεί ειδοποίηση σε όλους;`,
    [
      [
        { text: 'Ναι', callback_data: yesData },
        { text: 'Όχι', callback_data: noData },
      ],
    ]
  );
}

/**
 * Bulk path, step 2: re-resolves the expiring list fresh (not the step-1
 * snapshot — avoids acting on a stale list if a membership changed between
 * the two taps) and sends every client their reminder, best-effort per
 * client. Always replies to the owner with how many were actually sent.
 */
export async function handleNotifyExpiringExecute(chatId: string, business: Business): Promise<void> {
  const backKeyboard: InlineKeyboard = [[{ text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:root' }]];

  if (!business.botToken) {
    await sendTelegramMessage(chatId, 'Σφάλμα: δεν βρέθηκε το bot token της επιχείρησης.');
    await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', backKeyboard);
    return;
  }

  const expiring = await findMembershipsExpiringIn7Days(business.id);
  let sent = 0;

  for (const m of expiring) {
    try {
      await botTokenStore.run(business.botToken, async () => {
        await sendTelegramMessage(m.clientPhone, buildExpiryReminderMessage(m.sessionsRemaining, m.expiresAt));
      });
      sent += 1;
    } catch (err) {
      logger.error({ err, membershipId: m.id, businessId: business.id }, 'Manual expiry notification failed (best-effort)');
    }
  }

  await sendTelegramMessage(chatId, `✅ Στάλθηκαν ειδοποιήσεις σε ${sent} πελάτες.`);
  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', backKeyboard);
}

/**
 * Single-client path, step 1: lists every client with an active membership
 * (remaining sessions + expiry date next to each name) — reuses the same
 * batched getActiveMembershipsForBusiness lookup as showClientsList.
 */
export async function showNotifyClientList(chatId: string, business: Business): Promise<void> {
  const backButton = { text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:root' };
  const clients = await getAllClientsForBusiness(business.id);
  const membershipsByPhone = await getActiveMembershipsForBusiness(business.id);

  const withMembership = clients.filter((c) => membershipsByPhone.has(c.senderPhone));
  const capped = withMembership.slice(0, 20);

  if (capped.length === 0) {
    await sendTelegramMessageWithKeyboard(
      chatId,
      'Δεν υπάρχουν πελάτες με ενεργή συνδρομή.',
      [[backButton]]
    );
    return;
  }

  const keyboard: InlineKeyboard = capped.map((client) => {
    const membership = membershipsByPhone.get(client.senderPhone)!;
    const sessionsText =
      membership.sessionsRemaining !== null ? `${membership.sessionsRemaining} μαθήματα` : 'απεριόριστα';
    const cbData = `menu:notify:client_confirm:${client.clientBusinessRelationshipId}`;
    assertCallbackDataSize(cbData);
    return [
      {
        text: `${client.clientName ?? client.senderPhone} — ${sessionsText}, λήγει ${formatExpiryDateGreek(membership.expiresAt)}`,
        callback_data: cbData,
      },
    ];
  });
  keyboard.push([backButton]);

  const headerText =
    `Επίλεξε πελάτη (${capped.length}${withMembership.length > 20 ? ` από ${withMembership.length}` : ''}):`;

  await sendTelegramMessageWithKeyboard(chatId, headerText, keyboard);
}

/**
 * Single-client path, step 2: shows the chosen client's current standing and
 * asks for a Ναι/Όχι confirmation before sending.
 * Cross-tenant guard mirrors showClientBalance/handleRenewalNudge exactly.
 */
export async function showNotifyClientConfirm(
  chatId: string,
  business: Business,
  relId: number
): Promise<void> {
  const rel = await findClientBusinessRelationshipById(relId);
  if (rel?.businessId !== business.id) {
    await sendTelegramMessage(chatId, 'Ο πελάτης δεν βρέθηκε.');
    return;
  }

  const membership = await getClientActiveMembership(business.id, rel.senderPhone);
  const backToList = { text: '« Πίσω στη λίστα', callback_data: 'menu:notify:select' };

  if (!membership) {
    await sendTelegramMessageWithKeyboard(
      chatId,
      'Ο πελάτης δεν έχει πλέον ενεργή συνδρομή.',
      [[backToList]]
    );
    return;
  }

  const displayName = rel.clientName ?? rel.senderPhone;
  const sessionsText =
    membership.sessionsRemaining !== null
      ? `Υπόλοιπο: ${membership.sessionsRemaining} μαθήματα`
      : 'Απεριόριστες συνεδρίες';
  const messageText =
    `Πελάτης: ${displayName}\n${sessionsText}\nΛήγει: ${formatExpiryDateGreek(membership.expiresAt)}\n\n` +
    `Να σταλεί ειδοποίηση ανανέωσης;`;

  const yesData = `menu:notify:client_yes:${relId}`;
  const noData = `menu:notify:client_no:${relId}`;
  assertCallbackDataSize(yesData);
  assertCallbackDataSize(noData);

  await sendTelegramMessageWithKeyboard(chatId, messageText, [
    [
      { text: 'Ναι', callback_data: yesData },
      { text: 'Όχι', callback_data: noData },
    ],
  ]);
}

/**
 * Single-client path, step 3: re-resolves the client + membership fresh
 * (same ownership guard) and sends, then confirms back to the owner.
 */
export async function handleNotifyClientExecute(
  chatId: string,
  business: Business,
  relId: number
): Promise<void> {
  const backKeyboard: InlineKeyboard = [[{ text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:root' }]];
  const rel = await findClientBusinessRelationshipById(relId);
  if (rel?.businessId !== business.id) {
    await sendTelegramMessage(chatId, 'Ο πελάτης δεν βρέθηκε.');
    await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', backKeyboard);
    return;
  }

  const membership = await getClientActiveMembership(business.id, rel.senderPhone);
  if (!membership) {
    await sendTelegramMessage(chatId, 'Ο πελάτης δεν έχει πλέον ενεργή συνδρομή — δεν στάλθηκε ειδοποίηση.');
    await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', backKeyboard);
    return;
  }

  if (!business.botToken) {
    await sendTelegramMessage(chatId, 'Σφάλμα: δεν βρέθηκε το bot token της επιχείρησης.');
    await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', backKeyboard);
    return;
  }

  await botTokenStore.run(business.botToken, async () => {
    await sendTelegramMessage(
      rel.senderPhone,
      buildExpiryReminderMessage(membership.sessionsRemaining, membership.expiresAt)
    );
  });

  await sendTelegramMessage(chatId, `✅ Η ειδοποίηση στάλθηκε στον/στην ${rel.clientName ?? rel.senderPhone}.`);
  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', backKeyboard);
}

// ---------------------------------------------------------------------------
// Quick task 260729-n05: Client deletion (GDPR full erase + unlink-only)
// ---------------------------------------------------------------------------

/**
 * Shows the "Πλήρης διαγραφή" (full GDPR-style erase) confirmation prompt.
 * T-quick-01: ownership check — rel.businessId must match the owner's business.
 */
export async function showDeleteFullConfirm(
  chatId: string,
  business: Business,
  relId: number
): Promise<void> {
  const rel = await findClientBusinessRelationshipById(relId);

  if (rel?.businessId !== business.id) {
    await sendTelegramMessage(chatId, 'Ο πελάτης δεν βρέθηκε.');
    return;
  }

  const displayName = rel.clientName ?? rel.senderPhone;
  const yesData = `menu:clients:del_full_yes:${relId}`;
  const noData = `menu:clients:del_full_no:${relId}`;
  assertCallbackDataSize(yesData);
  assertCallbackDataSize(noData);

  await sendTelegramMessageWithKeyboard(
    chatId,
    `Να διαγραφεί ΠΛΗΡΩΣ ο πελάτης ${displayName};\nΘα διαγραφούν οριστικά όλες οι κρατήσεις, συνδρομές και το ιστορικό του. Η ενέργεια δεν αναιρείται.`,
    [[
      { text: 'Ναι', callback_data: yesData },
      { text: 'Όχι', callback_data: noData },
    ]]
  );
}

/**
 * Executes the full GDPR-style erase: deletes every DB row tied to this
 * client for this business (billing data, booking data, then the
 * relationship row itself), in that FK-safe order. No message is sent to the
 * client's own chat. T-quick-01: ownership check before any mutation.
 */
export async function handleDeleteFullExecute(
  chatId: string,
  business: Business,
  relId: number
): Promise<void> {
  const rel = await findClientBusinessRelationshipById(relId);

  if (rel?.businessId !== business.id) {
    await sendTelegramMessage(chatId, 'Ο πελάτης δεν βρέθηκε.');
    return;
  }

  const displayName = rel.clientName ?? rel.senderPhone;

  await deleteClientBillingData(business.id, rel.senderPhone);
  await deleteClientBookingData(business.id, rel.senderPhone);
  await deleteClientBusinessRelationship(relId, business.id);

  await sendTelegramMessage(chatId, `Ο πελάτης ${displayName} διαγράφηκε πλήρως.`);

  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', [
    [{ text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:root' }],
  ]);
}

/**
 * Shows the "Αφαίρεση από λίστα" (unlink-only) confirmation prompt.
 * T-quick-01: ownership check — rel.businessId must match the owner's business.
 */
export async function showUnlinkConfirm(
  chatId: string,
  business: Business,
  relId: number
): Promise<void> {
  const rel = await findClientBusinessRelationshipById(relId);

  if (rel?.businessId !== business.id) {
    await sendTelegramMessage(chatId, 'Ο πελάτης δεν βρέθηκε.');
    return;
  }

  const displayName = rel.clientName ?? rel.senderPhone;
  const yesData = `menu:clients:del_unlink_yes:${relId}`;
  const noData = `menu:clients:del_unlink_no:${relId}`;
  assertCallbackDataSize(yesData);
  assertCallbackDataSize(noData);

  await sendTelegramMessageWithKeyboard(
    chatId,
    `Να αφαιρεθεί ο πελάτης ${displayName} από τη λίστα πελατών;\nΟι κρατήσεις και οι συνδρομές του ΔΕΝ διαγράφονται — παραμένουν στο ιστορικό.`,
    [[
      { text: 'Ναι', callback_data: yesData },
      { text: 'Όχι', callback_data: noData },
    ]]
  );
}

/**
 * Executes the unlink-only action: deletes ONLY the clientBusinessRelationships
 * row. All booking/membership/conversation history rows remain untouched.
 * T-quick-01: ownership check before any mutation.
 */
export async function handleUnlinkExecute(
  chatId: string,
  business: Business,
  relId: number
): Promise<void> {
  const rel = await findClientBusinessRelationshipById(relId);

  if (rel?.businessId !== business.id) {
    await sendTelegramMessage(chatId, 'Ο πελάτης δεν βρέθηκε.');
    return;
  }

  const displayName = rel.clientName ?? rel.senderPhone;

  await deleteClientBusinessRelationship(relId, business.id);

  await sendTelegramMessage(chatId, `Ο πελάτης ${displayName} αφαιρέθηκε από τη λίστα.`);

  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', [
    [{ text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:root' }],
  ]);
}

// ---------------------------------------------------------------------------
// Central dispatcher (Plans 17-01 + 17-02 + 17-03 + 17-04)
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

    case menuAction === 'settings:hours_examples':
      await sendTelegramMessage(
        chatId,
        `Ώρες Λειτουργίας — παραδείγματα:

• Δευτέρα έως Παρασκευή 09:00-18:00
• Πρωί 09:00-12:00, Απόγευμα 15:00-19:00
• Μόνο Σάββατο και Κυριακή 10:00-18:00`
      );
      break;

    case menuAction === 'settings:services_examples':
      await sendTelegramMessage(
        chatId,
        `Υπηρεσίες & Τιμές — παραδείγματα:

• Pilates €60 ανά συνεδρία
• Yoga Διάνυσμα €45 / 8 μαθήματα
• Προσωπικό πρόγραμμα €80 / ώρα`
      );
      break;

    case menuAction === 'settings:classes_examples':
      await sendTelegramMessage(
        chatId,
        `Νέα Μαθήματα — παραδείγματα:

• Pilates Δευτέρα Τετάρτη 10:00-11:00 15 θέσεις
• Yoga κάθε Σάββατο 18:00-19:30 20 θέσεις
• Zumba Τρίτη Πέμπτη 19:00 25 θέσεις`
      );
      break;

    case menuAction === 'settings:calendar':
      await handleCalendarCommand(chatId, business);
      break;

    case menuAction === 'settings:calendar_disconnect':
      await handleCalendarDisconnect(chatId, business);
      break;

    case menuAction.startsWith('settings:'): {
      const toggleAction = menuAction.slice('settings:'.length);
      await handleSettingsToggle(toggleAction, business, chatId);
      break;
    }

    case menuAction === 'agenda':
      await showTodaysAgenda(chatId, business);
      break;

    case menuAction === 'invite':
      await handleInviteGeneration(chatId, business);
      break;

    case menuAction === 'notify':
      await showNotifyMenu(chatId, business);
      break;

    case menuAction === 'notify:expiring':
      await showNotifyExpiringList(chatId, business);
      break;

    case menuAction === 'notify:expiring_yes':
      await handleNotifyExpiringExecute(chatId, business);
      break;

    case menuAction === 'notify:expiring_no':
      await sendTelegramMessage(chatId, 'Παραλείφθηκε. Δεν στάλθηκαν ειδοποιήσεις.');
      await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', [
        [{ text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:root' }],
      ]);
      break;

    case menuAction === 'notify:select':
      await showNotifyClientList(chatId, business);
      break;

    case menuAction === 'notify:client_confirm': {
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: λείπει το αναγνωριστικό πελάτη.');
        return;
      }
      await showNotifyClientConfirm(chatId, business, result.id);
      break;
    }

    case menuAction === 'notify:client_yes': {
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: λείπει το αναγνωριστικό πελάτη.');
        return;
      }
      await handleNotifyClientExecute(chatId, business, result.id);
      break;
    }

    case menuAction === 'notify:client_no': {
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: λείπει το αναγνωριστικό πελάτη.');
        return;
      }
      await sendTelegramMessage(chatId, 'Παραλείφθηκε.');
      await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', [
        [{ text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:root' }],
      ]);
      break;
    }

    case menuAction === 'payment':
      await showClientSelection(business.id, chatId);
      break;

    case menuAction === 'gcal_connect':
      await handleGoogleCalendarConnect(chatId, business);
      break;

    case menuAction === 'classes':
      await showClassesMenu(chatId, business);
      break;

    case menuAction === 'classes:cancel_list':
      await showCancelClassList(chatId, business);
      break;

    case menuAction === 'classes:cancel_date': {
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: λείπει η ημερομηνία.');
        return;
      }
      await showCancelClassListForDate(chatId, business, result.id);
      break;
    }

    case menuAction === 'classes:create':
      await sendTelegramMessage(
        chatId,
        `Δημιουργία Μαθήματος — γράψε κάτι σαν:

• Δημιούργησε Pilates Δευτέρα Τετάρτη 10:00 15 θέσεις
• Νέο Yoga μαθήματα κάθε Σάββατο 18:00
• Προσθέσε Zumba Τρίτη Πέμπτη 19:00-20:00 25 θέσεις`
      );
      break;

    case menuAction === 'classes:cancel_confirm_req': {
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: λείπει το αναγνωριστικό μαθήματος.');
        return;
      }
      await showCancelClassConfirm(chatId, business, result.id);
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
        [{ text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:root' }],
      ]);
      break;
    }

    case menuAction === 'clients':
      await showClientsList(chatId, business);
      break;

    case menuAction === 'clients:balance': {
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: λείπει το αναγνωριστικό πελάτη.');
        return;
      }
      await showClientBalance(chatId, business, result.id);
      break;
    }

    case menuAction === 'clients:nudge': {
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: λείπει το αναγνωριστικό πελάτη.');
        return;
      }
      await handleRenewalNudge(chatId, business, result.id);
      break;
    }

    case menuAction === 'clients:del_full_confirm': {
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: λείπει το αναγνωριστικό πελάτη.');
        return;
      }
      await showDeleteFullConfirm(chatId, business, result.id);
      break;
    }

    case menuAction === 'clients:del_full_yes': {
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: λείπει το αναγνωριστικό πελάτη.');
        return;
      }
      await handleDeleteFullExecute(chatId, business, result.id);
      break;
    }

    case menuAction === 'clients:del_full_no': {
      await sendTelegramMessage(chatId, 'Η διαγραφή ματαιώθηκε.');
      await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', [
        [{ text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:root' }],
      ]);
      break;
    }

    case menuAction === 'clients:del_unlink_confirm': {
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: λείπει το αναγνωριστικό πελάτη.');
        return;
      }
      await showUnlinkConfirm(chatId, business, result.id);
      break;
    }

    case menuAction === 'clients:del_unlink_yes': {
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: λείπει το αναγνωριστικό πελάτη.');
        return;
      }
      await handleUnlinkExecute(chatId, business, result.id);
      break;
    }

    case menuAction === 'clients:del_unlink_no': {
      await sendTelegramMessage(chatId, 'Η αφαίρεση ματαιώθηκε.');
      await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', [
        [{ text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:root' }],
      ]);
      break;
    }

    default: {
      const keyboard: InlineKeyboard = [[{ text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:root' }]];
      await sendTelegramMessageWithKeyboard(chatId, 'Άγνωστη ενέργεια μενού.', keyboard);
      break;
    }
  }
}
