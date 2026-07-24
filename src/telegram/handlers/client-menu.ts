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

import {
  Business,
  listClientBookings,
  findBookingByIdUnscoped,
  updateBookingStatus,
} from '../../database/queries';
import {
  InlineKeyboard,
  sendTelegramMessage,
  sendTelegramMessageWithKeyboard,
  botTokenStore,
} from '../client';
import { logger } from '../../utils/logger';
import { listSessions, bookSessionInstance } from '../../session/manager';
import { checkEnforcementAndGetMembership } from '../../billing/enforcement';
import {
  getClientActiveMembership,
  findMembershipByBooking,
  restoreCredit,
} from '../../billing/queries';
import { deleteBookingFromCalendar } from '../../calendar/sync';
import { db } from '../../database/db';
import { sessionInstances, sessionCatalog } from '../../database/schema';
import { eq } from 'drizzle-orm';

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
// Local helper: compute hours until a session starts in the Europe/Athens timezone.
// Copied verbatim from src/conversation/function-executor.ts (hoursUntilSessionInAthens).
// Not imported from there because that module is a conversation-layer concern —
// importing it here would create unnecessary coupling.
// ---------------------------------------------------------------------------
function hoursUntilSession(sessionDate: string, sessionTime: string): number {
  const noonUTC = new Date(`${sessionDate}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Athens',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(noonUTC);
  const athensHour = Number.parseInt(parts.find((p) => p.type === 'hour')!.value, 10);
  const offsetHours = athensHour - 12;
  const [hh, mm] = sessionTime.split(':').map(Number);
  const sessionUTCMs =
    Date.parse(
      `${sessionDate}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`
    ) -
    offsetHours * 3_600_000;
  return (sessionUTCMs - Date.now()) / 3_600_000;
}

// ---------------------------------------------------------------------------
// Plan 18-02: Book a class flow (CMENU-02, CMENU-04)
// ---------------------------------------------------------------------------

/**
 * Shows up to 10 available session instances for the next 14 days.
 * Guard: only for fixed_sessions booking mode.
 */
export async function showBookSessionList(chatId: string, business: Business): Promise<void> {
  if (business.bookingMode !== 'fixed_sessions') {
    await sendTelegramMessage(
      chatId,
      'Για κράτηση μαθήματος, γράψε μου στο chat τι θέλεις να κλείσεις.'
    );
    return;
  }

  const sessions = await listSessions(business.id, 14);
  const available = sessions.filter((s) => s.bookedCount < s.capacity).slice(0, 10);

  if (available.length === 0) {
    const keyboard: InlineKeyboard = [
      [{ text: '« Πίσω', callback_data: 'cmenu:root' }],
    ];
    await sendTelegramMessageWithKeyboard(
      chatId,
      'Δεν υπάρχουν διαθέσιμα μαθήματα για τις επόμενες 14 ημέρες.',
      keyboard
    );
    return;
  }

  const rows: InlineKeyboard = available.map((s) => {
    const callbackData = `cmenu:book:confirm:${s.instanceId}`;
    assertCallbackDataSize(callbackData);
    return [{ text: `${s.sessionDate} ${s.sessionTime}`, callback_data: callbackData }];
  });
  rows.push([{ text: '« Πίσω', callback_data: 'cmenu:root' }]);

  await sendTelegramMessageWithKeyboard(chatId, 'Επίλεξε μάθημα:', rows);
}

/**
 * Shows a Ναι/Όχι confirmation prompt for the selected session instance.
 */
export async function showBookConfirm(chatId: string, instanceId: number): Promise<void> {
  const yesData = `cmenu:book:yes:${instanceId}`;
  const noData = 'cmenu:root';
  assertCallbackDataSize(yesData);
  assertCallbackDataSize(noData);

  const keyboard: InlineKeyboard = [
    [
      { text: 'Ναι', callback_data: yesData },
      { text: 'Όχι', callback_data: noData },
    ],
  ];

  await sendTelegramMessageWithKeyboard(chatId, 'Να κρατηθεί αυτό το μάθημα;', keyboard);
}

/**
 * Executes the booking after the client confirms (CMENU-04).
 * Runs enforcement gate before calling bookSessionInstance.
 * senderTelegramId === chatId for private Telegram chats.
 */
export async function handleBookSessionExecute(
  chatId: string,
  business: Business,
  senderTelegramId: string,
  instanceId: number
): Promise<void> {
  const enforcementResult = await checkEnforcementAndGetMembership(
    business.id,
    senderTelegramId
  );
  if (!enforcementResult.allowed) {
    await sendTelegramMessage(chatId, enforcementResult.message ?? 'Δεν επιτρέπεται η κράτηση.');
    return;
  }

  // Resolve serviceId via Drizzle join (findSessionInstanceById does not exist)
  const instanceRow = await db
    .select({ serviceId: sessionCatalog.serviceId })
    .from(sessionInstances)
    .innerJoin(sessionCatalog, eq(sessionInstances.catalogId, sessionCatalog.id))
    .where(eq(sessionInstances.id, instanceId))
    .limit(1);
  const serviceId = instanceRow[0]?.serviceId;

  if (serviceId === undefined) {
    await sendTelegramMessage(chatId, 'Το μάθημα δεν βρέθηκε.');
    return;
  }

  const idempotencyKey = `cmenu:book:${senderTelegramId}:${instanceId}`;
  const bookResult = await bookSessionInstance(
    business.id,
    instanceId,
    senderTelegramId,
    serviceId,
    idempotencyKey,
    enforcementResult.membership
  );

  if (!bookResult || bookResult.status === 'full') {
    await sendTelegramMessage(
      chatId,
      'Δυστυχώς αυτό το μάθημα έχει γεμίσει. Δοκιμάστε άλλη ώρα.'
    );
    return;
  }

  await sendTelegramMessage(chatId, 'Η κράτησή σας επιβεβαιώθηκε! Θα σας δούμε σύντομα.');

  const backKeyboard: InlineKeyboard = [
    [{ text: '« Αρχικό μενού', callback_data: 'cmenu:root' }],
  ];
  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', backKeyboard);

  logger.info({ businessId: business.id, senderTelegramId, instanceId }, 'client session booked');
}

// ---------------------------------------------------------------------------
// Plan 18-03: My Bookings, Cancel flow, My Balance (CMENU-03, CMENU-04)
// ---------------------------------------------------------------------------

/**
 * Shows the client's active bookings (pending_owner_approval + confirmed).
 * If empty: informational message + back button.
 * If non-empty: formatted list + Cancel and Back buttons.
 */
export async function showClientBookings(chatId: string, business: Business): Promise<void> {
  const clientBookings = await listClientBookings(business.id, chatId);

  const backButton = { text: '« Πίσω', callback_data: 'cmenu:root' };
  assertCallbackDataSize(backButton.callback_data);

  if (clientBookings.length === 0) {
    await sendTelegramMessageWithKeyboard(
      chatId,
      'Δεν έχετε ενεργές κρατήσεις.',
      [[backButton]]
    );
    return;
  }

  const lines = clientBookings.map((b) => `${b.calendarDate} ${b.calendarTime}`);
  const text = 'Ενεργές κρατήσεις σας:\n\n' + lines.join('\n');

  const cancelData = 'cmenu:cancel';
  assertCallbackDataSize(cancelData);

  const keyboard: InlineKeyboard = [
    [
      { text: 'Ακύρωση κράτησης', callback_data: cancelData },
      backButton,
    ],
  ];

  await sendTelegramMessageWithKeyboard(chatId, text, keyboard);
}

/**
 * Shows the list of bookings the client can cancel (up to 10), one button each.
 */
export async function showCancelBookingList(
  chatId: string,
  business: Business,
  senderTelegramId: string
): Promise<void> {
  const clientBookings = await listClientBookings(business.id, senderTelegramId);

  const backButton = { text: '« Πίσω', callback_data: 'cmenu:root' };
  assertCallbackDataSize(backButton.callback_data);

  if (clientBookings.length === 0) {
    await sendTelegramMessageWithKeyboard(
      chatId,
      'Δεν έχετε κρατήσεις προς ακύρωση.',
      [[backButton]]
    );
    return;
  }

  const capped = clientBookings.slice(0, 10);

  const rows: InlineKeyboard = capped.map((b) => {
    const callbackData = `cmenu:cancel:confirm:${b.id}`;
    assertCallbackDataSize(callbackData);
    return [{ text: `${b.calendarDate} ${b.calendarTime}`, callback_data: callbackData }];
  });
  rows.push([backButton]);

  await sendTelegramMessageWithKeyboard(chatId, 'Επίλεξε κράτηση για ακύρωση:', rows);
}

/**
 * Shows a Ναι/Όχι confirmation prompt before cancelling a booking.
 */
export async function showCancelConfirm(chatId: string, bookingId: number): Promise<void> {
  const yesData = `cmenu:cancel:yes:${bookingId}`;
  const noData = 'cmenu:root';
  assertCallbackDataSize(yesData);
  assertCallbackDataSize(noData);

  const keyboard: InlineKeyboard = [
    [
      { text: 'Ναι', callback_data: yesData },
      { text: 'Όχι', callback_data: noData },
    ],
  ];

  await sendTelegramMessageWithKeyboard(chatId, 'Να ακυρωθεί αυτή η κράτηση;', keyboard);
}

/**
 * Executes cancellation after client confirms (CMENU-04):
 * ownership guard → status check → cutoff check → cancel → credit restore →
 * calendar delete (best-effort) → owner notification (best-effort) → confirm.
 */
export async function handleCancelExecute(
  chatId: string,
  business: Business,
  senderTelegramId: string,
  bookingId: number
): Promise<void> {
  const booking = await findBookingByIdUnscoped(bookingId);
  if (!booking) {
    await sendTelegramMessage(chatId, 'Κράτηση δεν βρέθηκε.');
    return;
  }

  // Ownership guard — must be before any DB mutation
  if (booking.clientPhone !== senderTelegramId) {
    logger.warn(
      { bookingId, senderTelegramId, clientPhone: booking.clientPhone },
      'client cancel ownership mismatch'
    );
    await sendTelegramMessage(chatId, 'Δεν έχετε δικαίωμα ακύρωσης αυτής της κράτησης.');
    return;
  }

  // Status check — only pending_owner_approval and confirmed can be cancelled
  if (
    booking.bookingStatus !== 'pending_owner_approval' &&
    booking.bookingStatus !== 'confirmed'
  ) {
    await sendTelegramMessage(chatId, 'Αυτή η κράτηση δεν μπορεί να ακυρωθεί.');
    return;
  }

  // Cutoff check — if cutoff is enabled and we are within the window, refuse
  if (
    business.cancellationCutoffEnabled &&
    booking.calendarDate &&
    booking.calendarTime
  ) {
    const hours = hoursUntilSession(booking.calendarDate, booking.calendarTime);
    if (hours < business.cancellationCutoffHours) {
      await sendTelegramMessage(
        chatId,
        `Η ακύρωση δεν είναι δυνατή εντός ${business.cancellationCutoffHours} ωρών από το μάθημα.`
      );
      return;
    }
  }

  // Cancel the booking
  await updateBookingStatus(booking.id, 'cancelled');

  // Credit restore (idempotent — safe to call even if no session was deducted)
  const membershipId = await findMembershipByBooking(booking.id);
  if (membershipId !== null) {
    await restoreCredit(membershipId, booking.id, `booking:${booking.id}:credit`);
  }

  // Calendar delete — best-effort
  try {
    await deleteBookingFromCalendar(booking, business);
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'Calendar deletion failed (best-effort, client cancel)');
  }

  // Owner notification — best-effort
  try {
    if (business.ownerTelegramId && business.botToken) {
      const ownerText =
        'Ακύρωση κράτησης από πελάτη:\nΗμερομηνία: ' +
        booking.calendarDate +
        '\nΏρα: ' +
        booking.calendarTime +
        '\nΠελάτης: ' +
        booking.clientPhone;
      await botTokenStore.run(business.botToken, async () => {
        await sendTelegramMessage(business.ownerTelegramId!, ownerText);
      });
    }
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'Owner cancel notification failed (best-effort)');
  }

  // Confirm to client
  await sendTelegramMessage(chatId, 'Η κράτησή σας ακυρώθηκε.');

  const backKeyboard: InlineKeyboard = [
    [{ text: '« Αρχικό μενού', callback_data: 'cmenu:root' }],
  ];
  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', backKeyboard);

  logger.info({ businessId: business.id, senderTelegramId, bookingId }, 'client booking cancelled');
}

/**
 * Shows the client's active membership balance, or a "no membership" message.
 */
export async function showClientBalance(chatId: string, business: Business): Promise<void> {
  const membership = await getClientActiveMembership(business.id, chatId);

  const backButton = { text: '« Πίσω', callback_data: 'cmenu:root' };
  assertCallbackDataSize(backButton.callback_data);

  if (!membership) {
    await sendTelegramMessageWithKeyboard(
      chatId,
      'Δεν υπάρχει ενεργή συνδρομή.',
      [[backButton]]
    );
    return;
  }

  const expiryStr = membership.expiresAt.toLocaleDateString('el-GR');
  let text: string;
  if (membership.isUnlimited) {
    text =
      `Πακέτο: ${membership.packageName}\nΑπεριόριστες συνεδρίες\nΛήξη: ${expiryStr}`;
  } else {
    text =
      `Πακέτο: ${membership.packageName}\nΥπόλοιπο: ${membership.sessionsRemaining} μαθήματα\nΛήξη: ${expiryStr}`;
  }

  await sendTelegramMessageWithKeyboard(chatId, text, [[backButton]]);
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

    // Plan 18-02: book a class flow
    case clientMenuAction === 'book':
      await showBookSessionList(chatId, business);
      break;

    case clientMenuAction === 'book:confirm':
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: δεν βρέθηκε το μάθημα.');
      } else {
        await showBookConfirm(chatId, result.id);
      }
      break;

    case clientMenuAction === 'book:yes':
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: δεν βρέθηκε το μάθημα.');
      } else {
        // chatId === senderTelegramId for private Telegram chats
        await handleBookSessionExecute(chatId, business, chatId, result.id);
      }
      break;

    // Plan 18-03: my bookings, cancel flow, balance
    case clientMenuAction === 'bookings':
      await showClientBookings(chatId, business);
      break;

    case clientMenuAction === 'cancel':
      await showCancelBookingList(chatId, business, chatId);
      break;

    case clientMenuAction === 'cancel:confirm':
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: δεν βρέθηκε η κράτηση.');
      } else {
        await showCancelConfirm(chatId, result.id);
      }
      break;

    case clientMenuAction === 'cancel:yes':
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: δεν βρέθηκε η κράτηση.');
      } else {
        await handleCancelExecute(chatId, business, chatId, result.id);
      }
      break;

    case clientMenuAction === 'balance':
      await showClientBalance(chatId, business);
      break;

    default:
      await sendTelegramMessage(chatId, 'Άγνωστη ενέργεια.');
      break;
  }
}
