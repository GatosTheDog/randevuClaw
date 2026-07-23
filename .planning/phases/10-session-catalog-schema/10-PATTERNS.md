# Phase 10: Session Catalog & Schema - Pattern Map

**Mapped:** 2026-07-22
**Files analyzed:** 7 (2 new tables, 7 new business columns, 4 new owner tools, 1 new AI function, 1 new scheduler)
**Analogs found:** 7 / 7

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/database/schema.ts` (sessionCatalog, sessionInstances tables) | schema | CRUD | `billingPackages`, `memberships`, `membershipLedger` | exact |
| `src/database/schema.ts` (businesses table, 7 new columns) | schema | CRUD | `enforcement_policy` column (Phase 8) | exact |
| `src/onboarding/ai-owner-agent.ts` (OWNER_TOOLS) | tool-definition | request-response | existing OWNER_TOOLS entries | exact |
| `src/onboarding/ai-owner-agent.ts` (executeOwnerTool cases) | handler | request-response | existing switch cases for billing tools | exact |
| `src/session/rrule-expansion.ts` (new) | utility | transform | `src/billing/queries.ts` (athensEndOfDay, DST logic) | role-match |
| `src/scheduler/session-cancellation.ts` (new) | scheduler | event-driven | `src/scheduler/membership-expiry.ts` | exact |
| `tests/session-catalog-crud.test.ts` (new) | test | CRUD | `tests/billing-membership-creation.test.ts` | exact |

---

## Pattern Assignments

### Table Definition Pattern: sessionCatalog & sessionInstances

**Analog:** `src/database/schema.ts` lines 239–266 (billingPackages), lines 268–299 (memberships), lines 301–323 (membershipLedger)

**Imports pattern** (schema.ts lines 1–10):
```typescript
import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
```

**Table structure pattern** (billingPackages lines 239–266):
```typescript
export const billingPackages = pgTable(
  'billing_packages',
  {
    id: serial('id').primaryKey(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id),
    name: text('name').notNull(),
    priceCents: integer('price_cents').notNull(),
    validDays: integer('valid_days').notNull(),
    // nullable field with explicit D-## reference comment
    sessionCount: integer('session_count'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    // Partial index pattern — WHERE clause carves out soft-deleted rows
    uniqueIndex('unique_active_package_name')
      .on(table.businessId, table.name)
      .where(sql`is_active = true`),
  ]
);
```

**Apply to:** `sessionCatalog` (name, basePrice, recurringRule, isActive pattern), `sessionInstances` (sessionCatalogId FK, scheduledStartTime, scheduledEndTime, status pattern with 'scheduled' | 'cancelled' | 'completed')

---

### Adding Nullable Columns to Businesses Table

**Analog:** `src/database/schema.ts` lines 43–48 (enforcementPolicy column, Phase 8)

**Column definition pattern:**
```typescript
// Phase 8 (D-07): enforcement policy for clients with no active membership.
// 'allow' = proceed (default); 'block' = reject booking; 'flag' = allow with
// owner alert. NOT NULL with DEFAULT 'allow' — existing rows are safe after
// migration (permit-by-default). CHECK constraint in migration enforces valid
// values at DB level; Zod enforces at app level (Plan 05).
enforcementPolicy: text('enforcement_policy').notNull().default('allow'),
```

**Apply to Phase 10 new columns:**
- For 7 new nullable session-related columns (e.g., `sessionCatalogEnabled`, session conflict rules), use the pattern:
  - Column with `.nullable()` (Phase 10 nullable convention — table is non-empty)
  - Explicit Phase/D-reference comment explaining purpose and why nullable
  - `.default(null)` or omit default to let Postgres backfill NULL on migration
  - CHECK constraint in migration for enum-like values (`'rrule_based'`, `'manual'`, etc.)
  - Zod schema in owner tools matches DB-level CHECK at app level

---

### OWNER_TOOLS FunctionDeclaration Pattern

**Analog:** `src/onboarding/ai-owner-agent.ts` lines 120–175 (Phase 7 billing tools: create_package, list_packages, deactivate_package, record_payment, view_client_membership) and lines 206–222 (Phase 8 enforcement tool: set_enforcement_policy)

**Tool structure pattern** (lines 120–149, create_package):
```typescript
{
  type: 'function' as const,
  name: 'create_package',  // snake_case tool name
  description:
    'Δημιουργεί νέο πακέτο μαθημάτων για την επιχείρηση. Χρησιμοποιείται όταν ο ιδιοκτήτης θέλει να ορίσει νέο πακέτο με τιμή, διάρκεια και αριθμό συνεδριών.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: "Όνομα πακέτου, π.χ. 'Μηνιαίο', 'Εισαγωγικό'",
      },
      price_cents: {
        type: 'integer',
        description: 'Τιμή σε λεπτά ευρώ, π.χ. 8000 για €80,00',
      },
      // ... more properties
    },
    required: ['name', 'price_cents', 'valid_days', 'session_count'],
  },
},
```

**Apply to Phase 10 new tools (create_session, list_sessions, cancel_session, assign_client_to_session):**
- Each tool is a const object with `type: 'function'`, `name` (snake_case), `description` (Greek), `parameters` (JSON Schema with properties + required array)
- Properties use Greek descriptions via `description` field
- Required fields are listed in `required: [...]` array
- Follow convention: parameters are snake_case in Gemini schema, camelCase in ToolArgs interface

---

### executeOwnerTool Switch Case Pattern

**Analog:** `src/onboarding/ai-owner-agent.ts` lines 304–496 (executeOwnerTool function with switch cases)

**Pattern structure:**
```typescript
async function executeOwnerTool(
  toolName: string,
  args: ToolArgs,
  business: Business,
  svcList: Service[],
  today: string,
  ownerTelegramId: string
): Promise<string> {
  try {
  switch (toolName) {
    case 'update_hours': {
      // Input validation + early return on error
      const { day_of_week, open_time, close_time } = args;
      if (day_of_week === undefined || !open_time || !close_time) return 'Μη έγκυρα δεδομένα.';
      
      // WR-04 pattern: wrap in withBusinessContext for RLS enforcement
      return withBusinessContext(business.id, async () => {
        // Use getConn() inside for the enforced connection
        await getConn()
          .insert(businessHours)
          .values({...})
          .onConflictDoUpdate({...});
        return `OK: ${GREEK_WEEKDAYS[day_of_week]} ${open_time}–${close_time}`;
      });
    }
    
    case 'create_package': {
      // D-03 special case: tool sends its own Telegram message (keyboard)
      // and returns '' (empty string) to break the Gemini loop immediately
      const result = await handleCreatePackage(business.id, args as Record<string, unknown>);
      if (typeof result === 'object' && result !== null && 'pendingPackageId' in result) {
        const pkgResult = result as CreatePackageResult;
        // Send Ναι/Όχι confirmation keyboard directly
        await sendTelegramMessageWithKeyboard(ownerTelegramId, pkgResult.confirmationText, [
          [
            { text: '✅ Ναι', callback_data: `billing:pkg_confirm:${pkgResult.pendingPackageId}` },
            { text: '❌ Όχι', callback_data: `billing:pkg_cancel:${pkgResult.pendingPackageId}` },
          ],
        ]);
        return '';  // Signal: keyboard sent, break loop
      }
      return result as string;  // Validation error
    }
    
    case 'list_packages': {
      // Simple handler case: wrap in withBusinessContext and delegate to handler
      return withBusinessContext(business.id, () => handleListPackages(business.id));
    }
    
    default:
      return `Άγνωστο εργαλείο: ${toolName}`;
  }
  } catch (err) {
    // WR-02: top-level try/catch catches DB errors and returns Greek error to Gemini
    logger.error({ err, toolName, businessId: business.id }, 'executeOwnerTool failed');
    return 'Σφάλμα κατά την εκτέλεση. Δοκιμάστε ξανά.';
  }
}
```

**Apply to Phase 10 switch cases:**
- Each case (create_session, cancel_session, assign_client_to_session, list_sessions) follows one of two patterns:
  1. **Immediate return pattern:** Input validation, withBusinessContext wrap, DB insert/update via getConn(), Greek return string
  2. **Keyboard send pattern:** Delegate to a handler, if result contains callback_data, send keyboard directly and return '', else return error string
- All DB writes must be inside withBusinessContext and use getConn()
- All errors return Greek strings to Gemini, never propagate uncaught

---

### Query Layer Pattern with withBusinessContext

**Analog:** `src/billing/queries.ts` lines 1–20 (module purpose), lines 152–158 (listPackages), lines 319–393 (createMembership)

**Pattern (getConn usage):**
```typescript
// All read operations use getConn() for RLS enforcement
export async function listPackages(businessId: number): Promise<BillingPackage[]> {
  return getConn()
    .select()
    .from(billingPackages)
    .where(and(eq(billingPackages.businessId, businessId), eq(billingPackages.isActive, true)))
    .orderBy(desc(billingPackages.createdAt));
}

