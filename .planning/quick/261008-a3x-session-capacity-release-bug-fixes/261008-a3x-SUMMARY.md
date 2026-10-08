---
phase: quick-261008-a3x
plan: 01
subsystem: session-booking
tags: [bug-fix, session-capacity, cancellation, reschedule]

requires:
  - phase: 22-session-booking-approval-flow (v1.6)
    provides: releaseSessionCapacity, the capacity-counter primitive this fix calls at three previously-missing call sites
  - phase: 26-confirmation-approval-policy
    provides: the reschedule-approve cascade this fix extends with a capacity release

provides:
  - "handleCancelExecute (client /cancel menu) now releases the session instance's held seat on cancel"
  - "cancelAppointmentTool (free-chat cancel, both the cutoff-forfeiture and normal branches) now releases the seat on cancel"
  - "sbk:approve reschedule cascade now releases the OLD booking's seat, not just incrementing the new slot's bookedCount"
affects: [client-menu, function-executor, webhooks/telegram]

tech-stack:
  added: []
  patterns:
    - "Mirrors the exact releaseExpiredSessionBooking guard (if (!booking.sessionInstanceId) return;) already proven correct elsewhere in the codebase — every capacity-release call site in the codebase now follows the identical shape"

key-files:
  created: []
  modified:
    - src/telegram/handlers/client-menu.ts
    - src/conversation/function-executor.ts
    - src/webhooks/telegram.ts
    - tests/webhooks/client-menu.test.ts
    - tests/function-executor-calendar.test.ts

key-decisions:
  - "Forfeiture-branch cancel (client loses their session credit for cancelling within the cutoff window) still releases capacity — forfeiting a credit is a billing outcome, not a capacity one; the physical seat frees up either way"
  - "Scoped to exactly the three missing call sites, not a broader audit — a separate, more thorough fix (completeRescheduleOnApproval with foreign-original guards, replay-safety, unlimited-membership handling) is already specified in the pre-existing, unimplemented Phase 26 plans 26-03/04/05 and intentionally left for that larger effort rather than half-duplicated here"

requirements-completed: []

coverage:
  - id: B1
    description: "Client self-cancel via the /cancel menu releases the session instance's capacity for a fixed_sessions booking, and never attempts to for an open-slot booking (sessionInstanceId null)"
    verification:
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts — 'cancel:yes — session-class booking ... releaseSessionCapacity called' / '... open-slot booking ... NOT called'"
        status: pass
    human_judgment: false
  - id: B2
    description: "Free-chat cancel (both forfeiture and normal branches) releases capacity for a session-class booking"
    verification:
      - kind: unit
        ref: "tests/function-executor-calendar.test.ts — 'cancel_appointment releases session capacity (bug fix)' suite, 3 tests"
        status: pass
    human_judgment: false
  - id: B3
    description: "Approving a reschedule releases the OLD booking's session-instance capacity, not only the new slot's increment"
    verification:
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts — \"owner taps Έγκριση on a rescheduled booking → also releases the OLD booking's session-instance capacity\""
        status: pass
    human_judgment: false

duration: unknown (single continuous session)
completed: 2026-10-08
status: complete
---

# Quick Task 261008-a3x: Session-Instance Capacity Release on Cancel and Reschedule-Approve — Summary

**Retroactive documentation.** Found during a requested bug-hunt sweep of the booking/subscription logic, fixed, tested, and already pushed to `origin/main` (commit `c0d5717`) prior to this GSD reconciliation pass.

## Accomplishments

Found that three separate cancellation/supersession paths cancelled or replaced a `fixed_sessions` booking without ever decrementing the session instance's `bookedCount` — the counter that `listSessions`'s availability filter (`bookedCount < capacity`) relies on. Over time this silently shrank a recurring class's real bookable availability every time a client booked-then-cancelled it, or rescheduled — the class would eventually show as permanently full even with real no-shows.

Fixed by calling the existing `releaseSessionCapacity(sessionInstanceId)` at each site, guarded by `sessionInstanceId !== null` (the same guard already proven correct in `releaseExpiredSessionBooking`, `conversation/expiry-poller.ts`):

1. `handleCancelExecute` (`client-menu.ts`) — the client's own `/cancel` menu flow.
2. `cancelAppointmentTool` (`function-executor.ts`) — the free-chat AI cancel tool, both its cutoff-forfeiture branch and its normal branch.
3. The `sbk:approve` reschedule cascade (`webhooks/telegram.ts`) — approving a reschedule cancels the OLD booking but was never releasing *its* seat, only ever growing the new slot's `bookedCount`.

## Task Commits
- `c0d5717` fix: release session-instance capacity on client cancel and reschedule-approve cascade

## Decisions Made
See `key-decisions` in frontmatter above.

## Deviations from Plan
No PLAN.md existed — found via an ad-hoc code-reading sweep requested conversationally, not a pre-scoped GSD plan.

## Issues Encountered
None. All three fixes typechecked clean and were verified with new, targeted tests (9 new/updated test cases across 2 test files), each test file run individually per the one-file-at-a-time testing rule established earlier in this session.

## User Setup Required
None — already pushed.

## Next Phase Readiness
- A more thorough version of fix #3 above (foreign-original tampering guard, unlimited-membership handling, replay-safety, owner-cancels-original-mid-flight interaction, plus a brand-new "your original booking is still active" expiry notice) is specified but NOT yet implemented in Phase 26's plans 26-03/04/05. This quick fix covers the basic case those plans also call for; the fuller design is still open and was explicitly deferred by the user during this same GSD reconciliation pass (see Phase 26 status in STATE.md/ROADMAP.md).

---
*Phase: quick-261008-a3x*
*Completed: 2026-10-08*
