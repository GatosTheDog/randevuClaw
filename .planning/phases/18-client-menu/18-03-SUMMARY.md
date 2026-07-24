---
phase: 18-client-menu
plan: "03"
subsystem: telegram/handlers
tags: [client-menu, cancel, bookings, balance, credit-restore, cutoff]
dependency_graph:
  requires: [18-01, 18-02]
  provides: [showClientBookings, showCancelBookingList, showCancelConfirm, handleCancelExecute, showClientBalance]
  affects: [src/telegram/handlers/client-menu.ts]
tech_stack:
  added: []
  patterns: [ownership-guard, best-effort-side-effects, idempotent-credit-restore, athens-timezone-cutoff]
key_files:
  modified:
    - src/telegram/handlers/client-menu.ts
decisions:
  - hoursUntilSession copied verbatim (not imported) from conversation/function-executor.ts to avoid conversation-layer coupling
  - findBookingByIdUnscoped used for cancel path per existing pattern in telegram.ts (unscoped lookup + immediate ownership check)
  - botTokenStore.run wraps owner notification so the correct per-business bot token is used for outbound Telegram message
metrics:
  duration: "~2 minutes"
  completed: "2026-07-24"
  tasks_completed: 2
  files_modified: 1
status: complete
---

# Phase 18 Plan 03: Cancel/Balance/Bookings Flows Summary

Added `showClientBookings`, `showCancelBookingList`, `showCancelConfirm`, `handleCancelExecute`, and `showClientBalance` to `src/telegram/handlers/client-menu.ts`, completing CMENU-03 and CMENU-04 (My Bookings display + full Cancel flow with cutoff enforcement, credit restore, and ownership guard).

## What Was Built

**Task 1 — Display functions:**
- `showClientBookings`: queries `listClientBookings`, renders empty state or date/time list with Cancel + Back buttons
- `showCancelBookingList`: same query scoped to `senderTelegramId`, capped at 10, one inline button per booking (`cmenu:cancel:confirm:<id>`)
- `showCancelConfirm`: Ναι/Όχι keyboard for `cmenu:cancel:yes:<id>` vs `cmenu:root`
- `showClientBalance`: calls `getClientActiveMembership`, renders no-membership / unlimited / finite states with `.toLocaleDateString('el-GR')` for expiry
- `hoursUntilSession` local helper: exact Athens-timezone arithmetic copied from `conversation/function-executor.ts`

**Task 2 — Execution and wiring:**
- `handleCancelExecute`: ownership guard (`booking.clientPhone !== senderTelegramId`) → status check (only `pending_owner_approval`/`confirmed`) → cutoff check (`hoursUntilSession < business.cancellationCutoffHours`) → `updateBookingStatus('cancelled')` → `findMembershipByBooking` + `restoreCredit` (idempotent) → `deleteBookingFromCalendar` (best-effort try/catch) → owner notification via `botTokenStore.run` (best-effort try/catch) → client confirmation
- Dispatcher cases wired: `bookings`, `cancel`, `cancel:confirm`, `cancel:yes`, `balance`

## Commits

| Hash | Message |
|------|---------|
| 866db18 | feat(18-03): cancel/balance/bookings flows — cancel cutoff, credit restore, ownership guard |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all functions are fully wired to real DB queries and side effects.

## Threat Flags

No new network endpoints, auth paths, or trust boundaries introduced. All mutations are guarded by:
- Ownership check before any DB write (`booking.clientPhone !== senderTelegramId`)
- Business context is HMAC-verified upstream (telegram.ts webhook layer)
- `findBookingByIdUnscoped` is used consistent with the established pattern for the callback cancel path (T-02-20 pattern)

## Self-Check: PASSED

- `src/telegram/handlers/client-menu.ts` — FOUND
- `.planning/phases/18-client-menu/18-03-SUMMARY.md` — FOUND
- Commit `866db18` — FOUND in git log
- `npx tsc --noEmit` — clean (zero errors, zero warnings that would block compilation)
