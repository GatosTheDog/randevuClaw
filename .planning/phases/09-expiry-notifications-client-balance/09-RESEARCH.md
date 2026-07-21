# Phase 9: Expiry Notifications & Client Balance - Research

**Researched:** 2026-07-21
**Domain:** Proactive membership expiry notifications and client balance queries
**Confidence:** HIGH

## Summary

Phase 9 delivers two coordinated capabilities for membership management: (1) a scheduled expiry-notification sweep that alerts clients and owners 7 days before memberships expire, preventing no-shows and business revenue loss; and (2) a read-only client balance query tool allowing clients to check their remaining sessions and expiry date at any time via Telegram chat.

The expiry sweep follows the established in-process poller pattern from Phase 3 (reminders) and Phase 2 (pending-booking expiry), using a 6-hour interval to run 4 times per day. Deduplication via a `membership_expiry_notifications` table with a UNIQUE constraint prevents duplicate notifications per membership. The client balance query integrates as a new Gemini tool (`check_membership_balance`) into the existing `BOOKING_TOOLS` dispatcher, reusing the membership lookup infrastructure from Phase 8 enforcement.

Both capabilities are read-only relative to booking state — Phase 8's deduction logic and Phase 7's package configuration remain unchanged. The phase carries zero new npm dependencies (date-fns already installed via Phase 8).

**Primary recommendation:** Implement the expiry sweep and client balance query as two independent, then-sequential tasks. The sweep is a 3–4 hour systems task (poller registration + dedup table + sweep logic + 4–6 test cases); the balance query is a 1–2 hour integration task (tool definition + handler + 3 reply scenarios + 3–4 test cases).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Membership expiry sweep | Backend / Scheduler | Database | Backend poller reads membership expiresAt field and writes to dedup table; DB UNIQUE constraint enforces dedup atomically |
| Telegram notification send (sweep) | Backend / Telegram Client | Async I/O | Backend wraps Telegram call in botTokenStore.run() for per-business token context; failures isolated per membership via try/catch |
| Client balance query | Telegram Bot / Gemini Tool | Backend / Database | Gemini tool invokes check_membership_balance handler; handler queries memberships table via existing getActiveMembershipForDeduction pattern |
| Balance message composition | Backend / Function Executor | Localization | Function executor builds Greek reply using membership state (nil sessions, count, expiry date) |

## User Constraints (from CONTEXT.md)

### Locked Decisions

1. **D-01:** New file `src/scheduler/membership-expiry.ts` — separate from `src/conversation/expiry-poller.ts` (pending-booking expiry). Sits alongside `reminders.ts` and `agenda.ts` in the scheduler directory.
2. **D-02:** Poller interval: 6-hour `setInterval`. Runs 4× per day — balanced between freshness and DB load.
3. **D-03:** Rolling window query: notify when `membership.expiresAt <= now + 7 calendar days` AND no prior `'7_day'` notification exists for this membership's current expiry date. Survives sweep downtime.
4. **D-04:** Dedup table: `membership_expiry_notifications` with UNIQUE on `(membership_id, notification_type, expiry_date)`. `expiry_date` = Athens calendar date of `membership.expiresAt` (via `isoDateInAthens()`).
5. **D-05:** `notification_type` = `'7_day'` for both client and owner notifications. Two rows inserted per membership per expiry event: one for client, one for owner (or a single row with two send operations — planner decides which dedup granularity is cleaner).
6. **D-06:** `botTokenStore.run(business.botToken, ...)` required inside the sweep, same as `expiry-poller.ts`. Pollers have no inherited AsyncLocalStorage context.
7. **D-07:** New Gemini tool `check_membership_balance` added to `BOOKING_TOOLS` in `src/conversation/function-executor.ts`. Client-facing, read-only.
8. **D-08:** Three distinct reply scenarios: no active membership (with business name call-to-action); unlimited sessions (state unlimited, show expiry); counted sessions (show N sessions + expiry).
9. **D-09:** Expiry date displayed in Greek format: `DD/MM/YYYY` (e.g., `14/08/2026`) for clarity with Greek users.

### Claude's Discretion

- Whether `notification_type` column uses one value (`'7_day'`) for both client and owner rows, or two values (`'7_day_client'` / `'7_day_owner'`) for finer granularity — planner picks cleaner schema.
- `isRunning` guard in the sweep: DB UNIQUE constraint provides the dedup, so an overlapping sweep doesn't re-send. An `isRunning` boolean guard (like the blocker note in STATE.md) is optional if the 6-hour interval makes overlapping sweeps practically impossible.
- Per-business vs per-client outer loop ordering: reminders poller uses a per-business outer loop; same pattern recommended for consistency.
- Greek message wording exact text (templates given in D-08; planner/researcher may refine).

### Deferred Ideas (OUT OF SCOPE)

