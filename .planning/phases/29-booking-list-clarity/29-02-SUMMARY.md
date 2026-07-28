---
phase: 29-booking-list-clarity
plan: 02
subsystem: api
tags: [conversation, gemini-tools, session-manager, timezone, telegram]

# Dependency graph
requires:
  - phase: 29-01
    provides: "listSessions(businessId, limitDays, excludePastToday) and shared hoursUntilSession(sessionDate, sessionTime) export"
provides:
  - "All 4 client-facing listSessions() calls in function-executor.ts (listSessionsForClientTool, bookSessionTool x2, rescheduleSessionTool) exclude same-day past-time sessions"
  - "function-executor.ts's cancelAppointmentTool cutoff check uses the shared timezone.ts hoursUntilSession export (local duplicate removed)"
affects: [29-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Free-chat AI tool layer (function-executor.ts) opts into the same excludePastToday=true filter as the /menu UI path, keeping both client-facing surfaces behaviorally identical (D-01)"

key-files:
  created: []
  modified:
    - src/conversation/function-executor.ts
    - tests/session-booking-flow.test.ts

key-decisions:
  - "Explicit limitDays=90 passed at all 4 call sites (matching the pre-existing implicit default) so only the new 3rd argument changes behavior — no silent limitDays change."
  - "New UX-01 test suite creates a fresh business+catalog per test (not shared across the describe block) to avoid unique_session_instance (catalogId, sessionDate, sessionTime) collisions when two tests anchor 'a few minutes ago' within the same wall-clock minute — same isolation pattern documented in 29-01-SUMMARY.md."
  - "A pre-existing, unrelated SBOK-04 test failure (session_catalog unique-constraint collision) was verified via git stash to predate this plan's changes and logged to deferred-items.md instead of being fixed — out of scope per the executor's scope-boundary rule."

requirements-completed: [UX-01]

coverage:
  - id: D1
    description: "listSessionsForClientTool, both bookSessionTool branches (single + multi), and rescheduleSessionTool all call listSessions(context.business.id, 90, true), so a client using free-text Greek chat never sees or successfully targets a same-day session whose start time has already passed"
    requirement: "UX-01"
    verification:
      - kind: integration
        ref: "tests/session-booking-flow.test.ts#UX-01: same-day past-time session exclusion across free-chat tool paths (D-01)"
        status: pass
    human_judgment: false
  - id: D2
    description: "function-executor.ts's local hoursUntilSessionInAthens duplicate is deleted; cancelAppointmentTool's cutoff-hours check now uses the shared src/utils/timezone.ts hoursUntilSession export, with zero behavior change to CANC-03/04/05"
    requirement: "UX-01"
    verification:
      - kind: integration
        ref: "tests/cancellation-cutoff.test.ts (CANC-01 through CANC-05, 6 tests)"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-07-28
status: complete
---

# Phase 29 Plan 02: Wire AI tool layer to excludePastToday + shared hoursUntilSession Summary

**All 4 client-facing `listSessions()` calls in `function-executor.ts` (the Gemini tool-call layer) now pass `excludePastToday=true`, and the file's duplicate hours-until-session algorithm is gone in favor of Wave 1's shared `timezone.ts` export — completing UX-01 for every free-chat booking path.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-28T22:02:00+03:00 (approx)
- **Completed:** 2026-07-28T22:14:00+03:00
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `listSessionsForClientTool`, `bookSessionTool`'s multi-booking branch, `bookSessionTool`'s single-booking branch, and `rescheduleSessionTool` all now call `listSessions(context.business.id, 90, true)` — a client chatting in free Greek text can no longer see or book a same-day session whose start time has already passed, matching the `/menu`-driven path (Plan 29-05's scope, not yet done, but no longer inconsistent on this axis for the AI tool layer itself).
- `function-executor.ts`'s local `hoursUntilSessionInAthens` (byte-for-byte identical to Wave 1's new shared export) is deleted; `cancelAppointmentTool`'s cutoff-hours check now imports and calls `hoursUntilSession` from `src/utils/timezone.ts` — a pure rename/relocation with zero behavior change.
- Added a real-DB test suite (`UX-01: same-day past-time session exclusion across free-chat tool paths (D-01)`) covering all 3 documented behaviors: `list_sessions_for_client` excludes the past-time instance, `book_session` (both single and multi-booking branches) treats it as not-found/conflict, and `reschedule_session` returns `session_not_found`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire the 4 client-facing listSessions call sites to excludePastToday=true (D-01)** - `debe592` (feat)
2. **Task 2: Remove the local hoursUntilSessionInAthens duplicate, use the shared timezone.ts export (D-02)** - `27af7af` (refactor)

**Plan metadata:** (this commit, follows this SUMMARY)

## Files Created/Modified
- `src/conversation/function-executor.ts` - 4 `listSessions()` call sites gain `(90, true)`; local `hoursUntilSessionInAthens` deleted, `cancelAppointmentTool` now imports `hoursUntilSession` from `../utils/timezone`
- `tests/session-booking-flow.test.ts` - new `athensTimeMinutesFromNow` helper + `UX-01` describe block (4 tests: list exclusion, single-booking not-found, multi-booking conflict, reschedule not-found)

## Decisions Made
- Explicit `limitDays=90` passed at all 4 call sites (the value the pre-existing implicit default already resolved to) — keeps the diff minimal to exactly what the plan specified: only the 3rd argument (`excludePastToday`) is new behavior.
- New test suite uses one fresh business + session catalog per test (not a shared `beforeAll` catalog) specifically to avoid `unique_session_instance` collisions when two tests both anchor "5 minutes ago" within the same real wall-clock minute — this mirrors the isolation rationale already documented in `29-01-SUMMARY.md`.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' acceptance criteria passed on the first implementation attempt; no Rule 1-4 auto-fixes were needed to function-executor.ts itself.

## Issues Encountered

- **Pre-existing, unrelated test failure (not a regression):** `tests/session-booking-flow.test.ts`'s `SBOK-04: multi-session booking > multi-booking partial success` test fails with a `unique_active_catalog_per_business_service` constraint violation — it creates a second active session catalog for the same `(businessId, serviceId)` pair already used by the describe block's shared catalog. Verified via `git stash` (reverting all of this plan's changes) that this failure reproduces identically on the pre-existing code, confirming it predates Plan 29-02. Logged to `.planning/phases/29-booking-list-clarity/deferred-items.md` with a suggested fix; not touched here per the scope-boundary rule (unrelated to D-01/D-02's target call sites).
- **Local test-DB port mismatch (environment-only, same as Plan 29-01):** ran all verification with `SESSION_TEST_DATABASE_URL=postgresql://manolis:password@localhost:5433/randevuclaw_test` explicitly set, per the pre-existing dev-environment quirk documented in `29-01-SUMMARY.md`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 4 client-facing `listSessions()` call sites in `function-executor.ts` are wired to `excludePastToday=true`; the file's local hours-until-session duplicate is gone.
- `tests/session-booking-flow.test.ts` and `tests/cancellation-cutoff.test.ts` are both green (except the pre-existing, logged, out-of-scope SBOK-04 test).
- Plan 29-05 (the `/menu`-driven `client-menu.ts` path, per this plan's objective note) remains the other half of UX-01's full coverage — not blocked by anything here.
- Ready for the next plan in Phase 29's Wave 2.

---
*Phase: 29-booking-list-clarity*
*Completed: 2026-07-28*

## Self-Check: PASSED

- Both key-files (`src/conversation/function-executor.ts`, `tests/session-booking-flow.test.ts`) confirmed present on disk.
- Both task commits (`debe592`, `27af7af`) confirmed present in git log.
- `npm test -- --testPathPattern="session-booking-flow|cancellation-cutoff"` : 20/21 tests pass; the 1 failure is the pre-existing, logged, out-of-scope SBOK-04 issue (verified via `git stash` to predate this plan).
- `npx tsc --noEmit` passes clean.
- `grep -c hoursUntilSessionInAthens src/conversation/function-executor.ts` returns 0 occurrences.
- Verified all 4 `listSessions(context.business.id, 90, true)` call sites present via grep.
