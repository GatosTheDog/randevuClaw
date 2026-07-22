# Phase 9: Expiry Notifications & Client Balance — Pattern Map

**Mapped:** 2026-07-21
**Files analyzed:** 6 new/modified files
**Analogs found:** 6 / 6

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/scheduler/membership-expiry.ts` | scheduler | event-driven | `src/scheduler/reminders.ts` | exact |
| `src/conversation/function-executor.ts` (extend) | tool-dispatcher | request-response | `src/conversation/function-executor.ts` lines 82–100 | exact |
| `src/database/schema.ts` (extend) | schema | configuration | `src/database/schema.ts` lines 301–327 | exact |
| `src/billing/queries.ts` (extend) | query | CRUD | `src/billing/queries.ts` lines 243–312 | exact |
| `src/server.ts` (extend) | infrastructure | startup | `src/server.ts` lines 6–9, 36–39 | exact |
| Database migration (new) | migration | configuration | (standard Drizzle migration pattern) | N/A |

---

## Pattern Assignments

### `src/scheduler/membership-expiry.ts` (scheduler, event-driven)

**Analog:** `src/scheduler/reminders.ts` (entire file)

**Pattern:**
- Per-business outer loop with try/catch isolation
- Per-membership inner loop with nested try/catch
- setInterval poller with configurable interval (6 hours for membership expiry vs 15 minutes for reminders)
- Dedup via DB query (reminders use `reminder24hSentAt`/`reminder1hSentAt` timestamp checks; membership expiry will use `membershipExpiryNotifications` table UNIQUE constraint)
- Telegram notification send within `botTokenStore.run()` context

**Imports pattern** (from `src/scheduler/reminders.ts` lines 1–10):
```typescript
import {
  listAllBusinessIds,
  findBookingsNeedingReminder,
  claimReminder24hSlot,
  claimReminder1hSlot,
  type Booking,
} from '../database/queries';
import { isoDateInAthens, addCalendarDays } from '../utils/timezone';
import { sendTelegramMessage } from '../telegram/client';
import { logger } from '../utils/logger';
```

**Core poller sweep structure** (from `src/scheduler/reminders.ts` lines 117–180):
```typescript
export async function runReminderSweep(): Promise<number> {
  const businessIds = await listAllBusinessIds();
  let sentCount = 0;
  
  for (const businessId of businessIds) {
    try {
      const candidates = await findBookingsNeedingReminder(businessId, [todayIso, tomorrowIso]);
      
      for (const booking of candidates) {
        try {
          // Per-item logic with dedup check
          const claimed = await claimReminder24hSlot(booking.id);
          if (claimed) {
            await sendTelegramMessage(booking.clientPhone, message);
            sentCount += 1;
          }
        } catch (err) {
          logger.error({ err, bookingId: booking.id }, 'Notification failed');
        }
      }
    } catch (err) {
      logger.error({ err, businessId }, 'Sweep failed for business');
    }
  }
  
  return sentCount;
}
```

**Poller registration structure** (from `src/scheduler/reminders.ts` lines 185–191):
```typescript
export function startReminderPoller(intervalMs: number = 15 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    runReminderSweep().catch((err) =>
      logger.error({ err }, 'Unhandled reminder sweep error')
    );
  }, intervalMs);
}
```

**For membership expiry, also reference:**
- `src/conversation/expiry-poller.ts` lines 24–51 for `botTokenStore.run()` wrapping pattern (critical for per-business Telegram token context)

---

### `src/conversation/function-executor.ts` (extend with `check_membership_balance` tool)

**Analog:** `src/conversation/function-executor.ts` lines 82–100 (tool dispatcher) + existing tool handlers

**Tool dispatcher pattern** (lines 82–100):
```typescript
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  // T-02-12: cross-tenant check before any tool logic
  if ('business_id' in args && args.business_id !== context.business.id) {
    logger.warn({ tool: name, argsBusinessId: args.business_id, contextBusinessId: context.business.id }, 'cross_tenant_denied');
    return { error: 'cross_tenant_denied' };
  }

  try {
    switch (name) {
      case 'check_availability':
        return await checkAvailabilityTool(args, context);
      case 'book_appointment':
        return await bookAppointmentTool(args, context);
      case 'cancel_appointment':
        return await cancelAppointmentTool(args, context);
      case 'reschedule_appointment':
        return await rescheduleAppointmentTool(args, context);
      case 'list_client_bookings':
        return await listClientBookingsTool(context);
      // ADD THIS CASE:
      // case 'check_membership_balance':
      //   return await checkMembershipBalanceTool(args, context);
      default:
        return { error: `Tool '${name}' not found` };
    }
  } catch (error) {
    logger.error({ err: error, tool: name, args }, 'Tool execution threw unexpectedly');
    return { error: (error as Error).message || 'internal_error' };
  }
}
```

**Tool handler pattern with Zod validation** (from lines 40–64, 102–113):
```typescript
const CheckAvailabilityArgsSchema = z.object({
  business_id: z.number().int(),
  service_id: z.number().int(),
  calendar_date: z.string(),
});

