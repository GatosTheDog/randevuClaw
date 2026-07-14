# Phase 5: Owner Self-Serve Onboarding - Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** 11 new/modified files
**Analogs found:** 11 / 11

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/webhooks/platform.ts` | middleware/handler | request-response | `src/webhooks/telegram.ts` | exact |
| `src/onboarding/router.ts` | service | event-driven (state machine) | `src/conversation/router.ts` | role-match |
| `src/onboarding/steps.ts` | service | CRUD + event-driven | `src/conversation/function-executor.ts` | role-match |
| `src/onboarding/queries.ts` | service | CRUD | `src/database/queries.ts` | exact |
| `src/telegram/client.ts` (modify) | utility | request-response | `src/telegram/client.ts` itself | self |
| `src/database/schema.ts` (modify) | model | — | `src/database/schema.ts` itself | self |
| `src/config.ts` (modify) | config | — | `src/config.ts` itself | self |
| `src/server.ts` (modify) | config/routing | request-response | `src/server.ts` itself | self |
| `migrations/0004_phase5_onboarding.sql` | migration | — | existing migrations | role-match |
| `tests/helpers/test-business.ts` | utility/test | CRUD | `src/database/seed.ts` | role-match |
| `tests/onboarding-platform.test.ts` | test | request-response | `tests/telegram-webhook.test.ts` | exact |
| `tests/onboarding-flow.test.ts` | test | event-driven | `tests/conversation-router.test.ts` | role-match |

---

## Pattern Assignments

### `src/webhooks/platform.ts` (handler, request-response)

**Analog:** `src/webhooks/telegram.ts`

**Imports pattern** (lines 1-19):
```typescript
import crypto from 'crypto';
import express, { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import {
  findBusinessByOwnerTelegramId,
  insertOrIgnoreTelegramUpdate,
  // ... onboarding-specific imports
} from '../database/queries';
import { botTokenStore, sendTelegramMessage } from '../telegram/client';
import { getOrCreateBotInstance } from '../telegram/registry';
```

**HMAC verification pattern** (lines 205-223 of `src/webhooks/telegram.ts`):
```typescript
const rawHeader = req.headers['x-telegram-bot-api-secret-token'];
const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
const headerBuffer = Buffer.from(headerValue ?? '');
const secretBuffer = Buffer.from(business.webhookSecret);
let secretValid: boolean;
try {
  secretValid = crypto.timingSafeEqual(headerBuffer, secretBuffer);
} catch {
  secretValid = false;
}
if (!secretValid) {
  logger.warn({ webhookId }, 'Webhook secret verification failed');
  res.status(401).send('Unauthorized');
  return;
}
```
For the platform bot, `webhookSecret` comes from `config.PLATFORM_WEBHOOK_SECRET` (a fixed env var, not DB-driven). The header name is the same (`x-telegram-bot-api-secret-token`).

**botTokenStore + try/finally pattern** (lines 247-291 of `src/webhooks/telegram.ts`):
```typescript
await botTokenStore.run(business.botToken, async () => {
  // all DB + send ops here
});
// Always 200 to Telegram
res.status(200).send('OK');
// ...
} catch (err) {
  logger.error({ err }, 'Telegram webhook handler failed');
} finally {
  if (!res.headersSent) res.status(200).send('OK');
}
```
Platform bot uses `botTokenStore.run(config.PLATFORM_BOT_TOKEN, ...)` for outbound messages. Does NOT use `withBusinessContext` (admin db, no RLS — platform handler is cross-tenant).

**dedup insert pattern** (lines 257-268 of `src/webhooks/telegram.ts`):
```typescript
const dedupResult = await insertOrIgnoreTelegramUpdate(
  updateId,
  business.id,     // platform bot: pass null for new registrations (business not yet created)
  senderTelegramId,
  updateType
);
if (dedupResult === 'ignored') {
  logger.info({ updateId }, 'Duplicate Telegram update ignored');
  return;
}
```

**Unsupported update type guard** (lines 235-243 of `src/webhooks/telegram.ts`):
```typescript
if (!update.message && !update.callback_query) {
  logger.info(
    { updateId, updateType: Object.keys(update).filter((k) => k !== 'update_id') },
    'Unsupported Telegram update type, ignoring'
  );
  res.status(200).send('OK');
  return;
}
```

---

### `src/onboarding/router.ts` (service, event-driven state machine)

**Analog:** `src/conversation/router.ts`

**Imports pattern** (from `src/conversation/router.ts` line 1):
```typescript
import { logger } from '../utils/logger';
import { Business } from '../database/queries';
// plus onboarding-specific imports
```

**Step dispatch pattern** — dispatch on a single string field, return early from each branch:
```typescript
// Mirrors routeConversationMessage(business, senderTelegramId, messageText, channel)
export async function dispatchOnboardingStep(
  session: OnboardingSession,
  business: Business,
  ownerTelegramId: string,
  messageText: string
): Promise<void> {
  const step = session.currentStep as OnboardingStep;
  switch (step) {
    case 'name':
      return handleNameStep(session, business, ownerTelegramId, messageText);
    case 'hours_0_query':
    // ...
  }
}
```

**Error isolation pattern** — never let a step error bubble out without logging:
```typescript
// From src/webhooks/telegram.ts handleFoundBusiness() lines 44-58
try {
  await dispatchOnboardingStep(session, business, ownerTelegramId, messageText);
} catch (err) {
  logger.error({ err }, 'Failed to dispatch onboarding step');
}
```

---

### `src/onboarding/steps.ts` (service, CRUD + event-driven)

**Analog:** `src/conversation/function-executor.ts`

**Pattern:** Individual named handler functions, each responsible for validating input, writing to DB, advancing session step, and sending the next prompt.

**Validation + send pattern** — validate then act, or send error and return:
```typescript
// HH:MM validation (from RESEARCH.md Security Domain)
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
if (!TIME_REGEX.test(text.trim())) {
  await sendTelegramMessage(ownerTelegramId, 'Μη έγκυρη ώρα. Παρακαλώ χρησιμοποιήστε μορφή ΩΩ:ΛΛ (π.χ. 09:00):');
  return; // do NOT advance step
}
```

**Incremental DB write pattern** — same as `insertOrIgnoreTelegramUpdate` but for business_hours:
```typescript
// From src/database/queries.ts insertOrIgnoreMessage() lines 87-106
await db.insert(businessHours).values({
  businessId: business.id,
  dayOfWeek: dayIndex,
  openTime: collectedData.openTime,
  closeTime: text.trim(),
  isClosed: false,
}).onConflictDoNothing(); // unique_business_day index
```

**Advance step + send prompt helper**:
```typescript
await updateOnboardingStep(session.id, nextStep, updatedCollectedData);
await sendTelegramMessage(ownerTelegramId, nextPrompt);
```

---

### `src/onboarding/queries.ts` (service, CRUD)

**Analog:** `src/database/queries.ts`

**Imports pattern** (lines 1-13 of `src/database/queries.ts`):
```typescript
import { and, eq, not } from 'drizzle-orm';
import { db } from './db';
import { onboardingSessions, businesses } from './schema';
```
Use admin `db` (not `appDb`) — onboarding queries are always cross-tenant (platform bot context).

**Insert pattern** (lines 87-106 of `src/database/queries.ts`):
```typescript
export async function createOnboardingSession(
  businessId: number,
  initialStep: string
): Promise<OnboardingSession> {
  const rows = await db
    .insert(onboardingSessions)
    .values({ businessId, currentStep: initialStep, collectedData: null })
    .onConflictDoUpdate({
      target: onboardingSessions.businessId,
      set: { currentStep: initialStep, collectedData: null, updatedAt: new Date() },
    })
    .returning();
  return rows[0];
}
```

**Select with join pattern** (lines 115-127 of `src/database/queries.ts` — `findLatestBusinessForClient`):
```typescript
export async function findActiveSessionByOwnerTelegramId(
  ownerTelegramId: string
): Promise<{ session: OnboardingSession; business: Business } | null> {
  const rows = await db
    .select({ session: onboardingSessions, business: businesses })
    .from(onboardingSessions)
    .innerJoin(businesses, eq(onboardingSessions.businessId, businesses.id))
    .where(
      and(
        eq(businesses.ownerTelegramId, ownerTelegramId),
        not(eq(onboardingSessions.currentStep, 'done'))
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
```

**Update pattern** (lines 108-113 of `src/database/queries.ts` — `markMessageProcessed`):
```typescript
export async function updateOnboardingStep(
  sessionId: number,
  nextStep: string,
  collectedData: string | null
): Promise<void> {
  await db
    .update(onboardingSessions)
    .set({ currentStep: nextStep, collectedData, updatedAt: new Date() })
    .where(eq(onboardingSessions.id, sessionId));
}
```

---

### `src/telegram/client.ts` (modify — add `callTelegramApiDirect` and helpers)

**Analog:** existing `callTelegramApi` function (lines 22-51 of `src/telegram/client.ts`)

**Pattern:** Mirror `callTelegramApi` exactly but accept an explicit `botToken` parameter instead of reading from `botTokenStore`. Never log the token.

**New function signature** — copy structure from `callTelegramApi` (lines 22-51):
```typescript
// callTelegramApi reads token from botTokenStore (lines 23-30):
const botToken = botTokenStore.getStore();
if (!botToken) { throw ... }
const url = `https://api.telegram.org/bot${botToken}/${method}`;
logger.debug({ method }, 'Calling Telegram API');  // logs method, NOT token
```

New `callTelegramApiDirect` follows the same pattern but takes `botToken` as param. The fetch/parse/throw body is identical (lines 33-51).

---

### `src/database/schema.ts` (modify — add `onboardingSessions` table)

**Analog:** existing `telegramUpdates` table definition (lines 184-192) and `clientBusinessRelationships` table (lines 58-74) for the `uniqueIndex` pattern.

**Nullable column comment pattern** (lines 17-43 of `src/database/schema.ts`):
```typescript
// Phase 5 (nullable — <reason>): <description>. Never logged.
columnName: text('column_name'),
```

**Table with uniqueIndex pattern** (lines 58-74):
```typescript
export const onboardingSessions = pgTable('onboarding_sessions', {
  id: serial('id').primaryKey(),
  businessId: integer('business_id').notNull().references(() => businesses.id),
  currentStep: text('current_step').notNull(),
  collectedData: text('collected_data'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
},
(table) => [
  uniqueIndex('unique_onboarding_session_per_business').on(table.businessId),
]);
```

---

### `src/config.ts` (modify — add `PLATFORM_BOT_TOKEN`, `PLATFORM_WEBHOOK_SECRET`, `WEBHOOK_BASE_URL`)

**Analog:** `src/config.ts` lines 19-51 (EnvSchema) and 44-51 (optional TEST_BOT_* vars)

**Add to EnvSchema** — follow the `z.string().min(1)` pattern for required, `z.string().optional()` for optional:
```typescript
// Phase 5 (D-01): platform onboarding bot token and webhook HMAC secret.
// These are the only remaining global bot env vars; all per-business tokens are DB-driven.
PLATFORM_BOT_TOKEN: z.string().min(1),
PLATFORM_WEBHOOK_SECRET: z.string().min(1),
// Base URL for constructing setWebhook URLs (e.g. https://randevuclaw.fly.dev)
WEBHOOK_BASE_URL: z.string().min(1),
```

**Add to Config interface** (lines 53-72 pattern):
```typescript
platformBotToken: string;
platformWebhookSecret: string;
webhookBaseUrl: string;
```

**Remove from EnvSchema** — `TEST_BOT_1_TOKEN`, `TEST_BOT_1_WEBHOOK_SECRET`, `TEST_BOT_1_WEBHOOK_ID`, and the `_2` variants (D-10 / ONB-04 cleanup).

---

### `src/server.ts` (modify — register platform route BEFORE dynamic router)

**Analog:** `src/server.ts` lines 12-13 (existing route registration order)

**Critical ordering pattern** (lines 12-13):
```typescript
// CURRENT (must change):
app.use('/webhooks/whatsapp', webhookRouter);
app.use('/webhooks/telegram', telegramWebhookRouter);

// AFTER Phase 5 (platform route declared FIRST, at top-level app, before use()):
import { handlePlatformBotWebhook } from './webhooks/platform';
// ...
app.post('/webhooks/telegram/platform', express.json(), handlePlatformBotWebhook);
app.use('/webhooks/telegram', telegramWebhookRouter);
```

---

### `migrations/0004_phase5_onboarding.sql` (new migration)

**Analog:** existing migration files in `migrations/` directory

**Pattern from RESEARCH.md Pattern 6** — CREATE TABLE + unique index + GRANT:
```sql
CREATE TABLE onboarding_sessions (
  id          SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  current_step TEXT    NOT NULL,
  collected_data TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX unique_onboarding_session_per_business
  ON onboarding_sessions (business_id);
GRANT SELECT, INSERT, UPDATE ON onboarding_sessions TO randevuclaw_app;
```

---

### `tests/helpers/test-business.ts` (new utility for tests)

**Analog:** `src/database/seed.ts` lines 32-160 (FIXTURES + seed logic) and `src/database/queries.ts` insert pattern

**Imports pattern** (from `src/database/seed.ts` lines 1-6):
```typescript
import { db } from '../../src/database/db';
import { businesses, services, businessHours } from '../../src/database/schema';
import crypto from 'crypto';
```

**Insert + returning pattern** (from `src/database/queries.ts` lines 87-106):
```typescript
const rows = await db
  .insert(businesses)
  .values({ ... })
  .returning();
const business = rows[0];
```

**Hours rows pattern** (from `src/database/seed.ts` HOURS_FIXTURES lines 73-90):
```typescript
// Closed days still get a row with isClosed: true, openTime: '00:00', closeTime: '00:00'
// so findBusinessHoursForDay always finds a row for every dayOfWeek 0-6
const hourRows = [0,1,2,3,4,5,6].map((day) => ({
  businessId: business.id,
  dayOfWeek: day,
  openTime: day === 0 ? '00:00' : '09:00',
  closeTime: day === 0 ? '00:00' : '18:00',
  isClosed: day === 0,
}));
await db.insert(businessHours).values(hourRows);
```

---

### `tests/onboarding-platform.test.ts` (new integration test)

**Analog:** `tests/telegram-webhook.test.ts`

**Imports + mocks pattern** (lines 1-16 of `tests/telegram-webhook.test.ts`):
```typescript
import request from 'supertest';
import app from '../src/server';
import * as queries from '../src/database/queries';
import * as telegramClient from '../src/telegram/client';
import * as registryModule from '../src/telegram/registry';

jest.mock('../src/database/queries');
jest.mock('../src/telegram/client');
jest.mock('../src/telegram/registry');
```
Additionally mock `callTelegramApiDirect` for `getMe` and `setWebhook` via `jest.spyOn` (D-13).

**Request helper pattern** (from `tests/telegram-webhook.test.ts` — tests use supertest with the secret header):
```typescript
const SECRET = 'test-platform-webhook-secret'; // matches PLATFORM_WEBHOOK_SECRET in jest.setup.ts
await request(app)
  .post('/webhooks/telegram/platform')
  .set('x-telegram-bot-api-secret-token', SECRET)
  .send({ update_id: 1, message: { ... } })
  .expect(200);
```

**KNOWN_BUSINESS shape** (lines 21-34 of `tests/telegram-webhook.test.ts`):
```typescript
// Platform test: no KNOWN_BUSINESS needed at start — the test simulates a new owner
// DM-ing their bot token. Mock findBusinessByOwnerTelegramId to return null for new owner.
```

---

### `tests/onboarding-flow.test.ts` (new state machine unit test)

**Analog:** `tests/conversation-router.test.ts` (state machine dispatch pattern)

**Pattern:** Unit tests for `dispatchOnboardingStep` — mock DB queries, call the function directly with a fake session object, assert DB write calls and `sendTelegramMessage` calls.

**Mock setup pattern** (from `tests/telegram-webhook.test.ts` lines 51-80 — typed mocks):
```typescript
const mockedUpdateOnboardingStep = onboardingQueries.updateOnboardingStep as jest.MockedFunction<
  typeof onboardingQueries.updateOnboardingStep
>;
mockedUpdateOnboardingStep.mockResolvedValue(undefined);
```

**beforeEach / afterEach pattern** (from `tests/telegram-webhook.test.ts`):
```typescript
beforeEach(() => {
  jest.clearAllMocks();
  clearBotRegistry(); // from src/telegram/registry
});
```

---

## Shared Patterns

### HMAC Webhook Verification
**Source:** `src/webhooks/telegram.ts` lines 205-223
**Apply to:** `src/webhooks/platform.ts`
```typescript
const rawHeader = req.headers['x-telegram-bot-api-secret-token'];
const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
const headerBuffer = Buffer.from(headerValue ?? '');
const secretBuffer = Buffer.from(config.PLATFORM_WEBHOOK_SECRET);
let secretValid: boolean;
try {
  secretValid = crypto.timingSafeEqual(headerBuffer, secretBuffer);
} catch {
  secretValid = false;
}
```

### Always-200 Try/Finally
**Source:** `src/webhooks/telegram.ts` lines 182-291
**Apply to:** `src/webhooks/platform.ts`
```typescript
try {
  // all handler logic
  res.status(200).send('OK');
} catch (err) {
  logger.error({ err }, 'Platform bot webhook handler failed');
} finally {
  if (!res.headersSent) res.status(200).send('OK');
}
```

### Drizzle Admin DB Direct (no RLS)
**Source:** `src/database/queries.ts` lines 63-70 (`findBusinessByWebhookId` uses `db` not `getConn()`)
**Apply to:** All functions in `src/onboarding/queries.ts`
```typescript
// Platform bot handler uses admin db (bypasses businesses SELECT RLS)
// because businessId is not yet known / platform bot is cross-tenant
const rows = await db.select().from(...).where(...);
```

### Structured Logging (method not secret)
**Source:** `src/telegram/client.ts` line 31
**Apply to:** `callTelegramApiDirect` in `src/telegram/client.ts`, all platform handler log calls
```typescript
logger.debug({ method }, 'Calling Telegram API');  // logs 'method', never 'botToken'
```

### clearBotRegistry in afterEach
**Source:** `src/telegram/registry.ts` lines 36-40
**Apply to:** `tests/onboarding-platform.test.ts`, `tests/onboarding-flow.test.ts`
```typescript
afterEach(() => {
  clearBotRegistry();
  jest.clearAllMocks();
});
```

### Schema Nullable Column Comment
**Source:** `src/database/schema.ts` lines 19-43
**Apply to:** Any new nullable columns added to `businesses` in Phase 5 (if any)
```typescript
// Phase 5 (nullable — <table non-empty reason>): <description>.
columnName: text('column_name'),
```

### jest.setup.ts Placeholder Pattern
**Source:** `tests/jest.setup.ts` lines 6-27
**Apply to:** New env vars (`PLATFORM_BOT_TOKEN`, `PLATFORM_WEBHOOK_SECRET`, `WEBHOOK_BASE_URL`) added to `tests/jest.setup.ts`
```typescript
process.env.PLATFORM_BOT_TOKEN ??= 'test-platform-bot-token';
process.env.PLATFORM_WEBHOOK_SECRET ??= 'test-platform-webhook-secret';
process.env.WEBHOOK_BASE_URL ??= 'https://test.example.com';
```

---

## No Analog Found

All files have strong codebase analogs. No files require falling back to RESEARCH.md-only patterns.

---

## Metadata

**Analog search scope:** `src/webhooks/`, `src/database/`, `src/telegram/`, `src/conversation/`, `src/server.ts`, `src/config.ts`, `tests/`
**Files scanned:** 27 source + 27 test files
**Pattern extraction date:** 2026-07-14
