import express from 'express';
import { logger } from './utils/logger';
import webhookRouter from './webhooks/whatsapp';
import telegramWebhookRouter from './webhooks/telegram';
import { startExpiryPoller } from './conversation/expiry-poller';

const app = express();

app.use('/webhooks/whatsapp', webhookRouter);
app.use('/webhooks/telegram', telegramWebhookRouter);

app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
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
}

export default app;
