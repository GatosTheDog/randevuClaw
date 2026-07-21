import crypto from 'crypto';
import express, { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import {
  Business,
  findBookingByIdUnscoped,
  findBusinessById,
  findServiceById,
  insertOrIgnoreTelegramUpdate,
  insertClientBusinessRelationship,
  markTelegramUpdateProcessed,
  updateBookingStatus,
  updateBookingStatusIfPending,
  findBusinessByWebhookId,
  withBusinessContext,
} from '../database/queries';
import { answerCallbackQuery, editTelegramMessageReplyMarkup, sendTelegramMessage, sendTelegramMessageWithKeyboard, botTokenStore } from '../telegram/client';
import { getOrCreateBotInstance } from '../telegram/registry';
import { routeConversationMessage } from '../conversation/router';
import { deleteBookingFromCalendar, syncBookingToCalendar } from '../calendar/sync';
import { aiOwnerAgent } from '../onboarding/ai-owner-agent';
import { findBusinessByOwnerTelegramId } from '../onboarding/queries';
import {
  handleConfirmMembership,
  handleCancelPackage,
  handleConfirmPackage,
  showPackageSelection,
  showMembershipConfirmation,
} from '../telegram/handlers/payment-flow';
import { findMembershipByBooking, restoreCredit } from '../billing/queries';
import { isoDateInAthens } from '../utils/timezone';

interface TelegramFrom {
  id: number;
  /** Nullable: Telegram does not require users to set a first name. */
  first_name?: string;
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
    // Owner intercept: any message from the business owner goes to the AI
    // owner management agent (not the client booking AI). Identity check only —
    // no keyword gating — so the owner is recognized from their very first message.
    if (business.ownerTelegramId === senderTelegramId) {
      // WR-04: use Athens calendar date instead of UTC slice — between midnight
      // and 02:00–03:00 Athens time, UTC would still be "yesterday", causing
      // the AI agent to show the wrong day's schedule and use the wrong date
      // for NLU about "today's" bookings or packages.
      const today = isoDateInAthens(new Date());
      const reply = await aiOwnerAgent(business, senderTelegramId, messageText, today);
      // D-03/D-08: tools that send their own keyboards (create_package, record_payment)
      // return '' to signal that no additional reply should be sent. Skip empty replies.
      if (reply) {
        await sendTelegramMessage(senderTelegramId, reply);
      }
      await markTelegramUpdateProcessed(updateId, business.id);
      return;
    }

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
//
// Phase 7 extension: also parses billing callback_data patterns of the form
// "billing:<action>:<id1>[:id2]". The billing discriminant ('firstId' in result)
// separates the two result shapes so TypeScript narrows the union correctly.
export type BookingCallbackResult = { action: 'approve' | 'reject' | 'client_cancel'; bookingId: number };
export type BillingCallbackResult = {
  action:
    | 'billing:client'
    | 'billing:package'
    | 'billing:mem_confirm'
    | 'billing:mem_cancel'
    | 'billing:pkg_confirm'
    | 'billing:pkg_cancel';
  firstId: number;
  optionalSecondId?: number;
};

export function parseCallbackData(
  data: string | undefined
): BookingCallbackResult | BillingCallbackResult | null {
  // Existing booking action pattern (unchanged — T-02-17)
  const bookingMatch = data?.match(/^(approve|reject|client_cancel)_(\d+)$/);
  if (bookingMatch) {
    return {
      action: bookingMatch[1] as BookingCallbackResult['action'],
      bookingId: Number(bookingMatch[2]),
    };
  }

  // Phase 7: billing action pattern — IDs only, never prices in callback_data (T-07-05)
  const billingMatch = data?.match(
    /^billing:(pkg_confirm|pkg_cancel|client|package|mem_confirm|mem_cancel):(\d+)(?::(\d+))?$/
  );
  if (billingMatch) {
    return {
      action: `billing:${billingMatch[1]}` as BillingCallbackResult['action'],
      firstId: Number(billingMatch[2]),
      optionalSecondId: billingMatch[3] ? Number(billingMatch[3]) : undefined,
    };
  }

  return null;
}

// OWNER_APPROVE_ACK_GREEK / OWNER_REJECT_ACK_GREEK removed (WR-01/WR-04):
// answerCallbackQuery now dismisses the spinner without text to prevent false
// confirmation for non-owners. If action-specific text is added back later,
// restore these constants and call answerCallbackQuery after ownership + CAS.
const CLIENT_REJECT_NOTICE_GREEK =
  'Δυστυχώς η επιχείρηση δεν μπόρεσε να επιβεβαιώσει το ραντεβού σας. Δοκιμάστε άλλη ώρα.';

// Client tap handler for the 🚫 Ακύρωση κράτησης inline-keyboard button.
// Validates client ownership via clientPhone, cancels the booking, removes the
// calendar event (best-effort), and notifies the owner.
async function handleClientCancelCallback(
  bookingId: number,
  senderTelegramId: string
): Promise<void> {
  const booking = await findBookingByIdUnscoped(bookingId);
  if (!booking) return;

  // Client ownership: clientPhone stores Telegram user ID as string
  if (booking.clientPhone !== senderTelegramId) {
    logger.warn({ bookingId, senderTelegramId }, 'client_cancel from non-client, ignoring');
    return;
  }

  const CANCELLABLE = ['pending_owner_approval', 'confirmed'];
  if (!CANCELLABLE.includes(booking.bookingStatus)) return;

  await updateBookingStatus(booking.id, 'cancelled');

  // Phase 8: credit restore (SESS-02/D-03) — after updateBookingStatus, before notifications
  const membershipId = await findMembershipByBooking(booking.id);
  if (membershipId !== null) {
    await restoreCredit(membershipId, booking.id, `booking:${booking.id}:credit`);
  }

  const business = await findBusinessById(booking.businessId);
  const service = await findServiceById(booking.businessId, booking.serviceId);

  // Best-effort calendar delete
  try {
    if (business) await deleteBookingFromCalendar(booking, business);
  } catch (err) {
    logger.error({ err, bookingId }, 'Client cancel: calendar delete failed (best-effort)');
  }

  // Notify owner
  try {
    if (business?.ownerTelegramId) {
      const ownerText = `Ακύρωση ραντεβού από πελάτη:\nΥπηρεσία: ${service?.name ?? 'άγνωστη'}\nΗμερομηνία: ${booking.calendarDate}\nΏρα: ${booking.calendarTime}\nΠελάτης: ${booking.clientPhone}`;
      await sendTelegramMessage(business.ownerTelegramId, ownerText);
    }
  } catch (err) {
    logger.error({ err, bookingId }, 'Client cancel: owner notification failed (best-effort)');
  }

  await sendTelegramMessage(senderTelegramId, 'Το ραντεβού σας ακυρώθηκε.');
}

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

  if (parsed.action === 'client_cancel') {
    await handleClientCancelCallback(parsed.bookingId, senderTelegramId);
    return;
  }

  // ---------------------------------------------------------------------------
  // Phase 7: Billing callback routing (T-07-01, T-07-05, T-07-06)
  // Discriminant: 'firstId' in result → BillingCallbackResult
  // ---------------------------------------------------------------------------
  if ('firstId' in parsed) {
    const { firstId, optionalSecondId } = parsed;
    logger.debug({ action: parsed.action, firstId, optionalSecondId }, 'Billing callback parsed');

    // T-07-01: resolve business from owner's Telegram ID before any mutation.
    // T-07-06: businessId is derived from authenticated senderTelegramId, not
    // from untrusted callback_data, to prevent multi-tenant data leaks.
    const ownerBusiness = await findBusinessByOwnerTelegramId(senderTelegramId);
    if (!ownerBusiness) {
      logger.warn({ senderTelegramId, action: parsed.action }, 'billing callback from unregistered owner, ignoring');
      return;
    }
    const businessId = ownerBusiness.id;

    if (parsed.action === 'billing:client') {
      // Client selected → show package selection keyboard
      await showPackageSelection(businessId, senderTelegramId, firstId);
    } else if (parsed.action === 'billing:package') {
      // Package selected → show membership confirmation
      if (optionalSecondId === undefined) {
        logger.warn({ data: callbackQuery.data }, 'billing:package callback missing packageId, ignoring');
        return;
      }
      await showMembershipConfirmation(businessId, senderTelegramId, firstId, optionalSecondId);
    } else if (parsed.action === 'billing:mem_confirm') {
      // Owner confirmed membership → create membership record
      if (optionalSecondId === undefined) {
        logger.warn({ data: callbackQuery.data }, 'billing:mem_confirm callback missing packageId, ignoring');
        return;
      }
      await handleConfirmMembership(businessId, firstId, optionalSecondId, senderTelegramId, callbackQuery.id);
    } else if (parsed.action === 'billing:mem_cancel') {
      // Owner cancelled payment flow
      await sendTelegramMessage(senderTelegramId, '❌ Ακυρώθηκε η πληρωμή.');
    } else if (parsed.action === 'billing:pkg_confirm') {
      // Owner confirmed package creation → activate pending package
      await handleConfirmPackage(firstId, businessId, senderTelegramId, callbackQuery.id);
    } else if (parsed.action === 'billing:pkg_cancel') {
      // Owner cancelled package creation → delete pending package
      await handleCancelPackage(firstId, businessId, senderTelegramId, callbackQuery.id);
    }
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
    await sendTelegramMessageWithKeyboard(
      updated.clientPhone,
      `Το ραντεβού σας επιβεβαιώθηκε! ${service?.name ?? ''}, ${updated.calendarDate} στις ${updated.calendarTime}.`,
      [[{ text: '🚫 Ακύρωση κράτησης', callback_data: `client_cancel_${updated.id}` }]]
    );
  } else {
    // No cascade on reject: the original booking (if any) is left untouched.
    // Phase 8: credit restore (SESS-02/D-03) — after updateBookingStatusIfPending, before client notification
    const membershipId = await findMembershipByBooking(updated.id);
    if (membershipId !== null) {
      await restoreCredit(membershipId, updated.id, `booking:${updated.id}:credit`);
    }
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

          // D-04: upsert clientName from Telegram from.first_name on every client message.
          // Called AFTER handleFoundBusiness so getOrCreateClientRelationship's
          // isFirstContact detection is not affected (it runs inside handleFoundBusiness →
          // routeConversationMessage → getOrCreateClientRelationship for client messages).
          // Owners are excluded: owner messages go to aiOwnerAgent, not consent checker,
          // so creating an owner clientBusinessRelationship record is unnecessary.
          if (business.ownerTelegramId !== senderTelegramId) {
            await insertClientBusinessRelationship(
              business.id,
              senderTelegramId,
              update.message.from.first_name
            );
          }
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
