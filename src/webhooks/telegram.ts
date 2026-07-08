import express, { Router, Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';
import { extractAndNormalizeAllBusinessCodeCandidates } from '../business/resolver';
import { Business, findBusinessBySlug, insertOrIgnoreTelegramUpdate, markTelegramUpdateProcessed } from '../database/queries';
import { sendTelegramMessage } from '../telegram/client';
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
      // TODO Plan 02-05: wire owner accept/reject button handling here.
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
