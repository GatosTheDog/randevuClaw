import { config } from '../config';

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
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/${method}`;

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
    throw new Error(data.description ?? `Telegram API error: ${response.status}`);
  }

  return data.result as T;
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<SendMessageResult> {
  const result = await callTelegramApi<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text,
  });
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
  return { messageId: result.message_id };
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  const body: Record<string, unknown> = {
    callback_query_id: callbackQueryId,
    show_alert: false,
  };
  if (text !== undefined) body.text = text;

  await callTelegramApi<unknown>('answerCallbackQuery', body);
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
}
