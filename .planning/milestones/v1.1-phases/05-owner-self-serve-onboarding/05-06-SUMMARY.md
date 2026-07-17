---
phase: 05-owner-self-serve-onboarding
plan: "06"
subsystem: testing
tags: [jest, supertest, onboarding, telegram, state-machine, integration-tests, unit-tests]

requires:
  - phase: 05-04
    provides: platform.ts webhook handler (handlePlatformBotWebhook) for HMAC + registration tests
  - phase: 05-05
    provides: edit-router.ts (isOwnerEditCommand, OWNER_EDIT_KEYWORDS) for ONB-03 tests

provides:
  - "tests/onboarding-platform.test.ts — 8 integration tests for BOT-01 (HMAC, registration, resume, re-registration, dedup)"
  - "tests/onboarding-flow.test.ts — 17 unit tests for ONB-01/ONB-02/ONB-03 (full state-machine progression)"

affects: ["05-07", "verify-work", "audit"]

tech-stack:
  added: []
  patterns:
    - "db mock factory pattern: jest.mock('../src/database/db', factory) prevents real pool connections in onboarding tests"
    - "botTokenStore.run mock: mockImplementation calls callback immediately — enables testing async handler logic after 200 is sent"
    - "Direct module import for dispatch functions: call dispatchOnboardingStep directly without supertest to test step handlers as pure units"

key-files:
  created:
    - tests/onboarding-platform.test.ts
    - tests/onboarding-flow.test.ts
  modified: []

key-decisions:
  - "Mocked ../src/database/db with chainable factory to prevent real PG connections; platform.ts does a direct db.update in re-registration path outside the queries mock boundary"
  - "Flow tests call dispatchOnboardingStep directly (not via supertest) for pure unit-test style; only db mock + client mock needed, no server teardown"
  - "Resume test dispatches empty string to hours_3_query to trigger re-ask branch — proves day-3 prompt sent without step advance"
  - "Pre-existing scheduler-agenda.test.ts failures (4 tests) confirmed not caused by this plan"

patterns-established:
  - "D-13 mock pattern: jest.mock module-level + per-test mockResolvedValue / mockRejectedValue for getMeBotInfo control"
  - "botTokenStore.run shim: mockImplementation((_v, cb) => cb()) — same as telegram-webhook.test.ts"

requirements-completed:
  - BOT-01
  - ONB-01
  - ONB-02
  - ONB-03

coverage:
  - id: D1
    description: "HMAC verification rejects missing and wrong secrets with 401; correct secret accepted with 200"
    requirement: BOT-01
    verification:
      - kind: integration
        ref: "tests/onboarding-platform.test.ts#HMAC verification"
        status: pass
    human_judgment: false

  - id: D2
    description: "New owner: valid bot token creates business + session + Greek welcome prompt; invalid token rejects with error, no DB writes"
    requirement: BOT-01
    verification:
      - kind: integration
        ref: "tests/onboarding-platform.test.ts#New owner registration (BOT-01)"
        status: pass
    human_judgment: false

  - id: D3
    description: "Resume mid-flow: active session dispatches to dispatchOnboardingStep without creating business"
    requirement: ONB-02
    verification:
      - kind: integration
        ref: "tests/onboarding-platform.test.ts#Resume mid-flow (ONB-02)"
        status: pass
    human_judgment: false

  - id: D4
    description: "Re-registration: old webhook deleted, session reset to name step"
    requirement: BOT-01
    verification:
      - kind: integration
        ref: "tests/onboarding-platform.test.ts#Re-registration"
        status: pass
    human_judgment: false

  - id: D5
    description: "Deduplication: duplicate update_id suppresses all DB writes"
    requirement: BOT-01
    verification:
      - kind: integration
        ref: "tests/onboarding-platform.test.ts#Deduplication"
        status: pass
    human_judgment: false

  - id: D6
    description: "Full name→hours→services→done state machine progression validated by 14 unit tests"
    requirement: ONB-01
    verification:
      - kind: unit
        ref: "tests/onboarding-flow.test.ts#dispatchOnboardingStep — name step"
        status: pass
      - kind: unit
        ref: "tests/onboarding-flow.test.ts#Hours steps"
        status: pass
      - kind: unit
        ref: "tests/onboarding-flow.test.ts#Service steps"
        status: pass
    human_judgment: false

  - id: D7
    description: "Resume mid-flow (ONB-02): hours_3_query sends Τετάρτη prompt without advancing step"
    requirement: ONB-02
    verification:
      - kind: unit
        ref: "tests/onboarding-flow.test.ts#Resume mid-flow (ONB-02)"
        status: pass
    human_judgment: false

  - id: D8
    description: "isOwnerEditCommand case-insensitive detection of all four Greek edit keywords (ONB-03)"
    requirement: ONB-03
    verification:
      - kind: unit
        ref: "tests/onboarding-flow.test.ts#isOwnerEditCommand (ONB-03)"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-14
