# Phase 8: Enforcement & Session Deduction - Pattern Map

**Mapped:** 2026-07-20
**Files analyzed:** 11 (8 modified, 1 new migration, 2 new test files)
**Analogs found:** 11 / 11

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/billing/queries.ts` | service | CRUD | `src/billing/queries.ts` (self — extend) | exact |
| `src/billing/tools.ts` | service | request-response | `src/billing/tools.ts` (self — extend) | exact |
| `src/conversation/function-executor.ts` | service | CRUD | `src/conversation/function-executor.ts` (self — extend) | exact |
| `src/database/schema.ts` | model | CRUD | `src/database/schema.ts` (self — extend) | exact |
| `src/database/queries.ts` | model | CRUD | `src/database/queries.ts` (self — extend) | exact |
| `src/onboarding/ai-owner-agent.ts` | service | request-response | `src/onboarding/ai-owner-agent.ts` (self — extend) | exact |
| `src/webhooks/telegram.ts` | controller | event-driven | `src/webhooks/telegram.ts` (self — extend) | exact |
| `migrations/0007_enforcement_policy.sql` | migration | batch | `migrations/0006_billing_schema.sql` | exact |
| `tests/billing-session-deduction.test.ts` | test | CRUD | `tests/billing-membership-creation.test.ts` | role-match |
| `tests/billing-enforcement-policy.test.ts` | test | request-response | `tests/billing-tools.test.ts` | role-match |
| `tests/function-executor.test.ts` | test | CRUD | `tests/function-executor.test.ts` (self — extend) | exact |

---

## Pattern Assignments

### `src/billing/queries.ts` — new functions: `getActiveMembershipForDeduction`, `findMembershipByBooking`, `deductSession`, `restoreCredit`, `getBusinessEnforcementPolicy`

**Analog:** `src/billing/queries.ts` (existing functions in the same file)

**Imports pattern** (lines 1–18 — reuse exactly):
```typescript
import { and, desc, eq, gt, gte, sql } from 'drizzle-orm';
import { db } from '../database/db';
import {
  billingPackages,
  memberships,
  membershipLedger,
  clientBusinessRelationships,
  bookings,
  services,
} from '../database/schema';
import { getConn } from '../database/queries';
import { isoDateInAthens, addCalendarDays } from '../utils/timezone';
import { logger } from '../utils/logger';
```
Phase 8 adds: `businesses` to the schema import list; `gt` is already imported.

**Core read pattern — SELECT with getConn()** (lines 301–336, `getClientActiveMembership`):
```typescript
export async function getClientActiveMembership(...) {
  const rows = await getConn()
    .select({ ... })
    .from(memberships)
    .innerJoin(...)
    .where(and(
      eq(memberships.businessId, businessId),
      eq(memberships.clientPhone, clientPhone),
      eq(memberships.isActive, true),
      gt(memberships.expiresAt, new Date())
    ))
    .limit(1);
  if (!rows[0]) return null;
  return { ... };
}
```
`getActiveMembershipForDeduction` follows this pattern plus `.for('update')` before `.limit(1)`.

**Core ledger-write pattern — onConflictDoNothing idempotency** (lines 280–295, `createMembership` inner block):
```typescript
// D-11: append-only ledger with idempotency guard
await tx.insert(membershipLedger).values({
  membershipId: memberId,
  operationType: 'payment_recorded',
  sessionsDeducted: 0,
  reason: 'Payment recorded by owner',
  idempotencyKey,
});
```
Phase 8 version replaces `tx.insert` with `getConn().insert` (because atomicity comes from `withBusinessContext`, not a local `db.transaction()`), and appends `.onConflictDoNothing().returning({ id: membershipLedger.id })` for idempotency detection.

**Counter update pattern** (lines 261–272, `createMembership` upsert):
```typescript
await getConn()
  .update(memberships)
  .set({ sessionsRemaining: sql`${memberships.sessionsRemaining} - 1` })
  .where(eq(memberships.id, membershipId));
