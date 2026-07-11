---
phase: 04-per-bot-foundation
plan: "03"
subsystem: database
tags: [async-local-storage, drizzle, rls, postgresql, typescript, telegram]

requires:
  - phase: 04-01
    provides: appDb exported from db.ts; businesses table with botToken/webhookId/webhookSecret columns; config.ts telegramBotToken/telegramWebhookSecret removed
  - phase: 04-02
    provides: Business interface context; TEST_BOT_* env vars; TELEGRAM_BOT_TOKEN removed from jest.setup.ts

provides:
  - withBusinessContext(businessId, callback) in queries.ts — opens appDb transaction, SET LOCAL RLS context, AsyncLocalStorage tx threading
  - findBusinessByWebhookId(webhookId) in queries.ts — pre-auth routing lookup using admin db
  - getConn() module-private helper in queries.ts — returns RLS tx inside withBusinessContext, admin db outside
  - currentTx AsyncLocalStorage in queries.ts — threads appDb transaction through all getConn() calls
  - botTokenStore AsyncLocalStorage<string> export in client.ts — per-request bot token for callTelegramApi
  - Business interface updated with botToken/webhookId/webhookSecret fields
  - 26 conversation-path query functions converted to getConn() (RLS-enforced)

affects:
  - 04-04 (webhook handler: imports withBusinessContext and findBusinessByWebhookId; wraps handler in botTokenStore.run + withBusinessContext)
  - 04-05 (rls-enforcement.test.ts verifies SET LOCAL does not leak across transactions — T-04-06)

tech-stack:
  added: []
  patterns:
    - AsyncLocalStorage tx threading — currentTx.run(tx, callback) passes the Drizzle transaction to all getConn() calls within the callback without changing function signatures
    - getConn() dispatch — two-tier: RLS-enforced appDb tx for conversation path, admin db fallback for pollers/routing
    - withBusinessContext isolation — SET LOCAL (transaction-scoped) prevents RLS context from leaking via connection pool reuse
    - botTokenStore dispatch — AsyncLocalStorage<string> for per-request bot token; empty string outside webhook context (Telegram rejects but URL stays well-formed)

key-files:
  created: []
  modified:
    - src/database/queries.ts
    - src/telegram/client.ts
    - tests/ai-agent.test.ts
    - tests/calendar-poller.test.ts
    - tests/calendar-sync.test.ts
    - tests/consent.test.ts
    - tests/conversation-router.test.ts
    - tests/expiry-poller.test.ts
    - tests/function-executor.test.ts
    - tests/idempotency.test.ts
    - tests/scheduler-agenda.test.ts
    - tests/telegram-webhook.test.ts
    - tests/webhook.test.ts

key-decisions:
  - "getConn() dispatch: conversation-path queries use getConn() (26 functions), pollers/cross-tenant keep explicit admin db (15 functions) — cleanly separates RLS-enforced from intentionally unscoped paths"
  - "withBusinessContext uses appDb.transaction + SET LOCAL (transaction-scoped) per D-10 — session-level SET is forbidden to prevent RLS context leakage via connection pool reuse"
  - "findBusinessByWebhookId uses explicit admin db (not getConn()) — pre-auth lookup happens before businessId is known so appDb RLS would block it"
  - "botTokenStore fallback is empty string (not an error) — outside webhook context callTelegramApi gets 401 from Telegram but URL stays well-formed, keeping all 5 send-path tests green"
  - "Business interface extended with botToken/webhookId/webhookSecret nullable fields — 11 test files updated to add null values for new fields in fixture objects"

patterns-established:
  - "AsyncLocalStorage tx threading: currentTx.run(tx as unknown as typeof db, callback) — cast needed because Drizzle tx type differs from db type but has identical query methods"
  - "Pre-auth admin bypass: explicit `db` (not getConn()) for any lookup that runs before withBusinessContext is entered"
  - "Poller admin bypass: explicit `db` for all cross-tenant pollers — these need to read across all businesses, not just the current RLS-scoped one"

requirements-completed:
  - BOT-02
  - BOT-05