async function checkAvailabilityTool(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  const parsed = CheckAvailabilityArgsSchema.parse(args);
  const result = await checkAvailability(context.business.id, parsed.service_id, parsed.calendar_date);
  return result as unknown as Record<string, unknown>;
}
```

**ToolContext interface** (lines 20–32):
```typescript
export interface ToolContext {
  business: { id: number; name: string; ownerTelegramId: string | null; enforcementPolicy?: string };
  clientPhone: string;
  requestId: string;
  idempotencyKey: string;
}
```

**For the check_membership_balance handler, reference:**
- `src/billing/queries.ts` function `getActiveMembershipForDeduction()` (lines 330–348) for membership lookup pattern
- Context usage pattern: all tools have access to `context.business.id`, `context.clientPhone`, `context.business.name`

---

### `src/database/schema.ts` (extend with `membershipExpiryNotifications` table)

**Analog:** `src/database/schema.ts` lines 301–327 (`membershipLedger` table) AND lines 239–265 (`billingPackages` table)

**Dedup table structure** (inspired by `membershipLedger` lines 301–327):
```typescript
export const membershipExpiryNotifications = pgTable(
  'membership_expiry_notifications',
  {
    id: serial('id').primaryKey(),
    membershipId: integer('membership_id')
      .notNull()
      .references(() => memberships.id),
    notificationType: text('notification_type').notNull(), // '7_day' (both client and owner)
    expiryDate: text('expiry_date').notNull(), // YYYY-MM-DD Athens calendar date
    sentAt: timestamp('sent_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('unique_membership_expiry_notification')
      .on(table.membershipId, table.notificationType, table.expiryDate),
  ]
);
```

**UNIQUE constraint pattern** (from `billingPackages` table lines 259–265):
```typescript
  (table) => [
    // Partial index — WHERE is_active = true allows re-use of names on deactivated packages
    uniqueIndex('unique_active_package_name')
      .on(table.businessId, table.name)
      .where(sql`is_active = true`),
  ]
```

**Reference:** The dedup table does NOT use a partial index (unlike billingPackages); it uses a full UNIQUE on `(membershipId, notificationType, expiryDate)` because dedup should be absolute per membership per notification type per expiry date, with no soft-delete carve-outs.

---

### `src/billing/queries.ts` (extend with expiry-related queries)

**Analog:** `src/billing/queries.ts` lines 243–312 (`createMembership` function with timezone utilities)

**Query 1: Find memberships expiring in 7 days** (follows pattern from `getActiveMembershipForDeduction` lines 330–348):
```typescript
export async function findMembershipsExpiringIn7Days(businessId: number): Promise<ExpiringMembership[]> {
  const now = new Date();
  const nowIso = isoDateInAthens(now);
  const sevenDaysFromNowIso = addCalendarDays(nowIso, 7);
  // End-of-day in Athens; use the same +02:00 offset as createMembership (line 265)
  const windowEnd = new Date(`${sevenDaysFromNowIso}T23:59:59+02:00`);

  return db
    .select({
      id: memberships.id,
      clientPhone: memberships.clientPhone,
      businessId: memberships.businessId,
      expiresAt: memberships.expiresAt,
      sessionsRemaining: memberships.sessionsRemaining,
      // clientName for owner notification
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.businessId, businessId),
        eq(memberships.isActive, true),
        lte(memberships.expiresAt, windowEnd),
        gt(memberships.expiresAt, now) // not already expired
      )
    );
}
```

**Query 2: Insert dedup row** (uses `onConflictDoNothing` pattern from `membershipLedger` inserts, lines 428–438):
```typescript
export async function insertMembershipExpiryNotification(
  membershipId: number,
  notificationType: '7_day',
  expiryDate: string
): Promise<boolean> {
  const result = await db
    .insert(membershipExpiryNotifications)
    .values({ membershipId, notificationType, expiryDate })
    .onConflictDoNothing()
    .returning({ id: membershipExpiryNotifications.id });
  
  return result.length > 0; // true if inserted, false if conflict (already notified)
}
```

**Timezone utilities** (both already in codebase, from `src/utils/timezone.ts`):
```typescript
import { isoDateInAthens, addCalendarDays } from '../utils/timezone';
// isoDateInAthens(date: Date): string — returns "YYYY-MM-DD" in Athens timezone
// addCalendarDays(isoDate: string, days: number): string — DST-safe addition
```

**Database import pattern** (from `src/billing/queries.ts` lines 6–19):
```typescript
import { and, desc, eq, gt, gte, sql } from 'drizzle-orm';
import { db } from '../database/db';
import {
  billingPackages,
  memberships,
  membershipLedger,
  // ... add membershipExpiryNotifications when table is defined
} from '../database/schema';
```

---

### `src/server.ts` (extend with poller registration)

**Analog:** `src/server.ts` lines 6–9 (imports) and lines 36–39 (registration)

**Import pattern** (lines 6–9):
```typescript
import { startExpiryPoller } from './conversation/expiry-poller';
import { startCalendarSyncPoller } from './calendar/poller';
import { startAgendaPoller } from './scheduler/agenda';
import { startReminderPoller } from './scheduler/reminders';
// ADD THIS IMPORT:
// import { startMembershipExpiryPoller } from './scheduler/membership-expiry';
```

**Poller registration pattern** (lines 29–40):
```typescript
// D-09 pending-booking expiry sweep. Guarded against the Jest test
// environment: an unguarded setInterval would keep the Jest process alive
// (open-handle warning) since telegram-webhook.test.ts imports this module
// transitively via supertest. config.nodeEnv can never be 'test' (config.ts
// collapses it to 'development'), so JEST_WORKER_ID — which Jest always sets
// — is the only real signal here.
if (!process.env.JEST_WORKER_ID) {
  startExpiryPoller();
  startCalendarSyncPoller();
  startAgendaPoller();
  startReminderPoller();
  // ADD THIS CALL:
  // startMembershipExpiryPoller();
}
```

**Key:** The `JEST_WORKER_ID` guard is critical — it prevents the poller's `setInterval` from keeping Jest alive after tests complete.

---

## Shared Patterns

### Timezone Utilities (Apply to Membership Expiry Sweep)

**Source:** `src/utils/timezone.ts` (entire file)

**When to use:** Any calculation involving Athens calendar dates or rolling windows.

```typescript
import { isoDateInAthens, addCalendarDays } from '../utils/timezone';

