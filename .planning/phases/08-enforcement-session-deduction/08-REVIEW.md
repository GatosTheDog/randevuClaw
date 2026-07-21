---
phase: 08-enforcement-session-deduction
reviewed: 2026-07-21T14:30:00Z
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
  warning: 7
  info: 2
  total: 11
status: issues_found
---

# Phase 08: Code Review Report

**Reviewed:** 2026-07-21T14:30:00Z
**Depth:** standard
**Files Reviewed:** 28
**Status:** issues_found

## Summary

Phase 8 adds enforcement policy checks (block/flag/allow), session deduction on booking, and credit restore on cancellation. The core machinery in `billing/queries.ts` — SELECT FOR UPDATE serialisation, ledger idempotency via onConflictDoNothing, and credit restore expiry guard — is well-designed and matches the documented RESEARCH.md pitfalls list.

Two BLOCKER defects were identified:

1. `src/billing/enforcement.ts` was written as an extractable pure function but was never wired into `function-executor.ts`. The production booking path is a separate inline re-implementation. `booking-enforcement.test.ts` therefore tests dead code under the ENFC-02/ENFC-03 labels, providing false coverage.

2. `rescheduleAppointmentTool` does not record a `session_deducted` ledger entry for the newly inserted booking. As a result, `findMembershipByBooking` returns null for any rescheduled appointment, and subsequent cancellation of that appointment silently skips credit restore — permanently forfeiting the client's paid session.

Seven warnings cover: a ghost-booking window when the flag-policy Telegram alert fails (unique to this review), redundant dual unique constraint on the ledger idempotency key, a missing DB-level guard in the deduction UPDATE, RLS bypass in package lifecycle operations, a misleading success reply on zero-row deactivation, a hardcoded DST offset, and an incomplete test mock for the enforcement policy tool.

## Critical Issues

### CR-01: `enforcement.ts` is dead code — ENFC-02/ENFC-03 tests validate the wrong code path

**File:** `src/billing/enforcement.ts:41`
**Issue:** `checkEnforcementAndGetMembership` is exported from `src/billing/enforcement.ts` but is never imported or called by any production module. Confirmed by tracing all imports across every reviewed source file. The actual booking enforcement logic lives as a separate inline re-implementation inside `bookAppointmentTool` in `function-executor.ts` (lines 179–196), which reads `context.business.enforcementPolicy` from the already-fetched business object and calls `getActiveMembershipForDeduction` directly.

The two implementations differ in one important way: `enforcement.ts` re-fetches the policy from the DB via `getBusinessEnforcementPolicy`, while `bookAppointmentTool` reads it from the in-memory business object. These are separate code paths.

Consequence: `tests/booking-enforcement.test.ts` (tagged ENFC-02/ENFC-03) imports `checkEnforcementAndGetMembership` and exercises a function that can never be reached in production. If the inline logic in `function-executor.ts` has a regression — wrong boolean, missing policy case — these tests will not catch it. The ENFC-02/ENFC-03 requirements lack meaningful test coverage of the actual production path.

**Fix:** Wire `checkEnforcementAndGetMembership` into `bookAppointmentTool` as originally intended:

```typescript
// function-executor.ts
import { checkEnforcementAndGetMembership } from '../billing/enforcement';

// Replace lines 179-215 inline block with:
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
const membership = enfResult.membership; // reuse; no second DB fetch
if (enfResult.shouldAlert && context.business.ownerTelegramId) {
  const clientName = await getClientName(context.business.id, context.clientPhone);
  const flagText = /* build from clientName, service, booking */ '...';
  // wrap in try/catch — see WR-01 below
  try {
    await sendTelegramMessage(context.business.ownerTelegramId, flagText);
  } catch (err) {
    logger.error({ err }, 'Flag alert failed (best-effort)');
  }
}
```

