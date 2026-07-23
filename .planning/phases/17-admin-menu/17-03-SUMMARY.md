---
phase: "17-admin-menu"
plan: 3
status: complete
subsystem: telegram-admin-menu
tags: [telegram, admin-menu, classes, cancel-confirmation, sessions]
requires: ["17-01"]
provides: [classes-submenu, cancel-class-flow, binary-confirmation]
affects:
  - src/telegram/handlers/admin-menu.ts
  - src/webhooks/telegram.ts
  - src/scheduler/agenda.ts
tech-stack:
  added: []
  patterns: [stateless-inline-keyboard, binary-decision, session-cancellation-flow]
key-files:
  created:
    - src/telegram/handlers/admin-menu.ts
  modified:
    - src/webhooks/telegram.ts
    - src/scheduler/agenda.ts
decisions:
  - "Worktree did not have 17-01 commits from main — applied all 17-01 infrastructure in this plan's single commit alongside 17-03 classes sub-menu content"
  - "Both Task 1 and Task 2 committed atomically since both target the same file and both passed TypeScript before commit"
  - "showCancelClassList caps at 10 sessions (30-day window) per plan spec for keyboard ergonomics"
  - "classes:cancel_no guard checks result.id === undefined defensively even though regex always captures numeric ID for that pattern"
  - "formatAgendaMessage exported in this commit to keep worktree self-contained"
metrics:
  duration: "~4 minutes"
  completed: "2026-07-24T00:00:00Z"
  tasks_completed: 2
  files_changed: 3
---

# Phase 17 Plan 3: Classes Sub-Menu (AMENU-03 + AMENU-06) Summary

Classes sub-menu with upcoming session list, cancel class flow with confirmation buttons, and chat-redirect for creating recurring classes. Implemented as new handler functions in `src/telegram/handlers/admin-menu.ts`, plus the 17-01 infrastructure that was missing from the worktree.

## What Was Built

### 17-01 Infrastructure (applied to worktree alongside 17-03)

The worktree was branched before Plan 17-01 landed on main, so infrastructure was applied here:

- `formatAgendaMessage` exported in `src/scheduler/agenda.ts`
- `src/telegram/handlers/admin-menu.ts` created with `MenuCallbackResult` type, `assertCallbackDataSize` helper, `showAdminRootMenu` (2x2 keyboard), `handleMenuCallback` dispatcher
- `parseCallbackData` extended with `MenuCallbackResult` union arm (regex `/^menu:([\w:]+?)(?::(\d+))?$/`)
- `handleCallbackQuery` extended with `'menuAction' in parsed` dispatch block (before `parsed.action` check for correct TS narrowing)
- `/menu` pre-emption in `handleFoundBusiness` before `aiOwnerAgent` (AMENU-01)

### Task 1: showClassesMenu and showCancelClassList (AMENU-03)

**`showClassesMenu(chatId, business)`** — Lists sessions for next 7 days:
- Calls `listSessions(business.id, 7)`
- Formats each: `${sessionDate} ${sessionTime} — ${bookedCount}/${capacity} theta-seis`
- Three action buttons: cancel list, create (chat redirect), back to menu

**`showCancelClassList(chatId, business)`** — Sessions as selectable inline buttons:
- Calls `listSessions(business.id, 30)`, capped at 10 buttons
- Each button triggers `menu:classes:cancel_confirm_req:${instanceId}` (38 bytes max)

**`handleMenuCallback`** extended with `'classes'`, `'classes:cancel_list'`, `'classes:create'` cases.

### Task 2: Cancel Confirmation and cancelSession Execution (AMENU-06)

**`showCancelClassConfirm(chatId, instanceId)`** — Binary confirmation keyboard:
- `menu:classes:cancel_yes:${instanceId}` (35 bytes) / `menu:classes:cancel_no:${instanceId}` (34 bytes)
- Buttons labelled in Greek: Nai (Yes) / Ochi (No)

**`handleClassCancelExecute(chatId, business, instanceId)`** — Executes cancellation:
- Calls `cancelSession(business.id, instanceId)` — ownership via FK chain (T-17-10)
- Success message / already-cancelled message in Greek
- Always follows with a back-to-menu button

**`handleMenuCallback`** extended with `'classes:cancel_confirm_req'`, `'classes:cancel_yes'`, `'classes:cancel_no'` cases, each with `result.id === undefined` guard.

## Verification Results

- `npx tsc --noEmit` exits 0 (zero errors)
- All four exported functions present: `showClassesMenu`, `showCancelClassList`, `showCancelClassConfirm`, `handleClassCancelExecute`
- `cancelSession` called with `business.id` (cross-tenant safe, never from `callback_data`)
- `listSessions` has two call sites (7-day and 30-day windows)
- Confirmation buttons (Yes/No in Greek) present in `showCancelClassConfirm`
- All `callback_data` strings verified under 64 bytes via `assertCallbackDataSize`

## Deviations from Plan

### Applied 17-01 Infrastructure Inline (Rule 3 — Blocking Issue)

- **Found during:** Task 1 start
- **Issue:** Worktree HEAD at commit `1832bd1` (before `phase-17-wave-1` merge on main). `admin-menu.ts` did not exist; `telegram.ts` lacked `MenuCallbackResult` union arm and `/menu` pre-emption.
- **Fix:** Applied all 17-01 changes (infrastructure) alongside 17-03 in a single commit. TypeScript compiled cleanly.
- **Commit:** 1fb1a61

### Combined Tasks 1 and 2 Into One Commit

- **Found during:** Task 2 execution
- **Issue:** Both tasks target the same file; a mid-file commit would leave `handleMenuCallback` with missing dispatch cases
- **Fix:** Implemented both tasks fully before committing
- **Commit:** 1fb1a61

## Known Stubs

None. All four functions use real DB calls (`listSessions`, `cancelSession`). The `classes:create` path intentionally redirects to chat — by design (multi-turn input cannot fit in 64-byte `callback_data`), not a stub.

## Threat Flags

No new surface beyond the plan's threat model. Cross-tenant safety maintained: `cancelSession(business.id, instanceId)` where `business` is always re-derived from `senderTelegramId` in `handleCallbackQuery`. FK chain (sessionInstances.catalogId → sessionCatalog.businessId) is the ownership guard (T-17-10).

## Self-Check

- [x] `src/telegram/handlers/admin-menu.ts` exists in worktree: FOUND
- [x] `src/webhooks/telegram.ts` modified: FOUND
- [x] `src/scheduler/agenda.ts` modified: FOUND
- [x] Commit 1fb1a61 exists: FOUND
- [x] TypeScript: zero errors
- [x] Self-Check: PASSED
