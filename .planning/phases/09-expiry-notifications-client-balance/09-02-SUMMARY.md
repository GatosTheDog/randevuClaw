---
phase: 09-expiry-notifications-client-balance
plan: "02"
subsystem: billing-queries-and-balance-tool
tags:
  - billing
  - gemini-tool
  - membership
  - notifications
  - phase-9
dependency_graph:
  requires:
    - 09-01-SUMMARY.md  # membershipExpiryNotifications table + formatExpiryDateGreek formatter
  provides:
    - ExpiringMembership interface in billing/queries.ts
    - findMembershipsExpiringIn7Days() in billing/queries.ts (used by Plan 03 sweep)
    - insertMembershipExpiryNotification() in billing/queries.ts (used by Plan 03 sweep dedup)
    - check_membership_balance Gemini tool in BOOKING_TOOLS (ai-agent.ts)
    - checkMembershipBalanceTool handler in function-executor.ts
    - 4 passing check_membership_balance unit tests (NOTF-04)
  affects:
    - 09-03-PLAN.md (membership-expiry sweep consumes findMembershipsExpiringIn7Days + insertMembershipExpiryNotification)
tech_stack:
  added: []
  patterns:
    - DST-safe 7-day rolling window with isoDateInAthens + addCalendarDays + gt(expiresAt, now) exclusion filter
    - onConflictDoNothing().returning() pattern for idempotent dedup inserts returning boolean
    - CheckMembershipBalanceArgsSchema (business_id only) — clientPhone always from context, never from Gemini args (T-09-05)
    - Noon-UTC date anchor in tests to avoid DST midnight ambiguity when asserting formatted Athens dates
key_files:
  created: []
  modified:
    - src/billing/queries.ts
    - src/conversation/ai-agent.ts
    - src/conversation/function-executor.ts
    - tests/function-executor.test.ts
decisions:
  - "findMembershipsExpiringIn7Days uses db (not getConn()) — sweep context is outside withBusinessContext; application-layer businessId WHERE clause provides isolation (T-09-07)"
  - "insertMembershipExpiryNotification uses db (not getConn()) — dedup inserts happen from the sweep, outside any withBusinessContext transaction (T-09-06)"
  - "checkMembershipBalanceTool accepts only business_id param — clientPhone always sourced from context.clientPhone (Telegram from.id), never from Gemini args, preventing cross-client balance inspection (T-09-05)"
  - "Test date anchor: noon UTC (T12:00:00Z) instead of 22:00Z to avoid Athens midnight crossing in DST summer (UTC+3), ensuring formatExpiryDateGreek produces the intended DD/MM/YYYY date in assertions"
metrics:
  duration_min: 18
  completed_date: "2026-07-21"
  tasks_completed: 2
  files_changed: 4
status: complete
---

# Phase 09 Plan 02: Billing Query Layer Extensions and Client Balance Tool Summary

**One-liner:** DST-safe 7-day expiry window query + idempotent dedup insert for the Plan 03 sweep, plus the complete check_membership_balance Gemini tool with three Greek D-08 message scenarios and 4 passing unit tests.

## What Was Built

### Task 1: findMembershipsExpiringIn7Days + insertMembershipExpiryNotification (commit 30f1d07)

**src/billing/queries.ts — three new exports:**

`ExpiringMembership` interface: `{ id: number; clientPhone: string; businessId: number; expiresAt: Date; sessionsRemaining: number | null }` — the shape returned by the sweep query, consumed by Plan 03.

`findMembershipsExpiringIn7Days(businessId: number): Promise<ExpiringMembership[]>`:
- Uses `db` (not `getConn()`) — sweep context, no RLS transaction needed
- DST-safe window: `isoDateInAthens(now)` → `addCalendarDays(nowIso, 7)` → `new Date(sevenDaysFromNowIso + 'T23:59:59+02:00')`
- WHERE: `eq(businessId)`, `eq(isActive, true)`, `lte(expiresAt, windowEnd)`, `gt(expiresAt, now)` — the `gt` clause excludes already-expired memberships (RESEARCH.md OQ-3)
- Added `lte` to drizzle-orm import; added `membershipExpiryNotifications` to schema import

`insertMembershipExpiryNotification(membershipId, notificationType, expiryDate): Promise<boolean>`:
- `notificationType` union type: `'7_day_client' | '7_day_owner'`
- `db.insert(...).values(...).onConflictDoNothing().returning(...)` — returns `result.length > 0`
- True on first insert (send the notification); false on UNIQUE conflict (skip — already notified)

### Task 2: check_membership_balance Gemini tool + tests (commits c266131, 6d3b07d)

**src/conversation/ai-agent.ts:** Appended `check_membership_balance` entry to `BOOKING_TOOLS` array. Tool definition: type `'function'`, name, Greek description (`Ελέγχει το υπόλοιπο συνδρομής...`), parameters `{ business_id: integer }`, required `['business_id']`.

