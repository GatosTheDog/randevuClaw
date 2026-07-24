---
phase: 20-client-escalation
plan: "02"
subsystem: telegram-webhook
tags: [escalation, callback-routing, tests, ESCL-03]
requirements: [ESCL-03]
status: complete

dependency_graph:
  requires:
    - 20-01  # sendEscalationToAdmin + buildEscalationKeyboard already in escalation.ts
  provides:
    - escl: callback routing in handleCallbackQuery
    - EscalationCallbackResult type in telegram.ts
    - parseCallbackData escl: arm
    - approve exception handler (bookSessionInstance with null membership)
    - reply prompt handler
  affects:
    - src/webhooks/telegram.ts
    - tests/client-escalation.test.ts

tech_stack:
  added: []
  patterns:
    - discriminant-union narrowing in parseCallbackData (escalationAction field)
    - cross-tenant guard via findBusinessByOwnerTelegramId re-derivation
    - idempotency key pattern: escl:approve:<clientId>:<instanceId>
    - best-effort client notification wrapped in try/catch
    - botTokenStore.run for per-business bot scoping in approve handler

key_files:
  created:
    - tests/client-escalation.test.ts
  modified:
    - src/webhooks/telegram.ts

decisions:
  - EscalationCallbackResult type defined directly in telegram.ts (not in escalation.ts) to keep all callback result types co-located
  - escalationAction discriminant checked BEFORE menuAction in handleCallbackQuery dispatch chain to maintain consistent guard order
  - approve handler resolves serviceId from instanceId via inline DB query (same pattern as handleBookSessionExecute in client-menu.ts)
  - activeMembership=null passed to bookSessionInstance to bypass enforcement gate while capacity SELECT FOR UPDATE still applies
  - Client notification on approve is best-effort (wrapped in try/catch) — failure logged but does not abort the admin confirmation message
  - Reply handler only sends Greek prompt to admin; no client message sent in this phase (future CMENU-05 wiring)

metrics:
  duration: "275s (~4m)"
  completed: "2026-07-24"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 1
  files_created: 1
  tests_added: 17
  tests_passing: 17
---

# Phase 20 Plan 02: Client Escalation Callback Routing Summary

**One-liner:** Admin inline escalation with `escl:approve` and `escl:reply` callback routing, capacity-respecting exception booking, and 17 integration tests.

## Tasks Completed

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | EscalationCallbackResult type + parseCallbackData escl: arm + handleCallbackQuery dispatch | 14cb9ac | src/webhooks/telegram.ts |
| 2 | Integration tests — parseCallbackData arms, keyboard shape, guard behaviors | 89f3ff3 | tests/client-escalation.test.ts |

## What Was Built

**Task 1 — telegram.ts changes (4 changes):**

1. New imports added: `bookSessionInstance`, `db`, `sessionInstances`, `sessionCatalog`, `eq`
2. `EscalationCallbackResult` type exported with `escalationAction` discriminant, optional `instanceId`, and `clientTelegramId`
3. `EscalationCallbackResult` added to `parseCallbackData` return union type
4. `escl:` arm added inside `parseCallbackData` (after `renewalMatch`, before `menuMatch`) — regex `/^escl:(approve|reply):(\d+)(?::(\d+))?$/` handles both shapes
5. Escalation dispatch arm added in `handleCallbackQuery` before `menuAction` check:
   - Cross-tenant guard: re-derives `ownerBusiness` from `senderTelegramId`
   - `approve` path: resolves `serviceId` from `instanceId`, calls `bookSessionInstance` with `activeMembership=null`, sends client notification via `botTokenStore.run` (best-effort), sends admin confirmation
   - `reply` path: sends Greek prompt to admin (`Γράψε το μήνυμα...`)
   - Both paths clear the keyboard via `editTelegramMessageReplyMarkup`

**Task 2 — tests/client-escalation.test.ts (17 tests, 3 groups):**

- GROUP 1 (`parseCallbackData` arm): 9 tests — correct parsing of both escl shapes, correct discriminants, existing arms unbroken
- GROUP 2 (`buildEscalationKeyboard`): 5 tests — button count, callback_data prefixes for both keyboard shapes
- GROUP 3 (`sendEscalationToAdmin` guards): 3 tests — missing botToken/ownerTelegramId prevents send; both present triggers one send via `botTokenStore.run`

## Security Contract (STRIDE Mitigations Applied)

| Threat | Mitigation |
|--------|-----------|
| T-20-04: Elevation of privilege via crafted escl:approve | Cross-tenant guard: `ownerBusiness` re-derived from `senderTelegramId` before any mutation — non-owner tapping any crafted callback_data is rejected at owner check |
| T-20-05: Tampering via instanceId | `instanceId` only used to resolve `serviceId`; capacity enforcement runs inside `bookSessionInstance`'s `SELECT FOR UPDATE` — cannot book a full class regardless of callback_data |
| T-20-07: DoS via repeated button taps | Idempotency key `escl:approve:<clientId>:<instanceId>` prevents duplicate bookings; capacity lock prevents overbooking |

## Deviations from Plan

None — plan executed exactly as written. The escl:approve:1: edge case test in GROUP 1 correctly validates that the regex rejects malformed data (trailing colon with no digits) and returns null rather than a partially-parsed result.

## Known Stubs

None — all functionality is wired. The reply handler intentionally delivers only the Greek prompt to admin (no client message); this is by design per the plan spec ("this plan delivers only the reply prompt — future wiring in CMENU-05").

## Threat Flags

None — no new network endpoints, auth paths, or trust boundaries introduced beyond those already in the plan's threat model.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/webhooks/telegram.ts | FOUND |
| tests/client-escalation.test.ts | FOUND |
| .planning/phases/20-client-escalation/20-02-SUMMARY.md | FOUND |
| Commit 14cb9ac | FOUND |
| Commit 89f3ff3 | FOUND |
| TypeScript compiles (npx tsc --noEmit) | PASSED |
| 17 tests passing | PASSED |
