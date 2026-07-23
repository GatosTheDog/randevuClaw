---
phase: "17-admin-menu"
plan: 1
status: complete
subsystem: telegram-admin-menu
tags: [telegram, admin-menu, keyboard, routing, infrastructure]
requires: []
provides: [admin-menu-handler, menu-callback-routing, /menu-command]
affects: [src/webhooks/telegram.ts, src/telegram/handlers/admin-menu.ts, src/scheduler/agenda.ts]
tech-stack:
  added: []
  patterns: [stateless-inline-keyboard, discriminant-union-narrowing, command-pre-emption]
key-files:
  created:
    - src/telegram/handlers/admin-menu.ts
  modified:
    - src/webhooks/telegram.ts
    - src/scheduler/agenda.ts
decisions:
  - "'menuAction' in parsed dispatch placed BEFORE 'parsed.action' check so TypeScript narrows MenuCallbackResult out of the union correctly"
  - "No onboardingCompleted branch exists in codebase — /menu pre-emption added directly inside the ownerTelegramId === senderTelegramId block before aiOwnerAgent call"
metrics:
  duration: "~5 minutes"
  completed: "2026-07-23T22:47:20Z"
  tasks_completed: 3
  files_changed: 3
---

# Phase 17 Plan 1: Admin Menu Infrastructure Summary

Wire the `/menu` command detection and callback routing infrastructure: export `formatAgendaMessage`, create `admin-menu.ts` with `showAdminRootMenu` and `handleMenuCallback` stub, and extend `parseCallbackData` union with `MenuCallbackResult`.

## What Was Built

### Task 1: Export `formatAgendaMessage` from `scheduler/agenda.ts`

Added `export` keyword to `formatAgendaMessage` function declaration. No logic changes. Enables `admin-menu.ts` (Plan 17-02, AMENU-05) to call `formatAgendaMessage` directly for on-demand agenda without going through `claimAgendaSlot`.

### Task 2: Create `src/telegram/handlers/admin-menu.ts`

New module containing:
- `MenuCallbackResult` type (exported) — discriminant field `menuAction` unique across all parseCallbackData union arms
- `assertCallbackDataSize(data)` helper — mirrors payment-flow.ts 64-byte guard (T-17-05)
- `showAdminRootMenu(chatId, business)` — sends 2x2 inline keyboard with four Greek-labelled buttons: Ρυθμίσεις, Μαθήματα, Πελάτες, Ατζέντα Σήμερα (callback_data: `menu:settings`, `menu:classes`, `menu:clients`, `menu:agenda`)
- `handleMenuCallback(result, business, chatId)` — central dispatcher; handles `'root'` case (calls `showAdminRootMenu`), `default` sends 'Άγνωστη ενέργεια μενού.'

### Task 3: Extend `parseCallbackData` and wire `/menu` in `telegram.ts`

Four coordinated changes:

**CHANGE A+D (combined import):** Added `import { handleMenuCallback, MenuCallbackResult, showAdminRootMenu } from '../telegram/handlers/admin-menu'`

**CHANGE B:** Extended `parseCallbackData` return type to include `MenuCallbackResult`; added `menuMatch` regex arm (`/^menu:([\w:]+?)(?::(\d+))?$/`) before `return null`

**CHANGE C:** Added `'menuAction' in parsed` dispatch block in `handleCallbackQuery` — positioned BEFORE the `parsed.action === 'client_cancel'` check (critical for TypeScript union narrowing — `MenuCallbackResult` has no `action` field)

**CHANGE D:** Added `/menu` pre-emption inside the `ownerTelegramId === senderTelegramId` block of `handleFoundBusiness`, before `aiOwnerAgent` call. Sends root menu and marks update processed without a Gemini round-trip.

## Verification Results

```
npx tsc --noEmit  ->  exit 0, zero errors
```

All plan verification grep checks pass:
- `grep "^export function formatAgendaMessage" src/scheduler/agenda.ts` — match found
- `grep -c "MenuCallbackResult" src/webhooks/telegram.ts` — 5 matches
- `grep "menuAction" src/webhooks/telegram.ts` — dispatch branch found
- `grep "'/menu'" src/webhooks/telegram.ts` — pre-emption check found
- `grep "^export" src/telegram/handlers/admin-menu.ts` — `showAdminRootMenu` and `handleMenuCallback` both exported

## Commit

- `9ef5d67`: feat(17-admin-menu-01): wire /menu command + MenuCallbackResult routing scaffold

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript union narrowing required reordering dispatch blocks**
- **Found during:** Task 3
- **Issue:** After adding `MenuCallbackResult` to the parseCallbackData union, the existing `if (parsed.action === 'client_cancel')` check caused TypeScript errors TS2339 — `parsed.action` and `parsed.bookingId` do not exist on `MenuCallbackResult`
- **Fix:** Moved the `'menuAction' in parsed` dispatch block BEFORE the `parsed.action` check. TypeScript control-flow analysis then narrows `MenuCallbackResult` out of the union before any `.action` reference
- **Files modified:** `src/webhooks/telegram.ts`
- **Commit:** 9ef5d67

**2. [Observation] No `onboardingCompleted` branch in codebase**
- The plan described adding `/menu` pre-emption "inside the onboardingCompleted=true owner branch". The actual codebase has no `onboardingCompleted` field on `Business` — the owner intercept goes directly from `ownerTelegramId === senderTelegramId` to `aiOwnerAgent`. The `/menu` pre-emption was added at the correct equivalent location (before `aiOwnerAgent`) with no functional impact on intended behaviour.

## Known Stubs

- `handleMenuCallback` cases for `'settings'`, `'agenda'`, `'classes'`, `'clients'` and sub-actions are not yet implemented — they fall through to the `default` branch which sends 'Αγνωστη ενεργεια μενου.' Plans 17-02, 17-03, 17-04 will add these cases.

## Threat Flags

No new threat surface beyond what is in the plan's threat model. All STRIDE items are mitigated:
- `findBusinessByOwnerTelegramId` re-derives ownership in `handleCallbackQuery` menu dispatch (T-17-01, T-17-03)
- `/menu` only reachable after `ownerTelegramId === senderTelegramId` check in `handleFoundBusiness` (T-17-02)
- `editTelegramMessageReplyMarkup` clears old keyboard before each sub-menu (T-17-04)
- `assertCallbackDataSize` logs overflow warning (T-17-05)

## Self-Check: PASSED

- src/scheduler/agenda.ts: FOUND
- src/webhooks/telegram.ts: FOUND
- src/telegram/handlers/admin-menu.ts: FOUND
- .planning/phases/17-admin-menu/17-01-SUMMARY.md: FOUND
- commit 9ef5d67: FOUND
