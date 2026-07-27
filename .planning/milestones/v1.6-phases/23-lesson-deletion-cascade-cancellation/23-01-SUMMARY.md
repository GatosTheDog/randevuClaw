---
phase: 23-lesson-deletion-cascade-cancellation
plan: 01
subsystem: booking
tags: [drizzle, postgres, telegram, gemini, session-booking, cascade-cancel]

# Dependency graph
requires:
  - phase: 08-billing-enforcement
    provides: restoreCredit / findMembershipByBooking (Phase 8 billing/queries.ts, reused verbatim)
  - phase: 22-session-booking-approval
    provides: releaseSessionCapacity (Phase 22 session/manager.ts, reused verbatim)
provides:
  - findActiveBookingsForSessionInstance query helper (src/database/queries.ts)
  - cascadeCancelSessionBookings service function (src/session/manager.ts)
  - admin-menu.ts handleClassCancelExecute wired to cascade-cancel
  - ai-owner-agent.ts cancel_session tool case wired to cascade-cancel
affects: [scheduler-session-cancellation, client-menu, billing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-booking CAS UPDATE (WHERE bookingStatus IN (...) RETURNING-gated) closes the TOCTOU gap between a bulk SELECT and a subsequent per-row mutation loop"
    - "Cascade functions invoked only after the primary idempotent-guard mutation (cancelSession) returns true — that ordering is what makes the whole cascade a safe no-op on replay"

key-files:
  created:
    - tests/session-cascade.test.ts
    - tests/ai-owner-cancel-session.test.ts
  modified:
    - src/database/queries.ts
    - src/session/manager.ts
    - src/telegram/handlers/admin-menu.ts
    - src/onboarding/ai-owner-agent.ts
    - tests/admin-menu.test.ts

key-decisions:
  - "findActiveBookingsForSessionInstance deliberately does NOT join clientBusinessRelationships (unlike the existing poller's query) — a booking created via assign_client_to_session can exist with no prior relationship row, and an INNER JOIN would silently exclude it from cascade-cancellation"
  - "Booking-ID-scoped idempotency key (lesson-deletion:{instanceId}:booking:{bookingId}) for restoreCredit — never an instance-level key — to prevent idempotency-key collisions across multiple bookings on the same instance"
  - "cascadeCancelSessionBookings self-wraps in its own withBusinessContext (mirrors cancelSession) since it is called from two structurally different caller contexts (ambient-wrapped admin-menu callback path vs self-wrapped AI tool path)"

patterns-established:
  - "Pattern: cascade-cancel functions that mutate N child rows after a parent soft-delete flip should re-derive their own per-row CAS guard rather than trusting the initial candidate SELECT, since a concurrent client-initiated action could transition an individual row between the SELECT and the mutation"

requirements-completed: [CLSS-06, CLSS-07]

coverage:
  - id: D1
    description: "cascadeCancelSessionBookings cascade-cancels every active booking on a session instance: status flip to 'cancelled', credit restore via restoreCredit (skipped for unlimited/null-sessionsRemaining memberships), capacity release exactly once per booking"
    requirement: "CLSS-07"
    verification:
      - kind: integration
        ref: "tests/session-cascade.test.ts#(a) cascade-cancels all active bookings for the instance"
        status: pass
      - kind: integration
        ref: "tests/session-cascade.test.ts#(b) unlimited membership (sessionsRemaining null) is silently skipped"
        status: pass
    human_judgment: false
  - id: D2
    description: "Each cancelled booking triggers a best-effort Greek business-initiated notification, distinct wording from the poller, isolated per client (one failure never blocks the rest of the loop)"
    requirement: "CLSS-07"
    verification:
      - kind: integration
        ref: "tests/session-cascade.test.ts#(c) sends a Greek business-initiated notification per booking"
        status: pass
      - kind: integration
        ref: "tests/session-cascade.test.ts#(g) per-client notification isolation (T-23-03)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Cross-tenant scoping: cascade-cancelling one business's instance never touches another business's bookings/memberships/capacity"
    requirement: "CLSS-07"
    verification:
      - kind: integration
        ref: "tests/session-cascade.test.ts#(d) cross-tenant scoping (T-23-01)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Idempotent replay: re-invoking cascadeCancelSessionBookings on an already-cascaded instance is a safe no-op (no double credit restore, no double capacity release)"
    requirement: "CLSS-07"
    verification:
      - kind: integration
        ref: "tests/session-cascade.test.ts#(f) idempotent replay (T-23-02)"
        status: pass
      - kind: integration
        ref: "tests/session-cascade.test.ts#(e) zero-booking instance"
        status: pass
    human_judgment: false
  - id: D5
    description: "Admin-menu handleClassCancelExecute calls cascadeCancelSessionBookings only when cancelSession succeeds, reports the affected count (or no-bookings wording) in Greek, and always sends the trailing keyboard"
    requirement: "CLSS-06"
    verification:
      - kind: unit
        ref: "tests/admin-menu.test.ts#handleClassCancelExecute — cascade-cancel wiring (CLSS-07)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Free-chat cancel_session tool case calls cascadeCancelSessionBookings only when cancelSession succeeds, and its returned string reports the affected count instead of referencing the async poller"
    requirement: "CLSS-06"
    verification:
      - kind: unit
        ref: "tests/ai-owner-cancel-session.test.ts#cancel_session tool case — cascade-cancel wiring (CLSS-07)"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-07-27
status: complete
---

# Phase 23 Plan 01: Cascade-Cancel Bookings on Lesson Deletion Summary

**cascadeCancelSessionBookings shared service function wired into both admin-menu and free-chat lesson cancellation, restoring credit, releasing capacity, and sending Greek business-initiated notifications for every active booking on a cancelled session instance**

## Performance

- **Duration:** 45 min
- **Tasks:** 3
- **Files modified:** 7 (2 new test files, 5 modified source/test files)

## Accomplishments

- New `findActiveBookingsForSessionInstance` query helper (src/database/queries.ts) returning active (confirmed/pending_owner_approval) bookings for a session instance, scoped by businessId, deliberately without the poller's clientBusinessRelationships JOIN.
- New `cascadeCancelSessionBookings` service function (src/session/manager.ts) that, for every active booking on a cancelled instance: CAS-flips the booking to `'cancelled'`, restores session credit via the existing Phase 8 `restoreCredit`/`findMembershipByBooking` (booking-scoped idempotency key), releases capacity once via Phase 22's `releaseSessionCapacity`, best-effort deletes the calendar event, and best-effort notifies the client in Greek with business-initiated wording distinct from the 6-hour poller's message.
- Both existing cancellation call sites (admin-menu's `handleClassCancelExecute` and the AI owner-agent's `cancel_session` tool case) now invoke `cascadeCancelSessionBookings` immediately after `cancelSession()` succeeds, closing the "cancels the instance but silently ignores active bookings" gap from ROADMAP.md.
- 7 new real-DB integration tests (tests/session-cascade.test.ts) proving status flip, unlimited-membership skip, Greek wording, cross-tenant scoping, idempotent replay, and per-client notification isolation.
- 3 new admin-menu wiring tests and 3 new ai-owner-agent wiring tests proving the cascade is only invoked on a successful cancel and never on an already-cancelled/no-match path.

## Task Commits

1. **Task 1: Core cascade engine — query helper, cascadeCancelSessionBookings, and full integration test suite** - `02cc385` (feat)
2. **Task 2: Wire admin-menu.ts's handleClassCancelExecute to cascade-cancel** - `e0478ed` (feat)
3. **Task 3: Wire ai-owner-agent.ts's cancel_session tool case to cascade-cancel** - `6962653` (feat)

_Note: this plan's tasks were all `type="auto"` — no TDD gate tasks, single commit per task._

## Files Created/Modified

- `src/database/queries.ts` - Added `findActiveBookingsForSessionInstance(businessId, sessionInstanceId)`.
- `src/session/manager.ts` - Added `cascadeCancelSessionBookings(business, sessionInstanceId)` after `cancelSession`.
- `src/telegram/handlers/admin-menu.ts` - `handleClassCancelExecute` now calls `cascadeCancelSessionBookings` on successful cancel and reports the affected count.
- `src/onboarding/ai-owner-agent.ts` - `cancel_session` tool case now calls `cascadeCancelSessionBookings` and returns an accurate synchronous affected-count message instead of deferring to the poller.
- `tests/session-cascade.test.ts` - New real-DB integration test file (7 tests).
- `tests/admin-menu.test.ts` - New describe block (3 tests) for the cascade wiring.
- `tests/ai-owner-cancel-session.test.ts` - New unit test file (3 tests) for the free-chat cascade wiring.

## Decisions Made

- `findActiveBookingsForSessionInstance` intentionally omits the `clientBusinessRelationships` JOIN present in the existing poller's query — an owner-assigned booking (via `assign_client_to_session`) can exist with no prior relationship row, and joining would silently exclude it from cascade-cancellation, leaving an un-refunded, un-released booking.
- Credit-restore idempotency key is scoped per booking (`lesson-deletion:{instanceId}:booking:{bookingId}`), not per instance, to avoid a UNIQUE-constraint collision across multiple bookings cancelled in the same cascade call.
- `cascadeCancelSessionBookings` self-wraps its own `withBusinessContext` (matching `cancelSession`'s existing pattern) since it is invoked from two structurally different call sites — one already inside an ambient transaction (admin-menu callback path) and one that is not (AI tool case, which self-wraps per-tool like `deactivate_package`/`set_enforcement_policy`). Nested `withBusinessContext` calls are already proven safe in exactly this call chain since `cancelSession` itself is called from both contexts today.
- Per-booking CAS UPDATE (`WHERE bookingStatus IN ('confirmed','pending_owner_approval')` RETURNING-gated) closes a narrow TOCTOU gap between the initial candidate SELECT and this function's own mutation — if a booking was already transitioned by a concurrent path (e.g. client-initiated cancel), it is silently skipped rather than double-processed.

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria from the plan's `must_haves` and per-task `<acceptance_criteria>` blocks were met without any Rule 1/2/3/4 deviations.

## Issues Encountered

- Test fixture collisions: the plan's `<read_first>` guidance mirrored existing test files but did not call out that `insertTestSessionInstance` defaults `sessionDate`/`sessionTime` and `insertTestSessionBooking` defaults `calendarTime`, both of which collide across the 7 new scenarios sharing one catalog/business under the DB's `unique_session_instance` and `unique_active_slot_per_business` partial-unique indexes. Resolved by assigning a distinct `sessionDate` per test instance and a distinct `calendarTime` per booking — no production code changes needed, test-only fix, not tracked as a deviation since it did not touch any file in the plan's `files_modified` list beyond the test file itself.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CLSS-06 and CLSS-07 are both fully satisfied; the pre-existing 6-hour `pollSessionCancellations` poller remains completely unmodified and continues to run as a defensive backstop for any instance the synchronous cascade might miss (it never touched by this plan).
- All 25 tests across `session-cascade.test.ts`, `admin-menu.test.ts`, and `ai-owner-cancel-session.test.ts` pass, and the pre-existing `session-cancel.test.ts` (5 tests, unmodified) remains green — confirming no regression to `cancelSession`/poller behavior.
- Ready for Phase 24 (persistent menu button + owner diagnostics follow-up) with no outstanding blockers from this plan.

---
*Phase: 23-lesson-deletion-cascade-cancellation*
*Completed: 2026-07-27*

## Self-Check: PASSED

All created/modified files verified present on disk; all 3 task commit hashes (02cc385, e0478ed, 6962653) verified present in git log.
