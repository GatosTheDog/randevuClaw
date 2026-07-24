---
phase: 20-client-escalation
plan: "01"
subsystem: telegram-escalation
tags: [escalation, client-menu, best-effort, admin-notification, tdd]
dependency_graph:
  requires:
    - src/telegram/client.ts (botTokenStore, sendTelegramMessageWithKeyboard, InlineKeyboard)
    - src/database/queries.ts (Business, findClientBusinessRelationship)
    - src/billing/enforcement.ts (checkEnforcementAndGetMembership)
    - src/session/manager.ts (bookSessionInstance)
  provides:
    - src/telegram/escalation.ts (EscalationReason, sendEscalationToAdmin, buildEscalationKeyboard)
  affects:
    - src/telegram/handlers/client-menu.ts (handleBookSessionExecute)
tech_stack:
  added: []
  patterns:
    - best-effort async notification (catch+log, never throw)
    - botTokenStore.run per-business scoping
    - assertCallbackDataSize guard (module-local copy per RESEARCH.md Pitfall 4)
    - TDD red/green cycle for escalation engine
key_files:
  created:
    - src/telegram/escalation.ts
    - tests/escalation.test.ts
  modified:
    - src/telegram/handlers/client-menu.ts
    - tests/webhooks/client-menu.test.ts
decisions:
  - "Escalation is best-effort: sendEscalationToAdmin never throws; errors are caught and logged"
  - "clientName resolved via findClientBusinessRelationship, falls back to clientTelegramId string"
  - "No instanceId at enforcement block (pre-resolved) → reply-only keyboard; instanceId present at full-capacity block → approve+reply keyboard"
  - "Standardised apology replaces enforcement-specific message per ESCL-01 planning constraint"
  - "assertCallbackDataSize is module-local in escalation.ts (not exported from admin-menu.ts) per RESEARCH.md Pitfall 4"
  - "EscalationReason import added to client-menu.ts import but used via string literals — TypeScript allows this as type narrowing"
metrics:
  duration: "6m 30s"
  completed: "2026-07-24"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 2
status: complete
---

# Phase 20 Plan 01: Client Escalation Engine Summary

JWT auth with refresh rotation using jose library — no, this is: **Escalation engine with best-effort admin notification on booking blocks via botTokenStore-scoped Telegram send**.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| RED | Failing escalation tests | f51c87a | tests/escalation.test.ts |
| 1 | Create src/telegram/escalation.ts | b934d55 | src/telegram/escalation.ts, tests/escalation.test.ts |
| 2 | Wire escalation into handleBookSessionExecute | a0f6076 | src/telegram/handlers/client-menu.ts, tests/webhooks/client-menu.test.ts |

## What Was Built

**src/telegram/escalation.ts** — new module exporting:
- `EscalationReason` type: `'membership_expired' | 'class_full' | 'slotless_disabled'`
- `buildEscalationKeyboard(clientTelegramId, instanceId?)`: approve+reply when instanceId given, reply-only when absent; callback_data under 64 bytes enforced by module-local `assertCallbackDataSize`
- `sendEscalationToAdmin(business, clientTelegramId, action, reason, instanceId?)`: resolves clientName from `findClientBusinessRelationship`, maps reason to Greek phrase, sends keyboard message to owner via `botTokenStore.run`; best-effort (never throws)

**src/telegram/handlers/client-menu.ts** — `handleBookSessionExecute` updated:
- Enforcement block (`!enforcementResult.allowed`): sends standardised apology, calls `sendEscalationToAdmin(..., 'membership_expired')` (no instanceId → reply-only keyboard), logs escalation at info
- Full-capacity block (`bookResult.status === 'full'`): sends standardised apology, calls `sendEscalationToAdmin(..., 'class_full', instanceId)` (approve+reply keyboard), logs escalation at info
- Success path unchanged

## Test Results

- `tests/escalation.test.ts`: 15 tests — all passing (buildEscalationKeyboard shape, callback_data size, sendEscalationToAdmin clientName resolution, Greek phrase mapping, guard conditions, best-effort behaviour)
- `tests/webhooks/client-menu.test.ts`: 24 tests — all passing (enforcement block now asserts new apology message and `sendEscalationToAdmin` call; escalation module mocked via `jest.mock`)
- `npx tsc --noEmit`: clean

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed logger mock in escalation test causing TypeError**
- **Found during:** GREEN phase — `jest.mock('../src/utils/logger')` auto-mock returned `undefined` for the logger object
- **Fix:** Used factory mock `jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }))` — same pattern as `billing-enforcement-policy.test.ts`
- **Files modified:** tests/escalation.test.ts
- **Commit:** b934d55

**2. [Rule 1 - Bug] Updated existing client-menu test for new apology message**
- **Found during:** Task 2 verification — existing test at line 396 expected old enforcement-specific message
- **Fix:** Updated assertion to expect new standardised apology; added escalation module mock; added assertion that `sendEscalationToAdmin` is called with correct args
- **Files modified:** tests/webhooks/client-menu.test.ts
- **Commit:** a0f6076

**3. [Rule 2 - Missing mock] Added jest.mock for escalation module in client-menu test**
- **Found during:** Task 2 wiring — without mocking escalation, `sendEscalationToAdmin` would call through to real DB
- **Fix:** `jest.mock('../../src/telegram/escalation', () => ({ sendEscalationToAdmin: jest.fn().mockResolvedValue(undefined), ... }))`
- **Files modified:** tests/webhooks/client-menu.test.ts
- **Commit:** a0f6076

## Known Stubs

None — all escalation paths are fully wired. The `escl:approve` and `escl:reply` callback_data prefixes are emitted correctly; the handlers for these callbacks will be implemented in Plan 20-02 (ESCL-03).

## Threat Flags

No new threat surface introduced beyond what the plan's threat model covers:
- T-20-01 (clientTelegramId spoofing): mitigated — clientTelegramId always derived from senderTelegramId (HMAC-verified upstream), never from callback_data
- T-20-03 (infinite retry DoS): mitigated — best-effort catch+log, no retry, no throw

## Self-Check: PASSED
