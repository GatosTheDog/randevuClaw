# Phase 04: Per-Bot Foundation - Pattern Map

**Mapped:** 2026-07-10  
**Files analyzed:** 12 new/modified files  
**Analogs found:** 12 / 12 (100% match rate)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/telegram/registry.ts` | service/registry | request-response | `src/telegram/client.ts` | exact (imports, module structure) |
| `src/webhooks/telegram.ts` | webhook-handler | request-response | `src/webhooks/telegram.ts` (refactor self) | exact |
| `src/database/migrations/0003_phase4_per_bot.sql` | migration | schema-transformation | `migrations/0001_chief_karen_page.sql` | exact (SQL structure, naming) |
| `src/database/schema.ts` | model | schema-definition | `src/database/schema.ts` (patch self) | exact |
| `src/database/queries.ts` | service | CRUD + transaction | `src/database/queries.ts` (patch self) | exact |
| `src/database/seed.ts` | config/setup | batch-initialization | `src/database/seed.ts` (patch self) | exact |
| `src/config.ts` | config | configuration-loading | `src/config.ts` (patch self) | exact |
| `src/server.ts` | server-bootstrap | initialization | `src/server.ts` (patch self) | exact |
| `src/utils/logger.ts` | utility | configuration | `src/utils/logger.ts` (patch self) | exact (redaction patterns) |
| `tests/telegram-webhook.test.ts` | test | request-response-validation | `tests/telegram-webhook.test.ts` (patch self) | exact |
| `tests/jest.setup.ts` | test-config | initialization | `tests/jest.setup.ts` (patch self) | exact |
| `tests/rls-enforcement.test.ts` | test | transaction-validation | `tests/booking-queries.test.ts` | role-match (database query tests) |

## Pattern Assignments

### `src/telegram/registry.ts` (service, request-response)

**Analog:** `src/telegram/client.ts`

**Imports pattern** (lines 1-3):
```typescript
import { Telegraf } from 'telegraf';
import { logger } from '../utils/logger';
```

**Module structure and exports** (lines 1-30, from RESEARCH.md example):
```typescript
// src/telegram/registry.ts
import { Telegraf } from 'telegraf';
import { logger } from '../utils/logger';

type BotRegistry = Map<string, Telegraf>;
const botRegistry: BotRegistry = new Map();

/**
 * Retrieve or create a Telegraf instance for a given webhookId.
 * In production, call this once per registered bot at startup/registration time.
 * Tests create instances on-demand via seed data.
 */
export function getOrCreateBotInstance(webhookId: string, botToken: string): Telegraf {
  if (botRegistry.has(webhookId)) {
    return botRegistry.get(webhookId)!;
  }
  logger.info({ webhookId }, 'Creating new Telegraf instance');
  const bot = new Telegraf(botToken);
  // Do NOT call bot.launch() in webhook mode — the webhook handler calls .handleUpdate()
  botRegistry.set(webhookId, bot);
  return bot;
}

export function clearBotRegistry(): void {
  botRegistry.clear();
}

export function getBotInstance(webhookId: string): Telegraf | undefined {
  return botRegistry.get(webhookId);
}
```

**Note:** Copy logging pattern (logger.info with object context) from src/telegram/client.ts line 19 and src/utils/logger.ts lines 4-21 (pino configuration + redaction setup).

---

### `src/webhooks/telegram.ts` (webhook-handler, request-response)

**Analog:** `src/webhooks/telegram.ts` (self-refactor)

**Current HTTP handler structure** (lines 200-276):
```typescript
export async function handleTelegramWebhookPost(req: Request, res: Response): Promise<void> {
  try {
    const headerValue = req.headers['x-telegram-bot-api-secret-token'] as string | undefined;
    // ... verification logic ...
    const update = req.body as TelegramUpdate;
    // ... message handling ...
    res.status(200).send('OK');
  } catch (err) {
    logger.error({ err }, 'Unhandled error processing Telegram webhook');
  } finally {
    if (!res.headersSent) res.status(200).send('OK');
  }
}

const router = Router();
router.post('/', express.json(), handleTelegramWebhookPost);
export default router;
```

**Refactored webhook handler pattern** (from RESEARCH.md, Example 2, lines 537-582):
```typescript
// src/webhooks/telegram.ts (excerpt)
import express, { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getOrCreateBotInstance } from '../telegram/registry';
import { findBusinessByWebhookId } from '../database/queries';
import { withBusinessContext } from '../database/queries';
import { TelegramUpdate } from '../telegram/types';
import { logger } from '../utils/logger';