Alternatively, delete `enforcement.ts` and update `booking-enforcement.test.ts` to test the inline logic through `executeTool` directly (as the Phase 8 tests in `function-executor.test.ts` already partially do). Option A is preferred — it consolidates the logic, makes tests meaningful, and eliminates the extra DB round-trip in `bookAppointmentTool` (the policy is already in memory).

---

### CR-02: Session credit permanently lost when a rescheduled booking is subsequently cancelled

**File:** `src/conversation/function-executor.ts:303–346`
**Issue:** `rescheduleAppointmentTool` inserts a new booking row but never calls `deductSession` and never inserts a `session_deducted` ledger entry linking the new booking to the client's membership. As a result, `findMembershipByBooking(newBooking.id)` always returns `null` for a rescheduled appointment.

When the client (or owner) later cancels the rescheduled booking via `cancelAppointmentTool` or `handleClientCancelCallback`, the credit-restore path is:

```typescript
const membershipId = await findMembershipByBooking(booking.id); // always null for rescheduled bookings
if (membershipId !== null) {
  await restoreCredit(...);  // never reached — session permanently lost
}
```

Concrete scenario:
- Client has 5 sessions; books appointment A → 4 sessions remain (session_deducted ledger: booking A).
- Client reschedules to appointment B → new booking B created, NO ledger entry for B.
- Client cancels booking B → `findMembershipByBooking(B)` = null → credit restore skipped → 4 sessions remain.
- Expected: 5 sessions restored (client cancelled the rescheduled appointment before attending).

This is a data integrity bug: clients permanently lose paid sessions after reschedule + cancel. Note that the credit IS correctly restored if the original booking A is cancelled (before the reschedule is approved) because A has a ledger entry. The lost credit is specifically tied to the new booking B having no ledger link.

**Fix:** In `rescheduleAppointmentTool`, after `insertBooking` succeeds, propagate the original booking's membership link to the new booking by inserting a `session_deducted` ledger row with `sessionsDeducted: 0` (the counter was already decremented on the original booking; this insert only establishes the link so future cancel-restore works):

```typescript
if (newBooking) {
  // Propagate membership link so cancel-restore works for the rescheduled booking
  const originalMembershipId = await findMembershipByBooking(original.id);
  if (originalMembershipId !== null) {
    await getConn()
      .insert(membershipLedger)
      .values({
        membershipId: originalMembershipId,
        operationType: 'session_deducted',
        sessionsDeducted: 0,            // no counter change; link only
        bookingId: newBooking.id,
        idempotencyKey: 'booking:' + newBooking.id + ':deduction',
        reason: 'Reschedule link — counter unchanged from original booking',
      })
      .onConflictDoNothing();
  }
  // ... alertOwnerNewBooking ...
}
```

Add a corresponding test to `tests/enforcement-session-deduction.test.ts` or `tests/function-executor.test.ts` covering the reschedule → cancel → credit restore path.

## Warnings

### WR-01: Flag alert `sendTelegramMessage` not wrapped in try/catch — Telegram failure commits a ghost booking

**File:** `src/conversation/function-executor.ts:215–226`
**Issue:** The ENFC-03 flag alert (line 226) is explicitly left outside a try/catch block with the comment "NOT in try/catch (critical)". However, this creates an inconsistency with the pattern used for every other Telegram send in the same function:

```typescript
// Flag alert — NOT in try/catch (can propagate)
if (enforcementPolicy === 'flag' && noValidMembership && context.business.ownerTelegramId) {
  await sendTelegramMessage(context.business.ownerTelegramId, flagText); // throws → propagates
}

// ...
// Owner alert — correctly wrapped (CR-03c in existing comments)
try {
  await alertOwnerNewBooking(booking, service, context.business);
} catch (err) {
  logger.error({ err, bookingId: booking.id }, 'Booking created but owner alert failed');
}
```

