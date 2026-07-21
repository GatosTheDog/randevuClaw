// Phase 7: Multi-step payment recording keyboard handlers.
//
// These handlers implement the D-05/D-06/D-08 inline keyboard flow for payment
// recording: owner taps "record payment" → showClientSelection → showPackageSelection
// → showMembershipConfirmation → handleConfirmMembership.
//
// Security contract (T-07-01, T-07-05):
// - handleConfirmMembership, handleCancelPackage, handleConfirmPackage all validate
//   senderTelegramId against findBusinessByOwnerTelegramId BEFORE any DB mutation.
// - callback_data for package/client buttons contains only IDs — never prices (T-07-05).
// - All DB reads use getConn() inside withBusinessContext for RLS enforcement (T-07-03).

import {
  withBusinessContext,
  findClientBusinessRelationshipById,
} from '../../database/queries';
import { findBusinessByOwnerTelegramId } from '../../onboarding/queries';
import {
  getRecentClientsForBusiness,
  listPackages,
  createMembership,
  activatePackage,
  cancelPendingPackage,
  getPackageById,
} from '../../billing/queries';
import {
  sendTelegramMessageWithKeyboard,
  sendTelegramMessage,
  answerCallbackQuery,
  InlineKeyboard,
} from '../client';
import { logger } from '../../utils/logger';

// ---------------------------------------------------------------------------
// Show functions (called from text message context or after answerCallbackQuery)
// ---------------------------------------------------------------------------

/**
 * Presents recent clients (last 30 days) as an inline keyboard for payment
 * recording. Each button callback_data is "billing:client:{clientRelId}" and
 * is strictly <= 64 bytes since it contains only numeric IDs (T-07-05).
 *
 * D-05: Falls back to "serviceNameFallback — lastBookingDateFormatted" button
 * label when clientName is null (client has no display name captured yet).
 */
export async function showClientSelection(
  businessId: number,
  ownerTelegramId: string
): Promise<void> {
  const clients = await withBusinessContext(businessId, () =>
    getRecentClientsForBusiness(businessId, 30)
  );

  if (clients.length === 0) {
    await sendTelegramMessage(
      ownerTelegramId,
      'Δεν υπάρχουν πελάτες με ραντεβού τις τελευταίες 30 ημέρες.'
    );
    return;
  }

  const keyboard: InlineKeyboard = clients.map((client) => {
    const callbackData = `billing:client:${client.clientBusinessRelationshipId}`;
    // IDs in callback_data are always within 64 bytes; guard for safety
    if (Buffer.byteLength(callbackData, 'utf8') > 64) {
      logger.warn(
        { callbackData, id: client.clientBusinessRelationshipId },
        'billing:client callback_data exceeds 64 bytes — ID too long'
      );
    }
    // D-05: use client display name when available; fall back to service+date
    const label =
      client.clientName ?? `${client.serviceNameFallback} — ${client.lastBookingDateFormatted}`;
    return [{ text: label, callback_data: callbackData }];
  });

  await sendTelegramMessageWithKeyboard(ownerTelegramId, '👤 Ποιος πελάτης έκανε πληρωμή;', keyboard);
}

/**
 * Presents active packages as an inline keyboard after client selection.
 * callback_data is "billing:package:{clientRelId}:{packageId}" — price is in the
 * button label text ONLY, never in callback_data (T-07-05 price tampering mitigation).
 *
 * D-06: listPackages() already filters to isActive=true; deactivated packages
 * are automatically excluded from the keyboard.
 */