async function handleTelegramWebhookPost(req: Request, res: Response): Promise<void> {
  try {
    const headerValue = req.headers['x-telegram-bot-api-secret-token'] as string | undefined;
    const webhookId = req.params.webhookId as string;

    // Step 1: Find business by webhook ID
    const business = await findBusinessByWebhookId(webhookId);
    if (!business || !business.webhookSecret || !business.botToken) {
      logger.warn({ webhookId }, 'Webhook ID not found or incomplete');
      res.status(404).send('Not Found');
      return;
    }

    // Step 2: Verify secret with constant-time comparison
    const headerBuffer = Buffer.from(headerValue ?? '');
    const secretBuffer = Buffer.from(business.webhookSecret);

    try {
      crypto.timingSafeEqual(headerBuffer, secretBuffer);
    } catch {
      logger.warn({ webhookId }, 'Invalid webhook secret');
      res.status(401).send('Unauthorized');
      return;
    }

    // Step 3: Get the correct Telegraf instance and handle update
    const update = req.body as TelegramUpdate;
    const bot = getOrCreateBotInstance(webhookId, business.botToken);

    // Step 4: Wrap all downstream DB operations in RLS context
    await withBusinessContext(business.id, async () => {
      await bot.handleUpdate(update);
    });

    res.status(200).send('OK');
  } catch (err) {
    logger.error({ err }, 'Telegram webhook handler failed');
  } finally {
    if (!res.headersSent) res.status(200).send('OK');
  }
}

const router = Router();
router.post('/:webhookId', express.json(), handleTelegramWebhookPost);
export default router;
```

**Note:** Keep existing `handleFoundBusiness`, `handleCallbackQuery`, `parseCallbackData` functions unchanged (lines 56-198). Only replace HTTP handler and routing logic. Update server.ts to register on dynamic route.

---

### `src/database/migrations/0003_phase4_per_bot.sql` (migration, schema-transformation)

**Analog:** `migrations/0001_chief_karen_page.sql`, `migrations/0002_silent_ben_urich.sql`

**Existing migration structure** (migrations/0002_silent_ben_urich.sql):
```sql
ALTER TABLE "bookings" ADD COLUMN "calendar_sync_status" text DEFAULT 'pending' NOT NULL;
ALTER TABLE "bookings" ADD COLUMN "google_calendar_event_id" text;
ALTER TABLE "businesses" ADD COLUMN "google_refresh_token" text;
ALTER TABLE "businesses" ADD COLUMN "agenda_sent_date" text;
```

**New migration pattern** (from RESEARCH.md, Example 3, lines 589-650):
```sql
-- src/database/migrations/0003_phase4_per_bot.sql

-- Step 1: Add new columns to businesses table
ALTER TABLE businesses ADD COLUMN bot_token TEXT;
ALTER TABLE businesses ADD COLUMN webhook_id TEXT UNIQUE;
ALTER TABLE businesses ADD COLUMN webhook_secret TEXT;

-- Step 2: Create a non-superuser role for the app
CREATE ROLE randevuclaw_app WITH LOGIN PASSWORD 'app_role_password';

-- Step 3: Enable RLS on all business-scoped tables
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_business_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;

-- Step 4: Create RLS policies for each table
-- Policy: randevuclaw_app role can only see rows for the current business
CREATE POLICY messages_isolation ON messages
  FOR SELECT
  USING (
    business_id = CAST(current_setting('app.current_business_id', true) AS INTEGER)
  );

CREATE POLICY messages_insert_isolation ON messages
  FOR INSERT
  WITH CHECK (
    business_id = CAST(current_setting('app.current_business_id', true) AS INTEGER)
  );

-- Repeat pattern for: UPDATE, DELETE, and all other tables (bookings, services, business_hours, 
-- client_business_relationships, conversation_turns, telegram_updates, businesses)

-- Step 5: Grant permissions to app role
GRANT SELECT, INSERT, UPDATE, DELETE ON messages TO randevuclaw_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON bookings TO randevuclaw_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON services TO randevuclaw_app;
-- Repeat for all business-scoped tables
GRANT SELECT ON businesses TO randevuclaw_app;

