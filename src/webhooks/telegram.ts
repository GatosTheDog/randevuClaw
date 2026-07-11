import crypto from 'crypto';
import express, { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import {
  Business,
  findBookingByIdUnscoped,
  findBusinessById,
  findServiceById,
  insertOrIgnoreTelegramUpdate,
  markTelegramUpdateProcessed,
  updateBookingStatus,
  updateBookingStatusIfPending,
  findBusinessByWebhookId,
  withBusinessContext,
} from '../database/queries';
import { answerCallbackQuery, editTelegramMessageReplyMarkup, sendTelegramMessage, botTokenStore } from '../telegram/client';
import { getOrCreateBotInstance } from '../telegram/registry';
import { routeConversationMessage } from '../conversation/router';
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

// OWNER_APPROVE_ACK_GREEK / OWNER_REJECT_ACK_GREEK removed (WR-01/WR-04):
// answerCallbackQuery now dismisses the spinner without text to prevent false
// confirmation for non-owners. If action-specific text is added back later,
// restore these constants and call answerCallbackQuery after ownership + CAS.
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
  // Dismiss spinner with no text — ownership and CAS must both succeed before
  // showing action-specific confirmation (WR-01: prevents false "confirmed"
  // popup for non-owners who craft a callback_query with approve_<id> data).
  await answerCallbackQuery(callbackQuery.id);

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
  // Whole body wrapped in try/catch/finally — always return 200 to Telegram
  // so it never retries a message we already handled.
  try {
    // Step 1 — Extract webhookId from route parameter (D-04).
    // req.params values are always strings in Express routing; cast to narrow the type.
    const webhookId = req.params.webhookId as string | undefined;
    if (!webhookId) {
      res.status(400).send('Bad Request');
      return;
    }

    // Step 2 — Business lookup (pre-auth, admin db — per D-04).
    // findBusinessByWebhookId uses the admin db (bypasses RLS) so this lookup
    // works before withBusinessContext is entered. Log only the opaque UUID —
    // never the bot token or secret (STATE.md blocker: D-04).
    const business = await findBusinessByWebhookId(webhookId);
    if (!business || !business.webhookSecret || !business.botToken) {
      logger.warn({ webhookId }, 'Webhook ID not found or bot credentials incomplete');
      res.status(404).send('Not Found');
      return;
    }

    // Step 3 — Constant-time HMAC verification (per D-06 / T-04-10).
    // crypto.timingSafeEqual throws if buffers have different lengths, so the
    // try/catch maps that case to secretValid=false without leaking timing info.
    // Express headers can be string | string[] — coerce to string for Buffer.from.
    const rawHeader = req.headers['x-telegram-bot-api-secret-token'];
    const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const headerBuffer = Buffer.from(headerValue ?? '');
    const secretBuffer = Buffer.from(business.webhookSecret);
    let secretValid: boolean;
    try {
      secretValid = crypto.timingSafeEqual(headerBuffer, secretBuffer);
    } catch {
      secretValid = false;
    }
    if (!secretValid) {
      logger.warn({ webhookId }, 'Webhook secret verification failed');
      res.status(401).send('Unauthorized');
      return;
    }

    // Step 4 — Bot instance and update parsing.
    const update = req.body as TelegramUpdate;
    const bot = getOrCreateBotInstance(webhookId, business.botToken);
    const updateId = String(update.update_id);

    // Early-exit for unsupported Telegram update types (WR-03).
    // Telegram delivers types beyond message/callback_query (edited_message,
    // channel_post, inline_query, poll, my_chat_member, etc.). Without this
    // guard, senderTelegramId becomes '' and updateType becomes 'callback_query',
    // corrupting the dedup log. Return 200 so Telegram never retries.
    if (!update.message && !update.callback_query) {
      logger.info(
        { updateId, updateType: Object.keys(update).filter((k) => k !== 'update_id') },
        'Unsupported Telegram update type, ignoring'
      );
      res.status(200).send('OK');
      return;
    }

    // Step 5 — Per-request context: botTokenStore so callTelegramApi reads the
    // correct bot token; withBusinessContext so all DB ops run under RLS for
    // exactly this tenant (T-04-12).
    await botTokenStore.run(business.botToken, async () => {
      await withBusinessContext(business.id, async () => {
        const senderTelegramId = String(
          update.message?.from.id ?? update.callback_query?.from.id ?? ''
        );
        const updateType = update.message ? 'message' : 'callback_query';

        // Log webhookId (opaque UUID), never botToken (D-04 / T-04-11).
        logger.info({ updateId, webhookId, senderTelegramId, updateType }, 'Telegram update received');

        const dedupResult = await insertOrIgnoreTelegramUpdate(
          updateId,
          business.id,
          senderTelegramId,
          updateType
        );

        if (dedupResult === 'ignored') {
          logger.info({ updateId }, 'Duplicate Telegram update ignored');
          return;
        }

        // BOT-04: Telegraf as webhook adapter (D-03). No middleware attached in
        // Phase 4 — validates the update structure; dispatch is explicit below.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await bot.handleUpdate(update as any);

        if (update.callback_query) {
          await handleCallbackQuery(update.callback_query, senderTelegramId);
          return;
        }

        if (update.message) {
          await handleFoundBusiness(updateId, business, senderTelegramId, update.message.text ?? '');
        }
      });
    });

    // Step 6 — Always 200 to Telegram (success path).
    res.status(200).send('OK');
  } catch (err) {
    logger.error({ err }, 'Telegram webhook handler failed');
  } finally {
    if (!res.headersSent) res.status(200).send('OK');
  }
}

const router = Router();
router.post('/:webhookId', express.json(), handleTelegramWebhookPost);

export default router;
