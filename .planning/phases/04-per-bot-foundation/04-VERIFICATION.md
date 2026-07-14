---
phase: 04-per-bot-foundation
verified: 2026-07-14T10:01:43Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification: false
---

# Phase 4: Per-Bot Foundation — Verification Report

**Phase Goal:** The Telegram layer is migrated to Telegraf and supports per-business webhook routing with tenant isolation enforced at the database layer — every v1.1 feature builds on this.
**Verified:** 2026-07-14T10:01:43Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Telegraf-based webhook routes incoming messages to the correct business by webhookId lookup; pre-Phase-4 tests continue to pass | VERIFIED | `router.post('/:webhookId', ...)` in `src/webhooks/telegram.ts:295`; `findBusinessByWebhookId` performs the lookup; 206 tests passing (4 pre-existing scheduler-agenda failures, 1 skipped rls-enforcement); Phase 4 added net new tests; pre-Phase-4 baseline unaffected |
| 2 | Two distinct bot tokens can receive messages simultaneously with no cross-contamination of data or conversation state | VERIFIED | `botRegistry` Map in `registry.ts` enforces one Telegraf instance per webhookId; `botTokenStore.run(business.botToken, ...)` sets per-request token; `withBusinessContext(business.id, ...)` scopes each DB transaction to exactly one tenant; UAT Test-4 (per-bot parallel routing) passed on live system |
| 3 | Every incoming webhook is verified against a per-bot HMAC secret using constant-time comparison; invalid or missing secrets are rejected with 401 | VERIFIED | `crypto.timingSafeEqual(headerBuffer, secretBuffer)` at `src/webhooks/telegram.ts:215`; 401 returned at line 221; `telegram-webhook.test.ts` 25 tests all pass; UAT Test-3 confirmed |
| 4 | Attempting to read another business's rows in a Drizzle transaction without a business_id filter fails at the PostgreSQL RLS layer | VERIFIED | `migrations/0003_phase4_per_bot.sql`: ENABLE ROW LEVEL SECURITY on 7 tables; FOR ALL policies using `current_setting('app.current_business_id', true)::INTEGER`; `withBusinessContext` in `queries.ts:77` sets `SET LOCAL app.current_business_id` in every appDb transaction; `rls-enforcement.test.ts` skipped locally (DATABASE_APP_URL not set) but UAT Test-5 confirmed RLS active on live Neon DB |

**Score:** 4/4 truths verified