-- Step 6: Set default search path for app role
ALTER ROLE randevuclaw_app SET search_path = public;
```

**Note:** Follow naming convention from existing migrations (0001_*_description.sql, 0002_*_description.sql). Use `-->`statement-breakpoint comment separator as in 0001 and 0002.

---

### `src/database/schema.ts` (model, schema-definition)

**Analog:** `src/database/schema.ts` (patch self)

**Existing businesses table** (lines 12-31):
```typescript
export const businesses = pgTable('businesses', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  phoneNumberId: text('phone_number_id'),
  // Phase 2 (nullable — Phase 1 already inserted 2 rows...)
  ownerTelegramId: text('owner_telegram_id'),
  // Phase 3 (nullable — table is non-empty...)
  googleRefreshToken: text('google_refresh_token'),
  // Phase 3 (nullable — D-11 idempotency guard)...
  agendaSentDate: text('agenda_sent_date'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

**Patch to add Phase 04 columns** (following nullable convention from lines 17-29):
```typescript
export const businesses = pgTable('businesses', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  phoneNumberId: text('phone_number_id'),
  ownerTelegramId: text('owner_telegram_id'),
  googleRefreshToken: text('google_refresh_token'),
  agendaSentDate: text('agenda_sent_date'),
  // Phase 4 (nullable — D-07): per-bot Telegram bot token, stored DB-side.
  // Never logged; only read by src/webhooks/telegram.ts for routing.
  botToken: text('bot_token'),
  // Phase 4 (nullable — D-07): UUID-keyed webhook routing path (e.g., /webhooks/telegram/:webhookId).
  // The actual bot token never appears in logs or URL paths.
  webhookId: text('webhook_id').unique(),
  // Phase 4 (nullable — D-07): HMAC secret for webhook signature verification.
  // Verified via constant-time comparison (crypto.timingSafeEqual) in D-06.
  webhookSecret: text('webhook_secret'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

**Note:** Update Business interface in queries.ts (lines 14-23) to include botToken, webhookId, webhookSecret as optional fields.

---

### `src/database/queries.ts` (service, CRUD + transaction)

**Analog:** `src/database/queries.ts` (patch self)

**Existing query function pattern** (lines 34-42):
```typescript
export async function findBusinessBySlug(slug: string): Promise<Business | null> {
  const rows = await db
    .select()
    .from(businesses)
    .where(eq(businesses.slug, slug))
    .limit(1);

  return rows[0] ?? null;
}
```

**New transaction wrapper with RLS context** (from RESEARCH.md, Example 4, lines 656-697):
```typescript
import { sql } from 'drizzle-orm';

/**
 * Execute a callback within a transaction with RLS context set.
 * Automatically clears context on commit/rollback (transaction-scoped).
 */
export async function withBusinessContext<T>(
  businessId: string | number,
  callback: () => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    // Set the context variable for RLS policies
    await tx.execute(sql`SET LOCAL app.current_business_id = ${String(businessId)}`);
    // All subsequent queries in this transaction see the context
    return callback();
  });
}

// New query functions for Phase 04 routing and lookup
export async function findBusinessByWebhookId(webhookId: string): Promise<Business | null> {
  const rows = await db
    .select()
    .from(businesses)
    .where(eq(businesses.webhookId, webhookId))
    .limit(1);

  return rows[0] ?? null;
}

export async function findBusinessById(businessId: number): Promise<Business | null> {
  const rows = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  return rows[0] ?? null;
}
```

**Note:** Copy transaction pattern structure from existing Drizzle usage (db.transaction calls in seed.ts). Use `sql` template literal for raw SQL execution (SET LOCAL).

---

### `src/database/seed.ts` (config/setup, batch-initialization)

**Analog:** `src/database/seed.ts` (patch self)

**Existing seed structure** (lines 100-183):
```typescript
export async function seed(): Promise<void> {
  const existing = await db.select({ slug: businesses.slug }).from(businesses);
  const existingSlugs = existing.map((row) => row.slug);

  for (const fixture of FIXTURES) {
    if (existingSlugs.includes(fixture.slug)) {
      logger.info({ slug: fixture.slug }, 'Fixture business already exists, skipping');
      continue;
    }
    await db.insert(businesses).values({ name: fixture.name, slug: fixture.slug });
    logger.info({ slug: fixture.slug }, 'Fixture business seeded');
  }

  // Backfill owner Telegram contact...
  for (const fixture of FIXTURES) {
    await db.update(businesses).set({ ownerTelegramId: config.ownerTelegramId }).where(...);
  }

  // Seed services + business hours...
}
```

**Patch to populate bot_token, webhook_id, webhook_secret from env vars** (following idempotent update pattern):
```typescript
// After existing fixture backfill (line 121), add:

