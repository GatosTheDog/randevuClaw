---
phase: 08-enforcement-session-deduction
plan: "04"
subsystem: booking-lifecycle
tags:
  - enforcement
  - session-deduction
  - credit-restore
  - billing
  - tests
dependency_graph:
  requires:
    - 08-03 (billing query layer: getActiveMembershipForDeduction, deductSession, findMembershipByBooking, restoreCredit)
  provides:
    - bookAppointmentTool with enforcement pre-check + flag alert + session deduction
    - cancelAppointmentTool with credit restore
    - handleClientCancelCallback with credit restore
    - handleCallbackQuery reject branch with credit restore
    - Phase 8 function-executor unit tests (6 cases, all passing)
    - getClientName query in billing/queries.ts
  affects:
    - 08-05 (handleSetEnforcementPolicy tool — requires enforcementPolicy flow verified)
tech_stack:
  added:
    - getClientName() added to src/billing/queries.ts
  patterns:
    - enforcement pre-check before insertBooking (D-10)
    - flag alert (NOT in try/catch) before alertOwnerNewBooking (D-11, ENFC-03)
    - findMembershipByBooking + restoreCredit pattern uniform across all three cancel paths (D-03)
    - jest.mock factory for billing/queries in both function-executor and telegram-webhook tests
key_files:
  created: []
  modified:
    - src/billing/queries.ts
    - src/conversation/function-executor.ts
    - src/webhooks/telegram.ts
    - tests/function-executor.test.ts
    - tests/telegram-webhook.test.ts
decisions:
  - getClientName added to billing/queries.ts (not database/queries.ts) — no equivalent function existed in database/queries.ts; billing/queries.ts already imported clientBusinessRelationships
  - getClientName lookup placed unconditionally after insertBooking (before if-flag block) per D-11 plan spec — keeps code flat
  - jest.mock('../src/billing/queries') factory form used (not jest.mock auto-mock) to guarantee all 5 functions are jest.fn() instances for invocationCallOrder inspection
  - Safe defaults added to both test files' beforeEach — getActiveMembership→null, findMembershipByBooking→null ensures existing tests don't regress
  - jest.mock added to telegram-webhook.test.ts for billing/queries (Rule 3 auto-fix — reject test failed because getConn() was mocked as undefined in that test context)
metrics:
  duration: "5 min"
  completed: "2026-07-20"
  tasks_completed: 3
  files_modified: 5
status: complete
---

# Phase 08 Plan 04: Booking Lifecycle Integration Summary

Wired the billing query layer from Plan 03 into all booking and cancellation code paths. bookAppointmentTool now enforces block/flag policies, sends flag alerts before the owner keyboard, and deducts sessions for finite memberships. All three cancel paths uniformly restore credit via findMembershipByBooking + restoreCredit. Six Phase 8 unit tests replace the it.todo stubs and pass.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend bookAppointmentTool with enforcement pre-check and session deduction | 575668f | src/billing/queries.ts, src/conversation/function-executor.ts |
| 2 | Extend cancelAppointmentTool and telegram.ts cancel paths with credit restore | 1b02de9 | src/conversation/function-executor.ts, src/webhooks/telegram.ts, tests/telegram-webhook.test.ts |
| 3 | Fill in function-executor.test.ts Phase 8 unit test cases | 90659c1 | tests/function-executor.test.ts |

## What Was Built

### src/billing/queries.ts
- Added `getClientName(businessId, clientPhone)` — queries `clientBusinessRelationships.clientName` by businessId + senderPhone. Returns `string | null`. Used by the D-11 flag alert to identify clients by name rather than phone number.