```
Credit restore uses `+ 1`. Import `sql` is already present on line 6.

**Error/logger pattern** (lines 288–290):
```typescript
logger.info(
  { businessId, clientPhone, packageId, memberId, expiresAtDate },
  'Membership created'
);
```

---

### `src/billing/tools.ts` — new function: `handleSetEnforcementPolicy`

**Analog:** `src/billing/tools.ts` (existing `handleCreatePackage`, `handleViewClientMembership`)

**Imports pattern** (lines 1–14 — extend import list):
```typescript
import { z } from 'zod';
import {
  createPackage,
  listPackages,
  deactivatePackage,
  getClientActiveMembership,
  // Phase 8: add setBusinessEnforcementPolicy
} from './queries';
import { logger } from '../utils/logger';
```

**Zod schema pattern** (lines 20–26, `CreatePackageSchema`):
```typescript
export const CreatePackageSchema = z.object({
  name: z.string().min(1, 'Το όνομα πακέτου είναι υποχρεωτικό'),
  price_cents: z.number().int().min(0, 'Η τιμή πρέπει να είναι μη αρνητική'),
  ...
});
```
`SetEnforcementPolicySchema` follows same shape:
```typescript
export const SetEnforcementPolicySchema = z.object({
  policy: z.enum(['allow', 'block', 'flag']),
});
```

**Handler structure** (lines 44–86, `handleCreatePackage`):
```typescript
export async function handleCreatePackage(
  businessId: number,
  args: Record<string, unknown>
): Promise<CreatePackageResult | string> {
  const parsed = CreatePackageSchema.safeParse(args);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return `Σφάλμα επικύρωσης: ${firstIssue?.message ?? 'Μη έγκυρα δεδομένα'}`;
  }
  try {
    // ... DB call ...
    logger.info({ businessId, ... }, '...');
    return { ... };
  } catch (err) {
    logger.error({ err, businessId }, 'handleCreatePackage failed');
    return 'Σφάλμα κατά τη δημιουργία πακέτου. Δοκιμάστε ξανά.';
  }
}
```
`handleSetEnforcementPolicy(businessId, args)` copies this structure: safeParse → DB write → Greek success string | Greek error string.

**Greek date formatting** (lines 148–150, `handleViewClientMembership`):
```typescript
const expiresAtStr = membership.expiresAt.toLocaleDateString('el-GR', {
  timeZone: 'Europe/Athens',
});
```
Use this pattern for `expiresAt` display in enforcement-related messages.

---

### `src/conversation/function-executor.ts` — extend `bookAppointmentTool` and `cancelAppointmentTool`

**Analog:** `src/conversation/function-executor.ts` (self)

**ToolContext interface** (lines 19–31 — extend, do not replace):
```typescript
export interface ToolContext {
  business: { id: number; name: string; ownerTelegramId: string | null };
  clientPhone: string;
  requestId: string;
  idempotencyKey: string;
}
```
Phase 8 requires `context.business.enforcementPolicy` — extend the `business` shape to `{ id: number; name: string; ownerTelegramId: string | null; enforcementPolicy?: string }`.

**bookAppointmentTool structure** (lines 156–189):
```typescript
async function bookAppointmentTool(args, context): Promise<Record<string, unknown>> {
  const parsed = BookAppointmentArgsSchema.parse(args);
  const service = await findServiceById(context.business.id, parsed.service_id);
  if (!service) return { success: false, error: 'service_not_found' };

  // [Phase 8: enforcement pre-check + SELECT FOR UPDATE membership lookup HERE]

  const expiresAt = new Date(Date.now() + PENDING_BOOKING_TTL_MS);
  const booking = await insertBooking({ ... });

  if (booking) {
    // [Phase 8: flag alert BEFORE alertOwnerNewBooking — D-11]
    // [Phase 8: deductSession() call HERE]
    try {
      await alertOwnerNewBooking(booking, service, context.business);
    } catch (err) {
      logger.error({ err, bookingId: booking.id }, 'Booking created but owner alert failed');
    }
    return { success: true, booking_id: booking.id, status: booking.bookingStatus };
  }
  return await resolveConflictOrTaken(context.clientPhone, context.idempotencyKey);
}
```

**cancelAppointmentTool structure** (lines 191–237):
```typescript
async function cancelAppointmentTool(args, context): Promise<Record<string, unknown>> {
  const parsed = CancelAppointmentArgsSchema.parse(args);
  const booking = await findBookingById(context.business.id, parsed.booking_id);
  if (!booking) return { success: false, error: 'booking_not_found' };
  if (booking.clientPhone !== context.clientPhone) return { success: false, error: 'not_your_booking' };
  if (!ACTIVE_STATUSES.includes(booking.bookingStatus)) return { success: false, error: 'not_cancellable' };

  await updateBookingStatus(booking.id, 'cancelled');
  // [Phase 8: findMembershipByBooking + restoreCredit() HERE — inside appDb.transaction()]
  ...
}
```

**Best-effort vs. critical pattern:**
- Best-effort (existing): `try { await alertOwnerNewBooking(...); } catch (err) { logger.error(...); }` — used for non-critical side effects.
- Critical (Phase 8 flag alert per D-11): `await sendTelegramMessage(ownerTelegramId, flagText)` — NO try/catch wrapper; must be awaited and allowed to surface errors.

---

### `src/database/schema.ts` — add `enforcementPolicy` column to `businesses`

**Analog:** `src/database/schema.ts` (existing Drizzle column definitions)

Read the existing `businesses` table definition in schema.ts and add:
```typescript
enforcementPolicy: text('enforcement_policy').notNull().default('allow'),
```
following the same column naming convention (camelCase Drizzle name → snake_case SQL).

---

### `src/database/queries.ts` — extend `Business` interface

**Analog:** `src/database/queries.ts` (existing `Business` interface)

Extend the TypeScript `Business` interface with:
```typescript
enforcementPolicy: string;  // 'allow' | 'block' | 'flag' — added by Phase 8 migration
```
Both schema.ts and queries.ts must be updated together (Pitfall 6 in RESEARCH.md).

---

### `src/onboarding/ai-owner-agent.ts` — add `set_enforcement_policy` to `OWNER_TOOLS` and `executeOwnerTool`

**Analog:** `src/onboarding/ai-owner-agent.ts` (existing `OWNER_TOOLS` array and `executeOwnerTool` switch)

**Tool definition pattern** (lines 116–145, `create_package` in `OWNER_TOOLS`):
```typescript
{
  type: 'function' as const,
  name: 'create_package',
  description:
    'Δημιουργεί νέο πακέτο μαθημάτων για την επιχείρηση...',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: "..." },
      ...
    },
    required: ['name', 'price_cents', 'valid_days', 'session_count'],
  },
},
```
`set_enforcement_policy` follows same shape with `enum` property:
```typescript
{
  type: 'function' as const,
  name: 'set_enforcement_policy',
  description:
    'Ορίζει την πολιτική κρατήσεων για πελάτες χωρίς ενεργή συνδρομή: ' +
    '"block" = μπλοκάρει (αρνείται κράτηση), "flag" = επιτρέπει αλλά ειδοποιεί τον ιδιοκτήτη, ' +
    '"allow" = επιτρέπει πάντα (προεπιλογή).',
  parameters: {
    type: 'object',
    properties: {
      policy: {
        type: 'string',
        enum: ['allow', 'block', 'flag'],
        description: 'Πολιτική εφαρμογής: allow | block | flag',
      },
    },
    required: ['policy'],
  },
},
```

**executeOwnerTool switch case pattern** (lines 365–384, `create_package` case):
```typescript
case 'create_package': {
  const result = await handleCreatePackage(business.id, args as Record<string, unknown>);
  if (typeof result === 'object' && result !== null && 'pendingPackageId' in result) {
    const pkgResult = result as CreatePackageResult;
    await sendTelegramMessageWithKeyboard(ownerTelegramId, pkgResult.confirmationText, [...]);
    return '';
  }
  return result as string;
}
```
`set_enforcement_policy` case is simpler (no confirmation keyboard needed):
```typescript
case 'set_enforcement_policy': {
  return withBusinessContext(business.id, () =>
    handleSetEnforcementPolicy(business.id, args as Record<string, unknown>)
  );
}
```
Note: wrap in `withBusinessContext` (as done for `list_packages` on line 388) so the UPDATE on `businesses` is RLS-gated.

---

### `src/webhooks/telegram.ts` — extend `handleClientCancelCallback` and `handleCallbackQuery` reject branch

**Analog:** `src/webhooks/telegram.ts` (self)

**handleClientCancelCallback injection point** (after line 161):
```typescript
await updateBookingStatus(booking.id, 'cancelled');

