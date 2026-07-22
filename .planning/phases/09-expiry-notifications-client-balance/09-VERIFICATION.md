---
phase: 09-expiry-notifications-client-balance
verified: 2026-07-22T10:00:00Z
status: passed
score: 3/3 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Confirm membership_expiry_notifications table and unique_membership_expiry_notification index exist in live Neon production database"
    expected: "psql $DATABASE_URL -c \"\\d membership_expiry_notifications\" returns the table with columns (id, membership_id, notification_type, expiry_date, sent_at, created_at) and a UNIQUE INDEX on (membership_id, notification_type, expiry_date)"
    why_human: "Plan 03 SUMMARY Task 2 documents a human checkpoint for live Neon DB migration apply. The task was confirmed complete during execution, but this is a live DB operational state — not programmatically verifiable from this context. Migration SQL is idempotent (CREATE TABLE IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS); safe to re-run if uncertain."
---

# Phase 9: Expiry Notifications & Client Balance Verification Report

**Phase Goal:** The platform proactively notifies clients and owners 7 days before a membership expires, and clients can query their own session balance at any time via chat.
**Verified:** 2026-07-22T10:00:00Z
**Status:** passed (1 operational confirmation item — live Neon DB migration state)

## Goal Achievement

### Observable Truths (from ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Seven days before a membership expires, the client receives a Greek notification with their sessions remaining and expiry date; the business owner simultaneously receives a Greek alert naming the expiring client and their remaining balance. | ✓ VERIFIED | `runMembershipExpirySweep()` in `src/scheduler/membership-expiry.ts`: outer loop over `listAllBusinessIds()`, inner loop over `findMembershipsExpiringIn7Days(businessId)`. Client: `insertMembershipExpiryNotification(id, '7_day_client', expiryDate)` → `sendTelegramMessage(clientPhone, ...)` with sessions count and `formatExpiryDateGreek(expiresAt)`. Owner: `insertMembershipExpiryNotification(id, '7_day_owner', expiryDate)` → `getClientName(...)` with phone fallback → `sendTelegramMessage(ownerTelegramId, ...)` inside `botTokenStore.run()`. Integration tests NOTF-01 (Test 1) and NOTF-02 (Test 2) in `tests/scheduler-expiry.test.ts` both pass. |
| 2 | Expiry notifications are sent at most once per membership per notification trigger regardless of how many times the expiry sweep runs — duplicate notifications never reach clients or owners. | ✓ VERIFIED | `membership_expiry_notifications` table with `unique_membership_expiry_notification` UNIQUE INDEX on `(membership_id, notification_type, expiry_date)` (migration 0008). `insertMembershipExpiryNotification()` uses `.onConflictDoNothing().returning()` — returns `true` only on first insert. Sweep gates both client and owner `sendTelegramMessage` calls on this return value. Integration test NOTF-03 (Test 3): `insertMembershipExpiryNotification` returns false → `sendTelegramMessage` not called (confirmed by mock assertion). |
| 3 | A client sends a Greek balance query (e.g. "πόσα μαθήματα μου έχουν απομείνει;") and receives an accurate Greek reply with sessions remaining and the membership expiry date for their active membership. | ✓ VERIFIED | `check_membership_balance` Gemini tool in `BOOKING_TOOLS` (`src/conversation/ai-agent.ts` line 111). Handler `checkMembershipBalanceTool` in `function-executor.ts` lines 370–397: 3 D-08 Greek message scenarios — no membership, unlimited, counted sessions — all use `formatExpiryDateGreek(membership.expiresAt)` for Athens DD/MM/YYYY date. `clientPhone` always from `context.clientPhone`, never from Gemini args (T-09-05 guard at line 82). 4 unit tests in `tests/function-executor.test.ts` all pass (NOTF-04). |

