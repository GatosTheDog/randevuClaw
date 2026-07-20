---
phase: 08-enforcement-session-deduction
plan: "01"
subsystem: testing
tags: [jest, ts-jest, billing, session-deduction, enforcement-policy, it.todo]

requires:
  - phase: 07-billing-configuration-payment-recording
    provides: membership_ledger schema, memberships schema, billing/queries.ts patterns

provides:
  - tests/billing-session-deduction.test.ts with 5 it.todo stubs (SESS-01..04)
  - tests/billing-enforcement-policy.test.ts with 3 it.todo stubs (ENFC-01)
  - tests/function-executor.test.ts Phase 8 describe block with 6 it.todo stubs (ENFC-02/03, SESS-01/02/04)

affects:
  - 08-02
  - 08-03
  - 08-04
  - 08-05

tech-stack:
  added: []
  patterns:
    - "Wave 0 test scaffolding: it.todo stubs with no imports from unbuilt modules keeps ts-jest green before any implementation"
    - "Enforcement policy unit test: jest.mock of billing/queries with setBusinessEnforcementPolicy as jest.fn() allows future Plan 05 require() inside test bodies"

key-files:
  created:
    - tests/billing-session-deduction.test.ts
    - tests/billing-enforcement-policy.test.ts
  modified:
    - tests/function-executor.test.ts

key-decisions:
  - "it.todo stubs with no imports from unbuilt modules — keeps stubs compilable by ts-jest before any implementation exists (established pattern, Phase 7 Wave 0)"
  - "billing-enforcement-policy.test.ts mocks setBusinessEnforcementPolicy: jest.fn() at module level without importing handleSetEnforcementPolicy — ships in Plan 05"

patterns-established:
  - "Pattern: Phase 8 billing test preamble mirrors billing-membership-creation.test.ts (TEST_DATABASE_URL, jest.resetModules, require pattern, afterAll DATABASE_URL restore)"
  - "Pattern: Unit enforcement test uses jest.mock factory for billing/queries + logger silence; no top-level import of unbuilt handlers"

requirements-completed:
  - SESS-01
  - SESS-02
  - SESS-03
  - SESS-04
  - ENFC-01
  - ENFC-02
  - ENFC-03

coverage:
  - id: D1
    description: "billing-session-deduction.test.ts created with 5 it.todo stubs covering SESS-01..04 (Wave 0 scaffolding)"
    requirement: SESS-01
    verification:
      - kind: unit
        ref: "tests/billing-session-deduction.test.ts — npx jest --testPathPattern=billing-session-deduction: 5 todo, 0 failed"
        status: pass
    human_judgment: false
  - id: D2
    description: "billing-enforcement-policy.test.ts created with 3 it.todo stubs covering ENFC-01 (Wave 0 scaffolding)"
    requirement: ENFC-01
    verification:
      - kind: unit
        ref: "tests/billing-enforcement-policy.test.ts — npx jest --testPathPattern=billing-enforcement-policy: 3 todo, 0 failed"
        status: pass
    human_judgment: false
  - id: D3
    description: "function-executor.test.ts extended with Phase 8 describe block: 6 it.todo stubs for ENFC-02/03 and SESS-01/02/04"
    requirement: ENFC-02
    verification:
      - kind: unit
        ref: "tests/function-executor.test.ts — npx jest --testPathPattern=function-executor: 15 passed + 6 todo, 0 failed"
        status: pass
    human_judgment: false

duration: 3min
completed: 2026-07-20
status: complete
---

# Phase 8 Plan 01: Wave 0 Test Scaffolding Summary

**Three test files with 14 it.todo stubs scaffold SESS-01..04 and ENFC-01..03 without importing unbuilt functions, keeping ts-jest compilation green across Phase 8**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-20T14:21:59Z
- **Completed:** 2026-07-20T14:25:44Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Created tests/billing-session-deduction.test.ts: 5 it.todo stubs (SESS-01 deduction + idempotency, SESS-02/03 credit restore, SESS-04 unlimited) using the established billing integration test preamble
- Created tests/billing-enforcement-policy.test.ts: 3 it.todo stubs (ENFC-01 persist policy, Greek confirmation, Greek error) with jest.mock pattern matching billing-payment-flow.test.ts
- Extended tests/function-executor.test.ts: appended Phase 8 describe block with 6 it.todo stubs covering enforcement policy checks and deduction/restore tool behaviors; all 15 existing tests remain passing
- Full test suite green: 37 suites, 278 passing, 14 todo, 1 pre-existing skip

## Task Commits

1. **Task 1: Create tests/billing-session-deduction.test.ts** - `4a570be` (test)
2. **Task 2: Create tests/billing-enforcement-policy.test.ts** - `00e88ab` (test)
3. **Task 3: Extend tests/function-executor.test.ts with Phase 8 stubs** - `b5b9f14` (test)

## Files Created/Modified

- `tests/billing-session-deduction.test.ts` — New integration test stub file; 5 it.todo covering SESS-01..04; preamble mirrors billing-membership-creation.test.ts; no imports of unbuilt functions
- `tests/billing-enforcement-policy.test.ts` — New unit test stub file; 3 it.todo covering ENFC-01; jest.mock of billing/queries + logger; no top-level import of handleSetEnforcementPolicy
- `tests/function-executor.test.ts` — Phase 8 describe block appended at end; 6 it.todo stubs for ENFC-02/03 and SESS-01/02/04 tool behaviors; no existing code modified

## Decisions Made

- Wave 0 scaffolding pattern: it.todo stubs with no imports from unbuilt modules — same pattern established in Phase 7; ensures ts-jest compilation stays green throughout Phase 8 build-out
- billing-enforcement-policy.test.ts mocks `setBusinessEnforcementPolicy: jest.fn()` in the `billing/queries` factory without any top-level `import`/`require` of `handleSetEnforcementPolicy` — that function ships in Plan 05 (not Plan 01)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 8 test stub files in place for Phase 8 implementation plans (02 through 05)
- Plan 02 can begin: schema migration to add `enforcement_policy` column to `businesses` table
- Plan 03 can begin: `deductSession` / `restoreCredit` / `getActiveMembershipForDeduction` / `findMembershipByBooking` implementations in billing/queries.ts
- No blockers from this plan

---
*Phase: 08-enforcement-session-deduction*
*Completed: 2026-07-20*
