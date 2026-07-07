import { config } from '../config';

export interface SendMessageResult {
  messageId: string;
  status: string;
}

export async function sendWhatsAppMessage(
  recipientPhone: string,
  text: string
): Promise<SendMessageResult> {
  const url = `https://graph.facebook.com/v20.0/${config.whatsappPhoneNumberId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsappAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: recipientPhone,
      type: 'text',
      text: { body: text },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WhatsApp API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as { messages: Array<{ id: string }> };
  return { messageId: data.messages[0].id, status: 'sent' };
}
