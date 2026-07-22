---
phase: 09-expiry-notifications-client-balance
plan: "03"
subsystem: expiry-sweep-poller-and-server-registration
tags:
  - scheduler
  - notifications
  - membership-expiry
  - telegram
  - phase-9
dependency_graph:
  requires:
    - 09-02-SUMMARY.md  # findMembershipsExpiringIn7Days + insertMembershipExpiryNotification
    - 09-01-SUMMARY.md  # membershipExpiryNotifications schema + formatExpiryDateGreek
  provides:
    - runMembershipExpirySweep() — sends client + owner 7-day expiry notifications
    - startMembershipExpiryPoller() — 6-hour in-process setInterval registered in server.ts
    - 6 passing scheduler-expiry tests (NOTF-01, NOTF-02, NOTF-03)
    - migrations/0008_expiry_notifications.sql applied to live Neon DB
  affects:
    - server.ts (startMembershipExpiryPoller now fires on startup)
tech_stack:
  added: []
  patterns:
    - Per-business + per-membership nested try/catch isolation (mirrors expiry-poller.ts)
    - botTokenStore.run() wrapping on ALL Telegram calls from sweep (D-06)
    - insertMembershipExpiryNotification return-value gate to prevent duplicate Telegram sends (NOTF-03)
    - clientName fallback to clientPhone in owner notification (Pitfall 5)
    - JEST_WORKER_ID guard in server.ts prevents Jest open-handle from 6-hour setInterval (T-09-11)
key_files:
  created:
    - src/scheduler/membership-expiry.ts
  modified:
    - tests/scheduler-expiry.test.ts
    - src/server.ts
decisions:
  - "isRunning guard omitted — 6-hour interval + DB UNIQUE constraint provide sufficient dedup; overlapping sweeps produce no duplicate sends (RESEARCH.md Open Question 2, planner discretion)"
  - "notificationType '7_day_client' / '7_day_owner' per D-05 — two rows per membership+expiry event for per-recipient dedup granularity (set in Plan 01)"
  - "notificationCount increments separately for client send and owner send — allows accurate accounting if one notification fires without the other"
  - "Human checkpoint gates server.ts registration on confirmed Neon DB migration apply (T-09-12)"
metrics:
  duration_min: 51
  completed_date: "2026-07-21"
  tasks_completed: 3
  files_changed: 3
status: complete
requirements:
  - NOTF-01
  - NOTF-02
  - NOTF-03
---

# Phase 09 Plan 03: Expiry Sweep Poller, Test Implementation, DB Migration, and Server Registration Summary

**One-liner:** 6-hour in-process membership expiry sweep with per-business/per-membership isolation, botTokenStore.run() wrapping, UNIQUE dedup gating, and 6 passing NOTF-01/02/03 tests — poller registered in server.ts after live Neon DB migration confirmed.

## What Was Built

### Task 1: src/scheduler/membership-expiry.ts + tests/scheduler-expiry.test.ts (commit 9914e14)

**src/scheduler/membership-expiry.ts (new file):**

`runMembershipExpirySweep(): Promise<number>`:
- Outer loop over `listAllBusinessIds()` with per-business try/catch isolation
- `findMembershipsExpiringIn7Days(businessId)` provides the ExpiringMembership[] per business
- `findBusinessById(businessId)` → guard on null business or null botToken with `logger.warn`
- Inner loop over memberships with per-membership try/catch
- `insertMembershipExpiryNotification(membership.id, '7_day_client', expiryDate)` → if true, builds client Greek message with sessions count and sends via `botTokenStore.run(business.botToken, ...)`
- `insertMembershipExpiryNotification(membership.id, '7_day_owner', expiryDate)` → if true, calls `getClientName(businessId, membership.clientPhone)` (falls back to `membership.clientPhone` if null), builds owner Greek message, sends via `botTokenStore.run(business.botToken, ...)` if `business.ownerTelegramId` is set
- Returns total `notificationCount` (client + owner counted separately)
- botToken never passed to any logger call (T-09-09)

`startMembershipExpiryPoller(intervalMs = 6 * 60 * 60 * 1000): NodeJS.Timeout`:
- Plain `setInterval` with `.catch(logger.error)` safety net
- 6-hour default interval (D-02)

**tests/scheduler-expiry.test.ts (6 stubs implemented):**

Replaced the 6 `it.todo` stubs with full test bodies. Imports added: `runMembershipExpirySweep` from `../src/scheduler/membership-expiry`, typed mock references for all mocked modules.

Mock setup follows `expiry-poller.test.ts` pattern: `botTokenStore.run` mocked as `jest.fn().mockImplementation(async (_token, fn) => fn())` to call through to the async callback.

