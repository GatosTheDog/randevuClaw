---
phase: "04"
plan: "01"
subsystem: database-schema-config
status: complete
tags: [schema, config, rls, migration, drizzle, postgresql]
dependency_graph:
  requires: []
  provides:
    - businesses.botToken (nullable Drizzle column)
    - businesses.webhookId (nullable UNIQUE Drizzle column)
    - businesses.webhookSecret (nullable Drizzle column)
    - appDb (Drizzle client for randevuclaw_app role)
    - appPool (pg.Pool backing appDb)
    - config.databaseAppUrl (optional)
    - migrations/0003_phase4_per_bot.sql (RLS infrastructure SQL)
  affects:
    - src/telegram/client.ts (bridge: uses process.env.TELEGRAM_BOT_TOKEN)
    - src/webhooks/telegram.ts (bridge: uses process.env.TELEGRAM_WEBHOOK_SECRET)
    - src/utils/logger.ts (redact paths updated)
    - tests/config.test.ts (assertions updated)
tech_stack:
  added: []
  patterns:
    - Nullable column convention for multi-phase schema evolution
    - Dual Drizzle client pattern (superuser db + app-role appDb)
    - Idempotent SQL migration with DO $$ ... END $$ guards
key_files:
  created:
    - migrations/0003_phase4_per_bot.sql
  modified:
    - src/database/schema.ts
    - src/database/db.ts
    - src/config.ts
    - src/telegram/client.ts
    - src/webhooks/telegram.ts
    - src/utils/logger.ts
    - tests/config.test.ts
decisions:
  - "D-07: Three columns nullable (not NOT NULL) — follows Phase 2/3 convention for adding columns to non-empty tables"
  - "D-08: telegramBotToken and telegramWebhookSecret removed from config; bridged via process.env in client.ts and telegram.ts until Plan 04-02 per-bot routing"
  - "D-11: appDb falls back to databaseUrl when DATABASE_APP_URL unset — keeps tests and dev env working without randevuclaw_app role"
  - "D-12: telegram_updates excluded from RLS — nullable business_id makes FOR ALL INSERT policy incompatible with dedup-INSERT flow"
  - "Local randevuclaw_test DB: applied column additions via psql directly (bot_token, webhook_id, webhook_secret) to keep booking-queries integration tests passing"
metrics:
  duration_min: 8
  completed_date: "2026-07-10"
  tasks: 2
  files_changed: 7
---

# Phase 04 Plan 01: Per-Bot Schema Foundation Summary

**One-liner:** RLS migration SQL with idempotent DO-block CREATE ROLE/POLICY guards, three nullable businesses columns for per-bot routing, dual Drizzle db/appDb client pattern, and global Telegram config removal with process.env bridge.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Create RLS migration SQL | 19430ef | migrations/0003_phase4_per_bot.sql |
| 2 | Patch schema.ts + db.ts + config.ts + rule-3 deviations | 1875dda | 7 files |

## What Was Built

### Task 1: migrations/0003_phase4_per_bot.sql

Raw SQL migration for RLS infrastructure (not drizzle-kit generated):

- **Section 1 — CREATE ROLE randevuclaw_app:** Wrapped in idempotent `DO $$ IF NOT EXISTS (SELECT FROM pg_roles ...) THEN CREATE ROLE ...; END IF; END $$` block. Password placeholder `CHANGE_ME_USE_FLY_SECRETS` requires explicit substitution before applying to live DB.
- **Section 2 — ENABLE ROW LEVEL SECURITY:** Applied to 7 tables: messages, bookings, services, business_hours, client_business_relationships, conversation_turns, businesses. `telegram_updates` excluded — its nullable `business_id` makes the INSERT path incompatible with strict FOR ALL policies.
- **Section 3 — FOR ALL policies:** One policy per table, wrapped in idempotent DO blocks. Six tables use `business_id = current_setting('app.current_business_id', true)::INTEGER`. The businesses table uses `id = current_setting(...)` (businesses IS the identity table).
- **Section 4 — GRANT statements:** SELECT/INSERT/UPDATE/DELETE on six business-scoped tables. SELECT/UPDATE only on businesses (INSERT/DELETE remain superuser-only in Phase 4).

Verification: `grep -c 'ENABLE ROW LEVEL SECURITY'` = 7, `grep -c 'CREATE POLICY'` = 8 (including the idempotency comment line).

### Task 2: TypeScript Patches

**src/database/schema.ts:** Added three nullable columns to businesses after agendaSentDate, following Phase 2/3 convention:
- `botToken: text('bot_token')` — per-bot Telegram token, never logged
- `webhookId: text('webhook_id').unique()` — UUID routing path, no token in URL/logs
- `webhookSecret: text('webhook_secret')` — per-bot HMAC secret for timingSafeEqual (Plan 04-02)

**src/database/db.ts:** Exported `appPool` and `appDb` alongside existing `pool`/`db`. `appPool` uses `config.databaseAppUrl ?? config.databaseUrl` — falls back to superuser connection if DATABASE_APP_URL unset, keeping dev/test workflows working without the randevuclaw_app role.

**src/config.ts:**
- Removed `TELEGRAM_BOT_TOKEN: z.string().min(1)` and `TELEGRAM_WEBHOOK_SECRET: z.string().min(1)` from EnvSchema (D-08)
- Removed `telegramBotToken: string` and `telegramWebhookSecret: string` from Config interface
- Added `DATABASE_APP_URL: z.string().optional()` and six `TEST_BOT_*` optional vars (D-09, D-11)
- Added `databaseAppUrl?: string` to Config interface

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] src/telegram/client.ts used config.telegramBotToken**
- **Found during:** Task 2 (removing telegramBotToken from config)
- **Issue:** `src/telegram/client.ts` references `config.telegramBotToken` in `callTelegramApi` — TypeScript fails after removing the property from Config
- **Fix:** Removed config import from client.ts; replaced `config.telegramBotToken` with `process.env.TELEGRAM_BOT_TOKEN ?? ''` as a documented bridge. Comment explains Plan 04-02 replaces this with per-bot token routing.
- **Files modified:** src/telegram/client.ts
- **Commit:** 1875dda

