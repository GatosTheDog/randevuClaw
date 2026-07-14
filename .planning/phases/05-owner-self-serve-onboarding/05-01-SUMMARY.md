---
phase: 05-owner-self-serve-onboarding
plan: "01"
subsystem: database
tags: [drizzle-orm, postgres, migration, config, zod, test-helpers]

requires:
  - phase: 04-per-bot-foundation
    provides: businesses table with bot_token/webhook_id/webhook_secret columns; appDb with RLS; botTokenStore

provides:
  - onboarding_sessions table (migration + Drizzle schema export)
  - config.platformBotToken, config.platformWebhookSecret, config.webhookBaseUrl on Config interface
  - tests/helpers/test-business.ts with insertTestBusiness() replacing seed fixtures

affects:
  - 05-02 (platform.ts consumes config.platformBotToken/platformWebhookSecret)
  - 05-03 (onboarding/queries.ts reads onboardingSessions schema export)
  - 05-06 (integration tests consume insertTestBusiness())
  - 05-07 (seed.ts fixture removal depends on insertTestBusiness() being available)

tech-stack:
  added: []
  patterns:
    - "onboarding_sessions uses $onUpdate(() => new Date()) for updatedAt — Drizzle application-level hook (not DB trigger)"
    - "Test business helper uses admin db (not appDb) to bypass RLS for test setup writes"
    - "Platform bot env vars declared required (z.string().min(1)) in EnvSchema, not optional"

key-files:
  created:
    - migrations/0004_phase5_onboarding.sql
    - tests/helpers/test-business.ts
  modified:
    - src/database/schema.ts
    - src/config.ts
    - tests/jest.setup.ts
    - tests/config.test.ts

key-decisions:
  - "No RLS on onboarding_sessions — platform bot uses admin db for all cross-tenant onboarding ops"
  - "PLATFORM_BOT_TOKEN / PLATFORM_WEBHOOK_SECRET declared required (not optional) in EnvSchema — fail-fast at startup"
  - "insertTestBusiness() creates 7 businessHours rows for dayOfWeek 0-6, Sunday isClosed=true, to match findBusinessHoursForDay expectation"

patterns-established:
  - "Pattern: test helpers import from ../../src/database/db (admin db) and ../../src/database/schema for direct inserts"
  - "Pattern: Phase env vars added to both EnvSchema (uppercase) and Config interface (camelCase) in sync"

requirements-completed:
  - ONB-02
  - ONB-04

coverage:
  - id: D1
    description: "onboarding_sessions table declared in migrations/0004_phase5_onboarding.sql with idempotent CREATE TABLE DO block, unique index, and GRANT"
    requirement: ONB-02
    verification:
      - kind: other
        ref: "grep 'CREATE TABLE onboarding_sessions' migrations/0004_phase5_onboarding.sql"
        status: pass
    human_judgment: false
  - id: D2
    description: "onboardingSessions Drizzle export in src/database/schema.ts with id, businessId (NOT NULL FK), currentStep, collectedData (nullable), createdAt, updatedAt ($onUpdate) and uniqueIndex"
    requirement: ONB-02
    verification:
      - kind: unit
        ref: "npx tsc --noEmit (TypeScript compiles cleanly)"
        status: pass
    human_judgment: false
  - id: D3
    description: "config.platformBotToken, config.platformWebhookSecret, config.webhookBaseUrl on Config interface as required string fields"
    requirement: ONB-04
    verification:
      - kind: unit
        ref: "tests/config.test.ts#parses a valid full env into a typed config object"
        status: pass
    human_judgment: false
  - id: D4
    description: "jest.setup.ts provides PLATFORM_BOT_TOKEN, PLATFORM_WEBHOOK_SECRET, WEBHOOK_BASE_URL test placeholder values via ??= assignment"
    requirement: ONB-04
    verification:
      - kind: unit
        ref: "tests/config.test.ts (all 4 tests pass)"
        status: pass
    human_judgment: false
  - id: D5
    description: "tests/helpers/test-business.ts exports insertTestBusiness() with 7 businessHours rows (Sunday isClosed=true) and 1 default service"
    requirement: ONB-04
    verification:
      - kind: unit
        ref: "npx tsc --noEmit (TypeScript compiles cleanly)"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-07-14
status: complete
---

# Phase 05 Plan 01: Foundation — Schema, Config, Test Helper Summary