Test data: `EXPIRY_AT = new Date('2026-08-14T12:00:00Z')` (noon UTC = 15:00 Athens in summer DST — same calendar day, avoids midnight crossing).

- Test 1 (NOTF-01 client): asserts `sendTelegramMessage(CLIENT_PHONE, ...)` contains 'Υπενθύμιση', 'λήγει', '3 μαθήματα'
- Test 2 (NOTF-02 owner): asserts `sendTelegramMessage(OWNER_TELEGRAM_ID, ...)` contains 'Μαρία Παπαδοπούλου', 'λήγουσα συνδρομή'
- Test 3 (NOTF-03 dedup): `insertMembershipExpiryNotification` returns false → `sendTelegramMessage` not called
- Test 4 (botToken null): business with null botToken → no send
- Test 5 (per-business isolation): business 2 throws → business 1 still sends; sweep resolves without throw
- Test 6 (clientName fallback): `getClientName` returns null → owner message contains `CLIENT_PHONE`

### Task 2: Checkpoint — migrations/0008_expiry_notifications.sql applied to Neon DB

Human confirmed: `membership_expiry_notifications` table and `unique_membership_expiry_notification` UNIQUE INDEX present in live Neon DB (0 rows — fresh table as expected).

### Task 3: Register startMembershipExpiryPoller in src/server.ts (commit b614d30)

Added import on line 10:
```typescript
import { startMembershipExpiryPoller } from './scheduler/membership-expiry';
```

Added call inside `!process.env.JEST_WORKER_ID` guard after `startReminderPoller()`:
```typescript
startMembershipExpiryPoller();
```

No other changes to server.ts. JEST_WORKER_ID guard prevents the 6-hour setInterval from keeping Jest alive (T-09-11 / Pitfall 3).

## Verification

```
npx tsc --noEmit → exit 0 (0 errors)
npm test tests/scheduler-expiry.test.ts --no-coverage → 6 passed, 0 failed, 0 pending
npm test --no-coverage → 40 suites passed, 1 failed (billing-package-deactivate pre-existing),
  299 passed + 14 todo + 1 skipped, 3 failed (billing-package-deactivate pre-existing)
grep "startMembershipExpiryPoller" src/server.ts → 2 lines (import + call)
grep -A8 "JEST_WORKER_ID" src/server.ts → startMembershipExpiryPoller() inside guard
```

## Deviations from Plan

None — plan executed exactly as written. The pre-existing `billing-package-deactivate.test.ts` integration failures (3 tests) are unchanged from before this plan; they were documented in 09-01-SUMMARY.md and are unrelated to Phase 9 changes.

## Known Stubs

None — all test stubs from Plan 01's scaffolding have been implemented and pass:
- tests/scheduler-expiry.test.ts: 6/6 stubs implemented (this plan)
- tests/function-executor.test.ts: 4/4 stubs implemented (Plan 02)

## Threat Surface Scan

All T-09-08 through T-09-12 mitigations applied:
- T-09-08: per-business outer loop + businessId WHERE in `findMembershipsExpiringIn7Days` + botToken looked up per business — no cross-business send possible
- T-09-09: botToken never passed to logger inside `membership-expiry.ts`
- T-09-10: UNIQUE INDEX + `onConflictDoNothing()` prevents duplicate dedup rows; `insertMembershipExpiryNotification` returns false on conflict → no second Telegram send
- T-09-11: `startMembershipExpiryPoller()` only called inside `!JEST_WORKER_ID` guard
- T-09-12: server.ts registration blocked until human confirmed Neon DB migration applied

No new threat surface beyond the plan's existing threat model.

## Phase 9 Complete

All NOTF-01 through NOTF-04 requirements are now implemented and tested:
- NOTF-01: `runMembershipExpirySweep` sends Greek client notification 7 days before membership expiry (Plan 03, Test 1)
- NOTF-02: `runMembershipExpirySweep` sends Greek owner notification with client name (Plan 03, Test 2)
- NOTF-03: Second sweep for same membership+type+expiryDate produces no Telegram send (Plan 03, Test 3)
- NOTF-04: `check_membership_balance` Gemini tool returns correct Greek reply for all 3 scenarios (Plan 02, 4 tests)

## Self-Check: PASSED

Created files exist:
- src/scheduler/membership-expiry.ts: FOUND

Commits exist:
- 9914e14: feat(09-03): membership-expiry sweep + 6 NOTF-01/02/03 tests — FOUND
- b614d30: feat(09-03): register startMembershipExpiryPoller in server.ts — FOUND