// Backfill bot token, webhook ID, and secret from env vars (Phase 04)
for (const fixture of FIXTURES) {
  const testBotKey = fixture.slug === 'pilates-athens' ? '1' : '2';
  const botToken = process.env[`TEST_BOT_${testBotKey}_TOKEN`];
  const webhookId = process.env[`TEST_BOT_${testBotKey}_WEBHOOK_ID`];
  const webhookSecret = process.env[`TEST_BOT_${testBotKey}_WEBHOOK_SECRET`];

  if (botToken && webhookId && webhookSecret) {
    await db
      .update(businesses)
      .set({ botToken, webhookId, webhookSecret })
      .where(eq(businesses.slug, fixture.slug));
    logger.info({ slug: fixture.slug, webhookId }, 'Bot credentials seeded');
  }
}
```

**Note:** Follow existing conditional logging pattern (logger.info only if action taken). Keep idempotent UPDATE structure (no WHERE clause guards needed since seed can run multiple times safely).

---

### `src/config.ts` (config, configuration-loading)

**Analog:** `src/config.ts` (patch self)

**Current env schema** (lines 19-39):
```typescript
const EnvSchema = z.object({
  APP_SECRET: z.string().min(1),
  WEBHOOK_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  OWNER_TELEGRAM_ID: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().min(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.string().default('development'),
});
```

**Patch to remove global Telegram vars and add per-test-bot vars** (D-08, D-09):
```typescript
const EnvSchema = z.object({
  APP_SECRET: z.string().min(1),
  WEBHOOK_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  // REMOVED: TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET (D-08)
  // All bot token/secret config is DB-driven in Phase 04
  OWNER_TELEGRAM_ID: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().min(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.string().default('development'),
  // Phase 04 test bot environment variables (D-09)
  TEST_BOT_1_TOKEN: z.string().optional(),
  TEST_BOT_1_WEBHOOK_SECRET: z.string().optional(),
  TEST_BOT_1_WEBHOOK_ID: z.string().optional(),
  TEST_BOT_2_TOKEN: z.string().optional(),
  TEST_BOT_2_WEBHOOK_SECRET: z.string().optional(),
  TEST_BOT_2_WEBHOOK_ID: z.string().optional(),
});
```

**Remove from Config interface** (lines 41-57):
```typescript
// DELETE these two lines:
telegramBotToken: string;
telegramWebhookSecret: string;

// The rest stays unchanged
```

**Update config object assignment** (lines 63-79):
```typescript
export const config: Config = {
  appSecret: env.APP_SECRET,
  webhookVerifyToken: env.WEBHOOK_VERIFY_TOKEN,
  whatsappAccessToken: env.WHATSAPP_ACCESS_TOKEN,
  whatsappPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
  databaseUrl: env.DATABASE_URL,
  geminiApiKey: env.GEMINI_API_KEY,
  // REMOVED: telegramBotToken and telegramWebhookSecret
  ownerTelegramId: env.OWNER_TELEGRAM_ID,
  googleClientId: env.GOOGLE_CLIENT_ID,
  googleClientSecret: env.GOOGLE_CLIENT_SECRET,
  googleRedirectUri: env.GOOGLE_REDIRECT_URI,
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  nodeEnv: env.NODE_ENV === 'production' ? 'production' : 'development',
};
```

---

### `src/server.ts` (server-bootstrap, initialization)

**Analog:** `src/server.ts` (patch self)

**Current webhook registration** (lines 1-13):
```typescript
import express from 'express';
import { logger } from './utils/logger';
import webhookRouter from './webhooks/whatsapp';
import telegramWebhookRouter from './webhooks/telegram';

const app = express();

app.use('/webhooks/whatsapp', webhookRouter);
app.use('/webhooks/telegram', telegramWebhookRouter);
```

**Patch to register dynamic telegram webhook route** (D-04):
```typescript
import express from 'express';
import { logger } from './utils/logger';
import webhookRouter from './webhooks/whatsapp';
import telegramWebhookRouter from './webhooks/telegram';

const app = express();

app.use('/webhooks/whatsapp', webhookRouter);
// Phase 04: Dynamic telegram webhook routing by webhookId (D-04)
app.use('/webhooks/telegram', telegramWebhookRouter);
```

**Note:** No change needed to server.ts — the router.post('/:webhookId', ...) in telegram.ts handles the dynamic routing. Just ensure the mount point remains '/webhooks/telegram'.

---

### `src/utils/logger.ts` (utility, configuration)

**Analog:** `src/utils/logger.ts` (patch self)

**Current redaction configuration** (lines 1-21):
```typescript
import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'appSecret', 'databaseUrl', 'whatsappAccessToken', 'webhookVerifyToken',
      'geminiApiKey', 'telegramBotToken', 'telegramWebhookSecret', 'googleClientSecret',
      'googleRefreshToken',
      // ... multiple path patterns ...
    ],
    censor: '[REDACTED]',
  },
});
```

**Patch to remove deprecated fields and add webhook redaction** (D-08, STATE.md blocker):
```typescript
export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'appSecret', 'databaseUrl', 'whatsappAccessToken', 'webhookVerifyToken',
      'geminiApiKey', 'googleClientSecret',
      'googleRefreshToken', 'botToken', 'webhookSecret',  // Phase 04 additions
      // Keep existing patterns, remove: 'telegramBotToken', 'telegramWebhookSecret'
      '*.appSecret', '*.databaseUrl', '*.whatsappAccessToken', '*.webhookVerifyToken',
      '*.geminiApiKey', '*.googleClientSecret',
      '*.googleRefreshToken', '*.botToken', '*.webhookSecret',  // Phase 04 additions
      'config.appSecret', 'config.databaseUrl', 'config.whatsappAccessToken', 'config.webhookVerifyToken',
      'config.geminiApiKey', 'config.googleClientSecret',
      // Remove: 'config.telegramBotToken', 'config.telegramWebhookSecret'
    ],
    censor: '[REDACTED]',
  },
});
```

**Note:** Add `botToken` and `webhookSecret` to redaction paths at all three levels (field, nested object, config namespace). This ensures no bot tokens leak in logs even if logged via `logger.info({ business })` where business has botToken/webhookSecret fields.

---

### `tests/telegram-webhook.test.ts` (test, request-response-validation)

**Analog:** `tests/telegram-webhook.test.ts` (patch self)

**Current webhook verification test** (lines 158-169):
```typescript
it('Test 4: missing/wrong secret token -> 403, neither sendTelegramMessage nor routeConversationMessage called', async () => {
  mockedFindBusinessBySlug.mockResolvedValue(KNOWN_BUSINESS);

  const resMissing = await postWebhook(makeMessageUpdate(4, 'pilates-athens'), null);
  expect(resMissing.status).toBe(403);

  const resWrong = await postWebhook(makeMessageUpdate(5, 'pilates-athens'), 'wrong-secret');
  expect(resWrong.status).toBe(403);

  expect(mockedSendTelegramMessage).not.toHaveBeenCalled();
  expect(mockedRouteConversationMessage).not.toHaveBeenCalled();
});
```

**Patch to support per-bot routing** (RESEARCH.md Phase 4 test mapping, line 770-778):
```typescript
// Update postWebhook helper to support :webhookId parameter
async function postWebhook(
  webhookId: string = 'test-webhook-id-1',
  body: object,
  secret: string | null = SECRET
) {
  const req = request(app)
    .post(`/webhooks/telegram/${webhookId}`)
    .set('Content-Type', 'application/json');
  if (secret !== null) req.set('X-Telegram-Bot-Api-Secret-Token', secret);
  return req.send(body);
}

