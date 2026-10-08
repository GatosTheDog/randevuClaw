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
  updateBookingOwnerMessageId,
  findServiceById,
} from '../../database/queries';
import { sendEscalationToAdmin, EscalationReason } from '../escalation';
import {
  InlineKeyboard,
  sendTelegramMessage,
  sendTelegramMessageWithKeyboard,
  botTokenStore,
} from '../client';
import { logger } from '../../utils/logger';
import { listSessions, bookSessionInstance, findSessionInstanceById } from '../../session/manager';
import { BACK_MENU_LABELS } from '../../utils/greek-messages';
import { hoursUntilSession, isoDateInAthens, formatExpiryDateGreek } from '../../utils/timezone';
import { buildWeekGridRows, callbackIdToDate, formatDateButtonLabel } from '../../utils/date-picker';
import { checkEnforcementAndGetMembership } from '../../billing/enforcement';
import {
  getClientActiveMembership,
  findMembershipByBooking,
  restoreCredit,
  getClientName,
} from '../../billing/queries';
import { deleteBookingFromCalendar } from '../../calendar/sync';
import { appendCancelCalendarNote } from '../../calendar/client-link';
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

  const bookingButtonText =
    business.bookingMode === 'fixed_sessions' ? 'Κράτηση μαθήματος' : 'Κράτηση ραντεβού';

  const keyboard: InlineKeyboard = [
    [
      { text: bookingButtonText, callback_data: callbackDataBook },
      { text: 'Οι κρατήσεις μου', callback_data: callbackDataBookings },
    ],
    [
      { text: 'Ακύρωση κράτησης', callback_data: callbackDataCancel },
      { text: 'Υπόλοιπο μαθημάτων', callback_data: callbackDataBalance },
    ],
  ];

  const menuText = `Καλώς ήρθες! Τι θέλεις να κάνεις;

1. ${bookingButtonText}
2. Οι κρατήσεις μου
3. Ακύρωση κράτησης
4. Υπόλοιπο μαθημάτων`;

  await sendTelegramMessageWithKeyboard(chatId, menuText, keyboard);
}

// ---------------------------------------------------------------------------
// Plan 18-02: Book a class flow (CMENU-02, CMENU-04)
// ---------------------------------------------------------------------------

// Booking window: how many calendar days forward the client can browse
// (roughly a month), matching admin-menu.ts's own 30-day lookahead.
const BOOKING_WINDOW_DAYS = 30;

/**
 * Step 1 of booking: shows a week-per-row calendar grid (next 30 days) that has at
 * least one available session. Guard: only for fixed_sessions booking mode.
 */