Call chain when `sendTelegramMessage` throws:
1. Exception propagates out of `bookAppointmentTool`.
2. `executeTool`'s outer try/catch (lines 102–106) catches it and returns `{ error: "network error" }`.
3. `executeTool` returns normally — no exception reaches `withBusinessContext`.
4. `withBusinessContext` callback completes and **commits** the transaction, including the `insertBooking` INSERT.
5. Gemini receives `{ error: ... }` and generates an error response to the client.
6. The client is told the booking failed. The Telegram update is marked as processed.

Result: a committed `pending_owner_approval` booking that the client does not know exists. The slot is blocked. If the owner approves it, the client receives a confirmation for a booking they believe never happened. The ghost booking can only be cleaned up manually or via the expiry poller (2 hours later).

This inconsistency is especially notable because `alertOwnerNewBooking` — which fires immediately after — IS correctly wrapped in try/catch for the same reason (see existing comments referencing CR-03b/CR-03c).

**Fix:** Wrap the flag alert in try/catch, matching the pattern used for `alertOwnerNewBooking`:

```typescript
if (enforcementPolicy === 'flag' && noValidMembership && context.business.ownerTelegramId) {
  try {
    await sendTelegramMessage(context.business.ownerTelegramId, flagText);
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'Flag alert failed (best-effort); booking committed');
  }
}
```

The flag alert is a notification, not a gate. Failing to deliver it should not invalidate a booking that is already in the database.

---

### WR-02: Redundant dual unique constraint on `membership_ledger.idempotency_key`

**File:** `src/database/schema.ts:319–326`
**Issue:** The `membershipLedger` table declares uniqueness on `idempotencyKey` twice:

```typescript
// Line 320: inline UNIQUE constraint (Drizzle generates an implicit PG constraint)
idempotencyKey: text('idempotency_key').notNull().unique(),

// Lines 323-325: explicit named unique index — second constraint on same column
(table) => [
  uniqueIndex('unique_ledger_idempotency').on(table.idempotencyKey),
]
```

PostgreSQL creates two separate unique structures from this definition. Every INSERT into `membership_ledger` must satisfy both, and both consume storage and index maintenance overhead. The inline `.unique()` already creates an implicit index for query performance, so the explicit `uniqueIndex` provides no additional benefit.

**Fix:** Remove the redundant `uniqueIndex` from the table-level array and keep only the column-level `.unique()`. If a named index is required for operational purposes (e.g., dropping by name), remove `.unique()` and keep only the named `uniqueIndex`.

---

### WR-03: `deductSession` UPDATE lacks a DB-level guard against going negative

**File:** `src/billing/queries.ts:446–449`
**Issue:** The counter decrement in step 3 of `deductSession` issues an unconditional `sessionsRemaining - 1` with no WHERE clause guard on the current value:

```typescript
await getConn()
  .update(memberships)
  .set({ sessionsRemaining: sql`${memberships.sessionsRemaining} - 1` })
  .where(eq(memberships.id, membershipId));   // no sessionsRemaining > 0 guard
```

The current call chain is safe because `getActiveMembershipForDeduction` holds a SELECT FOR UPDATE lock and `bookAppointmentTool` verifies `sessionsRemaining > 0` before calling `deductSession`. However, `deductSession` is a public export. Any future caller that omits the capacity check would drive `sessionsRemaining` to -1 silently. The ledger idempotency key prevents double-insert of the same booking, but a different booking ID would bypass it entirely.

**Fix:** Add a database-level guard to the UPDATE:

```typescript
.where(
  and(
    eq(memberships.id, membershipId),
    gt(memberships.sessionsRemaining, 0)   // prevents counter going below zero at DB level
  )
)
```

Optionally log a warning when `inserted.length > 0` but the UPDATE affects zero rows — this signals a logic error in the caller that the caller's capacity check should have caught.

---

### WR-04: `activatePackage` and `cancelPendingPackage` lack `businessId` scope and bypass RLS

**File:** `src/billing/queries.ts:98–115`
**Issue:** Both functions use the admin `db` connection (bypassing RLS) and accept only `packageId` — no `businessId` parameter:

```typescript
export async function activatePackage(packageId: number): Promise<boolean> {
  const rows = await db.update(billingPackages)
    .set({ isActive: true })
    .where(and(eq(billingPackages.id, packageId), eq(billingPackages.isActive, false)))
    // no businessId ownership guard
```

If a crafted `billing:pkg_confirm:<foreignPackageId>` callback_query reaches `handleConfirmPackage` in `payment-flow.ts` before ownership is independently validated, or if ownership validation in `payment-flow.ts` is incomplete, an attacker could activate a package belonging to another business. The same applies to `cancelPendingPackage`. By contrast, `deactivatePackage` correctly requires `businessId` in its WHERE clause and uses `getConn()` — these two functions should match that pattern.

**Fix:** Add a `businessId` parameter and WHERE clause to both functions, and switch to `getConn()`:

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

Update callers in `payment-flow.ts` to pass `businessId` (which is already derived from the authenticated `senderTelegramId` at the call site in `telegram.ts`).

---

### WR-05: `handleDeactivatePackage` returns a Greek success message when zero rows are updated

**File:** `src/billing/tools.ts:129–137`
**Issue:** `deactivatePackage` issues an `UPDATE ... WHERE id = $packageId AND businessId = $businessId` but returns `void` without indicating whether any row was actually updated. `handleDeactivatePackage` unconditionally returns the success message:

```typescript
await deactivatePackage(businessId, packageId);
return 'Το πακέτο απενεργοποιήθηκε. Υπάρχουσες συνδρομές δεν επηρεάζονται.';
// Returns success even when packageId was wrong, not found, or already inactive
```

The owner receives a false confirmation. If Gemini hallucinates a `package_id` value that does not exist for this business, the intent is silently discarded with no actionable feedback. The analogous function `activatePackage` already returns `boolean` — `deactivatePackage` should match.

**Fix:** Change `deactivatePackage` to return `boolean` and check it:

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

### WR-06: DST offset hardcoded as `+02:00` (Athens winter) in expiry boundary calculations

**File:** `src/billing/queries.ts:266` and `src/billing/queries.ts:614`
**Issue:** Two places compute end-of-day Athens timestamps using a hardcoded winter offset:

```typescript
// createMembership (line 266)
const expiresAt = new Date(`${expiresAtDate}T23:59:59+02:00`);

// findMembershipsExpiringIn7Days (line 614)
const windowEnd = new Date(`${sevenDaysFromNowIso}T23:59:59+02:00`);
```

Athens observes UTC+3 during summer DST (last Sunday March to last Sunday October). During this period, `T23:59:59+02:00` resolves to `00:59:59 the following Athens calendar day` rather than end-of-current-day. A membership created in July with an expiry date of August 14 is stored with `expiresAt = 2026-08-14T21:59:59Z` (UTC+2) when the correct Athens end-of-day is `2026-08-14T20:59:59Z` (UTC+3). The 7-day expiry sweep window inherits the same drift, causing notifications to fire up to 1 hour too early or too late relative to the actual Athens calendar boundary.

The code comments acknowledge this as "acceptable" for the expiry field, but the notification window drift can trigger duplicate sweeps (a membership expiring at 21:59:59 UTC might be included in two consecutive daily sweeps run at 20:00 UTC if the sweep window overlaps).

**Fix:** Resolve the offset dynamically:

```typescript
function athensEndOfDayUTC(isoDate: string): Date {
  // Build end-of-day in Athens local time using the correct DST-aware offset
  const athensFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Athens',
    timeZoneName: 'shortOffset',
  });
  // Simple approach: parse as midnight UTC, add 23h59m59s, then adjust
  // Better: use a known 23:59:59 local-time constructor
  const localMidnight = new Date(`${isoDate}T00:00:00`);
  const offsetMs = localMidnight.getTime() -
    new Date(localMidnight.toLocaleString('en-US', { timeZone: 'Europe/Athens' })).getTime();
  return new Date(new Date(`${isoDate}T23:59:59Z`).getTime() + offsetMs);
}
```

