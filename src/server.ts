import express from 'express';
import { logger } from './utils/logger';
import webhookRouter from './webhooks/whatsapp';

const app = express();

app.use('/webhooks/whatsapp', webhookRouter);

app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
