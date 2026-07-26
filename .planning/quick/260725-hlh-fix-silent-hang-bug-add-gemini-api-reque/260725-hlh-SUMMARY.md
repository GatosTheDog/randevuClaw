---
phase: quick
plan: 01
subsystem: infra
tags: [gemini, timeout, resilience, google-genai, telegram-webhook]

requires: []
provides:
  - 25s HTTP request timeout on all three GoogleGenAI client constructions
affects: [onboarding, conversation, webhooks]

tech-stack:
  added: []
  patterns:
    - "GoogleGenAI clients constructed with httpOptions: { timeout: 25000 } to bound Gemini API calls to a finite wall-clock duration"

key-files:
  created: []
  modified:
    - src/onboarding/ai-onboarding-agent.ts
    - src/onboarding/ai-owner-agent.ts
    - src/conversation/ai-agent.ts

key-decisions:
  - "25000ms (25s) chosen as the timeout value, matching the plan's confirmed root-cause analysis"

patterns-established:
  - "All GoogleGenAI constructor call sites must include httpOptions.timeout — future new call sites should follow this pattern"

requirements-completed: []

coverage:
  - id: D1
    description: "All three GoogleGenAI client constructions (ai-onboarding-agent.ts, ai-owner-agent.ts, ai-agent.ts) bound to a 25s HTTP timeout via httpOptions.timeout"
    verification:
      - kind: unit
        ref: "grep -n 'httpOptions: { timeout: 25000 }' src/onboarding/ai-onboarding-agent.ts src/onboarding/ai-owner-agent.ts src/conversation/ai-agent.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "TypeScript build type-checks the new httpOptions field against the SDK's GoogleGenAIOptions/HttpOptions types"
    verification:
      - kind: unit
        ref: "npm run build"
        status: pass
    human_judgment: false
  - id: D3
    description: "Existing Jest suites for the three modified files still pass unchanged with the new constructor argument"
    verification:
      - kind: unit
        ref: "tests/onboarding/ai-onboarding-agent.test.ts, tests/webhooks/telegram-webhook.onboarding.test.ts, tests/onboarding/edit-router.test.ts"
        status: pass
      - kind: unit
        ref: "tests/ai-agent.test.ts (pre-existing TS2345 failures, unrelated to this change)"
        status: fail
    human_judgment: true
    rationale: "tests/ai-agent.test.ts fails to compile due to a pre-existing Business interface fixture mismatch (missing cancellationCutoffEnabled/cancellationCutoffHours/slotlessRequestsEnabled/lastSessionThresholdEnabled fields) that predates and is unrelated to this fix — confirmed by an empty git diff on the test file between this commit and its parent. Flagging for human awareness rather than auto-passing since a test suite in the plan's verify list did not pass, even though root cause is out of scope for this task."

duration: 8min
completed: 2026-07-25
status: complete
---

# Quick Task 260725-hlh: Fix Silent-Hang Bug Summary

**Bounded all three `GoogleGenAI` client constructions to a 25s HTTP timeout (`httpOptions: { timeout: 25000 }`), fixing a confirmed silent-hang bug where a stalled Gemini API response never resolved or rejected, holding the onboarding webhook's open Postgres transaction indefinitely.**

## Performance

- **Duration:** 8 min
- **Tasks:** 2 completed
- **Files modified:** 3

## Accomplishments
- `src/onboarding/ai-onboarding-agent.ts`, `src/onboarding/ai-owner-agent.ts`, and `src/conversation/ai-agent.ts` now construct `GoogleGenAI` with `httpOptions: { timeout: 25000 }`, plus a short file-local comment explaining why.
- Confirmed via `grep` that all three files contain the fix, with no other lines changed.
- Confirmed `npm run build` passes with zero new TypeScript errors.
- Confirmed the plan's listed Jest suites for the onboarding path (`tests/onboarding/ai-onboarding-agent.test.ts`, `tests/webhooks/telegram-webhook.onboarding.test.ts`, `tests/onboarding/edit-router.test.ts`) pass unchanged — 36/36 tests green.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Gemini API request timeout to all three GoogleGenAI client constructions** - `cbb7310` (fix)
2. **Task 2: Verify build and existing tests are unaffected** - no commit (verification-only task, no files modified)

## Files Created/Modified
- `src/onboarding/ai-onboarding-agent.ts` - `GoogleGenAI` construction now includes `httpOptions: { timeout: 25000 }` + explanatory comment
- `src/onboarding/ai-owner-agent.ts` - `GoogleGenAI` construction now includes `httpOptions: { timeout: 25000 }` + explanatory comment
- `src/conversation/ai-agent.ts` - `GoogleGenAI` construction now includes `httpOptions: { timeout: 25000 }` + explanatory comment

## Decisions Made
- 25000ms (25s) used as the timeout value per the plan's pre-confirmed root-cause analysis and fix specification — no alternative value considered, as this was a fully-diagnosed fix.

## Deviations from Plan

None - plan executed exactly as written. No Rule 1/2/3/4 auto-fixes were needed; the change was a straightforward single-line addition per file plus a comment, as specified.

## Issues Encountered

**Pre-existing test failure (out of scope, not fixed):** `npx jest tests/ai-agent.test.ts` fails to compile with TS2345 errors — the test's mock `Business` fixture object is missing several fields (`cancellationCutoffEnabled`, `cancellationCutoffHours`, `slotlessRequestsEnabled`, `lastSessionThresholdEnabled`, and 2 more) that were added to the `Business` interface in a later phase (Phase 12/18) without updating this test's fixture. Confirmed this is unrelated to the `httpOptions` change: `git diff HEAD~1 HEAD -- tests/ai-agent.test.ts` shows zero changes to the test file, and the constructor line in `src/conversation/ai-agent.ts` prior to this fix (`new GoogleGenAI({ apiKey: config.geminiApiKey })`) has the identical shape now, just with the added `httpOptions` field, which does not interact with the `Business` type at all. Per the plan's Task 2 instructions ("only fix a failure if it is directly caused by the httpOptions addition"), this was left unfixed and is logged here for visibility. All other listed test suites (the ones the plan explicitly asked to run and that exercise the three modified files) pass — 36/36 green.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Fix is self-contained and complete; no follow-on work required for this quick task.
- Unrelated pre-existing `tests/ai-agent.test.ts` fixture drift (missing `Business` interface fields) should be addressed in a future quick task or as part of the next phase touching booking-conversation tests.

---
*Phase: quick*
*Completed: 2026-07-25*

## Self-Check: PASSED

All 3 modified files confirmed present on disk; commit `cbb7310` confirmed present in git log.
