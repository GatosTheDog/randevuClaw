---
phase: 08-enforcement-session-deduction
reviewed: 2026-07-21T10:00:00Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - migrations/0007_enforcement_policy.sql
  - src/billing/enforcement.ts
  - src/billing/queries.ts
  - src/billing/tools.ts
  - src/conversation/function-executor.ts
  - src/database/queries.ts
  - src/database/schema.ts
  - src/onboarding/ai-owner-agent.ts
  - src/webhooks/telegram.ts
  - tests/ai-agent.test.ts
  - tests/billing-enforcement-policy.test.ts
  - tests/billing-package-creation.test.ts
  - tests/billing-package-deactivate.test.ts
  - tests/billing-session-deduction.test.ts
  - tests/booking-enforcement.test.ts
  - tests/calendar-poller.test.ts
  - tests/calendar-sync.test.ts
  - tests/consent.test.ts
  - tests/conversation-router.test.ts
  - tests/enforcement-nlu.test.ts
  - tests/enforcement-session-deduction.test.ts
  - tests/expiry-poller.test.ts
  - tests/function-executor.test.ts
  - tests/idempotency.test.ts
  - tests/onboarding-flow.test.ts
  - tests/onboarding-platform.test.ts
  - tests/scheduler-agenda.test.ts
  - tests/telegram-webhook.test.ts
  - tests/webhook.test.ts
findings:
  critical: 2
  warning: 5
  info: 2
  total: 9
status: issues_found
---

# Phase 08: Code Review Report

**Reviewed:** 2026-07-21T10:00:00Z
**Depth:** standard
**Files Reviewed:** 28
**Status:** issues_found

## Summary

Phase 8 adds enforcement policy checks (block/flag/allow), session deduction on booking, and credit restore on cancellation. The core machinery in `billing/queries.ts` (SELECT FOR UPDATE, ledger idempotency, credit restore expiry guard) is well-designed. However, two BLOCKER defects were found:

1. `src/billing/enforcement.ts` was written as an extractable pure function but was never wired into `function-executor.ts`. The production enforcement code is a separate inline re-implementation. This leaves `booking-enforcement.test.ts` testing dead code while the actual production path is exercised by a different set of assertions — creating false confidence about ENFC-02/ENFC-03 coverage.

2. The reschedule flow (`rescheduleAppointmentTool`) does not create a `session_deducted` ledger entry for the new booking. This means `findMembershipByBooking` returns null for the rescheduled booking, so any subsequent cancellation of the rescheduled appointment silently skips credit restore — permanently losing the client's session.

Five additional warnings cover a redundant DB constraint, a missing defensive guard in the deduction UPDATE, RLS bypass for package lifecycle operations, a misleading success reply on zero-row deactivation, and a hardcoded DST offset.

## Critical Issues

### CR-01: `enforcement.ts` is dead code — enforcement tests validate the wrong code path

**File:** `src/billing/enforcement.ts:41`
**Issue:** `checkEnforcementAndGetMembership` is never imported or called by any production module. The actual booking enforcement logic is a separate inline re-implementation inside `bookAppointmentTool` in `function-executor.ts` (lines 179–215), which reads `context.business.enforcementPolicy` (already fetched) and calls `getActiveMembershipForDeduction` directly. `enforcement.ts` instead re-fetches the policy via a second DB call (`getBusinessEnforcementPolicy`). The two implementations are divergent.

Consequence: `tests/booking-enforcement.test.ts` (ENFC-02/ENFC-03) exercises `checkEnforcementAndGetMembership`, a function that can never be reached in production. If the inline logic in `function-executor.ts` has a regression, these tests will not catch it. The test suite gives false confidence for the enforcement requirement.

**Fix:** Either (a) wire `checkEnforcementAndGetMembership` into `bookAppointmentTool` as originally intended:

