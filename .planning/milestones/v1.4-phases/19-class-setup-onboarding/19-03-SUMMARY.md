---
phase: 19-class-setup-onboarding
plan: "03"
subsystem: onboarding/class-setup
tags: [tests, onboarding, class-setup, tdd]
status: complete

dependency_graph:
  requires:
    - 19-01  # class setup step handlers implemented in steps.ts
  provides:
    - CLSS-01-tests
    - CLSS-02-tests
    - CLSS-03-tests
    - CLSS-04-tests
    - CLSS-05-tests
  affects:
    - src/onboarding/steps.ts

tech_stack:
  added: []
  patterns:
    - Jest unit tests with module mocking (jest.mock)
    - Typed mock references for compile-time safety
    - buildSession/buildBusiness helper fixtures for test data construction

key_files:
  created:
    - tests/onboarding/class-setup-steps.test.ts
  modified: []

decisions:
  - Test file placed at tests/onboarding/class-setup-steps.test.ts (not src/onboarding/__tests__/) because jest.config.js testMatch only covers the tests/ directory tree
  - Test B assertion uses null (not expect.anything()) because handleClassSetupQuery passes null as the third argument to updateOnboardingStep on the Ναι path

metrics:
  completed_date: "2026-07-24T10:30:18Z"
  duration_minutes: 10
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 0
---

# Phase 19 Plan 03: Class Setup Step Tests Summary

14 Jest unit tests verifying every branch of the class_setup_* onboarding step handlers against fully mocked DB and Telegram dependencies.

## What Was Built

`tests/onboarding/class-setup-steps.test.ts` — 14 focused tests (A through N) covering skip/happy/weekday/invalid-input paths for all six class-setup step handlers plus the `handleConfigLastSessionThresholdStep` bookingMode branch.

## Tests Implemented

| Test | Handler | Input | Expected |
|------|---------|-------|----------|
| A | handleClassSetupQuery | 'όχι' | NOT advance to class_setup_service; activateBusiness called |
| B | handleClassSetupQuery | 'ναι' | advance to class_setup_service |
| C | handleClassSetupServiceStep | 'Pilates Reformer' (match) | advance to class_setup_weekdays |
| D | handleClassSetupServiceStep | 'nonexistent' (no match) | step NOT advanced, re-ask sent |
| E | handleClassSetupWeekdaysStep | 'καθημερινά' | 5 weekdays (Mon-Fri) stored |
| F | handleClassSetupWeekdaysStep | 'Δευτέρα, Τετάρτη' | 2 weekdays stored |
| G | handleClassSetupTimeStep | '09:00' (valid) | advance to class_setup_capacity |
| H | handleClassSetupTimeStep | 'abc' (invalid) | step NOT advanced, error sent |
| I | handleClassSetupCapacityStep | '4' (valid) | createSessionCatalogWithExpansion(99, 42, rrule, '09:00', 4) |
| J | handleClassSetupCapacityStep | '0' (invalid) | step NOT advanced |
| K | handleClassSetupMoreStep | 'ναι' | advance to class_setup_service |
| L | handleClassSetupMoreStep | 'όχι' | activateBusiness called (handleActivate path) |
| M | handleConfigLastSessionThresholdStep | '3', fixed_sessions | advance to class_setup_query |
| N | handleConfigLastSessionThresholdStep | '3', open_slots | activateBusiness called (handleActivate path) |

## Verification

```
npm test -- --testPathPattern="class-setup-steps" --testTimeout=20000

Test Suites: 1 passed, 1 total
Tests:       14 passed, 14 total
```

TypeScript: `npx tsc --noEmit` — no errors.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test file location adjusted to match Jest config**
- **Found during:** Task 1 (implementation)
- **Issue:** Plan specified `src/onboarding/__tests__/class-setup-steps.test.ts` but jest.config.js `testMatch` only covers `**/tests/**/*.test.ts`. The file in `src/` would not be picked up by the test runner.
- **Fix:** Created the file at `tests/onboarding/class-setup-steps.test.ts` so it is discovered under the `--testPathPattern="class-setup-steps"` command specified in the plan.
- **Files modified:** tests/onboarding/class-setup-steps.test.ts

**2. [Rule 1 - Bug] Test B assertion: expect.anything() does not match null**
- **Found during:** First test run
- **Issue:** Plan spec said `expect.anything()` for the third argument but `handleClassSetupQuery` passes literal `null` as the collectedData argument when advancing to 'class_setup_service'. `expect.anything()` matches all values except `null` and `undefined`.
- **Fix:** Changed assertion to `.toHaveBeenCalledWith(1, 'class_setup_service', null)`.
- **Commit:** e08f1b8

## Commits

| Hash | Message |
|------|---------|
| e08f1b8 | test(19-03): class setup onboarding step tests — 14 tests covering skip/happy/weekday/invalid paths |

## Self-Check: PASSED

- [x] tests/onboarding/class-setup-steps.test.ts exists
- [x] Commit e08f1b8 exists in git log
- [x] 14/14 tests pass
- [x] npx tsc --noEmit passes with no errors
