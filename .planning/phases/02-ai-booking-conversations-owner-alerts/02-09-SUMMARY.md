---
phase: 02-ai-booking-conversations-owner-alerts
plan: 9
subsystem: database
tags: [drizzle, postgres, concurrency, telegram, race-condition]

# Dependency graph
requires:
  - phase: 02-ai-booking-conversations-owner-alerts
    provides: Plan 02-05's owner-approval callback_query handler and Plan 02-06's CR-02 client-booking-side race fix
provides:
  - updateBookingStatusIfPending atomic compare-and-swap query
  - handleCallbackQuery rewritten to gate notify/cascade/button-clear entirely on the CAS return value
affects: [owner-approval-flow, booking-status-transitions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic compare-and-swap via a single UPDATE...WHERE...RETURNING as the sole concurrency guard, replacing read-then-write races"

key-files:
  created: []
  modified:
    - src/database/queries.ts
    - src/webhooks/telegram.ts
    - tests/booking-queries.test.ts
    - tests/telegram-webhook.test.ts

key-decisions:
  - "updateBookingStatusIfPending's WHERE clause (id + bookingStatus='pending_owner_approval') is the sole concurrency guard — no separate read-then-check step"
  - "Reschedule cascade (cancel of the ORIGINAL booking) stays a plain unconditional updateBookingStatus call since it targets a different row than the one just compare-and-swapped"

patterns-established:
  - "Pattern: state-transition guards belong in the WHERE clause of the mutating query itself, not in application code reading a prior SELECT"

requirements-completed: [OWNR-02]

coverage:
  - id: D1
    description: "updateBookingStatusIfPending atomic CAS query: transitions a pending booking and returns it, or returns null if already resolved"
    requirement: "OWNR-02"
    verification:
      - kind: integration
        ref: "tests/booking-queries.test.ts#updateBookingStatusIfPending Test 4"
        status: pass
      - kind: integration
        ref: "tests/booking-queries.test.ts#updateBookingStatusIfPending Test 5"
        status: pass
    human_judgment: false
  - id: D2
    description: "handleCallbackQuery uses the atomic update's return value as the sole gate for notify/cascade/button-clear, closing the owner-approval double-tap race"
    requirement: "OWNR-02"
    verification:
      - kind: unit
        ref: "tests/telegram-webhook.test.ts#Test 5: approves a pending booking"
        status: pass
      - kind: unit
        ref: "tests/telegram-webhook.test.ts#Test 6: rejects a pending booking"
        status: pass
      - kind: unit
        ref: "tests/telegram-webhook.test.ts#Test 7: reschedule approval cascades"
        status: pass
      - kind: unit
        ref: "tests/telegram-webhook.test.ts#Test 8: reschedule rejection does NOT cascade"
        status: pass
      - kind: unit
        ref: "tests/telegram-webhook.test.ts#Test 12: already-resolved booking (re-tap)"
        status: pass
      - kind: unit
        ref: "tests/telegram-webhook.test.ts#Test 13: concurrent double-tap on the same booking"
        status: pass
    human_judgment: true
    rationale: "Plan's verify block includes a <human-check> requiring a real double-tap test against a live Telegram bot with two client sessions — automated tests prove the logic but not the live end-to-end race outcome."

# Metrics
duration: 10min
completed: 2026-07-08
status: complete
---

# Phase 2 Plan 9: Owner-Approval Atomic Compare-and-Swap (WR-05 Gap Closure) Summary

**Replaced the owner-approval callback_query handler's read-then-write race with a single atomic `UPDATE...WHERE bookingStatus='pending_owner_approval'...RETURNING` compare-and-swap, closing WR-05.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-07-08T22:35:00+03:00 (approx)
- **Completed:** 2026-07-08T22:41:34+03:00
- **Tasks:** 2 completed
- **Files modified:** 4

## Accomplishments
- Added `updateBookingStatusIfPending(bookingId, newStatus)` to `src/database/queries.ts`: a single atomic UPDATE whose WHERE clause (`id` + `bookingStatus = 'pending_owner_approval'`) is the sole concurrency guard — proven against a real local Postgres connection.
- Rewrote `handleCallbackQuery` in `src/webhooks/telegram.ts` to delete the old read-then-check (`booking.bookingStatus !== 'pending_owner_approval'`) and gate all downstream effects (client notification, reschedule cascade, button-clear) entirely on the CAS call's return value.
- Reschedule cascade (`updateBookingStatus(rescheduledFromBookingId, 'cancelled')`) intentionally left as a plain, unconditional call — it always targets a different booking row than the one just compare-and-swapped.
- Added a new automated regression test (Test 13) that fires two concurrent `postWebhook` requests with the same `approve_42` callback data and asserts `sendTelegramMessage` fires exactly once, proving the race is closed.

## Task Commits

Each task followed RED → GREEN TDD:

1. **Task 1: Add atomic compare-and-swap booking-status query**
   - `3512b40` (test): add failing tests for `updateBookingStatusIfPending`
   - `faa5a0a` (feat): implement `updateBookingStatusIfPending`
2. **Task 2: Replace the read-then-write owner-approval race with the atomic compare-and-swap**
   - `d1a4dcc` (test): update owner-approval tests for atomic CAS gate, add concurrent double-tap test
   - `4bc07d1` (feat): rewrite `handleCallbackQuery` to gate on the CAS return value

## Files Created/Modified
- `src/database/queries.ts` - Added `updateBookingStatusIfPending` atomic compare-and-swap query
- `src/webhooks/telegram.ts` - `handleCallbackQuery` now gates notify/cascade/button-clear on the CAS return value instead of a separate read-then-check
- `tests/booking-queries.test.ts` - New `updateBookingStatusIfPending` describe block (2 tests, real Postgres)
- `tests/telegram-webhook.test.ts` - Updated Tests 5/6/7/8/12 to mock `updateBookingStatusIfPending`; added Test 13 (concurrent double-tap regression)

## Decisions Made
- The WHERE clause on the UPDATE statement is treated as the entire concurrency contract — no advisory locks, no `SELECT ... FOR UPDATE`, no application-level mutex. This matches the existing pattern already used by `insertBooking`'s unique-index-based conflict detection (Plan 02-04/02-06).
- `updateBookingStatus` (the non-atomic setter) remains in place and in use, but now ONLY for the reschedule cascade's mutation of a different booking row — never for the primary transition subject to the double-tap race.

## Deviations from Plan

None - plan executed exactly as written.

## TDD Gate Compliance

Both tasks show RED (`test(...)`) commits immediately followed by GREEN (`feat(...)`) commits in git log, with all previously-failing tests passing after implementation and no REFACTOR step needed (implementation was minimal and complete after GREEN).

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- WR-05 is closed. Combined with Plan 02-06's CR-02 fix on the client-booking side, ROADMAP.md's Phase 2 Success Criterion 5 ("two clients attempting to book the exact same slot at the same time never both succeed") now has both its client-booking-insert path and its owner-approval-transition path protected by atomic DB-level compare-and-swap/unique-index guards.
- Full regression suite (139 tests across 18 suites) and `npx tsc --noEmit` both pass clean after this plan.
- The plan's `<human-check>` (a live double-tap test against a real Telegram bot with two client sessions) was not performed by this executor — it requires a running bot deployment and manual interaction, which is out of scope for an autonomous `type="auto"` task. Recommend running it during Phase 2's end-of-phase human verification pass.

---
*Phase: 02-ai-booking-conversations-owner-alerts*
*Completed: 2026-07-08*