coverage:
  - id: D1
    description: "withBusinessContext and findBusinessByWebhookId exported from queries.ts; currentTx AsyncLocalStorage threads appDb tx through getConn() calls"
    requirement: BOT-05
    verification:
      - kind: unit
        ref: "grep -c withBusinessContext src/database/queries.ts >= 1; grep -c getConn() >= 26; npm test (203/208 baseline)"
        status: pass
    human_judgment: false
  - id: D2
    description: "botTokenStore exported from client.ts; callTelegramApi reads from AsyncLocalStorage; config import removed"
    requirement: BOT-02
    verification:
      - kind: unit
        ref: "tests/telegram-client.test.ts (all 5 tests pass without changes to test file — D-02)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Business interface updated with botToken/webhookId/webhookSecret fields; all 11 affected test files updated"
    requirement: BOT-05
    verification:
      - kind: unit
        ref: "npx tsc --noEmit exits 0; npm test 203/208 passing (5 pre-existing scheduler-agenda failures)"
        status: pass
    human_judgment: false

duration: 8min
completed: "2026-07-11"
status: complete
---

# Phase 04 Plan 03: AsyncLocalStorage RLS Context + botTokenStore Summary

**AsyncLocalStorage tx threading for per-transaction RLS context via withBusinessContext, botTokenStore per-request token dispatch in Telegram client — core infrastructure for BOT-05 RLS enforcement**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-11T00:47:16Z
- **Completed:** 2026-07-11T00:55:00Z
- **Tasks:** 2
- **Files modified:** 13 (queries.ts, client.ts modified; 11 test files updated for Business interface)

## Accomplishments

- Added `withBusinessContext(businessId, callback)` to queries.ts — opens appDb.transaction, executes SET LOCAL app.current_business_id (transaction-scoped, D-10), threads the tx via AsyncLocalStorage so all getConn() calls inside the callback use the RLS-enforced connection
- Added `findBusinessByWebhookId(webhookId)` to queries.ts — pre-auth routing lookup that uses admin db explicitly (bypasses businesses SELECT RLS because businessId is not yet known at call site)
- Converted 26 conversation-path query functions from `db.*` to `getConn().*`; kept 15 poller/cross-tenant functions on explicit admin db
- Extended Business interface with `botToken`, `webhookId`, `webhookSecret` (all `string | null`) per D-07
- Added `botTokenStore = new AsyncLocalStorage<string>()` to client.ts; `callTelegramApi` now reads per-request token from store instead of global env var bridge — all 5 send-path tests pass unchanged (D-02 honored)

## Task Commits

1. **Task 1: Refactor src/database/queries.ts** - `769002b` (feat)
2. **Task 2: Patch src/telegram/client.ts** - `9618f2a` (feat)

## Files Created/Modified

- `src/database/queries.ts` — AsyncLocalStorage currentTx + getConn(); withBusinessContext + findBusinessByWebhookId exports; Business interface +3 fields; 26 conversation-path functions use getConn()
- `src/telegram/client.ts` — botTokenStore AsyncLocalStorage export; callTelegramApi reads from store; process.env bridge removed; config import removed
- `tests/ai-agent.test.ts` — Business fixture: added botToken/webhookId/webhookSecret null fields
- `tests/calendar-poller.test.ts` — Business fixture: added botToken/webhookId/webhookSecret null fields
- `tests/calendar-sync.test.ts` — Business fixture: added botToken/webhookId/webhookSecret null fields
- `tests/consent.test.ts` — Business fixture (inline): added botToken/webhookId/webhookSecret null fields
- `tests/conversation-router.test.ts` — Business fixture: added botToken/webhookId/webhookSecret null fields
- `tests/expiry-poller.test.ts` — Business fixture: added botToken/webhookId/webhookSecret null fields
- `tests/function-executor.test.ts` — Business fixture: added botToken/webhookId/webhookSecret null fields
- `tests/idempotency.test.ts` — Business fixture (inline): added botToken/webhookId/webhookSecret null fields
- `tests/scheduler-agenda.test.ts` — Business fixture (factory): added botToken/webhookId/webhookSecret null fields
- `tests/telegram-webhook.test.ts` — Two Business fixtures: added botToken/webhookId/webhookSecret null fields
- `tests/webhook.test.ts` — Business fixture (inline mock): added botToken/webhookId/webhookSecret null fields