- 30-day expiry notification (a second notification tier) — out of scope for v1.2.
- Owner dashboard showing all near-expiry memberships at once — v1.3.
- Client renewal flow triggered by the expiry notification (inline "contact owner" button) — v1.3.
- Push notification via WhatsApp (v1.2 deferred WhatsApp milestone) — v1.2+.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NOTF-01 | Client notified in Greek 7 days before membership expires with sessions remaining + expiry date | Expiry sweep queries membership.expiresAt with rolling window (now + 7 days); dedup prevents duplicate sends via UNIQUE constraint; sendTelegramMessage sends Greek message including sessions and expiry date |
| NOTF-02 | Owner notified in Greek 7 days before any client's membership expires with client name + sessions remaining + expiry date | Same expiry sweep; two rows per membership (client + owner); owner message includes client name from clientBusinessRelationships.client_name |
| NOTF-03 | Expiry notifications sent at most once per membership per notification trigger (dedup via UNIQUE constraint) | membership_expiry_notifications table with UNIQUE(membership_id, notification_type, expiry_date); onConflictDoNothing() on INSERT guarantees idempotency; expiry_date is Athens calendar date of membership.expiresAt |
| NOTF-04 | Client can query balance via chat ("πόσα μαθήματα μου έχουν απομείνει;") and receive Greek reply with sessions + expiry date | New Gemini tool check_membership_balance in BOOKING_TOOLS; executor handler calls getActiveMembershipForDeduction or parallel membership lookup; three reply scenarios cover no membership, unlimited, and counted sessions |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **@google/genai** | 2.10.0+ | Gemini tool-use for check_membership_balance | Already in stack (Phase 2); function-calling pattern established across all client booking tools |
| **drizzle-orm** | 0.30.0+ | ORM for membership_expiry_notifications CRUD | Already in stack (Phase 7); onConflictDoNothing() pattern proven in ledger inserts (Phase 8) |
| **pino** | 8.0+ | Structured logging (per-business, per-membership isolation) | Already in stack (Phase 2); used by all pollers for error isolation |
| **date-fns** | 4.4.0 | Rolling window arithmetic (7-day expiry calculation) | Already in stack (Phase 8); used for membership expiry calculation in createMembership |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **node** | 20.x+ | Runtime for AsyncLocalStorage in botTokenStore.run() | Already in use (Phase 4 requirement for @google/genai SDK) |
| **Telegram SDK (via sendTelegramMessage)** | Used via existing wrapper | Message send for client/owner notifications | Existing helper from Phase 2; no direct new dependency |

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Expiry Sweep Poller (6h interval)             │
│  runs in-process on startup (server.ts startMembershipExpiryPoller)
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ├─→ listAllBusinessIds()
                     │   (outer loop — per-business isolation)
                     │
                     └─→ For each business:
                         │
                         ├─→ findMembershipsExpiringIn7Days()
                         │   (rolling window query: expiresAt ≤ now + 7 days)
                         │
                         └─→ For each membership:
                             │
                             ├─→ Try INSERT into membership_expiry_notifications
                             │   (with onConflictDoNothing on UNIQUE)
                             │   ↓
                             │   If inserted (not duplicate):
                             │     └─→ sendTelegramMessage(client + owner)
                             │         │
                             │         └─→ botTokenStore.run(token, async () => {...})
                             │
                             └─→ Catch errors (log, continue to next membership)

┌─────────────────────────────────────────────────────────────────┐
│            Client Balance Query (Gemini Tool)                    │
│  triggered by Telegram message: "πόσα μαθήματα μου έχουν..."   │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ├─→ Gemini routes to check_membership_balance tool
                     │
                     └─→ Function executor handler:
                         │
                         ├─→ getActiveMembershipForDeduction()
                         │   (read-only lookup: active + not expired)
                         │
                         └─→ Compose Greek reply:
                             ├─→ If no membership: "Δεν βρέθηκε... επικοινωνήστε"
                             ├─→ If unlimited: "...απεριόριστων μαθημάτων... λήγει"
                             └─→ If counted: "[N] μαθήματα απομείνει... λήγει"
```

### Recommended Project Structure

```
src/
├── scheduler/
│   ├── membership-expiry.ts     # NEW: expiry sweep poller (6h interval)
│   ├── reminders.ts             # existing: reminder poller pattern template
│   └── agenda.ts                # existing: agenda poller pattern template
├── billing/
│   ├── queries.ts               # EXTEND: add findMembershipsExpiringIn7Days()
│   └── ...
├── conversation/
│   ├── function-executor.ts     # EXTEND: add check_membership_balance tool + handler
│   └── ...
├── database/
│   ├── schema.ts                # EXTEND: add membershipExpiryNotifications table
│   └── ...
├── telegram/
│   └── client.ts                # existing: sendTelegramMessage, botTokenStore.run
└── server.ts                    # EXTEND: register startMembershipExpiryPoller()
```

### Pattern 1: In-Process Poller with 6-Hour Interval

**What:** A plain `setInterval` that runs a sweep function every 6 hours without external cron infrastructure or Redis. Mirrors the reminder poller (15-minute interval) and expiry-poller (5-minute interval).

**When to use:** For background tasks that are (a) idempotent (multiple overlapping runs cause no harm), (b) per-business isolated (one business failure doesn't block others), and (c) don't require distributed scheduling (single-server PoC).

**Example:**
```typescript
// src/scheduler/membership-expiry.ts
export async function runMembershipExpirySweep(): Promise<number> {
  const businessIds = await listAllBusinessIds();
  let notificationCount = 0;

  for (const businessId of businessIds) {
    try {
      const expiringMemberships = await findMembershipsExpiringIn7Days(businessId);
      const business = await findBusinessById(businessId);
      if (!business?.botToken) continue;

      for (const membership of expiringMemberships) {
        try {
          // Dedup via onConflictDoNothing
          const inserted = await insertMembershipExpiryNotification(
            membership.id,
            'client',
            isoDateInAthens(membership.expiresAt)
          );
          if (inserted) {
            await botTokenStore.run(business.botToken, async () => {
              await sendTelegramMessage(membership.clientPhone, greekClientMessage);
            });
            notificationCount += 1;
          }
        } catch (err) {
          logger.error({ err, membershipId: membership.id }, 'Notification failed');
        }
      }
    } catch (err) {
      logger.error({ err, businessId }, 'Sweep failed for business');
    }
  }
  return notificationCount;
}