export async function showBookDateList(chatId: string, business: Business): Promise<void> {
  if (business.bookingMode !== 'fixed_sessions') {
    const keyboard: InlineKeyboard = [
      [{ text: BACK_MENU_LABELS.CLIENT, callback_data: 'cmenu:root' }],
    ];
    await sendTelegramMessageWithKeyboard(
      chatId,
      'Για κράτηση ραντεβού, γράψε μου στο chat τι θέλεις να κλείσεις.',
      keyboard
    );
    return;
  }

  // Membership preview (D-11): a plain, non-locking read — this is a browse
  // step, not a deduction, so getClientActiveMembership (not the FOR UPDATE
  // getActiveMembershipForDeduction used at execute time) is the right call.
  const membership = await getClientActiveMembership(business.id, chatId);
  const hasCapacity =
    membership !== null &&
    (membership.sessionsRemaining === null || membership.sessionsRemaining > 0);

  if (!hasCapacity && business.enforcementPolicy === 'block') {
    const keyboard: InlineKeyboard = [
      [{ text: BACK_MENU_LABELS.CLIENT, callback_data: 'cmenu:root' }],
    ];
    await sendTelegramMessageWithKeyboard(
      chatId,
      'Για να κάνετε κράτηση, χρειάζεστε ενεργή συνδρομή. Επικοινωνήστε με τον διαχειριστή για ανανέωση.',
      keyboard
    );
    return;
  }

  const sessions = await listSessions(business.id, BOOKING_WINDOW_DAYS, true);
  const available = sessions.filter((s) => s.bookedCount < s.capacity);

  // D-11: a membership only covers slots up to its own expiry — cap the
  // browsable date range to it regardless of enforcement policy, so a client
  // is never offered a date they'd need to renew for before it even loads.
  const cappedAtDate = membership ? isoDateInAthens(membership.expiresAt) : null;
  const withinMembership = cappedAtDate
    ? available.filter((s) => s.sessionDate <= cappedAtDate)
    : available;

  if (withinMembership.length === 0) {
    const keyboard: InlineKeyboard = [
      [{ text: BACK_MENU_LABELS.CLIENT, callback_data: 'cmenu:root' }],
    ];
    const message =
      cappedAtDate && available.length > 0
        ? `Δεν έχεις διαθέσιμες ημερομηνίες εντός της συνδρομής σου (ισχύει έως ${formatExpiryDateGreek(membership!.expiresAt)}). Ανανέωσε τη συνδρομή σου για μαθήματα αργότερα.`
        : `Δεν υπάρχουν διαθέσιμα μαθήματα για τις επόμενες ${BOOKING_WINDOW_DAYS} ημέρες.`;
    await sendTelegramMessageWithKeyboard(chatId, message, keyboard);
    return;
  }

  // listSessions returns rows ordered by sessionDate, so dedup preserves order.
  const dates = [...new Set(withinMembership.map((s) => s.sessionDate))];

  const rows: InlineKeyboard = buildWeekGridRows(dates, 'cmenu:book:date', 'cmenu:book:none');
  rows.push([{ text: BACK_MENU_LABELS.CLIENT, callback_data: 'cmenu:root' }]);

  let banner: string;
  if (membership && hasCapacity) {
    banner = membership.isUnlimited
      ? `Έχεις απεριόριστες συνεδρίες (ισχύουν έως ${formatExpiryDateGreek(membership.expiresAt)}).`
      : `Έχεις ${membership.sessionsRemaining} διαθέσιμα μαθήματα (ισχύουν έως ${formatExpiryDateGreek(membership.expiresAt)}).`;
  } else {
    // !hasCapacity here only reaches this point under a non-'block' policy
    // (flag/allow) — the 'block' case already returned above.
    banner = '⚠️ Δεν έχεις ενεργή συνδρομή. Η κράτηση θα σταλεί στον διαχειριστή για έγκριση.';
  }

  await sendTelegramMessageWithKeyboard(chatId, `${banner}\n\nΕπίλεξε ημέρα (οι ημέρες με διαθέσιμα μαθήματα φαίνονται ως αριθμοί):`, rows);
}

/**
 * Step 2 of booking: shows up to 10 available session instances for the
 * chosen date. Guard: only for fixed_sessions booking mode.
 */
export async function showBookSessionList(
  chatId: string,
  business: Business,
  dateId: number
): Promise<void> {
  if (business.bookingMode !== 'fixed_sessions') {
    const keyboard: InlineKeyboard = [
      [{ text: BACK_MENU_LABELS.CLIENT, callback_data: 'cmenu:root' }],
    ];
    await sendTelegramMessageWithKeyboard(
      chatId,
      'Για κράτηση ραντεβού, γράψε μου στο chat τι θέλεις να κλείσεις.',
      keyboard
    );
    return;
  }

  const date = callbackIdToDate(dateId);
  const sessions = await listSessions(business.id, BOOKING_WINDOW_DAYS, true);
  const available = sessions
    .filter((s) => s.sessionDate === date && s.bookedCount < s.capacity)
    .slice(0, 10);

  const backToDates = { text: BACK_MENU_LABELS.CLIENT, callback_data: 'cmenu:book' };
  assertCallbackDataSize(backToDates.callback_data);

  if (available.length === 0) {
    await sendTelegramMessageWithKeyboard(
      chatId,
      'Δεν υπάρχουν πλέον διαθέσιμα μαθήματα για αυτή την ημερομηνία.',
      [[backToDates]]
    );
    return;
  }

  const serviceIds = [...new Set(available.map((s) => s.serviceId))];
  const serviceNamesById = new Map<number, string>();
  for (const serviceId of serviceIds) {
    const service = await findServiceById(business.id, serviceId);
    serviceNamesById.set(serviceId, service?.name ?? '(άγνωστη υπηρεσία)');
  }

  const rows: InlineKeyboard = available.map((s) => {
    const callbackData = `cmenu:book:confirm:${s.instanceId}`;
    assertCallbackDataSize(callbackData);
    return [
      {
        text: `${serviceNamesById.get(s.serviceId)} - ${s.sessionTime}`,
        callback_data: callbackData,
      },
    ];
  });
  rows.push([backToDates]);

  await sendTelegramMessageWithKeyboard(chatId, 'Επίλεξε μάθημα:', rows);
}

