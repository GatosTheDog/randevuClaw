---
phase: 07-billing-configuration-payment-recording
reviewed: 2026-07-21T00:00:00Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - migrations/0006_billing_schema.sql
  - src/billing/queries.ts
  - src/billing/tools.ts
  - src/database/queries.ts
  - src/database/schema.ts
  - src/onboarding/ai-owner-agent.ts
  - src/telegram/handlers/payment-flow.ts
  - src/webhooks/telegram.ts
  - tests/billing-dst-arithmetic.test.ts
  - tests/billing-membership-creation.test.ts
  - tests/billing-nlu-parsing.test.ts
  - tests/billing-package-creation.test.ts
  - tests/billing-package-deactivate.test.ts
  - tests/billing-package-list.test.ts
  - tests/billing-payment-flow.test.ts
  - tests/billing-view-membership.test.ts
  - tests/consent-schema.test.ts
  - tests/consent.test.ts
  - tests/helpers/billing-fixtures.ts
findings:
  critical: 3
  warning: 6
  info: 3
  total: 12
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-07-21
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

Phase 7 adds billing packages, memberships, the membership ledger, and a multi-step payment-recording inline-keyboard flow. The schema design is solid (partial indexes for soft-delete, idempotency key on the ledger, Zod validation at the tool boundary, ownership guards on most write paths), and the D-03 pending-confirmation pattern is implemented consistently.

Three blockers require fixes before this code ships. The migration creates billing tables without RLS policies, making all "Uses getConn() for RLS enforcement (T-07-03)" comments in the billing layer factually false. The `athensEndOfDay` DST-fix relies on `new Date(toLocaleString(...))`, which produces wrong expiry timestamps on any non-UTC server — including developer machines. And `handleConfirmMembership` has no error handling around `createMembership`, so when that call throws (a confirmed code path on same-day replay), the owner receives no success or error message — the Telegram spinner disappears and nothing happens.

Six warnings cover a cross-tenant package-lookup gap in `createMembership`, double-calling `answerCallbackQuery`, a misleading `deactivatePackage` return value, the owner agent passing UTC date as "today", an idempotency key design that blocks legitimate same-day renewals, and unguarded `Number(args.package_id)` conversion.

---

## Critical Issues

### CR-01: Migration 0006 creates billing tables without RLS — all T-07-03 "RLS enforcement" claims are false

**Files:** `migrations/0006_billing_schema.sql` (Sections 2–4), `src/billing/queries.ts:142,205,352,600`

**Issue:** Migration `0006_billing_schema.sql` creates `billing_packages`, `memberships`, and `membership_ledger` using only `CREATE TABLE` and `GRANT` statements. There is no `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and no `CREATE POLICY` for any of the three tables. The application's existing RLS isolation model (established in earlier migrations) sets `app.current_business_id` via `set_config()` in every `withBusinessContext` call, but that session variable has no effect on tables that lack an RLS policy.

At least five functions in `src/billing/queries.ts` are annotated with `// Uses getConn() for RLS enforcement (T-07-03)`:
- `listPackages` (line 142)
- `getRecentClientsForBusiness` (line 205)
- `getActiveMembershipForDeduction` (line 352)
- `getPackageById` (line 174)
- `getClientActiveMembership` (line 600)

These comments are currently incorrect. All isolation for billing tables relies on application-level `WHERE businessId = ...` clauses. The functions that include such clauses (`listPackages`, `deactivatePackage`, `getClientActiveMembership`, etc.) are protected at the application level. The function that does not — `getPackageById` — is the exploitable gap (see WR-01).

**Fix:** Add a follow-up migration (e.g., `0009_billing_rls.sql`) with RLS DDL mirroring the pattern used for other tables:

```sql
ALTER TABLE billing_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_packages_isolation ON billing_packages
  USING (
    business_id::text = current_setting('app.current_business_id', true)
    OR current_setting('app.current_business_id', true) = ''
  );

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY memberships_isolation ON memberships
  USING (
    business_id::text = current_setting('app.current_business_id', true)
    OR current_setting('app.current_business_id', true) = ''
  );

-- membership_ledger has no business_id column; allow all for now.
ALTER TABLE membership_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_ledger_open ON membership_ledger USING (true);
```

