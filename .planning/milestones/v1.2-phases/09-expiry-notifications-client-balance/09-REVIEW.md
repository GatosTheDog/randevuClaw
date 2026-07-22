---
phase: 09-expiry-notifications-client-balance
reviewed: 2026-07-21T10:00:00Z
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

Phase 9 adds the membership expiry notification sweep, the `check_membership_balance` client-facing tool, a dedup table, and the scheduler wiring. `timezone.ts`, `ai-agent.ts`, the migration SQL, the schema extension, and `server.ts` are all clean. The billing query layer additions in `billing/queries.ts` are well-structured; the DST-safe window arithmetic (`isoDateInAthens` + fixed `+02:00` offset) is internally consistent with `createMembership` and does not introduce an off-by-one.

Two material defects require fixes before shipping. First, the expiry sweep in `membership-expiry.ts` unconditionally commits a `'7_day_owner'` dedup row before confirming that `ownerTelegramId` is set — permanently suppressing the owner notification for that membership/expiry-date combination on every subsequent sweep, even after the owner ID is configured. Second, `checkMembershipBalanceTool` borrows the booking-path query `getActiveMembershipForDeduction`, which carries a `SELECT FOR UPDATE`. For a read-only balance inquiry running inside a `withBusinessContext` transaction this is an unnecessary row-level lock that can block concurrent booking requests from the same client.

The test suite for both the sweep and the balance tool is thorough. However, neither suite exercises `botToken != null, ownerTelegramId = null` — the exact state that hides the BLOCKER.

---

## Critical Issues

### CR-01: `'7_day_owner'` dedup row committed when `ownerTelegramId` is null — owner notification permanently lost

**File:** `src/scheduler/membership-expiry.ts:77-97`

**Issue:** The outer business guard at line 44 only checks `business.botToken`. When a business has `botToken` set but `ownerTelegramId` is still null (a valid intermediate state during onboarding, since the two fields are set independently), the per-membership inner loop proceeds. The sequence for every such membership is:

1. Line 77-81: `insertMembershipExpiryNotification(membership.id, '7_day_owner', expiryDate)` commits a UNIQUE dedup row to the database.
2. Line 82-96: `botTokenStore.run()` is entered; `if (business.ownerTelegramId)` is false — `sendTelegramMessage` is never called.
3. Line 97: `notificationCount += 1` fires — the sweep return value is inflated without any message actually being sent.

On every subsequent sweep — including after the owner configures `ownerTelegramId` — `insertMembershipExpiryNotification` returns `false` (UNIQUE constraint fires). The `if (ownerNotified)` block is skipped entirely. The owner will never receive the 7-day expiry warning for this membership, regardless of any later configuration change. No error is logged.

The existing tests mock `insertMembershipExpiryNotification.mockResolvedValue(true)` and `business.ownerTelegramId = OWNER_TELEGRAM_ID`, so the `botToken != null, ownerTelegramId = null` state is never exercised.

**Fix:** Guard the entire owner notification block — including the `insertMembershipExpiryNotification` call — with an upfront `ownerTelegramId` check:

```typescript
// Owner notification (NOTF-02) — guard before dedup insert, not just before send
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
      // ownerTelegramId is guaranteed non-null by the outer guard above
      await sendTelegramMessage(business.ownerTelegramId!, ownerMsg);
    });
    notificationCount += 1;
  }
}
```

Add a companion test: `botToken` set, `ownerTelegramId = null` → `insertMembershipExpiryNotification` must NOT be called with `'7_day_owner'`, and `sendTelegramMessage` must not be called for the owner.

---

## Warnings

### WR-01: `checkMembershipBalanceTool` issues `SELECT FOR UPDATE` for a read-only balance inquiry

**File:** `src/conversation/function-executor.ts:373`