// Compute 7-day rolling window boundary
const now = new Date();
const nowIso = isoDateInAthens(now); // "YYYY-MM-DD" in Athens
const windowEndIso = addCalendarDays(nowIso, 7); // Add 7 calendar days (DST-safe)
const windowEndTimestamp = new Date(`${windowEndIso}T23:59:59+02:00`); // End-of-day
```

**Source file:** `src/utils/timezone.ts` lines 8–31

---

### Telegram Context Wrapping with `botTokenStore.run()`

**Source:** `src/conversation/expiry-poller.ts` lines 49–63

**When to use:** Any Telegram API call from a poller (or any code path without inherited AsyncLocalStorage context).

```typescript
import { botTokenStore, sendTelegramMessage } from '../telegram/client';

// CRITICAL: All Telegram calls must be wrapped
await botTokenStore.run(business.botToken, async () => {
  await sendTelegramMessage(membership.clientPhone, greekMessage);
});
```

**Why:** Pollers have no inherited context from the webhook handler, so `botTokenStore.getStore()` returns null. The wrapper ensures `sendTelegramMessage()` can retrieve the correct per-business token.

**Anti-pattern (WRONG):**
```typescript
// DO NOT DO THIS — botToken is captured in closure but botTokenStore is empty:
await sendTelegramMessage(clientPhone, message); // Will throw "botTokenStore context required"
```

---

### Dedup via `onConflictDoNothing()`

**Source:** `src/billing/queries.ts` lines 428–438 (`deductSession` function)

**When to use:** Idempotent inserts where a UNIQUE constraint should silently succeed on replay.

```typescript
const result = await db
  .insert(membershipExpiryNotifications)
  .values({ membershipId, notificationType, expiryDate })
  .onConflictDoNothing()
  .returning({ id: membershipExpiryNotifications.id });

// Check the return value to determine if the insert was new or a replay:
if (result.length > 0) {
  // Newly inserted — send the notification
  notificationCount += 1;
} else {
  // Conflict — already notified, skip
}
```

**Why:** The UNIQUE constraint is checked atomically at the DB level. No race condition between "check if exists" and "insert".

---

### Per-Business Try/Catch Isolation

**Source:** `src/scheduler/reminders.ts` lines 124–177 (nested loops)

**When to use:** Pollers with outer per-business loop and inner per-item loop.

```typescript
for (const businessId of businessIds) {
  try {
    // Business-level operations (e.g., fetch business token)
    const business = await findBusinessById(businessId);
    if (!business?.botToken) {
      logger.warn({ businessId }, 'No bot token');
      continue;
    }

    for (const item of items) {
      try {
        // Item-level operations (e.g., send notification)
        // One item failure never blocks the rest
      } catch (err) {
        logger.error({ err, itemId: item.id, businessId }, 'Item operation failed');
      }
    }
  } catch (err) {
    logger.error({ err, businessId }, 'Business sweep failed');
  }
}
```

**Why:** A network blip on one Telegram send doesn't silence notifications for other clients or other businesses.

---

## No Analog Found

All Phase 9 patterns have close analogs in the codebase. No new patterns required.

---

## Metadata

**Analog search scope:**
- `src/scheduler/` — 3 files analyzed (reminders.ts, agenda.ts)
- `src/conversation/` — 2 files analyzed (function-executor.ts, expiry-poller.ts)
- `src/database/` — 2 files analyzed (schema.ts, queries.ts)
- `src/billing/` — 1 file analyzed (queries.ts)
- `src/telegram/` — 1 file analyzed (client.ts)
- `src/utils/` — 1 file analyzed (timezone.ts)
- `src/` — 1 file analyzed (server.ts)

**Files scanned:** 11
**Pattern extraction date:** 2026-07-21

---

*Phase 9: Expiry Notifications & Client Balance*
*Patterns mapped. Ready for planning.*
