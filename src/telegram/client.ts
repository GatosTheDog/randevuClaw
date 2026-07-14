import { AsyncLocalStorage } from 'async_hooks';
import { logger } from '../utils/logger';

// Per-request Telegram bot token store (D-02, D-04).
// Set by the webhook handler via botTokenStore.run(business.botToken, ...) before
// calling withBusinessContext. Read by callTelegramApi for each outbound API call.
// Never falls back to a global env var — the token must be present in the store.
export const botTokenStore = new AsyncLocalStorage<string>();

export interface SendMessageResult {
  messageId: number;
}

export type InlineKeyboard = Array<Array<{ text: string; callback_data: string }>>;

interface TelegramApiResponse<T> {
  ok: boolean;
  description?: string;
  result?: T;
}

async function callTelegramApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const botToken = botTokenStore.getStore();
  if (!botToken) {
    throw new Error(
      'callTelegramApi called without botTokenStore context — wrap the call in botTokenStore.run(business.botToken, ...)'
    );
  }
  const url = `https://api.telegram.org/bot${botToken}/${method}`;

  logger.debug({ method }, 'Calling Telegram API');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  // Telegram can return HTTP 200 with { ok: false, description: '...' } for
  // some validation errors, so both the HTTP-level and the JSON envelope's
  // own `ok` field must be checked before trusting the response.
  const data = (await response.json()) as TelegramApiResponse<T>;

  if (!response.ok || !data.ok) {
    const description = data.description ?? `Telegram API error: ${response.status}`;
    logger.error({ method, status: response.status, description }, 'Telegram API call failed');
    throw new Error(description);
  }

  return data.result as T;
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<SendMessageResult> {
  const result = await callTelegramApi<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text,
  });
  logger.info({ chatId, messageId: result.message_id }, 'Telegram message sent');
  return { messageId: result.message_id };
}

export async function sendTelegramMessageWithKeyboard(
  chatId: string,
  text: string,
  inlineKeyboard: InlineKeyboard
): Promise<SendMessageResult> {
  const result = await callTelegramApi<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
  logger.info({ chatId, messageId: result.message_id }, 'Telegram message with keyboard sent');
  return { messageId: result.message_id };
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  const body: Record<string, unknown> = {
    callback_query_id: callbackQueryId,
    show_alert: false,
  };
  if (text !== undefined) body.text = text;

  await callTelegramApi<unknown>('answerCallbackQuery', body);
  logger.debug({ callbackQueryId }, 'Answered callback query');
}

export async function editTelegramMessageReplyMarkup(
  chatId: string,
  messageId: number,
  inlineKeyboard: InlineKeyboard
): Promise<void> {
  await callTelegramApi<unknown>('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
  logger.debug({ chatId, messageId }, 'Cleared inline keyboard');
}

// --- Platform Bot Helpers (Plan 05-02) ---
// These functions call the Telegram API with an EXPLICIT bot token parameter,
// bypassing botTokenStore entirely. Used for out-of-band registration calls
// (getMe, setWebhook, deleteWebhook) on an owner's bot token during onboarding.
// Security: botToken is NEVER passed to logger — only method name is logged (T-05-03).

async function callTelegramApiDirect<T>(
  botToken: string,
  method: string,
  body: Record<string, unknown>
): Promise<T> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;

  logger.debug({ method }, 'Calling Telegram API');

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as TelegramApiResponse<T>;

  if (!response.ok || !data.ok) {
    const description = data.description ?? `Telegram API error: ${response.status}`;
    logger.error({ method, status: response.status, description }, 'Telegram API call failed');
    throw new Error(description);
  }

  return data.result as T;
}

/**
 * Validates a bot token by calling Telegram's getMe endpoint.
 * Returns basic bot identity — id, username, firstName.
 * Throws if the token is invalid (Telegram returns 401 Unauthorized).
 */
export async function getMeBotInfo(
  botToken: string
): Promise<{ id: number; username: string | undefined; firstName: string }> {
  const result = await callTelegramApiDirect<{
    id: number;
    username?: string;
    first_name: string;
    is_bot: boolean;
  }>(botToken, 'getMe', {});
  return { id: result.id, username: result.username, firstName: result.first_name };
}

/**
 * Registers a webhook for the given bot token.
 * secretToken is sent by Telegram on every update as X-Telegram-Bot-Api-Secret-Token.
 * STATE.md blocker: always call unregisterBotWebhook() before this on re-registration.
 */
export async function registerBotWebhook(
  botToken: string,
  webhookUrl: string,
  secretToken: string
): Promise<void> {
  await callTelegramApiDirect<boolean>(botToken, 'setWebhook', {
    url: webhookUrl,
    secret_token: secretToken,
  });
}

/**
 * Removes any active webhook for the given bot token.
 * Must be called before registerBotWebhook on re-registration to avoid
 * "another webhook is active" conflicts from Telegram.
 */
export async function unregisterBotWebhook(botToken: string): Promise<void> {
  await callTelegramApiDirect<boolean>(botToken, 'deleteWebhook', {});
}
