import express, { Router, Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';
import { extractAndNormalizeAllBusinessCodeCandidates } from '../business/resolver';
import {
  Business,
  findBusinessBySlug,
  findBookingByIdUnscoped,
  findBusinessById,
  findServiceById,
  insertOrIgnoreTelegramUpdate,
  markTelegramUpdateProcessed,
  updateBookingStatus,
} from '../database/queries';
import { answerCallbackQuery, editTelegramMessageReplyMarkup, sendTelegramMessage } from '../telegram/client';
import { routeConversationMessage } from '../conversation/router';
import { BUSINESS_NOT_FOUND_REPLY_GREEK } from './whatsapp';

interface TelegramFrom {
  id: number;
}

interface TelegramMessage {
  message_id: number;
  from: TelegramFrom;
  chat: { id: number };
  text?: string;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramFrom;
  data?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

// Telegram's secret token is a simple shared-secret bearer-style header,
// documented by Telegram itself as a direct string comparison — unlike
// WhatsApp's HMAC signature, there is no timing-attack surface to defend
// against here (no signature is being derived from a body + key).
export function verifyTelegramSecretToken(
  headerValue: string | undefined,
  expectedToken: string
): boolean {
  return headerValue !== undefined && headerValue === expectedToken;
}

async function handleFoundBusiness(
  updateId: string,
  business: Business,
  senderTelegramId: string,
  messageText: string
): Promise<void> {
  try {
    await routeConversationMessage(business, senderTelegramId, messageText, {
      sendMessage: sendTelegramMessage,
    });
    await markTelegramUpdateProcessed(updateId, business.id);
  } catch (err) {
    logger.error({ err }, 'Failed to route Telegram conversation message');
  }
}

async function handleNotFoundBusiness(senderTelegramId: string): Promise<void> {
  try {
    await sendTelegramMessage(senderTelegramId, BUSINESS_NOT_FOUND_REPLY_GREEK);
  } catch (err) {
    logger.error({ err }, 'Failed to send Telegram not-found reply');
  }
}

// Regex-validates callback_query.data BEFORE it is ever used to look up a
// booking (T-02-17): only the exact "approve_<digits>" / "reject_<digits>"
// shape is accepted, anything else (including a totally different action
// name) is rejected as malformed.
export function parseCallbackData(
  data: string | undefined
): { action: 'approve' | 'reject'; bookingId: number } | null {
  const match = data?.match(/^(approve|reject)_(\d+)$/);
  return match ? { action: match[1] as 'approve' | 'reject', bookingId: Number(match[2]) } : null;
}

const OWNER_APPROVE_ACK_GREEK = 'Το ραντεβού επιβεβαιώθηκε.';
const OWNER_REJECT_ACK_GREEK = 'Το ραντεβού απορρίφθηκε.';
const CLIENT_REJECT_NOTICE_GREEK =
  'Δυστυχώς η επιχείρηση δεν μπόρεσε να επιβεβαιώσει το ραντεβού σας. Δοκιμάστε άλλη ώρα.';

// Owner tap handler for the Αποδοχή/Απόρριψη inline-keyboard buttons
// (Plan 02-02/02-04 sent them, this is what makes tapping them do something —
// D-08). Never touches `res` directly; the caller sends the HTTP response.
async function handleCallbackQuery(
  callbackQuery: TelegramCallbackQuery,
  senderTelegramId: string
): Promise<void> {
  const parsed = parseCallbackData(callbackQuery.data);

  // answerCallbackQuery MUST fire before any DB work (RESEARCH.md Pitfall 4:
  // Telegram's client-side spinner keeps spinning until this is acknowledged).
  await answerCallbackQuery(
    callbackQuery.id,
    parsed ? (parsed.action === 'approve' ? OWNER_APPROVE_ACK_GREEK : OWNER_REJECT_ACK_GREEK) : undefined
  );

  if (!parsed) {
    logger.warn({ data: callbackQuery.data }, 'Malformed callback_query data, ignoring');
    return;
  }

  const booking = await findBookingByIdUnscoped(parsed.bookingId);
  if (!booking) {
    logger.warn({ bookingId: parsed.bookingId }, 'callback_query for unknown booking');
    return;
  }

  // findBookingByIdUnscoped is intentionally unscoped by business (T-02-20) —
  // this immediate ownership check is what makes that safe. A non-owner
  // tapping a booking they somehow reference is ignored, never defaulted to
  // any action (T-02-17).
  const business = await findBusinessById(booking.businessId);
  const ownerTelegramId = business?.ownerTelegramId;
  if (!ownerTelegramId || ownerTelegramId !== senderTelegramId) {
    logger.warn(
      { bookingId: booking.id, senderTelegramId },
      'callback_query from non-owner, ignoring'
    );
    return;
  }

  // Re-check status immediately before mutating (T-02-18): a second tap
  // (double-click, or Telegram redelivering the callback) on an
  // already-resolved booking is a no-op, not a second transition.
  if (booking.bookingStatus !== 'pending_owner_approval') {
    logger.info(
      { bookingId: booking.id, status: booking.bookingStatus },
      'callback_query for already-resolved booking, ignoring'
    );
    return;
  }

  if (parsed.action === 'approve') {
    await updateBookingStatus(booking.id, 'confirmed');
    if (booking.rescheduledFromBookingId) {
      // Reschedule cascade: confirming the new booking also releases the
      // original slot it replaced, in the same operation.
      await updateBookingStatus(booking.rescheduledFromBookingId, 'cancelled');
    }
    const service = await findServiceById(booking.businessId, booking.serviceId);
    await sendTelegramMessage(
      booking.clientPhone,
      `Το ραντεβού σας επιβεβαιώθηκε! ${service?.name ?? ''}, ${booking.calendarDate} στις ${booking.calendarTime}.`
    );
  } else {
    // No cascade on reject: the original booking (if any) is left untouched.
    await updateBookingStatus(booking.id, 'rejected');
    await sendTelegramMessage(booking.clientPhone, CLIENT_REJECT_NOTICE_GREEK);
  }

  if (booking.ownerTelegramMessageId) {
    await editTelegramMessageReplyMarkup(ownerTelegramId, booking.ownerTelegramMessageId, []);
  }
}

export async function handleTelegramWebhookPost(req: Request, res: Response): Promise<void> {
  // Whole body wrapped in try/catch/finally, mirroring the WhatsApp webhook's
  // "always return 200, never let Telegram retry a message we already
  // handled" invariant.
  try {
    const headerValue = req.headers['x-telegram-bot-api-secret-token'] as string | undefined;

    if (!verifyTelegramSecretToken(headerValue, config.telegramWebhookSecret)) {
      res.status(403).send('Forbidden');
      return;
    }

    const update = req.body as TelegramUpdate;
    const updateId = String(update.update_id);
    const senderTelegramId = String(
      update.message?.from.id ?? update.callback_query?.from.id ?? ''
    );

    const dedupResult = await insertOrIgnoreTelegramUpdate(
      updateId,
      null,
      senderTelegramId,
      update.message ? 'message' : 'callback_query'
    );

    if (dedupResult === 'ignored') {
      logger.info({ updateId }, 'Duplicate Telegram update ignored');
      res.status(200).send('OK');
      return;
    }

    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query, senderTelegramId);
      res.status(200).send('OK');
      return;
    }

    if (update.message) {
      const messageText = update.message.text ?? '';
      const candidates = extractAndNormalizeAllBusinessCodeCandidates(messageText);
      let business: Business | null = null;
      for (const candidate of candidates) {
        business = await findBusinessBySlug(candidate);
        if (business) break;
      }

      if (business) {
        await handleFoundBusiness(updateId, business, senderTelegramId, messageText);
      } else {
        await handleNotFoundBusiness(senderTelegramId);
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    logger.error({ err }, 'Unhandled error processing Telegram webhook');
  } finally {
    if (!res.headersSent) res.status(200).send('OK');
  }
}

const router = Router();
router.post('/', express.json(), handleTelegramWebhookPost);

export default router;
