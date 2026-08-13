import express, { Request, Response } from 'express';
import { logger } from './utils/logger';
import telegramWebhookRouter from './webhooks/telegram';
import { startExpiryPoller } from './conversation/expiry-poller';
import { startCalendarSyncPoller } from './calendar/poller';
import { startAgendaPoller } from './scheduler/agenda';
import { startReminderPoller } from './scheduler/reminders';
import { startMembershipExpiryPoller } from './scheduler/membership-expiry';
import { startSessionCancellationPoller } from './scheduler/session-cancellation';
import { findBusinessById } from './database/queries';
import { exchangeAuthCodeForTokens, storeGoogleRefreshToken, verifyOAuthState } from './google/oauth';

const app = express();

app.use('/webhooks/telegram', telegramWebhookRouter);

app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Phase 31 (D-03/D-04): live owner-facing OAuth callback replacing the
// developer-run scripts/setup-google-calendar.ts loopback server. Mirrors
// that script's error-handling shape but never calls process.exit — this is
// a long-running server process, not a one-shot CLI.
//
// Same 5-entity substitution approach as src/invites/generator.ts's
// unexported escapeXml, reimplemented locally here since that one isn't
// exported (T-31-05: defense-in-depth against a crafted business name
// producing stored/reflected markup in this success page).
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

app.get('/oauth/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
      // T-31-03: never log the raw code/state values, only presence booleans.
      logger.error({ hasCode: !!code, hasState: !!state }, 'OAuth callback missing code or state');
      res.status(400).send('<html><body>Λείπει ο κωδικός εξουσιοδότησης ή το state.</body></html>');
      return;
    }

    const businessId = verifyOAuthState(state);
    if (businessId === null) {
      // T-31-01/T-31-03: generic 400, never reveals which check failed, never
      // logs the raw state value.
      logger.error({}, 'OAuth callback state verification failed');
      res.status(400).send('<html><body>Μη έγκυρο ή αλλοιωμένο state.</body></html>');
      return;
    }

    const business = await findBusinessById(businessId);
    if (!business) {
      logger.error({ businessId }, 'OAuth callback: business not found for verified state');
      res.status(404).send('<html><body>Η επιχείρηση δεν βρέθηκε.</body></html>');
      return;
    }

    // T-31-03: never log the returned refreshToken/accessToken values.
    const { refreshToken } = await exchangeAuthCodeForTokens(code);
    await storeGoogleRefreshToken(businessId, refreshToken);

    const safeName = escapeHtml(business.name);
    res.status(200).send(
      `<html><body><p>Το Google Calendar συνδέθηκε για: ${safeName}.</p><p>Μπορείτε να κλείσετε αυτή τη σελίδα και να επιστρέψετε στο Telegram.</p></body></html>`
    );
  } catch (err) {
    logger.error({ err }, 'OAuth callback handler failed');
    res.status(500).send('<html><body>Η σύνδεση απέτυχε, δείτε τα server logs.</body></html>');
  }
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// D-09 pending-booking expiry sweep. Guarded against the Jest test
// environment: an unguarded setInterval would keep the Jest process alive
// (open-handle warning) since telegram-webhook.test.ts imports this module
// transitively via supertest. config.nodeEnv can never be 'test' (config.ts
// collapses it to 'development'), so JEST_WORKER_ID — which Jest always sets
// — is the only real signal here.
if (!process.env.JEST_WORKER_ID) {
  startExpiryPoller();
  startCalendarSyncPoller();
  startAgendaPoller();
  startReminderPoller();
  startMembershipExpiryPoller();
  startSessionCancellationPoller();
}

export default app;
