import { Business, findLatestConversationTurn, insertConversationTurn } from '../database/queries';
import { getOrCreateClientRelationship, CONSENT_NOTICE_GREEK_TEMPLATE } from '../consent/checker';
import { resolveGreekTemporalExpressions } from './greek-preprocessor';
import { aiBookingAgent } from './ai-agent';

export interface ConversationChannel {
  sendMessage(chatId: string, text: string): Promise<{ messageId: number }>;
}

// D-03: the channel-agnostic conversation core. Any channel adapter (Telegram
// today, WhatsApp again once Business Verification clears) calls this with
// its own thin ConversationChannel implementation; all consent, Greek
// temporal preprocessing, AI conversation, and turn-persistence logic lives
// here exactly once.
export async function routeConversationMessage(
  business: Business,
  senderId: string,
  rawMessageText: string,
  channel: ConversationChannel
): Promise<void> {
  const { isFirstContact } = await getOrCreateClientRelationship(business.id, senderId);
  const previousTurn = await findLatestConversationTurn(business.id, senderId);
  const { annotatedText } = resolveGreekTemporalExpressions(rawMessageText, new Date());

  const result = await aiBookingAgent(
    annotatedText,
    business,
    senderId,
    previousTurn?.interactionId ?? null
  );

  // Persist the RAW message text (never the Gemini-facing annotated
  // version) so conversation history reflects what the client actually
  // typed.
  await insertConversationTurn({
    businessId: business.id,
    clientPhone: senderId,
    interactionId: result.interactionId,
    requestId: result.requestId,
    messageText: rawMessageText,
    responseText: result.text,
    toolCalls: result.toolCalls.length ? JSON.stringify(result.toolCalls) : null,
  });

  const finalText = isFirstContact
    ? `${CONSENT_NOTICE_GREEK_TEMPLATE(business.name)}\n\n${result.text}`
    : result.text;

  await channel.sendMessage(senderId, finalText);
}