```typescript
// In function-executor.ts, bookAppointmentTool:
import { checkEnforcementAndGetMembership } from '../billing/enforcement';

const enfResult = await checkEnforcementAndGetMembership(
  context.business.id, context.clientPhone
);
if (!enfResult.allowed) {
  return {
    success: false,
    error: 'no_membership',
    message: enfResult.message ?? 'Απαιτείται ενεργή συνδρομή.',
  };
}
// use enfResult.membership instead of re-fetching
const membership = enfResult.membership;
if (enfResult.shouldAlert && context.business.ownerTelegramId) {
  const clientName = await getClientName(context.business.id, context.clientPhone);
  await sendTelegramMessage(context.business.ownerTelegramId, buildFlagAlert(...));
}
```

Or (b) delete `enforcement.ts` and update `booking-enforcement.test.ts` to test the inline logic in `bookAppointmentTool` directly. Option (a) is preferred — it consolidates the logic and makes the tests meaningful.

---

### CR-02: Session credit permanently lost when a rescheduled booking is subsequently cancelled

**File:** `src/conversation/function-executor.ts:303–346`
**Issue:** `rescheduleAppointmentTool` creates a new booking row but never calls `deductSession` and never inserts a `session_deducted` ledger row linking the new booking to the client's membership. This means `findMembershipByBooking(newBooking.id)` always returns `null` for a rescheduled booking.

When the client (or owner) later cancels the rescheduled booking via `cancelAppointmentTool` or `handleClientCancelCallback`, the credit-restore path is:

```typescript
const membershipId = await findMembershipByBooking(booking.id); // always null for reschedule
if (membershipId !== null) {
  await restoreCredit(...);  // never reached — session permanently lost
}
```

Concrete scenario:
- Client has 5 sessions; books appointment A → 4 sessions remain (deduction ledger: booking A).
- Client reschedules to appointment B → owner approves → booking A cancelled (no credit restore; correct), booking B confirmed (no deduction ledger).
- Client cancels booking B → `findMembershipByBooking(B)` = null → no restore → 4 sessions remain.
- Expected: 5 sessions (client cancelled their appointment entirely).

This is a data integrity bug: clients permanently lose paid sessions after reschedule + cancel.

**Fix:** In `rescheduleAppointmentTool`, propagate the original booking's membership link to the new booking by inserting a `session_deducted` ledger row for `newBooking.id`, mirroring the original booking's deduction (if one existed). Alternatively, when cancelling the original booking during reschedule approval in `handleCallbackQuery`, look up whether the original had a deduction and—only if so—insert a `session_deducted` row for the new booking before approving, so the cancel-restore path works normally.

The simplest fix is in `rescheduleAppointmentTool` immediately after `insertBooking` succeeds:

```typescript
if (newBooking) {
  // Propagate session link: find original booking's deduction ledger row
  const originalMembershipId = await findMembershipByBooking(original.id);
  if (originalMembershipId !== null) {
    // New booking inherits the membership association so cancel-restore works
    await getConn()
      .insert(membershipLedger)
      .values({
        membershipId: originalMembershipId,
        operationType: 'session_deducted',
        sessionsDeducted: 0,            // counter already decremented on original booking
        bookingId: newBooking.id,
        idempotencyKey: 'booking:' + newBooking.id + ':deduction',
        reason: 'Reschedule link — no new counter change',
      })
      .onConflictDoNothing();
  }
  // ... alert owner ...
}
```

Note: `sessionsDeducted: 0` signals that the counter was not touched again; the important outcome is that `findMembershipByBooking(newBooking.id)` now returns the membershipId so future cancel-restore works.

## Warnings

### WR-01: Redundant dual unique constraint on `membership_ledger.idempotency_key`

**File:** `src/database/schema.ts:319–326`
**Issue:** The `membershipLedger` table defines uniqueness on `idempotencyKey` twice: once via `.unique()` on the column definition (line 320) which Drizzle translates to an inline `UNIQUE` constraint, and once via `uniqueIndex('unique_ledger_idempotency')` in the table-level index array (line 325). PostgreSQL creates two separate unique structures on the same column, wasting storage and creating double uniqueness enforcement overhead on every INSERT.

**Fix:** Remove the redundant `uniqueIndex`. The column-level `.unique()` is sufficient and already provides an implicit index for query performance:

```typescript
// Keep only the column-level constraint:
idempotencyKey: text('idempotency_key').notNull().unique(),

// Remove from table-level array:
// (table) => [
//   uniqueIndex('unique_ledger_idempotency').on(table.idempotencyKey),  // DELETE THIS
// ]
```

