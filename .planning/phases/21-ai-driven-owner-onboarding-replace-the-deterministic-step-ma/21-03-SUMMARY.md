---
phase: 21-ai-driven-owner-onboarding-replace-the-deterministic-step-ma
plan: 03
subsystem: onboarding
tags: [onboarding, cleanup, dead-code-removal, gemini]

# Dependency graph
requires:
  - phase: 21 (same phase, prior waves)
    provides: "aiOnboardingAgent fully wired into both Telegram entry points (21-01/21-02) — nothing left importing the deterministic step machine"
provides:
  - "src/onboarding/ — only ai-onboarding-agent.ts, ai-owner-agent.ts, edit-router.ts, queries.ts remain; steps.ts/router.ts deleted"
  - "tests/onboarding/edit-router.test.ts — dedicated home for isOwnerEditCommand (ONB-03) coverage"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Stale jest.mock(module) calls for a to-be-deleted module must be grepped for across the WHOLE tests/ tree (not just files in the plan's files_modified list) before deleting the target module — jest.mock() throws 'Cannot find module' at collection time even when the mock is never asserted against"

key-files:
  created:
    - tests/onboarding/edit-router.test.ts
  modified:
    - src/onboarding/queries.ts
    - tests/admin-menu.test.ts
    - tests/webhooks/client-menu.test.ts
  deleted:
    - src/onboarding/steps.ts
    - src/onboarding/router.ts
    - tests/onboarding/steps.test.ts
    - tests/onboarding/class-setup-steps.test.ts
    - tests/onboarding-flow.test.ts
    - tests/onboarding-platform.test.ts

key-decisions:
  - "edit-router.ts left untouched/unwired this phase (resolved scope decision #1 in 21-03-PLAN.md objective) — it is dead code with zero call sites outside itself and its own unit test; only its isOwnerEditCommand test coverage was relocated"
  - "onboarding_sessions DB table left inert with no schema.ts migration (resolved scope decision #2) — nothing reads/writes it after this plan; dropping it is deferred to a future housekeeping pass"

requirements-completed:
  - "D-01/D-02: deterministic step-machine (steps.ts, router.ts) and its dead session-lifecycle plumbing (queries.ts) removed, completing the migration to the Gemini onboarding agent"

coverage:
  - id: D1
    description: "steps.ts and router.ts no longer exist; nothing in src/ or tests/ imports them"
    requirement: "D-01/D-02"
    verification:
      - kind: unit
        ref: "grep -rn 'onboarding/router|onboarding/steps' src/ tests/ (zero code-reference matches; only 2 harmless comment mentions remain in schema.ts and ai-onboarding-agent.ts)"
        status: pass
    human_judgment: false
  - id: D2
    description: "queries.ts no longer exports findActiveSessionByOwnerTelegramId, createOrResetOnboardingSession, updateOnboardingStep, or OnboardingSession"
    requirement: "D-01/D-02"
    verification:
      - kind: unit
        ref: "grep -rn these 4 symbols across src/ — zero matches"
        status: pass
    human_judgment: false
  - id: D3
    description: "isOwnerEditCommand (ONB-03) test coverage preserved in a new dedicated file"
    requirement: "ONB-03 preservation"
    verification:
      - kind: unit
        ref: "tests/onboarding/edit-router.test.ts — 3/3 passing"
        status: pass
    human_judgment: false
  - id: D4
    description: "Full test suite compiles and passes with zero references to the deleted modules; the pre-existing onboarding-platform.test.ts (dead route) is removed rather than repaired"
    requirement: "D-01/D-02"
    verification:
      - kind: unit
        ref: "npx tsc --noEmit (clean); npm test -- --testPathPattern=onboarding (3/3 suites, 35/35 tests pass); full npm test shows 31 pre-existing failing suites, none touching onboarding/router/steps/queries"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-07-25
status: complete
---

# Phase 21 Plan 03: Delete Deterministic Onboarding Step Machine Summary

**Deleted `src/onboarding/steps.ts`/`router.ts` and the dead session-lifecycle functions in `queries.ts`, completing the migration to `aiOnboardingAgent`; also fixed two test files whose stale `jest.mock('.../onboarding/router')` calls would have broken module resolution after the deletion.**

## Performance

- **Tasks:** 2
- **Files modified:** 3 (queries.ts, admin-menu.test.ts, client-menu.test.ts)
- **Files deleted:** 6 (steps.ts, router.ts, and 4 test files)
- **Files created:** 1 (tests/onboarding/edit-router.test.ts)

## Accomplishments
- `src/onboarding/steps.ts` and `src/onboarding/router.ts` deleted entirely — both fully replaced by `aiOnboardingAgent` (21-01/21-02)
- `src/onboarding/queries.ts` stripped to its 3 still-live exports (`findBusinessByOwnerTelegramId`, `createBusinessForOnboarding`, `activateBusiness`); removed the `OnboardingSession` interface and its 3 dead functions, trimmed now-unused `and`/`not`/`onboardingSessions` imports
- Four obsolete/broken test files deleted: `tests/onboarding/steps.test.ts`, `tests/onboarding/class-setup-steps.test.ts`, `tests/onboarding-flow.test.ts`, `tests/onboarding-platform.test.ts` (the last was already broken pre-phase, testing a route deleted in Phase 16)
- `tests/onboarding/edit-router.test.ts` created — re-homes the 3 `isOwnerEditCommand` (ONB-03) assertions
- `npx tsc --noEmit` clean project-wide; onboarding-scoped test suite (3 files, 35 tests) all passing

## Task Commits

1. **Task 1: Delete steps.ts + router.ts; strip dead session-lifecycle functions from queries.ts** - `01e67b1` (feat)
2. **Task 2: Delete obsolete onboarding test files; preserve isOwnerEditCommand coverage** - `23e4651` (test)

## Files Created/Modified/Deleted
- `src/onboarding/steps.ts` (deleted), `src/onboarding/router.ts` (deleted)
- `src/onboarding/queries.ts` — dead session-lifecycle functions + interface removed, imports trimmed
- `tests/onboarding/steps.test.ts` (deleted), `tests/onboarding/class-setup-steps.test.ts` (deleted)
- `tests/onboarding-flow.test.ts` (deleted), `tests/onboarding-platform.test.ts` (deleted)
- `tests/onboarding/edit-router.test.ts` (new) — 3 ONB-03 assertions
- `tests/admin-menu.test.ts`, `tests/webhooks/client-menu.test.ts` — removed stale `jest.mock('.../onboarding/router')` lines

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Two test files outside the plan's `files_modified` list had stale `jest.mock('.../onboarding/router')` calls**
- **Found during:** Task 2, while running the full test suite per the plan's own verification instruction
- **Issue:** `tests/admin-menu.test.ts` and `tests/webhooks/client-menu.test.ts` each contained a defensive `jest.mock('../src/onboarding/router')` / `jest.mock('../../src/onboarding/router')` line — auto-mocking a module neither test file actually imports symbols from (leftover blanket mocking from before 21-02 rewired `telegram.ts` away from the step machine). `jest.mock()` resolves the module path at collection time regardless of whether the mock is asserted against, so once Task 1 deleted `router.ts`, both suites would fail with "Cannot find module '../src/onboarding/router'" before running any test.
- **Fix:** Removed the stale `jest.mock(...)` line from each file. No other change needed — neither file references anything from the deleted module.
- **Files modified:** `tests/admin-menu.test.ts`, `tests/webhooks/client-menu.test.ts`
- **Commit:** `23e4651`

Or otherwise: plan executed exactly as written for Task 1.

## Issues Encountered
- **Full `npm test` run:** 31 suites failed / 24 passed / 1 skipped, but every single failure is pre-existing and unrelated to this plan, matching the documented baseline in STATE.md (247/344 passing as of v1.4 close) and this plan's own `<known_baseline>` note:
  - A large cluster of suites (`session-*`, `billing-*`, `enforcement-*`, `booking-queries`, `cancellation-cutoff`, `slotless-requests`, `renewal-nudge`, `scheduler-*`, `expiry-poller`, `config`) fail against the live sandbox Neon DB — e.g. `error: column "booking_mode" of relation "businesses" does not exist` — a schema-drift/connectivity issue with the local/live test DB, not this plan's code.
  - `tests/ai-agent.test.ts`, `tests/telegram-webhook.test.ts`, `tests/function-executor.test.ts`, `tests/calendar-sync.test.ts`, `tests/calendar-poller.test.ts`, `tests/conversation-router.test.ts`, `tests/webhook.test.ts`, `tests/idempotency.test.ts`, `tests/consent.test.ts` fail to compile on pre-existing TS2345/TS2740/TS2322 fixture-drift errors (test fixtures missing newer `Business`/`Booking` interface fields like `bookingMode`, `cancellationCutoffEnabled`, `sessionInstanceId`) — confirmed unrelated by grepping every failing suite's source for any reference to `onboarding/router`, `onboarding/steps`, or the 4 removed `queries.ts` symbols: zero matches.
  - No suite that imports or mocks anything touched by this plan (onboarding/*, admin-menu, client-menu, telegram-webhook.onboarding) is among the pre-existing failures — all 3 onboarding-scoped suites plus admin-menu/client-menu suites pass 100% (35/35 + 36/36).

## User Setup Required
None.

## Next Phase Readiness
- Phase 21's core objective (replace the deterministic owner-onboarding step machine with the Gemini `aiOnboardingAgent`) is now fully complete across all 3 plans: 21-01 built the agent, 21-02 wired it into both Telegram entry points, 21-03 removed the old machine and its dead plumbing.
- `src/onboarding/` now contains only 4 files: `ai-onboarding-agent.ts` (the new agent), `ai-owner-agent.ts` (post-onboarding owner chat, unrelated), `edit-router.ts` (dead code, explicitly left as-is per resolved scope decision), `queries.ts` (trimmed to 3 live exports).
- `onboarding_sessions` DB table is left inert in both local and live Neon DB — no migration was run this phase (resolved scope decision #2). A future housekeeping pass can drop it once desired.
- No blockers for closing out Phase 21.

---
*Phase: 21-ai-driven-owner-onboarding-replace-the-deterministic-step-ma*
*Completed: 2026-07-25*

## Self-Check: PASSED

- CONFIRMED DELETED: src/onboarding/steps.ts, src/onboarding/router.ts
- CONFIRMED DELETED: tests/onboarding/steps.test.ts, tests/onboarding/class-setup-steps.test.ts, tests/onboarding-flow.test.ts, tests/onboarding-platform.test.ts
- FOUND: tests/onboarding/edit-router.test.ts, src/onboarding/queries.ts, 21-03-SUMMARY.md
- FOUND commits: 01e67b1 (Task 1), 23e4651 (Task 2) in `git log --oneline --all`
