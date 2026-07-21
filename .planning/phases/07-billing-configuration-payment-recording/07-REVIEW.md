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
  critical: 2
  warning: 4
  info: 4
  total: 10
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-07-21
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

Phase 7 adds billing packages, memberships, and a multi-step payment-recording keyboard flow. The core data model is sound and the D-03 pending-confirmation pattern is implemented consistently. However, two blockers were found:

1. Migration `0006_billing_schema.sql` creates all three billing tables without enabling Row Level Security. Every existing table in the database has RLS enabled via migration `0003_phase4_per_bot.sql`, but `billing_packages`, `memberships`, and `membership_ledger` have no `ENABLE ROW LEVEL SECURITY` and no `CREATE POLICY` statements. Code throughout the billing layer is annotated "Uses getConn() for RLS enforcement (T-07-03)" — that assertion is false for these tables today.

2. `getPackageById` contains no `businessId` filter. With RLS absent on `billing_packages`, a registered owner can send a hand-crafted `billing:mem_confirm` callback referencing any `packageId` across the system, extract a foreign package's configuration data, and create a membership for their own client using that configuration. The `createMembership` function compounds this by re-fetching the package via the admin `db.transaction()` (which bypasses RLS even when it is eventually added).

---

## Critical Issues

### CR-01: Billing tables created without RLS — `getPackageById` has no businessId filter, enabling cross-tenant package access

**Files:**
- `migrations/0006_billing_schema.sql` (entire Section 2–4)
- `src/billing/queries.ts:175-182` (`getPackageById`)
- `src/billing/queries.ts:277-281` (`createMembership` package fetch)

**Issue:**

