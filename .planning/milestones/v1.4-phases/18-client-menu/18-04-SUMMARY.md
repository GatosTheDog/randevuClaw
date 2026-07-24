---
phase: 18-client-menu
plan: "04"
subsystem: telegram-client-menu
tags: [testing, integration, client-menu, telegram, webhook]
dependency_graph:
  requires: [18-02, 18-03]
  provides: [18-04-tests]
  affects: [tests/webhooks/client-menu.test.ts]
tech_stack:
  added: []
  patterns:
    - jest.mock factory with jest.requireActual for partial mocking (mock showClientRootMenu while keeping real handleClientMenuCallback)
    - supertest integration tests for webhook HMAC-verified endpoint
    - direct unit tests for handler functions to avoid supertest complexity for callback flows
key_files:
  created:
    - tests/webhooks/client-menu.test.ts
  modified: []
decisions:
  - Used jest.mock factory with requireActual to mock only showClientRootMenu (for Suite B supertest path) while keeping the real handleClientMenuCallback for direct unit tests in Suites C+D
  - Suite C+D test handleClientMenuCallback directly rather than through handleTelegramWebhookPost to avoid callback_query webhook complexity
  - Cutoff guard test uses a past booking date (2000-01-01) so hoursUntilSession returns negative, triggering the cutoff check without fake timers
  - db module mocked with jest.fn() stubs so db.select().from().innerJoin().where().limit() chain works for the serviceId lookup in handleBookSessionExecute
metrics:
  duration: 194s
  completed: 2026-07-24
  tasks_completed: 2
  files_created: 1
status: complete
---

# Phase 18 Plan 04: Client Menu Integration Tests Summary

Integration tests covering /start intercept, CMENU-05 free-text routing, parseCallbackData union, booking flow, cancel flow, ownership guard, and cutoff guard.

## What Was Built

24 tests across 5 suites in `tests/webhooks/client-menu.test.ts` covering all client menu paths introduced in Plans 18-01 through 18-03.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Suite A (parseCallbackData) + Suite B (/start intercept, CMENU-05) | 3aa52d0 |
| 2 | Suite C (booking flow) + Suite D (cancel flow) + Suite E (existing arms) | 3aa52d0 (single commit per plan instructions) |

## Test Coverage

### Suite A — parseCallbackData pure unit tests (10 tests)
- `cmenu:book` → `{ clientMenuAction: 'book', id: undefined }`
- `cmenu:cancel:yes:42` → `{ clientMenuAction: 'cancel:yes', id: 42 }`
- `cmenu:book:confirm:9999` → `{ clientMenuAction: 'book:confirm', id: 9999 }`
- `cmenu:root`, `cmenu:balance` → correct shape
- `approve_1`, `menu:settings`, `slotless:req_approve:5` → existing arms pass
- `cmenu:` (empty action) → null
- `undefined` → null

### Suite B — /start intercept and CMENU-05 (4 tests)
- Client `/start` → `showClientRootMenu` called, `routeConversationMessage` NOT called
- Owner `/start` → owner branch intercepts first, `showClientRootMenu` NOT called
- Greek free-text → `routeConversationMessage` called, `showClientRootMenu` NOT called
- Trimmed `   /start   ` → `showClientRootMenu` IS called

### Suite C — Booking flow via handleClientMenuCallback (3 tests)
- Enforcement allows + `bookSessionInstance` succeeds → Greek confirmation sent
- Enforcement blocks → refusal message sent, `bookSessionInstance` NOT called
- `bookingMode === 'open_slots'` → fallback message sent, `listSessions` NOT called

### Suite D — Cancel flow via handleClientMenuCallback (5 tests)
- Happy path: ownership match, outside cutoff → `updateBookingStatus('cancelled')` called
- Credit restore: `findMembershipByBooking` returns membershipId → `restoreCredit` called
- No credit restore: `findMembershipByBooking` returns null → `restoreCredit` NOT called
- Ownership guard: wrong `clientPhone` → `updateBookingStatus` NOT called, ownership error sent
- Cutoff guard: cutoff enabled, past session date → `updateBookingStatus` NOT called, cutoff message sent

### Suite E — Existing parseCallbackData arms (2 tests)
- `billing:client:1` → `BillingCallbackResult` with `action: 'billing:client'`
- `renewal:approve:99` → `RenewalCallbackResult` with `businessId: 99`

## Mock Architecture Decision

The key challenge: `src/webhooks/telegram.ts` imports `showClientRootMenu` and `handleClientMenuCallback` from `client-menu`. For Suite B supertest tests, `showClientRootMenu` must be mocked so we can assert it was called. For Suites C+D, `handleClientMenuCallback` must run its real implementation.

Solution: `jest.mock` factory with `jest.requireActual` — mock only `showClientRootMenu` while keeping the real `handleClientMenuCallback`:

```typescript
jest.mock('../../src/telegram/handlers/client-menu', () => {
  const actual = jest.requireActual('../../src/telegram/handlers/client-menu');
  return { ...actual, showClientRootMenu: jest.fn().mockResolvedValue(undefined) };
});
```

## Deviations from Plan

None — plan executed exactly as written. The mock factory approach for partial mocking was required to satisfy both Suite B (supertest path needing `showClientRootMenu` as a spy) and Suites C+D (direct unit tests needing real `handleClientMenuCallback` implementation).

## Self-Check: PASSED

- tests/webhooks/client-menu.test.ts: FOUND
- Commit 3aa52d0: FOUND (24 tests, 0 failures)
