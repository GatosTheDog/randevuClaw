---
phase: 08-enforcement-session-deduction
reviewed: 2026-07-20T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - migrations/0007_enforcement_policy.sql
  - src/billing/queries.ts
  - src/billing/tools.ts
  - src/conversation/function-executor.ts
  - src/database/queries.ts
  - src/database/schema.ts
  - src/onboarding/ai-owner-agent.ts
  - src/webhooks/telegram.ts
  - tests/billing-enforcement-policy.test.ts
  - tests/billing-session-deduction.test.ts
  - tests/function-executor.test.ts
  - tests/telegram-webhook.test.ts
findings:
  critical: 4
  warning: 4
  info: 2
  total: 10
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-07-20
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Phase 8 adds enforcement-policy enforcement (`block` / `flag` / `allow`) and session-deduction / credit-restore mechanics across the booking flow. The migration and schema additions are clean. The Zod validation layer and idempotency key design are solid. Four correctness bugs were found that would cause silent data corruption or complete feature failure in production: a non-existent Gemini model ID, a reversed argument order in a service lookup, a timezone-mangling trick that inflates the current timestamp by 2–3 hours (causing incorrect credit-restore denials), and a missing lower-bound check that allows session counters to go negative. Four additional warnings cover multi-tenant isolation gaps and missing error handling in the owner AI loop.

---

## Critical Issues

### CR-01: Non-existent Gemini model identifier — all owner AI calls fail at runtime

**File:** `src/onboarding/ai-owner-agent.ts:29`
**Issue:** `GEMINI_MODEL = 'gemini-3.1-flash-lite'` is not a valid Gemini model ID. Google's versioning scheme produces names like `gemini-2.5-flash-lite`, `gemini-2.0-flash`, etc. "3.1" does not exist. Every call to `ai.interactions.create` for the owner agent will receive a model-not-found error from the Gemini API, making the entire owner management agent non-functional in production.
**Fix:**
```typescript
const GEMINI_MODEL = 'gemini-2.5-flash-lite';
```
CLAUDE.md lists "Gemini 2.5 Flash-Lite" as the target model; use the correct identifier.

---

### CR-02: Swapped arguments in `findServiceById` inside `view_todays_schedule` — service names never resolved

**File:** `src/onboarding/ai-owner-agent.ts:375`
**Issue:** The call is `findServiceById(b.serviceId, business.id)` but the function signature is `findServiceById(businessId: number, serviceId: number)` (see `src/database/queries.ts:280-282`). The arguments are reversed: the service's numeric ID is passed as `businessId` and the business's numeric ID is passed as `serviceId`. The WHERE clause evaluates `services.businessId = b.serviceId AND services.id = business.id`, which will almost never match a real row. Every booking in the schedule view falls back to `υπηρεσία #N` instead of showing the actual service name.
**Fix:**
```typescript
// line 375 — swap the arguments:
const svc = await findServiceById(business.id, b.serviceId).catch(() => null);
```

---

### CR-03: `restoreCredit` timezone-mangling inflates current timestamp by 2–3 hours — valid memberships incorrectly denied credit restores

**File:** `src/billing/queries.ts:479-481`
**Issue:** The SESS-03 expiry guard uses:
```typescript
const nowAthens = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Athens' }));
if (membership.expiresAt < nowAthens) return;
```
`toLocaleString` produces a locale-formatted string such as `"7/20/2026, 1:00:00 PM"`. Passing that to `new Date()` makes V8 parse it as **server-local time** (UTC in production), not Athens time. The result is a `Date` whose `.getTime()` is UTC+2 or UTC+3 hours ahead of the actual current moment. The comparison then flags memberships as expired up to 3 hours (summer DST) before they actually expire.

Concrete example (summer, UTC+3): real time = 10:00 UTC. `nowAthens` = 13:00 UTC. A membership that expires at 11:30 UTC (still valid) satisfies `11:30 < 13:00 = true` → credit restore is silently skipped.

`membership.expiresAt` is a `TIMESTAMP WITH TIME ZONE` returned by PostgreSQL as a UTC-epoch `Date`; comparing against `new Date()` is all that is needed.
**Fix:**
```typescript
// Replace lines 479-481 with:
if (membership.expiresAt < new Date()) return;
```