Migration `0003_phase4_per_bot.sql` enables RLS and creates isolation policies on every previously-existing table (`businesses`, `bookings`, `services`, `business_hours`, `client_business_relationships`, `conversation_turns`, `messages`). Migration `0006_billing_schema.sql` creates `billing_packages`, `memberships`, and `membership_ledger` with `GRANT` statements only — no `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and no `CREATE POLICY` for any of the three tables.

Because RLS is absent, `getConn()` queries against these tables see all rows regardless of the `app.current_business_id` set by `withBusinessContext`. The application-level WHERE clauses in most functions supply adequate isolation (`listPackages`, `deactivatePackage`, `getClientActiveMembership` all include `eq(...businessId, businessId)`). The exception is `getPackageById`:

```typescript
// src/billing/queries.ts:175
export async function getPackageById(packageId: number): Promise<BillingPackage | null> {
  const rows = await getConn()
    .select()
    .from(billingPackages)
    .where(eq(billingPackages.id, packageId))   // ← no businessId filter
    .limit(1);
  return rows[0] ?? null;
}
```

`getPackageById` is called from `handleConfirmMembership` (payment-flow.ts:198) and from `showMembershipConfirmation` (payment-flow.ts:127). Neither call site supplies a businessId to validate ownership.

**Attack path (registered owner required):**
1. Attacker owns business A. They want to learn business B's package configuration.
2. They craft a Telegram callback: `billing:mem_confirm:{theirClientRelId}:{victimPackageId}`.
3. `handleCallbackQuery` resolves `businessId = A` from their `senderTelegramId` (legitimate check).
4. `handleConfirmMembership(A, theirClientRelId, victimPackageId, ...)` is called.
5. `getPackageById(victimPackageId)` returns business B's package (no RLS, no businessId WHERE) — package name, priceCents, sessionCount, validDays are now in-scope.
6. `createMembership(A, clientPhone, victimPackageId)` is called:
   ```typescript
   // src/billing/queries.ts:272
   return db.transaction(async (tx) => {         // admin tx — bypasses RLS
     const pkgRows = await tx
       .select()
       .from(billingPackages)
       .where(eq(billingPackages.id, packageId)) // ← still no businessId filter
       .limit(1);
   ```
   `db` is the admin Drizzle client; its transaction does not participate in the outer `withBusinessContext` and would bypass RLS even after policies are added.
7. A membership row is inserted for business A with `packageId` pointing to business B's package. The attacker's client receives sessions/validity from B's package.

**Fix — three independent changes required:**

A) Add RLS to all three billing tables in a follow-up migration:
```sql
ALTER TABLE billing_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_packages_isolation ON billing_packages
  USING (business_id::text = current_setting('app.current_business_id', true));

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY memberships_isolation ON memberships
  USING (business_id::text = current_setting('app.current_business_id', true));

-- membership_ledger has no business_id; isolate via membership join or bypass RLS for admin ops
```

B) Add businessId filter to `getPackageById`:
```typescript
export async function getPackageById(
  packageId: number,
  businessId: number
): Promise<BillingPackage | null> {
  const rows = await getConn()
    .select()
    .from(billingPackages)
    .where(and(eq(billingPackages.id, packageId), eq(billingPackages.businessId, businessId)))
    .limit(1);
  return rows[0] ?? null;
}
```
Update all call sites to pass `businessId`.

C) Add businessId filter to the package fetch inside `createMembership`, and switch from `db.transaction()` to `appDb.transaction()` (RLS-enforced) or add an explicit ownership check:
```typescript
const pkgRows = await tx
  .select()
  .from(billingPackages)
  .where(and(eq(billingPackages.id, packageId), eq(billingPackages.businessId, businessId)))
  .limit(1);
```

---

### CR-02: `athensEndOfDay` has implicit server-UTC dependency — produces wrong expiry timestamps on non-UTC hosts

**File:** `src/billing/queries.ts:26-37`

**Issue:**

The WR-06 fix replaced a hardcoded `+02:00` winter offset with a dynamic offset computation. The new implementation:

```typescript
function athensEndOfDay(isoDate: string): Date {
  const utcMidnight = new Date(`${isoDate}T00:00:00Z`);
  const athensWallClock = new Date(
    utcMidnight.toLocaleString('en-US', { timeZone: 'Europe/Athens' })
  );
  const offsetMs = utcMidnight.getTime() - athensWallClock.getTime();
  const endOfDayLocalMs = new Date(`${isoDate}T23:59:59Z`).getTime();
  return new Date(endOfDayLocalMs + offsetMs);
}
```

`toLocaleString` with `timeZone: 'Europe/Athens'` returns a locale string such as `"7/1/2024, 3:00:00 AM"`. This string is then passed to `new Date(...)`, which parses it **in the JavaScript engine's local timezone** (the server's `TZ` environment variable).

- On a UTC server (fly.io default): `new Date("7/1/2024, 3:00:00 AM")` → `2024-07-01T03:00:00Z`. `offsetMs` = `0 − 3h = −3h`. `endOfDayLocalMs + (−3h)` → `2024-07-01T20:59:59Z` ✓ (correct for UTC+3).
- On a server at `TZ=Europe/Athens` (UTC+3 in summer): `new Date("7/1/2024, 3:00:00 AM")` → `2024-07-01T00:00:00Z` (parsed as UTC+3 → subtracts 3h). `offsetMs` = `0 − 0 = 0`. Result: `2024-07-01T23:59:59Z` — a timestamp **3 hours too late**, meaning memberships expire 3 hours after they should.

Developer machines running in any non-UTC timezone will silently compute wrong expiry dates. This affects `createMembership` (membership expiry) and `findMembershipsExpiringIn7Days` (sweep window boundary), making both incorrect in development. The problem is masked in production only because fly.io defaults to UTC.

The `billing-dst-arithmetic.test.ts` file tests `addCalendarDays` but not `athensEndOfDay`, so the timezone-dependency bug has no test coverage.

**Fix:** Use `Intl.DateTimeFormat` to derive the UTC offset without parsing a locale string:

```typescript
function athensEndOfDay(isoDate: string): Date {
  // Derive Athens UTC offset for the given date without server-timezone dependency.
  // Strategy: compute what UTC instant corresponds to noon Athens time on isoDate,
  // then use that to find the offset.
  const noonUTC = new Date(`${isoDate}T12:00:00Z`);
  const athensParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Athens',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(noonUTC);

  const get = (type: string) =>
    Number(athensParts.find((p) => p.type === type)?.value ?? '0');
  // Athens wall-clock at noon UTC: HH:MM:SS on isoDate
  const athensHour = get('hour');  // e.g. 15 for UTC+3
  // Offset (in hours) = athensHour - 12 (noon UTC)
  const offsetHours = athensHour - 12;
  // 23:59:59 Athens = (23:59:59 - offsetHours) UTC
  const endOfDayUTCMs =
    new Date(`${isoDate}T23:59:59Z`).getTime() - offsetHours * 3600 * 1000;
  return new Date(endOfDayUTCMs);
}
```

Also add a test in `billing-dst-arithmetic.test.ts` that asserts `athensEndOfDay('2024-07-01')` returns a Date whose UTC hours equal 20 (UTC+3 summer), and `athensEndOfDay('2024-12-01')` returns hours equal to 21 (UTC+2 winter).

---

## Warnings

### WR-01: Double `answerCallbackQuery` call for billing confirm/cancel handlers

**Files:** `src/webhooks/telegram.ts:207`, `src/telegram/handlers/payment-flow.ts:176, 232, 260`

**Issue:**

`handleCallbackQuery` answers the Telegram callback spinner unconditionally for every callback before routing:

```typescript
// telegram.ts:207
await answerCallbackQuery(callbackQuery.id);
```

Then `handleConfirmMembership` (line 176), `handleCancelPackage` (line 232), and `handleConfirmPackage` (line 260) each call `answerCallbackQuery` again as their first action. For these three callback paths, the Telegram Bot API receives two `answerCallbackQuery` calls for the same `callbackQueryId`. Telegram returns an error for the second call ("query is too old and response timeout expired" or "Bad Request: query ID is invalid"). The Telegram client mock in tests suppresses this, so no test currently catches it.

**Fix:** Remove the `answerCallbackQuery` call from the three payment-flow handlers — the outer `handleCallbackQuery` already covers it. Add a comment to each handler noting that the caller is responsible for spinner dismissal:

```typescript
// handleConfirmMembership: caller (handleCallbackQuery) has already answered
// the callback query. Do not call answerCallbackQuery here.
export async function handleConfirmMembership(...): Promise<void> {
  // Removed: await answerCallbackQuery(callbackQueryId);
  ...
}
```

---

### WR-02: `deactivate_package` tool passes `Number(args.package_id)` — NaN on missing arg, silently no-ops

**File:** `src/onboarding/ai-owner-agent.ts:441`

**Issue:**

```typescript
case 'deactivate_package': {
  return withBusinessContext(business.id, () =>
    handleDeactivatePackage(business.id, Number(args.package_id))
  );
}
```

If Gemini omits `package_id` from the tool call, `args.package_id` is `undefined`. `Number(undefined)` is `NaN`. `handleDeactivatePackage(businessId, NaN)` calls `deactivatePackage(businessId, NaN)`, which runs:

```typescript
.where(and(eq(billingPackages.id, NaN), eq(billingPackages.businessId, businessId)))
```

PostgreSQL cannot compare an integer column to NaN; the WHERE clause matches zero rows. `deactivatePackage` returns `false` (`rows.length === 0`), so `handleDeactivatePackage` returns the Greek error string "Δεν βρέθηκε ενεργό πακέτο με αυτό το ID." The owner receives this message but no package was ever found. There is no Zod validation protecting this path, unlike `create_package` which validates through `CreatePackageSchema`.

**Fix:** Add a Zod schema and apply it in the tool handler:

```typescript
const DeactivatePackageSchema = z.object({
  package_id: z.number().int().positive(),
});

case 'deactivate_package': {
  const parsed = DeactivatePackageSchema.safeParse(args);
  if (!parsed.success) return 'Μη έγκυρο ID πακέτου.';
  return withBusinessContext(business.id, () =>
    handleDeactivatePackage(business.id, parsed.data.package_id)
  );
}
```

---

### WR-03: Migration 0006 omits RLS on billing tables — code comments claiming RLS enforcement are false

**File:** `migrations/0006_billing_schema.sql` (Sections 2–4)

**Issue:**

Migration `0003_phase4_per_bot.sql` enables RLS and creates business-isolation policies on all seven existing tables. Migration `0006_billing_schema.sql` creates `billing_packages`, `memberships`, and `membership_ledger` with `GRANT` statements but no `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and no `CREATE POLICY` statements.

Code across the billing layer is annotated with "Uses getConn() for RLS enforcement (T-07-03)" (e.g., `listPackages`, `getClientActiveMembership`, `getActiveMembershipForDeduction`). These comments are currently false: `getConn()` inside `withBusinessContext` supplies a connection with `app.current_business_id` set, but without an RLS policy to enforce it, the setting has no effect. Isolation for `billing_packages` and `memberships` relies entirely on the `eq(...businessId, businessId)` application-level WHERE clauses — which are present in most functions but absent in `getPackageById` (see CR-01).

This is separately tracked from CR-01 because adding businessId filters to query functions and adding RLS DDL are independent remediation tasks — both are required for defense-in-depth.

**Fix:** Add a migration (e.g., `0009_billing_rls.sql`) with RLS DDL for all three billing tables. Pattern mirrors migration 0003:

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

-- membership_ledger has no business_id column; protect via membership FK or
-- grant bypass to randevuclaw_app only for sweep-context reads.
ALTER TABLE membership_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE membership_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_ledger_isolation ON membership_ledger
  USING (true); -- allow all for now; revisit if ledger-level isolation needed
```

---

### WR-04: Owner-agent `today` is UTC, not Europe/Athens — wrong date shown 1–3 hours after Athens midnight

**File:** `src/webhooks/telegram.ts:68`

**Issue:**

```typescript
const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC; close enough for schedule view
```

The comment acknowledges this is UTC. The value is passed to `aiOwnerAgent` → `buildOwnerSystemPrompt` → system prompt: `"Σημερινή ημερομηνία: ${today}"`. Between midnight and 02:00–03:00 Athens local time (the UTC+2/UTC+3 offset), the AI is told "today" is still yesterday. An owner sending a message at 01:30 Athens asking "show me today's schedule" sees bookings for the wrong day.

This is a correctness issue for the schedule-view tool and any time-sensitive queries the AI generates.

**Fix:**

```typescript
import { isoDateInAthens } from '../utils/timezone';
const today = isoDateInAthens(new Date());
```

`isoDateInAthens` is already used throughout the billing layer for exactly this purpose.

---

## Info

### IN-01: Migration 0006 comment claims TIMESTAMP WITH TIME ZONE but DDL is TIMESTAMP (no TZ)

**File:** `migrations/0006_billing_schema.sql:67`

```sql
expires_at         TIMESTAMP NOT NULL,    -- TIMESTAMP WITH TIME ZONE (DST-safe)
```

The DDL uses `TIMESTAMP` (without time zone). The inline comment says "TIMESTAMP WITH TIME ZONE (DST-safe)". These are different Postgres types. In practice the application stores UTC values in this `TIMESTAMP WITHOUT TIME ZONE` column and always compares with `new Date()` (UTC), so behavior is correct — but the comment is wrong and will mislead any DBA or future developer working directly against the schema.

**Fix:** Change the comment to match the DDL:
```sql
expires_at         TIMESTAMP NOT NULL,    -- stored in UTC; computed by athensEndOfDay()
```

---

### IN-02: `billingPackages.isActive` schema default is `true` but production flow always inserts `false`

**File:** `src/database/schema.ts:256`

```typescript
isActive: boolean('is_active').notNull().default(true),
```

`createPackage()` always sets `isActive: false` for the D-03 pending-confirmation flow. The schema-level `default(true)` means any direct INSERT that omits `isActive` (e.g., in a test helper or admin script) creates an immediately-active package, bypassing the confirmation flow. This contradicts D-03.

**Fix:** Change the schema default to `false` to match the intended pending state:
```typescript
isActive: boolean('is_active').notNull().default(false),
```
Update `billing-fixtures.ts` helper to pass `isActive: true` explicitly (it already does this via the `overrides?.isActive !== undefined ? overrides.isActive : true` pattern, which would continue to work correctly).

---

### IN-03: `athensEndOfDay` is not covered by any test

**File:** `tests/billing-dst-arithmetic.test.ts`

`billing-dst-arithmetic.test.ts` tests `addCalendarDays` across DST boundaries. The `athensEndOfDay` function introduced in this phase (as the WR-06 fix replacing the hardcoded +02:00 offset) has no tests. Given that the function has a server-timezone dependency (CR-02), a test that pins the expected UTC hour value would catch regressions and also document the intended behavior.

**Fix:** Add to `billing-dst-arithmetic.test.ts`:
```typescript
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

### IN-04: `linkRescheduledBooking` idempotency key uses string concatenation, inconsistent with template-literal pattern

**File:** `src/billing/queries.ts:497`

```typescript
idempotencyKey: 'booking:' + newBookingId + ':deduction',
```

All other idempotency keys in the same file use template literals (e.g., `` `${businessId}:${clientPhone}:payment_recorded:${purchaseDate}` ``, `` `booking:${booking.id}:credit` ``). Minor style inconsistency.

**Fix:**
```typescript
idempotencyKey: `booking:${newBookingId}:deduction`,
```

---

_Reviewed: 2026-07-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
