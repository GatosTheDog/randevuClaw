---
phase: quick-260813-jgj
plan: 01
subsystem: billing
tags: [telegram, payment-flow, bugfix]
dependency-graph:
  requires: []
  provides: []
  affects: [src/telegram/handlers/payment-flow.ts]
tech-stack:
  added: []
  patterns:
    - "Single isInBusinessContext() check gates a Promise.all of two independent reads instead of gating a single query — preserves the WR-02 no-nested-transaction contract while fetching both lists unconditionally."
key-files:
  created: []
  modified:
    - src/telegram/handlers/payment-flow.ts
    - tests/billing-payment-flow.test.ts
decisions:
  - "Merged never-booked clients (from getAllClientsForBusiness) always after recent-booking clients (from getRecentClientsForBusiness), deduplicated by clientBusinessRelationshipId, rather than reintroducing a separate fallback code path."
metrics:
  duration: "~10 min"
  completed: "2026-08-13"
status: complete
---

# Quick Task 260813-jgj: Fix payment client-selection list to always include never-booked clients Summary

Fixed `showClientSelection` in `src/telegram/handlers/payment-flow.ts` so the "who paid?" keyboard always merges recent-booking clients with never-booked clients, instead of only showing never-booked clients when the entire business had zero recent bookings.

## What Changed

**`src/telegram/handlers/payment-flow.ts`** — `showClientSelection`:
- Replaced the single-query branch (`getRecentClientsForBusiness` only, with `getAllClientsForBusiness` gated behind `if (clients.length === 0)`) with an unconditional `Promise.all([getRecentClientsForBusiness(businessId, 30), getAllClientsForBusiness(businessId)])`.
- The `isInBusinessContext()` check is still called exactly once and reused to decide whether to run the `Promise.all` directly (already inside an ambient transaction) or wrap it in one `withBusinessContext` call — preserving the WR-02 "never nest a second transaction" contract.
- Never-booked clients are computed as `allClients` entries whose `clientBusinessRelationshipId` is NOT in the `Set` built from the recent-clients list — deduplicated by construction.
- The "no clients at all" empty-state guard is now `clients.length === 0 && neverBookedClients.length === 0` (same Greek message, same early return), reached via a merged emptiness check instead of nested branches.
- The keyboard is built in two label passes (recent clients first — richer `clientName ?? "service — date"` label; never-booked clients appended after — `clientName ?? senderPhone` label), each with the same `>64 byte` `logger.warn` guard on `callback_data` carried forward unchanged.
- Collapsed the two near-duplicate `sendTelegramMessageWithKeyboard` calls (one per old branch) into a single call on the merged keyboard.
- Deleted the old fallback branch's separate re-fetch and `fallbackKeyboard` construction entirely.

**`tests/billing-payment-flow.test.ts`**:
- Added `mockGetAllClients.mockResolvedValue([]);` to the file's top-level `beforeEach` (alongside `jest.clearAllMocks()`) as a safe default now that `getAllClientsForBusiness` is always invoked. Tests that already set their own `mockGetAllClients` value (empty-state test, all-time-fallback test) override this default per Jest's mock-resolution order.
- Added a new regression test in the `showClientSelection` describe block reproducing the exact reported bug: one client with a recent booking (id 101) plus one never-booked client (id 500, present only in the all-time list, with id 101 also duplicated in the all-time list to mirror real DB behavior). Asserts:
  - The never-booked client's `callback_data` (`billing:client:500`) is present.
  - The recent client's `callback_data` (`billing:client:101`) appears exactly once (not duplicated by the merge).
  - The never-booked client's label falls back to its `senderPhone`.
  - The keyboard has exactly 2 rows total.

## Verification

- `npx jest --testPathPattern billing-payment-flow -i` — 16/16 tests pass, including the new regression test and all 6 pre-existing `showClientSelection` tests unchanged.
- `npx tsc --noEmit` — clean, no type errors.
- Manual read-check confirms `getRecentClientsForBusiness` and `getAllClientsForBusiness` in `src/billing/queries.ts` are byte-for-byte unchanged (query logic untouched, only the merge/branching logic in `payment-flow.ts` changed).

## Deviations from Plan

None — plan executed exactly as written.

## Out-of-Scope Note (not fixed, logged for visibility)

While running the broader `npx jest --testPathPattern billing -i` sweep to sanity-check adjacent billing tests, 3 unrelated test files (`billing-session-deduction.test.ts`, `billing-package-list.test.ts`, `billing-package-deactivate.test.ts`) fail with `TS2451: Cannot redeclare block-scoped variable` errors when run together in the same Jest process — a pre-existing test-isolation/module-scope collision between those files, unrelated to this plan's files or changes. `billing-payment-flow.test.ts` itself passes cleanly in isolation and as part of that sweep. Not fixed per the scope boundary (pre-existing, unrelated to the current task's files).

## Self-Check: PASSED

- FOUND: src/telegram/handlers/payment-flow.ts
- FOUND: tests/billing-payment-flow.test.ts
- FOUND commit: 2c5bc2e (fix(quick-260813-jgj): always merge never-booked clients into payment client-selection keyboard)
