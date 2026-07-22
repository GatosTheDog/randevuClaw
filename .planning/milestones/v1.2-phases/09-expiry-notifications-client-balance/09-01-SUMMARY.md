---
phase: 09-expiry-notifications-client-balance
plan: "01"
subsystem: schema-foundation
tags:
  - schema
  - migration
  - timezone
  - test-scaffolding
  - phase-9
dependency_graph:
  requires:
    - 08-05-SUMMARY.md  # enforcement_policy column + Phase 8 membership state machine
  provides:
    - membershipExpiryNotifications table (dedup for NOTF-03)
    - migrations/0008_expiry_notifications.sql (Neon DB apply in Plan 03)
    - formatExpiryDateGreek (DD/MM/YYYY Athens formatter)
    - tests/scheduler-expiry.test.ts (6 it.todo stubs)
    - tests/function-executor.test.ts check_membership_balance block (4 it.todo stubs)
  affects:
    - 09-02-PLAN.md (checkMembershipBalanceTool implementation)
    - 09-03-PLAN.md (membership-expiry sweep + DB apply)
tech_stack:
  added: []
  patterns:
    - Drizzle uniqueIndex on (membership_id, notification_type, expiry_date) — NOTF-03 dedup
    - Intl.DateTimeFormat en-GB / Europe/Athens for DD/MM/YYYY formatting (D-09)
    - it.todo stubs with no top-level imports from unbuilt modules (Wave 0 scaffolding)
key_files:
  created:
    - migrations/0008_expiry_notifications.sql
    - tests/scheduler-expiry.test.ts
  modified:
    - src/database/schema.ts
    - src/utils/timezone.ts
    - tests/function-executor.test.ts
decisions:
  - "D-04: UNIQUE INDEX on (membership_id, notification_type, expiry_date) — no partial WHERE, dedup is unconditional for all membership states"
  - "D-05: notification_type stores '7_day_client' or '7_day_owner' — per-recipient dedup granularity so client and owner notifications succeed/fail independently"
  - "D-09: formatExpiryDateGreek uses en-GB locale with Europe/Athens timezone — Intl.DateTimeFormat produces DD/MM/YYYY directly, no manual string reassembly"
  - "Wave 0 pattern: test stubs have no top-level imports from unbuilt modules to prevent ts-jest compile failure"
metrics:
  duration_min: 8
  completed_date: "2026-07-21"
  tasks_completed: 2
  files_changed: 5
status: complete
---

# Phase 09 Plan 01: Schema Foundation, Migration, and Test Scaffolding Summary

**One-liner:** UNIQUE dedup table for membership expiry notifications, DD/MM/YYYY Athens date formatter, and 10 it.todo stubs covering NOTF-01 through NOTF-04.

## What Was Built

### Task 1: Schema + Migration + Timezone Utility (commit 21d0279)

**src/database/schema.ts — membershipExpiryNotifications table:**

New Drizzle table `membership_expiry_notifications` appended after `membershipLedger`. Columns:
- `id` — SERIAL PRIMARY KEY
- `membershipId` — INTEGER NOT NULL FK → memberships.id
- `notificationType` — TEXT NOT NULL ('7_day_client' | '7_day_owner' per D-05)
- `expiryDate` — TEXT NOT NULL (YYYY-MM-DD Athens date via isoDateInAthens())
- `sentAt` — TIMESTAMP NOT NULL DEFAULT NOW()
- `createdAt` — TIMESTAMP NOT NULL DEFAULT NOW()

Table-level uniqueIndex `unique_membership_expiry_notification` on (membershipId, notificationType, expiryDate) — enforces NOTF-03 dedup at DB level with no partial WHERE clause.

**migrations/0008_expiry_notifications.sql:**

Raw SQL with CREATE TABLE IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS for Neon DB apply in Plan 03. Includes GRANT SELECT, INSERT to randevuclaw_app role (consistent with Phase 7/8 pattern). Idempotent — safe to re-run.

**src/utils/timezone.ts — formatExpiryDateGreek:**

New exported function `formatExpiryDateGreek(date: Date): string` appended after `addCalendarDays`. Uses Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', day: '2-digit', month: '2-digit', year: 'numeric' }) to produce DD/MM/YYYY output (e.g. "14/08/2026") for Greek-language notification messages.

### Task 2: Test Scaffolding (commit ff81d81)

**tests/scheduler-expiry.test.ts (new):**

6 it.todo stubs covering NOTF-01/02/03 sweep behaviors. File-level jest.mock declarations for database/queries, billing/queries, telegram/client, and logger. No top-level import of runMembershipExpirySweep or findMembershipsExpiringIn7Days — those modules/exports don't exist yet; imports will be added in Plan 03.

**tests/function-executor.test.ts (extended):**

Appended describe('check_membership_balance tool — NOTF-04') with 4 it.todo stubs at end of file. No new jest.mock declarations needed — stubs use existing mock setup. All 21 prior tests remain passing.

## Verification

```
npx tsc --noEmit → TSC OK (0 errors)
npm test tests/scheduler-expiry.test.ts tests/function-executor.test.ts → 2 suites passed, 21 passed + 10 todo
npm test tests/timezone.test.ts → 6 passed, 0 failed
```

Full suite: 39 passed, 2 failed (billing-package-deactivate — pre-existing DB integration failure unrelated to this plan, confirmed by verifying failure exists on the commit before this plan started).

## Deviations from Plan

None — plan executed exactly as written. The one out-of-scope failure (billing-package-deactivate.test.ts) is a pre-existing integration test issue against the local test DB, not caused by this plan's changes.

## Known Stubs

All 10 it.todo stubs are intentional scaffolding. They will be filled in Plans 02–03:

| Stub file | Count | Filled in |
|-----------|-------|-----------|
| tests/scheduler-expiry.test.ts | 6 | Plan 03 (membership-expiry sweep) |
| tests/function-executor.test.ts | 4 | Plan 02 (checkMembershipBalanceTool) |

The stubs do not prevent the plan's goal (schema/migration/formatter foundation) — they are the plan's explicit output per Wave 0 pattern.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundaries introduced. The new table adds a FK to memberships — migration SQL must be applied to Neon DB before the Plan 03 sweep runs (documented in Plan 03 checkpoint). No threat flags beyond T-09-01/02/03 already in the plan's threat model.

## Self-Check: PASSED

Created files exist:
- migrations/0008_expiry_notifications.sql: FOUND
- tests/scheduler-expiry.test.ts: FOUND

Commits exist:
- 21d0279: feat(09-01): schema + migration + formatExpiryDateGreek — FOUND
- ff81d81: test(09-01): scheduler-expiry stubs + function-executor extension — FOUND
