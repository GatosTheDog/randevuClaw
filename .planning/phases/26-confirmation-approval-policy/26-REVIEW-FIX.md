---
phase: 26-confirmation-approval-policy
fixed_at: 2026-07-28T09:13:05Z
review_path: .planning/phases/26-confirmation-approval-policy/26-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: partial
---

# Phase 26: Code Review Fix Report

**Fixed at:** 2026-07-28T09:13:05Z
**Source review:** .planning/phases/26-confirmation-approval-policy/26-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (1 Critical, 4 Warning — `fix_scope: critical_warning`; IN-01 left out of scope per instructions)
- Fixed: 5
- Skipped: 0

## Fixed Issues

### CR-01: Session-class reschedule approval double-deducts a session credit

**Files modified:** `src/conversation/function-executor.ts`, `src/webhooks/telegram.ts`
**Commit:** `82f70e5`
**Status:** fixed: requires human verification (logic/ledger fix — see note below)

**Applied fix:** In `rescheduleSessionTool` (function-executor.ts), `bookSessionInstance` is now
called with `null` instead of the client's real `activeMembership`, so the new (pending-approval)
booking no longer deducts a second credit. On success, the new booking is explicitly linked to the
original booking's membership ledger row via `linkRescheduledBooking` (mirrors the existing
open-slot `rescheduleAppointmentTool` / CR-02 "link, don't deduct" pattern already in the same
file). The now-unused `getActiveMembershipForDeduction` import was removed.

**Adaptation beyond the literal REVIEW.md suggestion:** tracing the fix through to the `sbk:reject`
branch in `telegram.ts` revealed that `findMembershipByBooking` matches on `operationType =
'session_deducted'` regardless of the linked row's `sessionsDeducted` value (0 or 1). Applying only
the literal suggested diff would have caused the reject path to still find the membership via the
new link-only row and call `restoreCredit`, handing the client back a credit they never lost (the
original booking, left untouched on reject, keeps its own real deduction). To keep the reject path
net-zero-change (matching current, correct behavior), `telegram.ts`'s `sbk` reject branch now skips
`restoreCredit` specifically when `updated.rescheduledFromBookingId` is set (a genuinely fresh,
non-reschedule booking is still restored on reject exactly as before). The `sbk` approve branch's
stale comment ("the old booking's credit was never touched... restoring it now would over-refund")
was also corrected to reflect why no restore is needed post-fix.

**Verification:**
- `tsc --noEmit` clean across both files (and the whole project) after the change.
- `tests/telegram-webhook.test.ts` (27/27 pass) and `tests/webhooks/client-menu.test.ts` (39/39
  pass, including the pre-existing "owner taps Απόρριψη on a session booking →
  releaseSessionCapacity + findMembershipByBooking/restoreCredit called" test, which still passes
  because that fixture's booking is not a reschedule, so the new guard doesn't change its outcome).
- `tests/session-booking-flow.test.ts` contains the most directly relevant assertion
  (`rescheduleSessionTool allows reschedule to session within membership expiry`, SBOK-03) but this
  suite requires a dedicated local Postgres instance (`postgresql://manolis@localhost:5432/randevuclaw_test`
  with migrations 0006/0007/0010 pre-applied) that is not available in this environment — attempting
  to point it at the project's real Neon dev database instead is inappropriate (it would insert
  throwaway test rows into a real, shared environment, and that suite doesn't assert
  `sessionsRemaining` after an approved reschedule today regardless, per the review's own note).
  **This specific test file could not be executed here; a human should run
  `npx jest --testPathPattern="session-booking-flow.test.ts"` against the project's local test DB
  before merging**, and ideally add a `sessionsRemaining` assertion to the existing `sbok03-allow`
  test (currently absent) to lock in the credit-neutrality this fix restores.
- Flagged as `requires human verification` per the fix-agent's own policy for logic/ledger fixes,
  independent of the above test-infra gap.

### WR-01: `update_service_price` staging map timer-cleanup race

**Files modified:** `src/onboarding/ai-owner-agent.ts`
**Commit:** `7cb9940`
**Status:** fixed

**Applied fix:** `pendingServicePriceChanges` entries now store their own `setTimeout` handle.
`setPendingServicePriceChange` clears any existing entry's timer before overwriting it with a new
value, so a second "change price" request for the same service before the first is confirmed no
longer leaves an orphaned earlier timer that deletes the newer, still-pending value early.

