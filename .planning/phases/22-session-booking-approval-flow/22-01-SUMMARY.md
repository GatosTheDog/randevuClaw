---
phase: 22-session-booking-approval-flow
plan: 01
subsystem: booking
tags: [telegram, drizzle, postgres, session-booking, approval-workflow]

requires:
  - phase: 20-escalation-and-exception-handling
    provides: escalationAction callback routing pattern, ownership + cross-tenant guard convention reused verbatim for the new sbk: branch
  - phase: 10-session-catalog-and-booking
    provides: bookSessionInstance / sessionInstances capacity model, session_catalog schema
  - phase: 08-billing-enforcement
    provides: restoreCredit / findMembershipByBooking credit-restore path reused unmodified

provides:
  - "bookSessionInstance() defaults new session-class bookings to bookingStatus='pending_owner_approval' with a 2h expiry, with an explicit 'confirmed' override parameter for owner-already-decided call sites"
  - "releaseSessionCapacity() — single shared bookedCount-decrement implementation"
  - "releaseExpiredSessionBooking() — expiry-sweep cleanup reusing releaseSessionCapacity + restoreCredit"
  - "Owner Έγκριση/Απόρριψη approval keyboard on every new pending session booking, across client-menu, free-chat single-booking, and free-chat multi-booking paths"
  - "sbk:approve:<id> / sbk:reject:<id> webhook callback routing with owner + cross-tenant + idempotent-CAS guards"

affects: [23-lesson-deletion-cascade-cancel, session-booking-flow, telegram-webhook-routing]

tech-stack:
  added: []
  patterns:
    - "initialStatus optional 7th parameter on a booking-creation function, defaulting to the safer/gated value, with call sites that represent an owner's own decision passing an explicit override"
    - "Single shared capacity-release function called from both the interactive reject path and the passive expiry-sweep path (closes double-release risk at the source)"

key-files:
  created:
    - tests/session/session-approval.test.ts
  modified:
    - src/session/manager.ts
    - src/conversation/expiry-poller.ts
    - src/telegram/handlers/client-menu.ts
    - src/conversation/function-executor.ts
    - src/onboarding/ai-owner-agent.ts
    - src/webhooks/telegram.ts
    - tests/helpers/session-fixtures.ts
    - tests/webhooks/client-menu.test.ts

key-decisions:
  - "bookSessionInstance's capacity-check/credit-deduction logic left untouched (D-02 locked) — only bookingStatus/expiresAt at insert time changed"
  - "releaseSessionCapacity is the single shared implementation for both reject (telegram.ts) and expiry (expiry-poller.ts) — one source of truth for the bookedCount-decrement SQL"
  - "Reject-path atomicity achieved for free via the ambient withBusinessContext transaction that already wraps handleCallbackQuery — no new transaction wrapper needed"
  - "escl:approve, rescheduleSessionTool, and assign_client_to_session all explicitly pass 'confirmed' to preserve their pre-existing immediate-confirm behavior"

patterns-established:
  - "Owner-decision call sites of a newly-gated function pass an explicit override argument rather than the function silently detecting caller intent"

requirements-completed: [OWNR-05, OWNR-06, OWNR-07]

coverage:
  - id: D1
    description: "bookSessionInstance() defaults new session bookings to pending_owner_approval with a 2h expiry; 'confirmed' override preserves owner-decided call sites (reschedule, assign_client_to_session, escl:approve)"
    requirement: "OWNR-05"
    verification:
      - kind: unit
        ref: "tsc --noEmit -p tsconfig.json (zero errors in src/session/manager.ts)"
        status: pass
      - kind: integration
        ref: "tests/session/session-approval.test.ts (compiles; DB-connection blocked in this sandbox — see Issues Encountered)"
        status: unknown
    human_judgment: true
    rationale: "No reachable local Postgres test DB in this execution environment — capacity/credit atomicity claims are code-reviewed and type-checked but not proven by a green integration run here."
  - id: D2
    description: "Owner Έγκριση/Απόρριψη approval keyboard sent on every new pending session booking (client menu, free-chat single, free-chat multi), with a Greek pending-request client message replacing the old confirmation"
    requirement: "OWNR-05"
    verification:
      - kind: integration
        ref: "tests/webhooks/client-menu.test.ts#Suite C: booking flow via handleClientMenuCallback"
        status: pass
    human_judgment: false
  - id: D3
    description: "sbk:approve/sbk:reject webhook routing enforces owner-only, cross-tenant, and idempotent-CAS guards before any mutation"
    requirement: "OWNR-06"
    verification:
      - kind: integration
        ref: "tests/webhooks/client-menu.test.ts#Suite F: sbk: session booking approval routing"
        status: pass
    human_judgment: false
  - id: D4
    description: "Reject and expiry both atomically release held capacity and restore any deducted session credit via the shared releaseSessionCapacity implementation"
    requirement: "OWNR-07"
    verification:
      - kind: integration
        ref: "tests/webhooks/client-menu.test.ts#Suite F (reject path, mocked)"
        status: pass
      - kind: integration
        ref: "tests/session/session-approval.test.ts (real-DB, reject + expiry paths — DB-connection blocked in this sandbox)"
        status: unknown
    human_judgment: true
    rationale: "Real-DB atomicity/idempotency assertions in session-approval.test.ts could not execute to completion in this sandbox (no reachable Postgres). Needs a re-run on a machine with the local test DB provisioned before full confidence."