export async function showPackageSelection(
  businessId: number,
  ownerTelegramId: string,
  clientRelId: number
): Promise<void> {
  const packages = await withBusinessContext(businessId, () => listPackages(businessId));

  if (packages.length === 0) {
    await sendTelegramMessage(
      ownerTelegramId,
      'Δεν υπάρχουν ενεργά πακέτα. Δημιούργησε πρώτα ένα πακέτο.'
    );
    return;
  }

  const keyboard: InlineKeyboard = packages.map((p) => {
    // T-07-05: Only IDs in callback_data — price goes in button text label only
    const callbackData = `billing:package:${clientRelId}:${p.id}`;
    const sessionLabel = p.sessionCount === null ? 'Απερ.' : `${p.sessionCount} συν.`;
    const label = `${p.name} — ${sessionLabel} — €${(p.priceCents / 100).toFixed(2)}`;
    return [{ text: label, callback_data: callbackData }];
  });

  await sendTelegramMessageWithKeyboard(ownerTelegramId, '📦 Ποιο πακέτο αγόρασε;', keyboard);
}

/**
 * Sends a Greek confirmation message showing client name, package name, price,
 * and duration. Presents Ναι/Όχι buttons to create or cancel the membership.
 * callback_data for buttons is "billing:mem_confirm:{clientRelId}:{packageId}" and
 * "billing:mem_cancel:{clientRelId}:{packageId}".
 */
export async function showMembershipConfirmation(
  businessId: number,
  ownerTelegramId: string,
  clientRelId: number,
  packageId: number
): Promise<void> {
  const [clientRel, pkg] = await withBusinessContext(businessId, async () => {
    const relRow = await findClientBusinessRelationshipById(clientRelId);
    const pkgRow = await getPackageById(packageId);
    return [relRow, pkgRow] as const;
  });

  if (!clientRel || !pkg) {
    logger.warn({ businessId, clientRelId, packageId }, 'showMembershipConfirmation: client or package not found');
    await sendTelegramMessage(ownerTelegramId, 'Σφάλμα: δεν βρέθηκε πελάτης ή πακέτο.');
    return;
  }

  const clientLabel = clientRel.clientName ?? clientRel.senderPhone;
  const sessionLabel = pkg.sessionCount === null ? 'απεριόριστες' : `${pkg.sessionCount} συνεδρίες`;

  const confirmText = [
    `Επιβεβαίωση: ${clientLabel} αγόρασε "${pkg.name}"`,
    `Τιμή: €${(pkg.priceCents / 100).toFixed(2)}`,
    `Ισχύς: ${pkg.validDays} ημέρες (${sessionLabel})`,
    '',
    'Επιβεβαιώνεις;',
  ].join('\n');

  const keyboard: InlineKeyboard = [
    [
      { text: '✅ Ναι', callback_data: `billing:mem_confirm:${clientRelId}:${packageId}` },
      { text: '❌ Όχι', callback_data: `billing:mem_cancel:${clientRelId}:${packageId}` },
    ],
  ];

  await sendTelegramMessageWithKeyboard(ownerTelegramId, confirmText, keyboard);
}

// ---------------------------------------------------------------------------
// Handle functions (called from callback_query — call answerCallbackQuery first)
// ---------------------------------------------------------------------------

/**
 * Confirms membership creation after owner taps Ναι.
 * Ownership is validated (T-07-01) before any DB mutation.
 * answerCallbackQuery is called first to dismiss the Telegram spinner.
 */
