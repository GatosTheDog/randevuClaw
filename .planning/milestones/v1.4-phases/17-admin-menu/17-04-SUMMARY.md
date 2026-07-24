---
phase: "17-admin-menu"
plan: 4
subsystem: telegram-admin-menu
tags: [admin-menu, clients, billing, telegram, integration-tests]
status: complete

dependency_graph:
  requires:
    - "17-01"
    - "17-02"
    - "17-03"
  provides:
    - showClientsList
    - showClientBalance
    - handleRenewalNudge
    - admin-menu integration tests
  affects:
    - src/telegram/handlers/admin-menu.ts
    - tests/admin-menu.test.ts

tech_stack:
  added: []
  patterns:
    - "Cross-tenant ownership guard via rel?.businessId !== business.id (optional-chain form)"
    - "botTokenStore.run(business.botToken, ...) scopes renewal nudge to per-business bot"
    - "getAllClientsForBusiness + getClientActiveMembership from billing/queries (RLS-enforced)"
    - "Integration tests mock all external modules — no real DB or Telegram API calls"

key_files:
  modified:
    - src/telegram/handlers/admin-menu.ts
  created:
    - tests/admin-menu.test.ts

decisions:
  - "Used rel?.businessId !== business.id (optional-chain) rather than !rel || rel.businessId !== business.id — semantically identical, passes SonarTS S6582"
  - "Test file placed in tests/admin-menu.test.ts (flat, not tests/webhooks/) to match existing project convention and import path structure"
  - "mockBusiness includes onboardingCompleted: true to satisfy updated Business interface (Phase 16 added this field)"

metrics:
  duration: "~5 minutes"
  completed: "2026-07-24"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 1
  tests_added: 12
  tests_passing: 12
---

# Phase 17 Plan 4: Clients Sub-Menu + Admin Menu Integration Tests Summary

Clients sub-menu (AMENU-04) plus integration tests for menu routing. Three handlers added to `src/telegram/handlers/admin-menu.ts`; 12-test suite created at `tests/admin-menu.test.ts`.

## What Was Built

### Task 1: Clients Sub-Menu Handlers (commit b4a953b)

Added three exported functions to `src/telegram/handlers/admin-menu.ts`:

**`showClientsList(chatId, business)`**
- Calls `getAllClientsForBusiness(business.id)` (billing/queries, RLS-enforced via getConn())
- Caps at 20 clients; appends overflow note if `clients.length > 20`
- Builds inline keyboard: one button per client row with `callback_data: menu:clients:balance:<relId>`
- Each `callback_data` byte-length-checked via `assertCallbackDataSize`
- Back button at bottom: `menu:root`
- Empty state: sends text message with back button only

**`showClientBalance(chatId, business, relId)`**
- T-17-14/T-17-16: `rel?.businessId !== business.id` ownership check after DB lookup
- Resolves `senderPhone` from `findClientBusinessRelationshipById(relId)`
- Calls `getClientActiveMembership(business.id, senderPhone)` for membership status
- Three display branches: no membership / unlimited / session-counted
- Keyboard: nudge button (`menu:clients:nudge:<relId>`) if membership exists, back button always

**`handleRenewalNudge(chatId, business, relId)`**
- T-17-15/T-17-17: same ownership guard; senderPhone from DB row (not callback_data)
- Guards: no rel → error; no membership → explains nudge not sent; no botToken → error
- Sends Greek renewal reminder to client via `botTokenStore.run(business.botToken, ...)`
- Confirms to owner with display name; back button keyboard at end

**`handleMenuCallback` extended** with three new cases:
- `'clients'` → `showClientsList`
- `'clients:balance'` → `showClientBalance` (id guard)
- `'clients:nudge'` → `handleRenewalNudge` (id guard)

New imports added: `findClientBusinessRelationshipById` (database/queries), `botTokenStore` (telegram/client), `getAllClientsForBusiness`, `getClientActiveMembership` (billing/queries).

### Task 2: Integration Tests (commit 653de4b)

Created `tests/admin-menu.test.ts` with 12 tests across 4 groups:

**Group 1 — parseCallbackData MenuCallbackResult arm (6 tests)**
- `menu:settings` → `{ menuAction: 'settings', id: undefined }`
- `menu:clients:balance:42` → `{ menuAction: 'clients:balance', id: 42 }`
- `menu:classes:cancel_yes:99` → `{ menuAction: 'classes:cancel_yes', id: 99 }`
- `menu:root` → `{ menuAction: 'root', id: undefined }`
- `approve_5` → existing arm unaffected
- `billing:client:10` → existing arm unaffected

**Group 2 — showAdminRootMenu keyboard shape (1 test)**
- Confirms one `sendTelegramMessageWithKeyboard` call, 2 rows x 2 columns = 4 buttons total

**Group 3 — agenda action skips claimAgendaSlot (1 test)**
- `handleMenuCallback({ menuAction: 'agenda' }, ...)` — `claimAgendaSlot` never called

**Group 4 — discriminant uniqueness (4 tests)**
- `menu:root` has `menuAction` but not `bookingId`, `firstId`, `slotlessRequestId`, `businessId`
- `approve_` has `bookingId` but not `menuAction`
- `billing:` has `firstId` but not `menuAction`
- `findBusinessByOwnerTelegramId` returning null mock verified

All 12 tests pass. TypeScript compiles cleanly.

## Verification

```
npx tsc --noEmit                                                              → exit 0
npm test -- --testPathPattern="admin-menu" --testTimeout=20000                → 12 passed, 0 failed
grep showClientsList|showClientBalance|handleRenewalNudge admin-menu.ts       → 3 export async matches
grep getAllClientsForBusiness admin-menu.ts                                    → import + call site
grep getClientActiveMembership admin-menu.ts                                  → import + 2 call sites
grep rel.businessId admin-menu.ts                                             → 2 ownership check lines
grep claimAgendaSlot admin-menu.ts                                            → comment only (not called)
```

## Deviations from Plan

### Auto-fixed Issues

**[Rule 1 - Bug] Business interface missing `onboardingCompleted` field in mock**
- Found during: Task 2 (first test run)
- Issue: Phase 16 added `onboardingCompleted: boolean` to the `Business` interface; mock lacked this field, causing TS2741
- Fix: Added `onboardingCompleted: true` to `mockBusiness`
- Files modified: `tests/admin-menu.test.ts`
- Commit: 653de4b

**[Rule 2 - Convention] Test file location adjusted to match project convention**
- Plan specified `tests/webhooks/admin-menu.test.ts`; all existing tests are flat in `tests/`
- The plan's import paths (`'../src/...'`) only work from `tests/` flat location
- Placed at `tests/admin-menu.test.ts` — correct for jest config `**/tests/**/*.test.ts`

**[Rule 2 - Style] Optional-chain form for ownership guard**
- IDE diagnostic S6582 flagged `!rel || rel.businessId !== business.id`
- Applied `rel?.businessId !== business.id` (semantically identical)
- Files modified: `src/telegram/handlers/admin-menu.ts`

## Known Stubs

None. The clients sub-menu is fully wired to real query functions.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes. All T-17-14 through T-17-17 mitigations implemented and verified.

## Self-Check: PASSED

- [x] `src/telegram/handlers/admin-menu.ts` exists and contains all three handler functions
- [x] `tests/admin-menu.test.ts` exists with 12 passing tests
- [x] Commits b4a953b and 653de4b exist in git log
- [x] `npx tsc --noEmit` exits 0
- [x] `claimAgendaSlot` not called from admin-menu.ts (grep confirms comment only)