**Score:** 3/3 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `migrations/0008_expiry_notifications.sql` | CREATE TABLE IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS; GRANT to randevuclaw_app | ✓ VERIFIED | File exists. Idempotent SQL. Applied to live Neon DB (Plan 03 Task 2 human checkpoint confirmed). |
| `src/database/schema.ts` | `membershipExpiryNotifications` pgTable with uniqueIndex on (membershipId, notificationType, expiryDate) | ✓ VERIFIED | Table at line 329. `uniqueIndex('unique_membership_expiry_notification')` on 3-column composite. |
| `src/utils/timezone.ts` | `formatExpiryDateGreek(date: Date): string` — Intl.DateTimeFormat en-GB / Europe/Athens → DD/MM/YYYY | ✓ VERIFIED | Function at line 38. Uses `Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', day: '2-digit', month: '2-digit', year: 'numeric' })`. 6 passing tests in `tests/timezone.test.ts`. |
| `src/billing/queries.ts` | `ExpiringMembership` interface + `findMembershipsExpiringIn7Days()` + `insertMembershipExpiryNotification()` | ✓ VERIFIED | Interface at line 713 area; `findMembershipsExpiringIn7Days` at line 713; `insertMembershipExpiryNotification` at line 749. DST-safe window: `isoDateInAthens` + `addCalendarDays` + `gt(expiresAt, now)` exclusion filter. Dedup insert with `onConflictDoNothing().returning()`. |
| `src/conversation/ai-agent.ts` | `check_membership_balance` in `BOOKING_TOOLS` | ✓ VERIFIED | Tool at line 111 with Greek description and `{ business_id: integer }` parameter schema. |
| `src/conversation/function-executor.ts` | `CheckMembershipBalanceArgsSchema`; `case 'check_membership_balance'`; `checkMembershipBalanceTool` with 3 Greek D-08 scenarios; cross-tenant guard | ✓ VERIFIED | Schema (no `client_phone` param). Case at line 99. Handler at line 370. Cross-tenant guard at line 82: `args.business_id !== context.business.id` → `cross_tenant_denied`. Uses `getClientActiveMembership` (not `getActiveMembershipForDeduction` — no FOR UPDATE lock needed for read-only balance query per WR-01). |
| `src/scheduler/membership-expiry.ts` | `runMembershipExpirySweep()` + `startMembershipExpiryPoller()` with 6-hour interval; per-business + per-membership try/catch isolation; `botTokenStore.run()` on all Telegram calls; `ownerTelegramId` null guard | ✓ VERIFIED | New file in `src/scheduler/`. `botTokenStore.run()` wraps all sends. Owner block conditional on `business.ownerTelegramId`. `notificationCount` increments for client and owner separately. `startMembershipExpiryPoller()` returns `NodeJS.Timeout`. |
| `src/server.ts` | `startMembershipExpiryPoller()` imported and called inside `!JEST_WORKER_ID` guard | ✓ VERIFIED | Import at line 10. Call at line 41 inside `if (!process.env.JEST_WORKER_ID)` block (T-09-11). |
| `tests/scheduler-expiry.test.ts` | 6 passing tests covering NOTF-01/02/03 — client send, owner send, dedup, null botToken, per-business isolation, clientName fallback | ✓ VERIFIED | 6/6 passing. `botTokenStore.run` mocked to call through. Test date anchor: noon UTC (avoids Athens DST midnight crossing). |
| `tests/function-executor.test.ts` | 4 passing tests covering NOTF-04 — no membership, unlimited, counted, cross-tenant guard | ✓ VERIFIED | 4/4 passing in `describe('check_membership_balance tool — NOTF-04')`. 25 total function-executor tests pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `startMembershipExpiryPoller` | `runMembershipExpirySweep` | `setInterval` with 6h default | ✓ WIRED | `src/server.ts` line 41 inside `!JEST_WORKER_ID` guard. |
| `runMembershipExpirySweep` | `findMembershipsExpiringIn7Days` | import from `billing/queries`; called per business in outer loop | ✓ WIRED | DST-safe 7-day window + active-membership filter. |
| `runMembershipExpirySweep` | `insertMembershipExpiryNotification` | import from `billing/queries`; return-value gates Telegram send | ✓ WIRED | `'7_day_client'` and `'7_day_owner'` rows inserted separately (D-05 per-recipient dedup granularity). |
| `runMembershipExpirySweep` | `sendTelegramMessage` | `botTokenStore.run(business.botToken, fn)` — mandatory wrapper for poller context | ✓ WIRED | D-06 applied. All Telegram calls inside `botTokenStore.run()`. Token never logged (T-09-09). |
| `checkMembershipBalanceTool` | `getClientActiveMembership` | import in `function-executor.ts`; clientPhone always from `context.clientPhone` | ✓ WIRED | Line 376. Plain SELECT (no FOR UPDATE) — WR-01 fix. `context.clientPhone` prevents cross-client inspection (T-09-05). |
| `checkMembershipBalanceTool` | `formatExpiryDateGreek` | import from `../utils/timezone`; used in both unlimited and counted message paths | ✓ WIRED | Lines 388, 394. Athens DD/MM/YYYY formatting for all Greek-facing expiry dates. |
| `executeTool` | `checkMembershipBalanceTool` | `case 'check_membership_balance'` in dispatcher switch | ✓ WIRED | Line 99 of `function-executor.ts`. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles without errors | `npx tsc --noEmit` | exit 0, no output | ✓ PASS |
| scheduler-expiry tests (NOTF-01/02/03) | `npm test tests/scheduler-expiry.test.ts` | 6 passed, 0 failed | ✓ PASS |
| function-executor Phase 9 tests (NOTF-04) | `npm test tests/function-executor.test.ts` | 25 passed total (4 NOTF-04 + 21 prior), 0 failed | ✓ PASS |
| timezone utility tests | `npm test tests/timezone.test.ts` | 6 passed, 0 failed | ✓ PASS |
| expiry-poller regression | `npm test tests/expiry-poller.test.ts` | 8 passed, 0 failed | ✓ PASS |
| Full test suite | `npm test` | 41 suites passed, 320 passed, 1 skipped (rls-enforcement — requires DATABASE_APP_URL, pre-existing), 0 failed | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| NOTF-01 | 09-01, 09-02, 09-03 | Client receives Greek 7-day expiry notification with sessions + expiry date | ✓ SATISFIED | `runMembershipExpirySweep` sends to `membership.clientPhone`; `'7_day_client'` dedup row gates send. Test 1 in `scheduler-expiry.test.ts` asserts message contains sessions count and expiry date. |
| NOTF-02 | 09-01, 09-02, 09-03 | Owner receives Greek 7-day alert naming client and their remaining balance | ✓ SATISFIED | `getClientName()` with `clientPhone` fallback; sends to `business.ownerTelegramId` if set; `'7_day_owner'` dedup row gates send. Test 2 asserts owner message contains client name. CR-01 fix ensures dedup row only inserted when `ownerTelegramId` is non-null. |
| NOTF-03 | 09-01, 09-02, 09-03 | Duplicate notifications never sent — dedup per membership per trigger | ✓ SATISFIED | UNIQUE INDEX on `(membership_id, notification_type, expiry_date)`. `insertMembershipExpiryNotification` returns false on conflict; Telegram send skipped. Test 3 asserts `sendTelegramMessage` not called on second sweep. |
| NOTF-04 | 09-01, 09-02 | Client queries balance via chat; bot replies accurately in Greek | ✓ SATISFIED | `check_membership_balance` in `BOOKING_TOOLS`. 3 D-08 Greek reply scenarios (no membership, unlimited, counted). `clientPhone` from context only. 4 unit tests pass. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | No TBD, FIXME, XXX, TODO, HACK, or PLACEHOLDER markers found in any Phase 9 modified file. All test stubs from Plan 01 scaffolding fully implemented. No hardcoded empty return values in user-facing paths. |