**onboarding_sessions Drizzle table + migration, platform bot env vars on Config, and insertTestBusiness() test helper replacing seed fixtures**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-14T14:29:08Z
- **Completed:** 2026-07-14T14:34:47Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Created `migrations/0004_phase5_onboarding.sql` with idempotent `CREATE TABLE onboarding_sessions`, unique index on `business_id`, and `GRANT SELECT, INSERT, UPDATE TO randevuclaw_app`; no RLS (platform bot uses admin db)
- Added `onboardingSessions` Drizzle export to `src/database/schema.ts` with `$onUpdate(() => new Date())` on `updatedAt` and `uniqueIndex('unique_onboarding_session_per_business')` — downstream plans reference this export directly
- Added `PLATFORM_BOT_TOKEN`, `PLATFORM_WEBHOOK_SECRET`, `WEBHOOK_BASE_URL` as required `z.string().min(1)` fields to `EnvSchema` and `Config` interface in `src/config.ts`; `tests/jest.setup.ts` provides test defaults; `tests/config.test.ts` asserts all three new fields in test 1
- Created `tests/helpers/test-business.ts` exporting `insertTestBusiness()` — inserts business + 1 service + 7 `businessHours` rows (Sunday closed) using admin db; replaces seed fixture pattern per D-11/D-12

## Task Commits

1. **Task 1: Migration 0004 + onboardingSessions schema** - `f4c68fd` (feat)
2. **Task 2: Config additions + test env placeholders** - `8d50cee` (feat)
3. **Task 3: insertTestBusiness() helper** - `956788a` (feat)

## Files Created/Modified

- `migrations/0004_phase5_onboarding.sql` - Idempotent CREATE TABLE onboarding_sessions, unique index, GRANT
- `src/database/schema.ts` - Appended onboardingSessions pgTable export with all 6 columns and uniqueIndex
- `src/config.ts` - Added PLATFORM_BOT_TOKEN/PLATFORM_WEBHOOK_SECRET/WEBHOOK_BASE_URL to EnvSchema, Config interface, and config object
- `tests/jest.setup.ts` - Added three ??= placeholders for Phase 5 platform bot env vars
- `tests/config.test.ts` - Added three assertions for new Config fields in test 1
- `tests/helpers/test-business.ts` - New file: TestBusinessOptions interface + insertTestBusiness() function

## Decisions Made

- No RLS enabled on `onboarding_sessions` — the platform bot operates with admin db across all tenants; enabling RLS would require `SET LOCAL app.current_business_id` on every onboarding query, which is incompatible with the cross-tenant session lookup pattern
- `PLATFORM_BOT_TOKEN` / `PLATFORM_WEBHOOK_SECRET` declared required (`z.string().min(1)`), not optional — fail-fast at startup is safer than silently running without a platform bot token; `WEBHOOK_BASE_URL` likewise required for `setWebhook` URL construction
- `insertTestBusiness()` generates a random `webhookId` via `crypto.randomUUID()` if not provided, producing unique slugs per insertion; prevents slug collision between test runs

## Deviations from Plan

None — plan executed exactly as written.

One note on acceptance criteria: the plan states `grep -c "platformBotToken" src/config.ts` should return 3. The actual count is 2 — because the `EnvSchema` field uses the uppercase convention `PLATFORM_BOT_TOKEN` (matching all existing fields in the project), not camelCase `platformBotToken`. The two camelCase occurrences are in the `Config` interface and `config` object. This is correct TypeScript — not a deviation.

## Issues Encountered

**Worktree base mismatch at start:** The worktree branch `worktree-agent-a28869833681d9a16` was created at `acc4101` (before Phase 5 planning commits), while the orchestrator expected base `e79b559`. The planning files for Phase 5 (PLAN.md, RESEARCH.md, etc.) were absent from the worktree. Resolved by fast-forwarding the worktree branch to `e79b559` via `git merge --ff-only e79b559` — no code conflicts, pure documentation files added.

## Next Phase Readiness

- `onboardingSessions` schema and migration are the prerequisite for Plans 05-02 through 05-05 (platform bot handler, onboarding state machine, queries, steps)
- `config.platformBotToken` / `config.platformWebhookSecret` / `config.webhookBaseUrl` are ready to consume in Plan 05-02 (`src/webhooks/platform.ts`)
- `insertTestBusiness()` is ready for Plans 05-06 and 05-07 (integration tests and fixture removal)

---
*Phase: 05-owner-self-serve-onboarding*
*Completed: 2026-07-14*
