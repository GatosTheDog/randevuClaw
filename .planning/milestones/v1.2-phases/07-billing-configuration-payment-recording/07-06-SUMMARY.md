---
phase: 07-billing-configuration-payment-recording
plan: "06"
subsystem: billing
tags: [gap-closure, payment-flow, client-selection, deactivate-package]
status: complete

dependency_graph:
  requires: [07-05-SUMMARY.md]
  provides: [getAllClientsForBusiness, deactivate_package name-based]
  affects: [src/billing/queries.ts, src/telegram/handlers/payment-flow.ts, src/onboarding/ai-owner-agent.ts, src/billing/tools.ts]

tech_stack:
  added: []
  patterns:
    - Fallback query chain (recent → all-time) in showClientSelection
    - Name-based resolution via partial match inside withBusinessContext

key_files:
  created: []
  modified:
    - src/billing/queries.ts
    - src/telegram/handlers/payment-flow.ts
    - src/onboarding/ai-owner-agent.ts
    - src/billing/tools.ts
    - tests/billing-payment-flow.test.ts

decisions:
  - "[07-06]: getAllClientsForBusiness uses getConn() inside withBusinessContext — RLS-scoped to current business, no booking join"
  - "[07-06]: showClientSelection two-step fallback — recent-bookings first, all-time clients second; Greek empty-state only when both empty"
  - "[07-06]: deactivate_package switched to package_name (string) — mirrors delete_service pattern; name resolved via case-insensitive partial match inside withBusinessContext"
  - "[07-06]: handleDeactivatePackage echoes matched package name when packageName arg provided; backward-compatible (no arg = generic string)"

metrics:
  duration: 4min
  completed: 2026-07-21
  tasks_completed: 2
  tasks_total: 2
  files_changed: 5
---

# Phase 07 Plan 06: Gap Closure G-07-5 and G-07-6 Summary

**One-liner:** Fixed two UAT gaps — all-time client fallback in payment flow + name-based package deactivation eliminating hallucinated IDs.

## Objective Achieved

Closed two UAT failures that blocked the Phase 7 billing end-to-end flow:

- **G-07-6:** Payment recording was unreachable for businesses with no bookings in the last 30 days. Fixed by adding `getAllClientsForBusiness` as a fallback path in `showClientSelection`.
- **G-07-5:** `deactivate_package` deactivated wrong packages because Gemini was required to supply a numeric `package_id` it had no way to know. Fixed by switching to `package_name` with server-side partial-match resolution.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | G-07-6: getAllClientsForBusiness fallback in showClientSelection | c93b67c | queries.ts, payment-flow.ts, test |
| 2 | G-07-5: deactivate_package name-based lookup | 68a5eb9 | ai-owner-agent.ts, tools.ts |

## Implementation Details

### Task 1: G-07-6 — getAllClientsForBusiness fallback

**`src/billing/queries.ts`**
- Added `AllTimeClient` type: `{ clientBusinessRelationshipId, clientName, senderPhone }`
- Added `getAllClientsForBusiness(businessId)` — queries `clientBusinessRelationships` directly with `eq(businessId)`, no booking join, no date filter, ordered by `desc(createdAt)`, uses `getConn()` for RLS

**`src/telegram/handlers/payment-flow.ts`**
- Imported `getAllClientsForBusiness`
- Replaced the `clients.length === 0` hard-exit with a two-step fallback:
  1. Call `getAllClientsForBusiness` inside `withBusinessContext`
  2. If also empty → send `"Δεν υπάρχουν εγγεγραμμένοι πελάτες."` and return
  3. If non-empty → build inline keyboard (label: `clientName ?? senderPhone`, callback_data: `billing:client:{id}`) and send with same prompt text

**`tests/billing-payment-flow.test.ts`**
- Added `getAllClientsForBusiness: jest.fn()` to mock factory
- Added `mockGetAllClients` cast
- Updated empty-state test: now mocks both queries returning empty, asserts new message
- Added new test "falls back to all-time clients keyboard when no recent bookings" (asserts keyboard shown with correct callback_data and label)
- **14 tests pass**

### Task 2: G-07-5 — deactivate_package name-based lookup

**`src/billing/tools.ts`**
- Added optional `packageName?: string` third param to `handleDeactivatePackage`
- When `packageName` is truthy, success reply interpolates the name: `Το πακέτο "${packageName}" απενεργοποιήθηκε. Υπάρχουσες συνδρομές δεν επηρεάζονται.`
- Backward-compatible: existing callers without the third arg still receive the generic string

**`src/onboarding/ai-owner-agent.ts`**
- Added `import { listPackages } from '../billing/queries'`
- `ToolArgs`: removed `package_id?: number`, added `package_name?: string`
- `OWNER_TOOLS` `deactivate_package`: replaced `package_id` (integer) with `package_name` (string, description mirrors `delete_service`)
- `executeOwnerTool` `deactivate_package` case: extract `packageName` → if empty return Greek error → `withBusinessContext` → `listPackages` → `find` partial match → if no match return not-found message → call `handleDeactivatePackage(business.id, match.id, match.name)`

## Verification

```
npx tsc --noEmit              → exit 0
billing-payment-flow.test.ts  → 14/14 pass
billing-package-deactivate.test.ts → 3/3 pass (backward-compatible)
```

Grep checks:
- `src/billing/queries.ts` exports `getAllClientsForBusiness`
- `src/onboarding/ai-owner-agent.ts` OWNER_TOOLS `deactivate_package` uses `package_name`

## Deviations from Plan

None — plan executed exactly as written.

## Threat Flags

None — both changes stay within the trust boundaries documented in the plan threat model. `getAllClientsForBusiness` uses `getConn()` (RLS-scoped). `deactivate_package` name resolution uses `listPackages(business.id)` which is RLS-scoped and cannot reach packages from another tenant.

## Self-Check: PASSED

Files created/modified:
- FOUND: src/billing/queries.ts (AllTimeClient + getAllClientsForBusiness)
- FOUND: src/telegram/handlers/payment-flow.ts (getAllClientsForBusiness fallback)
- FOUND: src/onboarding/ai-owner-agent.ts (package_name, listPackages)
- FOUND: src/billing/tools.ts (packageName param)
- FOUND: tests/billing-payment-flow.test.ts (mockGetAllClients, new test)

Commits verified:
- c93b67c (Task 1) — FOUND
- 68a5eb9 (Task 2) — FOUND
