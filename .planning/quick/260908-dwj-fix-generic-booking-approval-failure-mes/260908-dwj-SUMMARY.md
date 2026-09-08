---
phase: quick-260908-dwj
plan: 01
subsystem: bot
tags: [telegram, session-booking, owner-callback, greek-messages]

requires: []
provides:
  - "resolveSbkCasFailureMessage helper distinguishing 4 CAS-miss causes (expired/confirmed/rejected-cancelled/not-found) for sbk: approve/reject owner callbacks"
affects: [telegram-webhook, session-booking]

tech-stack:
  added: []
  patterns:
    - "Fresh post-CAS-miss findBookingByIdUnscoped re-read (never reusing a pre-CAS snapshot) to resolve a status-specific owner-facing message"

key-files:
  created: []
  modified:
    - src/webhooks/telegram.ts
    - tests/webhooks/client-menu.test.ts

key-decisions:
  - "New Greek CAS-miss messages kept as inline string literals in telegram.ts (not added to greek-messages.ts), consistent with D-07 scoping that file to button labels only"
  - "Default case of resolveSbkCasFailureMessage returns the original generic 'not found or already processed' string verbatim, making it a strict behavioral superset (never a regression) for null/undefined/unrecognized statuses"

patterns-established:
  - "CAS-miss owner messaging: re-read booking status fresh (post-miss) and switch on it, rather than reusing a pre-mutation snapshot, to avoid race-condition-driven mislabeling"

requirements-completed: []

coverage:
  - id: D1
    description: "sbk:approve/reject CAS-miss sends one of 4 distinct Greek messages (expired / already-confirmed / already-rejected-or-cancelled / generic not-found) based on a fresh re-read of the booking's actual status"
    verification:
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts#260908-dwj: status-aware CAS-miss messaging (8 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Legacy approve_<id>/reject_<id> handler left untouched; pre-existing Suite F tests (T-22-01/02/03, reschedule cascade) unaffected"
    verification:
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts#Suite F: sbk: session booking approval routing (9 pre-existing tests)"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-09-08
status: complete
---

# Quick Task 260908-dwj: Status-Aware sbk Approval CAS-Miss Messaging Summary

**Owner taps on a stale sbk:approve/reject button now get one of 4 distinct Greek messages (expired / already-approved / already-rejected / generic not-found) based on a fresh post-CAS-miss status re-read, instead of one generic "not found or already processed" message for every case.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added module-scope `resolveSbkCasFailureMessage(currentStatus)` helper in `src/webhooks/telegram.ts`, switching on the booking's current status to return one of 4 Greek messages (expired / confirmed / cancelled-or-rejected / default-generic).
- Both the `sbkAction === 'approve'` and reject (`else`) arms now perform a fresh `findBookingByIdUnscoped(sbk.bookingId)` re-read strictly after the `updateBookingStatusIfPending` CAS miss, and pass its `bookingStatus` into the new helper before messaging the owner.
- Added 8 new regression tests to Suite F of `tests/webhooks/client-menu.test.ts`, covering all 4 status branches x 2 actions (approve/reject), including verifying a CAS miss never triggers the reschedule-cascade or capacity-release code paths.

## Task Commits

Each task was committed atomically:

1. **Task 1: Status-aware sbk: approve/reject failure messaging** - `1055502` (fix)
2. **Task 2: Test coverage for all 4 CAS-miss branches on both approve and reject** - `52920fc` (test)

**Plan metadata:** committed separately by orchestrator (docs artifacts excluded from this executor's commits per constraints).

## Files Created/Modified
- `src/webhooks/telegram.ts` - Added `resolveSbkCasFailureMessage` helper; both sbkAction approve/reject arms call it with a fresh post-CAS-miss re-read instead of the old hardcoded generic string.
- `tests/webhooks/client-menu.test.ts` - Added 8 tests to Suite F covering all 4 CAS-miss status branches on both approve and reject call sites.

## Decisions Made
- Kept the 4 new Greek sentences as inline string literals in `telegram.ts`, matching the existing pattern for all other messages in this file and the documented scope of `greek-messages.ts` (button labels only, D-07).
- Default case of the new helper returns the exact pre-existing generic string verbatim — guarantees the change is a strict behavioral superset for any status not explicitly handled (null/undefined/unknown future status), never a regression.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Change is self-contained to the sbkAction owner-callback branch; no follow-on work required.
- The unrelated legacy `approve_<id>`/`reject_<id>` handler (still silently no-ops on CAS miss) remains explicitly out of scope, as called out in the plan — a future quick task could apply the same pattern there if desired.

---
*Phase: quick-260908-dwj*
*Completed: 2026-09-08*

## Self-Check: PASSED

- FOUND: src/webhooks/telegram.ts
- FOUND: tests/webhooks/client-menu.test.ts
- FOUND commit: 1055502
- FOUND commit: 52920fc
