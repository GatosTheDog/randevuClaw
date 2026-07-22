---
phase: 08-enforcement-session-deduction
plan: "03"
subsystem: billing
tags:
  - session-deduction
  - idempotency
  - select-for-update
  - integration-tests
dependency_graph:
  requires:
    - 08-01 (schema migration with membershipLedger idempotencyKey UNIQUE + bookingId FK)
    - 08-02 (enforcementPolicy column on businesses table)
  provides:
    - deductSession (idempotent session deduction with SELECT FOR UPDATE)
    - restoreCredit (SESS-03/SESS-04 expiry/unlimited guards)
    - getActiveMembershipForDeduction (locked read for concurrent safety)
    - findMembershipByBooking (credit restore lookup via ledger)
    - getBusinessEnforcementPolicy (enforcement policy read)
    - setBusinessEnforcementPolicy (policy update via getConn())
  affects:
    - 08-04 (bookAppointmentTool uses getActiveMembershipForDeduction + deductSession)
    - 08-05 (cancelAppointmentTool / handleClientCancelCallback use findMembershipByBooking + restoreCredit)
tech_stack:
  added: []
  patterns:
    - SELECT FOR UPDATE via drizzle-orm .for('update') on PgSelect (T-08-01 race prevention)
    - onConflictDoNothing().returning() idempotency pattern for append-only ledger (D-12)
    - getConn() exclusively for all Phase 8 writes (Pitfall 1/2 — atomicity via withBusinessContext)
    - Null check before expiresAt check in restoreCredit (SESS-04 ordering requirement)
key_files:
  created:
    - tests/billing-session-deduction.test.ts
  modified:
    - src/billing/queries.ts
decisions:
  - "getConn() used exclusively in all Phase 8 write functions — db.transaction() would open a separate connection breaking atomicity with withBusinessContext"
  - "restoreCredit checks sessionsRemaining === null BEFORE computing nowAthens — SESS-04 exits early for unlimited memberships regardless of expiry state"
  - "Test bookings use 'cancelled' status to bypass unique_active_slot_per_business partial index — test isolation without slot collision"
  - "Real booking rows inserted in tests (not fake IDs) — membership_ledger.bookingId FK constraint requires referential integrity"
metrics:
  duration_minutes: 7
  completed_date: "2026-07-20"
  tasks_completed: 3
  files_modified: 2
status: complete
---

# Phase 08 Plan 03: Billing Query Layer Summary

Billing query layer for Phase 8. Six new exported functions + one interface added to `src/billing/queries.ts`. Five integration tests filling in `tests/billing-session-deduction.test.ts` stubs.

## What Was Built

**`src/billing/queries.ts` — 6 new exports + 1 interface:**

- `ActiveMembershipForDeduction` interface: `{ id: number; sessionsRemaining: number | null; expiresAt: Date }`
- `getActiveMembershipForDeduction(businessId, clientPhone)` — SELECT FOR UPDATE via `.for('update')` to serialize concurrent session deductions (SESS-01 / T-08-01)
- `findMembershipByBooking(bookingId)` — joins `membershipLedger` WHERE `operationType='session_deducted'`; returns `null` for unlimited memberships and pre-Phase-8 bookings (Pitfall 4)
- `getBusinessEnforcementPolicy(businessId)` — returns `enforcementPolicy` or `'allow'` fallback (D-08 backward compat)
- `deductSession(membershipId, bookingId, idempotencyKey)` — ledger insert with `onConflictDoNothing().returning()` + early return guard + counter decrement (T-08-02 idempotency)
- `restoreCredit(membershipId, bookingId, idempotencyKey)` — null check (SESS-04) → expiry check (SESS-03) → idempotent ledger insert → counter increment
- `setBusinessEnforcementPolicy(businessId, policy)` — UPDATE businesses via `getConn()`

**`tests/billing-session-deduction.test.ts` — 5 real integration tests:**

All tests run against `randevuclaw_test` DB following the `billing-membership-creation.test.ts` pattern.

| Test | Requirement | Verified |
|------|-------------|---------|
| deducts 1 session atomically on booking insert | SESS-01 | sessionsRemaining decremented + ledger row present |
| deduction is idempotent on replay | SESS-01 | double-call → sessionsRemaining decremented exactly once |
| restores credit on cancel within validity window | SESS-02 | sessionsRemaining incremented + credit_restored ledger row |
| no credit restore when membership expired | SESS-03 | sessionsRemaining unchanged + no ledger row |
| unlimited membership: no deduction row, no counter change | SESS-04 | findMembershipByBooking returns null; restoreCredit no-ops |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Foreign key constraint violation using fake booking IDs**

- **Found during:** Task 3 — first test run
- **Issue:** Tests used fake booking IDs (9001-9005) for `membershipLedger.bookingId`, but that column has a FK constraint to `bookings.id`. Inserting non-existent IDs caused `violates foreign key constraint "membership_ledger_booking_id_fkey"`.
- **Fix:** Added `insertTestBooking()` helper that creates real booking rows in the test DB. Used `bookingStatus: 'cancelled'` to avoid the `unique_active_slot_per_business` partial index (which only applies to `pending_owner_approval` and `confirmed` statuses).
- **Files modified:** `tests/billing-session-deduction.test.ts`
- **Commit:** `1e6272e`

## Verification Results

- `npx tsc --noEmit`: exits 0 (TSC OK)
- `npx jest --testPathPattern="billing-session-deduction" --no-coverage`: 5 passing tests
- `npx jest --no-coverage`: 37 suites passed, 283 tests passed (no regressions)

## Self-Check: PASSED