**2. [Rule 3 - Blocking] src/webhooks/telegram.ts used config.telegramWebhookSecret**
- **Found during:** Task 2 (removing telegramWebhookSecret from config)
- **Issue:** `handleTelegramWebhookPost` calls `verifyTelegramSecretToken(headerValue, config.telegramWebhookSecret)` — TypeScript fails after removing the property
- **Fix:** Removed config import from telegram.ts; replaced `config.telegramWebhookSecret` with `process.env.TELEGRAM_WEBHOOK_SECRET ?? ''`. Bridge maintained via jest.setup.ts which still sets `TELEGRAM_WEBHOOK_SECRET ??= 'test-telegram-webhook-secret'`, keeping all existing webhook tests (including Test 4: 403 on wrong secret) passing. Plan 04-02 replaces this with per-bot DB lookup + `crypto.timingSafeEqual`.
- **Files modified:** src/webhooks/telegram.ts
- **Commit:** 1875dda

**3. [Rule 3 - Blocking] tests/config.test.ts asserted telegramBotToken and telegramWebhookSecret on config**
- **Found during:** Task 2 (running config tests after removing fields)
- **Issue:** Test 1 set `TELEGRAM_BOT_TOKEN`/`TELEGRAM_WEBHOOK_SECRET` env vars and asserted `config.telegramBotToken`/`config.telegramWebhookSecret` — both now absent from config
- **Fix:** Updated Test 1 to omit those env var assignments and to assert that `config.telegramBotToken` and `config.telegramWebhookSecret` are `undefined`. Added assertion that `config.databaseAppUrl` is `undefined` when `DATABASE_APP_URL` is unset.
- **Files modified:** tests/config.test.ts
- **Commit:** 1875dda

**4. [Rule 2 - Security] src/utils/logger.ts redact paths lacked botToken and webhookSecret**
- **Found during:** Task 2 (threat model T-04-01 review)
- **Issue:** Pino's redact paths still contained old `telegramBotToken`/`telegramWebhookSecret` but did not include `botToken` and `webhookSecret` — the new per-bot column names. An accidental `logger.info({ business })` would expose credentials.
- **Fix:** Replaced `telegramBotToken`/`telegramWebhookSecret` with `botToken`/`webhookSecret` and added `databaseAppUrl` at all three redaction levels (field, `*.field`, `config.field`). Also added `databaseAppUrl` to the redact list (DATABASE_APP_URL contains a password per T-04-03).
- **Files modified:** src/utils/logger.ts
- **Commit:** 1875dda

**5. [Rule 3 - Blocking] Local randevuclaw_test DB missing new schema columns**
- **Found during:** Task 2 (running full test suite — booking-queries.test.ts failed)
- **Issue:** `booking-queries.test.ts` runs against a real local Postgres DB. Drizzle's INSERT includes all schema columns; the test DB had no `bot_token`/`webhook_id`/`webhook_secret` columns.
- **Fix:** Applied column DDL directly via psql (following Phase 3 precedent of keeping local test DB in schema parity): `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS bot_token TEXT`, `webhook_id TEXT`, `webhook_secret TEXT`; added UNIQUE constraint on webhook_id.
- **Note:** The 0003 migration SQL intentionally excludes column DDL (handled by drizzle-kit push per plan). This psql addition mirrors what drizzle-kit push will do on the live Neon DB during Plan 04-05 blocking task.

### Pre-existing Test Failures (Out of Scope)

`tests/scheduler-agenda.test.ts` had 5 failing tests before Plan 04-01 began (confirmed via `git stash` baseline check). These failures are unrelated to this plan's changes and are logged in `deferred-items.md`.

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | EXIT 0 |
| `npm test --testPathPattern=config` | 4/4 PASS |
| ENABLE ROW LEVEL SECURITY count | 7 |
| CREATE POLICY count | 8 (>= 7 required) |
| appDb references in db.ts | 3 (>= 2 required) |
| schema.ts has botToken, webhookId (.unique()), webhookSecret | PASS |
| config.ts has no required TELEGRAM_* vars | PASS |
| config.ts has databaseAppUrl optional | PASS |
| Full test suite | 203/208 passing (5 pre-existing failures) |

## Known Stubs

None. The migration SQL has `CHANGE_ME_USE_FLY_SECRETS` as the role password placeholder — this is intentional and documented (requires explicit substitution before applying to live DB). It is not a stub that prevents the plan's goal; it is an operator instruction.

## Threat Flags

No new threat surface beyond what was specified in the plan's threat model. The `bot_token` column is added to pino redact paths at all levels (T-04-01 mitigation).

## Self-Check: PASSED

- `/Users/manolis/Documents/RandevuClaw/migrations/0003_phase4_per_bot.sql` — FOUND
- `/Users/manolis/Documents/RandevuClaw/src/database/schema.ts` — FOUND (botToken, webhookId, webhookSecret confirmed)
- `/Users/manolis/Documents/RandevuClaw/src/database/db.ts` — FOUND (appPool, appDb confirmed)
- `/Users/manolis/Documents/RandevuClaw/src/config.ts` — FOUND (databaseAppUrl confirmed, Telegram vars removed)
- Commits 19430ef and 1875dda — verified in git log
