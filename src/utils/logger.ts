import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.logLevel,
  // Defensive guard: even though these keys are never logged as an object today,
  // this prevents an accidental future `logger.info(config)` from leaking secrets.
  redact: {
    paths: [
      'appSecret', 'databaseUrl', 'whatsappAccessToken', 'webhookVerifyToken',
      'geminiApiKey', 'telegramBotToken', 'telegramWebhookSecret',
      '*.appSecret', '*.databaseUrl', '*.whatsappAccessToken', '*.webhookVerifyToken',
      '*.geminiApiKey', '*.telegramBotToken', '*.telegramWebhookSecret',
      'config.appSecret', 'config.databaseUrl', 'config.whatsappAccessToken', 'config.webhookVerifyToken',
      'config.geminiApiKey', 'config.telegramBotToken', 'config.telegramWebhookSecret',
    ],
    censor: '[REDACTED]',
  },
});
