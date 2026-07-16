import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { Request, Response } from 'express';
import { config } from '../config';
import { db } from '../database/db';
import { insertOrIgnoreTelegramUpdate } from '../database/queries';
import { businesses } from '../database/schema';
import {
  activateBusiness,
  createBusinessForOnboarding,
  createOrResetOnboardingSession,
  findActiveSessionByOwnerTelegramId,
  findBusinessByOwnerTelegramId,
} from '../onboarding/queries';
import { dispatchOnboardingStep } from '../onboarding/router';
import {
  answerCallbackQuery,
  botTokenStore,
  getMeBotInfo,
  sendTelegramMessage,
  unregisterBotWebhook,
} from '../telegram/client';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Telegram update shape (mirrors src/webhooks/telegram.ts — not re-exported
// from there so we define it locally for the platform handler).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Platform bot webhook handler
// ---------------------------------------------------------------------------

/**
 * Handles POST /webhooks/telegram/platform — the platform onboarding bot.
 *
 * Flow:
 *  1. HMAC verification against PLATFORM_WEBHOOK_SECRET
 *  2. Parse update; early-exit unsupported types
 *  3. Respond 200 immediately so Telegram never retries
 *  4. Inside platform-token botTokenStore context — outbound sends use PLATFORM_BOT_TOKEN:
 *     a. Dedup-insert with null businessId (no business yet at registration time)
 *     b. If active session: resume via dispatchOnboardingStep
 *     c. If existing business (session='done'): re-registration path
 *     d. If brand-new owner: validate bot token, create business + session
 *
 * Cross-tenant: uses admin db, bypasses withBusinessContext.
 */
export async function handlePlatformBotWebhook(req: Request, res: Response): Promise<void> {
  // Step 1 — HMAC verification (T-05-10).
  // Timing-safe comparison — throws when buffer lengths differ, so wrap in
  // try/catch and treat any exception as a verification failure.
  const rawHeader = req.headers['x-telegram-bot-api-secret-token'];
  const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  const headerBuffer = Buffer.from(headerValue ?? '');
  const secretBuffer = Buffer.from(config.platformWebhookSecret);
  let secretValid: boolean;
  try {
    secretValid = crypto.timingSafeEqual(headerBuffer, secretBuffer);
  } catch {
    secretValid = false;
  }
  if (!secretValid) {
    logger.warn('Platform webhook secret verification failed');
    res.status(401).send('Unauthorized');
    return;
  }

  // Step 2 — Update parsing.
  const update = req.body as TelegramUpdate;
  const updateId = String(update.update_id);

  // Early-exit for unsupported Telegram update types (WR-03 pattern).
  // Platform bot only processes message updates from owners.
  if (!update.message && !update.callback_query) {
    logger.info(
      { updateId, updateType: Object.keys(update).filter((k) => k !== 'update_id') },
      'Platform: unsupported Telegram update type, ignoring'
    );
    res.status(200).send('OK');
    return;
  }

  // Step 3 — Extract sender and message text.
  const ownerTelegramId = String(
    update.message?.from?.id ?? update.callback_query?.from?.id ?? ''
  );
  const isCallback = !!update.callback_query;
  const messageText = isCallback
    ? (update.callback_query!.data ?? '')
    : (update.message?.text?.trim() ?? '');
  const updateType = isCallback ? 'callback_query' : 'message';

  // Step 4 — Respond 200 immediately; process asynchronously inside botTokenStore.run.
  // This ensures Telegram never retries even if internal processing is slow (e.g.
  // getMeBotInfo network call during owner token validation).
  try {
    res.status(200).send('OK');
    await botTokenStore.run(config.platformBotToken, async () => {
      // Step 4a — Dedup-insert (T-05-11).
      // businessId is null here because the platform bot receives messages before
      // a business row may exist. The unique updateId prevents double-processing.
      const dedupResult = await insertOrIgnoreTelegramUpdate(updateId, null, ownerTelegramId, updateType);
      if (dedupResult === 'ignored') {
        logger.info({ updateId }, 'Platform: duplicate update ignored');
        return;
      }

      // Answer the Telegram spinner immediately for callback_query updates so
      // the button stops showing a loading indicator (Pitfall 4 in RESEARCH.md).
      if (isCallback) {
        try { await answerCallbackQuery(update.callback_query!.id); } catch {}
      }

      // Step 4b — Look up an active (non-done) onboarding session.
      const activeResult = await findActiveSessionByOwnerTelegramId(ownerTelegramId);

      if (activeResult !== null) {
        // Owner is mid-flow — resume at their current step (ONB-02).
        await dispatchOnboardingStep(
          activeResult.session,
          activeResult.business,
          ownerTelegramId,
          messageText
        );
        return;
      }

      // Step 4c/d — No active session. Check if a completed business exists.
      const existingBusiness = await findBusinessByOwnerTelegramId(ownerTelegramId);

      if (existingBusiness !== null) {
        // B1 — Re-registration: owner already completed onboarding (session='done')
        // and is submitting a new bot token. Validate, swap credentials, reset session.
        const newBotToken = messageText.trim();
        try {
          await getMeBotInfo(newBotToken);
        } catch {
          // T-05-12: never log the token, only the error type
          logger.warn('Platform: re-registration bot token validation failed');
          await sendTelegramMessage(
            ownerTelegramId,
            'Μη έγκυρο token bot. Παρακαλώ ελέγξτε και ξαναστείλτε.'
          );
          return;
        }

        // Unregister old webhook before registering the new one (STATE.md blocker).
        if (existingBusiness.botToken) {
          try {
            await unregisterBotWebhook(existingBusiness.botToken);
          } catch (err) {
            logger.warn({ err }, 'Platform: failed to unregister old webhook (continuing re-registration)');
          }
        }

        const webhookId = crypto.randomUUID();
        const webhookSecret = crypto.randomBytes(32).toString('hex');

        // Update webhookId + webhookSecret via existing helper.
        await activateBusiness(existingBusiness.id, webhookId, webhookSecret);

        // Update botToken separately (direct db.update — activateBusiness only sets
        // webhookId/webhookSecret per its contract; plan-04 action requires this split).
        await db
          .update(businesses)
          .set({ botToken: newBotToken })
          .where(eq(businesses.id, existingBusiness.id));

        // Reset onboarding session to 'name' step so owner re-enters the guided flow.
        await createOrResetOnboardingSession(existingBusiness.id, 'name');

        await sendTelegramMessage(
          ownerTelegramId,
          'Το παλιό bot αποσυνδέθηκε. Πώς ονομάζεται η επιχείρησή σας;'
        );
      } else {
        // B2 — Brand-new owner. Treat message text as bot token submission.
        const newBotToken = messageText.trim();
        try {
          await getMeBotInfo(newBotToken);
        } catch {
          // T-05-12: invalid token — send Greek error, do not create business row.
          logger.warn('Platform: new-owner bot token validation failed');
          await sendTelegramMessage(
            ownerTelegramId,
            'Μη έγκυρο token bot. Παρακαλώ ελέγξτε και ξαναστείλτε.'
          );
          return;
        }

        // Token valid — create placeholder business row and onboarding session.
        const webhookId = crypto.randomUUID();
        const webhookSecret = crypto.randomBytes(32).toString('hex');
        // Placeholder slug with timestamp suffix to satisfy UNIQUE constraint.
        // The real name/slug is set during the 'name' step.
        const placeholderSlug = 'business-' + Date.now();

        const newBusiness = await createBusinessForOnboarding({
          ownerTelegramId,
          name: 'Νέα Επιχείρηση',
          slug: placeholderSlug,
          botToken: newBotToken,
          webhookId,
          webhookSecret,
        });

        await createOrResetOnboardingSession(newBusiness.id, 'name');

        await sendTelegramMessage(
          ownerTelegramId,
          'Καλωσήρθατε! Πώς ονομάζεται η επιχείρησή σας;'
        );
      }
    });
  } catch (err) {
    logger.error({ err }, 'Platform webhook handler failed');
  } finally {
    if (!res.headersSent) res.status(200).send('OK');
  }
}
