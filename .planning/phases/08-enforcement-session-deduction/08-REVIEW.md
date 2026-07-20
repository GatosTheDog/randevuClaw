---
phase: 08-enforcement-session-deduction
reviewed: 2026-07-20T00:00:00Z
depth: standard
files_reviewed: 24
files_reviewed_list:
  - migrations/0007_enforcement_policy.sql
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
  - tests/billing-session-deduction.test.ts
  - tests/calendar-poller.test.ts
  - tests/calendar-sync.test.ts
  - tests/consent.test.ts
  - tests/conversation-router.test.ts
  - tests/expiry-poller.test.ts
  - tests/function-executor.test.ts
  - tests/idempotency.test.ts
  - tests/onboarding-flow.test.ts
  - tests/onboarding-platform.test.ts
  - tests/scheduler-agenda.test.ts
  - tests/telegram-webhook.test.ts
  - tests/webhook.test.ts
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
**Files Reviewed:** 24
**Status:** issues_found

## Summary

Reviewed all 24 source and test files for Phase 8 (enforcement policy, session deduction, credit restore). The migration is correct and idempotent, the Zod validation layer is solid, and the ledger-key idempotency design is sound. Four blockers were found: both AI agents reference a non-existent Gemini model (`gemini-3.1-flash-lite`), the `view_todays_schedule` tool has its `findServiceById` arguments reversed, the `restoreCredit` expiry check constructs a timezone-offset `Date` incorrectly making it 2–3 hours fast, and `bookAppointmentTool` neither blocks nor guards deduction when `sessionsRemaining = 0`, driving the counter negative. Four warnings cover an RLS bypass in `deactivate_package`, missing try/catch in owner tool dispatch, `sql.raw` interpolation in `withBusinessContext`, and a pattern inconsistency in scheduling mutations. Two info items note a hardcoded DST offset and a UTC-vs-Athens date for the schedule view.

## Critical Issues

### CR-01: Non-existent Gemini model identifier — both AI agents fail at runtime

**File:** `src/conversation/ai-agent.ts:10` and `src/onboarding/ai-owner-agent.ts:29`

**Issue:** Both files declare:
```typescript
const GEMINI_MODEL = 'gemini-3.1-flash-lite';
```
No Gemini model with this identifier exists. Google's Gemini versioning uses the 2.x line (`gemini-2.5-flash-lite`, `gemini-2.0-flash`, etc.); "3.1" is not a published version. CLAUDE.md explicitly specifies "Gemini 2.5 Flash-Lite" as the target. Every call to `ai.interactions.create` returns a model-not-found error from the API. In `ai-agent.ts` this error is rethrown through `callGeminiWithRetry`, falls into the non-429 path, and propagates uncaught — crashing the booking conversation. In `ai-owner-agent.ts` it is caught by the inner try/catch and returns "Το σύστημα δεν απόκρινε." for every owner command. Both agents are completely non-functional at runtime.

**Fix:**
```typescript
// In both files — use the correct model identifier:
const GEMINI_MODEL = 'gemini-2.5-flash-lite';
// or the current preview slug if required, e.g. 'gemini-2.5-flash-lite-preview-06-17'
```

---

### CR-02: `findServiceById` arguments reversed in `view_todays_schedule` — service names never resolved

**File:** `src/onboarding/ai-owner-agent.ts:375`

**Issue:** The call is:
```typescript
const svc = await findServiceById(b.serviceId, business.id).catch(() => null);
```
But the function signature (verified at `src/database/queries.ts:280-289`) is:
```typescript
export async function findServiceById(businessId: number, serviceId: number): Promise<Service | null>
```
The arguments are reversed: `b.serviceId` is passed as `businessId` and `business.id` is passed as `serviceId`. The generated WHERE clause becomes `services.business_id = b.serviceId AND services.id = business.id`. With typical IDs (business=1, service=5), the query looks for a service where `business_id = 5` AND `id = 1`, which never matches a real row. The `.catch(() => null)` silently masks the failure, causing every appointment in the schedule view to fall back to `υπηρεσία #${b.serviceId}` instead of the actual service name.

**Fix:**
```typescript
// line 375 — swap the two arguments:
const svc = await findServiceById(business.id, b.serviceId).catch(() => null);
```

---

### CR-03: `restoreCredit` expiry check inflates current timestamp by 2–3 hours — valid memberships denied credit restore

**File:** `src/billing/queries.ts:480-481`

**Issue:**
```typescript
const nowAthens = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Athens' }));
if (membership.expiresAt < nowAthens) return;
```
`toLocaleString` with a `timeZone` option produces a locale-formatted string such as `"7/20/2026, 1:00:00 PM"` representing Athens wall-clock time. When V8/Node.js parses that string via `new Date(...)`, it treats the digits as server-local time (UTC on fly.io), not as Athens time. The result is a `Date` whose internal epoch is UTC+2 or UTC+3 hours ahead of the real current moment.

