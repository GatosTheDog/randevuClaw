// Phase 31 Plan 01 (D-01, D-02, D-06, D-07): owner-facing Google Calendar
// connect/disconnect handler. Single state-aware entry point used by BOTH the
// /calendar text command (webhooks/telegram.ts) and the Settings menu button
// (admin-menu.ts) -- satisfies D-01's "both trigger the same flow". Reachable
// any time post-onboarding, exactly like every other owner menu command in
// this codebase -- never gated behind a separate onboarding-only check (D-02).
//
// Merge note (post git-sync): the actual connect/reconnect link generation
// now delegates to handleGoogleCalendarConnect (google-calendar-connect.ts),
// which uses a DB-backed single-use OAuth state (more replay-resistant than
// this file's original signOAuthState/verifyOAuthState pair) and friendlier
// Greek copy. This file now only adds the one thing that flow doesn't offer
// on its own: a disconnect action, reachable from the Settings menu's
// "already connected" state. handleCalendarDisconnect is unchanged and fully
// independent of which connect flow was used to obtain the refresh token.

import { Business, updateBusinessGoogleRefreshToken } from '../../database/queries';
import { logger } from '../../utils/logger';
import { getOAuth2Client } from '../../google/oauth';
import { handleGoogleCalendarConnect } from './google-calendar-connect';
import { sendTelegramMessage, sendTelegramMessageWithKeyboard, InlineKeyboard } from '../client';
import { BACK_MENU_LABELS } from '../../utils/greek-messages';

const BACK_TO_MENU_KEYBOARD: InlineKeyboard = [[{ text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:root' }]];

/**
 * Single state-aware entry point for both the /calendar command and the
 * Settings menu button. When disconnected, delegates to
 * handleGoogleCalendarConnect for a fresh single-use OAuth link. When already
 * connected, offers a disconnect action instead (the one capability that
 * flow doesn't surface on its own).
 */
export async function handleCalendarCommand(chatId: string, business: Business): Promise<void> {
  if (!business.googleRefreshToken) {
    await handleGoogleCalendarConnect(chatId, business);
    return;
  }

  const disconnectCallbackData = 'menu:settings:calendar_disconnect';
  await sendTelegramMessageWithKeyboard(
    chatId,
    'Το Google Calendar είναι ήδη συνδεδεμένο.',
    [[{ text: 'Αποσύνδεση Google Calendar', callback_data: disconnectCallbackData }]]
  );

  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', BACK_TO_MENU_KEYBOARD);
}

/**
 * Disconnects Google Calendar for this business (D-06). Revocation with
 * Google is best-effort (D-07) -- a failed revocation call never blocks the
 * local column clear, which always runs unconditionally.
 */
export async function handleCalendarDisconnect(chatId: string, business: Business): Promise<void> {
  if (!business.googleRefreshToken) {
    await sendTelegramMessage(chatId, 'Δεν υπάρχει συνδεδεμένο Google Calendar προς αποσύνδεση.');
    await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', BACK_TO_MENU_KEYBOARD);
    return;
  }

  try {
    await getOAuth2Client().revokeToken(business.googleRefreshToken);
  } catch (err) {
    // D-07: revocation is best-effort and must never block the disconnect.
    logger.warn({ err, businessId: business.id }, 'Google token revocation failed (non-blocking)');
  }

  await updateBusinessGoogleRefreshToken(business.id, null);
  await sendTelegramMessage(chatId, 'Το Google Calendar αποσυνδέθηκε.');

  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', BACK_TO_MENU_KEYBOARD);
}