// Max extra weekly repeats offered alongside the chosen session.
const SERIES_MAX_EXTRA = 4;

/**
 * Later instances of the same weekly class (same catalog) the client could
 * also be booked into: not full, inside the booking window, and — when the
 * client has a membership — not past its expiry (D-11).
 */
async function findSeriesInstances(
  business: Business,
  chatId: string,
  base: { instanceId: number; catalogId: number; sessionDate: string }
) {
  const membership = await getClientActiveMembership(business.id, chatId);
  const cappedAtDate = membership ? isoDateInAthens(membership.expiresAt) : null;
  const sessions = await listSessions(business.id, BOOKING_WINDOW_DAYS, true);
  return sessions
    .filter(
      (s) =>
        s.catalogId === base.catalogId &&
        s.sessionDate > base.sessionDate &&
        s.bookedCount < s.capacity &&
        (!cappedAtDate || s.sessionDate <= cappedAtDate)
    )
    .slice(0, SERIES_MAX_EXTRA);
}

/**
 * Shows a Ναι/Όχι confirmation prompt for the selected session instance.
 * When the business allows multi-booking and the same weekly class has later
 * open dates, also offers booking those in the same tap.
 */
export async function showBookConfirm(
  chatId: string,
  instanceId: number,
  business?: Business
): Promise<void> {
  const yesData = `cmenu:book:yes:${instanceId}`;
  const noData = 'cmenu:root';
  assertCallbackDataSize(yesData);
  assertCallbackDataSize(noData);

  let extras: Awaited<ReturnType<typeof findSeriesInstances>> = [];
  if (business?.allowMultiBooking) {
    const base = await findSessionInstanceById(business.id, instanceId);
    if (base) extras = await findSeriesInstances(business, chatId, base);
  }

  if (extras.length === 0) {
    const keyboard: InlineKeyboard = [
      [
        { text: 'Ναι', callback_data: yesData },
        { text: 'Όχι', callback_data: noData },
      ],
    ];
    await sendTelegramMessageWithKeyboard(chatId, 'Να κρατηθεί αυτό το μάθημα;', keyboard);
    return;
  }

  const seriesData = `cmenu:book:series:${instanceId}`;
  assertCallbackDataSize(seriesData);
  const keyboard: InlineKeyboard = [
    [{ text: 'Ναι, μόνο αυτό', callback_data: yesData }],
    [{ text: `Ναι, και τις επόμενες ${extras.length}`, callback_data: seriesData }],
    [{ text: 'Όχι', callback_data: noData }],
  ];
  const dateList = extras.map((e) => `• ${formatDateButtonLabel(e.sessionDate)}`).join('\n');
  await sendTelegramMessageWithKeyboard(
    chatId,
    `Να κρατηθεί αυτό το μάθημα;\n\nΜπορώ να κρατήσω θέση και στις επόμενες εβδομάδες (ίδια ώρα):\n${dateList}`,
    keyboard
  );
}