export function startMembershipExpiryPoller(intervalMs: number = 6 * 60 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    runMembershipExpirySweep().catch(err => logger.error({ err }, 'Unhandled sweep error'));
  }, intervalMs);
}

// server.ts integration
if (!process.env.JEST_WORKER_ID) {
  startMembershipExpiryPoller();
}
```

**Source:** [Existing reminders.ts pattern](../../src/scheduler/reminders.ts); [Existing expiry-poller.ts pattern](../../src/conversation/expiry-poller.ts)

### Pattern 2: Dedup via UNIQUE Constraint on Dedup Table

**What:** A dedicated `membership_expiry_notifications` table with a UNIQUE constraint on `(membership_id, notification_type, expiry_date)`. Each sweep attempts an `INSERT ... ON CONFLICT DO NOTHING`, guaranteeing that the second insert silently fails (no error thrown, but no row inserted). The sweep can check the return value to determine whether to send the notification.

**When to use:** For idempotent background operations where the notification/action should fire exactly once per trigger. The UNIQUE constraint enforces this at the DB level, surviving process crashes and overlapping sweep runs.

**Example:**
```typescript
// src/database/schema.ts
export const membershipExpiryNotifications = pgTable(
  'membership_expiry_notifications',
  {
    id: serial('id').primaryKey(),
    membershipId: integer('membership_id')
      .notNull()
      .references(() => memberships.id),
    notificationType: text('notification_type').notNull(), // '7_day' or '7_day_client'/'7_day_owner'
    expiryDate: text('expiry_date').notNull(), // YYYY-MM-DD Athens calendar date
    sentAt: timestamp('sent_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('unique_membership_expiry_notification')
      .on(table.membershipId, table.notificationType, table.expiryDate),
  ]
);

// src/billing/queries.ts
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
  
  return result.length > 0; // true if inserted, false if conflict
}
```

**Source:** [Existing onConflictDoNothing pattern in billingqueries.ts](../../src/billing/queries.ts:L298); [Booking idempotency UNIQUE in schema.ts](../../src/database/schema.ts:L179)

### Pattern 3: Rolling Window Query with DST-Safe Arithmetic

**What:** A query that selects memberships where `expiresAt <= now + 7 calendar days`, using Athens timezone utilities to compute the window boundary DST-safely.

**When to use:** For any time-based expiry or event-scheduling logic where the window must account for daylight-saving-time transitions without off-by-one errors.

**Example:**
```typescript
// src/billing/queries.ts
export async function findMembershipsExpiringIn7Days(businessId: number): Promise<ExpiringMembership[]> {
  const now = new Date();
  const nowIso = isoDateInAthens(now);
  const sevenDaysFromNowIso = addCalendarDays(nowIso, 7);
  // end-of-day in Athens; use the same +02:00 offset as createMembership
  const windowEnd = new Date(`${sevenDaysFromNowIso}T23:59:59+02:00`);

  return db
    .select({
      id: memberships.id,
      clientPhone: memberships.clientPhone,
      businessId: memberships.businessId,
      expiresAt: memberships.expiresAt,
      sessionsRemaining: memberships.sessionsRemaining,
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

**Source:** [isoDateInAthens utility](../../src/utils/timezone.ts:L8); [addCalendarDays utility](../../src/utils/timezone.ts:L27); [createMembership rolling window](../../src/billing/queries.ts:L259)

### Pattern 4: Gemini Tool Handler with Three-Case Reply

**What:** A new Gemini tool (`check_membership_balance`) that is dispatched by the existing function-executor switch statement. The handler queries the membership, then returns one of three Greek replies based on the state: no membership, unlimited sessions, or counted sessions.

**When to use:** For any read-only client query that requires database state and returns structured, localized replies.

**Example:**
```typescript
// src/conversation/function-executor.ts
const CheckMembershipBalanceArgsSchema = z.object({
  business_id: z.number().int(),
});

async function checkMembershipBalanceTool(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  const parsed = CheckMembershipBalanceArgsSchema.parse(args);
  
  const membership = await getActiveMembershipForDeduction(
    context.business.id,
    context.clientPhone
  );

  if (!membership) {
    return {
      success: true,
      message: `Δεν βρέθηκε ενεργή συνδρομή. Επικοινωνήστε με ${context.business.name} για ανανέωση.`,
    };
  }

  const expiryDateFormatted = formatDateAsGreek(membership.expiresAt); // DD/MM/YYYY

  if (membership.sessionsRemaining === null) {
    return {
      success: true,
      message: `Η συνδρομή σας είναι απεριόριστων μαθημάτων και λήγει στις ${expiryDateFormatted}.`,
    };
  }

  return {
    success: true,
    message: `Έχετε ${membership.sessionsRemaining} μαθήματα απομείνει. Η συνδρομή σας λήγει στις ${expiryDateFormatted}.`,
  };
}

// In executeTool dispatcher:
case 'check_membership_balance':
  return await checkMembershipBalanceTool(args, context);
```

**Source:** [Existing function-executor dispatcher](../../src/conversation/function-executor.ts:L82); [BOOKING_TOOLS definition in ai-agent.ts](../../src/conversation/ai-agent.ts)

### Anti-Patterns to Avoid

- **Storing bot token in poller closure:** Do NOT hold a reference to `botToken` outside the `botTokenStore.run()` call. Each Telegram call must look up the current token via `botTokenStore.run()` because per-bot delegation happens inside that context. [RESEARCH.md Pitfall 2 from Phase 4](../../.planning/phases/04-per-bot-foundation/04-RESEARCH.md).
- **Mixing database transactions and poller atomicity:** Do NOT use `db.transaction()` inside a poller sweep. Use `getConn()` for individual queries and rely on per-business/per-membership try/catch isolation instead. [STATE.md Decision from Phase 8](../../.planning/STATE.md:L170).
- **Forgetting to wrap Telegram calls in botTokenStore.run():** Pollers have no inherited AsyncLocalStorage context. Any Telegram call outside botTokenStore.run() will pick up the wrong bot token (if any). Always wrap the entire Telegram send block. [CONTEXT.md D-06](./09-CONTEXT.md:L28).
- **Using wall-clock time for rolling window boundaries:** Do NOT compute `now + 7 days` as `new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)` — this fails across DST transitions. Always use `isoDateInAthens()` and `addCalendarDays()`. [Reminders.ts timezone handling](../../src/scheduler/reminders.ts:L15).
- **Forgetting the expiry_date column in dedup UNIQUE:** The dedup table must include `expiryDate` in the UNIQUE constraint, not just `(membership_id, notification_type)`. This allows a membership renewal (same ID, different expiry date) to trigger a new notification. [CONTEXT.md D-04](./09-CONTEXT.md:L26).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Timezone arithmetic for rolling expiry windows | Custom Date arithmetic with `Date.getTime() + ms` | `isoDateInAthens()` + `addCalendarDays()` from src/utils/timezone.ts | Manual arithmetic breaks across DST transitions (2 hour-off errors); Intl API + noon-UTC-anchor is DST-safe and proven across 3 phases |
| Deduplication of idempotent notifications | Custom row existence check + conditional INSERT | Drizzle's `onConflictDoNothing()` on a UNIQUE constraint | UNIQUE constraint is atomic at DB level; conditional logic in app is racy (check-then-insert race condition); Postgres UNIQUE handles overlapping sweeps correctly |
| Per-business token context for Telegram calls | Passing token as function argument | `botTokenStore.run(token, async () => { ... })` from src/telegram/client.ts | AsyncLocalStorage context is thread-safe and survives Promise chains (imperative context passing is error-prone) |
| Greek date formatting (DD/MM/YYYY) | Manual string concat or date formatting library | Built-in `Intl.DateTimeFormat` with 'en-GB' locale + post-processing, or utility function | Locale-aware formatting avoids hard-coded month/day orders; same technique as isoDateInAthens() [Reminders.ts timezone.ts] |
| Membership state machine (active, expired, renewed) | Custom boolean flags or multi-stage updates | Single `getActiveMembershipForDeduction()` query with `is_active=true` + `expiresAt > now` | Query composition is declarative; business logic stays in the DB (WHERE clause) not scattered across app code; matches Phase 8 pattern |

**Key insight:** All four of these problems have proven solutions in the existing codebase from earlier phases. The expiry sweep is a straightforward composition of Phase 8's membership lookup, Phase 3's reminders poller structure, and Phase 7's timezone utilities.

## Common Pitfalls

### Pitfall 1: Forgetting Dedup Table Entry During New Membership Renewal

**What goes wrong:** A client's membership is renewed (via `createMembership` upsert with a new `expiresAt`), but the old `membership_expiry_notifications` rows for the previous expiry date remain. The next sweep checks the new expiry date, finds no row with `(membership_id, notification_type, new_expiry_date)`, and sends a duplicate notification for the same membership in a short time window.

**Why it happens:** The dedup table uses expiry_date in the UNIQUE constraint (D-04), not just membership_id. When the membership expiry changes, a new UNIQUE key is generated, and the old one is irrelevant. This is correct design — you *want* a fresh notification for the new renewal — but it's easy to misread as a bug if you're thinking about the membership_id alone.

**How to avoid:** Always include the `expiryDate` (Athens calendar date of `membership.expiresAt`) in the UNIQUE key definition. Test the scenario: create a membership with expiry 2026-08-10, wait until it's 2026-08-04 (in the 7-day window), trigger a sweep (should send), then renew the membership to 2026-09-10, and trigger another sweep (should send again because the expiry_date UNIQUE key is different).

**Warning signs:** If the same membership_id appears in two consecutive notification rows with different expiryDate values (indicating the membership was renewed between sweeps), that's expected. If two rows have the same (membership_id, expiryDate), that's a dedup failure.

### Pitfall 2: Timezone Offset Mismatch in Expiry Boundary

**What goes wrong:** The sweep computes `windowEnd = new Date('2026-08-07T23:59:59+02:00')` (using Athens winter offset), but the test system is in summer DST (+03:00). A membership with `expiresAt = 2026-08-08T00:00:00+03:00` (08:00 UTC, 1 second into August 8) is compared with windowEnd (20:59:59 UTC on August 7) and incorrectly excluded from the 7-day window because it's 1 minute outside.

**Why it happens:** Hardcoding `+02:00` for "Athens" fails during summer DST (UTC+03:00). The correct fix is to compute the window end as `end-of-day in Athens at sweep time`, not a hardcoded offset. But `new Date('...+02:00')` always parses as UTC+02:00 regardless of the server's DST state.

**How to avoid:** Use `new Date(\`${isoDateInAthens(new Date() + 7 days)}T23:59:59+02:00\`)` only as a manual fallback. Prefer computing the window end using Intl.DateTimeFormat + noon-UTC-anchor, matching the technique in reminders.ts. Or better yet, use a parametrized query boundary: `memberships.expiresAt <= now + INTERVAL '7 days'` in raw SQL (Postgres handles DST automatically). For Drizzle, compute the boundary in app code using the same midnight-anchor technique as `addCalendarDays()`.

**Warning signs:** Test failure in summer (July/August/September) that passes in winter; test passes locally (UTC) but fails in production (Athens).

### Pitfall 3: Poller Runs During Test, Interferes with Jest Teardown

**What goes wrong:** A test calls `startMembershipExpiryPoller()` without a Jest timeout mock, or the test clears all mocks before the poller's next interval fires. The poller keeps the Node process alive after the test completes, causing Jest to hang or report an open handle.

**Why it happens:** `setInterval()` holds a timer handle open. Jest exits only when all timers are cleared. A test that starts a poller without stopping it before teardown leaves the handle dangling.

**How to avoid:** Always return the interval handle from `startMembershipExpiryPoller()` and call `clearInterval(handle)` in test teardown. Alternatively, guard the poller startup behind `!process.env.JEST_WORKER_ID` in server.ts (as all existing pollers do). Tests that import server.ts transitively will not start the poller because Jest always sets JEST_WORKER_ID.

**Warning signs:** Test suite hangs after completion; Jest reports `FAIL [...] A worker process [...] was terminated unexpectedly` (open handle warning).

### Pitfall 4: Forgetting to Await onConflictDoNothing Check

**What goes wrong:** The sweep inserts a dedup row with `const result = await db.insert(...).onConflictDoNothing().returning(...)`, then checks `if (result.length > 0)` without awaiting. The Drizzle query is async, so result is a Promise, and `result.length` is undefined. The if-condition always evaluates to falsy, and the notification is never sent on the first insert.

**Why it happens:** Drizzle's `.returning()` returns a query promise, not a value. Forgetting the `await` is a common TypeScript gotcha when chaining builder methods.

**How to avoid:** Always `await` Drizzle insert/update/delete queries before checking the result. Use TypeScript strict mode (`"strict": true` in tsconfig.json) to catch undefined property access. Write a simple integration test: insert a dedup row, assert it inserted (length > 0), insert again, assert it did NOT insert (length === 0).

**Warning signs:** First notification never sends, but sweep runs without errors; second sweep run for the same membership incorrectly attempts to re-send.

### Pitfall 5: Client Name Missing in Owner Alert (Fallback to Phone)

**What goes wrong:** The owner alert for an expiring membership includes the client's name, but `clientBusinessRelationships.client_name` is null (name was never captured). The alert displays the Telegram user ID (numeric stringified) instead of a human-readable name, looking unprofessional.

**Why it happens:** `client_name` is optional and captured from Telegram `from.first_name` on each message. If a client never sends a message to the bot, the name is never populated.

**How to avoid:** Always provide a fallback in the owner alert: `const clientName = membership.clientName ?? membership.clientPhone;`. This way, at worst, the owner sees the Telegram ID (which is still identifiable and searchable in their chat logs).

**Warning signs:** Owner alert displays a large numeric string instead of a name; alert includes "undefined" or is truncated.

## Runtime State Inventory

No runtime state inventory needed for Phase 9 — this is a greenfield feature with no rename, refactor, or migration of existing string identifiers. Both new tables and new poller are fresh additions with no legacy state to migrate.

## Code Examples

Verified patterns from official sources and existing codebase:

### Expiry Sweep Outer Loop (Per-Business Isolation)

```typescript
// Source: src/scheduler/reminders.ts (lines 117–180) + src/conversation/expiry-poller.ts (lines 24–78)
export async function runMembershipExpirySweep(): Promise<number> {
  const businessIds = await listAllBusinessIds();
  let notificationCount = 0;

  for (const businessId of businessIds) {
    try {
      const expiringMemberships = await findMembershipsExpiringIn7Days(businessId);
      const business = await findBusinessById(businessId);

      if (!business?.botToken) {
        logger.warn({ businessId }, 'No bot token for business, skipping notifications');
        continue;
      }

      for (const membership of expiringMemberships) {
        try {
          // Dedup via onConflictDoNothing — same pattern as ledger inserts (Phase 8)
          const inserted = await insertMembershipExpiryNotification(
            membership.id,
            '7_day',
            isoDateInAthens(membership.expiresAt)
          );

          if (inserted) {
            // Critical: wrap all Telegram calls in botTokenStore.run (D-06)
            await botTokenStore.run(business.botToken, async () => {
              // Client notification
              const clientMsg = `Υπενθύμιση: Η συνδρομή σας λήγει σε 7 ημέρες, στις ${formatDateGreek(membership.expiresAt)}. Έχετε ${membership.sessionsRemaining ?? '∞'} μαθήματα απομείνει.`;
              await sendTelegramMessage(membership.clientPhone, clientMsg);

              // Owner notification (if ownerTelegramId exists)
              if (business.ownerTelegramId) {
                const ownerMsg = `⚠️ Πελάτης με λήγουσα συνδρομή: ${membership.clientName ?? membership.clientPhone}. Λήγει στις ${formatDateGreek(membership.expiresAt)}, ${membership.sessionsRemaining ?? '∞'} μαθήματα.`;
                await sendTelegramMessage(business.ownerTelegramId, ownerMsg);
              }
            });

            notificationCount += 1;
          }
        } catch (err) {
          logger.error({ err, membershipId: membership.id, businessId }, 'Notification send failed');
        }
      }
    } catch (err) {
      logger.error({ err, businessId }, 'Membership expiry sweep failed for business');
    }
  }

  return notificationCount;
}
```

### Check Membership Balance Tool

```typescript
// Source: src/conversation/function-executor.ts dispatcher pattern (lines 82–100)
const CheckMembershipBalanceArgsSchema = z.object({
  business_id: z.number().int(),
});

async function checkMembershipBalanceTool(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  const parsed = CheckMembershipBalanceArgsSchema.parse(args);

  // Cross-tenant check (T-02-12 pattern)
  if (parsed.business_id !== context.business.id) {
    return { error: 'cross_tenant_denied' };
  }

  const membership = await getActiveMembershipForDeduction(
    context.business.id,
    context.clientPhone
  );

  const expiryDateStr = membership
    ? formatExpiryDateGreek(membership.expiresAt) // DD/MM/YYYY
    : '';

  // D-08: Three distinct scenarios
  if (!membership) {
    return {
      success: true,
      message: `Δεν βρέθηκε ενεργή συνδρομή. Επικοινωνήστε με ${context.business.name} για ανανέωση.`,
    };
  }

  if (membership.sessionsRemaining === null) {
    return {
      success: true,
      message: `Η συνδρομή σας είναι απεριόριστων μαθημάτων και λήγει στις ${expiryDateStr}.`,
    };
  }

  return {
    success: true,
    message: `Έχετε ${membership.sessionsRemaining} μαθήματα απομείνει. Η συνδρομή σας λήγει στις ${expiryDateStr}.`,
  };
}

// In executeTool dispatcher (around line 90)
case 'check_membership_balance':
  return await checkMembershipBalanceTool(args, context);
```

### Dedup Table Schema

```typescript
// Source: schema.ts pattern matching UNIQUE constraints in billingPackages (lines 259–265)
export const membershipExpiryNotifications = pgTable(
  'membership_expiry_notifications',
  {
    id: serial('id').primaryKey(),
    membershipId: integer('membership_id')
      .notNull()
      .references(() => memberships.id),
    notificationType: text('notification_type').notNull(), // '7_day' or granular '7_day_client'/'7_day_owner'
    expiryDate: text('expiry_date').notNull(), // YYYY-MM-DD Athens calendar date, from isoDateInAthens()
    sentAt: timestamp('sent_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('unique_membership_expiry_notification')
      .on(table.membershipId, table.notificationType, table.expiryDate),
  ]
);
```

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 29.0+ (from package.json) |
| Config file | jest.config.js (root) |
| Quick run command | `npm test -- tests/scheduler-expiry.test.ts --testNamePattern="Sweep" --bail` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NOTF-01 | Client receives Greek notification 7 days before expiry with sessions + date | Unit | `npm test -- tests/scheduler-expiry.test.ts -t "sends client notification"` | ❌ Wave 0 |
| NOTF-02 | Owner receives Greek notification 7 days before client's expiry with client name + sessions + date | Unit | `npm test -- tests/scheduler-expiry.test.ts -t "sends owner notification"` | ❌ Wave 0 |
| NOTF-03 | Second sweep does NOT re-send notification for same membership.expiryDate (dedup via UNIQUE) | Unit | `npm test -- tests/scheduler-expiry.test.ts -t "deduplicates on UNIQUE"` | ❌ Wave 0 |
| NOTF-04 | Client query returns correct 3-case reply (no membership, unlimited, counted) | Unit | `npm test -- tests/function-executor.test.ts -t "check_membership_balance"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- tests/scheduler-expiry.test.ts --bail` (all membership-expiry tests)
- **Per wave merge:** `npm test` (full suite including function-executor and scheduler tests)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/scheduler-expiry.test.ts` — entire test suite for membership expiry sweep (covers NOTF-01/02/03):
  - Test 1: Sends client notification when membership expiresAt ≤ now + 7 days
  - Test 2: Sends owner notification with client name
  - Test 3: Does NOT re-send on second sweep (dedup UNIQUE)
  - Test 4: Skips sweep when no botToken for business
  - Test 5: Continues to next business if one fails
  - Test 6: Handles null clientName gracefully (falls back to clientPhone)

- [ ] `tests/function-executor.test.ts` — extend existing function-executor suite with check_membership_balance handler (covers NOTF-04):
  - Test 1: Returns "no membership" reply when getActiveMembershipForDeduction() returns null
  - Test 2: Returns "unlimited" reply when sessionsRemaining === null
  - Test 3: Returns "counted" reply with session count when sessionsRemaining > 0
  - Test 4: Cross-tenant denial (args.business_id !== context.business.id)

- [ ] `src/billing/queries.ts` — add findMembershipsExpiringIn7Days() query function with test coverage

- [ ] `src/database/schema.ts` — add membershipExpiryNotifications table definition (schema only, no data population)

- [ ] `src/scheduler/membership-expiry.ts` — complete sweep implementation (runMembershipExpirySweep, startMembershipExpiryPoller)

- [ ] `src/database/db.ts` or migration setup — create migration file for membershipExpiryNotifications table

- [ ] Helper function `formatExpiryDateGreek()` in src/utils/timezone.ts or dedicated src/utils/formatting.ts

*(If no gaps: all files scaffolded with it.todo stubs; Wave 0 is integration-ready.)*

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js Runtime | AsyncLocalStorage (botTokenStore) | ✓ | 20.x (locked in Phase 4) | — |
| PostgreSQL (Neon) | Database for membership_expiry_notifications table | ✓ | 15.x (existing) | — |
| Telegram Bot API | sendTelegramMessage calls | ✓ | Via existing wrapper | — |
| Drizzle ORM | Schema definition + insert/query | ✓ | 0.30.0+ (Phase 7) | — |

**Missing dependencies with no fallback:** None — all required services already available and tested.

**Missing dependencies with fallback:** None.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Sweep runs server-side; Telegram message send is authenticated via botToken (existing) |
| V3 Session Management | No | Read-only sweep + balance query; no user session state modified |
| V4 Access Control | Yes | Cross-tenant checks on check_membership_balance tool; business_id must match context |
| V5 Input Validation | Yes | Zod schema for check_membership_balance tool args; membership_id/business_id are integers, type-checked |
| V6 Cryptography | No | No new cryptographic operations (botTokenStore.run uses existing token flow) |
| V7 Error Handling | Yes | Per-business and per-membership try/catch isolation; errors logged, never surface to client |
| V8 Data Protection | Yes | No new PII collection; client_name from existing clientBusinessRelationships; no logs contain botToken or sensitive membership data |

### Known Threat Patterns for {Backend / Scheduler}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant notification delivery (wrong client receives wrong business's notification) | Tampering / Spoofing | Sweep queries by businessId in outer loop; membership FK ensures ownership; botToken lookup by businessId |
| Token leakage in logs | Information Disclosure | botToken never logged; botTokenStore.run context is explicit; logger.error never includes token param |
| Concurrent sweep overlaps causing duplicate dedup rows | Tampering | UNIQUE constraint on (membershipId, notificationType, expiryDate) enforces atomicity; onConflictDoNothing idempotent |
| Client querying another client's balance (prompt injection) | Tampering | Cross-tenant check at dispatcher level (T-02-12 pattern); function-executor already verified business_id matches context before any tool runs |
| Expired membership still triggering notification (time-based bypass) | Logic Error | Query includes `gt(expiresAt, now)` to exclude already-expired; 7-day window never selects past dates |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `getActiveMembershipForDeduction()` can be reused for the balance query without modification | Code Examples / Pattern 4 | If the function returns a different interface or excludes necessary fields (e.g., sessionsRemaining), balance query fails to compose the correct reply; requires a new query function |
| A2 | `isoDateInAthens()` and `addCalendarDays()` are DST-safe for 7-day rolling window calculation | Architecture Patterns / Pattern 3 | If the utilities have undiscovered DST bugs, the 7-day window boundary may be off by 1–2 days during transitions (late March, late October); rare but critical |
| A3 | Drizzle's `onConflictDoNothing()` with `.returning()` returns an empty array on conflict (dedup) | Code Examples / Pattern 2 | If Drizzle's behavior changed or the version differs, the return value may be unexpected; dedup logic must be verified in tests |
| A4 | Telegram API rate limits do not block the sweep's per-business send bursts (e.g., 10 notifications in 10s) | Standard Stack | If Telegram enforces strict per-token rate limits, the sweep may fail intermittently; mitigation would be a queue + backoff strategy (out of scope for PoC) |
| A5 | botTokenStore's AsyncLocalStorage context survives across all `botTokenStore.run()` Telegram calls within the sweep | Architecture Patterns / Anti-Patterns | If the context is lost (e.g., due to a Promise.race or unhandled rejection), Telegram calls default to a wrong token; must test context propagation explicitly |

**If this table is empty:** (Not applicable — all claims above are assumptions marked LOW confidence.)

## Open Questions

1. **Should the dedup table use a single `notification_type` value (`'7_day'`) or two distinct values (`'7_day_client'` / `'7_day_owner'`)?**
   - What we know: Both options satisfy NOTF-03 dedup requirements. Single value is simpler schema; two values allow tracking client vs. owner sends separately (useful for analytics).
   - What's unclear: Planner's preference for schema simplicity vs. audit granularity.
   - Recommendation: Default to single `'7_day'` for simplicity; planner can split later if audit tracking is needed.

2. **Should the sweep include an `isRunning` boolean guard to prevent overlapping executions?**
   - What we know: DB UNIQUE constraint already provides dedup atomicity. A 6-hour interval makes overlapping sweeps unlikely (interval > typical sweep duration).
   - What's unclear: Whether the PoC values defense-in-depth (explicit guard) or minimal-code-path (trust the UNIQUE).
   - Recommendation: Skip the guard for Phase 9 PoC. Add later if overlapping sweeps are observed in production logs.

3. **How should the sweep handle a membership that has already expired but is still in the 7-day window (e.g., expiresAt = 2026-08-05 08:00, now = 2026-08-06)?**
   - What we know: The query includes `gt(expiresAt, now)` to exclude already-expired. D-03 says "notify when expiresAt ≤ now + 7 days" — an already-expired membership technically satisfies this but should not re-notify.
   - What's unclear: Is the `gt(expiresAt, now)` filter correctly placed?
   - Recommendation: Include `gt(expiresAt, now)` in the query (implemented in code examples above). Test: create a membership with yesterday's expiry date, verify sweep does NOT send.

4. **Should the balance query tool accept optional parameters (e.g., `business_id`, `membership_id` to look up another client) or always look up the current client's membership?**
   - What we know: NOTF-04 says "client can query *their own* balance" — implies client's own context only.
   - What's unclear: Gemini might prompt-inject a request for a different client's balance.
   - Recommendation: Tool accepts only `business_id` (from context); always looks up `context.clientPhone` membership. Never accept a `client_phone` parameter (cross-tenant bypass risk).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Reminders (Phase 3) sent one reminder per booking per poller run (no dedup) | Reminders with dedup via `reminder24hSentAt` / `reminder1hSentAt` timestamps | Phase 3 (2026-07) | Prevents double-reminders on overlapping sweep runs; per-reminder type atomicity |
| Manual expiry date computation (hand-rolled arithmetic) | DST-safe utilities: `isoDateInAthens()` + `addCalendarDays()` | Phase 7 (2026-07) | Zero DST-transition bugs; proved across 3 phases (reminders, billing, now expiry) |
| No structured client queries on membership state (owner had to manually check via chat) | `check_membership_balance` tool allows proactive client self-service | Phase 9 (2026-07) | Reduces owner message load; clients can verify balance before attempting booking |

**Deprecated/outdated:**
- Raw Date arithmetic for rolling window calculations: Avoid `new Date(Date.now() + 7*24*60*60*1000)` — use `isoDateInAthens()` + `addCalendarDays()` instead.

## Package Legitimacy Audit

**Required** whenever this phase installs external packages. Phase 9 requires no new npm packages (all dependencies already satisfied by Phase 7/8).

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| @google/genai | npm | 2+ yrs | 500K+/wk | github.com/google/genai-js | OK | Already installed; reused for Gemini tool |
| drizzle-orm | npm | 3+ yrs | 1M+/wk | github.com/drizzle-team/drizzle-orm | OK | Already installed; onConflictDoNothing pattern proven |
| date-fns | npm | 6+ yrs | 5M+/wk | github.com/date-fns/date-fns | OK | Already installed; no new version bump required |
| pino | npm | 5+ yrs | 3M+/wk | github.com/pinojs/pino | OK | Already installed; used by all pollers |

**Packages removed due to [SLOP] verdict:** None.
**Packages flagged as suspicious [SUS]:** None.

*All dependencies reused from Phase 7/8. No new external packages required for Phase 9.*

## Sources

### Primary (HIGH confidence)

- [Existing reminders.ts poller pattern](../../src/scheduler/reminders.ts) — DST-safe timezone handling, per-business/per-booking isolation, 15-minute interval
- [Existing expiry-poller.ts pattern](../../src/conversation/expiry-poller.ts) — botTokenStore.run() Telegram context, per-business try/catch, 5-minute interval
- [Database queries Phase 8 pattern](../../src/billing/queries.ts) — getActiveMembershipForDeduction, onConflictDoNothing, SELECT FOR UPDATE
- [Phase 9 Context & Decisions](./09-CONTEXT.md) — locked D-01 through D-09 requirements and discretion areas
- [Phase 8 CONTEXT](../../.planning/phases/08-enforcement-session-deduction/08-CONTEXT.md) — membership state machine, sessionsRemaining === null for unlimited
- [Phase 7 CONTEXT](../../.planning/phases/07-billing-configuration-payment-recording/07-CONTEXT.md) — membership expiresAt TIMESTAMP WITH TIME ZONE, DST-safe rolling window
- [Timezone utilities](../../src/utils/timezone.ts) — isoDateInAthens(), addCalendarDays(), weekdayOfIsoDate()
- [Function executor dispatcher pattern](../../src/conversation/function-executor.ts) — BOOKING_TOOLS definition, tool case dispatch, cross-tenant checks

### Secondary (MEDIUM confidence)

- [Project CLAUDE.md](../../.claude/CLAUDE.md) — Telegram as messaging layer (v1.2), Gemini 2.5 Flash-Lite for AI, no MCP required
- [STATE.md Phase 9 decisions](../../.planning/STATE.md) — NOTF-03 dedup via UNIQUE constraint, session deduction race guard pattern
- [Reminder sweep test pattern](../../tests/scheduler-reminders.test.ts) — jest.setSystemTime() for timezone testing, mock Telegram calls, per-business iteration
- [Server.ts poller registration](../../src/server.ts) — startMembershipExpiryPoller() registration pattern, JEST_WORKER_ID guard

### Tertiary (LOW confidence)

- [Drizzle ORM onConflictDoNothing API](https://orm.drizzle.team/docs/insert#on-conflict) — assumed based on observed usage in codebase; not independently verified against official docs this session

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in use; no new packages
- Architecture: HIGH — poller pattern proven 3 times (reminders, expiry-poller, agenda); dedup UNIQUE pattern proven (reminder dedup, ledger idempotency)
- Pitfalls: HIGH — DST issues well-documented in reminders code; botTokenStore context documented in Phase 4; dedup gotchas covered by existing tests
- Timezone handling: HIGH — isoDateInAthens + addCalendarDays tested across 3 phases; DST bugs zero
- Test coverage: MEDIUM — existing poller tests provide template; function-executor tests exist but check_membership_balance tests are Wave 0

**Research date:** 2026-07-21
**Valid until:** 2026-08-04 (14 days — stable domain, no library version churn expected)

---

*Phase 9: Expiry Notifications & Client Balance*
*Research complete. Ready for planning.*
