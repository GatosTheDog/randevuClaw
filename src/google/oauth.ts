import crypto from 'crypto';
import { google } from 'googleapis';
import { config } from '../config';
import { updateBusinessGoogleRefreshToken } from '../database/queries';
import { logger } from '../utils/logger';

// Typed off the `googleapis` import itself (InstanceType<typeof
// google.auth.OAuth2>) rather than importing `google-auth-library` directly —
// keeps `googleapis` the ONLY new direct dependency this plan adds, per
// 03-RESEARCH.md's Package Legitimacy Audit scope (T-03-SC).
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export function getOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(config.googleClientId, config.googleClientSecret, config.googleRedirectUri);
}

// access_type=offline + prompt=consent is what guarantees Google returns a
// refresh_token (not just a short-lived access_token) — omitting either is
// the single most common OAuth setup mistake for this flow.
export function getOAuth2AuthUrl(state: string): string {
  return getOAuth2Client().generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent',
    state,
  });
}

export async function exchangeAuthCodeForTokens(
  code: string
): Promise<{ refreshToken: string; accessToken: string }> {
  const { tokens } = await getOAuth2Client().getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token -- ensure prompt=consent was used and this is the account's first authorization"
    );
  }
  return { refreshToken: tokens.refresh_token, accessToken: tokens.access_token ?? '' };
}

export async function storeGoogleRefreshToken(businessId: number, refreshToken: string): Promise<void> {
  await updateBusinessGoogleRefreshToken(businessId, refreshToken);
  logger.info({ businessId }, 'Google refresh token stored');
}

// Phase 31 (T-31-01): HMAC-signed OAuth state parameter. The businessId is
// embedded as a literal prefix in the returned string (not merely used as
// HMAC input) because GET /oauth/callback has no other channel to learn
// which business initiated the flow. scripts/setup-google-calendar.ts's
// per-run crypto.randomBytes state (a closure variable) works for a one-shot
// local server but is not reusable for a stateless Express route serving
// many businesses (31-RESEARCH.md Pitfall 2).
export function signOAuthState(businessId: number): string {
  const payload = businessId.toString();
  const hmacHex = crypto.createHmac('sha256', config.googleClientSecret).update(payload).digest('hex');
  return `${payload}.${hmacHex}`;
}

// Never throws for any input. Explicitly checks buffer-length equality
// BEFORE calling crypto.timingSafeEqual, which throws a RangeError (rather
// than returning false) when its two arguments have different lengths.
export function verifyOAuthState(state: string): number | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;

  const [businessIdPart, receivedHmacHex] = parts;
  const expectedHmacHex = crypto.createHmac('sha256', config.googleClientSecret).update(businessIdPart).digest('hex');

  // Buffer.from(str, 'hex') never throws on invalid hex input -- it simply
  // stops decoding at the first invalid character, which may yield a buffer
  // of unexpected length. The explicit length check below guards
  // timingSafeEqual's precondition for exactly that case.
  const expectedBuffer = Buffer.from(expectedHmacHex, 'hex');
  const receivedBuffer = Buffer.from(receivedHmacHex, 'hex');
  if (expectedBuffer.length !== receivedBuffer.length) return null;
  if (!crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) return null;

  const businessId = Number(businessIdPart);
  if (!Number.isInteger(businessId) || businessId <= 0) return null;
  return businessId;
}