`membership.expiresAt` is a genuine UTC `TIMESTAMP WITH TIME ZONE` from PostgreSQL. Comparing it against an inflated `nowAthens` falsely reports memberships as expired 2 hours (winter) or 3 hours (summer DST) before they actually expire.

Concrete example in summer (UTC+3): real UTC = 10:00. `nowAthens` = `new Date("7/20/2026, 1:00:00 PM")` = 13:00 UTC. A membership expiring at `11:30 UTC` (still valid for 1.5 hours) satisfies `11:30 < 13:00` → credit restore is silently skipped. The window of incorrect denial spans the full 3 hours before actual UTC expiry each day.

`membership.expiresAt` already encodes Athens midnight as a UTC value; a plain UTC comparison is both correct and sufficient.

**Fix:**
```typescript
// Replace lines 479-481 with a direct UTC comparison:
if (membership.expiresAt < new Date()) return;
```

---

### CR-04: `sessionsRemaining === 0` passes the deduction guard, driving the counter negative; block/flag enforcement ignores exhausted packs

**File:** `src/conversation/function-executor.ts:171, 198, 213`

**Issue:** `getActiveMembershipForDeduction` (`src/billing/queries.ts:324-345`) filters only by `isActive = true` and `expiresAt > now`. It does not filter out memberships where `sessionsRemaining = 0`. A client whose session pack is exhausted will receive a non-null `membership` object with `sessionsRemaining = 0`.

This causes two related failures:

1. **Enforcement checks silently ignore exhausted packs.** Both the block guard (line 171) and the flag alert (line 198) fire only when `membership === null`. An exhausted-pack membership is not null, so neither block nor flag triggers. Under `block` mode, clients with 0 sessions remaining can book freely.

2. **Deduction drives the counter negative.** The deduction guard at line 213:
   ```typescript
   if (membership !== null && membership.sessionsRemaining !== null) {
     await deductSession(...);
   }
   ```
   `0 !== null` is `true`, so `deductSession` is called. The UPDATE in `deductSession` (`sql\`${memberships.sessionsRemaining} - 1\``) decrements `0` to `-1`, corrupting the membership row.

**Fix:**
```typescript
// Introduce a helper; apply in all three places
const hasCapacity = (m: ActiveMembershipForDeduction) =>
  m.sessionsRemaining === null || m.sessionsRemaining > 0;

// line 171 — enforcement pre-check
const noValidMembership = membership === null || !hasCapacity(membership);
if (enforcementPolicy === 'block' && noValidMembership) { ... }

// line 198 — flag alert
if (enforcementPolicy === 'flag' && noValidMembership && context.business.ownerTelegramId) { ... }

// line 213 — deduction guard
if (membership !== null && membership.sessionsRemaining !== null && membership.sessionsRemaining > 0) {
  await deductSession(membership.id, booking.id, 'booking:' + booking.id + ':deduction');
}
```

## Warnings

### WR-01: `deactivate_package` bypasses RLS — LLM hallucination can deactivate packages from other businesses

**File:** `src/onboarding/ai-owner-agent.ts:414-416`

**Issue:** The `deactivate_package` case calls `handleDeactivatePackage(Number(args.package_id))` without wrapping in `withBusinessContext`. Every other billing mutation in `executeOwnerTool` that touches per-business data uses `withBusinessContext` explicitly (see the comments on `list_packages` at line 410, `view_client_membership` at line 428, and `set_enforcement_policy` at line 441). `handleDeactivatePackage` → `deactivatePackage` uses the admin `db` connection and has only `eq(billingPackages.id, packageId)` in its WHERE clause — no `businessId` ownership check. A Gemini hallucination or prompt-injection attack that coerces the model to call `deactivate_package` with any package ID would silently deactivate packages belonging to other tenants.

**Fix:**
```typescript
case 'deactivate_package': {
  return withBusinessContext(business.id, () =>
    handleDeactivatePackage(Number(args.package_id))
  );
}
```
Additionally, `deactivatePackage` in `src/billing/queries.ts:132-137` should add a `businessId` parameter and include `eq(billingPackages.businessId, businessId)` in the WHERE clause for defense-in-depth ownership enforcement.

---

### WR-02: `executeOwnerTool` scheduling cases have no error handling — DB errors produce a silent no-reply for the owner

**File:** `src/onboarding/ai-owner-agent.ts:309-365`

**Issue:** All five scheduling tool cases (`update_hours`, `close_day`, `add_service`, `update_service_price`, `delete_service`) directly `await` `db.insert/update/delete` calls inside a `switch` statement that has no enclosing `try/catch`. If any call throws (e.g. inserting a duplicate service name violates `unique_business_service`), the exception propagates out of the `for (const call of functionCalls)` loop in `aiOwnerAgent`. `aiOwnerAgent` has no outer try/catch around the tool-execution loop, so the exception surfaces to `handleFoundBusiness`, where it is silently caught at line 83 and logged. The owner receives no Telegram response at all. The billing tool cases avoid this by delegating to handlers that have their own try/catch; the scheduling cases do not.

