import dotenv from 'dotenv';
import { z } from 'zod';

// Under Jest, tests fully control process.env (directly, or via
// tests/jest.setup.ts). Skip reading real dotenv files entirely so test
// behavior never depends on the contents of an untracked, developer-local
// .env.local — otherwise a deleted-for-testing var could get silently
// refilled from disk, masking "missing required var" / "falls back to
// documented default" test scenarios.
if (!process.env.JEST_WORKER_ID) {
  // Load .env.local first (developer-local secrets, gitignored), then fall
  // back to a plain .env for anything not already set. Neither call uses
  // `override`, so any variable already present on process.env (e.g.
  // injected by the shell or CI) always wins — dotenv only fills gaps.
  dotenv.config({ path: '.env.local' });
  dotenv.config({ path: '.env' });
}

const EnvSchema = z.object({
  APP_SECRET: z.string().min(1),
  WEBHOOK_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  // TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET removed (D-08, Phase 04):
  // all bot token/secret config is now DB-driven. Per-bot tokens and secrets
  // are stored in businesses.bot_token and businesses.webhook_secret.
  OWNER_TELEGRAM_ID: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().min(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PORT: z.coerce.number().default(3000),
  // Accept any string here (Jest always sets NODE_ENV='test' before any of our
  // code runs); the canonical 'development' | 'production' distinction the app
  // actually cares about is derived below, treating anything other than
  // 'production' as 'development' (including 'test' and an omitted value).
  NODE_ENV: z.string().default('development'),
  // Phase 04 (D-11): optional app-role connection string for randevuclaw_app.
  // Falls back to DATABASE_URL if unset (development/tests without the role).
  DATABASE_APP_URL: z.string().optional(),
  // Phase 5 (D-01): platform onboarding bot token. Only global bot token remaining;
  // all per-business tokens are DB-driven (businesses.bot_token).
  PLATFORM_BOT_TOKEN: z.string().min(1),
  // Phase 5 (D-01): HMAC secret for platform bot webhook. Separate from
  // per-business webhookSecret values stored in businesses table.
  PLATFORM_WEBHOOK_SECRET: z.string().min(1),
  // Phase 5: base URL for constructing setWebhook URLs (e.g. https://randevuclaw.fly.dev).
  // Optional — only required when activating a business bot (setWebhook call).
  // Omit in local dev; set in fly.io secrets for production.
  WEBHOOK_BASE_URL: z.string().optional(),
});

export interface Config {
  appSecret: string;
  webhookVerifyToken: string;
  whatsappAccessToken: string;
  whatsappPhoneNumberId: string;
  databaseUrl: string;
  // Phase 04 (D-11): optional connection string for randevuclaw_app role.
  // Used by appDb (db.ts) for RLS-enforced conversation queries.
  databaseAppUrl?: string;
  geminiApiKey: string;
  // telegramBotToken and telegramWebhookSecret removed (D-08, Phase 04).
  // All bot token/secret config is now DB-driven (businesses table).
  ownerTelegramId: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  nodeEnv: 'development' | 'production';
  // Phase 5 (D-01): platform onboarding bot credentials and webhook base URL.
  platformBotToken: string;
  platformWebhookSecret: string;
  webhookBaseUrl?: string;
}

// Fail fast: EnvSchema.parse throws synchronously if a required var is missing,
// naming the missing key in the error message. Not caught here on purpose.
const env = EnvSchema.parse(process.env);

export const config: Config = {
  appSecret: env.APP_SECRET,
  webhookVerifyToken: env.WEBHOOK_VERIFY_TOKEN,
  whatsappAccessToken: env.WHATSAPP_ACCESS_TOKEN,
  whatsappPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
  databaseUrl: env.DATABASE_URL,
  databaseAppUrl: env.DATABASE_APP_URL,
  geminiApiKey: env.GEMINI_API_KEY,
  // telegramBotToken and telegramWebhookSecret removed (D-08, Phase 04).
  ownerTelegramId: env.OWNER_TELEGRAM_ID,
  googleClientId: env.GOOGLE_CLIENT_ID,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  googleRedirectUri: env.GOOGLE_REDIRECT_URI,
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  nodeEnv: env.NODE_ENV === 'production' ? 'production' : 'development',
  platformBotToken: env.PLATFORM_BOT_TOKEN,
  platformWebhookSecret: env.PLATFORM_WEBHOOK_SECRET,
  webhookBaseUrl: env.WEBHOOK_BASE_URL,
};
