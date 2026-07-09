// Baseline env vars for tests that transitively import src/config.ts (e.g. via
// src/utils/logger.ts or src/database/*.ts) but don't care about config's own
// behavior. tests/config.test.ts still directly sets/deletes these per-scenario
// via jest.resetModules(), which takes precedence since it happens after this
// file runs.
process.env.APP_SECRET ??= 'test-app-secret';
process.env.WEBHOOK_VERIFY_TOKEN ??= 'test-verify-token';
process.env.WHATSAPP_ACCESS_TOKEN ??= 'test-whatsapp-token';
process.env.WHATSAPP_PHONE_NUMBER_ID ??= 'test-phone-number-id';
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/testdb?sslmode=require';
process.env.GEMINI_API_KEY ??= 'test-gemini-key';
process.env.TELEGRAM_BOT_TOKEN ??= 'test-telegram-bot-token';
process.env.TELEGRAM_WEBHOOK_SECRET ??= 'test-telegram-webhook-secret';
process.env.OWNER_TELEGRAM_ID ??= '999999999';
process.env.GOOGLE_CLIENT_ID ??= 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET ??= 'test-google-client-secret';
process.env.GOOGLE_REDIRECT_URI ??= 'http://localhost:3000/oauth/callback';