status: complete
---

# Phase 05 Plan 06: Onboarding Integration & Flow Tests Summary

**25-test suite (8 integration + 17 unit) proving BOT-01/ONB-01/ONB-02/ONB-03 end-to-end with full mocking — no real Telegram API or DB connections needed in CI**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-14T18:32:00Z
- **Completed:** 2026-07-14T18:47:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- 8 supertest integration tests for `POST /webhooks/telegram/platform`: HMAC rejection, new-owner valid/invalid token flow, mid-flow resume dispatch, re-registration webhook swap, dedup guard
- 17 unit tests calling `dispatchOnboardingStep` directly: complete hours (7 days × 3 steps) and services flow, isClosed row insertion, HH:MM validation, resume proof, handleActivate path, isOwnerEditCommand case-insensitivity
- All tests use D-13 mock pattern (jest.spyOn / jest.mock, no real `PLATFORM_BOT_TOKEN` in CI); confirmed 0 real network or DB calls

## Task Commits

1. **Task 1: Platform handler integration tests (BOT-01)** - `21f393a` (test)
2. **Task 2: State machine and edit flow tests (ONB-01/ONB-02/ONB-03)** - `44a580a` (test)

## Files Created/Modified

- `tests/onboarding-platform.test.ts` — 8 integration tests against POST /webhooks/telegram/platform via supertest; mocks db, onboarding/queries, telegram/client, onboarding/router
- `tests/onboarding-flow.test.ts` — 17 unit tests for dispatchOnboardingStep (router + steps) and isOwnerEditCommand; mocks db, onboarding/queries, telegram/client

## Decisions Made

- **db mock via factory**: `jest.mock('../src/database/db', factory)` with chainable return values prevents the PG pool from being created; necessary because `platform.ts` calls `db.update(businesses)` directly in the re-registration path, outside the `onboarding/queries` mock boundary
- **Flow tests unit-style**: Called `dispatchOnboardingStep` directly rather than via supertest — cleaner isolation, no server lifecycle needed, faster execution
- **Resume test uses empty string**: Dispatching `''` to `hours_3_query` triggers the "re-ask same question" branch, which sends the Τετάρτη prompt without advancing — proves correct day-3 routing without triggering step advancement side effects
- **Pre-existing failures not regressed**: `scheduler-agenda.test.ts` has 4 pre-existing failures; confirmed by running those tests without the new files

## Deviations from Plan

None — plan executed exactly as written. The `db` mock was an additional necessity (not explicitly listed in plan mocks) but is a minor implementation detail for preventing real PG connections; it follows the D-13 mock pattern and does not change any source behavior.

## Issues Encountered

- **Worktree base mismatch at startup**: The worktree branch (worktree-agent-aa479987845121eb2) was set up from acc4101 (phase-04 work) rather than e59a1ab (merge of 05-05). Since acc4101 is a direct ancestor of e59a1ab with no unique commits, the worktree branch was fast-forwarded to e59a1ab before plan execution — safe, no work lost.
- **scheduler-agenda.test.ts failures**: 4 tests pre-existing failures confirmed by running the suite without new files; not caused by this plan.

## Known Stubs

None — both test files are complete test suites, not stub implementations.

## Threat Flags

None — test-only files; no new network endpoints, auth paths, or schema changes.

## Self-Check: PASSED

- `tests/onboarding-platform.test.ts` FOUND ✓
- `tests/onboarding-flow.test.ts` FOUND ✓
- Task 1 commit `21f393a` FOUND ✓
- Task 2 commit `44a580a` FOUND ✓
- Platform tests: 8 (≥ 8 required) ✓
- Flow tests: 17 (≥ 14 required) ✓
- `grep "timingSafeEqual\|401\|Unauthorized" tests/onboarding-platform.test.ts` → matches ✓
- `grep "createBusinessForOnboarding\|createOrResetOnboardingSession" tests/onboarding-platform.test.ts` → matches ✓
- `grep "isClosed.*true\|isOwnerEditCommand" tests/onboarding-flow.test.ts` → matches ✓

## Next Phase Readiness

- All 4 onboarding requirements (BOT-01, ONB-01, ONB-02, ONB-03) now have automated test coverage
- Plan 07 (VALIDATION.md + phase close) can proceed with full test evidence

---
*Phase: 05-owner-self-serve-onboarding*
*Completed: 2026-07-14*