---

### CR-04: `sessionsRemaining === 0` triggers deduction, driving the counter negative; enforcement checks ignore exhausted memberships

**File:** `src/conversation/function-executor.ts:168-215`
**Issue:** Two related defects share the same root cause — `getActiveMembershipForDeduction` returns an active, non-expired membership regardless of whether `sessionsRemaining` is 0 (session pack exhausted):

1. **Enforcement check ignores 0-session memberships** (line 171): `if (enforcementPolicy === 'block' && membership === null)`. When `sessionsRemaining = 0`, `membership` is not null, so the block policy never fires. Clients with an exhausted pack are allowed to book under `block` mode.

2. **Deduction drives the counter negative** (line 213): `if (membership !== null && membership.sessionsRemaining !== null)` evaluates true when `sessionsRemaining = 0`. `deductSession` then decrements 0 → -1, corrupting the `memberships` row with a negative session count.

**Fix — `function-executor.ts`:**
```typescript
// Introduce a helper to decide if a membership is "functionally active"
const hasSessions = (m: ActiveMembershipForDeduction) =>
  m.sessionsRemaining === null || m.sessionsRemaining > 0;

// Line 171 — update the enforcement pre-check
const noActiveMembership = membership === null || !hasSessions(membership);
if (enforcementPolicy === 'block' && noActiveMembership) {
  return { success: false, error: 'no_membership', message: '...' };
}

// Line ~198 — update the flag-alert check
if (enforcementPolicy === 'flag' && noActiveMembership && context.business.ownerTelegramId) { ... }

// Line 213 — update the deduction guard
if (membership !== null && membership.sessionsRemaining !== null && membership.sessionsRemaining > 0) {
  await deductSession(membership.id, booking.id, 'booking:' + booking.id + ':deduction');
}
```

---

## Warnings

### WR-01: `deactivate_package` bypasses RLS — prompt injection can deactivate packages from other businesses

**File:** `src/onboarding/ai-owner-agent.ts:414-416`
**Issue:** The `deactivate_package` case calls `handleDeactivatePackage(Number(args.package_id))` without wrapping in `withBusinessContext`. `handleDeactivatePackage` calls `deactivatePackage` in `billing/queries.ts:132-137`, which uses the raw `db` admin connection and has no ownership predicate — it updates `billingPackages` by `id` alone. Every other owner-agent billing case that mutates data (`list_packages`, `view_client_membership`, `set_enforcement_policy`) wraps in `withBusinessContext`. A prompt-injection attack that coerces Gemini into calling `deactivate_package` with a package ID from another tenant would silently succeed.
**Fix:**
```typescript
case 'deactivate_package': {
  return withBusinessContext(business.id, () =>
    handleDeactivatePackage(Number(args.package_id))
  );
}
```
Additionally, `deactivatePackage` in `billing/queries.ts` should be updated to accept `businessId` and add `eq(billingPackages.businessId, businessId)` to its WHERE clause for defense-in-depth.

---

### WR-02: `executeOwnerTool` has no error handling — DB errors from tool cases surface as silent failures with no owner feedback

**File:** `src/onboarding/ai-owner-agent.ts:301-448`
**Issue:** `executeOwnerTool` is a plain `async function` that directly `await`s DB calls (`db.insert`, `db.update`, `db.delete`) inside each `case` without any `try/catch`. If a DB call throws (e.g., inserting a duplicate service name violates `unique_business_service`; `update_hours` fails with a constraint error), the exception propagates out of the `for (const call of functionCalls)` loop in `aiOwnerAgent`, causing the entire `aiOwnerAgent` call to throw. The caller in `handleFoundBusiness` catches the throw and logs it, but the owner receives no Telegram response at all — a completely silent failure. The billing cases (`create_package`, `record_payment`) already handle errors in their own handlers; the scheduling cases do not.
**Fix:** Wrap the `switch` body in `executeOwnerTool` with a top-level try/catch:
```typescript
async function executeOwnerTool(...): Promise<string> {
  try {
    switch (toolName) {
      case 'update_hours': { ... }
      // ...
    }
  } catch (err) {
    logger.error({ err, toolName, businessId: business.id }, 'executeOwnerTool DB error');
    return 'Σφάλμα κατά την εκτέλεση. Δοκιμάστε ξανά.';
  }
}
```