Or, at minimum, document the +02:00 assumption as a known limitation that over-grants ~1 hour during summer and confirm that all downstream consumers (expiry poller, cancel guard in `restoreCredit`) treat this as tolerable.

---

### WR-07: `billing-package-creation.test.ts` mock of `../src/billing/tools` omits `handleSetEnforcementPolicy`

**File:** `tests/billing-package-creation.test.ts:27–42`
**Issue:** The mock factory for `../src/billing/tools` registers only four handlers:

```typescript
jest.mock('../src/billing/tools', () => ({
  handleCreatePackage: jest.fn(),
  handleListPackages: jest.fn().mockResolvedValue(''),
  handleDeactivatePackage: jest.fn().mockResolvedValue(''),
  handleViewClientMembership: jest.fn().mockResolvedValue(''),
  // handleSetEnforcementPolicy: MISSING
}));
```

`ai-owner-agent.ts` imports `handleSetEnforcementPolicy` at the module level alongside the other handlers (line 25). When this mock factory replaces the module, `handleSetEnforcementPolicy` is `undefined`. Any test in this file that triggers the `set_enforcement_policy` path through `aiOwnerAgent` (e.g., a Gemini response that calls `set_enforcement_policy`) will throw `TypeError: handleSetEnforcementPolicy is not a function` with a confusing stack trace.

None of the current tests exercise this path, so tests pass today. But the gap silently breaks the test isolation contract and will cause misleading failures when test coverage is extended.

**Fix:** Add `handleSetEnforcementPolicy` to the mock:

```typescript
jest.mock('../src/billing/tools', () => ({
  handleCreatePackage: jest.fn(),
  handleListPackages: jest.fn().mockResolvedValue(''),
  handleDeactivatePackage: jest.fn().mockResolvedValue(''),
  handleViewClientMembership: jest.fn().mockResolvedValue(''),
  handleSetEnforcementPolicy: jest.fn().mockResolvedValue(''),   // ADD THIS
}));
```

## Info

### IN-01: `ToolContext.business.enforcementPolicy` typed optional but `Business` makes it required

**File:** `src/conversation/function-executor.ts:24`
**Issue:** The inline business type in `ToolContext` declares `enforcementPolicy` as optional:

```typescript
business: { id: number; name: string; ownerTelegramId: string | null; enforcementPolicy?: string }
```

The `Business` interface in `database/queries.ts` declares `enforcementPolicy: string` (non-optional, backed by a NOT NULL DEFAULT 'allow' column). The mismatch is harmless at runtime (the `?? 'allow'` fallback in `bookAppointmentTool` handles undefined), but it weakens the type contract and requires a defensive fallback that is never actually needed.

**Fix:** Either remove the `?` from the inline type, or replace the inline type with `Pick<Business, 'id' | 'name' | 'ownerTelegramId' | 'enforcementPolicy'>` to keep it in sync with the database interface automatically.

---

### IN-02: `view_client_membership` silently returns "not found" when `client_phone` is empty

**File:** `src/onboarding/ai-owner-agent.ts:453`
**Issue:**

```typescript
const clientPhone = String(args.client_phone ?? '');
```

If Gemini omits `client_phone` or passes null, `clientPhone` becomes `''`. `handleViewClientMembership` queries with `senderPhone = ''`, finds no match, and returns the Greek "no active membership" message — indistinguishable from a legitimate lookup on a client who has no membership. The owner has no indication that the tool was called with a missing or empty argument.

**Fix:** Return an explicit error when `client_phone` is empty or missing:

```typescript
const clientPhone = String(args.client_phone ?? '');
if (!clientPhone) {
  return 'Σφάλμα: το τηλέφωνο πελάτη είναι υποχρεωτικό για αυτή την ενέργεια.';
}
```

---

_Reviewed: 2026-07-21T14:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
