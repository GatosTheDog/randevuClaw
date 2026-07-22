---
phase: 08-enforcement-session-deduction
plan: "02"
subsystem: database/schema
tags: [migration, schema, drizzle, enforcement-policy, phase-8]
dependency_graph:
  requires: [08-01]
  provides: [businesses.enforcement_policy column, Business.enforcementPolicy TS field]
  affects: [src/database/schema.ts, src/database/queries.ts, migrations/0007_enforcement_policy.sql]
tech_stack:
  added: []
  patterns: [ADD COLUMN IF NOT EXISTS idempotency guard, CHECK constraint defense-in-depth]
key_files:
  created:
    - migrations/0007_enforcement_policy.sql
  modified:
    - src/database/schema.ts
    - src/database/queries.ts
    - tests/ai-agent.test.ts
    - tests/billing-package-creation.test.ts
    - tests/calendar-poller.test.ts
    - tests/calendar-sync.test.ts
    - tests/consent.test.ts
    - tests/conversation-router.test.ts
    - tests/expiry-poller.test.ts
    - tests/function-executor.test.ts
    - tests/idempotency.test.ts
    - tests/onboarding-flow.test.ts
    - tests/onboarding-platform.test.ts
    - tests/scheduler-agenda.test.ts
    - tests/telegram-webhook.test.ts
    - tests/webhook.test.ts
decisions:
  - "[Phase 08-02]: CHECK constraint (enforcement_policy IN ('allow','block','flag')) added at DB layer — defense in depth alongside Zod app-layer validation planned for Plan 05"
  - "[Phase 08-02]: enforcementPolicy: string (not nullable) in Business interface — NOT NULL DEFAULT 'allow' in migration guarantees no null values after column is added"
metrics:
  duration: 10 min
  completed: "2026-07-20"
  tasks_completed: 2
  files_changed: 16
status: complete
---

# Phase 08 Plan 02: Enforcement Policy Schema Extension Summary

Schema extension for Phase 8 enforcement policy. Created the migration SQL, added the `enforcementPolicy` column to the Drizzle schema, updated the Business TypeScript interface, and applied the migration to the local test database.

## What Was Built

### Task 1: Migration SQL + schema.ts + queries.ts (commit 55f819a)

**`migrations/0007_enforcement_policy.sql`** — Idempotent ALTER TABLE adding `enforcement_policy TEXT NOT NULL DEFAULT 'allow'` with a CHECK constraint enforcing `('allow', 'block', 'flag')`. Includes GRANT UPDATE for `randevuclaw_app` role (natively idempotent).

**`src/database/schema.ts`** — `enforcementPolicy: text('enforcement_policy').notNull().default('allow')` added to the `businesses` pgTable after `webhookSecret`, following the established camelCase→snake_case naming convention.

**`src/database/queries.ts`** — `enforcementPolicy: string` field added to the `Business` interface after `webhookSecret`, with a JSDoc comment referencing D-07.

TypeScript compilation: `npx tsc --noEmit` exits 0.

### Task 2: Migration applied to randevuclaw_test (commit 664789a)

- Migration applied to `randevuclaw_test` local DB: `ALTER TABLE` succeeded; GRANT error for `randevuclaw_app` is expected (role does not exist on local DB — same behavior as Phase 7 migrations).
- Column confirmed: `SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='businesses' AND column_name='enforcement_policy'` returns 1 row with `data_type=text`, `column_default='allow'::text`.
- Full test suite: 37 passed, 1 skipped (rls-enforcement requires `DATABASE_APP_URL`), 0 failures.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added `enforcementPolicy: 'allow'` to 14 mock Business objects in test fixtures**

- **Found during:** Task 2 (running `npx jest --no-coverage`)
- **Issue:** Adding `enforcementPolicy: string` (non-nullable) to the `Business` interface caused ts-jest type errors in 13 test files. Every inline or factory mock `Business` object was missing the new required field, producing: `Type 'string | undefined' is not assignable to type 'string'`.
- **Fix:** Added `enforcementPolicy: 'allow'` to all 14 mock Business objects across 14 test files (13 failing + `billing-package-creation.test.ts` as preventive fix).
- **Files modified:** tests/ai-agent.test.ts, tests/billing-package-creation.test.ts, tests/calendar-poller.test.ts, tests/calendar-sync.test.ts, tests/consent.test.ts, tests/conversation-router.test.ts, tests/expiry-poller.test.ts, tests/function-executor.test.ts, tests/idempotency.test.ts, tests/onboarding-flow.test.ts, tests/onboarding-platform.test.ts, tests/scheduler-agenda.test.ts, tests/telegram-webhook.test.ts, tests/webhook.test.ts
- **Commit:** 664789a

### Deferred Items

**Live Neon DB migration not applied** — The `.env.local` read permission is restricted in this session's security policy, preventing automated dotenv-based psql invocation. The migration SQL is idempotent (IF NOT EXISTS guard) and must be applied manually:

```bash
psql $DATABASE_URL -f migrations/0007_enforcement_policy.sql
```

This does not block test-suite execution (tests run against `randevuclaw_test`). The live DB migration should be applied before Plan 04 code ships.

## Verification Results

- `npx tsc --noEmit`: exits 0 (both times: after Task 1 and after Task 2 auto-fix)
- `psql ... WHERE column_name='enforcement_policy'`: 1 row, `data_type=text`, `column_default='allow'::text`
- `npx jest --testPathPattern="billing-session-deduction" --no-coverage`: 5 todo, exits 0
- `npx jest --no-coverage`: 37 passed, 1 skipped, 0 failed, exits 0

## Known Stubs

None — this plan adds schema/interface only. No UI rendering or data flow stubs.

## Threat Flags

None — no new network endpoints or trust boundary changes. The CHECK constraint directly mitigates T-08-04 (invalid enforcement_policy value stored).

## Self-Check: PASSED

- [x] `migrations/0007_enforcement_policy.sql` exists
- [x] `src/database/schema.ts` contains `enforcementPolicy`
- [x] `src/database/queries.ts` Business interface contains `enforcementPolicy: string`
- [x] Commits 55f819a and 664789a exist in git log
- [x] Full test suite green (37/37 non-skipped pass)