duration: 65min
completed: 2026-07-27
status: complete
---

# Phase 22 Plan 01: Session Booking Approval Flow Summary

**Session-class bookings now default to `pending_owner_approval` with a real Έγκριση/Απόρριψη Telegram keyboard, atomic capacity-release + credit-restore on reject/expiry, and ownership/cross-tenant/idempotency guards on the new `sbk:` webhook callback route.**

## Performance

- **Duration:** ~65 min
- **Completed:** 2026-07-27
- **Tasks:** 3/3 completed
- **Files modified:** 8 (7 modified, 1 created)

## Accomplishments

- `bookSessionInstance()` gains an optional `initialStatus` parameter defaulting to `pending_owner_approval` (with a 2h expiry matching the existing sweep cutoff), and a new shared `releaseSessionCapacity()` function used by both the reject path and the expiry sweep.
- `runExpirySweep()` now calls a new `releaseExpiredSessionBooking()` for every expired session-class booking, releasing held capacity and restoring any deducted session credit via the existing `restoreCredit()` helper — reusing the existing 2-hour sweep, no new poller.
- All three client-initiated session-booking paths (client menu, free-chat single booking, free-chat multi-booking) now send an owner Έγκριση/Απόρριψη inline keyboard instead of a plain informational alert, and the client now receives a pending-request message instead of a premature confirmation.
- The three owner-already-decided call sites (`escl:approve`, `rescheduleSessionTool`, `assign_client_to_session`) explicitly pass `'confirmed'` to preserve their pre-existing immediate-confirm behavior against the new default.
- New `sbk:approve:<id>` / `sbk:reject:<id>` webhook callback routing in `handleCallbackQuery`, gated by owner-only (T-22-01), cross-tenant (T-22-02), and idempotent-CAS (T-22-03) guards, with reject atomically releasing capacity + restoring credit inside the ambient `withBusinessContext` transaction (T-22-04).

## Task Commits

Each task was committed atomically:

1. **Task 1: Service layer — pending-by-default booking creation, capacity release, expiry cleanup** - `b826104` (feat)
2. **Task 2: Booking-creation wiring — approval keyboards on new pending bookings, 'confirmed' overrides** - `160b96d` (feat)
3. **Task 3: Owner approval webhook routing, escl:approve override, and full test coverage** - `0890ead` (feat)

**Plan metadata:** committed separately by the orchestrator after this SUMMARY is written.

## Files Created/Modified

- `src/session/manager.ts` - `bookSessionInstance()` gains the `initialStatus` override parameter; new `releaseSessionCapacity()` export
- `src/conversation/expiry-poller.ts` - new `releaseExpiredSessionBooking()`, wired into `runExpirySweep()`'s per-booking loop
- `src/telegram/handlers/client-menu.ts` - `handleBookSessionExecute()` sends an approval keyboard + pending client message
- `src/conversation/function-executor.ts` - `bookSessionTool()` (single + multi-booking) sends approval keyboards; `rescheduleSessionTool()` passes `'confirmed'`
- `src/onboarding/ai-owner-agent.ts` - `assign_client_to_session` passes `'confirmed'`
- `src/webhooks/telegram.ts` - new `SessionBookingCallbackResult` type, `sbk:` `parseCallbackData` arm, `sbkAction` branch in `handleCallbackQuery`; `escl:approve` passes `'confirmed'`
- `tests/helpers/session-fixtures.ts` - new `insertTestSessionBooking()` fixture helper
- `tests/session/session-approval.test.ts` (new) - real-DB integration suite covering reject atomicity, double-tap idempotency, and expiry cleanup
- `tests/webhooks/client-menu.test.ts` - Suite C updated for pending wording/keyboard; new Suite F (7 tests) covering `sbk:` routing