// Update mock setup to include findBusinessByWebhookId
jest.mock('../src/database/queries');
const mockedFindBusinessByWebhookId = queries.findBusinessByWebhookId as jest.MockedFunction<
  typeof queries.findBusinessByWebhookId
>;
const mockedWithBusinessContext = queries.withBusinessContext as jest.MockedFunction<
  typeof queries.withBusinessContext
>;

// Update test cases to use webhook ID routing
it('Test: two bots parallel -> distinct messages route to correct Telegraf instances', async () => {
  mockedFindBusinessByWebhookId
    .mockResolvedValueOnce(KNOWN_BUSINESS)
    .mockResolvedValueOnce(KNOWN_BUSINESS_2);
  mockedWithBusinessContext
    .mockImplementationOnce((businessId, callback) => callback())
    .mockImplementationOnce((businessId, callback) => callback());

  const res1 = await postWebhook('webhook-id-1', makeMessageUpdate(1, 'pilates-athens'), SECRET);
  const res2 = await postWebhook('webhook-id-2', makeMessageUpdate(2, 'hair-athens'), SECRET);

  expect(res1.status).toBe(200);
  expect(res2.status).toBe(200);
  expect(mockedFindBusinessByWebhookId).toHaveBeenCalledTimes(2);
});

// Add timing-safe comparison test (BOT-03, RESEARCH.md line 773)
it('Test: webhook secret verification uses constant-time comparison', async () => {
  mockedFindBusinessByWebhookId.mockResolvedValue({
    ...KNOWN_BUSINESS,
    webhookSecret: 'correct-secret',
  });

  const resValid = await postWebhook('webhook-id-1', makeMessageUpdate(10, 'text'), 'correct-secret');
  const resInvalid = await postWebhook('webhook-id-1', makeMessageUpdate(11, 'text'), 'wrong-secret');

  expect(resValid.status).toBe(200);
  expect(resInvalid.status).toBe(401);
});
```

**Note:** Keep all existing test cases (1-7, callback_query, etc.) and update their `postWebhook` calls to include a default `webhookId`. Tests should still pass unchanged because the default routing behavior is the same.

---

### `tests/jest.setup.ts` (test-config, initialization)

**Analog:** `tests/jest.setup.ts` (patch self)

**Current env baseline** (lines 1-18):
```typescript
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
```

**Patch to remove global telegram vars and add per-test-bot vars** (D-09):
```typescript
process.env.APP_SECRET ??= 'test-app-secret';
process.env.WEBHOOK_VERIFY_TOKEN ??= 'test-verify-token';
process.env.WHATSAPP_ACCESS_TOKEN ??= 'test-whatsapp-token';
process.env.WHATSAPP_PHONE_NUMBER_ID ??= 'test-phone-number-id';
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/testdb?sslmode=require';
process.env.GEMINI_API_KEY ??= 'test-gemini-key';
// REMOVED: TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET (use DB-driven instead)
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
```

**Note:** Use same `??=` pattern (assign if not already set) as existing baseline. This ensures tests that override these vars still work.

---

### `tests/rls-enforcement.test.ts` (test, transaction-validation)

**Analog:** `tests/booking-queries.test.ts`

**Existing database test structure** (from booking-queries.test.ts):
```typescript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { db } from '../src/database/db';
import { bookings, businesses } from '../src/database/schema';
import * as queries from '../src/database/queries';