/**
 * Executes the booking after the client confirms (CMENU-04).
 * Runs enforcement gate before calling bookSessionInstance.
 * senderTelegramId === chatId for private Telegram chats.
 */
type BookOneResult =
  | { kind: 'success'; session: { sessionDate: string; sessionTime: string } }
  | { kind: 'not_allowed' }
  | { kind: 'not_found' }
  | { kind: 'full' }
  | { kind: 'conflict'; status: string };

/**
 * Books one session instance for the client: enforcement gate, booking,
 * owner approval notification. Returns the outcome without messaging the
 * client, so single and series flows share it.
 */
async function bookOneInstance(
  business: Business,
  senderTelegramId: string,
  instanceId: number
): Promise<BookOneResult> {
  const enforcementResult = await checkEnforcementAndGetMembership(
    business.id,
    senderTelegramId
  );
  if (!enforcementResult.allowed) return { kind: 'not_allowed' };

  // Resolve serviceId, sessionDate, and sessionTime via the shared,
  // businessId-scoped lookup (D-06) — also pulls sessionDate/sessionTime
  // here (rather than a second round-trip later) so the owner-alert text
  // below can reference them.
  const session = await findSessionInstanceById(business.id, instanceId);
  if (!session) return { kind: 'not_found' };
  const serviceId = session.serviceId;

  const idempotencyKey = `cmenu:book:${senderTelegramId}:${instanceId}`;
  const bookResult = await bookSessionInstance(
    business.id,
    instanceId,
    senderTelegramId,
    serviceId,
    idempotencyKey,
    enforcementResult.membership
  );

  if (!bookResult || bookResult.status === 'full') return { kind: 'full' };
  if (bookResult.status !== 'success') return { kind: 'conflict', status: bookResult.status };

  // Owner notification — best-effort (mirrors handleCancelExecute's pattern
  // below and bookSessionTool's equivalent AI-chat alert in
  // function-executor.ts). Phase 22 (OWNR-05/06): session bookings are now
  // created pending_owner_approval by default, so this sends an
  // Έγκριση/Απόρριψη approval keyboard instead of a plain informational alert.
  try {
    if (business.ownerTelegramId && business.botToken) {
      const clientDisplayName = (await getClientName(business.id, senderTelegramId)) ?? senderTelegramId;
      const ownerText =
        'Νέα κράτηση αναμονής:\nΗμερομηνία: ' +
        session.sessionDate +
        '\nΏρα: ' +
        session.sessionTime +
        '\nΠελάτης: ' +
        clientDisplayName;
      const approveData = `sbk:approve:${bookResult.bookingId}`;
      const rejectData = `sbk:reject:${bookResult.bookingId}`;
      assertCallbackDataSize(approveData);
      assertCallbackDataSize(rejectData);
      await botTokenStore.run(business.botToken, async () => {
        const msgResp = await sendTelegramMessageWithKeyboard(business.ownerTelegramId!, ownerText, [
          [
            { text: 'Έγκριση', callback_data: approveData },
            { text: 'Απόρριψη', callback_data: rejectData },
          ],
        ]);
        if (bookResult.bookingId) {
          await updateBookingOwnerMessageId(bookResult.bookingId, msgResp.messageId);
        }
      });
    }
  } catch (err) {
    logger.error({ err, businessId: business.id, senderTelegramId, instanceId }, 'Owner booking notification failed (best-effort)');
  }

  logger.info({ businessId: business.id, senderTelegramId, instanceId }, 'client session booked');
  return { kind: 'success', session };
}

/**
 * Executes the booking after the client confirms (CMENU-04).
 * senderTelegramId === chatId for private Telegram chats.
 */