**Verification:** `tsc --noEmit` clean; `tests/ai-owner-confirmation-policy.test.ts` (9/9 pass,
including the `svc_price` staging + confirm round-trip test).

### WR-02: `update_service_price` accepted non-positive prices

**Files modified:** `src/onboarding/ai-owner-agent.ts`
**Commit:** `879e2cc`
**Status:** fixed

**Applied fix:** `update_service_price`'s validation now rejects `new_price_cents <= 0` (in addition
to the existing `undefined` check), matching `add_service`'s existing guard, returning `'Μη έγκυρη
τιμή.'` instead of staging/applying a zero or negative price.

**Verification:** `tsc --noEmit` clean; `tests/ai-owner-confirmation-policy.test.ts` (9/9 pass — no
existing test exercised a non-positive price, so this is a net-new guard, not a behavior change for
any covered scenario).

### WR-03: Orphaned `edit-router.ts` module bypassing CONF-01 protections

**Files modified:** `src/onboarding/edit-router.ts` (deleted), `tests/onboarding/edit-router.test.ts` (deleted)
**Commit:** `8be1122`
**Status:** fixed

**Applied fix:** Deleted both files per the review's recommended fix. Confirmed via grep across
`src/` and `tests/` that `routeOwnerEdit` and `isOwnerEditCommand` had no remaining production
import (only the now-deleted test referenced them), and that `tsc --noEmit` stays clean after
removal (no dangling references).

**Verification:** `tsc --noEmit` clean across the whole project post-deletion.

### WR-04: Missing best-effort try/catch on post-mutation Telegram notifications

**Files modified:** `src/onboarding/ai-owner-agent.ts`
**Commit:** `215a235`
**Status:** fixed

**Applied fix:** Wrapped the post-mutation confirmation `sendTelegramMessage` call in each of the 4
`handleOwnerToolConfirmCallback` branches (`svc_del`, `svc_price`, `hrs_close`, `assign`) in
try/catch with `logger.error(..., '... (best-effort)')`, matching the codebase's established
CR-03a/b/c convention. In the `assign` branch specifically, the client-facing send and the
owner-facing send are now wrapped independently, so a failure notifying the client no longer skips
the owner's own confirmation message.

**Verification:** `tsc --noEmit` clean; `tests/ai-owner-confirmation-policy.test.ts` (9/9 pass,
including the `svc_del` and `hrs_close` confirmed=true success-reply assertions, which still pass
since the try/catch is transparent when `sendTelegramMessage` resolves normally, as it does in the
mocked test environment).

## Skipped Issues

None — all 5 in-scope findings were fixed.

## Out of scope (per instructions)

- **IN-01** (`tests/COVERAGE.md` staleness) — explicitly excluded by `fix_scope: critical_warning`.

## Verification notes

- Full `tsc --noEmit` run across the project (via the main repo's `typescript` install, symlinked
  into this worktree's `node_modules` since the worktree checkout does not include installed
  dependencies) is clean — zero errors — after all 5 fixes.
- Targeted, non-DB-dependent Jest suites covering every touched code path were run for real (not
  mocked away) against this environment's Node/Jest install, using the project's real
  `.env.local` credentials (Neon dev DB) copied into the worktree, per this project's CLAUDE.md and
  the memory note to always scope Jest runs with `--testPathPattern` rather than the full suite:
  - `tests/ai-owner-confirmation-policy.test.ts` — 9/9 pass
  - `tests/telegram-webhook.test.ts` — 27/27 pass
  - `tests/webhooks/client-menu.test.ts` — 39/39 pass
  - `tests/ai-owner-cancel-session.test.ts` — 3/3 pass (regression check on the same file as WR-01/02/04)
  - Total: 78/78 passing, 0 failures, 0 regressions.
- `tests/session-booking-flow.test.ts` and `tests/session-assignment.test.ts` intentionally target a
  dedicated local Postgres (`postgresql://manolis@localhost:5432/randevuclaw_test`) that is not
  provisioned in this environment (a listener exists on port 5432 locally but rejects the
  connection with a SASL/SCRAM error — almost certainly a different, unrelated local service, not
  the project's expected test Postgres). These were **not** run. A human with the local dev DB set
  up should run:
  ```
  npx jest --testPathPattern="session-booking-flow.test.ts|session-assignment.test.ts"
  ```
  before merging, to directly exercise CR-01's `sbok03-allow` scenario end-to-end against a real DB.

---

_Fixed: 2026-07-28T09:13:05Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
