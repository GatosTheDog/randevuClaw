---
phase: 02-ai-booking-conversations-owner-alerts
plan: 8
subsystem: testing
tags: [expiry-poller, telegram, error-isolation, jest, gap-closure]

# Dependency graph
requires:
  - phase: 02-ai-booking-conversations-owner-alerts
    provides: runExpirySweep and the D-09 2-hour pending-booking expiry poller (plan 02-05)
provides:
  - Per-booking try/catch isolation inside runExpirySweep's inner loop, nested inside the existing per-business isolation
affects: [02-ai-booking-conversations-owner-alerts, owner-alert-reliability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Nested error isolation: outer try/catch isolates per-business sweep failures, inner try/catch isolates per-booking notification failures within an already-expired batch"

key-files:
  created: []
  modified:
    - src/conversation/expiry-poller.ts
    - tests/expiry-poller.test.ts

key-decisions:
  - "Per-booking try/catch wraps the sendTelegramMessage call, notifiedCount increment, and button-clear block together as a single unit — if notification fails, the button-clear for that booking is also skipped rather than run independently"

patterns-established:
  - "Two-layer isolation pattern for batch sweeps: never let one item's failure inside an already-committed batch silently drop remaining items, since those items may be unreachable by any future retry"

requirements-completed: [OWNR-02]

coverage:
  - id: D1
    description: "A sendTelegramMessage rejection for one booking in a multi-booking sweep batch no longer prevents notification for the next booking in that same batch (CR-04 closed)"
    requirement: "OWNR-02"
    verification:
      - kind: unit
        ref: "tests/expiry-poller.test.ts#Test 7 (CR-04): one booking notification failure does not stop notification for the rest of the same batch"
        status: pass
    human_judgment: false
  - id: D2
    description: "Existing per-business error isolation (Test 4) remains unaffected by the new per-booking isolation layer"
    verification:
      - kind: unit
        ref: "tests/expiry-poller.test.ts#Test 4: one business failing does not stop the sweep for others, and is logged (error isolation)"
        status: pass
    human_judgment: false
  - id: D3
    description: "End-to-end live verification against a real Telegram bot + Postgres with one client chat deliberately unreachable"
    verification: []
    human_judgment: true
    rationale: "Requires a live Telegram bot, real Postgres instance, and a deliberately-unreachable chat id — not reproducible in the automated unit-test harness; the plan's <verify><human-check> explicitly calls for manual end-to-end confirmation"

# Metrics
duration: 12min
completed: 2026-07-08
status: complete
---

# Phase 02 Plan 8: Expiry-Sweep Per-Booking Notification Isolation (CR-04) Summary

**Nested per-booking try/catch inside runExpirySweep's inner loop so one Telegram send failure no longer permanently silences notification for the rest of an already-expired batch**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-08T19:26:00Z
- **Completed:** 2026-07-08T19:38:00Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Closed CR-04: `runExpirySweep`'s inner `for (const booking of expired)` loop now wraps the `sendTelegramMessage` call, `notifiedCount` increment, and the conditional `editTelegramMessageReplyMarkup` button-clear block in a per-booking try/catch, nested inside the existing per-business try/catch
- On a per-booking failure, `logger.error({ err, bookingId }, 'Failed to notify client of expired booking')` is logged and the loop continues to the next booking in the array instead of aborting the rest of that business's batch
- Added a new TDD-driven regression test (Test 7) proving a `sendTelegramMessage` rejection for one booking does not block notification of a second booking in the same sweep batch, and that `notifiedCount` only counts successful notifications
- Verified the existing per-business isolation test (Test 4) is unaffected — the two isolation layers are additive, not a replacement

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1 (RED): add failing test for per-booking notification isolation** - `98698c3` (test)
2. **Task 1 (GREEN): isolate per-booking notification failures in expiry sweep** - `16702fe` (fix)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `src/conversation/expiry-poller.ts` - Added per-booking try/catch inside `runExpirySweep`'s inner loop, nested inside the existing per-business try/catch; logs `bookingId`-tagged errors on failure and continues the loop
- `tests/expiry-poller.test.ts` - Added Test 7 (CR-04): asserts `sendTelegramMessage` is called for both bookings in a batch even when the first one rejects, `notifiedCount` is 1, and `logger.error` is called once with the failed booking's id

## Decisions Made
- The per-booking try/catch treats notification-send and button-clear as one atomic unit of isolation (if the Telegram send fails, the button-clear for that same booking is also skipped rather than attempted independently) — matches the plan's exact fix specification and keeps the change minimal and additive to the existing per-business layer.

## Deviations from Plan

None - plan executed exactly as written. Followed the plan's TDD flow (RED test first confirming failure with 1 test failing / 6 passing, then GREEN implementation confirming all 7 tests pass).

## Issues Encountered

None. Full regression suite (`npm test`, 18 suites / 137 tests) and `npx tsc --noEmit` both pass with zero failures/errors after the change.

## TDD Gate Compliance

Both gates present in git log:
- RED gate: `98698c3 test(02-08): add failing test for per-booking notification isolation (CR-04)` — confirmed 1 failing test / 6 passing before the fix
- GREEN gate: `16702fe fix(02-08): isolate per-booking notification failures in expiry sweep (CR-04)` — confirmed all 7 tests pass after the fix

No REFACTOR commit was needed — the fix was minimal and required no follow-up cleanup.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CR-04 gap closure complete; OWNR-02's expiry-sweep notification reliability guarantee now holds at the per-booking level, matching the existing per-business isolation pattern
- The plan's `<verify><human-check>` end-to-end live-Telegram verification (D3 above) remains a human-judgment item — not automatable in this unit-test harness — and should be confirmed manually before considering Phase 02's gap-closure work fully signed off across all 6 critical findings plus the race-condition item from the code review

## Self-Check: PASSED

- FOUND: src/conversation/expiry-poller.ts
- FOUND: tests/expiry-poller.test.ts
- FOUND: .planning/phases/02-ai-booking-conversations-owner-alerts/02-08-SUMMARY.md
- FOUND commit: 98698c3 (test: RED)
- FOUND commit: 16702fe (fix: GREEN)
- FOUND commit: ab36338 (docs: plan metadata)

---
*Phase: 02-ai-booking-conversations-owner-alerts*
*Completed: 2026-07-08*