## Decisions Made

None beyond what the plan already locked (D-01/D-02 from 22-RESEARCH.md, T-22-01 through T-22-04 threat mitigations) — implemented exactly as specified.

## Deviations from Plan

None — plan executed exactly as written. All `<action>` steps in all three tasks were followed verbatim, including the exact Greek copy, callback_data shapes, and guard ordering specified.

## Issues Encountered

**No reachable local Postgres test DB in this execution sandbox.** `tests/session-booking-flow.test.ts`, `tests/session-assignment.test.ts`, `tests/cancellation-cutoff.test.ts`, and the new `tests/session/session-approval.test.ts` all require a real local Postgres connection (`postgresql://manolis@localhost:5432/randevuclaw_test`). No Postgres server was reachable on port 5432 in this environment (`psql` not installed; a direct `pg` connection attempt failed; Docker Desktop's daemon was also unreachable). These suites compiled cleanly (confirming Task 1/3's code and the new test file are syntactically and type-correct) but could not execute to a pass/fail DB assertion here.

**Pre-existing, unrelated test-infra debt** (confirmed via a `git stash` baseline check against Plan 01's own edits, which reproduced identically before any of this plan's changes):
- `TS6200` identifier-conflict errors when `tests/session-booking-flow.test.ts` and `tests/session-assignment.test.ts` (and several other pre-existing non-module test files, e.g. `session-list.test.ts` / `enforcement-session-deduction.test.ts`) are matched together by a broad `--testPathPattern` — both lack a top-level `import`/`export`, so ts-jest treats each as a global script and TypeScript's checker rejects the duplicate global bindings.
- Stale `Business`/`Booking` test fixtures in `tests/expiry-poller.test.ts` (`OWNER_BUSINESS_1`, `makeExpiredBooking()`) predate several later-phase interface fields (`bookingMode`, `allowMultiBooking`, `cancellationCutoffEnabled`, `cancellationCutoffHours`, etc.), causing `TS2322`/`TS2345` compile errors that block the whole file — confirmed via `git diff src/database/queries.ts` showing zero changes to the `Business`/`Booking` interfaces from this plan.

Both are pre-existing, out of scope per the executor's SCOPE BOUNDARY rule (files not in this plan's `files_modified` list) and are logged in full detail in `.planning/phases/22-session-booking-approval-flow/deferred-items.md`.

**Verification actually achieved in this environment:**
- `npx tsc --noEmit -p tsconfig.json` — zero errors across all of `src/` after all three tasks.
- `npx jest --testPathPattern="webhooks/client-menu" --maxWorkers=1` — 37/37 passed (fully mocked, no live DB needed) — covers Task 2's keyboard wiring, Task 3's `sbk:` routing, ownership/cross-tenant/idempotency guards, and reject-path capacity-release + credit-restore call assertions.
- `npx jest --testPathPattern="client-escalation" --maxWorkers=1` — 17/17 passed, confirming the `escl:approve` override introduced no regression.
- `tests/session/session-approval.test.ts` compiles and runs up to the DB-connection layer (fails only on `AggregateError: connection refused`, identical to every other real-DB suite in this sandbox).

## User Setup Required

None for this plan's own deliverables — no new environment variables or external service configuration. However, to get a full green signal on the real-DB integration suites (including the new `tests/session/session-approval.test.ts`), a local Postgres instance matching the existing `randevuclaw_test` setup (see any of the affected test files' header comments) needs to be reachable in the execution environment; this was not available in this sandbox run.

## Next Phase Readiness

Phase 22's core session-booking approval flow is implemented and ready per code review + type-checking + the fully-mocked webhook test suite. Recommended before closing out this milestone phase: re-run `npx jest --testPathPattern="(session-booking-flow|session-assignment|expiry-poller|session-approval)" --maxWorkers=1` on a machine with the local Postgres test DB provisioned to get a genuine pass/fail signal on the real-DB atomicity and idempotency assertions, and consider a small follow-up fix to add `export {}` (or a real top-level import) to `session-booking-flow.test.ts` / `session-assignment.test.ts` / `session-list.test.ts` / `enforcement-session-deduction.test.ts` to resolve the pre-existing TS6200 conflict so the full `(session|booking|expiry)` pattern can run together without failing at the compile step.

---
*Phase: 22-session-booking-approval-flow*
*Completed: 2026-07-27*

## Self-Check: PASSED

All 9 created/modified source and test files confirmed present on disk; all 3 task commit hashes (`b826104`, `160b96d`, `0890ead`) confirmed present in `git log --oneline --all`.