---

### WR-03: `withBusinessContext` uses `sql.raw()` with string interpolation for the RLS `SET LOCAL` — not parameterized

**File:** `src/database/queries.ts:86`
**Issue:**
```typescript
await tx.execute(sql.raw(`SET LOCAL app.current_business_id = '${Number(businessId)}'`));
```
`sql.raw()` is Drizzle's explicitly non-parameterized escape hatch. The `Number()` coercion means a non-numeric `businessId` becomes the literal string `'NaN'`, bypassing RLS for the transaction (no business would match `NaN`, so all queries return empty). While this isn't a classic SQL injection (numbers cannot contain SQL metacharacters), the pattern sets a bad precedent for the security-critical RLS configuration path. PostgreSQL supports parameterized `SET LOCAL` via the `set_config` function.
**Fix:**
```typescript
await tx.execute(
  sql`SELECT set_config('app.current_business_id', ${String(Number(businessId))}, true)`
);
```
This uses Drizzle's parameterized `sql` template tag, eliminating string interpolation.

---

### WR-04: Scheduling tool cases (`update_hours`, `close_day`, `add_service`, `update_service_price`, `delete_service`) use admin `db` connection, bypassing RLS

**File:** `src/onboarding/ai-owner-agent.ts:310-365`
**Issue:** All five scheduling tool cases directly call `db.insert`, `db.update`, or `db.delete` using the admin (superuser) `db` connection rather than `getConn()`. This bypasses the row-level security policies that the rest of the codebase enforces via `withBusinessContext`. Since `businessId` is always `business.id` (from the authenticated webhook context), the immediate risk is low — the service/hours lookups constrain the scope. However, `update_service_price` and `delete_service` look up the service in `svcList` (loaded at agent start, not re-fetched in-context) and then use `db.update/delete` with only `services.id` in the WHERE clause. If `svcList` is ever loaded from a stale context, or if Gemini hallucinates a `service_id` that doesn't match the partial-matched name, the mutation would bypass RLS silently.
**Fix:** Replace `db.insert/update/delete` with `getConn().insert/update/delete` in all five cases, and ensure these cases are called inside a `withBusinessContext` wrapping (either caller-side or by moving the `executeOwnerTool` call inside one).

---

## Info

### IN-01: `createMembership` hardcodes Athens winter offset `+02:00` for expiry timestamp; 1 hour late during DST

**File:** `src/billing/queries.ts:259`
**Issue:**
```typescript
const expiresAt = new Date(`${expiresAtDate}T23:59:59+02:00`);
```
During Greek DST (UTC+3, approximately late-March through late-October), this produces an expiry timestamp that is 1 hour past end-of-day Athens time (UTC equivalent: 21:59:59 instead of 20:59:59). The comment acknowledges this ("acceptable for an expiry field"), but it means a membership that should expire at 23:59:59 Athens summer time is stored as expiring at 00:59:59 the next UTC day, giving the client an extra hour of validity. Downstream code that compares `expiresAt` to `new Date()` would not detect the expiry until one hour into the next UTC day.
**Fix:** Compute the Athens offset dynamically using `Intl.DateTimeFormat` at runtime, or use a library like `date-fns-tz`'s `zonedTimeToUtc('...T23:59:59', 'Europe/Athens')` to produce the correct UTC offset for either summer or winter.

---

### IN-02: `today` for `view_todays_schedule` uses UTC ISO date, not Athens local date

**File:** `src/onboarding/ai-owner-agent.ts:68`
**Issue:**
```typescript
const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC; close enough for schedule view
```
An Athens owner who asks "what's my schedule" at 00:30 local time (UTC+2/+3) receives the previous UTC day's date. The `listBookingsForDate` query filters by `calendarDate = today`, so the owner sees yesterday's bookings for up to 2–3 hours each morning. The comment acknowledges this ("close enough") but the resulting UX — an owner asking for today's schedule and getting yesterday's — would be confusing.
**Fix:**
```typescript
import { isoDateInAthens } from '../utils/timezone';
const today = isoDateInAthens(new Date());
```

---

_Reviewed: 2026-07-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
