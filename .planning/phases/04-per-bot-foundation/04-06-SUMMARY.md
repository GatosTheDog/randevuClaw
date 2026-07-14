---
phase: 04-per-bot-foundation
plan: "06"
subsystem: test-suite
tags: [gap-closure, tests, telegram, botTokenStore, expiry-poller, webhook]
dependency_graph:
  requires: [04-05]
  provides: [passing-test-suite-phase-4]
  affects: [ci]
tech_stack:
  added: []
  patterns:
    - botTokenStore.run wrapping in test bodies that call real AsyncLocalStorage
    - jest.Mock call-through for auto-mocked AsyncLocalStorage.run in module-mocked tests
key_files:
  created: []
  modified:
    - tests/telegram-client.test.ts
    - tests/expiry-poller.test.ts
    - tests/telegram-webhook.test.ts
decisions:
  - "[04-06]: botTokenStore.run('test-bot-token', ...) wraps API call + assertions in telegram-client tests — real ALS context, no jest.mock of client module"
  - "[04-06]: expiry-poller.test.ts uses jest.Mock.mockImplementation call-through pattern for botTokenStore.run (auto-mocked) — same pattern as telegram-webhook.test.ts"
  - "[04-06]: OWNER_BUSINESS_1.botToken changed from null to 'test-bot-token' to pass CR-03 guard (if (!business?.botToken) continue) in expiry-poller production code"
metrics:
  duration: 4 min
  completed: "2026-07-14"
  tasks_completed: 3
  files_modified: 3
status: complete
---

# Phase 04 Plan 06: Gap Closure — Test Suite Alignment Summary

**One-liner:** Fixed 10 test failures across three test files by aligning them with CR-03 (botTokenStore wrapping) and WR-01 (single-arg answerCallbackQuery) code-review fixes.

## What Was Built

Ten test failures introduced when CR-03 and WR-01 changed observable production behavior were resolved by updating the three affected test files. No production code was modified.

**Root causes addressed:**

| File | Root Cause | Tests Fixed |
|------|------------|-------------|
| telegram-client.test.ts | CR-03: callTelegramApi throws when botTokenStore.getStore() returns undefined; tests called production functions outside async context | Tests 1–5 |
| expiry-poller.test.ts | (A) CR-03 guard `if (!business?.botToken) continue` fired on null fixture; (B) findBusinessById not defaulted in beforeEach; (C) jest auto-mock of botTokenStore.run returned undefined without invoking callback | Tests 2, 3, 7 |
| telegram-webhook.test.ts | WR-01: webhook handler calls answerCallbackQuery(id) with no second arg; assertions still expected old 2-arg form | Tests 5, 9 |

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Wrap all 5 telegram-client test API calls in botTokenStore.run | 181de56 | tests/telegram-client.test.ts |
| 2 | Fix expiry-poller: botToken fixture, findBusinessById default, run call-through | bac2c2b | tests/expiry-poller.test.ts |
| 3 | Update 2 answerCallbackQuery assertions to single-argument form | a73dc9a | tests/telegram-webhook.test.ts |

## Verification Results

```
npx jest tests/telegram-client.test.ts  → 5 passed, 0 failed
npx jest tests/expiry-poller.test.ts    → 7 passed, 0 failed
npx jest tests/telegram-webhook.test.ts → 20 passed, 0 failed
npm test (full suite)                   → 206 passed, 4 failed (all in scheduler-agenda.test.ts — pre-existing time-dependent), 1 skipped
```

Phase 4 test-suite target met.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- tests/telegram-client.test.ts: modified (botTokenStore import + 5 run wrappers)
- tests/expiry-poller.test.ts: modified (botToken fixture, 2 beforeEach lines)
- tests/telegram-webhook.test.ts: modified (2 assertion changes)
- Commits 181de56, bac2c2b, a73dc9a all present in git log

## Self-Check: PASSED
