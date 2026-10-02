import {
  Business,
  claimGoogleCalendarNudge,
  clearBusinessGoogleRefreshToken,
  releaseGoogleCalendarNudgeClaim,
} from '../database/queries';
import { botTokenStore, sendTelegramMessageWithKeyboard } from '../telegram/client';
import { GOOGLE_CONNECT_BUTTON_LABEL, GOOGLE_CONNECT_CALLBACK_DATA } from '../google/constants';
import { describeGoogleError } from '../google/errors';
import { logger } from '../utils/logger';

// D-06: one-time owner nudge to connect Google Calendar, plus the one-time
// reconnect message when a stored authorization was revoked/expired.
// Every function here NEVER throws. Logs carry only `businessId` and
// describeGoogleError fields: never the business row, tokens or Telegram ids.

export const GCAL_NUDGE_GREEK =
  '💡 Συνδέστε το Google Calendar σας ώστε οι επιβεβαιωμένες κρατήσεις να εμφανίζονται αυτόματα στο ημερολόγιό σας. Αυτή η υπενθύμιση εμφανίζεται μία φορά.';

export const GCAL_REVOKED_GREEK =
  '⚠️ Η σύνδεση με το Google Calendar έληξε ή ανακλήθηκε και ο συγχρονισμός σταμάτησε. Συνδεθείτε ξανά για να συνεχίσουν οι κρατήσεις να εμφανίζονται στο ημερολόγιό σας.';

// Always wrapped in botTokenStore.run: callers include the poller path where no
// request-scoped bot token exists.
async function sendConnectMessage(
  ownerTelegramId: string,
  botToken: string,
  text: string
): Promise<void> {
  await botTokenStore.run(botToken, () =>
    sendTelegramMessageWithKeyboard(ownerTelegramId, text, [
      [{ text: GOOGLE_CONNECT_BUTTON_LABEL, callback_data: GOOGLE_CONNECT_CALLBACK_DATA }],
    ])
  );
}

export async function maybeSendGoogleCalendarNudge(business: Business): Promise<boolean> {
  try {
    if (business.googleRefreshToken) return false;
    if (!business.ownerTelegramId || !business.botToken) return false;

    // Atomic database claim: at most one nudge ever, even under concurrent confirmations.
    const claimed = await claimGoogleCalendarNudge(business.id);
    if (!claimed) return false;

    try {
      await sendConnectMessage(business.ownerTelegramId, business.botToken, GCAL_NUDGE_GREEK);
      return true;
    } catch (err) {
      // A transient Telegram failure must not consume the single nudge.
      logger.warn(
        { businessId: business.id, ...describeGoogleError(err) },
        'Google Calendar nudge delivery failed; releasing claim'
      );
      try {
        await releaseGoogleCalendarNudgeClaim(business.id);
      } catch (releaseErr) {
        logger.warn(
          { businessId: business.id, ...describeGoogleError(releaseErr) },
          'Failed to release Google Calendar nudge claim'
        );
      }
      return false;
    }
  } catch (err) {
    logger.error(
      { businessId: business.id, ...describeGoogleError(err) },
      'Google Calendar nudge failed (non-blocking)'
    );
    return false;
  }
}

export async function handleGoogleAuthRevoked(business: Business): Promise<void> {
  try {
    const cleared = await clearBusinessGoogleRefreshToken(business.id);
    // false -> another caller already handled this revocation.
    if (!cleared) return;

    logger.warn(
      { businessId: business.id },
      'Google authorization revoked or expired; token cleared, bookings stay pending until reconnect'
    );

    // Best-effort: stop the generic nudge from firing right after this message.
    try {
      await claimGoogleCalendarNudge(business.id);
    } catch (claimErr) {
      logger.warn(
        { businessId: business.id, ...describeGoogleError(claimErr) },
        'Failed to claim nudge flag after revocation'
      );
    }

    if (business.ownerTelegramId && business.botToken) {
      await sendConnectMessage(business.ownerTelegramId, business.botToken, GCAL_REVOKED_GREEK);
    }
  } catch (err) {
    logger.error(
      { businessId: business.id, ...describeGoogleError(err) },
      'Handling revoked Google authorization failed (non-blocking)'
    );
  }
}
