// GET callback route for the in-bot Google Calendar connect flow (D-04).
//
// Google redirects the owner's browser here after consent. This is a public,
// unauthenticated request: the only trusted input is the single-use `state`,
// which is consumed BEFORE any code exchange and which alone determines the
// business (query parameters such as business_id/owner_id are never read).
//
// Never reflect request data: pages are static Greek HTML built from module
// constants, there are no redirects, and logs carry businessId only (never the
// code, state, tokens or raw Google error objects).

import type { Request, Response } from 'express';
import { config } from '../config';
import { findBusinessById, Business } from '../database/queries';
import { logger } from '../utils/logger';
import { botTokenStore, sendTelegramMessage } from '../telegram/client';
import { consumeOAuthState } from './oauth-state';
import { exchangeAuthCodeForTokens, storeGoogleRefreshToken } from './oauth';
import { describeGoogleError } from './errors';

export const GCAL_CONNECTED_GREEK =
  '✅ Το Google Calendar συνδέθηκε! Οι επιβεβαιωμένες κρατήσεις σας θα εμφανίζονται αυτόματα στο ημερολόγιό σας.';
export const GCAL_DENIED_GREEK = 'Η σύνδεση με το Google Calendar ακυρώθηκε. Μπορείτε να ξαναδοκιμάσετε από το /menu.';
export const GCAL_CONNECT_FAILED_GREEK = 'Η σύνδεση με το Google Calendar απέτυχε. Δοκιμάστε ξανά από το /menu.';

const INVALID_LINK_TITLE = 'Μη έγκυρος σύνδεσμος';
const INVALID_LINK_MESSAGE =
  'Ο σύνδεσμος δεν είναι έγκυρος ή έχει λήξει. Ζητήστε νέο σύνδεσμο από το /menu στο Telegram.';
const SUCCESS_TITLE = 'Συνδέθηκε';
const SUCCESS_MESSAGE = 'Το Google Calendar συνδέθηκε. Μπορείτε να κλείσετε αυτή την καρτέλα και να επιστρέψετε στο Telegram.';
const CANCELLED_TITLE = 'Η σύνδεση ακυρώθηκε';
const CANCELLED_MESSAGE = 'Η σύνδεση με το Google Calendar ακυρώθηκε. Μπορείτε να κλείσετε αυτή την καρτέλα.';
const FAILED_TITLE = 'Η σύνδεση απέτυχε';
const FAILED_MESSAGE =
  'Η σύνδεση με το Google Calendar απέτυχε. Κλείστε αυτή την καρτέλα και δοκιμάστε ξανά από το /menu στο Telegram.';

// The route follows whatever pathname is registered with Google as the
// redirect URI (documented default /oauth/google/callback).
export function getGoogleOAuthCallbackPath(): string {
  return new URL(config.googleRedirectUri).pathname;
}

function sendPage(res: Response, status: number, title: string, message: string): void {
  const html =
    `<!doctype html><html lang="el"><head><meta charset="utf-8"><title>${title}</title></head>` +
    `<body><h1>${title}</h1><p>${message}</p></body></html>`;
  res
    .status(status)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    })
    .send(html);
}

// The callback is not a Telegram webhook, so the per-business bot token store
// must be entered explicitly.
async function notifyOwner(business: Business, text: string): Promise<void> {
  if (!business.ownerTelegramId || !business.botToken) return;
  const ownerTelegramId = business.ownerTelegramId;
  const botToken = business.botToken;
  try {
    await botTokenStore.run(botToken, () => sendTelegramMessage(ownerTelegramId, text));
  } catch {
    logger.warn({ businessId: business.id }, 'Failed to notify owner after Google OAuth callback');
  }
}

export async function handleGoogleOAuthCallback(req: Request, res: Response): Promise<void> {
  try {
    const query = req.query ?? {};
    const state = typeof query.state === 'string' ? query.state : undefined;
    const code = typeof query.code === 'string' ? query.code : undefined;
    const error = typeof query.error === 'string' ? query.error : undefined;

    if (!state) {
      sendPage(res, 400, INVALID_LINK_TITLE, INVALID_LINK_MESSAGE);
      return;
    }

    // Consume first: a denied or failed flow can never be replayed.
    const businessId = await consumeOAuthState(state);
    if (businessId === null) {
      logger.warn({ reason: 'invalid_or_expired_state' }, 'Google OAuth callback rejected');
      sendPage(res, 400, INVALID_LINK_TITLE, INVALID_LINK_MESSAGE);
      return;
    }

    const business = await findBusinessById(businessId);
    if (!business) {
      logger.warn({ businessId }, 'Google OAuth callback: business not found');
      sendPage(res, 400, INVALID_LINK_TITLE, INVALID_LINK_MESSAGE);
      return;
    }

    if (error !== undefined) {
      logger.warn({ businessId, googleError: error.slice(0, 64) }, 'Google OAuth consent denied');
      await notifyOwner(business, GCAL_DENIED_GREEK);
      sendPage(res, 200, CANCELLED_TITLE, CANCELLED_MESSAGE);
      return;
    }

    if (!code) {
      sendPage(res, 400, INVALID_LINK_TITLE, INVALID_LINK_MESSAGE);
      return;
    }

    try {
      const { refreshToken } = await exchangeAuthCodeForTokens(code);
      await storeGoogleRefreshToken(businessId, refreshToken);
    } catch (err) {
      logger.error({ businessId, ...describeGoogleError(err) }, 'Google OAuth callback failed');
      await notifyOwner(business, GCAL_CONNECT_FAILED_GREEK);
      sendPage(res, 502, FAILED_TITLE, FAILED_MESSAGE);
      return;
    }

    await notifyOwner(business, GCAL_CONNECTED_GREEK);
    sendPage(res, 200, SUCCESS_TITLE, SUCCESS_MESSAGE);
  } catch (err) {
    logger.error({ ...describeGoogleError(err) }, 'Google OAuth callback unexpected error');
    if (!res.headersSent) {
      sendPage(res, 500, FAILED_TITLE, FAILED_MESSAGE);
    }
  }
}
