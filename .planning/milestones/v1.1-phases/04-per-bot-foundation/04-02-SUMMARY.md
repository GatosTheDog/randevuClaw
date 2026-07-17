---
phase: 04-per-bot-foundation
plan: "02"
subsystem: infra
tags: [telegraf, typescript, pino, jest, per-bot-registry]

requires:
  - phase: 04-01
    provides: config.ts with telegramBotToken/telegramWebhookSecret removed; businesses table with bot_token/webhook_id/webhook_secret columns

provides:
  - telegraf@4.16.3 installed
  - src/telegram/registry.ts with Map<webhookId, Telegraf> singleton registry
  - logger.ts botToken/webhookSecret redaction at all three path levels (field, wildcard, config namespace)
  - jest.setup.ts TEST_BOT_1_*/TEST_BOT_2_* baseline env vars via ??= operator

affects:
  - 04-03 (queries refactor imports Business type with botToken/webhookId/webhookSecret)
  - 04-04 (webhook handler imports getOrCreateBotInstance from registry.ts)
  - 04-05 (telegram-webhook.test.ts uses TEST_BOT_1_WEBHOOK_ID / TEST_BOT_2_WEBHOOK_ID)

tech-stack:
  added:
    - telegraf@4.16.3
  patterns:
    - Module-level Map<webhookId, Telegraf> singleton — one Telegraf instance per registered bot (D-03)
    - clearBotRegistry() for test teardown isolation (T-04-05)
    - Pino redact at three levels — field, wildcard, config namespace — for per-bot secret fields

key-files:
  created:
    - src/telegram/registry.ts
  modified:
    - package.json
    - package-lock.json
    - src/utils/logger.ts
    - tests/jest.setup.ts

key-decisions:
  - "TELEGRAM_WEBHOOK_SECRET kept in jest.setup.ts until Plan 04-04 — removing it now breaks 13 webhook tests because telegram.ts:210 still reads process.env.TELEGRAM_WEBHOOK_SECRET as a bridge (D-08); only TELEGRAM_BOT_TOKEN removed"
  - "registry.ts logs only webhookId UUID, never botToken — satisfies STATE.md blocker T-04-04"
  - "Telegraf constructed without bot.launch() — webhook mode only; handler calls .handleUpdate() per D-03"

patterns-established:
  - "Per-bot Telegraf registry: Map<webhookId, Telegraf> with getOrCreateBotInstance / getBotInstance / clearBotRegistry"
  - "Test env var baseline: ??= assign-if-not-set for per-bot vars so tests can override"

requirements-completed:
  - BOT-03
  - BOT-04

coverage:
  - id: D1
    description: "telegraf@4.16.3 installed and src/telegram/registry.ts exports getOrCreateBotInstance, getBotInstance, clearBotRegistry with Map singleton"
    requirement: BOT-04
    verification:
      - kind: unit
        ref: "tests/telegram-client.test.ts (all 5 tests pass after telegraf install)"
        status: pass
    human_judgment: false
  - id: D2
    description: "logger.ts redacts botToken and webhookSecret at field, wildcard, and config namespace levels"
    requirement: BOT-03
    verification:
      - kind: unit
        ref: "grep -c botToken src/utils/logger.ts outputs 3; grep -c webhookSecret outputs 3"
        status: pass
    human_judgment: false
  - id: D3
    description: "jest.setup.ts provides TEST_BOT_1_TOKEN/WEBHOOK_SECRET/WEBHOOK_ID and TEST_BOT_2_* defaults via ??= operator; TELEGRAM_BOT_TOKEN removed"
    requirement: BOT-03
    verification:
      - kind: unit
        ref: "Full test suite: 203/208 (5 pre-existing scheduler-agenda failures unrelated to this plan)"
        status: pass
    human_judgment: false

duration: 73min
completed: "2026-07-11"
status: complete
---

# Phase 04 Plan 02: Telegraf Install + Registry + Logger + Test Env Summary

**Telegraf@4.16.3 installed with Map<webhookId, Telegraf> singleton registry, pino botToken/webhookSecret redaction at all three levels, and per-bot TEST_BOT_* test env defaults**

## Performance

- **Duration:** 73 min
- **Started:** 2026-07-10T23:26:19Z
- **Completed:** 2026-07-11T00:39:19Z
- **Tasks:** 2
- **Files modified:** 5 (registry.ts created; package.json, package-lock.json, logger.ts, jest.setup.ts modified)

## Accomplishments

- Installed telegraf@4.16.3 (official Telegram Bot Framework, Package Legitimacy Audit confirmed in RESEARCH.md)
- Created `src/telegram/registry.ts` with module-level `Map<webhookId, Telegraf>` singleton; exports `getOrCreateBotInstance`, `getBotInstance`, `clearBotRegistry`; logs only webhookId UUID never botToken (T-04-04, D-04)
- Added `config.botToken` and `config.webhookSecret` to pino's config namespace redaction level (field and wildcard levels were already added in Plan 04-01 deviation Rule 2)
- Removed `TELEGRAM_BOT_TOKEN ??=` from jest.setup.ts and added 6 `TEST_BOT_*` defaults for per-bot test infrastructure (D-09)