describe('Booking queries', () => {
  beforeEach(async () => {
    // Setup: clear tables before each test
    await db.delete(bookings);
    await db.delete(businesses);
  });

  it('creates booking and returns it', async () => {
    const result = await queries.createBooking(...);
    expect(result.id).toBeDefined();
  });
});
```

**New RLS enforcement test pattern** (from RESEARCH.md Pitfall 2/5, lines 415-426):
```typescript
// tests/rls-enforcement.test.ts
import { describe, it, expect, beforeEach } from '@jest/globals';
import { db } from '../src/database/db';
import { bookings, businesses, messages } from '../src/database/schema';
import { withBusinessContext } from '../src/database/queries';
import { sql } from 'drizzle-orm';

describe('RLS enforcement', () => {
  beforeEach(async () => {
    // Setup: clear tables
    await db.delete(bookings);
    await db.delete(messages);
    await db.delete(businesses);
  });

  it('RLS blocks unscoped SELECT queries (defense-in-depth)', async () => {
    // Insert two businesses
    const [b1, b2] = await db
      .insert(businesses)
      .values([
        { name: 'Business 1', slug: 'biz-1', botToken: 'token-1', webhookId: 'wh-1', webhookSecret: 'secret-1' },
        { name: 'Business 2', slug: 'biz-2', botToken: 'token-2', webhookId: 'wh-2', webhookSecret: 'secret-2' },
      ])
      .returning({ id: businesses.id });

    // Insert messages for both businesses
    await db.insert(messages).values([
      { businessId: b1.id, messageBody: 'msg-1', senderPhone: '1111', whatsappMessageId: 'wa-1' },
      { businessId: b2.id, messageBody: 'msg-2', senderPhone: '2222', whatsappMessageId: 'wa-2' },
    ]);

    // Query within B1's context: should see only B1's message
    const b1Messages = await withBusinessContext(b1.id, async () => {
      // Query WITHOUT WHERE clause — RLS should filter rows
      return db.select().from(messages);
    });
    expect(b1Messages).toHaveLength(1);
    expect(b1Messages[0].businessId).toBe(b1.id);

    // Query within B2's context: should see only B2's message
    const b2Messages = await withBusinessContext(b2.id, async () => {
      return db.select().from(messages);
    });
    expect(b2Messages).toHaveLength(1);
    expect(b2Messages[0].businessId).toBe(b2.id);
  });

  it('SET LOCAL context clears after transaction, next transaction uses new context', async () => {
    const [b1, b2] = await db
      .insert(businesses)
      .values([
        { name: 'Business 1', slug: 'biz-1', botToken: 'token-1', webhookId: 'wh-1', webhookSecret: 'secret-1' },
        { name: 'Business 2', slug: 'biz-2', botToken: 'token-2', webhookId: 'wh-2', webhookSecret: 'secret-2' },
      ])
      .returning({ id: businesses.id });

    await db.insert(messages).values([
      { businessId: b1.id, messageBody: 'b1-msg', senderPhone: '1111', whatsappMessageId: 'wa-1' },
      { businessId: b2.id, messageBody: 'b2-msg', senderPhone: '2222', whatsappMessageId: 'wa-2' },
    ]);

    // First transaction sets context to B1
    const tx1Result = await withBusinessContext(b1.id, async () => {
      return db.select().from(messages);
    });

    // Second transaction sets context to B2 (context from tx1 is cleared)
    const tx2Result = await withBusinessContext(b2.id, async () => {
      return db.select().from(messages);
    });

    expect(tx1Result[0].businessId).toBe(b1.id);
    expect(tx2Result[0].businessId).toBe(b2.id);
  });

  it('INSERT is blocked by RLS if business_id does not match context', async () => {
    const [b1] = await db
      .insert(businesses)
      .values([{ name: 'Business 1', slug: 'biz-1', botToken: 'token-1', webhookId: 'wh-1', webhookSecret: 'secret-1' }])
      .returning({ id: businesses.id });

    // Try to insert a message for B1 while context is set to a different business ID
    const wrongBusinessId = 9999;

    await expect(
      withBusinessContext(wrongBusinessId, async () => {
        return db.insert(messages).values({
          businessId: b1.id,
          messageBody: 'attempt',
          senderPhone: '1111',
          whatsappMessageId: 'wa-attempt',
        });
      })
    ).rejects.toThrow();
  });
});
```

**Note:** Use same test structure as booking-queries.test.ts (describe + beforeEach + it). Call `withBusinessContext` and verify RLS filters rows even when no WHERE clause is present (defense-in-depth pattern from RESEARCH.md Pitfall 2).

---

## Shared Patterns

### Constant-Time HMAC Verification (Timing-Attack Mitigation)
**Source:** Node.js built-in `crypto.timingSafeEqual`  
**Apply to:** All webhook secret verification in `src/webhooks/telegram.ts`

```typescript
import crypto from 'crypto';