**src/conversation/function-executor.ts:**
- Imported `formatExpiryDateGreek` from `../utils/timezone`
- Added `CheckMembershipBalanceArgsSchema = z.object({ business_id: z.number().int() })` — no `client_phone` param (T-09-05)
- Added `case 'check_membership_balance'` to `executeTool` switch dispatcher
- Added `checkMembershipBalanceTool(args, context)` private async function with three D-08 Greek message scenarios:
  1. `membership === null` → "Δεν βρέθηκε ενεργή συνδρομή. Επικοινωνήστε με {business.name} για ανανέωση."
  2. `sessionsRemaining === null` → "Η συνδρομή σας είναι απεριόριστων μαθημάτων και λήγει στις {date}."
  3. `sessionsRemaining > 0` → "Έχετε {N} μαθήματα απομείνει. Η συνδρομή σας λήγει στις {date}."
- No try/catch inside handler — outer `executeTool()` catch block handles all tool errors uniformly

**tests/function-executor.test.ts:** Replaced 4 `it.todo` stubs with full test bodies. Added `beforeEach(() => mockedGetActiveMembership.mockReset())` to prevent mock leak. All 4 tests pass; all 21 prior tests remain green (25 total passing in function-executor suite).

## Verification

```
npx tsc --noEmit → TSC OK (0 errors)
npm test tests/billing-session-deduction.test.ts --no-coverage → 5 passed, 0 failed
npm test tests/function-executor.test.ts --no-coverage → 25 passed, 0 failed (4 new + 21 prior)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test date timezone mismatch — plan expected '14/08/2026' but `new Date('2026-08-14T22:00:00Z')` produces '15/08/2026' in Athens (UTC+3 DST)**
- **Found during:** Task 2 test implementation — first run showed "Expected: 14/08/2026, Received: 15/08/2026"
- **Issue:** Athens is UTC+3 in August (EEST); 22:00 UTC + 3 hours = 01:00 next day, so `formatExpiryDateGreek` correctly returns 15/08/2026. The plan's test specification had an incorrect date expectation.
- **Fix:** Changed test input from `new Date('2026-08-14T22:00:00Z')` to `new Date('2026-08-14T12:00:00Z')` (noon UTC = 15:00 Athens, same calendar day). Added comment explaining the DST-safe noon anchor. This applies to both Test 2 (unlimited) and Test 3 (counted).
- **Files modified:** tests/function-executor.test.ts
- **Commit:** 6d3b07d

## Known Stubs

None — all test stubs from Plan 01's scaffolding that were assigned to this plan are now implemented and passing.

## Threat Surface Scan

No new network endpoints or auth paths introduced. All security-relevant patterns from the plan's threat model were applied:
- T-09-05: `checkMembershipBalanceTool` accepts only `business_id`; `clientPhone` always from `context.clientPhone` — cross-client balance read impossible
- T-09-06: `insertMembershipExpiryNotification` uses `db` outside `withBusinessContext`; UNIQUE+onConflictDoNothing handles concurrent race
- T-09-07: `findMembershipsExpiringIn7Days` uses DST-safe window + `gt(expiresAt, now)` exclusion filter

No threat flags beyond the plan's existing threat model.

## Self-Check: PASSED

Commits exist:
- 30f1d07: feat(09-02): billing queries — FOUND
- c266131: feat(09-02): check_membership_balance Gemini tool — FOUND
- 6d3b07d: test(09-02): check_membership_balance unit tests — FOUND

Acceptance criteria verified:
- grep "lte" src/billing/queries.ts → 2 lines (import + lte filter)
- grep "membershipExpiryNotifications" src/billing/queries.ts → 3 lines (import + insert + returning)
- grep "ExpiringMembership" src/billing/queries.ts → 2 lines (interface + return type)
- grep "findMembershipsExpiringIn7Days" src/billing/queries.ts → 2 lines
- grep "insertMembershipExpiryNotification" src/billing/queries.ts → 2 lines
- grep "gt(memberships.expiresAt, now)" src/billing/queries.ts → 1 line (exclusion filter)
- grep "check_membership_balance" src/conversation/ai-agent.ts → 2 lines (name + description)
- grep "CheckMembershipBalanceArgsSchema" src/conversation/function-executor.ts → 2 lines
- grep "formatExpiryDateGreek" src/conversation/function-executor.ts → 2 lines (import + usage)
- grep "case 'check_membership_balance'" src/conversation/function-executor.ts → 1 line
- grep "απεριόριστων μαθημάτων" src/conversation/function-executor.ts → 1 line
- npm test function-executor.test.ts → 25 passed, 0 failed, 0 pending
- npx tsc --noEmit → exit 0