// [Phase 8: inject here — findMembershipByBooking + restoreCredit]
const membershipId = await findMembershipByBooking(booking.id);
if (membershipId !== null) {
  await restoreCredit(membershipId, booking.id, `booking:${booking.id}:credit`);
}
// [existing calendar delete + owner notification continues unchanged]
```

**handleCallbackQuery reject branch** (after line 291 `updateBookingStatusIfPending` returns `updated`):
```typescript
} else {
  // No cascade on reject: ...
  // [Phase 8: inject restoreCredit here, same pattern as handleClientCancelCallback]
  const membershipId = await findMembershipByBooking(updated.id);
  if (membershipId !== null) {
    await restoreCredit(membershipId, updated.id, `booking:${updated.id}:credit`);
  }
  await sendTelegramMessage(updated.clientPhone, CLIENT_REJECT_NOTICE_GREEK);
}
```

---

### `migrations/0007_enforcement_policy.sql` — NEW migration file

**Analog:** `migrations/0006_billing_schema.sql`

**Header comment pattern** (lines 1–12 of 0006):
```sql
-- Migration: 0007_enforcement_policy.sql
-- Purpose: Add enforcement_policy column to businesses table (Phase 8 D-07).
--
-- How to apply:
--   psql $DATABASE_URL -f migrations/0007_enforcement_policy.sql
--
-- Idempotency: ADD COLUMN uses IF NOT EXISTS. GRANT is natively idempotent.
--   Safe to run multiple times.
```

**ADD COLUMN pattern** (line 19–20 of 0006):
```sql
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS enforcement_policy TEXT NOT NULL DEFAULT 'allow'
    CONSTRAINT enforcement_policy_valid
      CHECK (enforcement_policy IN ('allow', 'block', 'flag'));
