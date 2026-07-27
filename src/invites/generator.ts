// Phase 25 Plan 01: Client invite QR generator (INVITE-01).
//
// Composes a printable Telegram photo message: a QR code encoding the
// business's own t.me/<bot_username> deep link, with the business name and a
// Greek call-to-action baked directly into the image pixels via sharp/librsvg
// SVG composition (D-03/D-04 — not just sent as caption text).
//
// Security (T-25-01, T-25-02): businessName is the one owner-controlled
// string reaching an SVG template in this phase — escapeXml() is applied to
// it (and, for uniform defense-in-depth, to greekCTA too) before
// interpolation. The bot token is only ever passed as an explicit function
// parameter — never logged, never rendered into the image or caption.

import { z } from 'zod';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { Business } from '../database/queries';
import { getMeBotInfo, sendTelegramPhoto } from '../telegram/client';
import { logger } from '../utils/logger';

const businessNameSchema = z.string().trim().min(1).max(100);

const QR_WIDTH = 360;
const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 620;

/**
 * Escapes the five XML predefined entities. Applied to both businessName and
 * greekCTA before either is interpolated into an SVG template string
 * (T-25-01 mitigation) — closes off injection of additional SVG
 * elements/attributes via a crafted business name.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates the composed invite PNG: a QR code (encoding deepLink) with the
 * business name and a Greek call-to-action rendered into the image pixels
 * above and below the code, on a white canvas.
 */
export async function generateInviteImageBuffer(
  deepLink: string,
  businessName: string,
  greekCTA: string
): Promise<Buffer> {
  const parsedName = businessNameSchema.safeParse(businessName);
  if (!parsedName.success) {
    throw new Error('Μη έγκυρο όνομα επιχείρησης για δημιουργία invite.');
  }
  const safeName = parsedName.data;

  const escapedName = escapeXml(safeName);
  const escapedCTA = escapeXml(greekCTA);

  const headerSvg = Buffer.from(
    `<svg width="${CANVAS_WIDTH}" height="90" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle"
        font-family="DejaVu Sans, sans-serif" font-size="32" font-weight="bold" fill="#000000">${escapedName}</text>
    </svg>`
  );

  const qrBuffer = await QRCode.toBuffer(deepLink, {
    type: 'png',
    errorCorrectionLevel: 'H',
    width: QR_WIDTH,
    margin: 2,
  });

  const footerSvg = Buffer.from(
    `<svg width="${CANVAS_WIDTH}" height="90" xmlns="http://www.w3.org/2000/svg">
      <text x="50%" y="45%" text-anchor="middle" dominant-baseline="middle"
        font-family="DejaVu Sans, sans-serif" font-size="22" fill="#000000">${escapedCTA}</text>
    </svg>`
  );

  const qrLeft = Math.round((CANVAS_WIDTH - QR_WIDTH) / 2);

  const imageBuffer = await sharp({
    create: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      { input: headerSvg, top: 0, left: 0 },
      { input: qrBuffer, top: 90, left: qrLeft },
      { input: footerSvg, top: 470, left: 0 },
    ])
    .png()
    .toBuffer();

  return imageBuffer;
}

/**
 * Shared orchestration function for both trigger points (admin menu, D-03
 * free-chat send_invite tool). Derives the deep link from a fresh getMeBotInfo
 * call against this business's own bot token, generates the composed invite
 * image, and sends it as a Telegram photo with the raw deep link as copyable
 * plain text in the caption.
 */
export async function sendBusinessInvite(business: Business, chatId: string): Promise<void> {
  if (!business.botToken) {
    throw new Error('Δεν βρέθηκε bot token για την επιχείρηση.');
  }

  const botInfo = await getMeBotInfo(business.botToken);
  if (!botInfo.username) {
    throw new Error('Δεν βρέθηκε username για το bot της επιχείρησης.');
  }

  const deepLink = `t.me/${botInfo.username}`;
  const greekCTA = 'Κάντε κράτηση τώρα!';

  const imageBuffer = await generateInviteImageBuffer(deepLink, business.name, greekCTA);

  const caption = `Σύνδεσμος κράτησης — πατήστε παρατεταμένα για αντιγραφή:\n${deepLink}`;

  await sendTelegramPhoto(chatId, imageBuffer, caption);

  logger.info({ businessId: business.id }, 'Invite image generated and sent');
}