### src/conversation/function-executor.ts
- Extended `ToolContext.business` interface with `enforcementPolicy?: string`
- Added import of `getActiveMembershipForDeduction`, `deductSession`, `getClientName`, `findMembershipByBooking`, `restoreCredit` from `../billing/queries`
- `bookAppointmentTool` Phase 8 additions (in order):
  1. Reads `enforcementPolicy = context.business.enforcementPolicy ?? 'allow'`
  2. Calls `getActiveMembershipForDeduction` BEFORE `insertBooking` (D-10)
  3. If `block` + no membership: returns Greek refusal `{ success: false, error: 'no_membership', message: '...ενεργή συνδρομή...' }` — `insertBooking` never called (ENFC-02)
  4. After `insertBooking` success: looks up `clientName` via `getClientName` unconditionally
  5. If `flag` + no membership + ownerTelegramId: sends flag alert via `sendTelegramMessage` — NOT wrapped in try/catch (critical, D-11)
  6. If membership non-null and `sessionsRemaining` non-null: calls `deductSession` (D-06/SESS-01)
  7. Existing `alertOwnerNewBooking` in its existing try/catch — unchanged
- `cancelAppointmentTool`: added `findMembershipByBooking` + `restoreCredit` after `updateBookingStatus` (D-03)

### src/webhooks/telegram.ts
- Added import of `findMembershipByBooking`, `restoreCredit` from `../billing/queries`
- `handleClientCancelCallback`: added credit restore after `updateBookingStatus(booking.id, 'cancelled')` (D-03)
- `handleCallbackQuery` reject branch: added credit restore after `updateBookingStatusIfPending` — uses `updated.id` (D-03)
- `handleCallbackQuery` approve branch: untouched — deduction is at INSERT time, not approval

### tests/function-executor.test.ts
- Added `jest.mock('../src/billing/queries')` factory mock with all 5 Phase 8 billing functions
- Added typed mock variable declarations for all 5 functions
- Added safe defaults in `beforeEach` (getActiveMembership→null, findMembership→null)
- Replaced 6 `it.todo` stubs with real test cases:
  - Test 1 (block): Greek refusal returned; `insertBooking` call count = 0 (ENFC-02)
  - Test 2 (flag ordering): `sendTelegramMessage.invocationCallOrder[0] < sendTelegramMessageWithKeyboard.invocationCallOrder[0]` (ENFC-03/D-11)
  - Test 3 (finite deduction): `deductSession` called with `(10, 42, 'booking:42:deduction')` (SESS-01)
  - Test 4 (unlimited): `deductSession` NOT called when `sessionsRemaining: null` (D-06)
  - Test 5 (restore): `restoreCredit` called with `(77, 42, 'booking:42:credit')` (SESS-02/D-03)
  - Test 6 (no restore): `restoreCredit` NOT called when `findMembershipByBooking` returns null (Pitfall 4)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Add billing/queries mock to telegram-webhook.test.ts**
- **Found during:** Task 2 verification (`npx jest --testPathPattern="telegram-webhook"`)
- **Issue:** `handleCallbackQuery` reject branch now calls `findMembershipByBooking` which internally calls `getConn()`. In telegram-webhook tests, `database/queries` is mocked, so `getConn()` returns `undefined`. `billing/queries.ts` importing `getConn` then fails with `TypeError: Cannot read properties of undefined (reading 'select')` on the reject test.
- **Fix:** Added `jest.mock('../src/billing/queries')` + typed mock variables + `beforeEach` safe defaults to `tests/telegram-webhook.test.ts`.
- **Files modified:** `tests/telegram-webhook.test.ts`
- **Commit:** 1b02de9

## Known Stubs

None — all functions are wired to real implementations. No placeholder text or hardcoded empty values in user-facing paths.

## Threat Flags

No new security-relevant surface introduced beyond what was already in the plan's threat model. The flag alert, enforcement pre-check, and credit restore all follow the plan's mitigations for T-08-05, T-08-06, T-08-07, T-08-08.

## Self-Check

### Files created/modified
- `src/billing/queries.ts` — FOUND (modified)
- `src/conversation/function-executor.ts` — FOUND (modified)
- `src/webhooks/telegram.ts` — FOUND (modified)
- `tests/function-executor.test.ts` — FOUND (modified)
- `tests/telegram-webhook.test.ts` — FOUND (modified, deviation)

### Commits
- `575668f` — FOUND
- `1b02de9` — FOUND
- `90659c1` — FOUND

## Self-Check: PASSED
