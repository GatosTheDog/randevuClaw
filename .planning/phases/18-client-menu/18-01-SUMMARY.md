---
phase: 18-client-menu
plan: "01"
subsystem: telegram-client-menu
tags: [client-menu, telegram, callback-routing, typescript]
dependency_graph:
  requires: [17-admin-menu]
  provides: [client-menu-scaffold, cmenu-callback-routing, start-intercept]
  affects: [src/webhooks/telegram.ts, src/telegram/handlers/client-menu.ts]
tech_stack:
  added: []
  patterns: [discriminant-union-narrowing, module-private-helper-copy]
key_files:
  created:
    - src/telegram/handlers/client-menu.ts
  modified:
    - src/webhooks/telegram.ts
decisions:
  - "Renamed local `business` var inside handleCallbackQuery to `bookingBusiness` to avoid parameter shadow — Rule 1 auto-fix"
  - "client-menu.ts already existed from prior fix commit; verified it matched plan spec before skipping recreation"
metrics:
  duration: "5 minutes"
  completed: "2026-07-24"
  tasks_completed: 2
  files_changed: 2
status: complete
---

# Phase 18 Plan 01: Client Menu Scaffold Summary

**One-liner:** Client menu scaffold with `ClientMenuCallbackResult` discriminant type, `showClientRootMenu` 2x2 keyboard, `cmenu:` callback routing arm, `business` param threading into `handleCallbackQuery`, and `/start` pre-emption in client branch.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Create src/telegram/handlers/client-menu.ts | 6498664 | src/telegram/handlers/client-menu.ts (created) |
| 2 | Extend src/webhooks/telegram.ts | 6498664 | src/webhooks/telegram.ts (modified) |

## Verification

TypeScript check: `npx tsc --noEmit` — zero errors after all edits applied.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Duplicate identifier `business` in `handleCallbackQuery`**
- **Found during:** Task 2, EDIT 4
- **Issue:** Adding `business: Business` as the third parameter to `handleCallbackQuery` caused a duplicate identifier error because the function body had a local `const business = await findBusinessById(booking.businessId)` near the bottom of the function.
- **Fix:** Renamed the local variable to `bookingBusiness` and updated all references within that block (`deleteBookingFromCalendar`, `syncBookingToCalendar`).
- **Files modified:** `src/webhooks/telegram.ts`
- **Commit:** 6498664

**2. [Observation] client-menu.ts pre-existed**
- The `src/telegram/handlers/client-menu.ts` file was already created by the prior fix commit (`a3a1726`). Its content matched the plan spec exactly, so Task 1 was verified (not recreated).

**3. [Observation] telegram.ts import and return type pre-existed**
- EDIT 1 (import of `ClientMenuCallbackResult`) and EDIT 2 (union return type) were already applied in the prior fix commit. Only EDITs 3–7 remained to implement.

## Known Stubs

None — `showClientRootMenu` renders a complete 2x2 keyboard; `handleClientMenuCallback` falls through to `'Άγνωστη ενέργεια.'` for unimplemented actions, which is the intentional skeleton. Plans 18-02 through 18-04 will fill in the cases.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. The `cmenu:` callback arm uses the same HMAC-verified `business` parameter already present in the webhook handler; no untrusted data from `callback_data` is used as a business identifier.

## Self-Check: PASSED

- [x] `src/telegram/handlers/client-menu.ts` exists
- [x] `src/webhooks/telegram.ts` modified
- [x] Commit `6498664` exists in git log
- [x] `npx tsc --noEmit` exits with no errors