---

### CR-02: `athensEndOfDay` produces wrong expiry timestamps on non-UTC servers

**File:** `src/billing/queries.ts:27–37`

**Issue:** The function computes the Europe/Athens UTC offset via:

```typescript
const utcMidnight = new Date(`${isoDate}T00:00:00Z`);
const athensWallClock = new Date(
  utcMidnight.toLocaleString('en-US', { timeZone: 'Europe/Athens' })
);
const offsetMs = utcMidnight.getTime() - athensWallClock.getTime();
const endOfDayLocalMs = new Date(`${isoDate}T23:59:59Z`).getTime();
return new Date(endOfDayLocalMs + offsetMs);
```

`toLocaleString` with `timeZone: 'Europe/Athens'` returns a string such as `"7/1/2024, 3:00:00 AM"`. That string is then passed to `new Date(...)`, which parses it in the **JavaScript engine's local (server) timezone**:

| Server TZ | `athensWallClock` value | `offsetMs` | computed expiry |
|---|---|---|---|
| UTC (fly.io default) | 2024-07-01T03:00:00Z | −3h | 2024-07-01T20:59:59Z ✓ |
| UTC+3 (Athens itself) | 2024-07-01T00:00:00Z | 0 | 2024-07-01T23:59:59Z ✗ (+3h late) |
| UTC+2 (other European) | 2024-07-01T01:00:00Z | −1h | 2024-07-01T22:59:59Z ✗ (+2h late) |

On fly.io (UTC) the result is correct. On every other server timezone — including developer machines in Europe/Athens — memberships receive an expiry timestamp hours later than intended, causing clients to have valid memberships longer than purchased. The `billing-dst-arithmetic.test.ts` suite tests `addCalendarDays` but contains no assertions on `athensEndOfDay`, leaving the bug undetected by the test suite.

This function is called in both `createMembership` (membership expiry) and `findMembershipsExpiringIn7Days` (sweep window boundary), making both incorrect on non-UTC servers.

**Fix:** Derive the offset using `Intl.DateTimeFormat`, which is server-timezone-independent:

```typescript
function athensEndOfDay(isoDate: string): Date {
  // Use noon UTC as anchor — guaranteed to land on isoDate in Athens timezone
  // regardless of offset (+2 or +3), avoiding day-boundary ambiguity.
  const noonUTC = new Date(`${isoDate}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Athens',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(noonUTC);
  // athensHour at noonUTC = 12 + offsetHours (14 for UTC+2, 15 for UTC+3)
  const athensHour = Number(parts.find((p) => p.type === 'hour')?.value ?? '14');
  const offsetHours = athensHour - 12;
  // 23:59:59 Athens = (23:59:59 UTC) − offsetHours
  const endOfDayUTCMs =
    new Date(`${isoDate}T23:59:59Z`).getTime() - offsetHours * 3_600_000;
  return new Date(endOfDayUTCMs);
}
```

Also add assertions to `billing-dst-arithmetic.test.ts`:
```typescript
it('summer date: athensEndOfDay returns UTC hour 20 (UTC+3 offset)', () => {
  const d = athensEndOfDay('2024-07-01');
  expect(d.getUTCHours()).toBe(20);
  expect(d.getUTCMinutes()).toBe(59);
});
it('winter date: athensEndOfDay returns UTC hour 21 (UTC+2 offset)', () => {
  const d = athensEndOfDay('2024-12-01');
  expect(d.getUTCHours()).toBe(21);
  expect(d.getUTCMinutes()).toBe(59);
});
```

---

### CR-03: `handleConfirmMembership` has no error handling around `createMembership` — owner receives no feedback on failure

**File:** `src/telegram/handlers/payment-flow.ts:206–219`

**Issue:** After the ownership check and package lookup, `createMembership` is called bare:

```typescript
const result = await withBusinessContext(businessId, () =>
  createMembership(businessId, clientPhone, packageId)
);

