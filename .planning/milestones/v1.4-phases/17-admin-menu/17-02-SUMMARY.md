---
phase: "17-admin-menu"
plan: 2
status: complete
subsystem: telegram-admin-menu
tags: [telegram, admin-menu, settings, agenda, keyboard, toggles]
requires: ["17-01"]
provides: [settings-sub-menu, settings-toggle-handlers, today-agenda-on-demand]
affects:
  - src/telegram/handlers/admin-menu.ts
  - src/scheduler/agenda.ts
tech-stack:
  added: []
  patterns: [stateless-inline-keyboard, direct-db-toggle, on-demand-agenda-bypass]
key-files:
  created: []
  modified:
    - src/telegram/handlers/admin-menu.ts
    - src/scheduler/agenda.ts
decisions:
  - "Used db (admin connection) directly for boolean toggle mutations — consistent with setLastSessionThreshold / setBookingMode pattern in existing queries.ts; withBusinessContext RLS not needed since businessId WHERE clause enforces row scope"
  - "handleMenuCallback switched from switch(result.menuAction) to switch(true) with case expressions to support startsWith dispatch for settings:* sub-actions"
  - "Re-fetch updated business via findBusinessByOwnerTelegramId after each toggle to pass refreshed values to showSettingsMenu"
  - "claimAgendaSlot bypassed in showTodaysAgenda — only listBookingsForDate + formatAgendaMessage called (RESEARCH.md Pitfall 2 / T-17-09)"
  - "agenda.ts formatAgendaMessage export applied in this worktree (Plan 17-01 dependency not yet merged to worktree base)"
metrics:
  duration: "~4 minutes"
  completed: "2026-07-24T00:00:00Z"
  tasks_completed: 2
  files_changed: 2
---

# Phase 17 Plan 2: Settings Sub-Menu + Today's Agenda On-Demand Summary

Settings sub-menu (AMENU-02) with six configuration display areas and four binary toggle buttons, plus on-demand Today's Agenda (AMENU-05) calling formatAgendaMessage without claimAgendaSlot.

## What Was Built

### Task 1: showSettingsMenu + handleSettingsToggle

**showSettingsMenu(chatId, business):** Sends a Greek settings display message showing current values for all six configuration areas:
- Ώρες λειτουργίας / Υπηρεσίες & τιμές — text-only with chat redirect instruction
- slotlessRequestsEnabled — toggle button (slotless_on / slotless_off)
- cancellationCutoffEnabled — toggle button (cutoff_on / cutoff_off) with hours value shown
- allowMultiBooking — toggle button (multibooking_on / multibooking_off)
- lastSessionThresholdEnabled — toggle button (threshold_on / threshold_off) with count shown
- Back button with callback_data 'menu:root'

All toggle callback_data strings validated through assertCallbackDataSize (64-byte limit, T-17-05/T-17-06).

**handleSettingsToggle(action, business, chatId):** Dispatches 8 toggle mutations using `db.update(businesses).set({...}).where(eq(businesses.id, business.id))`. After each successful mutation:
1. Sends Greek confirmation message
2. Re-fetches updated business via findBusinessByOwnerTelegramId(chatId)
3. Calls showSettingsMenu with refreshed values

Unknown actions send 'Αγνωστη ρυθμιση.' and return without any DB mutation (T-17-06).

**handleMenuCallback extended:** Switched to `switch(true)` pattern to support:
- `menuAction === 'root'` - showAdminRootMenu
- `menuAction === 'settings'` - showSettingsMenu
- `menuAction.startsWith('settings:')` - handleSettingsToggle with sliced sub-action
- `menuAction === 'agenda'` - showTodaysAgenda

### Task 2: showTodaysAgenda

**showTodaysAgenda(chatId, business):** On-demand agenda without claimAgendaSlot:
1. `isoDateInAthens(new Date())` for today's Athens date
2. `listBookingsForDate(business.id, today, ['confirmed', 'pending_owner_approval'])`
3. Builds serviceNamesById map via findServiceById for each unique serviceId
4. Formats with `formatAgendaMessage` (or empty-state Greek message)
5. Sends agenda message via sendTelegramMessage
6. Sends separate back button keyboard message

**Security gate:** `claimAgendaSlot` is absent from admin-menu.ts entirely. Verified via grep — only appears in JSDoc comments.

**agenda.ts change:** Added `export` to `formatAgendaMessage` function declaration. This was a Plan 17-01 change not yet merged into this worktree's base, applied here as a prerequisite for TypeScript compilation.

## Verification Results

```
npx tsc --noEmit -> exit 0, zero errors
grep "showSettingsMenu|handleSettingsToggle|showTodaysAgenda" -> all three found
grep "claimAgendaSlot" (non-comment code) -> 0 matches (PASS)
grep "formatAgendaMessage" -> import + call site found
grep "'menu:agenda'" -> found in showAdminRootMenu callback_data assignment
```

## Commit

- `4d5202a`: feat(17-admin-menu-02): settings sub-menu + today's agenda on-demand

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] formatAgendaMessage not exported in worktree base**
- **Found during:** Task 1 (TypeScript compilation)
- **Issue:** This worktree's base branch predates the Plan 17-01 changes merged to main. `formatAgendaMessage` was unexported, causing TS2459 error on import in admin-menu.ts.
- **Fix:** Applied the same `export` keyword addition to `src/scheduler/agenda.ts` that Plan 17-01 already merged to main. No logic change.
- **Files modified:** `src/scheduler/agenda.ts`
- **Commit:** `4d5202a` (included in same commit as admin-menu.ts changes)

**2. [Observation] switch(result.menuAction) to switch(true) pattern**
- The plan described adding cases directly to an existing `switch (result.menuAction)` statement. To support `menuAction.startsWith('settings:')` as a case expression, the switch was restructured to `switch (true)` with boolean case expressions. This is equivalent and correct TypeScript.

### Out-of-Scope Observations

- telegram.ts Plan 17-01 changes (parseCallbackData union extension, /menu pre-emption, handleMenuCallback dispatch import) are not in this worktree. Not required for admin-menu.ts TypeScript compilation and outside this plan's scope.

## Known Stubs

- handleMenuCallback cases for 'classes' and 'clients' still fall through to default ('Αγνωστη ενεργεια μενου.'). Plans 17-03 and 17-04 will add these cases.

## Threat Flags

No new threat surface beyond the plan's threat model. All STRIDE items mitigated:
- T-17-06: Unknown toggle action is inert (sends error message, no DB mutation)
- T-17-07: business.id sourced from senderTelegramId re-derivation in telegram.ts dispatch (not from callback_data)
- T-17-08: showTodaysAgenda only reachable via menuAction dispatch which requires findBusinessByOwnerTelegramId success
- T-17-09: claimAgendaSlot absent from admin-menu.ts entirely (grep-verified)

## Self-Check: PASSED

- src/telegram/handlers/admin-menu.ts: FOUND
- src/scheduler/agenda.ts: FOUND
- commit 4d5202a: FOUND
- showSettingsMenu exported: FOUND
- handleSettingsToggle exported: FOUND
- showTodaysAgenda exported: FOUND
- claimAgendaSlot in non-comment code: 0 matches (PASS)
- formatAgendaMessage exported from agenda.ts: FOUND
- TypeScript exit 0: PASS
