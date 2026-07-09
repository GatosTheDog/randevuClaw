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
