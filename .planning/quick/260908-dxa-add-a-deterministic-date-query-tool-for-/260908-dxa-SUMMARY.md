---
phase: quick-260908-dxa
plan: 01
subsystem: ai-agent
tags: [gemini, function-calling, greek-nlp, telegram, owner-agent]

requires:
  - phase: quick-260716-oaa
    provides: AI-powered owner agent (Gemini NLU) — OWNER_TOOLS/executeOwnerTool structure this plan extends
provides:
  - "resolveOwnerDateQuery export in greek-preprocessor.ts — deterministic DD/MM (+year-rollover) and weekday/relative-day resolution for owner-facing free text"
  - "view_schedule_for_date owner tool — lets the owner ask about any date's schedule via raw text, with the resolved Greek weekday explicitly stated in the tool result"
affects: [onboarding, owner-agent, greek-preprocessor]

tech-stack:
  added: []
  patterns:
    - "Deterministic server-side date resolution fed back into Gemini's tool-result text (never trusting the LLM's own date/weekday arithmetic) — same principle view_todays_schedule already established, now generalized to any owner-named date"

key-files:
  created:
    - tests/ai-owner-view-schedule-for-date.test.ts
  modified:
    - src/conversation/greek-preprocessor.ts
    - tests/greek-preprocessor.test.ts
    - src/onboarding/ai-owner-agent.ts

key-decisions:
  - "resolveExplicitNumericDate tries current-year first, falls back to next year only when the current-year candidate is invalid or already in the past — no further year rollover attempted for calendar-impossible input (e.g. 31/2 stays null forever)"
  - "view_schedule_for_date's date_query parameter is raw owner text, never asking Gemini to pre-convert to ISO — mirrors the plan's core design constraint"
  - "resolveOwnerDateQuery reuses resolveDate as-is (same-module call) rather than exporting/duplicating weekday-stem or relative-day logic"

requirements-completed: []

coverage:
  - id: D1
    description: "resolveOwnerDateQuery resolves explicit DD/MM and DD-MM numeric dates with year-rollover, and reuses the existing weekday-stem/relative-day resolution unchanged as its fallback"
    verification:
      - kind: unit
        ref: "tests/greek-preprocessor.test.ts#resolveOwnerDateQuery — owner free-text date resolution (deterministic, no Gemini date arithmetic)"
        status: pass
    human_judgment: false
  - id: D2
    description: "view_schedule_for_date owner tool states the correct resolved Greek weekday name explicitly in its reply (both with-bookings and empty-day paths), and asks for clarification without querying the DB when the date can't be resolved"
    verification:
      - kind: unit
        ref: "tests/ai-owner-view-schedule-for-date.test.ts#view_schedule_for_date tool — deterministic date resolution + explicit weekday statement"
        status: pass
    human_judgment: false
  - id: D3
    description: "view_todays_schedule and resolveGreekTemporalExpressions/router.ts's client-facing behavior remain completely unchanged"
    verification:
      - kind: unit
        ref: "tests/ai-owner-*.test.ts (all 5 suites, 32 tests) and tests/greek-preprocessor.test.ts (34 tests) — full regression pass"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-09-08
status: complete
---

# Quick Task 260908-dxa: Deterministic Owner Date-Query Tool Summary

**Owner can now ask about any date's schedule ("τι έχω στις 7/9;", "τι έχω τη Δευτέρα;") via a new `view_schedule_for_date` Gemini tool whose reply always states the server-resolved Greek weekday explicitly — zero date/weekday arithmetic delegated to Gemini.**

## Performance

- **Duration:** ~5 min (commit-to-commit)
- **Completed:** 2026-09-08
- **Tasks:** 2
- **Files modified:** 3 (+1 new test file)

## Accomplishments
- `resolveOwnerDateQuery(dateQuery, referenceDate)` exported from `src/conversation/greek-preprocessor.ts` — resolves explicit DD/MM (and DD-MM) numeric dates with year-rollover, falling back to the existing weekday-stem/relative-day resolution unchanged
- `view_schedule_for_date` registered in `OWNER_TOOLS` with a raw-text `date_query` parameter (never a Gemini-computed ISO date), plus a matching `executeOwnerTool` case
- The tool's reply always prefixes the correct resolved Greek weekday name + DD/MM/YYYY date, both when bookings exist and when the day is empty
- Unresolvable `date_query` returns a Greek clarification message without ever touching the database
- `view_todays_schedule` and `resolveGreekTemporalExpressions`/`router.ts`'s client-facing behavior verified byte-for-byte unchanged

## Task Commits

Each task followed TDD (RED → GREEN):

1. **Task 1: resolveOwnerDateQuery**
   - `56afdab` test(260908-dxa): add failing tests for resolveOwnerDateQuery
   - `2df800f` feat(260908-dxa): add resolveOwnerDateQuery for deterministic owner date resolution
2. **Task 2: view_schedule_for_date owner tool**
   - `9566d6a` test(260908-dxa): add failing tests for view_schedule_for_date owner tool
   - `d5ea543` feat(260908-dxa): add view_schedule_for_date owner tool

## Files Created/Modified
- `src/conversation/greek-preprocessor.ts` - added `resolveExplicitNumericDate` (unexported helper) and `resolveOwnerDateQuery` (new export); `resolveDate`/`WEEKDAY_STEMS`/`RELATIVE_DAY_PATTERNS`/`resolveGreekTemporalExpressions` untouched
- `tests/greek-preprocessor.test.ts` - new describe block for `resolveOwnerDateQuery` (8 tests); pre-existing 23-phrase corpus untouched
- `src/onboarding/ai-owner-agent.ts` - new `view_schedule_for_date` OWNER_TOOLS entry, `date_query?: string` on `ToolArgs`, new `executeOwnerTool` case, one new Κανόνες bullet in `buildOwnerSystemPrompt`; `view_todays_schedule`'s own definition/case untouched
- `tests/ai-owner-view-schedule-for-date.test.ts` (new) - 4 tests covering explicit-date-with-bookings, year-rollover-with-empty-day, weekday-name query, and unparseable-input clarification

## Decisions Made
- `resolveExplicitNumericDate` only attempts current-year then next-year — a calendar-impossible day/month (e.g. 31/2) never resolves in any year, matching the plan's explicit "31/2 -> null" requirement
- Reused `resolveDate` via same-module call rather than exporting it separately, keeping the existing public API surface (`resolveGreekTemporalExpressions`) unchanged

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- No blockers. This closes the gap where the owner previously had no deterministic way to ask about a non-"today" date.

---
*Phase: quick-260908-dxa*
*Completed: 2026-09-08*

## Self-Check: PASSED

All created/modified files and all 4 task commits (56afdab, 2df800f, 9566d6a, d5ea543) verified present.