## Decisions Made

- **getConn() dispatch boundary:** 26 conversation-path functions use getConn() (RLS enforced when inside withBusinessContext); 15 poller/cross-tenant functions keep explicit admin db. The boundary maps cleanly to "called from webhook handler" vs "called from scheduled poller" — no judgment calls needed at implementation time.
- **botTokenStore empty-string fallback:** `botTokenStore.getStore() ?? ''` produces an empty token outside webhook context. Telegram rejects the call with 401 but the URL is still well-formed, which is why the 5 send-path tests (which mock fetch) pass without changes.
- **Business interface change requires test fixture updates:** Adding 3 required `string | null` fields to Business caused TypeScript compilation failures in 11 test files. Applied as Rule 3 (blocking issue — tests couldn't compile). All fixtures updated with null values.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated 11 test files for Business interface change**
- **Found during:** Task 1 (running `npm test` after updating Business interface)
- **Issue:** Adding `botToken`, `webhookId`, `webhookSecret` fields to the Business interface caused TypeScript compilation errors in 11 test files — test fixture objects were missing the new required fields, causing "missing properties from type 'Business'" TS2345 errors
- **Fix:** Added `botToken: null, webhookId: null, webhookSecret: null` to all Business fixture objects across 11 test files (multi-line fixtures) and 2 inline single-line fixtures
- **Files modified:** tests/ai-agent.test.ts, tests/calendar-poller.test.ts, tests/calendar-sync.test.ts, tests/consent.test.ts, tests/conversation-router.test.ts, tests/expiry-poller.test.ts, tests/function-executor.test.ts, tests/idempotency.test.ts, tests/scheduler-agenda.test.ts, tests/telegram-webhook.test.ts, tests/webhook.test.ts
- **Verification:** `npx tsc --noEmit` exits 0; `npm test` 203/208 passing (5 pre-existing scheduler-agenda failures)
- **Committed in:** 769002b (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking TypeScript compilation failure)
**Impact on plan:** The Business interface extension is the planned change (D-07, PART C) — updating test fixtures is the necessary downstream effect. No scope creep.

## Issues Encountered

- Pre-existing 5 scheduler-agenda test failures persist (time-dependent, fail before 08:00 Athens time). Confirmed same baseline as Plans 04-01 and 04-02.

## Known Stubs

None — both modified files wire real logic. withBusinessContext executes real SET LOCAL in appDb transactions. botTokenStore reads real per-request tokens. No placeholders.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: rls_context | src/database/queries.ts | withBusinessContext uses SET LOCAL (transaction-scoped) per T-04-06 — prevents session-level RLS context leakage. Plan 04-05 rls-enforcement.test.ts must verify context does NOT leak across transactions. |
| threat_flag: token_in_url | src/telegram/client.ts | botToken appears in Telegram API URL — mitigated by T-04-08: logger.debug logs only {method}, not URL; outside context gives empty string (no real token exposed). |

## Next Phase Readiness

- `withBusinessContext` and `findBusinessByWebhookId` ready for Plan 04-04 webhook handler refactor
- `botTokenStore` ready for Plan 04-04 to wrap handler in `botTokenStore.run(business.botToken, ...)`
- Business interface now includes `botToken` field — Plan 04-04 webhook handler can read `business.botToken` directly
- Plan 04-05 RLS enforcement tests can now import and use `withBusinessContext` to set up test transactions

---
*Phase: 04-per-bot-foundation*
*Completed: 2026-07-11*

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/database/queries.ts | FOUND |
| src/telegram/client.ts | FOUND |
| withBusinessContext export | FOUND |
| findBusinessByWebhookId export | FOUND |
| botTokenStore export | FOUND |
| Task 1 commit 769002b | FOUND |
| Task 2 commit 9618f2a | FOUND |
| 04-03-SUMMARY.md | FOUND (this file) |