If a named index is needed for operational clarity (e.g., to DROP it by name), add only the `uniqueIndex` and remove `.unique()` from the column.

---

### WR-02: `deductSession` UPDATE lacks a `sessionsRemaining > 0` guard

**File:** `src/billing/queries.ts:446–449`
**Issue:** The counter decrement in `deductSession` has no WHERE-clause guard against going negative:

```typescript
await getConn()
  .update(memberships)
  .set({ sessionsRemaining: sql`${memberships.sessionsRemaining} - 1` })
  .where(eq(memberships.id, membershipId));   // no > 0 guard
```

In the current call chain this is protected by the SELECT FOR UPDATE in `getActiveMembershipForDeduction` (which serialises concurrent transactions) and the caller's `sessionsRemaining > 0` check in `bookAppointmentTool`. However, `deductSession` is a public export and any future caller that omits the capacity check would drive `sessionsRemaining` to -1 silently.

**Fix:** Add a defensive guard to the UPDATE:

```typescript
.where(
  and(
    eq(memberships.id, membershipId),
    gt(memberships.sessionsRemaining, 0)   // DB-level safety net
  )
)
```

Log a warning if `inserted.length > 0` but the UPDATE affected 0 rows (should be impossible, indicates logic bug in caller).

---

### WR-03: `activatePackage` and `cancelPendingPackage` lack `businessId` scope and bypass RLS

**File:** `src/billing/queries.ts:98–115`
**Issue:** Both functions use the admin `db` connection (bypassing RLS) and neither accepts a `businessId` parameter:

```typescript
export async function activatePackage(packageId: number): Promise<boolean> {
  const rows = await db.update(billingPackages)
    .set({ isActive: true })
    .where(and(eq(billingPackages.id, packageId), eq(billingPackages.isActive, false)))
    // no businessId filter
```

If an attacker crafts a `billing:pkg_confirm:<foreignPackageId>` callback_query, they could activate a package belonging to another business — provided `handleConfirmPackage` in `payment-flow.ts` does not independently verify ownership before calling `activatePackage`. The same applies to `cancelPendingPackage`. `deactivatePackage` correctly requires `businessId` in its WHERE clause; this pair should match that pattern.

**Fix:** Add `businessId` parameters and a corresponding WHERE clause to both functions, and switch to `getConn()` so they participate in the caller's `withBusinessContext` transaction:

```typescript
export async function activatePackage(businessId: number, packageId: number): Promise<boolean> {
  const rows = await getConn()
    .update(billingPackages)
    .set({ isActive: true })
    .where(
      and(
        eq(billingPackages.id, packageId),
        eq(billingPackages.businessId, businessId),   // ownership guard
        eq(billingPackages.isActive, false)
      )
    )
    .returning({ id: billingPackages.id });
  return rows.length > 0;
}
```

Update callers in `payment-flow.ts` to pass `businessId` through.

---

### WR-04: `handleDeactivatePackage` returns a success message when 0 rows are updated

**File:** `src/billing/tools.ts:129–137`
**Issue:** `deactivatePackage` issues an `UPDATE ... WHERE id = $packageId AND businessId = $businessId` but returns no error when 0 rows match (wrong ID, already deactivated, or cross-tenant hallucination). `handleDeactivatePackage` always returns `'Το πακέτο απενεργοποιήθηκε.'` regardless:

```typescript
await deactivatePackage(businessId, packageId);
return 'Το πακέτο απενεργοποιήθηκε. Υπάρχουσες συνδρομές δεν επηρεάζονται.';
// Returns success even when nothing happened
```

The owner receives a false confirmation. In the case of a Gemini-hallucinated `package_id`, this silently discards the intent without any feedback.

**Fix:** Have `deactivatePackage` return a boolean (like `activatePackage`) indicating whether a row was actually updated, and check it in the handler:

```typescript
// billing/queries.ts
export async function deactivatePackage(businessId: number, packageId: number): Promise<boolean> {
  const rows = await getConn()
    .update(billingPackages).set({ isActive: false })
    .where(and(eq(billingPackages.id, packageId), eq(billingPackages.businessId, businessId)))
    .returning({ id: billingPackages.id });
  return rows.length > 0;
}

// billing/tools.ts
const deactivated = await deactivatePackage(businessId, packageId);
if (!deactivated) {
  return 'Δεν βρέθηκε ενεργό πακέτο με αυτό το ID.';
}
return 'Το πακέτο απενεργοποιήθηκε. Υπάρχουσες συνδρομές δεν επηρεάζονται.';
```

---

### WR-05: DST offset hardcoded as `+02:00` (Athens winter) in expiry calculations

**File:** `src/billing/queries.ts:266` and `src/billing/queries.ts:614`
**Issue:** Two places compute an end-of-day Athens timestamp using a hardcoded `+02:00` offset:

```typescript
// createMembership
const expiresAt = new Date(`${expiresAtDate}T23:59:59+02:00`);

// findMembershipsExpiringIn7Days
const windowEnd = new Date(`${sevenDaysFromNowIso}T23:59:59+02:00`);
```

Athens observes UTC+3 during summer DST (last Sunday March – last Sunday October). During that period, `T23:59:59+02:00` resolves to `00:59:59 the next Athens calendar day`, not end-of-day. A membership created in July that should expire at end of August 14 actually expires at 00:59:59 on August 15 (Athens local), giving clients an unintended 1-hour extension. The expiry sweep window has the same drift, causing notifications to fire slightly too early or too late relative to the actual Athens calendar boundary.

The code comments acknowledge this as "acceptable", but it is a correctness issue when the offset matters (e.g., multi-day grace period policies, GDPR data retention windows). The same `addCalendarDays` + `isoDateInAthens` utilities are already in scope; they should be paired with a DST-aware end-of-day computation.

**Fix:** Use `Intl.DateTimeFormat` or the `date-fns-tz` pattern to resolve the correct Athens offset at runtime instead of hardcoding:

```typescript
// Returns "T23:59:59+HH:MM" for the Athens offset on the given date
function athensEndOfDay(isoDate: string): Date {
  // Create a date at midnight Athens local, then offset to 23:59:59 same day
  const tzFormatter = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Athens', timeZoneName: 'shortOffset',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  // ... resolve offset, build timestamp
  // Simplest: use a known Athens-midnight UTC then add 23h59m59s
}
```

Or continue using the hardcoded `+02:00` offset but document that the effective Athens "business day" boundary during summer is 00:59:59 the next calendar day, and confirm this is acceptable for all consuming code.

## Info

### IN-01: `ToolContext.business.enforcementPolicy` typed optional but `Business` interface makes it required

**File:** `src/conversation/function-executor.ts:24`
**Issue:** `ToolContext.business` is typed as `{ id: number; name: string; ownerTelegramId: string | null; enforcementPolicy?: string }` (optional). The `Business` interface in `database/queries.ts` has `enforcementPolicy: string` (non-optional, NOT NULL DEFAULT 'allow'). The mismatch means callers must handle `undefined` with `?? 'allow'`, which they do, but it hides the fact that the field is always present in practice.

**Fix:** Remove the `?` from `enforcementPolicy` in the `ToolContext.business` inline type to match the `Business` interface, or reuse `Pick<Business, 'id' | 'name' | 'ownerTelegramId' | 'enforcementPolicy'>` for the type.

---

### IN-02: `view_client_membership` silently falls back to empty string for missing `client_phone`

**File:** `src/onboarding/ai-owner-agent.ts:453`
**Issue:**

```typescript
const clientPhone = String(args.client_phone ?? '');
```

If Gemini omits `client_phone` or passes null, `clientPhone` becomes `''`. `handleViewClientMembership` queries with `senderPhone = ''`, finds no match, and returns the Greek "not found" message — indistinguishable from a legitimate lookup on a phone with no membership. The owner has no indication that the tool was called with an invalid argument.

**Fix:** Return an explicit error string when `client_phone` is empty or missing:

```typescript
const clientPhone = String(args.client_phone ?? '');
if (!clientPhone) {
  return 'Σφάλμα: το τηλέφωνο πελάτη είναι υποχρεωτικό.';
}
```

---

_Reviewed: 2026-07-21T10:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