export async function handleBookSessionExecute(
  chatId: string,
  business: Business,
  senderTelegramId: string,
  instanceId: number
): Promise<void> {
  const result = await bookOneInstance(business, senderTelegramId, instanceId);

  switch (result.kind) {
    case 'not_allowed':
      await sendTelegramMessage(chatId, 'Δυστυχώς δεν ήταν δυνατή η κράτησή σας. Ο διαχειριστής ειδοποιήθηκε.');
      await sendEscalationToAdmin(business, senderTelegramId, 'κράτηση μαθήματος', 'membership_expired');
      logger.info({ businessId: business.id, senderTelegramId, reason: 'membership_expired' }, 'escalation triggered');
      return;
    case 'not_found':
      await sendTelegramMessage(chatId, 'Το μάθημα δεν βρέθηκε.');
      return;
    case 'full':
      await sendTelegramMessage(chatId, 'Δυστυχώς δεν ήταν δυνατή η κράτησή σας. Ο διαχειριστής ειδοποιήθηκε.');
      await sendEscalationToAdmin(business, senderTelegramId, 'κράτηση μαθήματος', 'class_full', instanceId);
      logger.info({ businessId: business.id, senderTelegramId, instanceId, reason: 'class_full' }, 'escalation triggered');
      return;
    case 'conflict':
      await sendTelegramMessage(chatId, 'Το μάθημα δεν βρέθηκε ή δεν είναι πλέον διαθέσιμο.');
      logger.info({ businessId: business.id, senderTelegramId, instanceId, status: result.status }, 'book session conflict');
      return;
  }

  await sendTelegramMessage(chatId, 'Το αίτημά σας στάλθηκε στον διαχειριστή! Αναμονή επιβεβαίωσης...');

  const backKeyboard: InlineKeyboard = [
    [{ text: BACK_MENU_LABELS.CLIENT, callback_data: 'cmenu:root' }],
  ];
  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', backKeyboard);
}

/**
 * Books the chosen session plus its upcoming weekly repeats in one go.
 * Sequential on purpose (capacity races, membership deduction per booking).
 * Gated on allowMultiBooking, same as the AI-chat multi-booking path.
 */
