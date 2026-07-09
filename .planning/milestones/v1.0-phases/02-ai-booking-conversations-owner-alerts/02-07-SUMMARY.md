---
phase: 02-ai-booking-conversations-owner-alerts
plan: 7
subsystem: conversation
tags: [greek-nlp, temporal-parsing, jest, tdd, gap-closure]

# Dependency graph
requires:
  - phase: 02-ai-booking-conversations-owner-alerts
    provides: greek-preprocessor.ts's resolveGreekTemporalExpressions and its 20-phrase corpus test (originally shipped in an earlier 02-plan; this plan closes CR-05 found in the phase code review)
provides:
  - "resolveHourToTime's new hour>=13 && hour<=23 guard, preventing the bare-hour heuristic from double-applying +12 to already-24h Greek time phrasing"
  - "3 new corpus tests (21-23) covering bare hours 14, 20, 22"
affects: [phase-02-verification, phase-02-review]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - src/conversation/greek-preprocessor.ts
    - tests/greek-preprocessor.test.ts

key-decisions:
  - "Guard placed immediately before the existing hour===12 bare-hour branch, after the marker-present and time-of-day-context-word branches, exactly as specified in 02-REVIEW.md's CR-05 fix snippet"

patterns-established: []

requirements-completed: [BOOK-01, BOOK-03]

coverage:
  - id: D1
    description: "resolveHourToTime returns the hour's own literal 24-hour value (never +12 again) for bare Greek time phrases with hour 13-23 and no am/pm marker or time-of-day context word"
    requirement: "BOOK-01"
    verification:
      - kind: unit
        ref: "tests/greek-preprocessor.test.ts#21. \"Παρασκευή στις 14\" -> Friday, bare 24-hour input in 13-23 range must never get +12 applied again (CR-05)"
        status: pass
      - kind: unit
        ref: "tests/greek-preprocessor.test.ts#22. \"Παρασκευή στις 20\" -> Friday, bare 24-hour input in 13-23 range must never get +12 applied again (CR-05)"
        status: pass
      - kind: unit
        ref: "tests/greek-preprocessor.test.ts#23. \"στις 22\" -> no weekday/relative-day keyword -> resolvedDate null, bare 24-hour input resolves to its own literal hour (CR-05)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Full existing 20-phrase corpus (hours 1-12, marker-present forms, time-of-day context words) plus annotation/robustness tests remain unaffected by the new guard"
    requirement: "BOOK-03"
    verification:
      - kind: unit
        ref: "npx jest tests/greek-preprocessor.test.ts (26/26 passing)"
        status: pass
      - kind: unit
        ref: "npm test (18 suites / 139 tests, full regression suite)"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-07-08
status: complete
---

# Phase 02 Plan 7: Guard bare-hour heuristic against already-24h Greek phrasing (CR-05) Summary

**Fixed `resolveHourToTime` in greek-preprocessor.ts to short-circuit on already-unambiguous 24-hour input (13-23), closing the code-review finding that let ordinary Greek phrasing like "στις 20" produce invalid clock times like "32:00" flowing into the Gemini-trusted system hint.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-08T19:26:00Z
- **Completed:** 2026-07-08T19:38:09Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Added a `hour >= 13 && hour <= 23` guard in `resolveHourToTime`, placed before the bare-hour 12-hour heuristic, so a bare hour that is already in 24-hour form is returned as-is instead of having 12 added a second time.
- Extended the Greek temporal corpus test from 20 to 23 phrases, covering the three behavior cases specified in the plan: "Παρασκευή στις 14" (→ 14:00), "Παρασκευή στις 20" (→ 20:00), and "στις 22" (→ resolvedDate null, resolvedTime 22:00).
- Verified the fix follows strict TDD RED→GREEN: new tests failed against the old code (26:00/32:00/34:00 received) before the fix, then passed after.
- Confirmed zero regressions: full existing 20-phrase corpus (including boundary Tests 4/8/14 for bare hours 5/11/12) plus annotation/robustness tests still pass unchanged; full project test suite (18 suites, 139 tests) and `npx tsc --noEmit` are clean.

## Task Commits

Each task was committed atomically (TDD RED/GREEN split, as the task had `tdd="true"`):

1. **Task 1 (RED): Add failing corpus tests for bare 24-hour Greek time phrasing** - `9d882ca` (test)
2. **Task 1 (GREEN): Guard bare-hour heuristic against already-24h Greek phrasing** - `07d5c63` (fix)

**Plan metadata:** committed separately per worktree protocol (SUMMARY.md only; STATE.md/ROADMAP.md owned by orchestrator).

## Files Created/Modified
- `src/conversation/greek-preprocessor.ts` - Added the CR-05 guard (`hour >= 13 && hour <= 23` early return) in `resolveHourToTime`, immediately before the existing bare-hour `hour === 12` branch.
- `tests/greek-preprocessor.test.ts` - Renamed the corpus describe block to "23-phrase" and added 3 new test cases (21-23) covering bare hours 14, 20, and 22 with no marker/context word.

## Decisions Made
- Followed the exact fix location and code specified in `02-REVIEW.md`'s CR-05 section verbatim (guard placed before `hour === 12`, after marker/context-word branches) — no alternative implementation considered since the review already pinpointed the precise root cause and minimal fix.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

CR-05 is closed. This was one of 6 critical findings from the Phase 02 code review (`02-REVIEW.md`); the phase's gap-closure plans (02-06 through 02-11, per `2655ba3`) address the remaining findings. This plan does not block or depend on the others (`depends_on: []`, `wave: 1`). BOOK-01 (booking via natural Greek chat) and BOOK-03 (checking availability) are restored for the ordinary 24-hour phrasing case; the Gemini-trusted system hint (`[ΣΥΣΤΗΜΑ: ... πιθανή ώρα=...]`) can no longer embed an invalid clock time for this input class.

---
*Phase: 02-ai-booking-conversations-owner-alerts*
*Completed: 2026-07-08*

## Self-Check: PASSED

- FOUND: src/conversation/greek-preprocessor.ts
- FOUND: commit 9d882ca (test - RED)
- FOUND: commit 07d5c63 (fix - GREEN)
- FOUND: commit 639f746 (docs - SUMMARY)
