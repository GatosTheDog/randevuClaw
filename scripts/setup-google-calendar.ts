import crypto from 'crypto';
import http from 'http';
import { URL } from 'url';
import { config } from '../src/config';
import { findBusinessBySlug } from '../src/database/queries';
import { getOAuth2AuthUrl, exchangeAuthCodeForTokens, storeGoogleRefreshToken } from '../src/google/oauth';
import { logger } from '../src/utils/logger';

// Throwaway/fixture-only tooling (D-05/D-07): this one-time CLI script runs
// the real Google consent flow once per fixture business owner. Phase 4
// replaces it with real self-serve chat-driven onboarding.
export function parseBusinessSlugArg(argv: string[]): string | null {
  const index = argv.indexOf('--business-slug');
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

async function main(): Promise<void> {
  const slug = parseBusinessSlugArg(process.argv.slice(2));
  if (!slug) {
    console.error('Usage: npm run setup-calendar -- --business-slug <slug>');
    process.exit(1);
    return;
  }

  const business = await findBusinessBySlug(slug);
  if (!business) {
    console.error(`Business not found for slug: ${slug}`);
    process.exit(1);
    return;
  }

  // T-03-04: random per-run CSRF token embedded in the auth URL and checked
  // exactly on the loopback callback below, BEFORE the auth code is ever
  // exchanged -- prevents authorization-code injection from a different,
  // attacker-initiated OAuth flow hitting this same local port first.
  const state = crypto.randomBytes(16).toString('hex');
  const authUrl = getOAuth2AuthUrl(state);

  console.log(`Open this URL in a browser and complete the Google consent screen for ${business.name}:`);
  console.log(authUrl);

  const port = Number(new URL(config.googleRedirectUri).port) || 3000;

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const requestUrl = new URL(req.url ?? '/', `http://localhost:${port}`);

        // CR-02: ignore browser-generated auxiliary requests (favicon, prefetch)
        // that arrive before the real OAuth callback. These carry no 'state'
        // param, so they would otherwise hit the CSRF rejection path and close
        // the server before the real callback arrives. Only process requests
        // whose pathname matches the configured OAuth redirect URI pathname.
        if (requestUrl.pathname !== new URL(config.googleRedirectUri).pathname) {
          res.writeHead(204);
          res.end();
          return;
        }

        const receivedState = requestUrl.searchParams.get('state');
        const code = requestUrl.searchParams.get('code');

        if (receivedState !== state) {
          logger.error({ receivedState }, 'OAuth callback state mismatch, rejecting');
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('State mismatch -- possible CSRF, aborting.');
          server.close();
          process.exit(1);
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Missing authorization code.');
          server.close();
          process.exit(1);
          return;
        }

        const { refreshToken } = await exchangeAuthCodeForTokens(code);
        await storeGoogleRefreshToken(business.id, refreshToken);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<html><body>Google Calendar connected for ${business.name}. You can close this tab.</body></html>`);
        server.close();
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'OAuth setup callback failed');
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Setup failed, see server logs.');
        server.close();
        process.exit(1);
      }
    })();
  });

  server.listen(port, () => {
    console.log(`Waiting for the OAuth callback on port ${port}...`);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