export async function handleBookSeriesExecute(
  chatId: string,
  business: Business,
  senderTelegramId: string,
  instanceId: number
): Promise<void> {
  if (!business.allowMultiBooking) {
    await handleBookSessionExecute(chatId, business, senderTelegramId, instanceId);
    return;
  }

  const base = await findSessionInstanceById(business.id, instanceId);
  if (!base) {
    await sendTelegramMessage(chatId, 'Το μάθημα δεν βρέθηκε.');
    return;
  }
  const extras = await findSeriesInstances(business, chatId, base);
  const ids = [instanceId, ...extras.map((e) => e.instanceId)];

  const booked: string[] = [];
  const failed: string[] = [];
  let blocked = false;
  for (const id of ids) {
    const res = await bookOneInstance(business, senderTelegramId, id);
    const label =
      id === instanceId
        ? formatDateButtonLabel(base.sessionDate)
        : formatDateButtonLabel(extras.find((e) => e.instanceId === id)!.sessionDate);
    if (res.kind === 'success') {
      booked.push(label);
    } else {
      failed.push(label);
      if (res.kind === 'not_allowed') {
        blocked = true;
        break; // no active membership / credits left — later dates would fail too
      }
    }
  }

  if (blocked && booked.length === 0) {
    await sendTelegramMessage(chatId, 'Δυστυχώς δεν ήταν δυνατή η κράτησή σας. Ο διαχειριστής ειδοποιήθηκε.');
    await sendEscalationToAdmin(business, senderTelegramId, 'κράτηση μαθήματος', 'membership_expired');
    return;
  }

  let text = '';
  if (booked.length > 0) {
    text += `Στάλθηκαν στον διαχειριστή ${booked.length} αιτήματα κράτησης:\n${booked.map((d) => `• ${d}`).join('\n')}\nΑναμονή επιβεβαίωσης...`;
  }
  if (failed.length > 0) {
    text += `${text ? '\n\n' : ''}Δεν ήταν δυνατή η κράτηση για:\n${failed.map((d) => `• ${d}`).join('\n')}`;
    if (blocked) text += '\n(Δεν υπάρχουν αρκετά διαθέσιμα μαθήματα στη συνδρομή σου.)';
  }
  await sendTelegramMessage(chatId, text);

  const backKeyboard: InlineKeyboard = [
    [{ text: BACK_MENU_LABELS.CLIENT, callback_data: 'cmenu:root' }],
  ];
  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', backKeyboard);
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

  const backButton = { text: BACK_MENU_LABELS.CLIENT, callback_data: 'cmenu:root' };
  assertCallbackDataSize(backButton.callback_data);

  if (clientBookings.length === 0) {
    await sendTelegramMessageWithKeyboard(
      chatId,
      'Δεν έχετε ενεργές κρατήσεις.',
      [[backButton]]
    );
    return;
  }

  const serviceIds = [...new Set(clientBookings.map((b) => b.serviceId))];
  const serviceNamesById = new Map<number, string>();
  for (const serviceId of serviceIds) {
    const service = await findServiceById(business.id, serviceId);
    serviceNamesById.set(serviceId, service?.name ?? '(άγνωστη υπηρεσία)');
  }

  const lines = clientBookings.map(
    (b) => `${serviceNamesById.get(b.serviceId)} - ${b.calendarDate} ${b.calendarTime}`
  );
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

  const backButton = { text: BACK_MENU_LABELS.CLIENT, callback_data: 'cmenu:root' };
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

  const serviceIds = [...new Set(capped.map((b) => b.serviceId))];
  const serviceNamesById = new Map<number, string>();
  for (const serviceId of serviceIds) {
    const service = await findServiceById(business.id, serviceId);
    serviceNamesById.set(serviceId, service?.name ?? '(άγνωστη υπηρεσία)');
  }

  const rows: InlineKeyboard = capped.map((b) => {
    const callbackData = `cmenu:cancel:confirm:${b.id}`;
    assertCallbackDataSize(callbackData);
    return [
      {
        text: `${serviceNamesById.get(b.serviceId)} - ${b.calendarDate} ${b.calendarTime}`,
        callback_data: callbackData,
      },
    ];
  });
  rows.push([backButton]);

  await sendTelegramMessageWithKeyboard(chatId, 'Επίλεξε κράτηση για ακύρωση:', rows);
}

/**
 * Shows a Ναι/Όχι confirmation prompt before cancelling a booking.
 *
 * Security (T-29-05): callback_data is attacker-controllable input — any
 * Telegram user can send a hand-crafted callback_query.data string, not only
 * literal button taps. The ownership guard below MUST run before any
 * booking-derived text (date, time, service name) is composed, and both
 * failure paths ("not found" and "not yours") return the identical generic
 * message so an attacker cannot enumerate valid bookingIds by comparing
 * response shapes.
 */