**Issue:** `checkMembershipBalanceTool` calls `getActiveMembershipForDeduction(context.business.id, context.clientPhone)`. That function issues a `SELECT ... FOR UPDATE` (confirmed: `billing/queries.ts:350`). Its own JSDoc states it "MUST be called inside an active `withBusinessContext` transaction so the lock is held until the surrounding transaction commits/rolls back."

The entire tool dispatch runs inside exactly such a transaction: `withBusinessContext` at `telegram.ts:422` wraps `handleFoundBusiness` → `routeConversationMessage` → `aiBookingAgent` → `executeTool`. Therefore, invoking `check_membership_balance` acquires an exclusive row-level lock on the client's membership row for the full duration of the conversation turn — including the round-trip to the Gemini API. Any concurrent booking request targeting the same membership row (from an unlikely but possible second connection) will block until this transaction commits.

`getActiveMembershipForDeduction` is designed for the session-deduction path where the lock prevents double-deduction. A balance inquiry has no mutation to serialize.

`getClientActiveMembership` (defined at `billing/queries.ts:542`) covers the same use case — same `isActive = true` and `expiresAt > NOW()` filters — without locking, and it also returns `packageName` and `isUnlimited` which would enrich the balance response.

**Fix:**

```typescript
// function-executor.ts — add to the billing imports:
import {
  getActiveMembershipForDeduction,
  getClientActiveMembership,   // add
  deductSession,
  restoreCredit,
  getClientName,
  findMembershipByBooking,
  ActiveMembershipForDeduction,
} from '../billing/queries';

// Replace checkMembershipBalanceTool body:
async function checkMembershipBalanceTool(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  CheckMembershipBalanceArgsSchema.parse(args);

  const membership = await getClientActiveMembership(context.business.id, context.clientPhone);

  if (membership === null) {
    return {
      success: true,
      message: 'Δεν βρέθηκε ενεργή συνδρομή. Επικοινωνήστε με ' + context.business.name + ' για ανανέωση.',
    };
  }

  if (membership.isUnlimited) {
    return {
      success: true,
      message: 'Η συνδρομή σας είναι απεριόριστων μαθημάτων και λήγει στις ' + formatExpiryDateGreek(membership.expiresAt) + '.',
    };
  }

  return {
    success: true,
    message: 'Έχετε ' + membership.sessionsRemaining + ' μαθήματα απομείνει. Η συνδρομή σας λήγει στις ' + formatExpiryDateGreek(membership.expiresAt) + '.',
  };
}
```

Update the mock in `tests/function-executor.test.ts` to include `getClientActiveMembership` in the billing mock factory; remove the `getActiveMembershipForDeduction` mock from the `check_membership_balance` describe block.

### WR-02: Client dedup row committed before send — failed Telegram delivery permanently suppresses retry

**File:** `src/scheduler/membership-expiry.ts:58-73`

**Issue:** The client notification path inserts the `'7_day_client'` dedup row at line 58-61 and then attempts `sendTelegramMessage` at line 70-72. If `sendTelegramMessage` throws (Telegram API down, rate limit, network error), the exception propagates out of `botTokenStore.run()` and is caught by the inner per-membership try/catch at line 99. The dedup row is already committed. On the next sweep, `insertMembershipExpiryNotification` returns `false` and the client is silently skipped — the 7-day warning is never delivered, with no error surfaced in the return count and no retry possible.

The migration comment states the table "tracks which … triples have already **fired**" — marking a triple as fired before confirmed delivery contradicts this stated semantic.

**Fix option A (send-first):** Move the `insertMembershipExpiryNotification` call after a confirmed `sendTelegramMessage`:

```typescript
if (/* no existing dedup row yet — check with a query or attempt optimistic send */) {
  const sessionsText = ...;
  const clientMsg = `Υπενθύμιση: ...`;
  await botTokenStore.run(business.botToken, async () => {
    await sendTelegramMessage(membership.clientPhone, clientMsg);
  });
  // Only record after confirmed delivery
  await insertMembershipExpiryNotification(membership.id, '7_day_client', expiryDate);
  notificationCount += 1;
}
```

