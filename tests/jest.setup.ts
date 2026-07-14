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
// Note: TELEGRAM_WEBHOOK_SECRET intentionally kept until Plan 04-04 refactors
// src/webhooks/telegram.ts to use per-bot DB lookup. The handler currently
// reads process.env.TELEGRAM_WEBHOOK_SECRET as a bridge (D-08 comment in telegram.ts).
// TELEGRAM_BOT_TOKEN removed per D-08 (config.ts no longer requires it after Plan 04-01).
process.env.TELEGRAM_WEBHOOK_SECRET ??= 'test-telegram-webhook-secret';
process.env.OWNER_TELEGRAM_ID ??= '999999999';
process.env.GOOGLE_CLIENT_ID ??= 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET ??= 'test-google-client-secret';
process.env.GOOGLE_REDIRECT_URI ??= 'http://localhost:3000/oauth/callback';
// Phase 04 test bot environment variables (D-09)
process.env.TEST_BOT_1_TOKEN ??= 'test-bot-1-token';
process.env.TEST_BOT_1_WEBHOOK_SECRET ??= 'test-bot-1-webhook-secret';
process.env.TEST_BOT_1_WEBHOOK_ID ??= 'test-webhook-id-1';
process.env.TEST_BOT_2_TOKEN ??= 'test-bot-2-token';
process.env.TEST_BOT_2_WEBHOOK_SECRET ??= 'test-bot-2-webhook-secret';
process.env.TEST_BOT_2_WEBHOOK_ID ??= 'test-webhook-id-2';
// Phase 05 platform bot environment variables (D-01)
process.env.PLATFORM_BOT_TOKEN ??= 'test-platform-bot-token';
process.env.PLATFORM_WEBHOOK_SECRET ??= 'test-platform-webhook-secret';
process.env.WEBHOOK_BASE_URL ??= 'https://test.example.com';
