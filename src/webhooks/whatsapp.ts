import crypto from 'crypto';
import express, { Router, Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';
import { validateWebhookPayload } from '../utils/validation';
import { extractAndNormalizeBusinessCode } from '../business/resolver';
import { findBusinessBySlug } from '../database/queries';
import { sendWhatsAppMessage } from '../whatsapp/client';

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

  const message = payload.entry[0]?.changes[0]?.value?.messages?.[0];

  if (!message || message.type !== 'text' || !message.text) {
    res.status(200).send('OK');
    return;
  }

  const code = extractAndNormalizeBusinessCode(message.text.body);
  const business = code ? await findBusinessBySlug(code) : null;
  const replyText = business
    ? buildBusinessFoundReplyGreek(business.name)
    : BUSINESS_NOT_FOUND_REPLY_GREEK;

  try {
    await sendWhatsAppMessage(message.from, replyText);
  } catch (err) {
    logger.error({ err }, 'Failed to send WhatsApp reply');
  }

  res.status(200).send('OK');
}

const router = Router();
router.get('/', handleWebhookGet);
router.post('/', express.raw({ type: 'application/json' }), handleWebhookPost);

export default router;