## Task Commits

1. **Task 1: Install telegraf + create registry.ts** - `e6dceed` (feat)
2. **Task 2: Patch logger.ts + jest.setup.ts** - `62b9814` (feat)

## Files Created/Modified

- `src/telegram/registry.ts` — Module-level `Map<webhookId, Telegraf>` registry; three exports for get-or-create, read-only get, and test teardown clear
- `package.json` — telegraf@4.16.3 added to dependencies
- `package-lock.json` — lockfile updated for telegraf and its transitive deps
- `src/utils/logger.ts` — Added `config.botToken` and `config.webhookSecret` to the config namespace redaction level (line 27)
- `tests/jest.setup.ts` — Removed TELEGRAM_BOT_TOKEN; added TEST_BOT_1_TOKEN, TEST_BOT_1_WEBHOOK_SECRET, TEST_BOT_1_WEBHOOK_ID, TEST_BOT_2_TOKEN, TEST_BOT_2_WEBHOOK_SECRET, TEST_BOT_2_WEBHOOK_ID with ??= defaults

## Decisions Made

- **TELEGRAM_WEBHOOK_SECRET kept in jest.setup.ts:** The plan action said to remove both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`. Removing `TELEGRAM_WEBHOOK_SECRET` broke 13 telegram-webhook tests because `src/webhooks/telegram.ts:210` still reads `process.env.TELEGRAM_WEBHOOK_SECRET ?? ''` as a bridge until Plan 04-04 refactors the webhook handler. Only `TELEGRAM_BOT_TOKEN` was removed — it is safe since config.ts no longer requires it.
- **No `bot.launch()` in registry:** Webhook mode only; `bot.handleUpdate()` is called per request by the webhook handler (Plan 04-04). This follows D-03.
- **Logger warning omitted in getOrCreateBotInstance:** `logger.info` (not `logger.warn`) logged on instance creation — normal first-call behavior, not an error condition.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Kept TELEGRAM_WEBHOOK_SECRET in jest.setup.ts**
- **Found during:** Task 2 (running `npm test` after removing both deprecated env vars)
- **Issue:** Plan action said remove both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`. Removing `TELEGRAM_WEBHOOK_SECRET` caused 13 telegram-webhook tests to return 403 because `telegram.ts:210` falls back to `process.env.TELEGRAM_WEBHOOK_SECRET ?? ''` (empty string) for verification until Plan 04-04 replaces it with per-bot DB lookup + `crypto.timingSafeEqual`
- **Fix:** Restored `process.env.TELEGRAM_WEBHOOK_SECRET ??= 'test-telegram-webhook-secret'` to jest.setup.ts with a comment documenting it will be removed in Plan 04-04
- **Files modified:** tests/jest.setup.ts
- **Verification:** Full test suite: 203/208 passing (5 pre-existing scheduler-agenda failures, all telegram-webhook tests green)
- **Committed in:** 62b9814 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 bug)
**Impact on plan:** TELEGRAM_WEBHOOK_SECRET bridge preserved for Plan 04-04. All other plan actions executed exactly as specified. No scope creep.

## Issues Encountered

- Pre-existing 5 scheduler-agenda test failures (Tests 1, 3, 4, 6, and startAgendaPoller Test 7) are time-dependent — they fail before 08:00 Athens time because `runAgendaSweep()` bails early without calling `listAllBusinessIds`. Confirmed pre-existing per Plan 04-01 SUMMARY.md (203/208 baseline). These are out of scope for this plan.

## Next Phase Readiness

- `src/telegram/registry.ts` is ready for import by Plan 04-03 (queries refactor) and Plan 04-04 (webhook handler refactor)
- logger.ts redaction covers botToken/webhookSecret at all three path levels — `logger.info({ business })` will never leak credentials even if accidentally called
- jest.setup.ts provides TEST_BOT_1_WEBHOOK_ID and TEST_BOT_2_WEBHOOK_ID values that Plan 04-05 telegram-webhook.test.ts will reference in mock setups
- Blocker still active: TELEGRAM_WEBHOOK_SECRET must be removed from jest.setup.ts in Plan 04-04 when per-bot webhook verification is implemented

---
*Phase: 04-per-bot-foundation*
*Completed: 2026-07-11*

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/telegram/registry.ts | FOUND |
| src/utils/logger.ts | FOUND |
| tests/jest.setup.ts | FOUND |
| 04-02-SUMMARY.md | FOUND |
| Task 1 commit e6dceed | FOUND |
| Task 2 commit 62b9814 | FOUND |
