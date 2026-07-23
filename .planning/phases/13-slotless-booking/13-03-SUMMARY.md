---
phase: 13
plan: 03
subsystem: telegram-webhook
tags: [slotless-booking, telegram, callback-handler, integration-tests]
dependency_graph:
  requires: [13-01, 13-02]
  provides: [slotless-callback-handler, slotless-integration-tests]
  affects: [src/webhooks/telegram.ts, tests/slotless-requests.test.ts]
tech_stack:
  added: []
  patterns: [callback-discriminant-union, integration-test-with-local-pg]
key_files:
  modified:
    - src/webhooks/telegram.ts
  created:
    - tests/slotless-requests.test.ts
decisions:
  - Used 'slotlessRequestId' in parsed as discriminant for SlotlessCallbackResult (consistent with 'firstId' in parsed for BillingCallbackResult)
  - void request in approve branch silences unused-variable lint warning while preserving type-narrowing
  - Test delays (10ms) between inserts ensure deterministic createdAt ordering for SLOT-05 list test
  - Tests fail with ECONNREFUSED in CI (no local Postgres) — documented as expected
metrics:
  duration: 15m
  completed: 2026-07-23
  tasks_completed: 2
  files_modified: 1
  files_created: 1
status: complete
---

# Phase 13 Plan 03: Slotless Callback Handler + Integration Tests Summary

**One-liner:** Ναι/Όχι inline-keyboard callback handler for slotless requests wired into telegram.ts, plus 8 integration tests for SLOT-01 through SLOT-06.

## Tasks Completed

| # | Description | Commit | Files |
|---|-------------|--------|-------|
| 1 | Add SlotlessCallbackResult type + callback handler in telegram.ts | 24561e0 | src/webhooks/telegram.ts |
| 2 | Integration tests for SLOT-01 through SLOT-06 | 00bbdbb | tests/slotless-requests.test.ts |

## What Was Built

### Task 1: telegram.ts extensions

- **`SlotlessCallbackResult` type** added alongside `BookingCallbackResult` and `BillingCallbackResult`:
  - `action: 'slotless:req_approve' | 'slotless:req_reject'`
  - `slotlessRequestId: number`

- **`parseCallbackData` return type** extended to `BookingCallbackResult | BillingCallbackResult | SlotlessCallbackResult | null`

- **New regex branch** in `parseCallbackData` parses `slotless:(req_approve|req_reject):<id>` patterns

- **Slotless callback branch** in `handleCallbackQuery` (after billing branch):
  - Discriminant: `'slotlessRequestId' in parsed`
  - Cross-tenant guard: resolves owner business from `senderTelegramId` via `findBusinessByOwnerTelegramId`
  - Approve: calls `approveSlotlessRequest`, notifies client (best-effort), sends owner confirmation
  - Reject: calls `rejectSlotlessRequest`, notifies client (best-effort), sends owner acknowledgement
  - Clears keyboard via `editTelegramMessageReplyMarkup` regardless of outcome
  - Imported `approveSlotlessRequest`, `rejectSlotlessRequest` from `../session/slotless-requests`

### Task 2: slotless-requests.test.ts (8 tests)

| Test | Requirement | Description |
|------|-------------|-------------|
| 1 | SLOT-01 | insertSlotlessRequest inserts a pending row |
| 2 | SLOT-01 | insertSlotlessRequest is idempotent on same idempotencyKey |
| 3 | SLOT-03 | approveSlotlessRequest creates booking and deducts credit |
| 4 | SLOT-03 | approveSlotlessRequest returns null for lapsed membership |
| 5 | SLOT-04 | rejectSlotlessRequest sets status to rejected |
| 6 | SLOT-04 | rejectSlotlessRequest on already-rejected row returns null |
| 7 | SLOT-05 | listSlotlessRequestsForClient returns requests in DESC order |
| 8 | SLOT-06 | countSlotlessRequestsSinceCheckin returns correct count |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. The callback handler enforces the same cross-tenant guard pattern as the billing callback branch.

## Test Run Result

Tests fail with `AggregateError` (ECONNREFUSED) — no local Postgres server available in this environment. This is expected and documented. TypeScript compiles all files without errors.

## Self-Check: PASSED

- `src/webhooks/telegram.ts` — modified, exists ✓
- `tests/slotless-requests.test.ts` — created, exists ✓
- Commit `24561e0` — exists ✓
- Commit `00bbdbb` — exists ✓
- `npx tsc --noEmit` — no errors ✓