**Fix:** Wrap the entire `switch` body in `executeOwnerTool` with a top-level guard:
```typescript
async function executeOwnerTool(...): Promise<string> {
  try {
    switch (toolName) {
      case 'update_hours': { ... }
      // ...remaining cases...
    }
  } catch (err) {
    logger.error({ err, toolName, businessId: business.id }, 'executeOwnerTool failed');
    return 'Σφάλμα κατά την εκτέλεση. Δοκιμάστε ξανά.';
  }
}
```

---

### WR-03: `withBusinessContext` uses `sql.raw()` with string interpolation for the RLS `SET LOCAL`

**File:** `src/database/queries.ts:86`

**Issue:**
```typescript
await tx.execute(sql.raw(`SET LOCAL app.current_business_id = '${Number(businessId)}'`));
```
`sql.raw()` is Drizzle's explicitly non-parameterized escape hatch. If `businessId` is a value that `Number()` cannot parse, the coercion returns `NaN` and the executed statement becomes `SET LOCAL app.current_business_id = 'NaN'`. The RLS policy receives the string `'NaN'`, which matches no numeric business ID, causing all queries in the transaction to return empty result sets — a silent data access failure, not an error. All current callers pass valid numeric IDs, so this is latent, but `sql.raw` on a security-critical RLS configuration path is fragile. PostgreSQL's `set_config()` function accepts parameterized arguments.

**Fix:**
```typescript
await tx.execute(
  sql`SELECT set_config('app.current_business_id', ${String(Number(businessId))}, true)`
);
```
This uses Drizzle's parameterized `sql` template tag, eliminating string interpolation on the RLS bootstrap path.

---

### WR-04: Scheduling tool mutations use admin `db` connection, bypassing RLS

**File:** `src/onboarding/ai-owner-agent.ts:313, 327, 339, 353, 362`

**Issue:** All five scheduling cases call `db.insert/update/delete` directly via the module-level admin `db` (superuser) connection, not `getConn()`. The billing cases in the same file correctly use `withBusinessContext` to enforce row-level security. Because `businessId` is always `business.id` from the authenticated webhook context, the immediate blast radius is limited. However, `update_service_price` and `delete_service` perform a partial-match lookup against `svcList` (loaded once at agent startup) and then issue unconstrained `db.update(services).where(eq(services.id, match.id))` / `db.delete(services).where(eq(services.id, match.id))` with no business-ownership guard in the WHERE clause. If the partial match ever produces a false positive (e.g., stale `svcList` after a concurrent service addition), the mutation hits the wrong row without RLS blocking it.

**Fix:** Replace `db.insert/update/delete` with `getConn().insert/update/delete` in all five cases and ensure `executeOwnerTool` is called inside a `withBusinessContext` context (or call `withBusinessContext` at the top of `executeOwnerTool` for the scheduling cases).

## Info

### IN-01: `createMembership` hardcodes Athens winter offset `+02:00` — expiry is 1 hour late during DST

**File:** `src/billing/queries.ts:259`

**Issue:**
```typescript
const expiresAt = new Date(`${expiresAtDate}T23:59:59+02:00`);
```
During Greek DST (UTC+3, late-March through late-October), the correct UTC equivalent of `23:59:59 Athens` is `20:59:59 UTC`, not `21:59:59 UTC`. Using the hardcoded `+02:00` winter offset stores the expiry 1 hour late in summer. A client whose pack should expire at midnight Athens summer time retains it until `00:59:59` the following UTC day. The comment in the code acknowledges this as "acceptable for an expiry field." The `restoreCredit` fix in CR-03 makes the expiry comparison a plain UTC comparison against `new Date()`, so the 1-hour shift propagates correctly once CR-03 is fixed — but the upstream creation value is still technically wrong.

**Fix:** Derive the correct UTC offset dynamically:
```typescript
// Use Intl to determine the Athens offset at the expiry date
const athensOffset = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Athens', timeZoneName: 'shortOffset'
}).formatToParts(new Date(`${expiresAtDate}T00:00:00`))
  .find(p => p.type === 'timeZoneName')?.value ?? '+02:00';
// strip 'GMT' prefix if present: "GMT+3" → "+03:00"
const expiresAt = new Date(`${expiresAtDate}T23:59:59${athensOffset.replace('GMT', '')}`);
```
Or use `date-fns-tz`'s `zonedTimeToUtc` for a cleaner approach.

---

### IN-02: `today` date for `view_todays_schedule` is derived from UTC, not Athens local time

**File:** `src/onboarding/ai-owner-agent.ts:68`

**Issue:**
```typescript
const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC; close enough for schedule view
```
Between midnight and 03:00 Athens time, `today` is the previous UTC calendar date. An owner asking for today's schedule at 01:00 Athens time receives yesterday's bookings from `listBookingsForDate`. The comment acknowledges this approximation, but for a booking management tool the discrepancy is visible to users.

**Fix:**
```typescript
import { isoDateInAthens } from '../utils/timezone';
const today = isoDateInAthens(new Date());
```
`isoDateInAthens` already exists in the codebase and is used by the scheduler and billing modules for exactly this purpose.

---

_Reviewed: 2026-07-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