const clientLabel = clientRel.clientName ?? clientPhone;
await sendTelegramMessage(senderTelegramId, [ ... ].join('\n'));
```

`createMembership` is documented to throw when the idempotency key is already present (same-day replay). `billing-membership-creation.test.ts:116–120` explicitly confirms this:

```typescript
await expect(
  withBusinessContext(businessId, () =>
    createMembership(businessId, uniqueClient, packageId)
  )
).rejects.toThrow();
```

When `createMembership` throws, the exception propagates through `handleCallbackQuery` to the outer try/catch in `handleTelegramWebhookPost`, which logs the error and returns 200 to Telegram — but sends nothing to the owner. The Telegram spinner was already dismissed by the earlier `answerCallbackQuery` call. The owner sees the spinner disappear and nothing else. They cannot distinguish success from failure. Retapping the button produces the same silent error. This failure is reliably triggered by a double-tap or by any same-day re-recording attempt.

**Fix:**

```typescript
let result: { memberId: number; expiresAtDate: string; sessionsRemaining: number | null };
try {
  result = await withBusinessContext(businessId, () =>
    createMembership(businessId, clientPhone, packageId)
  );
} catch (err) {
  logger.error({ err, businessId, clientRelId, packageId }, 'handleConfirmMembership: createMembership failed');
  await sendTelegramMessage(
    senderTelegramId,
    'Σφάλμα κατά την καταγραφή πληρωμής. Ελέγξτε αν η συνδρομή ήδη υπάρχει και δοκιμάστε ξανά.'
  );
  return;
}

const clientLabel = clientRel.clientName ?? clientPhone;
await sendTelegramMessage(senderTelegramId, [ ... ].join('\n'));
```

---

## Warnings

### WR-01: `createMembership` and `getPackageById` — package lookup has no `businessId` filter; foreign package data accepted

**File:** `src/billing/queries.ts:175–182` (`getPackageById`), `src/billing/queries.ts:276–285` (`createMembership`)

**Issue:** `getPackageById` queries `WHERE id = packageId` with no `businessId` constraint and relies on RLS (which is currently absent — see CR-01). `createMembership` independently re-fetches the package inside a `db.transaction()` (admin connection, bypasses RLS regardless of whether it is added):

```typescript
const pkgRows = await tx
  .select()
  .from(billingPackages)
  .where(eq(billingPackages.id, packageId))   // no businessId filter
  .limit(1);
```

A registered business owner can craft a `billing:mem_confirm:{clientRelId}:{foreignPkgId}` callback. `handleCallbackQuery` resolves `businessId` from their Telegram identity (correct), but passes the untrusted `packageId` directly to `handleConfirmMembership` and then `createMembership`. The package fetched belongs to a different business; its `validDays` and `sessionCount` are used to create the membership. Every other write-path function (`deactivatePackage`, `activatePackage`, `cancelPendingPackage`) includes `eq(billingPackages.businessId, businessId)` as an explicit ownership guard; these two functions are the inconsistent outliers.

**Fix:** Add `businessId` parameter to `getPackageById` and add an ownership guard to the `createMembership` package fetch:

```typescript
// getPackageById — add businessId
export async function getPackageById(packageId: number, businessId: number): Promise<BillingPackage | null> {
  const rows = await getConn()
    .select()
    .from(billingPackages)
    .where(and(eq(billingPackages.id, packageId), eq(billingPackages.businessId, businessId)))
    .limit(1);
  return rows[0] ?? null;
}

// createMembership — add ownership guard to package fetch
const pkgRows = await tx
  .select()
  .from(billingPackages)
  .where(and(eq(billingPackages.id, packageId), eq(billingPackages.businessId, businessId)))
  .limit(1);
const pkg = pkgRows[0];
if (!pkg) throw new Error(`Package ${packageId} not found for business ${businessId}`);
```

---

### WR-02: `answerCallbackQuery` double-called for three billing callback actions

**Files:** `src/webhooks/telegram.ts:207`, `src/telegram/handlers/payment-flow.ts:176,232,258`

**Issue:** `handleCallbackQuery` calls `answerCallbackQuery(callbackQuery.id)` unconditionally at line 207 before dispatching to any handler. Then `handleConfirmMembership` (line 176), `handleCancelPackage` (line 232), and `handleConfirmPackage` (line 258) each call it again with the same callback query ID. For these three paths, Telegram receives two `answerCallbackQuery` calls for the same ID. The second call returns a Telegram API error. The Telegram client in tests is mocked so the double-call is undetected. In production, every confirmation or cancellation of a package logs a spurious Telegram API error.

**Fix:** Remove the internal `answerCallbackQuery` call from the three handlers — the outer `handleCallbackQuery` already dismisses the spinner. Document the contract in each handler's JSDoc:

```typescript
/**
 * NOTE: caller (handleCallbackQuery) has already called answerCallbackQuery.
 * Do NOT call it again here.
 */