```

**GRANT pattern** (lines 114–116 of 0006):
```sql
GRANT UPDATE (enforcement_policy) ON businesses TO randevuclaw_app;
```

---

### `tests/billing-session-deduction.test.ts` — NEW integration test

**Analog:** `tests/billing-membership-creation.test.ts` (closest existing integration test pattern for billing)

Key patterns to copy from the membership creation test:
- `jest.resetModules()` before requiring modules (cold-import isolation)
- Real Postgres connection to `randevuclaw_test` DB
- Wrap each test scenario in a transaction that is rolled back (`afterEach`)
- Seed test data (business, client, package, membership) before each assertion
- Assert both the ledger row (`membership_ledger`) AND the counter (`memberships.sessionsRemaining`) changed atomically

---

### `tests/billing-enforcement-policy.test.ts` — NEW unit test

**Analog:** `tests/billing-tools.test.ts` (unit test with `jest.mock` for billing tools)

Key patterns to copy:
- `jest.mock('../src/billing/queries')` to stub DB calls
- `jest.mock('../src/utils/logger')` to silence logs
- Call `handleSetEnforcementPolicy(businessId, { policy: 'block' })` and assert the returned Greek string
- Test Zod validation: invalid policy value → Greek error string, no DB call made

---

### `tests/function-executor.test.ts` — EXTEND with Phase 8 cases

**Analog:** `tests/function-executor.test.ts` (self)

Extend the existing mock-based unit test with cases for:
- `bookAppointmentTool` with `block` policy + no membership → returns `{ success: false, error: 'no_membership', message: '...' }` (Greek)
- `bookAppointmentTool` with `flag` policy + no membership → booking succeeds + `sendTelegramMessage` called with flag text BEFORE `alertOwnerNewBooking`
- `bookAppointmentTool` with finite membership → `deductSession` called after `insertBooking`
- `bookAppointmentTool` with unlimited membership (`sessionsRemaining: null`) → `deductSession` NOT called
- `cancelAppointmentTool` → `restoreCredit` called after `updateBookingStatus`
- `cancelAppointmentTool` with no deduction ledger row → `restoreCredit` NOT called (`findMembershipByBooking` returns null)

---

## Shared Patterns

### Transaction Ownership: `getConn()` not `db.transaction()`
**Source:** `src/billing/queries.ts` lines 109–113 (`getConn()` usage) vs. lines 230–294 (`db.transaction()` usage)
**Apply to:** All Phase 8 DB writes inside `bookAppointmentTool`, `cancelAppointmentTool`, `handleClientCancelCallback`, and `handleCallbackQuery` reject branch

The existing `withBusinessContext()` in telegram.ts (line ~410) wraps ALL of these with `appDb.transaction()`. Phase 8 code MUST use `getConn()` to participate in that transaction. Using `db.transaction()` opens a second, separate connection and breaks atomicity.

```typescript
// CORRECT (Phase 8): participates in withBusinessContext transaction
await getConn()
  .insert(membershipLedger)
  .values({ ... })
  .onConflictDoNothing()
  .returning({ id: membershipLedger.id });

