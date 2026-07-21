---
phase: 08-enforcement-session-deduction
iteration: 1
fix_scope: critical_warning
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
applied: 2026-07-21T15:10:00Z
---

# Phase 08: Code Review Fix Report

**Applied:** 2026-07-21T15:10:00Z
**Fix Scope:** critical_warning (Critical + Warning)
**Iteration:** 1

## Summary

All 9 findings in scope (2 critical, 7 warning) fixed and verified. Full test suite passes (317/318, 1 pre-existing skip).

## Fixes Applied

### CR-01 — enforcement.ts wired into production path ✅ FIXED

**Commit:** `fix(08): wire enforcement.ts into bookAppointmentTool and guard flag alert (CR-01, WR-01)`

- Imported `checkEnforcementAndGetMembership` from `../billing/enforcement` in `function-executor.ts`
- Replaced the inline enforcement re-implementation with a single call to `checkEnforcementAndGetMembership`
- `booking-enforcement.test.ts` now exercises the actual production code path
- Removed the unused `hasCapacity` helper from `function-executor.ts`

---

### CR-02 — session credit preserved across reschedule + cancel ✅ FIXED

**Commit:** `fix(08): prevent permanent session loss after reschedule + cancel (CR-02)`

- Added `linkRescheduledBooking(membershipId, newBookingId)` to `src/billing/queries.ts`
- Inserts a `sessionsDeducted=0` ledger row (link only, no counter change) so `findMembershipByBooking` resolves the membership for the rescheduled booking
- Called in `rescheduleAppointmentTool` after `insertBooking` succeeds, when the original booking has a ledger entry

---

### WR-01 — flag alert wrapped in try/catch ✅ FIXED

**Commit:** `fix(08): wire enforcement.ts into bookAppointmentTool and guard flag alert (CR-01, WR-01)`

- Flag alert `sendTelegramMessage` call now wrapped in try/catch matching `alertOwnerNewBooking` pattern
- Telegram failure no longer orphans a committed booking row

---

### WR-02 — redundant unique index removed ✅ FIXED

**Commit:** `fix(08): remove redundant uniqueIndex on membership_ledger.idempotency_key (WR-02)`

- Removed `uniqueIndex('unique_ledger_idempotency')` from `membership_ledger` table config in `schema.ts`
- Column-level `.unique()` remains; the explicit `uniqueIndex` was a duplicate

---

### WR-03 — DB-level guard added to deductSession ✅ FIXED

**Commit:** `fix(08): add DB-level sessionsRemaining > 0 guard in deductSession (WR-03)`

- Added `gt(memberships.sessionsRemaining, 0)` to the UPDATE WHERE clause in `deductSession`
- Prevents counter going negative if a future caller skips the capacity pre-check

---

### WR-04 — businessId ownership guard added to activatePackage / cancelPendingPackage ✅ FIXED

**Commit:** `fix(08): add businessId ownership guard to activatePackage and cancelPendingPackage (WR-04)`

- Both functions now require `businessId` and use `getConn()` (matching `deactivatePackage` pattern)
- WHERE clause includes `billingPackages.businessId = businessId` for cross-tenant protection
- Updated callers in `payment-flow.ts` to pass `businessId`

---

### WR-05 — handleDeactivatePackage returns error on zero rows ✅ FIXED

**Commit:** `fix(08): handleDeactivatePackage returns error on zero-row update (WR-05)`

- `deactivatePackage` now returns `boolean` (rows updated > 0)
- `handleDeactivatePackage` checks the result and returns a Greek error message when no package matched

---

### WR-06 — DST-aware Athens end-of-day calculation ✅ FIXED

**Commit:** `fix(08): replace hardcoded Athens +02:00 DST offset with dynamic calculation (WR-06)`

- Added `athensEndOfDay(isoDate)` helper in `billing/queries.ts` using `toLocaleString` with `Europe/Athens` timezone
- Replaced both hardcoded `T23:59:59+02:00` occurrences in `createMembership` and `findMembershipsExpiringIn7Days`
- Correct UTC+2/UTC+3 offset applied automatically based on DST status of the target date

---

### WR-07 — missing mock in billing-package-creation tests ✅ FIXED

**Commit:** `fix(08): add handleSetEnforcementPolicy to billing/tools mock in package-creation tests (WR-07)`

- Added `handleSetEnforcementPolicy: jest.fn().mockResolvedValue('')` to the `../src/billing/tools` mock factory

---

## Test Verification

```
Test Suites: 1 skipped, 41 passed, 41 of 42 total
Tests:       1 skipped, 317 passed, 318 total
```

1 suite skipped and 1 test skipped are pre-existing (unrelated to phase 08 changes).
