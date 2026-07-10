import express, { Router, Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';
import { extractAndNormalizeAllBusinessCodeCandidates } from '../business/resolver';
import {
  Business,
  findBusinessBySlug,
  findLatestBusinessForClient,
  findBookingByIdUnscoped,
  findBusinessById,
  findServiceById,
  insertOrIgnoreTelegramUpdate,
  markTelegramUpdateProcessed,
  updateBookingStatus,
  updateBookingStatusIfPending,
} from '../database/queries';
import { answerCallbackQuery, editTelegramMessageReplyMarkup, sendTelegramMessage } from '../telegram/client';
import { routeConversationMessage } from '../conversation/router';
import { BUSINESS_NOT_FOUND_REPLY_GREEK } from './whatsapp';
import { deleteBookingFromCalendar, syncBookingToCalendar } from '../calendar/sync';

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

  // Atomic compare-and-swap (WR-05): this single DB call is now the SOLE
  // gate for whether notify/cascade/button-clear run below. It replaces the
  // old read-then-write pre-check (read booking.bookingStatus, check it in
  // application code, THEN mutate separately), which left a race window
  // where two near-simultaneous taps — or Telegram redelivering the same
  // callback_query — could both pass the check and both notify the client.
  // The WHERE clause inside updateBookingStatusIfPending only matches a row
  // still `pending_owner_approval`, so of two racing callers, only the
  // first gets a non-null row back; the second gets null and is ignored
  // here, exactly like the old already-resolved re-tap case.
  const newStatus = parsed.action === 'approve' ? 'confirmed' : 'rejected';
  const updated = await updateBookingStatusIfPending(booking.id, newStatus);
  if (!updated) {
    logger.info(
      { bookingId: booking.id },
      'callback_query lost the race or booking already resolved, ignoring'
    );
    return;
  }

  if (parsed.action === 'approve') {
    if (updated.rescheduledFromBookingId) {
      // Reschedule cascade: confirming the new booking also releases the
      // original slot it replaced. This targets a DIFFERENT booking row
      // than the one just compare-and-swapped, so it stays a plain,
      // unconditional updateBookingStatus call.
      await updateBookingStatus(updated.rescheduledFromBookingId, 'cancelled');
      // Best-effort delete of the superseded booking's Calendar event
      // (D-15: never rethrows, a failure here is retried by the poller).
      try {
        const oldBooking = await findBookingByIdUnscoped(updated.rescheduledFromBookingId);
        if (oldBooking) await deleteBookingFromCalendar(oldBooking, business);
      } catch (err) {
        logger.error(
          { err, bookingId: updated.rescheduledFromBookingId },
          "Failed to delete superseded booking's calendar event"
        );
      }
    }
    const service = await findServiceById(updated.businessId, updated.serviceId);
    // Best-effort Calendar sync (D-15). syncBookingToCalendar's own contract
    // never throws, but this try/catch is defense in depth (Pitfall 2) so a
    // totally unexpected bug here can never abort the client confirmation
    // message below or the webhook's 200 response.
    try {
      if (service) await syncBookingToCalendar(updated, business, service);
    } catch (err) {
      logger.error({ err, bookingId: updated.id }, 'Calendar sync failed (best-effort)');
    }
    await sendTelegramMessage(
      updated.clientPhone,
      `Το ραντεβού σας επιβεβαιώθηκε! ${service?.name ?? ''}, ${updated.calendarDate} στις ${updated.calendarTime}.`
    );
  } else {
    // No cascade on reject: the original booking (if any) is left untouched.
    await sendTelegramMessage(updated.clientPhone, CLIENT_REJECT_NOTICE_GREEK);
  }

  if (updated.ownerTelegramMessageId) {
    await editTelegramMessageReplyMarkup(ownerTelegramId, updated.ownerTelegramMessageId, []);
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

    const updateType = update.message ? 'message' : 'callback_query';
    logger.info({ updateId, senderTelegramId, updateType }, 'Telegram update received');

    const dedupResult = await insertOrIgnoreTelegramUpdate(
      updateId,
      null,
      senderTelegramId,
      updateType
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
        if (business) {
          logger.info({ updateId, slug: candidate, businessId: business.id }, 'Business resolved by slug');
          break;
        }
      }

      // No slug in this message — fall back to the client's existing relationship.
      // This is what makes follow-up messages ("νεα κρατηση", "ακυρωση" etc.)
      // work without repeating the business code every time.
      if (!business) {
        business = await findLatestBusinessForClient(senderTelegramId);
        if (business) {
          logger.info({ updateId, businessId: business.id }, 'Business resolved via client relationship fallback');
        }
      }

      if (business) {
        await handleFoundBusiness(updateId, business, senderTelegramId, messageText);
      } else {
        logger.info({ updateId, senderTelegramId }, 'No business resolved, sending not-found reply');
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
