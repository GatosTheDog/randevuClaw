import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.logLevel,
  // Defensive guard: even though these keys are never logged as an object today,
  // this prevents an accidental future `logger.info(config)` from leaking secrets.
  redact: {
    paths: [
      // Config-level secrets
      'databaseUrl', 'databaseAppUrl',
      'geminiApiKey', 'googleClientSecret',
      // Phase 04 (D-07, T-04-01): per-bot credentials stored on businesses rows;
      // redacted at all path levels so logger.info({ business }) never leaks them.
      'botToken', 'webhookSecret',
      // DB-level
      'googleRefreshToken',
      // Nested object paths (e.g. logger.info({ config }) or logger.info({ business }))
      '*.databaseUrl', '*.databaseAppUrl',
      '*.geminiApiKey', '*.googleClientSecret',
      '*.botToken', '*.webhookSecret',
      '*.googleRefreshToken',
      // Explicit config.* namespace
      'config.databaseUrl', 'config.databaseAppUrl',
      'config.geminiApiKey', 'config.googleClientSecret',
      'config.botToken', 'config.webhookSecret',
    ],
    censor: '[REDACTED]',
  },
});
