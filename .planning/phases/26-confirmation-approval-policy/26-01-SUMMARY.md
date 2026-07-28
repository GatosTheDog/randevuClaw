---
phase: 26-confirmation-approval-policy
plan: 01
subsystem: booking
tags: [drizzle, postgres, telegram, session-booking, reschedule, owner-approval]

# Dependency graph
requires:
  - phase: 22-session-booking-approval
    provides: pending_owner_approval default status, sbk:approve/reject CAS gate, releaseSessionCapacity
provides:
  - bookSessionInstance's 8th parameter (rescheduledFromBookingId), persisted on insert
  - rescheduleSessionTool defers old-booking cancellation to owner-approval time
  - sbk:approve cascade-cancels the superseded booking on approval
affects: [29-booking-list-clarity, future-session-booking-work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reschedule-hold pattern: create the new booking pending_owner_approval, link it to the old via rescheduledFromBookingId, only cascade-cancel the old booking once the owner approves the new one — reject leaves the old booking completely untouched."

key-files:
  created: []
  modified:
    - src/session/manager.ts
    - src/conversation/function-executor.ts
    - src/webhooks/telegram.ts
    - tests/session-assignment.test.ts
    - tests/session-booking-flow.test.ts
    - tests/webhooks/client-menu.test.ts

key-decisions:
  - "rescheduledFromBookingId appended as bookSessionInstance's 8th (last) parameter, not inserted before initialStatus, so the two existing call sites passing 'confirmed' as the 7th positional arg (escl:approve, assign_client_to_session) stay unaffected with zero edits."
  - "rescheduleSessionTool no longer cancels/restores the old booking upfront — it now creates the new booking pending_owner_approval and linked via rescheduledFromBookingId, leaving the old booking confirmed and untouched until the owner decides (D-03)."
  - "sbk:approve cascade-cancels the old booking on rescheduledFromBookingId but performs no credit restore for it — its credit was never touched by rescheduleSessionTool, so restoring would over-refund."
  - "sbk:reject arm required zero new logic — the old booking was never cancelled, so it stays confirmed automatically once the new (rejected) booking's capacity is released."

patterns-established:
  - "Deferred-cascade reschedule: link new-to-old via a booking-to-booking FK, cascade only on the terminal approval event, never on creation."

requirements-completed: [CONF-02]

coverage:
  - id: D1
    description: "bookSessionInstance accepts and persists an optional rescheduledFromBookingId (8th parameter), defaulting to null for every existing call site."
    requirement: "CONF-02"
    verification:
      - kind: integration
        ref: "tests/session-assignment.test.ts#bookSessionInstance persists the supplied rescheduledFromBookingId on the inserted bookings row"
        status: pass
      - kind: integration
        ref: "tests/session-assignment.test.ts#bookSessionInstance persists null rescheduledFromBookingId when the argument is omitted (unchanged existing behavior)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A client-initiated session reschedule no longer auto-confirms: the new booking is created pending_owner_approval and linked to the original; the original booking stays confirmed and untouched during the pending window."
    requirement: "CONF-02"
    verification:
      - kind: integration
        ref: "tests/session-booking-flow.test.ts#rescheduleSessionTool allows reschedule to session within membership expiry (SBOK-03)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Approving a rescheduled session booking (sbk:approve) cascade-cancels the superseded old booking and best-effort deletes its calendar event; rejecting leaves the old booking untouched."
    requirement: "CONF-02"
    verification:
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts#owner taps Έγκριση on a rescheduled booking → cascade-cancels the old booking and best-effort deletes its calendar event"
        status: pass
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts#owner taps Έγκριση on a non-rescheduled booking (rescheduledFromBookingId=null) → updateBookingStatus is never called for a cascade"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-28
status: complete
---

# Phase 26 Plan 01: Reverse reschedule auto-confirm, require owner approval (CONF-02) Summary

**Client session-booking reschedules now route through the same Έγκριση/Απόρριψη owner-approval cascade as new bookings — a rejected reschedule leaves the client's original booking fully intact, via a new rescheduledFromBookingId link consumed by a cascade-cancel added to sbk:approve.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-28T07:42:14Z
- **Completed:** 2026-07-28T07:55:51Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- `bookSessionInstance` gained an 8th parameter (`rescheduledFromBookingId`) persisted on the bookings insert, wired without touching any existing call site
- `rescheduleSessionTool` no longer immediately cancels the client's old booking — the new booking is created `pending_owner_approval`, linked back to the old one, and the owner gets an Έγκριση/Απόρριψη keyboard worded as a reschedule request
- `sbk:approve` now cascade-cancels the superseded old booking (and best-effort deletes its calendar event) exactly once per approval, with no double-refund of credit; `sbk:reject` needed zero new code since the old booking was never touched

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire rescheduledFromBookingId into bookSessionInstance** - `009cdc3` (feat)
2. **Task 2: Rewrite rescheduleSessionTool to defer old-booking cancellation to owner approval (D-01/D-02/D-03)** - `0f8ff6b` (feat)
3. **Task 3: Cascade-cancel the superseded booking on sbk:approve (D-03)** - `be639f1` (feat)

_No TDD tasks in this plan — all three were straight `auto` tasks with integration/unit test additions per acceptance criteria._

## Files Created/Modified
- `src/session/manager.ts` - `bookSessionInstance`'s new 8th parameter `rescheduledFromBookingId`, persisted on the bookings insert
- `src/conversation/function-executor.ts` - `rescheduleSessionTool` defers old-booking cancellation, links the new booking, sends the owner an approval keyboard, returns `status: 'pending_owner_approval'`
- `src/webhooks/telegram.ts` - `sbk:approve` arm cascade-cancels the linked old booking and best-effort deletes its calendar event
- `tests/session-assignment.test.ts` - 2 new integration tests for the persisted/defaulted `rescheduledFromBookingId`
- `tests/session-booking-flow.test.ts` - extended SBOK-03's "allows reschedule" test to assert the new pending/linked booking, the untouched old booking, and the accepted double-hold `bookedCount` increment on both instances
- `tests/webhooks/client-menu.test.ts` - 2 new Suite F tests covering the cascade firing (and not firing) on `sbk:approve`

## Decisions Made
- `rescheduledFromBookingId` appended as the LAST parameter (8th) rather than inserted before `initialStatus`, preserving both existing call sites (`escl:approve`, `assign_client_to_session`) with zero edits — deviates from 26-PATTERNS.md's illustrative diff, which showed it inserted before `initialStatus`; that ordering would have silently reinterpreted those call sites' existing 7th positional `'confirmed'` argument as the new parameter.
- No credit-restore call added anywhere for the cascade-cancelled old booking — per D-03, its credit was never touched during the pending window, so restoring it now would over-refund the client.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed a pre-existing test-data collision blocking Task 2's required verification**
- **Found during:** Task 2 (extending the SBOK-03 "allows reschedule" test)
- **Issue:** The existing `instanceC` test fixture used `addDays(5)` — identical to `instanceA`'s date in the same describe block's shared `catalogId` — which collides with the DB's `unique_session_instance` index `(catalog_id, session_date, session_time)`, causing the exact test this plan's Task 2 was required to extend and pass to fail on insert.
- **Fix:** Changed `instanceC`'s test date from `addDays(5)` to `addDays(6)`.
- **Files modified:** tests/session-booking-flow.test.ts
- **Verification:** `npx jest --testPathPattern="session-booking-flow.test.ts"` — the target SBOK-03 test now passes.
- **Committed in:** `0f8ff6b` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to make the plan's own required verification command pass. No scope creep — only the colliding test date changed, no application code touched by this fix.

## Issues Encountered
- Local integration tests require a real Postgres connection (`SESSION_TEST_DATABASE_URL`/`BILLING_TEST_DATABASE_URL`, defaulting to `postgresql://manolis@localhost:5432/randevuclaw_test`). This Windows dev machine had no reachable Postgres on port 5432 (SASL auth error) but did have a stopped `randevuclaw-pg` Docker container mapped to host port 5433 with matching credentials (`manolis`/`password`); started it and pointed the test env vars at port 5433 to run all three plan verification commands for real, rather than relying on `tsc`/build alone.
- A pre-existing, out-of-scope test bug was discovered and left unfixed: `tests/session-booking-flow.test.ts`'s "SBOK-04: multi-session booking" → "multi-booking partial success" test inserts a second active session catalog for the same `(businessId, serviceId)` pair already used by that describe block's `beforeAll`, violating the DB's `unique_active_catalog_per_business_service` partial index. Reproduced identically on a clean baseline (`git stash` of this plan's changes) before any Phase 26 edits, confirming it predates this plan and lives in a different describe block than any file this plan touches. Logged to `.planning/phases/26-confirmation-approval-policy/deferred-items.md` per the scope-boundary rule, not fixed.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CONF-02 is fully satisfied: session-class reschedules now route through the same owner approve/reject cascade as new bookings, with a rejected reschedule leaving the client's original booking completely intact.
- The remaining Phase 26 scope (CONF-01, uniform confirmation-policy buttons across the 5 named destructive actions) is presumably covered by a separate plan (26-02-PLAN.md exists in this phase directory) — not part of this plan.
- The pre-existing SBOK-04 test bug (see Issues Encountered) should be picked up by a future test-suite-health pass; it does not block this plan's requirement.

---
*Phase: 26-confirmation-approval-policy*
*Completed: 2026-07-28*