// WRONG: opens new connection, breaks atomicity
await db.transaction(async (tx) => { ... });
```

### Idempotency: `onConflictDoNothing().returning()`
**Source:** `src/billing/queries.ts` lines 279–295 (`createMembership` inner ledger insert — uses `tx.insert` but the pattern is identical)
**Apply to:** `deductSession()` and `restoreCredit()` ledger inserts in `src/billing/queries.ts`

```typescript
const inserted = await getConn()
  .insert(membershipLedger)
  .values({ ..., idempotencyKey })
  .onConflictDoNothing()
  .returning({ id: membershipLedger.id });

if (inserted.length === 0) return; // already processed — idempotent replay
```

### Greek Language Messages
**Source:** `src/conversation/function-executor.ts` lines 122–123 and 228–232; `src/billing/tools.ts` lines 67–78
**Apply to:** All new user-facing strings in Phase 8

- Block refusal: `"Για να κάνετε κράτηση, χρειάζεστε ενεργή συνδρομή. Επικοινωνήστε με ${businessName} για ανανέωση."`
- Flag alert: `"⚠️ Νέα κράτηση από πελάτη χωρίς ενεργή συνδρομή: ${clientName}, ${service.name}, ${booking.calendarDate} ${booking.calendarTime}."`
- Policy set confirmation: Greek string returned from `handleSetEnforcementPolicy`, e.g. `"Η πολιτική κρατήσεων ορίστηκε σε: block."`

### Timezone-Safe Expiry Check
**Source:** `src/utils/timezone.ts` (referenced in `src/billing/queries.ts` line 17)
**Apply to:** `restoreCredit()` expiry check in `src/billing/queries.ts`

Use `isoDateInAthens()` from `src/utils/timezone.ts` — never hand-roll UTC offset arithmetic. From RESEARCH.md "Don't Hand-Roll" table:
```typescript
// For expiry comparison in restoreCredit:
const nowAthens = new Date(
  new Date().toLocaleString('en-US', { timeZone: 'Europe/Athens' })
);
if (membership.expiresAt < nowAthens) return; // SESS-03: skip restore
```

### Logger Pattern
**Source:** `src/billing/queries.ts` lines 288–290; `src/billing/tools.ts` lines 79, 84
**Apply to:** All new Phase 8 functions

```typescript
// Info on success
logger.info({ businessId, bookingId, membershipId }, 'Session deducted');
// Error on catch — always include { err }
logger.error({ err, businessId, bookingId }, 'deductSession failed');
```

---

## No Analog Found

All files have close analogs in the codebase. No files require falling back to RESEARCH.md external patterns exclusively.

---

## Metadata

**Analog search scope:** `src/billing/`, `src/conversation/`, `src/database/`, `src/onboarding/`, `src/webhooks/`, `migrations/`, `tests/`
**Files scanned:** 7 source files + 1 migration + 2 test references
**Pattern extraction date:** 2026-07-20