export async function handleConfirmMembership(...): Promise<void> {
  // removed: await answerCallbackQuery(callbackQueryId);
  ...
}
```

---

### WR-03: `deactivatePackage` WHERE clause lacks `isActive = true` — returns `true` for already-inactive packages

**File:** `src/billing/queries.ts:160–167`

**Issue:** The UPDATE predicate is `WHERE id = packageId AND business_id = businessId` with no `AND is_active = true`. In Postgres, `UPDATE ... SET is_active = false ... RETURNING id` returns the row even when the value was already `false` (the row is still touched). `rows.length > 0` then evaluates to `true`, and `handleDeactivatePackage` emits the Greek success message "Το πακέτο απενεργοποιήθηκε. Υπάρχουσες συνδρομές δεν επηρεάζονται." An owner asking to deactivate an already-inactive or pending package receives a false confirmation.

**Fix:**
```typescript
const rows = await getConn()
  .update(billingPackages)
  .set({ isActive: false })
  .where(
    and(
      eq(billingPackages.id, packageId),
      eq(billingPackages.businessId, businessId),
      eq(billingPackages.isActive, true)    // only match currently active packages
    )
  )
  .returning({ id: billingPackages.id });
return rows.length > 0;
```

---

### WR-04: Owner agent system prompt receives UTC date — "today" is wrong 1–3 hours after Athens midnight

**File:** `src/webhooks/telegram.ts:68`

**Issue:**

```typescript
const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC; close enough for schedule view
```

The comment acknowledges this is UTC. `today` is injected into the owner AI system prompt as "Σημερινή ημερομηνία: ${today}". Between midnight and 02:00–03:00 Athens local time (the UTC+2 / UTC+3 offset window), the AI is told "today" is still yesterday. During those hours, `view_todays_schedule` shows the wrong day's bookings, and any NLU that reasons about "today's bookings" or "today's packages" uses the wrong date. `isoDateInAthens` is already available and used throughout the billing layer.

**Fix:**
```typescript
import { isoDateInAthens } from '../utils/timezone';
// …
const today = isoDateInAthens(new Date());
```

---

### WR-05: Idempotency key blocks legitimate same-day payment renewal for the same client

**File:** `src/billing/queries.ts:317`

**Issue:** The ledger idempotency key is:
```typescript
const idempotencyKey = `${businessId}:${clientPhone}:payment_recorded:${purchaseDate}`;
```
where `purchaseDate` is the Athens calendar date. This is correct for replay prevention. However, if the owner legitimately records a second payment for the same client on the same calendar day (client bought in the morning, used all sessions, owner records a renewal the same afternoon), the ledger INSERT hits the UNIQUE constraint and rolls back the entire transaction — including the membership upsert. The second payment is silently lost (and, combined with CR-03, the owner receives no error message). `billing-membership-creation.test.ts:104–133` confirms and accepts this failure mode under "T-07-04 mitigation" but does not surface the same-day renewal regression.

**Fix:** Append a discriminator that makes each new payment unique even within the same day. The membership row's ID is stable across upserts and is available from the RETURNING clause:

```typescript
// After the membership upsert returns memberId:
const idempotencyKey = `${businessId}:${clientPhone}:payment_recorded:${purchaseDate}:${memberId}`;
```

Because `onConflictDoUpdate` preserves the row's primary key, the memberId is the same for renewals on the same row. To distinguish two payments for the same client that produce two different rows (the second creating a fresh membership), a `Date.now()` suffix or a UUID can be used instead.

---

### WR-06: `deactivate_package` passes `Number(args.package_id)` without validation — `NaN` silently no-ops

**File:** `src/onboarding/ai-owner-agent.ts:441`

**Issue:**
```typescript
case 'deactivate_package': {
  return withBusinessContext(business.id, () =>
    handleDeactivatePackage(business.id, Number(args.package_id))
  );
}
```
If Gemini omits `package_id`, `args.package_id` is `undefined`; `Number(undefined)` is `NaN`. Drizzle generates `WHERE id = NaN`, which the Postgres driver may serialize as a malformed literal, producing an unexpected error caught by the try/catch in `handleDeactivatePackage`. The owner receives the generic "Δεν βρέθηκε ενεργό πακέτο" message with no indication of the real problem. Unlike `create_package`, which validates all args through `CreatePackageSchema`, `deactivate_package` has no Zod guard.

**Fix:**
```typescript
const DeactivatePackageSchema = z.object({ package_id: z.number().int().positive() });