const headerBuffer = Buffer.from(headerValue ?? '');
const secretBuffer = Buffer.from(business.webhookSecret);

try {
  crypto.timingSafeEqual(headerBuffer, secretBuffer);
} catch {
  // Buffers have different lengths — reject with 401
  res.status(401).send('Unauthorized');
  return;
}
```

**Why:** String equality (`===`) leaks timing information, allowing byte-by-byte secret reconstruction. `timingSafeEqual` is constant-time regardless of where bytes differ.

---

### Structured Logging with Redaction
**Source:** `src/utils/logger.ts` (pino configuration)  
**Apply to:** All logging statements in new files

```typescript
import { logger } from '../utils/logger';

logger.info({ webhookId, businessId }, 'Creating Telegraf instance');
logger.warn({ webhookId }, 'Invalid webhook secret');
logger.error({ err, webhookId }, 'Webhook handler failed');
```

**Why:** Pino's redaction at config time (lines 8-20) ensures botToken, webhookSecret, and other secrets are never logged, even if accidentally included in an object literal.

---

### Transaction-Scoped RLS Context (No Cross-Tenant Leakage)
**Source:** `src/database/queries.ts` `withBusinessContext` function  
**Apply to:** All webhook handlers and conversation routing

```typescript
await withBusinessContext(business.id, async () => {
  await bot.handleUpdate(update);
});
```

**Why:** `SET LOCAL` context is transaction-scoped and auto-clears. If `SET` without LOCAL were used (session-scoped), connection pooling reuse would leak context across unrelated requests.

---

### Nullable Column Convention for Multi-Phase Schema Evolution
**Source:** `src/database/schema.ts` (lines 17-29 comment pattern)  
**Apply to:** All new Phase 04 schema columns

```typescript
// Phase 4 (nullable — D-07): per-bot Telegram bot token, stored DB-side.
// Never logged; only read by src/webhooks/telegram.ts for routing.
botToken: text('bot_token'),
```

**Why:** Phase 1 and 2 already inserted fixture rows. New NOT NULL columns cannot be added without a default. Nullable + comment explaining why prevents future schema refactoring confusion.

---

### Module-Level Singleton Registry for Per-Tenant State
**Source:** `src/telegram/registry.ts` `getOrCreateBotInstance`  
**Apply to:** Per-bot Telegraf instance management

```typescript
type BotRegistry = Map<string, Telegraf>;
const botRegistry: BotRegistry = new Map();

