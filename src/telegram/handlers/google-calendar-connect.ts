// Owner-menu "connect Google Calendar" handler (D-04).
//
// businessId comes from the HMAC-verified, owner-guarded webhook business,
// never from callback_data (T-17-01 pattern). The URL sent to the owner is the
// Google AUTH url (with a fresh single-use state); Google redirects the
// owner's browser to the callback route (src/google/callback.ts) afterwards.
// Relies on the ambient bot-token context of the webhook, like the other menu
// handlers.

import { Business } from '../../database/queries';
import { logger } from '../../utils/logger';
import { sendTelegramMessage } from '../client';
import { createOAuthStateForBusiness } from '../../google/oauth-state';
import { getOAuth2AuthUrl } from '../../google/oauth';
import { describeGoogleError } from '../../google/errors';

export const GCAL_CONNECT_INSTRUCTIONS_GREEK =
  'Για να συνδέσετε το Google Calendar σας, ανοίξτε τον παρακάτω σύνδεσμο στον περιηγητή σας (Chrome ή Safari) και πατήστε «Να επιτρέπεται». Ο σύνδεσμος ισχύει για 10 λεπτά και μπορεί να χρησιμοποιηθεί μία φορά. Αν ανοίξει μέσα στο Telegram, επιλέξτε «Άνοιγμα στον περιηγητή».';

export const GCAL_RECONNECT_INSTRUCTIONS_GREEK =
  'Το Google Calendar είναι ήδη συνδεδεμένο. Για επανασύνδεση: ' + GCAL_CONNECT_INSTRUCTIONS_GREEK;

const GCAL_LINK_FAILED_GREEK = 'Δεν ήταν δυνατή η δημιουργία συνδέσμου. Δοκιμάστε ξανά σε λίγο.';

export async function handleGoogleCalendarConnect(chatId: string, business: Business): Promise<void> {
  try {
    const state = await createOAuthStateForBusiness(business.id);
    const url = getOAuth2AuthUrl(state);
    const instructions = business.googleRefreshToken
      ? GCAL_RECONNECT_INSTRUCTIONS_GREEK
      : GCAL_CONNECT_INSTRUCTIONS_GREEK;
    await sendTelegramMessage(chatId, instructions + '\n\n' + url);
  } catch (err) {
    // Never log the url or state.
    logger.error({ businessId: business.id, ...describeGoogleError(err) }, 'Failed to start Google Calendar connect');
    try {
      await sendTelegramMessage(chatId, GCAL_LINK_FAILED_GREEK);
    } catch {
      logger.warn({ businessId: business.id }, 'Failed to send Google Calendar connect failure message');
    }
  }
}
