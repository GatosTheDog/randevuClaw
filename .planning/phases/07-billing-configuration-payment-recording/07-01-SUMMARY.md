---
phase: "07"
plan: "01"
subsystem: billing-test-stubs
status: complete
tags: [billing, test-stubs, nyquist, coverage]
dependency_graph:
  requires: []
  provides: [billing-test-stubs, billing-coverage-matrix]
  affects: [07-02, 07-03, 07-04, 07-05]
tech_stack:
  added: []
  patterns: [it.todo stubs, Nyquist Wave 0 RED contract]
key_files:
  created:
    - tests/billing-package-creation.test.ts
    - tests/billing-nlu-parsing.test.ts
    - tests/billing-package-list.test.ts
    - tests/billing-package-deactivate.test.ts
    - tests/billing-payment-flow.test.ts
    - tests/billing-membership-creation.test.ts
    - tests/billing-dst-arithmetic.test.ts
    - tests/billing-view-membership.test.ts
    - .planning/phases/07-billing-configuration-payment-recording/COVERAGE.md
  modified: []
decisions:
  - "it.todo stubs with no imports from unbuilt modules — keeps stubs compilable by ts-jest before any implementation exists"
  - "billing-dst-arithmetic.test.ts isolated as its own file — DST edge cases for PAY-02 warranted a separate describe scope from general membership creation"
  - "COVERAGE.md documents editMessageReplyMarkup as OPT-OUT — replacing the keyboard message on each step avoids stale keyboard state edge cases"
metrics:
  duration: "~4 minutes"
  completed_date: "2026-07-20"
  tasks_completed: 2
  files_created: 9
  files_modified: 0
requirements:
  - BILL-01
  - BILL-02
  - BILL-03
  - PAY-01
  - PAY-02
  - PAY-03
---

# Phase 07 Plan 01: Billing Test Stubs & Coverage Matrix Summary

**One-liner:** 8 Jest it.todo() stub files covering all BILL-01..03 and PAY-01..03 requirements, plus a Telegram/Gemini API coverage matrix for Phase 7.

## What Was Built

Two tasks in Wave 0:

**Task 1 — 8 billing test stub files:** Each file covers one requirement area (BILL-01/02/03, PAY-01/02/03, PAY-02 DST edge case). All 37 stubs use `it.todo()` with no imports from unbuilt modules. Jest reports 8 test suites, 37 todos, 0 failures.

**Task 2 — COVERAGE.md:** API coverage matrix with two tables. Telegram table: 3 capabilities INTEGRATE (sendMessage, sendMessage+InlineKeyboardMarkup, answerCallbackQuery), 1 OPT-OUT (editMessageReplyMarkup). Gemini table: 6 capabilities INTEGRATE (generateContent+tools + 5 billing function_declarations), 1 OPT-OUT (streaming).

## Commits

| Hash | Message |
|------|---------|
| c7dcf3b | test(07-01): add 8 billing test stub files (Wave 0 RED state) |
| 156dfbf | docs(07-01): create COVERAGE.md with Telegram and Gemini billing API surface |

## Verification Results

```
Test Suites: 8 passed, 8 total
Tests:       37 todo, 37 total
Snapshots:   0 total
Time:        ~16 s
```

All acceptance criteria passed:
- 8 billing test files exist in tests/
- 37 todo stubs (> 20 minimum)
- Jest exits 0 with no failures
- No billing imports in any stub file
- COVERAGE.md: 9 INTEGRATE, 2 OPT-OUT, answerCallbackQuery + record_payment + view_client_membership all documented

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

The test files themselves are stubs by design (Wave 0 Nyquist contract). No production code stubs were introduced. The `it.todo()` stubs will be filled in by Plans 07-02 through 07-05 as each implementation plan ships.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes were introduced in this plan. Threat model items T-07-01 through T-07-06 remain at their Wave 0 `accept` disposition and will be mitigated in later plans per the threat register in 07-01-PLAN.md.

## Self-Check: PASSED

Files verified:
- tests/billing-package-creation.test.ts — FOUND
- tests/billing-nlu-parsing.test.ts — FOUND
- tests/billing-package-list.test.ts — FOUND
- tests/billing-package-deactivate.test.ts — FOUND
- tests/billing-payment-flow.test.ts — FOUND
- tests/billing-membership-creation.test.ts — FOUND
- tests/billing-dst-arithmetic.test.ts — FOUND
- tests/billing-view-membership.test.ts — FOUND
- .planning/phases/07-billing-configuration-payment-recording/COVERAGE.md — FOUND

Commits verified:
- c7dcf3b — FOUND
- 156dfbf — FOUND