export function getOrCreateBotInstance(webhookId: string, botToken: string): Telegraf {
  if (botRegistry.has(webhookId)) {
    return botRegistry.get(webhookId)!;
  }
  const bot = new Telegraf(botToken);
  botRegistry.set(webhookId, bot);
  return bot;
}
```

**Why:** One instance per bot prevents context pollution (middleware, handlers, state from bot A bleeding into bot B). Map is thread-safe for lookup and insertion.

---

### Idempotent Seed Structure for Fixture Population
**Source:** `src/database/seed.ts` (lines 100-183 pattern)  
**Apply to:** Backfilling new bot credentials

```typescript
for (const fixture of FIXTURES) {
  const testBotKey = fixture.slug === 'pilates-athens' ? '1' : '2';
  const botToken = process.env[`TEST_BOT_${testBotKey}_TOKEN`];
  if (botToken && webhookId && webhookSecret) {
    await db.update(businesses).set({ botToken, webhookId, webhookSecret })
      .where(eq(businesses.slug, fixture.slug));
    logger.info({ slug: fixture.slug }, 'Bot credentials seeded');
  }
}
```

**Why:** idempotent UPDATEs allow seed() to run multiple times without errors. Conditional logging (only if action taken) keeps logs clean.

---

### Test Environment Variable Baseline (??= Pattern)
**Source:** `tests/jest.setup.ts` (lines 6-17)  
**Apply to:** All test env var assignments

```typescript
process.env.TEST_BOT_1_TOKEN ??= 'test-bot-1-token';
process.env.TEST_BOT_1_WEBHOOK_ID ??= 'test-webhook-id-1';
```

**Why:** `??=` only assigns if the env var is undefined. Tests that set these vars before importing can override (used by jest.resetModules() in config.test.ts).

---

## No Analog Found

None — all 12 files have exact or close analogs in the existing codebase.

## Metadata

**Analog search scope:** 
- `/Users/manolis/Documents/RandevuClaw/src/` (all TypeScript source files)
- `/Users/manolis/Documents/RandevuClaw/migrations/` (SQL migrations)
- `/Users/manolis/Documents/RandevuClaw/tests/` (test files)

**Files scanned:** 30+ (config, webhooks, database, telegram, utilities, tests)

**Pattern extraction date:** 2026-07-10

**Coverage assessment:**
- Files with exact analog (same role + data flow + structure): 12
- Files with role-match analog (same role, can adapt): 0
- Files with no clear analog: 0

---

*Phase: 04 - Per-Bot Foundation*  
*Status: Pattern mapping complete*  
*Ready for: `/gsd-plan-phase 4`*