case 'deactivate_package': {
  const parsed = DeactivatePackageSchema.safeParse(args);
  if (!parsed.success) return 'Μη έγκυρο ID πακέτου. Παρακαλώ δώσε τον αριθμό ID του πακέτου.';
  return withBusinessContext(business.id, () =>
    handleDeactivatePackage(business.id, parsed.data.package_id)
  );
}
```

---

## Info

### IN-01: Migration comment says `TIMESTAMP WITH TIME ZONE` but column DDL is `TIMESTAMP` (without time zone)

**File:** `migrations/0006_billing_schema.sql:67`, `src/database/schema.ts:285`

**Issue:** The migration comment reads `-- TIMESTAMP WITH TIME ZONE (DST-safe)` and the schema.ts comment reads `// Phase 7: TIMESTAMP WITH TIME ZONE for DST-safe rolling expiry window`. Both are wrong: the DDL is `TIMESTAMP NOT NULL` (without time zone) and the Drizzle definition is `timestamp('expires_at').notNull()`, which also maps to `TIMESTAMP WITHOUT TIME ZONE`. On a UTC-configured Neon instance there is no functional difference because all values are stored as UTC. But the misleading comment will confuse any DBA or future developer working against the schema directly.

**Fix:** Update both comments: `-- stored in UTC (without time zone); athensEndOfDay() handles offset before insert`.

---

### IN-02: `billingPackages.isActive` schema default is `true` — contradicts D-03 pending-confirmation flow

**File:** `src/database/schema.ts:256`

**Issue:**
```typescript
isActive: boolean('is_active').notNull().default(true),
```
`createPackage()` always explicitly sets `isActive: false` to enforce the D-03 pending flow. The schema default of `true` means any INSERT that omits `isActive` (test helpers, admin scripts, future tool handlers) creates an immediately-active package, bypassing confirmation. `billing-fixtures.ts` explicitly sets `isActive: true` in test setup, so it would not be affected by a default change.

**Fix:** Change to `default(false)` to make the safe state the default:
```typescript
isActive: boolean('is_active').notNull().default(false),
```

---

### IN-03: `athensEndOfDay` has no test coverage in `billing-dst-arithmetic.test.ts`

**File:** `tests/billing-dst-arithmetic.test.ts`

**Issue:** The DST arithmetic test suite covers `addCalendarDays` across the 2024-10-27 Athens DST boundary but contains no assertions for `athensEndOfDay`, which was introduced in this phase as the WR-06 fix replacing hardcoded `+02:00`. Given that `athensEndOfDay` has a server-timezone dependency (CR-02), a test pinning the expected UTC hour value would both catch regressions and document the intended behavior.

**Fix:**
```typescript
import { athensEndOfDay } from '../src/billing/queries'; // or extract to utils/timezone

describe('athensEndOfDay UTC hour assertions', () => {
  it('summer date (UTC+3): end-of-day is 20:59:59 UTC', () => {
    const result = athensEndOfDay('2024-07-01');
    expect(result.getUTCHours()).toBe(20);
    expect(result.getUTCMinutes()).toBe(59);
  });
  it('winter date (UTC+2): end-of-day is 21:59:59 UTC', () => {
    const result = athensEndOfDay('2024-12-01');
    expect(result.getUTCHours()).toBe(21);
    expect(result.getUTCMinutes()).toBe(59);
  });
});
```

---

_Reviewed: 2026-07-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
