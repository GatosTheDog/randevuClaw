import crypto from 'crypto';
import express, { Router, Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';
import { validateWebhookPayload } from '../utils/validation';
import { extractAndNormalizeBusinessCode } from '../business/resolver';
import {
  Business,
  findBusinessBySlug,
  findMessageByWhatsappId,
  insertOrIgnoreMessage,
  markMessageProcessed,
} from '../database/queries';
import { sendWhatsAppMessage } from '../whatsapp/client';
import { getOrCreateClientRelationship, CONSENT_NOTICE_GREEK_TEMPLATE } from '../consent/checker';

export const BUSINESS_NOT_FOUND_REPLY_GREEK =
  'Δεν αναγνωρίσαμε τον κωδικό επιχείρησης που στείλατε. Ελέγξτε τον σύνδεσμο και δοκιμάστε ξανά.';

export function buildBusinessFoundReplyGreek(businessName: string): string {
  return `Καλωσορίσατε στο ${businessName}! Πώς μπορούμε να σας εξυπηρετήσουμε σήμερα;`;
}

// Checks length before timingSafeEqual — calling timingSafeEqual on
// unequal-length buffers throws RangeError instead of returning false.
export function verifyWhatsAppSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader) return false;

  const expected =
    'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  if (Buffer.byteLength(signatureHeader) !== Buffer.byteLength(expected)) return false;

  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
}

export function handleWebhookGet(req: Request, res: Response): void {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.webhookVerifyToken) {
    res.status(200).send(challenge as string);
  } else {
    res.status(403).send('Forbidden');
  }
}

async function handleFoundBusiness(
  messageId: string,
  business: Business,
  senderPhone: string,
  messageBody: string
): Promise<void> {
  const dedupResult = await insertOrIgnoreMessage(messageId, business.id, senderPhone, messageBody);

  if (dedupResult === 'ignored') {
    logger.info({ messageId }, 'Duplicate message ignored');
    return;
  }

  const { isFirstContact } = await getOrCreateClientRelationship(business.id, senderPhone);
  const replyText = isFirstContact
    ? `${CONSENT_NOTICE_GREEK_TEMPLATE(business.name)}\n\n${buildBusinessFoundReplyGreek(business.name)}`
    : buildBusinessFoundReplyGreek(business.name);

  try {
    await sendWhatsAppMessage(senderPhone, replyText);
    // Mark only after a successful send — accepts a narrow duplicate-reply
    // risk if the process crashes between send and mark (D-08).
    await markMessageProcessed(messageId);
  } catch (err) {
    logger.error({ err }, 'Failed to send WhatsApp reply');
  }
}

async function handleNotFoundBusiness(messageId: string, senderPhone: string): Promise<void> {
  // No valid businessId for the messages FK — read-only existence check instead.
  // Accepted limitation: a permanently-unresolvable code may get the not-found
  // reply on each Meta retry (D-05, no sentinel row or separate dedup table).
  const priorRow = await findMessageByWhatsappId(messageId);
  if (!priorRow) {
    try {
      await sendWhatsAppMessage(senderPhone, BUSINESS_NOT_FOUND_REPLY_GREEK);
    } catch (err) {
      logger.error({ err }, 'Failed to send not-found reply');
    }
  }
}

export async function handleWebhookPost(req: Request, res: Response): Promise<void> {
  const rawBody = req.body as Buffer;
  const signatureHeader = req.headers['x-hub-signature-256'] as string | undefined;

  if (!verifyWhatsAppSignature(rawBody, signatureHeader, config.appSecret)) {
    res.status(403).send('Forbidden');
    return;
  }

  let payload;
  try {
    payload = validateWebhookPayload(JSON.parse(rawBody.toString()));
  } catch (err) {
    logger.warn({ err }, 'Invalid webhook payload');
    res.status(400).send('Bad Request');
    return;
  }

  // Iterate over every entry/change/message in the payload (CR-02): WhatsApp
  // Cloud API webhook POSTs can bundle more than one entry, change, or
  // message. Indexing only [0] at each level silently discarded everything
  // else, and because we always reply 200 Meta never retried the rest.
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      for (const message of change.value.messages ?? []) {
        if (message.type !== 'text' || !message.text) continue;

        const code = extractAndNormalizeBusinessCode(message.text.body);
        const business = code ? await findBusinessBySlug(code) : null;

        if (business) {
          await handleFoundBusiness(message.id, business, message.from, message.text.body);
        } else {
          await handleNotFoundBusiness(message.id, message.from);
        }
      }
    }
  }

  res.status(200).send('OK');
}

const router = Router();
router.get('/', handleWebhookGet);
router.post('/', express.raw({ type: 'application/json' }), handleWebhookPost);

export default router;
