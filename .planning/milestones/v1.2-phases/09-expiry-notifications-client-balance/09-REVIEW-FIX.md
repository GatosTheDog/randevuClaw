---
phase: 09-expiry-notifications-client-balance
fixed_at: 2026-07-21T10:30:00Z
review_path: .planning/phases/09-expiry-notifications-client-balance/09-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 9: Code Review Fix Report

**Fixed at:** 2026-07-21
**Source review:** .planning/phases/09-expiry-notifications-client-balance/09-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (CR-01, WR-01, WR-02, WR-03)
- Fixed: 4
- Skipped: 0

## Fixed Issues

### CR-01: `'7_day_owner'` dedup row committed when `ownerTelegramId` is null

**Files modified:** `src/scheduler/membership-expiry.ts`, `tests/scheduler-expiry.test.ts`
**Commit:** 68db066
**Applied fix:** Wrapped the entire owner notification block — including the `insertMembershipExpiryNotification('7_day_owner', ...)` call — inside `if (business.ownerTelegramId)`. Previously the dedup row was inserted unconditionally before the `ownerTelegramId` guard, permanently suppressing the owner notification for any business in the intermediate state of having `botToken` set but `ownerTelegramId` still null. The inner `if (business.ownerTelegramId)` guard inside `botTokenStore.run()` was removed; the outer guard plus a non-null assertion on `business.ownerTelegramId!` covers it. Added a companion test verifying that neither `insertMembershipExpiryNotification` (with type `'7_day_owner'`) nor `sendTelegramMessage` to the owner is called when `ownerTelegramId` is null, while the client notification (NOTF-01) still fires normally.

### WR-01: `checkMembershipBalanceTool` issues `SELECT FOR UPDATE` for a read-only balance inquiry

**Files modified:** `src/conversation/function-executor.ts`, `tests/function-executor.test.ts`
**Commit:** ebd2cb0
**Applied fix:** Replaced `getActiveMembershipForDeduction` (which issues `SELECT ... FOR UPDATE`) with `getClientActiveMembership` (plain `SELECT`, no lock) in `checkMembershipBalanceTool`. Balance inquiry has no mutation to serialize and must not acquire an exclusive row-level lock that blocks concurrent booking requests. Updated the `isUnlimited` check to use `membership.isUnlimited` (provided by `getClientActiveMembership`) instead of `membership.sessionsRemaining === null`. Updated `tests/function-executor.test.ts`: added `getClientActiveMembership: jest.fn()` to the billing mock factory, added a typed `mockedGetClientActiveMembership` variable, updated safe defaults in both `beforeEach` blocks, and rewrote the `check_membership_balance` describe block to mock `getClientActiveMembership` with the full return shape (`packageName`, `sessionsRemaining`, `expiresAt`, `isUnlimited`).

### WR-02: Client dedup row committed before send — failed Telegram delivery permanently suppresses retry

**Files modified:** `src/scheduler/membership-expiry.ts`, `migrations/0008_expiry_notifications.sql`
**Commit:** 92b2486
**Applied fix:** Applied Option B (document the tradeoff) as the PoC-appropriate choice. Added an explicit comment before the `insertMembershipExpiryNotification('7_day_client', ...)` call explaining the at-most-once delivery semantic: the dedup row is intentionally committed before the Telegram send to prevent duplicate sends on concurrent sweeps, at the cost of permanent loss on Telegram failure. Updated the migration file header comment to say the table tracks which notifications were *attempted*, not necessarily delivered.

### WR-03: `findMembershipsExpiringIn7Days` runs before `findBusinessById` — wasted query on unconfigured businesses

**Files modified:** `src/scheduler/membership-expiry.ts`
**Commit:** 776ad6b
**Applied fix:** Reversed the call order: `findBusinessById` is now called first, the `!business || !business.botToken` guard runs, and `findMembershipsExpiringIn7Days` is only called for fully-configured businesses with a bot token. Unconfigured and partially-onboarded businesses no longer pay an unnecessary memberships DB query per sweep. Added a clarifying comment marking the change with WR-03.

---

_Fixed: 2026-07-21_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