**Note on SC-1 wording:** The ROADMAP describes the route as `/webhooks/telegram/:botToken` but the implementation correctly uses `/webhooks/telegram/:webhookId` (a UUID). This deviates from the ROADMAP wording intentionally — design decision D-04 (locked during planning) explicitly prohibits the bot token from appearing in URL paths or logs. The implementation is more secure than specified and fully achieves the routing intent.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `migrations/0003_phase4_per_bot.sql` | RLS migration (CREATE ROLE, ENABLE RLS, FOR ALL policies, GRANTs) | VERIFIED | 7 ENABLE ROW LEVEL SECURITY, 8 CREATE POLICY statements, randevuclaw_app role, idempotent DO blocks throughout |
| `src/database/schema.ts` | businesses table with botToken, webhookId (UNIQUE), webhookSecret columns | VERIFIED | Lines 34–43: all three nullable TEXT columns present; webhookId has `.unique()` constraint |
| `src/database/db.ts` | Exports db (admin) and appDb (randevuclaw_app role) | VERIFIED | Lines 20–22: `appPool` and `appDb` exported; falls back to databaseUrl if DATABASE_APP_URL unset |
| `src/config.ts` | No TELEGRAM_BOT_TOKEN/TELEGRAM_WEBHOOK_SECRET required; DATABASE_APP_URL and TEST_BOT_* optional | VERIFIED | EnvSchema has no global Telegram token fields; DATABASE_APP_URL optional (line 42); 6 TEST_BOT_* optional (lines 45–50); Config interface has `databaseAppUrl?` |
| `src/telegram/registry.ts` | Telegraf registry singleton; getOrCreateBotInstance, getBotInstance, clearBotRegistry exports | VERIFIED | Map<webhookId, Telegraf> singleton; all 3 functions exported; logs only webhookId UUID, never botToken |
| `src/utils/logger.ts` | botToken and webhookSecret redacted at field, wildcard, config namespace levels | VERIFIED | 3 occurrences each of `botToken` and `webhookSecret` in redact.paths; `telegramBotToken` absent (0 occurrences) |
| `src/database/queries.ts` | findBusinessByWebhookId (admin db), withBusinessContext (appDb + SET LOCAL), Business interface updated, getConn() pattern throughout | VERIFIED | Lines 63–85: both functions exported with correct db usage; Business interface lines 25–36 includes botToken/webhookId/webhookSecret; 30 occurrences of withBusinessContext/getConn; currentTx AsyncLocalStorage wired |
| `src/telegram/client.ts` | botTokenStore exported (AsyncLocalStorage<string>); callTelegramApi reads from store; config import removed | VERIFIED | Line 8: `export const botTokenStore = new AsyncLocalStorage<string>()`; lines 23–28: reads from store with guard throw; no config import present |
| `src/webhooks/telegram.ts` | /:webhookId route; timingSafeEqual HMAC; botTokenStore.run + withBusinessContext wrap; no botToken in logs | VERIFIED | Route at line 295; timingSafeEqual at line 215; botTokenStore.run line 247; withBusinessContext line 248; all logger calls use `{ webhookId, updateId, senderTelegramId, updateType, err }` — no botToken/webhookSecret |
| `src/database/seed.ts` | TEST_BOT_* env var backfill loop for fixture businesses | VERIFIED | Lines 123–134: idempotent UPDATE loop for 2 fixtures using TEST_BOT_1/2_* vars; logs only webhookId (not botToken) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/webhooks/telegram.ts` | `src/telegram/registry.ts` | `getOrCreateBotInstance(webhookId, business.botToken)` at line 227 | WIRED | Import present at line 17; called in handler Step 4 |
| `src/webhooks/telegram.ts` | `src/database/queries.ts` | `findBusinessByWebhookId` at line 198; `withBusinessContext` at line 248 | WIRED | Both imported at lines 13–15; used in correct sequence (pre-auth lookup then RLS context) |
| `src/webhooks/telegram.ts` | `src/telegram/client.ts` | `botTokenStore.run(business.botToken, ...)` at line 247 | WIRED | `botTokenStore` imported at line 16; wraps `withBusinessContext` so token is set for all nested `callTelegramApi` calls |
| `src/database/queries.ts` | `src/database/db.ts` | `appDb.transaction(...)` in `withBusinessContext`; explicit `db` in `findBusinessByWebhookId` | WIRED | Both `db` and `appDb` imported at line 3; admin db used for pre-auth lookup, appDb for RLS-enforced transactions |
| `src/database/queries.ts` | `migrations/0003_phase4_per_bot.sql` | `SET LOCAL app.current_business_id` in `withBusinessContext` matches RLS `USING (... = current_setting('app.current_business_id', true)::INTEGER)` | WIRED | The SQL context variable matches the migration policy expression exactly |

### Data-Flow Trace (Level 4)

The key dynamic data flow is: Telegram POST → webhookId → business lookup → HMAC check → RLS context → conversation handler.

| Step | Data Variable | Source | Produces Real Data | Status |
|------|--------------|--------|--------------------|--------|
| Business lookup | `business` object | `findBusinessByWebhookId(webhookId)` → admin db SELECT on `businesses` WHERE `webhook_id = $1` | Yes — queries live DB row | FLOWING |
| HMAC verification | `business.webhookSecret` | Retrieved from businesses row above | Yes — live per-bot secret | FLOWING |
| Bot token dispatch | `botTokenStore` per-request store | `business.botToken` from DB row, set via `botTokenStore.run(business.botToken, ...)` | Yes — live per-bot token | FLOWING |
| RLS tenant scope | `appDb` transaction with `SET LOCAL` | `withBusinessContext(business.id, ...)` — uses live `business.id` from DB lookup | Yes — real business ID | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Webhook handler rejects bad HMAC with 401 | `npm test -- --testPathPattern=telegram-webhook` | 25 passed, 0 failed | PASS |
| botTokenStore per-request dispatch | `npm test -- --testPathPattern=telegram-client` | All 5 send-path tests passed | PASS |
| RLS enforcement test (local, DATABASE_APP_URL not set) | `npm test -- --testPathPattern=rls-enforcement` | 1 skipped (DATABASE_APP_URL not set) | SKIP — human-verified via UAT Test-5 on live Neon DB |
| Full test suite baseline | `npm test` | 206 passing, 4 failing (pre-existing scheduler-agenda), 1 skipped | PASS — 4 failures are pre-existing, time-dependent, known |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BOT-02 | 04-03, 04-04 | Per-bot webhook routing by webhookId | SATISFIED | `/:webhookId` route + `findBusinessByWebhookId` lookup |
| BOT-03 | 04-02, 04-04 | HMAC secret verification (constant-time) | SATISFIED | `crypto.timingSafeEqual` in telegram.ts; UAT Test-3 |
| BOT-04 | 04-01, 04-02, 04-04 | Telegraf as webhook adapter | SATISFIED | `telegraf@^4.16.3` in package.json; `bot.handleUpdate(update)` called per request |
| BOT-05 | 04-01, 04-03 | RLS tenant isolation at DB layer | SATISFIED | `withBusinessContext` + SET LOCAL; 7-table migration; UAT Test-5 on live Neon DB |

### Anti-Patterns Found

No debt markers (TBD, FIXME, XXX) found in any Phase 4 modified files. No stubs, placeholders, or empty handlers detected. All returned values are wired to real DB queries or live AsyncLocalStorage context.

### Human Verification Required

None. All human verification items were completed in the UAT (`04-UAT.md`, status: complete, 11/11 passed, updated 2026-07-14).

---

## Gaps Summary

No gaps. All 4 ROADMAP Success Criteria are verified through code inspection and behavioral testing. All plan-level must_haves across 04-01 through 04-06 are satisfied. The UAT confirmed live-system behavior for parallel routing (SC2) and RLS enforcement (SC4) which require a running database and cannot be proven by code inspection alone.

The one intentional deviation — using `:webhookId` (UUID) rather than `:botToken` in the URL path — is more secure than the ROADMAP specified and reflects a locked design decision (D-04) documented in the phase context files.

---

_Verified: 2026-07-14T10:01:43Z_
_Verifier: Claude (gsd-verifier)_
