import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.logLevel,
  // Defensive guard: even though these keys are never logged as an object today,
  // this prevents an accidental future `logger.info(config)` from leaking secrets.
  redact: {
    paths: [
      // Config-level secrets
      'appSecret', 'databaseUrl', 'databaseAppUrl', 'whatsappAccessToken', 'webhookVerifyToken',
      'geminiApiKey', 'googleClientSecret',
      // Phase 04 (D-07, T-04-01): per-bot credentials stored on businesses rows;
      // redacted at all path levels so logger.info({ business }) never leaks them.
      'botToken', 'webhookSecret',
      // DB-level
      'googleRefreshToken',
      // Nested object paths (e.g. logger.info({ config }) or logger.info({ business }))
      '*.appSecret', '*.databaseUrl', '*.databaseAppUrl', '*.whatsappAccessToken', '*.webhookVerifyToken',
      '*.geminiApiKey', '*.googleClientSecret',
      '*.botToken', '*.webhookSecret',
      '*.googleRefreshToken',
      // Explicit config.* namespace
      'config.appSecret', 'config.databaseUrl', 'config.databaseAppUrl', 'config.whatsappAccessToken', 'config.webhookVerifyToken',
      'config.geminiApiKey', 'config.googleClientSecret',
    ],
    censor: '[REDACTED]',
  },
});
