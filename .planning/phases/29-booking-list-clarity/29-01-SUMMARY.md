---
phase: 29-booking-list-clarity
plan: 01
subsystem: api
tags: [session-manager, timezone, drizzle, telegram, greek-messages]

# Dependency graph
requires: []
provides:
  - "hoursUntilSession(sessionDate, sessionTime) — canonical shared export in src/utils/timezone.ts"
  - "listSessions(businessId, limitDays, excludePastToday) — 3rd optional param, default false, backward-compatible"
  - "findSessionInstanceById(businessId, instanceId) — businessId-scoped session-instance lookup"
  - "BACK_MENU_LABELS.ADMIN / BACK_MENU_LABELS.CLIENT — shared back-menu button label constants"
affects: [29-02, 29-03, 29-04, 29-05, 29-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Consolidate near-identical inline helper copies into one canonical export instead of adding a 3rd/4th copy (D-02)"
    - "New optional trailing parameter with a safe default to extend a hot-path function without touching any existing call site (D-01)"
    - "businessId-scoped lookup helper enforced via join WHERE clause, not advisory checks (D-06/T-29-01)"

key-files:
  created: []
  modified:
    - src/utils/timezone.ts
    - src/session/manager.ts
    - src/utils/greek-messages.ts
    - tests/timezone.test.ts
    - tests/session-list.test.ts

key-decisions:
  - "Locked boundary semantics: a session starting at exactly the current Athens minute is treated as already started (hoursUntilSession returns exactly 0); excludePastToday uses strict `> 0`, never `>= 0`."
  - "excludePastToday defaults to false so all 13 existing listSessions call sites require zero edits; only Wave 2's 5 client-booking-facing call sites will opt in with `true`."
  - "findSessionInstanceById reuses listSessions' exact select/join shape (not a narrowed subset) so it's a true drop-in replacement for the 3 inline joins Wave 2 removes."

requirements-completed: [UX-01]

coverage:
  - id: D1
    description: "hoursUntilSession consolidated into src/utils/timezone.ts as the single canonical export, replacing two byte-identical inline copies (client-menu.ts, function-executor.ts are not yet edited — that's Wave 2 — but the shared export now exists and is independently correct)"
    requirement: "UX-01"
    verification:
      - kind: unit
        ref: "tests/timezone.test.ts#hoursUntilSession"
        status: pass
    human_judgment: false
  - id: D2
    description: "listSessions() gains excludePastToday (default false) that filters same-day past-time instances via hoursUntilSession, with a locked strict-> 0 boundary; default-false path proven unaffected via regression test"
    requirement: "UX-01"
    verification:
      - kind: integration
        ref: "tests/session-list.test.ts#listSessions excludePastToday (Phase 29, D-01/D-02)"
        status: pass
    human_judgment: false
  - id: D3
    description: "findSessionInstanceById(businessId, instanceId) added to src/session/manager.ts, businessId-scoped (cross-business lookups return null) and excludes cancelled instances"
    verification:
      - kind: integration
        ref: "tests/session-list.test.ts#findSessionInstanceById (Phase 29, D-06)"
        status: pass
    human_judgment: false
  - id: D4
    description: "BACK_MENU_LABELS (ADMIN/CLIENT) added to src/utils/greek-messages.ts, matching existing production Greek text verbatim"
    verification:
      - kind: other
        ref: "npx tsc --noEmit"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-07-28
status: complete
---

# Phase 29 Plan 01: Foundation helpers — hoursUntilSession, excludePastToday, findSessionInstanceById, BACK_MENU_LABELS Summary

**Consolidated hoursUntilSession into timezone.ts, gave listSessions() a backward-compatible excludePastToday filter, added a businessId-scoped findSessionInstanceById lookup, and centralized back-menu button labels — the three foundational primitives every other Phase 29 plan imports.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-28T21:58:00+03:00 (approx, first task commit 21:58:41+03:00)
- **Completed:** 2026-07-28T22:01:15+03:00
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- `src/utils/timezone.ts` gains `hoursUntilSession(sessionDate, sessionTime)`, the canonical export consolidating the two byte-identical inline copies in `client-menu.ts` and `function-executor.ts` (D-02). Algorithm relocated verbatim, not rewritten.
- `src/session/manager.ts`'s `listSessions()` gains a 3rd optional param `excludePastToday` (default `false`), filtering same-day past-time instances via the new shared helper (D-01). Locked boundary: strict `> 0` (exact-now is excluded). Zero edits required at any of the 13 existing call sites.
- `src/session/manager.ts` gains `findSessionInstanceById(businessId, instanceId)`, businessId-scoped and cancelled-instance-excluding, using the identical select/join shape as `listSessions` (D-06). Cross-business lookups verified to resolve to `null` (T-29-01).
- `src/utils/greek-messages.ts` gains `BACK_MENU_LABELS.ADMIN`/`BACK_MENU_LABELS.CLIENT` (D-07), verbatim-matching the existing production Greek button text, ready for Wave 2 plans to import.

## Task Commits

Each task was committed atomically:

1. **Task 1: hoursUntilSession shared helper (D-02) + listSessions excludePastToday filter (D-01)** - `2daaef2` (feat)
2. **Task 2: findSessionInstanceById lookup helper (D-06)** - `f8eb631` (feat)
3. **Task 3: Shared back-menu label constants (D-07)** - `104cb97` (feat)

**Plan metadata:** (this commit, follows this SUMMARY)

## Files Created/Modified
- `src/utils/timezone.ts` - new `hoursUntilSession` export (canonical, consolidated)
- `src/session/manager.ts` - `listSessions()` gains `excludePastToday` (3rd param, default false); new `findSessionInstanceById` export
- `src/utils/greek-messages.ts` - new `BACK_MENU_LABELS` export (ADMIN/CLIENT)
- `tests/timezone.test.ts` - `hoursUntilSession` suite (far-future, far-past, near-future, near-past, exact-boundary, DST-adjacent)
- `tests/session-list.test.ts` - `excludePastToday` boundary suite (past excluded, future included, exact-now excluded, default-false regression) + `findSessionInstanceById` suite (happy path, cross-business null, cancelled null, not-found null)

## Decisions Made
- Boundary semantics for "already passed" locked to strict `> 0` (a session at exactly the current Athens minute is NOT bookable) — documented in both the `listSessions` JSDoc and a dedicated unit test on the raw `hoursUntilSession` helper.
- Test isolation: each `excludePastToday` boundary test and each `findSessionInstanceById` test creates its own fresh test business (auto-provisioning its own default service) rather than sharing one across the describe block, to avoid the DB's `unique_active_catalog_per_business_service` and `unique_session_instance` constraints colliding when multiple tests anchor on "now" within the same wall-clock minute.

## Deviations from Plan

None - plan executed exactly as written. All acceptance criteria for all 3 tasks passed on the first implementation attempt; no Rule 1-4 auto-fixes were needed.

## Issues Encountered

- **Local test-DB port mismatch (environment-only, not a code issue):** the test suite's default fallback DB URL (`postgresql://manolis@localhost:5432/randevuclaw_test`) resolves to a different Postgres container (`backend-db-1`, an unrelated project) than the actual `randevuclaw-pg` test container, which is mapped to host port 5433 in this dev environment. Running tests without `SESSION_TEST_DATABASE_URL` set produces a `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` error against the wrong container — confirmed via `git stash` that this reproduces identically on the pre-existing, unmodified test file, so it is a local environment quirk, not a regression introduced by this plan. All verification in this plan was run with `SESSION_TEST_DATABASE_URL=postgresql://manolis:password@localhost:5433/randevuclaw_test` explicitly set. No code changes made for this — out of scope per the deviation rules' scope boundary (pre-existing, unrelated to this plan's target files).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All three foundational primitives (`hoursUntilSession`, `listSessions`'s `excludePastToday`, `findSessionInstanceById`, `BACK_MENU_LABELS`) exist, are exported, and are independently tested.
- Wave 2 plans (29-02 through 29-06) can now safely import these and delete their own inline duplicate logic without any risk to this plan's own correctness.
- Ready for Wave 2 plans of Phase 29.

---
*Phase: 29-booking-list-clarity*
*Completed: 2026-07-28*

## Self-Check: PASSED

- All 5 key-files (src/utils/timezone.ts, src/session/manager.ts, src/utils/greek-messages.ts, tests/timezone.test.ts, tests/session-list.test.ts) confirmed present on disk.
- All 3 task commits (`2daaef2`, `f8eb631`, `104cb97`) confirmed present in git log.
- All 25 tests in the scoped run (`npm test -- --testPathPattern="timezone|session-list"`) pass.
- `npx tsc --noEmit` passes clean.
- Verified zero files outside the plan's declared scope were touched (`git diff --name-only` across the 3 commits matches `files_modified` exactly).
