import { logger } from '../utils/logger';

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
  // Phase 04 bridge (D-08): config.telegramBotToken removed in Plan 04-01.
  // Plan 04-02 replaces this single global token with per-bot token routing
  // (looked up from businesses.bot_token via callTelegramApi's botToken param).
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN ?? ''}/${method}`;

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
