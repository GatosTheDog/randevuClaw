---
phase: "04"
plan: "04"
subsystem: webhook-routing
status: complete
tags:
  - webhook
  - telegram
  - per-bot
  - hmac
  - seed
dependency_graph:
  requires:
    - "04-01"
    - "04-02"
    - "04-03"
  provides:
    - per-bot-webhook-handler
    - bot-credential-seed
  affects:
    - src/webhooks/telegram.ts
    - src/database/seed.ts
tech_stack:
  added:
    - "crypto (Node.js built-in — timingSafeEqual for HMAC verification)"
  patterns:
    - "AsyncLocalStorage for per-request bot token context (botTokenStore)"
    - "AsyncLocalStorage for per-request RLS context (withBusinessContext)"
    - "Telegraf as webhook adapter — handleUpdate() called per request, no bot.launch()"
    - "Pre-auth admin DB lookup (findBusinessByWebhookId) before withBusinessContext"
key_files:
  created: []
  modified:
    - src/webhooks/telegram.ts
    - src/database/seed.ts
    - tests/fixtures.test.ts
decisions:
  - "[Phase 04-04]: verifyTelegramSecretToken (string-equality) removed; replaced inline with crypto.timingSafeEqual (D-06/T-04-10)"
  - "[Phase 04-04]: bot.handleUpdate() called before explicit dispatch in handleTelegramWebhookPost — Telegraf validates update structure as webhook adapter (D-03/BOT-04)"
  - "[Phase 04-04]: Rule 1 auto-fix: fixtures.test.ts update count updated 4→8 to account for bot credential backfill calls when TEST_BOT_* env vars are set (jest.setup.ts)"
metrics:
  duration_min: 8
  completed_date: "2026-07-11"
  tasks_completed: 2
  files_changed: 3
---

# Phase 04 Plan 04: Webhook Handler & Seed Patch Summary

Per-bot webhook routing with HMAC verification and seed bot credential backfill — brings together the registry (04-02), query layer (04-03), and schema (04-01) into a working authenticated endpoint.

## What Was Built

### Task 1: Refactored src/webhooks/telegram.ts — per-bot routing, HMAC, Telegraf dispatch

Replaced the global-secret-token handler with a fully per-bot webhook pipeline:

- **Route**: `POST /:webhookId` (was `POST /`)
- **Step 1**: Extract `req.params.webhookId` — 400 if absent
- **Step 2**: `findBusinessByWebhookId(webhookId)` lookup (admin DB, pre-auth) — 404 if not found or bot credentials incomplete
- **Step 3**: `crypto.timingSafeEqual` constant-time HMAC verification against `business.webhookSecret` — 401 on mismatch, never logs secret
- **Step 4**: `getOrCreateBotInstance(webhookId, business.botToken)` for Telegraf adapter
- **Step 5**: `botTokenStore.run(business.botToken, ...)` + `withBusinessContext(business.id, ...)` wrap entire pipeline — ensures `callTelegramApi` reads the correct per-request token and all DB ops run under RLS tenant isolation
- **Step 6**: `bot.handleUpdate(update)` (Telegraf webhook adapter, BOT-04) then explicit `handleCallbackQuery` / `handleFoundBusiness` dispatch
- Always 200 to Telegram; try/catch/finally guards against retries

**Removed**: `verifyTelegramSecretToken` (string-equality, replaced by timingSafeEqual inline)

**Preserved unchanged** (D-01): `handleFoundBusiness`, `handleCallbackQuery`, `parseCallbackData` — byte-for-byte identical bodies.

### Task 2: Patched src/database/seed.ts — bot credential backfill

Added idempotent bot credential backfill loop immediately after the `ownerTelegramId` loop:

- Fixture-to-env mapping (D-09): `pilates-athens` → `TEST_BOT_1_*`, all others → `TEST_BOT_2_*`
- Reads `TEST_BOT_{key}_TOKEN`, `TEST_BOT_{key}_WEBHOOK_ID`, `TEST_BOT_{key}_WEBHOOK_SECRET` from `process.env`
- Only runs update if all three are truthy (idempotent; safe to re-run)
- Logs `{ slug, webhookId }` only — never `botToken` or `webhookSecret`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated fixtures.test.ts update call count assertion**
- **Found during:** Task 2 verification (`npm test`)
- **Issue:** `fixtures.test.ts` Test 4 expected exactly 4 `db.update` calls (2 ownerTelegramId per run × 2 runs). With the bot credential backfill loop added, each `seed()` run now makes 4 update calls when `TEST_BOT_*` env vars are set (which `jest.setup.ts` always does). 2 runs = 8 total.
- **Fix:** Updated `toHaveBeenCalledTimes(4)` → `toHaveBeenCalledTimes(8)`; filtered `ownerIdChains` to only assert `{ ownerTelegramId }` on the 4 relevant chains
- **Files modified:** `tests/fixtures.test.ts`
- **Commit:** ad95dc6

**2. [Rule 1 - Bug] Express header type narrowing for x-telegram-bot-api-secret-token**
- **Found during:** Task 1 TypeScript compilation
- **Issue:** `req.headers[...]` returns `string | string[] | undefined`; `Buffer.from` requires `string`. TypeScript emitted TS2345 error.
- **Fix:** Added `Array.isArray(rawHeader) ? rawHeader[0] : rawHeader` coercion before `Buffer.from`
- **Files modified:** `src/webhooks/telegram.ts` (inline fix during initial implementation)

**3. [Rule 1 - Bug] Telegraf Update type cast for bot.handleUpdate()**
- **Found during:** Task 1 TypeScript compilation
- **Issue:** Local `TelegramUpdate` interface is not assignable to Telegraf's `Update` type union. TypeScript emitted TS2345.
- **Fix:** Cast to `any` with eslint-disable comment — local interface is a subset of Telegraf's Update and the cast is safe at runtime
- **Files modified:** `src/webhooks/telegram.ts` (inline fix)

### Pre-existing Failures (Out of Scope)

- `tests/scheduler-agenda.test.ts` — 5 tests failing. Confirmed pre-existing before any Phase 04-04 changes (verified via `git stash` isolation). Logged to deferred-items.
- `tests/telegram-webhook.test.ts` — 17 tests failing. **Expected** per plan: these tests still POST to the old `POST /` route; Plan 04-05 will update them to `POST /:webhookId`.

## Verification Results

- `npx tsc --noEmit`: exits 0 (clean)
- `grep -c 'timingSafeEqual' src/webhooks/telegram.ts`: 2
- `grep -c ':webhookId' src/webhooks/telegram.ts`: 1
- `grep -c 'withBusinessContext' src/webhooks/telegram.ts`: 4
- `grep -c 'botTokenStore' src/webhooks/telegram.ts`: 3
- `grep -c 'TEST_BOT_' src/database/seed.ts`: 4 (≥3 required)
- `npm test -- --testPathPattern=telegram-client`: 5/5 pass (D-02 verified)
- `npm test`: 186 pass, 22 fail (22 = 17 expected telegram-webhook route failures + 5 pre-existing scheduler-agenda; 208 total tests unchanged)

## Threat Mitigations Applied

| Threat ID | Mitigation |
|-----------|-----------|
| T-04-09 | `findBusinessByWebhookId` → 404 on unknown UUID; `timingSafeEqual` → 401 on invalid secret |
| T-04-10 | `crypto.timingSafeEqual` used exclusively; `===` string comparison removed |
| T-04-11 | All `logger.*` calls in new handler use only `{ webhookId, updateId, senderTelegramId, updateType, err }` |
| T-04-12 | `withBusinessContext(business.id, ...)` wraps all DB operations after HMAC passes |

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/webhooks/telegram.ts | FOUND |
| src/database/seed.ts | FOUND |
| 04-04-SUMMARY.md | FOUND |
| Commit b5c73d8 (Task 1) | FOUND |
| Commit ad95dc6 (Task 2) | FOUND |
