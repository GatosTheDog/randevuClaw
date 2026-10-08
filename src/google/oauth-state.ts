// DB-backed, single-use OAuth `state` for the in-bot Google Calendar connect flow (D-04).
//
// Why the database and not an in-memory Map: fly.toml pins neither a machine
// count nor an auto-stop policy and every deploy restarts the process, so an
// in-memory store would silently invalidate links across restarts or when a
// second machine serves the callback.
//
// - 256-bit random value, only its SHA-256 hash is stored (the raw state is
//   never stored or logged).
// - Expires after GOOGLE_OAUTH_STATE_TTL_MS.
// - Consumed by one atomic DELETE ... RETURNING (single use, replay-proof).
// - Bound to the businessId of the owner who tapped the button; the callback
//   derives the business ONLY from the consumed row (cross-tenant guard).

import crypto from 'crypto';
import {
  insertGoogleOauthState,
  consumeGoogleOauthState,
  deleteExpiredGoogleOauthStates,
} from '../database/queries';
import { logger } from '../utils/logger';
import { GOOGLE_OAUTH_STATE_TTL_MS } from './constants';

export const OAUTH_STATE_PATTERN = /^[a-f0-9]{64}$/;

export function hashOAuthState(state: string): string {
  return crypto.createHash('sha256').update(state).digest('hex');
}

export async function createOAuthStateForBusiness(businessId: number): Promise<string> {
  const state = crypto.randomBytes(32).toString('hex');

  try {
    await deleteExpiredGoogleOauthStates();
  } catch {
    logger.warn({ businessId }, 'Failed to purge expired Google OAuth states');
  }

  await insertGoogleOauthState(
    hashOAuthState(state),
    businessId,
    new Date(Date.now() + GOOGLE_OAUTH_STATE_TTL_MS)
  );
  return state;
}

export async function consumeOAuthState(state: unknown): Promise<number | null> {
  if (typeof state !== 'string' || !OAUTH_STATE_PATTERN.test(state)) {
    return null;
  }
  return consumeGoogleOauthState(hashOAuthState(state));
}
