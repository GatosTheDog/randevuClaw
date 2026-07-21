---
phase: 08-enforcement-session-deduction
plan: "02"
subsystem: database/schema
tags: [schema, migration, enforcement, drizzle, postgres]
status: partial
requirements: [ENFC-01]

dependency_graph:
  requires: [08-01]
  provides: [businesses.enforcementPolicy column, 0005-enforcement-policy.sql]
  affects: [src/billing/queries.ts, src/onboarding/ai-owner-agent.ts]

tech_stack:
  added: []
  patterns: [nullable-column-extension, sql-migration-file]

key_files:
  created:
    - src/database/migrations/0005-enforcement-policy.sql
  modified:
    - src/database/schema.ts

decisions:
  - "Nullable column (no .notNull(), no DEFAULT) — businesses table is non-empty; existing rows get NULL which the app maps to 'flag' at query time per ENFC-01"
  - "No SQL DEFAULT clause in migration — application layer provides the 'flag' fallback in getEnforcementPolicy()"
  - "No CHECK constraint in SQL — application enforces 'block'/'flag' enum via Zod at write time (Wave 4)"

metrics:
  duration: "~5 minutes"
  completed_date: "2026-07-21"
  tasks_total: 2
  tasks_completed: 1
  files_modified: 2
---

# Phase 08 Plan 02: Schema Migration — Enforcement Policy Column Summary

One-liner: Add nullable `enforcement_policy` TEXT column to businesses table and write 0005-enforcement-policy.sql migration — schema change is committed, DB push requires human action.

## Task Status

| Task | Name | Status | Commit |
|------|------|--------|--------|
| 1 | Add enforcementPolicy to schema.ts + write migration SQL | DONE | e8d8724 |
| 2 | Run drizzle-kit push to apply column to live DB | PENDING HUMAN ACTION | — |

## Task 1: DONE

**What was built:**

- `src/database/schema.ts`: Added `enforcementPolicy: text('enforcement_policy')` to the businesses pgTable, inserted after `webhookSecret` and before `createdAt`. Column is nullable (no `.notNull()`) — consistent with the established Phase 2–7 pattern for adding columns to a non-empty table.
- `src/database/migrations/0005-enforcement-policy.sql`: Migration SQL file with `ALTER TABLE businesses ADD COLUMN enforcement_policy TEXT;`. No explicit default — Postgres leaves NULL for existing rows; app provides 'flag' fallback at query time.

**Verification:**

- `grep -c "enforcementPolicy" src/database/schema.ts` returns 1
- `npx tsc --noEmit` produces no errors in schema.ts (pre-existing errors in other files are unrelated missing node_modules: googleapis, @google/genai, telegraf)
- Migration SQL contains the required `ALTER TABLE businesses ADD COLUMN enforcement_policy TEXT` statement

## Task 2: PENDING HUMAN ACTION

`drizzle-kit push` cannot run non-interactively for `ADD COLUMN` on a non-empty table (prompts for confirmation). The code change is committed and ready. A human must run:

```bash
npx drizzle-kit push
```

When prompted about non-destructive changes (ADD COLUMN only), confirm with `y`.

**Verification after push:**
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'businesses' AND column_name = 'enforcement_policy';
-- Must return 1 row
```

**Resume signal:** Type "schema pushed" after drizzle-kit push completes successfully, or describe any errors encountered.

## Deviations from Plan

None — plan executed exactly as written for Task 1.

## Known Stubs

None — this plan only adds a schema column. No UI or query logic introduced.

## Threat Flags

None — the ALTER TABLE is non-destructive (ADD COLUMN nullable). The new column introduces no new network endpoints or auth paths. Zod validation at write time (Wave 4) will enforce the 'block'/'flag' enum before any DB write.

## Self-Check: PASSED

- [x] `src/database/schema.ts` exists with enforcementPolicy column
- [x] `src/database/migrations/0005-enforcement-policy.sql` exists with ALTER TABLE statement
- [x] Commit e8d8724 exists on worktree-agent-abf796e2f5f092f0e
- [x] schema.ts produces no TypeScript errors of its own