export async function handleConfirmMembership(
  businessId: number,
  clientRelId: number,
  packageId: number,
  senderTelegramId: string,
  callbackQueryId: string
): Promise<void> {
  // Dismiss Telegram spinner before any work (patterns.md Pattern 2)
  await answerCallbackQuery(callbackQueryId);

  // T-07-01: Validate senderTelegramId is the owner before any mutation
  const ownerBusiness = await findBusinessByOwnerTelegramId(senderTelegramId);
  if (!ownerBusiness || ownerBusiness.id !== businessId) {
    logger.warn(
      { businessId, senderTelegramId },
      'handleConfirmMembership: billing callback from non-owner, ignoring'
    );
    return;
  }

  // Fetch clientPhone from clientRelId — needed for createMembership()
  const clientRel = await findClientBusinessRelationshipById(clientRelId);
  if (!clientRel) {
    logger.warn({ clientRelId }, 'handleConfirmMembership: clientRelationship not found');
    await sendTelegramMessage(senderTelegramId, 'Σφάλμα: δεν βρέθηκε ο πελάτης.');
    return;
  }
  const clientPhone = clientRel.senderPhone;

  // Fetch package for success message details
  const pkg = await getPackageById(packageId);
  if (!pkg) {
    logger.warn({ packageId }, 'handleConfirmMembership: package not found');
    await sendTelegramMessage(senderTelegramId, 'Σφάλμα: δεν βρέθηκε το πακέτο.');
    return;
  }

  // T-07-03: Wrap createMembership in withBusinessContext for RLS enforcement.
  // CR-03: catch errors from createMembership (e.g. idempotency key conflict on
  // same-day replay or double-tap) and send an error message to the owner so
  // they receive feedback instead of a silent spinner disappearance.
  let result: { memberId: number; expiresAtDate: string; sessionsRemaining: number | null };
  try {
    result = await withBusinessContext(businessId, () =>
      createMembership(businessId, clientPhone, packageId)
    );
  } catch (err) {
    logger.error(
      { err, businessId, clientRelId, packageId },
      'handleConfirmMembership: createMembership failed'
    );
    await sendTelegramMessage(
      senderTelegramId,
      'Σφάλμα κατά την καταγραφή πληρωμής. Ελέγξτε αν η συνδρομή ήδη υπάρχει και δοκιμάστε ξανά.'
    );
    return;
  }

  const clientLabel = clientRel.clientName ?? clientPhone;
  await sendTelegramMessage(
    senderTelegramId,
    [
      `✅ Συνδρομή δημιουργήθηκε!`,
      `Πελάτης: ${clientLabel}`,
      `Πακέτο: ${pkg.name}`,
      `Λήγει: ${result.expiresAtDate}`,
    ].join('\n')
  );
}

/**
 * Cancels (deletes) a pending package after owner taps Όχι on the D-03 confirmation.
 * Ownership validated before deletion (T-07-01).
 */
export async function handleCancelPackage(
  pendingPackageId: number,
  businessId: number,
  senderTelegramId: string,
  callbackQueryId: string
): Promise<void> {
  await answerCallbackQuery(callbackQueryId);

  // T-07-01: validate senderTelegramId is the owner
  const ownerBusiness = await findBusinessByOwnerTelegramId(senderTelegramId);
  if (!ownerBusiness || ownerBusiness.id !== businessId) {
    logger.warn(
      { businessId, senderTelegramId },
      'handleCancelPackage: billing callback from non-owner, ignoring'
    );
    return;
  }

  await cancelPendingPackage(businessId, pendingPackageId);
  await sendTelegramMessage(senderTelegramId, '❌ Ακυρώθηκε η δημιουργία πακέτου.');
}

/**
 * Activates a pending package after owner taps Ναι on the D-03 confirmation.
 * Ownership validated before activation (T-07-01).
 */
export async function handleConfirmPackage(
  pendingPackageId: number,
  businessId: number,
  senderTelegramId: string,
  callbackQueryId: string
): Promise<void> {
  await answerCallbackQuery(callbackQueryId);

  // T-07-01: validate senderTelegramId is the owner
  const ownerBusiness = await findBusinessByOwnerTelegramId(senderTelegramId);
  if (!ownerBusiness || ownerBusiness.id !== businessId) {
    logger.warn(
      { businessId, senderTelegramId },
      'handleConfirmPackage: billing callback from non-owner, ignoring'
    );
    return;
  }

  await withBusinessContext(businessId, () => activatePackage(businessId, pendingPackageId));
  await sendTelegramMessage(senderTelegramId, '✅ Πακέτο ενεργοποιήθηκε επιτυχώς!');
}
