import { Business, findLatestConversationTurn, insertConversationTurn } from '../database/queries';
import { getOrCreateClientRelationship, CONSENT_NOTICE_GREEK_TEMPLATE } from '../consent/checker';
import { resolveGreekTemporalExpressions } from './greek-preprocessor';
import { aiBookingAgent } from './ai-agent';
import { logger } from '../utils/logger';

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
  const routeStartedAt = Date.now();
  logger.info({ businessId: business.id, senderId }, 'Routing conversation message');

  let stageStartedAt = Date.now();
  const { isFirstContact } = await getOrCreateClientRelationship(business.id, senderId);
  logger.info(
    { businessId: business.id, senderId, isFirstContact, elapsedMs: Date.now() - stageStartedAt },
    'routeConversationMessage: getOrCreateClientRelationship returned'
  );
  if (isFirstContact) logger.info({ businessId: business.id, senderId }, 'First contact — consent notice will prepend');

  stageStartedAt = Date.now();
  const previousTurn = await findLatestConversationTurn(business.id, senderId);
  logger.info(
    { businessId: business.id, senderId, elapsedMs: Date.now() - stageStartedAt },
    'routeConversationMessage: findLatestConversationTurn returned'
  );
  const { annotatedText } = resolveGreekTemporalExpressions(rawMessageText, new Date());

  stageStartedAt = Date.now();
  const result = await aiBookingAgent(
    annotatedText,
    business,
    senderId,
    previousTurn?.interactionId ?? null
  );
  logger.info(
    {
      businessId: business.id,
      senderId,
      requestId: result.requestId,
      toolCalls: result.toolCalls.map((t) => t.name),
      elapsedMs: Date.now() - stageStartedAt,
    },
    'AI agent turn completed'
  );

  // Persist the RAW message text (never the Gemini-facing annotated
  // version) so conversation history reflects what the client actually
  // typed.
  stageStartedAt = Date.now();
  await insertConversationTurn({
    businessId: business.id,
    clientPhone: senderId,
    interactionId: result.interactionId,
    requestId: result.requestId,
    messageText: rawMessageText,
    responseText: result.text,
    toolCalls: result.toolCalls.length ? JSON.stringify(result.toolCalls) : null,
  });
  logger.info(
    { businessId: business.id, senderId, elapsedMs: Date.now() - stageStartedAt },
    'routeConversationMessage: insertConversationTurn returned'
  );

  const finalText = isFirstContact
    ? `${CONSENT_NOTICE_GREEK_TEMPLATE(business.name)}\n\n${result.text}`
    : result.text;

  stageStartedAt = Date.now();
  await channel.sendMessage(senderId, finalText);
  logger.info(
    {
      businessId: business.id,
      senderId,
      elapsedMs: Date.now() - stageStartedAt,
      totalElapsedMs: Date.now() - routeStartedAt,
    },
    'Message sent to client'
  );
}