export async function showCancelConfirm(
  chatId: string,
  business: Business,
  senderTelegramId: string,
  bookingId: number
): Promise<void> {
  const booking = await findBookingByIdUnscoped(bookingId);
  if (!booking || booking.clientPhone !== senderTelegramId) {
    const keyboard: InlineKeyboard = [
      [{ text: BACK_MENU_LABELS.CLIENT, callback_data: 'cmenu:root' }],
    ];
    await sendTelegramMessageWithKeyboard(chatId, 'Κράτηση δεν βρέθηκε.', keyboard);
    return;
  }

  const service = await findServiceById(business.id, booking.serviceId);
  const serviceName = service?.name ?? '(άγνωστη υπηρεσία)';

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

  await sendTelegramMessageWithKeyboard(
    chatId,
    `Να ακυρωθεί η κράτηση:\n${serviceName}\n${booking.calendarDate} ${booking.calendarTime};`,
    keyboard
  );
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

  // Ownership guard (T-29-05 pattern) — must be before any DB mutation, and
  // both failure paths ("not found" and "not yours") return the identical
  // generic message so an attacker cannot enumerate valid bookingIds by
  // comparing response shapes (see showCancelConfirm above).
  if (!booking || booking.clientPhone !== senderTelegramId) {
    if (booking) {
      logger.warn(
        { bookingId, senderTelegramId, clientPhone: booking.clientPhone },
        'client cancel ownership mismatch'
      );
    }
    const keyboard: InlineKeyboard = [
      [{ text: BACK_MENU_LABELS.CLIENT, callback_data: 'cmenu:root' }],
    ];
    await sendTelegramMessageWithKeyboard(chatId, 'Κράτηση δεν βρέθηκε.', keyboard);
    return;
  }

  // Status check — only pending_owner_approval and confirmed can be cancelled
  if (
    booking.bookingStatus !== 'pending_owner_approval' &&
    booking.bookingStatus !== 'confirmed'
  ) {
    const keyboard: InlineKeyboard = [
      [{ text: BACK_MENU_LABELS.CLIENT, callback_data: 'cmenu:root' }],
    ];
    await sendTelegramMessageWithKeyboard(
      chatId,
      'Αυτή η κράτηση δεν μπορεί να ακυρωθεί.',
      keyboard
    );
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
      const clientDisplayName = (await getClientName(business.id, booking.clientPhone)) ?? booking.clientPhone;
      const ownerText =
        'Ακύρωση κράτησης από πελάτη:\nΗμερομηνία: ' +
        booking.calendarDate +
        '\nΏρα: ' +
        booking.calendarTime +
        '\nΠελάτης: ' +
        clientDisplayName;
      await botTokenStore.run(business.botToken, async () => {
        await sendTelegramMessage(business.ownerTelegramId!, ownerText);
      });
    }
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'Owner cancel notification failed (best-effort)');
  }

  // Confirm to client
  // D-03: booking is the pre-update row; a confirmed status means the client was given an add-to-calendar link.
  await sendTelegramMessage(
    chatId,
    appendCancelCalendarNote('Η κράτησή σας ακυρώθηκε.', booking.bookingStatus === 'confirmed')
  );

  const backKeyboard: InlineKeyboard = [
    [{ text: BACK_MENU_LABELS.CLIENT, callback_data: 'cmenu:root' }],
  ];
  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', backKeyboard);

  logger.info({ businessId: business.id, senderTelegramId, bookingId }, 'client booking cancelled');
}

/**
 * Shows the client's active membership balance, or a "no membership" message.
 */
export async function showClientBalance(chatId: string, business: Business): Promise<void> {
  const membership = await getClientActiveMembership(business.id, chatId);

  const backButton = { text: BACK_MENU_LABELS.CLIENT, callback_data: 'cmenu:root' };
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

    // Plan 18-02: book a class flow (date-first, Phase 30)
    case clientMenuAction === 'book':
      await showBookDateList(chatId, business);
      break;

    // Inert calendar cell (weekday header / day without sessions)
    case clientMenuAction === 'book:none':
      break;

    case clientMenuAction === 'book:date':
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: δεν βρέθηκε η ημερομηνία.');
      } else {
        await showBookSessionList(chatId, business, result.id);
      }
      break;

    case clientMenuAction === 'book:confirm':
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: δεν βρέθηκε το μάθημα.');
      } else {
        await showBookConfirm(chatId, result.id, business);
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

    case clientMenuAction === 'book:series':
      if (result.id === undefined) {
        await sendTelegramMessage(chatId, 'Σφάλμα: δεν βρέθηκε το μάθημα.');
      } else {
        await handleBookSeriesExecute(chatId, business, chatId, result.id);
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
        // chatId === senderTelegramId for private Telegram chats
        await showCancelConfirm(chatId, business, chatId, result.id);
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

    default: {
      const keyboard: InlineKeyboard = [
        [{ text: BACK_MENU_LABELS.CLIENT, callback_data: 'cmenu:root' }],
      ];
      await sendTelegramMessageWithKeyboard(chatId, 'Άγνωστη ενέργεια.', keyboard);
      break;
    }
  }
}