// Write operations inside withBusinessContext transaction
export async function createMembership(
  businessId: number,
  clientPhone: string,
  packageId: number
): Promise<{ memberId: number; expiresAtDate: string; sessionsRemaining: number | null }> {
  return db.transaction(async (tx) => {
    // WR-01: include businessId ownership guard so a crafted packageId resolves to null
    const pkgRows = await tx
      .select()
      .from(billingPackages)
      .where(and(eq(billingPackages.id, packageId), eq(billingPackages.businessId, businessId)))
      .limit(1);
    
    const pkg = pkgRows[0];
    if (!pkg) throw new Error(`Package ${packageId} not found for business ${businessId}`);
    
    // ... rest of transaction
  });
}
```

**Apply to Phase 10 queries.ts:**
- All sessionCatalog queries: use `getConn()` and include `businessId` equality in WHERE clause
- All sessionInstances queries: use `getConn()` and join through sessionCatalog to enforce business ownership
- RRuleExpansion function (if in queries layer): pure transform, no DB access, no withBusinessContext needed
- Use `orderBy(desc(...))` for newest-first ordering (Pattern from lines 157–158, 293, etc.)

---

### Bulk Notification Pattern for Session Cancellation

**Analog:** `src/scheduler/membership-expiry.ts` lines 35–129 (runMembershipExpirySweep with per-business and per-membership error isolation)

**Pattern:**
```typescript
// Phase 9 (NOTF-01, NOTF-02): nested try/catch for per-item isolation
export async function runMembershipExpirySweep(): Promise<number> {
  const businessIds = await listAllBusinessIds();
  let notificationCount = 0;

  for (const businessId of businessIds) {
    try {
      // Pre-check: business existence and botToken before query
      const business = await findBusinessById(businessId);
      if (!business || !business.botToken) {
        logger.warn({ businessId }, 'No bot token for business, skipping ...');
        continue;
      }

      const memberships = await findMembershipsExpiringIn7Days(businessId);

      for (const membership of memberships) {
        try {
          // 1. Insert dedup row BEFORE sending message (at-most-once tradeoff)
          const clientNotified = await insertMembershipExpiryNotification(
            membership.id,
            '7_day_client',
            expiryDate
          );
          if (clientNotified) {
            // 2. Send Telegram message
            await botTokenStore.run(business.botToken, async () => {
              await sendTelegramMessage(membership.clientPhone, clientMsg);
            });
            notificationCount += 1;
          }

          // 3. Owner notification with guard
          if (business.ownerTelegramId) {
            const ownerNotified = await insertMembershipExpiryNotification(
              membership.id,
              '7_day_owner',
              expiryDate
            );
            if (ownerNotified) {
              const ownerMsg = `Πελάτης με λήγουσα συνδρομή: ${clientName}...`;
              await botTokenStore.run(business.botToken, async () => {
                await sendTelegramMessage(business.ownerTelegramId!, ownerMsg);
              });
              notificationCount += 1;
            }
          }
        } catch (err) {
          logger.error({ err, membershipId: membership.id, businessId }, 'Notification failed');
        }
      }
    } catch (err) {
      logger.error({ err, businessId }, 'Sweep failed for business');
    }
  }

  return notificationCount;
}
```

**Apply to Phase 10 session cancellation scheduler:**
- Outer loop: all businesses (from listAllBusinessIds)
- Per-business check: business.botToken existence before DB queries
- Inner loop: all cancelled session instances for that business (from findCancelledSessions)
- Per-session: 1) insert dedup row, 2) send client notification via botTokenStore.run(), 3) send owner notification if ownerTelegramId exists
- Nested try/catch for per-item error isolation — one failed send never blocks others
- botTokenStore.run() is mandatory for all Telegram calls (never falls back to env var)
- Never log botToken (T-09-09)

---

### RRule Expansion Utility Pattern

**Analog:** `src/billing/queries.ts` lines 32–47 (athensEndOfDay utility) and lines 319–341 (DST-safe date arithmetic with addCalendarDays)

**Pattern (from billing/queries.ts):**
```typescript
// CR-02: DST-safe end-of-day calculation using Intl.DateTimeFormat
export function athensEndOfDay(isoDate: string): Date {
  const noonUTC = new Date(`${isoDate}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Athens',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(noonUTC);
  const athensHour = Number(parts.find((p) => p.type === 'hour')?.value ?? '14');
  const offsetHours = athensHour - 12;
  const endOfDayUTCMs =
    new Date(`${isoDate}T23:59:59Z`).getTime() - offsetHours * 3_600_000;
  return new Date(endOfDayUTCMs);
}

// Create membership calls DST-safe date utilities
const purchaseDate = isoDateInAthens(new Date());
const expiresAtDate = addCalendarDays(purchaseDate, pkg.validDays);
const expiresAt = athensEndOfDay(expiresAtDate);
```

**Apply to Phase 10 RRuleExpansion:**
- **Input:** rrule string, start date (ISO "YYYY-MM-DD" Athens), end date (ISO "YYYY-MM-DD" Athens), business timezone context (always Europe/Athens in PoC)
- **Output:** array of { scheduledStartTime: Date, scheduledEndTime: Date, iso_date: string } for each instance
- **DST safety:** All date arithmetic uses addCalendarDays (calendar days, not milliseconds) to avoid DST shift bugs
- **Example usage pattern:** Parse RRULE via rrule-js library, iterate expanded dates, apply DST-safe end-of-day logic for each instance
- **No DB access:** Pure transform function, testable in isolation without fixtures

---

### Integration Test Pattern

**Analog:** `tests/billing-membership-creation.test.ts` lines 1–163

**Pattern:**
```typescript
// Test file header: test database setup instructions
const TEST_DATABASE_URL =
  process.env.BILLING_TEST_DATABASE_URL ??
  'postgresql://manolis@localhost:5432/randevuclaw_test';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = TEST_DATABASE_URL;
jest.resetModules();

/* eslint-disable @typescript-eslint/no-var-requires */
const { db } = require('../src/database/db');
const { eq } = require('drizzle-orm');
const { membershipLedger, memberships } = require('../src/database/schema');
const { withBusinessContext } = require('../src/database/queries');
const { createMembership } = require('../src/billing/queries');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestPackage } = require('./helpers/billing-fixtures');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

describe('membership creation with rolling expiry', () => {
  let businessId: number;
  let packageId: number;

  beforeAll(async () => {
    // Test fixture: insert real business + package into test DB
    const business = await insertTestBusiness();
    businessId = business.id;
    const pkg = await insertTestPackage(businessId, { name: 'Test', validDays: 30 });
    packageId = pkg.id;
  });

  it('calculates expires_at correctly', async () => {
    // Use unique client per test to avoid idempotency collisions
    const client = `test-${Date.now()}`;
    const result = await withBusinessContext(businessId, () =>
      createMembership(businessId, client, packageId)
    );
    
    expect(result.expiresAtDate).toBe(expectedDate);
    expect(result.memberId).toBeGreaterThan(0);
  });

  it('stores expires_at as TIMESTAMP WITH TIME ZONE', async () => {
    // Fetch actual row and verify Date type
    const rows = await db.select().from(memberships).where(eq(memberships.id, result.memberId));
    expect(rows[0].expiresAt).toBeInstanceOf(Date);
  });

  it('writes initial ledger row with operation_type payment_recorded', async () => {
    const ledgerRows = await db.select().from(membershipLedger)
      .where(eq(membershipLedger.membershipId, result.memberId));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].operationType).toBe('payment_recorded');
  });

  it('idempotency_key prevents duplicate ledger rows on replay', async () => {
    // First call succeeds
    const firstResult = await withBusinessContext(businessId, () =>
      createMembership(businessId, uniqueClient, packageId)
    );
    
    // Second call on same day should throw (unique constraint violation)
    await expect(
      withBusinessContext(businessId, () =>
        createMembership(businessId, uniqueClient, packageId)
      )
    ).rejects.toThrow();
  });
});
```

**Apply to Phase 10 session catalog tests:**
- Reuse TEST_DATABASE_URL pattern (test DB is separate, pre-migrated with 0006_billing_schema.sql analog)
- beforeAll: insert test business + test sessionCatalog row via helper (analog: insertTestBusiness + insertTestPackage)
- Test cases for RRuleExpansion (no DB needed, pure function)
- Test cases for sessionInstances CRUD (insert, query by status, cancel with dedup check)
- Use `Date.now()` suffix on unique values to avoid test collision
- Use withBusinessContext wrapper for any multi-statement checks (analog: lines 54, 69, 84, 110, 119)

---

## Shared Patterns

### Authentication & Authorization (withBusinessContext wrapper)

**Source:** `src/database/queries.ts` lines 81–96 (withBusinessContext function)

**Apply to:** All execute functions in session tools, all queries.ts functions for sessionCatalog/sessionInstances, and all scheduler multi-business loops

```typescript
export async function withBusinessContext<T>(
  businessId: string | number,
  callback: () => Promise<T>
): Promise<T> {
  return appDb.transaction(async (tx) => {
    // WR-03: use set_config() via parameterized sql template instead of string interpolation
    await tx.execute(
      sql`SELECT set_config('app.current_business_id', ${String(Number(businessId))}, true)`
    );
    return currentTx.run(tx as unknown as typeof db, callback);
  });
}
```

All queries inside the callback automatically use RLS-enforced `getConn()` (via AsyncLocalStorage). Outside withBusinessContext, queries use admin `db` (bypasses RLS for pre-auth routing lookups).

---

### Error Handling

**Source:** `src/onboarding/ai-owner-agent.ts` lines 492–496 (top-level try/catch in executeOwnerTool) and `src/billing/tools.ts` lines 53–95 (Zod validation in handlers)

**Pattern:**
1. **Input validation (handler layer):** Zod schema .safeParse() before any DB write → return Greek error string
2. **DB operations (query layer):** use getConn() inside withBusinessContext, no explicit error handling needed (transaction rolls back on throw)
3. **Tool executor (ai-owner-agent.ts):** top-level try/catch around entire switch — any DB error returns Greek error to Gemini
4. **Schedulers (pollers):** per-item try/catch inside inner loop (never blocks other items), per-business try/catch outside (never blocks other businesses)

**Key rule:** Greek error strings are returned to Gemini (or logged for pollers), never propagated uncaught to callers.

---

### Telegram Multi-Send Pattern (botTokenStore.run)

**Source:** `src/scheduler/membership-expiry.ts` lines 82–84 (client notification) and lines 109–111 (owner notification)

**Pattern:**
```typescript
// botTokenStore.run() mandatory for all Telegram calls outside request context
await botTokenStore.run(business.botToken, async () => {
  await sendTelegramMessage(membership.clientPhone, clientMsg);
});

// Never call sendTelegramMessage or any Telegram API outside botTokenStore.run()
```

**Key constraints:**
- botTokenStore stores the per-business token for the duration of the callback
- botToken is NEVER passed to logger (T-09-09) — only method name logged
- Use botTokenStore.run() in all pollers, schedulers, and any out-of-request context Telegram calls
- In webhook request context, botTokenStore is already set by the webhook handler (D-02, D-04)

---

## No Analog Found

All patterns for Phase 10 have direct analogs in the codebase. The closest matches are:

| Pattern | Closest Analog | Difference |
|---------|---|---|
| RRule expansion logic | Billing DST-safe date math | RRule uses rrule-js library instead of custom calendar arithmetic, but same DST-safety principles apply |
| Session instance cancellation scheduler | Membership expiry sweep | Session cancellation is per-occurrence (after time passes), expiry is per-membership (7-day window); same nested try/catch pattern applies |
| sessionCatalog/sessionInstances schema | billingPackages + memberships tables | Session tables track recurring events instead of purchase packages; same nullable convention and unique index patterns apply |

---

## Metadata

**Analog search scope:** src/database/schema.ts, src/onboarding/ai-owner-agent.ts, src/billing/queries.ts, src/billing/tools.ts, src/telegram/client.ts, src/scheduler/membership-expiry.ts, src/database/queries.ts, tests/

**Files scanned:** 15 (billings tools, telegram routing, scheduler pollers, query layer, schema definitions, integration tests)

**Pattern extraction date:** 2026-07-22

**Summary:** Phase 10 session catalog and schema closely mirrors Phase 7 (billing) and Phase 9 (notifications) patterns. All OWNER_TOOLS follow the same snake_case/camelCase convention. All executeOwnerTool cases use withBusinessContext + getConn() for RLS safety. All scheduler operations use nested try/catch for error isolation. Multi-business sweeps iterate over listAllBusinessIds, check botToken, and send per-client + per-owner Telegram messages via botTokenStore.run(). Integration tests reuse test-database setup and fixture helpers.
