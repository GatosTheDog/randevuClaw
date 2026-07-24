---
phase: 18
plan: 02
subsystem: telegram/client-menu
tags: [client-menu, booking, session, enforcement, telegram]
dependency_graph:
  requires: [18-01, session/manager.listSessions, session/manager.bookSessionInstance, billing/enforcement.checkEnforcementAndGetMembership]
  provides: [showBookSessionList, showBookConfirm, handleBookSessionExecute, cmenu:book dispatcher cases]
  affects: [src/telegram/handlers/client-menu.ts]
tech_stack:
  added: []
  patterns: [enforcement-gate-before-booking, drizzle-join-for-serviceId, idempotency-key-per-client-per-instance]
key_files:
  modified:
    - src/telegram/handlers/client-menu.ts
decisions:
  - Merged listSessions and bookSessionInstance into a single import line to avoid duplicate import warning (S3863)
  - Used Drizzle join query (sessionInstances + sessionCatalog) to resolve serviceId, as findSessionInstanceById does not exist in session/manager.ts
  - chatId === senderTelegramId for private Telegram chats — used chatId as the clientPhone parameter to bookSessionInstance
  - back-button on empty session list uses sendTelegramMessageWithKeyboard (consistent with other menus) rather than plain sendTelegramMessage
metrics:
  duration: 8m
  completed: 2026-07-24
  tasks_completed: 2
  files_modified: 1
status: complete
---

# Phase 18 Plan 02: Book a Class Flow Summary

Implemented the complete "book a class" flow for the client Telegram menu, covering session list display, confirmation prompt, and booking execution with enforcement gate.

## What Was Built

**showBookSessionList** — Guards on `business.bookingMode === 'fixed_sessions'`. Calls `listSessions(business.id, 14)` for the next 14 calendar days, filters to instances where `bookedCount < capacity`, caps at 10 results, and renders one InlineKeyboard button per available session (`sessionDate + " " + sessionTime`). Empty result shows a message with a back button.

**showBookConfirm** — Sends a Ναι/Όχι confirmation keyboard for the selected `instanceId`. Ναι routes to `cmenu:book:yes:<instanceId>`, Όχι routes back to `cmenu:root`.

**handleBookSessionExecute** — Full booking execution:
1. Calls `checkEnforcementAndGetMembership` (enforcement gate). Returns refusal message if `!allowed`.
2. Resolves `serviceId` via a Drizzle join (`sessionInstances` inner join `sessionCatalog` on `catalogId`).
3. Builds idempotency key `cmenu:book:<senderTelegramId>:<instanceId>`.
4. Calls `bookSessionInstance` with the resolved `membership` from the enforcement result.
5. Returns capacity-full message if `status === 'full'`, otherwise sends confirmation and back-to-menu keyboard.

**Dispatcher wiring** — Three new `switch(true)` cases added to `handleClientMenuCallback`:
- `book` → `showBookSessionList`
- `book:confirm` → `showBookConfirm` (with `result.id` guard)
- `book:yes` → `handleBookSessionExecute` (with `result.id` guard)

## Tasks

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | showBookSessionList + showBookConfirm | 56a1c03 | src/telegram/handlers/client-menu.ts |
| 2 | handleBookSessionExecute + dispatcher wiring | 56a1c03 | src/telegram/handlers/client-menu.ts |

## Deviations from Plan

None — plan executed exactly as written. The duplicate import warning (S3863) was pre-emptively resolved by merging the two `../../session/manager` imports into one combined import line.

## Known Stubs

None. All functions are wired to real DB queries and enforcement logic.

## Self-Check: PASSED

- `src/telegram/handlers/client-menu.ts` exists and contains all three new functions
- Commit 56a1c03 exists in git log
- `npx tsc --noEmit` produces no errors