**Fix option B (document the tradeoff):** If at-most-once delivery is intentional (to prevent duplicate sends on concurrent sweeps at the cost of permanent loss on Telegram failure), add an explicit comment acknowledging this and update the migration comment to say "marks which notifications were *attempted*, not necessarily delivered."

### WR-03: `findMembershipsExpiringIn7Days` runs before `findBusinessById` — wasted query on unconfigured businesses

**File:** `src/scheduler/membership-expiry.ts:41-48`

**Issue:** The outer business loop calls `findMembershipsExpiringIn7Days(businessId)` at line 41 before calling `findBusinessById(businessId)` at line 42. If `findBusinessById` returns null or the business has `botToken = null` (the `continue` path at lines 44-49), the memberships query result is discarded — the round-trip was wasted. For any business in a partially-configured state (e.g., onboarding in progress), every sweep run pays an unnecessary DB query per unconfigured business.

**Fix:** Reverse the call order to exit early before fetching memberships:

```typescript
for (const businessId of businessIds) {
  try {
    const business = await findBusinessById(businessId);

    if (!business || !business.botToken) {
      logger.warn(
        { businessId },
        'No bot token for business, skipping membership expiry notifications'
      );
      continue;
    }

    const memberships = await findMembershipsExpiringIn7Days(businessId);
    // ... rest of inner loop unchanged
  } catch (err) {
    logger.error({ err, businessId }, 'Membership expiry sweep failed for business');
  }
}
```

---

## Info

### IN-01: `membership_expiry_notifications` carries two identical timestamp columns

**File:** `src/database/schema.ts:345-346` / `migrations/0008_expiry_notifications.sql:30-31`

**Issue:** `sent_at TIMESTAMP NOT NULL DEFAULT NOW()` and `created_at TIMESTAMP NOT NULL DEFAULT NOW()` are both defined, both default to `NOW()`, and the table is explicitly append-only (no UPDATE is ever issued). Every row will always have `sentAt === createdAt`. One column is redundant and introduces ambiguity about which field records "when was the notification sent."

**Fix:** Remove `sentAt` and retain `createdAt` as the sole audit timestamp (consistent with every other table in the schema). Update both `schema.ts` and `migrations/0008_expiry_notifications.sql`, and remove the `GRANT USAGE, SELECT ON SEQUENCE` reference if the id sequence naming changes.

### IN-02: Missing DB-level `CHECK` constraint on `notification_type`

**File:** `migrations/0008_expiry_notifications.sql:29` / `src/database/schema.ts:342`

**Issue:** `notification_type TEXT NOT NULL` has no `CHECK (notification_type IN ('7_day_client', '7_day_owner'))` constraint in the migration SQL or in the Drizzle schema definition. Valid values are enforced only by the TypeScript union type `'7_day_client' | '7_day_owner'` on `insertMembershipExpiryNotification`. Raw SQL inserts (migrations, manual ops, future scheduled tasks) can write arbitrary strings that the UNIQUE index would silently treat as distinct dedup keys, producing phantom rows that block no-one and confuse audits.

`businesses.enforcement_policy` has an equivalent DB-level `CHECK` constraint documented in its schema comment — apply the same pattern here.

**Fix (migration):**
```sql
CREATE TABLE IF NOT EXISTS membership_expiry_notifications (
  id SERIAL PRIMARY KEY,
  membership_id INTEGER NOT NULL REFERENCES memberships(id),
  notification_type TEXT NOT NULL
    CHECK (notification_type IN ('7_day_client', '7_day_owner')),
  expiry_date TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**Fix (schema.ts):** Drizzle does not have a first-class `check()` column modifier in v0.30; add a raw constraint via `sql` in the table definition's second argument or document the enforcement is migration-only.

---

_Reviewed: 2026-07-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
