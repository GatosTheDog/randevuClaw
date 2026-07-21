---
phase: 09-expiry-notifications-client-balance
reviewed: 2026-07-21T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - migrations/0008_expiry_notifications.sql
  - src/billing/queries.ts
  - src/conversation/ai-agent.ts
  - src/conversation/function-executor.ts
  - src/database/schema.ts
  - src/scheduler/membership-expiry.ts
  - src/server.ts
  - src/utils/timezone.ts
  - tests/function-executor.test.ts
  - tests/scheduler-expiry.test.ts
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-07-21
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Phase 9 adds a membership expiry notification sweep, a `check_membership_balance` client tool, a dedup table, and the scheduler wiring. The `timezone.ts` utility, migration, schema additions, and `ai-agent.ts` tool registration are clean. The billing query layer (`billing/queries.ts`) is well-structured and the DST-safe window arithmetic is correct and consistent with `createMembership`.

Two areas require attention. First, the expiry sweep (`membership-expiry.ts`) has a blocker: it unconditionally writes a dedup row for the owner notification before checking whether the owner's Telegram ID is set, permanently suppressing future owner alerts for that expiry event. Second, `checkMembershipBalanceTool` reuses the booking-path query (`getActiveMembershipForDeduction`) which carries a `SELECT FOR UPDATE` lock — unnecessary and potentially harmful for a read-only balance inquiry running inside a `withBusinessContext` transaction.

The test coverage for both the sweep and the balance tool is solid. However, neither test suite exercises the scenario where `botToken` is set but `ownerTelegramId` is null — the exact case that hides the blocker.

---

## Critical Issues

### CR-01: Owner dedup row written when `ownerTelegramId` is null — owner notification permanently suppressed

**File:** `src/scheduler/membership-expiry.ts:77-97`

**Issue:** `insertMembershipExpiryNotification(membership.id, '7_day_owner', expiryDate)` is called unconditionally, before `business.ownerTelegramId` is checked. The sequence on the first sweep when `ownerTelegramId` is null:

1. Line 77-81: dedup row for `'7_day_owner'` is permanently committed to the DB
2. Line 82-96: `botTokenStore.run()` is entered; `if (business.ownerTelegramId)` is false — no `sendTelegramMessage` call
3. Line 97: `notificationCount += 1` is still reached — the counter is inflated by 1 for each affected membership

On every subsequent sweep — including after the owner later sets their Telegram ID — `insertMembershipExpiryNotification` returns `false` (UNIQUE conflict), so the `if (ownerNotified)` block is skipped entirely. The owner can never receive the 7-day expiry warning for that membership, regardless of any configuration changes. No error is logged; the failure is invisible.

The test suite does not exercise the `botToken != null, ownerTelegramId = null` combination, so this bug passes all existing tests.

**Fix:** Guard the entire owner notification block with an `ownerTelegramId` check before inserting the dedup row:

```typescript
// Owner notification (NOTF-02) — only attempt when ownerTelegramId is set
if (business.ownerTelegramId) {
  const ownerNotified = await insertMembershipExpiryNotification(
    membership.id,
    '7_day_owner',
    expiryDate
  );
  if (ownerNotified) {
    const clientName =
      (await getClientName(businessId, membership.clientPhone)) ??
      membership.clientPhone;
    const sessionsOwnerText =
      membership.sessionsRemaining !== null
        ? ` Εναπομείναντα μαθήματα: ${membership.sessionsRemaining}.`
        : ' Απεριόριστη συνδρομή.';
    const ownerMsg =
      `Πελάτης με λήγουσα συνδρομή: ${clientName}. Λήγει στις ${formattedDate}.${sessionsOwnerText}`;
    await botTokenStore.run(business.botToken, async () => {
      // ownerTelegramId guaranteed non-null by outer guard
      await sendTelegramMessage(business.ownerTelegramId!, ownerMsg);
    });
    notificationCount += 1;
  }
}
```

Add a companion test: `botToken` set, `ownerTelegramId` null → `insertMembershipExpiryNotification` must NOT be called with `'7_day_owner'`.

---

## Warnings

### WR-01: `checkMembershipBalanceTool` uses `SELECT FOR UPDATE` for a read-only balance inquiry

**File:** `src/conversation/function-executor.ts:373`

**Issue:** `checkMembershipBalanceTool` calls `getActiveMembershipForDeduction(context.business.id, context.clientPhone)`. That function issues `SELECT ... FOR UPDATE` (confirmed: `billing/queries.ts:350`). Its own JSDoc explicitly states it "MUST be called inside an active withBusinessContext transaction so the lock is held until the surrounding transaction commits/rolls back."

`checkMembershipBalanceTool` runs inside exactly that transaction (traced: `withBusinessContext` at `telegram.ts:422` → `handleFoundBusiness` → `routeConversationMessage` → `aiBookingAgent` → `executeTool`). Therefore the exclusive row-level lock on the client's membership row is held for the entire duration of the tool response — including any Telegram sends that happen later in the same turn. A concurrent booking request from the same client targeting the same row will block until this transaction commits.

`getClientActiveMembership` (defined at `billing/queries.ts:542`) returns the same data — `packageName`, `sessionsRemaining`, `expiresAt`, `isUnlimited` — without locking.

**Fix:** Replace the call in `checkMembershipBalanceTool`:

```typescript
// function-executor.ts — add to imports:
import {
  getActiveMembershipForDeduction,
  getClientActiveMembership,   // <-- add
  deductSession,
  ...
} from '../billing/queries';

// Inside checkMembershipBalanceTool:
async function checkMembershipBalanceTool(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  CheckMembershipBalanceArgsSchema.parse(args);

  const membership = await getClientActiveMembership(context.business.id, context.clientPhone);

  if (membership === null) {
    return { success: true, message: 'Δεν βρέθηκε ενεργή συνδρομή. Επικοινωνήστε με ' + context.business.name + ' για ανανέωση.' };
  }

  if (membership.isUnlimited) {
    return { success: true, message: 'Η συνδρομή σας είναι απεριόριστων μαθημάτων και λήγει στις ' + formatExpiryDateGreek(membership.expiresAt) + '.' };
  }

  return { success: true, message: 'Έχετε ' + membership.sessionsRemaining + ' μαθήματα απομείνει. Η συνδρομή σας λήγει στις ' + formatExpiryDateGreek(membership.expiresAt) + '.' };
}
```

Note: `getClientActiveMembership` already filters `gt(memberships.expiresAt, new Date())` and `eq(memberships.isActive, true)` — it returns null for expired memberships, matching the existing behavior.

### WR-02: Client (and owner) dedup row committed before Telegram send; a failed send permanently suppresses retry

**File:** `src/scheduler/membership-expiry.ts:58-73`

**Issue:** For the client notification path (lines 58-73), `insertMembershipExpiryNotification` is called and committed before `sendTelegramMessage`. If `sendTelegramMessage` throws (Telegram API unavailable, rate-limit, network error), the exception is caught by the inner membership-level try/catch (line 99). But the dedup row is already in the database. On the next sweep run, `insertMembershipExpiryNotification` returns `false` (UNIQUE conflict) and the client is silently skipped — the 7-day warning is permanently lost with no error surfaced to the sweep return count.

The migration comment says the table "Tracks which … triples have already **fired**" — inserting the row before a successful send diverges from that semantic: a triple is marked fired even when the notification was not delivered.

The same issue exists for the owner path, but the CR-01 fix (moving the `insertMembershipExpiryNotification` call inside the `ownerTelegramId` guard) partially addresses it there.

**Fix:** Send first, then insert the dedup row on success:

```typescript
// Client path (lines 63-74 region):
if (await shouldClientBeNotified(membership.id, '7_day_client', expiryDate)) {
  // Not yet deduplicated — attempt send
  ...
}
// Replace the current pattern with:
const sessionsText = ...;
const clientMsg = `Υπενθύμιση: ...`;
await botTokenStore.run(business.botToken, async () => {
  await sendTelegramMessage(membership.clientPhone, clientMsg);
});
// Only record dedup after confirmed delivery
await insertMembershipExpiryNotification(membership.id, '7_day_client', expiryDate);
notificationCount += 1;
```

If this "send-first" order is intentionally rejected (e.g., to prevent double-sends on concurrent sweeps), document the tradeoff explicitly: failed sends are not retried, and the next sweep will skip the membership regardless of delivery outcome.

### WR-03: `findMembershipsExpiringIn7Days` called before `findBusinessById` wastes a DB query when business has no bot token

**File:** `src/scheduler/membership-expiry.ts:41-43`

**Issue:** The sweep unconditionally runs `findMembershipsExpiringIn7Days(businessId)` (a `SELECT` over the memberships table) before calling `findBusinessById(businessId)`. If `findBusinessById` returns `null` or the business has no `botToken`, the function continues to the next iteration — but the memberships query result is discarded. For businesses without a configured bot token (a common state during onboarding), every sweep run performs a wasted round-trip to the database.

**Fix:** Reverse the call order and early-return before fetching memberships:

```typescript
for (const businessId of businessIds) {
  try {
    const business = await findBusinessById(businessId);

    if (!business || !business.botToken) {
      logger.warn({ businessId }, 'No bot token for business, skipping membership expiry notifications');
      continue;
    }

    const memberships = await findMembershipsExpiringIn7Days(businessId);
    // ... rest of the per-business loop
  } catch (err) { ... }
}
```

---

## Info

### IN-01: `membershipExpiryNotifications` has two identical timestamp columns

**File:** `src/database/schema.ts:344-346` / `migrations/0008_expiry_notifications.sql:30-31`

**Issue:** Both `sent_at TIMESTAMP NOT NULL DEFAULT NOW()` and `created_at TIMESTAMP NOT NULL DEFAULT NOW()` are defined on the table. Neither column is ever updated after insert (the table is intentionally append-only). Every row will always have `sentAt === createdAt`. One column is redundant and adds confusion about which one records "when was this notification sent."

**Fix:** Remove `sentAt` and use `createdAt` as the sole audit timestamp, or rename `createdAt` to `sentAt` and remove the other. Update both the Drizzle schema and the migration consistently.

### IN-02: `checkMembershipBalanceTool` returns "0 sessions remaining" without indicating booking is blocked

**File:** `src/conversation/function-executor.ts:389-392`

**Issue:** When `sessionsRemaining === 0`, the tool returns "Έχετε 0 μαθήματα απομείνει. Η συνδρομή σας λήγει στις …" — technically accurate but potentially confusing. The `hasCapacity` check in `bookAppointmentTool` (line 167) treats `sessionsRemaining === 0` as "no valid membership," so a client reading this message may immediately attempt a booking and be blocked (or flagged) without understanding why.

**Fix:** Add a distinct response for the exhausted case:

```typescript
if (membership.sessionsRemaining === 0) {
  return {
    success: true,
    message: 'Τα μαθήματά σας εξαντλήθηκαν. Επικοινωνήστε με ' +
      context.business.name + ' για ανανέωση της συνδρομής σας.',
  };
}
```

---

_Reviewed: 2026-07-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