### Human Verification Required

#### 1. Live Neon Production Database Migration

**Test:** Run `psql $DATABASE_URL -c "\d membership_expiry_notifications"` against the live Neon database URL.

**Expected:** Table returned with columns (id, membership_id, notification_type, expiry_date, sent_at, created_at) and a UNIQUE constraint `unique_membership_expiry_notification` on (membership_id, notification_type, expiry_date).

**If not present:** Apply the idempotent migration: `psql $DATABASE_URL -f migrations/0008_expiry_notifications.sql`

**Why human:** Plan 03 SUMMARY Task 2 documents that a human confirmed the live Neon DB migration applied during execution (0 rows in fresh table). This is an operational state — not programmatically verifiable from this context. The migration SQL is idempotent; re-running is safe. The live sweep registered in `server.ts` requires this table to exist or it will error on first tick.

### Gaps Summary

No code gaps. All 3 Success Criteria verified. All 10 NOTF-01 through NOTF-04 requirement conditions satisfied. Full test suite green (320 passed, 1 skipped pre-existing, 0 failed). TypeScript compilation clean. The single human verification item is an operational/deployment confirmation (live DB migration state), not a code gap.

---

_Verified: 2026-07-22T10:00:00Z_
_Verifier: Claude (gsd-verifier)_
