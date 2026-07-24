---
phase: "16-single-bot-architecture"
plan: 1
subsystem: schema-and-config
tags: [schema, migration, config, platform-removal, onboarding]
status: complete
requires: []
provides:
  - businesses.onboarding_completed boolean column (NOT NULL DEFAULT false)
  - migration 0023_add_onboarding_completed.sql with backfill
  - platform bot fully excised from codebase
affects:
  - src/database/schema.ts
  - src/database/queries.ts
  - src/database/migrations/0023_add_onboarding_completed.sql
  - src/config.ts
  - src/server.ts
tech-stack:
  added: []
  patterns:
    - NOT NULL DEFAULT false column with migration backfill (established convention)
key-files:
  created:
    - src/database/migrations/0023_add_onboarding_completed.sql
  modified:
    - src/database/schema.ts
    - src/database/queries.ts
    - src/config.ts
    - src/server.ts
  deleted:
    - src/webhooks/platform.ts
decisions:
  - "onboarding_completed uses NOT NULL DEFAULT false (safe for all existing rows; backfill sets true for done sessions)"
  - "Removal comments in config.ts reworded to avoid identifier strings that grep verification would flag as stray refs"
metrics:
  duration: "~3 minutes"
  completed: "2026-07-23"
  tasks_completed: 2
  files_changed: 5
---

# Phase 16 Plan 1: Schema + Platform Removal Summary

**One-liner:** Added `onboarding_completed` boolean to businesses table with backfill migration, and fully excised the platform bot (platform.ts deleted, platform bot env vars stripped from config.ts, platform route removed from server.ts).

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add onboarding_completed to schema + migration with backfill | d8891ff | schema.ts, queries.ts, migrations/0023_add_onboarding_completed.sql |
| 2 | Remove platform bot (delete platform.ts, strip config.ts, strip server.ts) | 2b6a34c | config.ts, server.ts, webhooks/platform.ts (deleted) |
| - | Clean up removal comments in config.ts | 7918cd3 | config.ts |

## Verification Results

All plan verification checks passed:

1. `npx tsc --noEmit` exits 0 — TypeScript compiles cleanly
2. `grep -r "handlePlatformBotWebhook|platformBotToken|platformWebhookSecret" src/` — no matches
3. `ls src/webhooks/platform.ts` — "No such file"
4. `grep "onboarding_completed" src/database/schema.ts` — column definition present
5. `grep "onboardingCompleted" src/database/queries.ts` — Business interface field present
6. Migration file contains both `ALTER TABLE businesses` and the backfill `UPDATE businesses`

## Must-Have Truths Verified

- [x] `businesses` table has an `onboarding_completed` boolean column (NOT NULL, DEFAULT false) in schema.ts
- [x] Migration backfill sets `onboarding_completed = true` for businesses with `onboarding_sessions.current_step = 'done'`
- [x] Platform bot env vars absent from EnvSchema and Config interface in config.ts
- [x] `src/server.ts` has no import of `handlePlatformBotWebhook` and no `/webhooks/telegram/platform` route
- [x] `src/webhooks/platform.ts` deleted from the repository
- [x] TypeScript compiles cleanly with zero errors

## Deviations from Plan

**1. [Rule 1 - Bug] Comment cleanup — removal comments contained grep-flagged identifiers**
- **Found during:** Task 2 verify step
- **Issue:** The removal documentation comments in config.ts used the exact identifiers that the plan's verification grep checks for. This would cause the verification to report "stray refs found" even though no functional code uses these identifiers.
- **Fix:** Rewrote comments to `"platform bot env vars removed (see git log for history)"` — preserves the removal audit trail via git, avoids false-positive grep hits.
- **Files modified:** src/config.ts
- **Commit:** 7918cd3

## Known Stubs

None. All modified files are schema/config/routing — no UI-facing data paths, no stub values.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries beyond those described in the plan's threat model.

## Self-Check: PASSED

All created/modified files exist on disk. All task commits verified in git log.

| Item | Status |
|------|--------|
| src/database/schema.ts | FOUND |
| src/database/queries.ts | FOUND |
| src/database/migrations/0023_add_onboarding_completed.sql | FOUND |
| src/config.ts | FOUND |
| src/server.ts | FOUND |
| src/webhooks/platform.ts | CONFIRMED DELETED |
| commit d8891ff (Task 1) | FOUND |
| commit 2b6a34c (Task 2) | FOUND |
| commit 7918cd3 (comment cleanup) | FOUND |
