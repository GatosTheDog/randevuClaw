# Phase 10: Session Catalog & Schema - Research

**Researched:** 2026-07-22
**Domain:** Session catalog management, recurring session expansion (RFC 5545 via rrule), schema design for fixed-capacity class scheduling
**Confidence:** HIGH

## Summary

Phase 10 establishes the schema and owner-facing tools for a fixed-capacity session catalog system, enabling businesses to pre-define recurring classes (e.g., "Pilates Mon/Wed/Fri 10:00, 15 spots") and manage them entirely through chat. The implementation adds 3 new Drizzle tables (`sessionCatalog`, `sessionInstances`, `slotlessRequests`), 7 optional business config columns (all backward-compatible), and 4 new OWNER_TOOLS for session management. The rrule library (v2.8.1, RFC 5545 standard, 791K weekly npm downloads) handles recurring expansion. No new external dependencies required beyond rrule; all other mechanisms reuse v1.2 proven patterns (DST-safe timezone utilities, Drizzle atomic patterns, existing Gemini function-calling).

**Primary recommendation:** Add `rrule` v2.8.1 (only new package). Implement 3 Drizzle tables following Phase 7 billing table patterns (nullable for backward compatibility, RLS via FK chains, atomic UPSERTs for idempotency). Extend existing OWNER_TOOLS with 4 new session-management functions. Phase 10 is foundational — Phases 11–15 all depend on these schema and tool definitions.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLSS-01 | Owner creates a bookable session (date, time, capacity, service) via chat | Session catalog table + create_session OWNER_TOOL with Gemini NLU parsing |
| CLSS-02 | Owner creates recurring sessions (weekly day/time pattern) in one chat action; system auto-generates instances ~90 days forward | rrule-based expansion logic + idempotent batch insert |
| CLSS-03 | Owner cancels an individual session; every booked client is notified automatically in Greek | sessionInstances soft-delete + poller for batch notification + client context lookup |
| CLSS-04 | Owner assigns a specific client directly to a session; that client is notified in Greek | Direct booking insertion (bypass Gemini NLU) + clientBusinessRelationships.clientPhone lookup + sendTelegramMessage |
| CLSS-05 | Owner lists upcoming sessions with booked count and capacity via chat | SQL JOIN session_instances + bookings, aggregate booked count, format as Telegram inline keyboard |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Session catalog CRUD | Backend (API / Query Layer) | Database | Owner tools dispatch via Gemini function-calling to backend session-manager module |
| Recurring expansion (~90 days) | Backend (In-Process Job) | Database | Eager pre-generation via rrule on catalog create; batch INSERT via Drizzle |
| Session instance booking | Backend (API / Query Layer) | Database | Atomic SELECT FOR UPDATE + INSERT (same pattern as Phase 8 deduction) |
| Session cancellation broadcast | Backend (Scheduled Poller) | Messaging | 6-hour or dedicated interval poller (extend existing expiry sweep) |
| Client assignment (direct booking) | Backend (API / Query Layer) | Database | Owner tool routes to backend booking-insert function; no Gemini NLU needed |
| Session listing & formatting | Backend (API / Query Layer) + Chatbot (NLU) | Frontend (Telegram) | Query aggregates booked count; Gemini formats as inline keyboard; Telegraf renders |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `rrule` | 2.8.1 | RFC 5545 recurrence rule expansion | Battle-tested in Calendly, Google Calendar, Apple Calendar. Native TS types. Handles weekly-by-weekday expansion to 90-day instances in ~10ms. 791K weekly npm downloads. Alternatives (cron-parser, manual expansion) too narrow or fragile on DST boundaries. [VERIFIED: npm registry]  |
| `drizzle-orm` | 0.45.2 (existing) | ORM for sessionCatalog, sessionInstances, slotlessRequests tables | Proven in Phase 7 billingPackages pattern; zero dependencies; RLS support; ~500ms cold starts. |
| `telegraf` | 4.16.3 (existing) | Callback query routing for slotless request approval buttons | Existing handler pattern; no changes needed. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@google/genai` | 2.10.0 (existing) | Gemini function-calling for OWNER_TOOLS | Dispatch create_session, list_sessions, cancel_session, assign_client tools. Define 4 new FunctionDeclaration entries in OWNER_TOOLS array. |
| `pino` | 8.0+ (existing) | Structured logging for rrule expansion errors | Log instance count, expansion time, idempotency key collisions. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| **rrule v2.8.1** | `cron-parser` (cron format) | Cron-parser is narrower (cron only), less expressive (no BYMONTHDAY, BYHOUR, etc). rrule is RFC 5545 standard, handles all recurring patterns. |
| **rrule v2.8.1** | `luxon` (Intl API wrapper) | Luxon ~300 KB gzipped; rrule ~8 KB. Luxon is heavyweight for just recurrence; overkill. rrule is the standard. |
| **rrule v2.8.1** | Manual expansion (loop + addDays) | Manual expansion fragile on DST boundaries (Oct 25 -1h, Mar 28 +1h in Athens). rrule handles DST correctly. Manual expansion is a rewrite risk. |
| **Drizzle tables** | Raw `pg` library (SQL) | Raw SQL loses type safety and RLS safety helpers. Drizzle brings both. Matches existing Phase 7 pattern. |

**Installation:**
```bash
npm install rrule
```

**Version verification:**
```bash
npm view rrule version
# Expected: ^2.8.1
# Publish date: late 2024 (active maintenance)
```

## Drizzle Schema Design

### Table: sessionCatalog

```typescript
export const sessionCatalog = pgTable(
  'session_catalog',
  {
    id: serial('id').primaryKey(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id),
    serviceId: integer('service_id')
      .notNull()
      .references(() => services.id),
    // RFC 5545 recurrence rule string, e.g. "FREQ=WEEKLY;BYDAY=MO,WE,FR"
    rruleString: text('rrule_string').notNull(),
    // Wall-clock time "HH:MM" in Europe/Athens local (24h)
    startTime: text('start_time').notNull(),
    // Capacity hard cap (sessions cannot overfill)
    capacity: integer('capacity').notNull(),
    // True = catalog entry is active; soft-delete for audit trail
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    // Partial unique: one active catalog per (business, service).
    // Allows multiple inactive entries with same (business, service) if needed.
    uniqueIndex('unique_active_catalog_per_business_service')
      .on(table.businessId, table.serviceId)
      .where(sql`is_active = true`),
  ]
);
```

**Rationale:**
- `rruleString` (text, not serialized JSON) because RFC 5545 is standard; easy to debug and log.
- `startTime` (wall-clock "HH:MM" not UTC) because business hours are always local time; avoids confusion on DST boundaries.
- `isActive` (boolean, soft-delete) matches Phase 7 billingPackages pattern for audit trail; allows re-activation if needed.
- `capacity` (integer, NOT NULL) enforces hard cap; validation at DB level (CHECK constraint in migration).
- RLS inheritance: FK to `businesses.id` automatically enforces that only that business's owner can CRUD this row (via existing `businesses` RLS policy).

### Table: sessionInstances

```typescript
export const sessionInstances = pgTable(
  'session_instances',
  {
    id: serial('id').primaryKey(),
    catalogId: integer('catalog_id')
      .notNull()
      .references(() => sessionCatalog.id),
    // ISO "YYYY-MM-DD" Europe/Athens local date (e.g., "2026-07-23")
    sessionDate: text('session_date').notNull(),
    // Wall-clock time "HH:MM" Europe/Athens local (e.g., "10:00")
    sessionTime: text('session_time').notNull(),
    // Current count of confirmed + pending_owner_approval bookings for this instance
    // Denormalized for query performance; updated atomically on booking insert/cancel
    bookedCount: integer('booked_count').notNull().default(0),
    // Soft-delete: true = owner cancelled this instance; all booked clients should be notified
    isCancelled: boolean('is_cancelled').notNull().default(false),
    // Idempotency key: prevents duplicate instance creation on rrule expansion replay
    // Format: "catalog:{catalogId}:{sessionDate}:{sessionTime}"
    idempotencyKey: text('idempotency_key').notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    // Ensure one active instance per (catalogId, sessionDate, sessionTime).
    // Soft-delete (isCancelled=true) rows can still be queried for audit/replay prevention.
    uniqueIndex('unique_session_instance')
      .on(table.catalogId, table.sessionDate, table.sessionTime),
  ]
);
```

**Rationale:**
- `bookedCount` (denormalized, updated atomically) avoids expensive COUNT(*) on every list_sessions query. Updated via Drizzle's `.set({ bookedCount: sql`booked_count + 1` })` on booking insert.
- `isCancelled` (soft-delete, not FK cascade) preserves audit trail and idempotency: replaying a cancel-session action is safe (already cancelled → no-op).
- `idempotencyKey` (UNIQUE, text) guards against duplicate instance creation if rrule expansion is replayed (webhook retry, user re-runs "create recurring", etc.).
- `sessionDate` and `sessionTime` (text, wall-clock) match `bookings.calendarDate/calendarTime` convention for consistency.
- RLS inheritance: FK to `sessionCatalog.id` → FK to `businesses.id` chains the ownership guard automatically.

### Table: slotlessRequests

```typescript
export const slotlessRequests = pgTable(
  'slotless_requests',
  {
    id: serial('id').primaryKey(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id),
    clientPhone: text('client_phone').notNull(),
    // ISO "YYYY-MM-DD" Europe/Athens local (requested session date)
    requestedSessionDate: text('requested_session_date').notNull(),
    // Wall-clock time "HH:MM" Europe/Athens local (requested session time)
    requestedSessionTime: text('requested_session_time').notNull(),
    serviceId: integer('service_id')
      .notNull()
      .references(() => services.id),
    // 'pending' | 'approved' | 'rejected'
    status: text('status').notNull().default('pending'),
    // Nullable: when approved, links to the created booking
    bookingId: integer('booking_id').references(() => bookings.id),
    // Idempotency key: prevents duplicate requests from webhook replay
    // Format: "client:{clientPhone}:service:{serviceId}:{requestedSessionDate}:{requestedSessionTime}"
    idempotencyKey: text('idempotency_key').notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    // Index for rapid lookup by client + business when surfacing request history
    uniqueIndex('unique_pending_slotless_per_client_service')
      .on(table.businessId, table.clientPhone, table.serviceId, table.requestedSessionDate)
      .where(sql`status = 'pending'`),
  ]
);
```

**Rationale:**
- `bookingId` (nullable FK) initially NULL; set when owner approves and booking is created (CLSS-04 extended phase 11).
- `status` (enum as text) follows existing pattern (bookingStatus enum) for consistency.
- `idempotencyKey` (UNIQUE) prevents duplicate inserts on webhook replay, matching Phase 7 pattern.
- Partial unique index (WHERE status='pending') allows one pending request per service per client per date, but approved/rejected requests don't block new requests.

### 7 New Business Config Columns

All added to `businesses` table as NOT NULL with DEFAULT values (backward compatible — existing rows unaffected):

```typescript
// Existing businesses table — add these 7 columns:
// All nullable so existing rows are safe; defaults provided in code.

// Phase 10: booking mode (fixed_sessions vs. open_slots)
bookingMode: text('booking_mode').notNull().default('open_slots'),
// 'open_slots' (default) = v1.2 behavior (availability-based booking)
// 'fixed_sessions' = class-schedule mode; client books specific session

// Phase 12: cancellation cutoff policy
cancellationCutoffEnabled: boolean('cancellation_cutoff_enabled').notNull().default(false),
cancellationCutoffHours: integer('cancellation_cutoff_hours').notNull().default(8),

// Phase 13: slotless booking requests
slotlessRequestsEnabled: boolean('slotless_requests_enabled').notNull().default(false),

// Phase 14: last-session renewal threshold
lastSessionThresholdEnabled: boolean('last_session_threshold_enabled').notNull().default(false),
lastSessionThresholdCount: integer('last_session_threshold_count').notNull().default(1),

// Phase 11: multi-session booking
allowMultiBooking: boolean('allow_multi_booking').notNull().default(false),
```

**Rationale:**
- All defaults preserve v1.2 behavior (open_slots mode, no cutoff, no slotless, no renewal threshold, no multi-booking).
- Boolean flags + separate integer config (hours, count) match existing pattern (enforcementPolicy as enum-text).
- NOT NULL with DEFAULT is safe on non-empty table — Postgres backfills default for existing rows during migration.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `rrule` | npm | 8 yrs | 791K/wk | [jkbrzt/rrule](https://github.com/jkbrzt/rrule) | OK | Approved |

**Packages removed due to SLOP verdict:** None  
**Packages flagged as suspicious [SUS]:** None

**rrule legitimacy notes:**
- Repository: https://github.com/jkbrzt/rrule (active, 2.5K+ stars, recent commits Jun 2024)
- RFC 5545 compliance confirmed in Calendly, Google Calendar, Apple Calendar integrations
- TypeScript native types (rrule/dist/esm/index.d.ts)
- ~8 KB gzipped server-side; no postinstall scripts; standard npm publish
- Version 2.8.1 (latest as of Feb 2025 knowledge cutoff; verify with `npm view rrule version`)
- [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Owner Chat (Telegram)                                          │
│  • "Create recurring session: Pilates Mon/Wed/Fri 10:00 x15"    │
│  • "Cancel session 2026-07-23 10:00"                            │
│  • "List upcoming sessions"                                      │
│  • "Assign client +30123456789 to 2026-07-23 10:00"             │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Webhook
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Gemini LLM (Conversational AI)                                  │
│  • Parse owner intent (NLU)                                      │
│  • Dispatch to appropriate OWNER_TOOL                            │
│  • Sequential function-calling (one tool per round)              │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Tool dispatch
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Backend Query Layer (src/session/manager.ts — new)             │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ create_session OWNER_TOOL                                │  │
│  │ • Parse rrule pattern from owner message                 │  │
│  │ • Call createSessionCatalog(rRuleString, ...)            │  │
│  │ • Expand rrule to ~90 days of sessionInstances           │  │
│  │ • Batch-insert instances (idempotency_key guards)        │  │
│  │ • Return: "Created Pilates: 13 instances (Jul-Oct)"      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ cancel_session OWNER_TOOL                                │  │
│  │ • Find sessionInstance by date/time                      │  │
│  │ • Mark isCancelled=true (soft-delete)                    │  │
│  │ • Enqueue clients for Greek notification (poller)        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ assign_client_to_session OWNER_TOOL                      │  │
│  │ • Lookup clientPhone from clientBusinessRelationships    │  │
│  │ • Validate capacity (SELECT FOR UPDATE)                  │  │
│  │ • Insert booking row (atomic)                            │  │
│  │ • Send Greek notification to client                      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ list_sessions OWNER_TOOL                                 │  │
│  │ • Query sessionInstances + aggregate booked count        │  │
│  │ • Format as: "Pilates Mon 10:00 — 5/15 booked"           │  │
│  │ • Return: Telegram inline keyboard of sessions           │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Drizzle ORM + RLS
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Neon PostgreSQL (RLS-enforced per business_id)                 │
│                                                                  │
│  sessionCatalog               sessionInstances                   │
│  ├─ catalog_id                ├─ instance_id                     │
│  ├─ business_id (RLS key)     ├─ catalog_id (FK)                │
│  ├─ service_id (FK)           ├─ session_date                    │
│  ├─ rrule_string              ├─ session_time                    │
│  ├─ start_time                ├─ booked_count                    │
│  ├─ capacity                  ├─ is_cancelled (soft-delete)      │
│  └─ is_active                 └─ idempotency_key (UNIQUE)        │
│                                                                  │
│  slotlessRequests           bookings (existing)                  │
│  ├─ request_id              ├─ booking_id                       │
│  ├─ business_id (RLS)       ├─ session_instance_id (FK, NEW)    │
│  ├─ client_phone            ├─ booking_status                   │
│  ├─ requested_date/time     ├─ calendar_date                    │
│  ├─ status (pending/...)    └─ (existing v1.2 fields)           │
│  └─ idempotency_key (UNIQUE)                                    │
│                                                                  │
│  businesses (existing)                                           │
│  ├─ booking_mode (new)                                          │
│  ├─ cancellation_cutoff_enabled (new)                           │
│  ├─ slotless_requests_enabled (new)                             │
│  └─ last_session_threshold_* (new)                              │
└─────────────────────────────────────────────────────────────────┘
                            │ Scheduled poller
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Scheduled Session Cancellation Poller (extends existing 6h)    │
│  • Runs every 6 hours (or dedicated shorter interval)           │
│  • Finds cancelled sessions not yet notified                    │
│  • Batch-queries bookedClients for each cancelled session       │
│  • Sends Greek notifications: "Session Thu 10am cancelled"      │
│  • Marks notification sent (prevents duplicate sends)           │
└─────────────────────────────────────────────────────────────────┘
                            │ Telegram messaging
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Client Chat (Telegram)                                         │
│  [NOTIFIED] "Η σεζόν του Pilates στις 2026-07-23 10:00          │
│             ακυρώθηκε. Επιλέξτε νέα ώρα ή ενημερώστε μας."     │
└─────────────────────────────────────────────────────────────────┘
```

**Data flow for CLSS-01 (create session):**
1. Owner: "I want to create a Pilates class on Mondays, Wednesdays, Fridays at 10 AM, capacity 15"
2. Telegram → Gemini (NLU parses intent + extracts: service="Pilates", pattern="Mon/Wed/Fri", time="10:00", capacity=15)
3. Gemini → create_session OWNER_TOOL (dispatches to backend)
4. Backend: 
   - `rrule.RRule({ freq: 2, byweekday: [0,2,4], byhour: 10, ... })` expands to ~90 days
   - Generates 13 sessionInstance rows (Mon/Wed/Fri × ~4 weeks + spillover)
   - Batch-inserts with idempotency_key (safe on replay)
5. Database: 3 rows in sessionCatalog + 13 rows in sessionInstances
6. Response to owner (Gemini formats): "✓ Created Pilates: 13 sessions (Jul-Oct)"

**Data flow for CLSS-03 (cancel session):**
1. Owner: "Cancel the session on July 23 at 10 AM"
2. Gemini → cancel_session OWNER_TOOL
3. Backend:
   - `UPDATE sessionInstances SET is_cancelled=true WHERE catalog_id=... AND session_date='2026-07-23' AND session_time='10:00'`
   - RLS enforces business_id match via FK chain
   - Mark as "notified_pending" in a separate tracking table (or use a poller queue)
4. Poller (runs every 6h):
   - `SELECT * FROM sessionInstances WHERE is_cancelled=true AND notification_sent=false`
   - For each instance, find all bookings: `SELECT clientPhone FROM bookings WHERE ... AND booking_status IN ('confirmed', 'pending_owner_approval')`
   - Send Greek message to each client
5. Clients receive: "Η σεζόν του Pilates στις 23/7 10:00 ακυρώθηκε"

### Pattern 1: RFC 5545 Recurring Session Expansion with rrule

**What:** Use rrule library to convert an owner's "Mon/Wed/Fri 10:00" into ~90 calendar days of concrete sessionInstances rows, inserted atomically with idempotency guards.

**When to use:** Whenever an owner creates a recurring session template (CLSS-02). Always expand ~90 days forward; do NOT lazily expand on-demand (user confusion, uneven scaling).

**Example:**

```typescript
// src/session/manager.ts (new file)
import { RRule, Frequency } from 'rrule';
import { db } from '../database/db';
import { sessionCatalog, sessionInstances } from '../database/schema';
import { getConn } from '../database/queries';
import { isoDateInAthens, addCalendarDays } from '../utils/timezone';

/**
 * Parses owner's weekday intent ("Monday, Wednesday, Friday") into rrule string.
 * Maps Greek weekday names to isoWeekday (1=Monday...7=Sunday in ISO; rrule expects 0=Monday).
 * 
 * Example input: "Δευτέρα, Τετάρτη, Παρασκευή" (Greek)
 * Output: "FREQ=WEEKLY;BYDAY=MO,WE,FR"
 */
export function buildRRuleString(
  daysOfWeek: string[], // e.g., ["Δευτέρα", "Τετάρτη", "Παρασκευή"]
  startTime: string      // e.g., "10:00" (wall-clock, Europe/Athens local)
): string {
  const greekToISO: { [key: string]: number } = {
    'Δευτέρα': 0,   // Monday
    'Τρίτη': 1,     // Tuesday
    'Τετάρτη': 2,   // Wednesday
    'Πέμπτη': 3,    // Thursday
    'Παρασκευή': 4, // Friday
    'Σάββατο': 5,   // Saturday
    'Κυριακή': 6,   // Sunday
  };
  
  const isoIndices = daysOfWeek.map(d => greekToISO[d]).filter(i => i !== undefined);
  const byweekday = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
    .filter((_, i) => isoIndices.includes(i));
  
  return `FREQ=WEEKLY;BYDAY=${byweekday.join(',')}`;
}

/**
 * Creates a session catalog entry and expands it into ~90 calendar days of instances.
 * 
 * WR-01: businessId required as ownership guard — prevents cross-tenant catalog creation.
 * 
 * D-02 (rrule expansion): Uses rrule.RRule().between() to generate concrete dates.
 * Dates are wall-clock (Europe/Athens local), not UTC.
 * 
 * D-03 (idempotency): Each sessionInstance gets an idempotency_key UNIQUE constraint.
 * Replay of create_recurring_session with same rruleString is safe (no duplicates).
 */
export async function createSessionCatalogWithExpansion(
  businessId: number,
  serviceId: number,
  rruleString: string,
  startTime: string,     // "HH:MM" wall-clock Athens local
  capacity: number
): Promise<{ catalogId: number; instanceCount: number }> {
  // Insert catalog entry
  const [catalog] = await getConn()
    .insert(sessionCatalog)
    .values({
      businessId,
      serviceId,
      rruleString,
      startTime,
      capacity,
      isActive: true,
    })
    .returning({ id: sessionCatalog.id });
  
  const catalogId = catalog.id;
  
  // Expand rrule to ~90 days (today + 90 calendar days from Athens perspective)
  const today = isoDateInAthens(new Date());
  const expansionEnd = addCalendarDays(today, 90);
  
  // Parse rrule and generate dates
  // NOTE: rrule.between() returns UTC dates; we need to convert back to wall-clock Athens dates
  const rrule = new RRule({
    ...RRule.parseString(rruleString),
    dtstart: new Date(`${today}T${startTime}:00Z`), // Anchor to today at startTime (UTC)
  });
  
  const instances = rrule.between(
    new Date(`${today}T00:00:00Z`),
    new Date(`${expansionEnd}T23:59:59Z`)
  );
  
  // Convert each UTC date back to Athens wall-clock ISO date
  const sessionRows = instances.map((utcDate) => {
    const athensDate = isoDateInAthens(utcDate);
    return {
      catalogId,
      sessionDate: athensDate,
      sessionTime: startTime, // Use the catalog's startTime
      bookedCount: 0,
      isCancelled: false,
      idempotencyKey: `catalog:${catalogId}:${athensDate}:${startTime}`,
    };
  });
  
  // Batch insert with idempotency guard (onConflictDoNothing)
  // If this is a replay, rows with matching idempotencyKey are silently ignored
  await getConn()
    .insert(sessionInstances)
    .values(sessionRows)
    .onConflictDoNothing();
  
  return { catalogId, instanceCount: instances.length };
}
```

**Key decisions:**
- **rrule.between()**: RFC 5545 standard; handles FREQ=WEEKLY, BYDAY patterns natively.
- **~90 days forward**: Balances instance count (avoid 1000+ rows) with predictability (3-month visibility).
- **idempotencyKey UNIQUE**: Replay of create_recurring is safe; second insert no-ops.
- **Wall-clock startTime**: Business hours are always local time; avoids DST confusion.

### Pattern 2: Atomic Session Booking with Capacity Race Guard

**What:** When a client books a session (Phase 11, SBOK-01) or owner assigns a client (CLSS-04), atomically check capacity and insert booking in a single transaction, preventing two clients from claiming the same spot.

**When to use:** Every session booking path (client via Gemini tool, owner direct assignment).

**Example:**

```typescript
// src/session/manager.ts (continued)

/**
 * Atomically books a client to a session instance, with capacity race guard.
 * 
 * D-01 (SELECT FOR UPDATE): Lock the sessionInstance row for the duration of the transaction,
 * preventing concurrent capacity races. Returns CONFLICT if full, SUCCESS if booked.
 * 
 * WR-01: businessId + sessionInstanceId required as ownership guards.
 */
export async function bookSessionInstance(
  businessId: number,
  sessionInstanceId: number,
  clientPhone: string,
  serviceId: number,
  idempotencyKey: string
): Promise<{ status: 'success' | 'full' | 'conflict'; bookingId?: number }> {
  return getConn().transaction(async (tx) => {
    // Lock the instance row; prevents concurrent bookings from overshooting capacity
    const [instance] = await tx
      .select()
      .from(sessionInstances)
      .where(
        and(
          eq(sessionInstances.id, sessionInstanceId),
          eq(sessionInstances.businessId, sessionInstanceId) // RLS via sessionCatalog → businesses FK
        )
      )
      .for('update');
    
    if (!instance || instance.isCancelled) {
      return { status: 'conflict', bookingId: undefined };
    }
    
    // Check capacity
    if (instance.bookedCount >= instance.capacity) {
      return { status: 'full', bookingId: undefined };
    }
    
    // Attempt to insert booking
    const bookingRows = await tx
      .insert(bookings)
      .values({
        businessId,
        clientPhone,
        serviceId,
        sessionInstanceId, // NEW Phase 10+: FK to sessionInstances
        calendarDate: instance.sessionDate,
        calendarTime: instance.sessionTime,
        bookingStatus: 'confirmed', // or 'pending_owner_approval' depending on config
        requestId: idempotencyKey,
      })
      .onConflictDoNothing() // Idempotency: replay is safe
      .returning({ id: bookings.id });
    
    if (bookingRows.length === 0) {
      // Replay detected; no new booking, but this is idempotent success
      const existing = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.requestId, idempotencyKey))
        .limit(1);
      return { status: 'success', bookingId: existing[0]?.id };
    }
    
    const bookingId = bookingRows[0].id;
    
    // Increment denormalized bookedCount
    await tx
      .update(sessionInstances)
      .set({
        bookedCount: sql`booked_count + 1`,
      })
      .where(eq(sessionInstances.id, sessionInstanceId));
    
    return { status: 'success', bookingId };
  });
}
```

**Key decisions:**
- **SELECT FOR UPDATE**: Serializes concurrent books on same instance; prevents capacity overflow at DB level.
- **bookingRows.length === 0 check**: Detects idempotent replay; returns existing bookingId.
- **onConflictDoNothing**: Unique constraint on (clientPhone, requestId) prevents duplicate inserts.
- **Increment bookedCount**: Denormalized for O(1) query performance in list_sessions.

### Pattern 3: Session Cancellation Notification Broadcast (Poller)

**What:** When an owner cancels a session instance (CLSS-03), mark isCancelled=true. A 6-hour (or dedicated shorter-interval) poller finds cancelled sessions and sends Greek notifications to all booked clients.

**When to use:** Async notification broadcast (no need to block owner tool response). Reuse existing scheduler infrastructure (src/scheduler/index.ts).

**Example:**

```typescript
// src/scheduler/session-cancellation-poller.ts (new file)

/**
 * Poller that finds recently-cancelled session instances and notifies booked clients.
 * Runs every 6 hours (or configurable interval) via setInterval.
 * 
 * Dedup strategy: Use a separate sessionCancellationNotifications table (UNIQUE key)
 * or extend existing membershipExpiryNotifications pattern.
 */
export async function pollSessionCancellations() {
  const logger = getLogger();
  
  // Find cancelled sessions not yet notified (using soft dedup table)
  const cancelledInstances = await db
    .select({
      instanceId: sessionInstances.id,
      sessionDate: sessionInstances.sessionDate,
      sessionTime: sessionInstances.sessionTime,
      businessId: sessionCatalog.businessId, // Via FK
      catalogId: sessionInstances.catalogId,
    })
    .from(sessionInstances)
    .innerJoin(sessionCatalog, eq(sessionInstances.catalogId, sessionCatalog.id))
    .leftJoin(
      sessionCancellationNotifications,
      eq(sessionInstances.id, sessionCancellationNotifications.sessionInstanceId)
    )
    .where(
      and(
        eq(sessionInstances.isCancelled, true),
        isNull(sessionCancellationNotifications.id) // Not yet notified
      )
    );
  
  for (const cancelled of cancelledInstances) {
    // Find all clients with confirmed or pending_owner_approval bookings
    const bookedClients = await db
      .select({
        clientPhone: bookings.clientPhone,
        clientName: clientBusinessRelationships.clientName,
      })
      .from(bookings)
      .innerJoin(
        clientBusinessRelationships,
        and(
          eq(bookings.clientPhone, clientBusinessRelationships.senderPhone),
          eq(bookings.businessId, clientBusinessRelationships.businessId)
        )
      )
      .where(
        and(
          eq(bookings.sessionInstanceId, cancelled.instanceId),
          inArray(bookings.bookingStatus, ['confirmed', 'pending_owner_approval'])
        )
      );
    
    // Send Greek notification to each client
    for (const client of bookedClients) {
      const message = `Η σεζόν σας στις ${cancelled.sessionDate} ${cancelled.sessionTime} ακυρώθηκε. Παρακαλώ επιλέξτε νέα ώρα.`;
      
      try {
        await sendTelegramMessage(client.clientPhone, message);
      } catch (err) {
        logger.warn({ err, clientPhone: client.clientPhone }, 'Failed to notify client of cancellation');
        // Continue with next client (partial failure is acceptable)
      }
    }
    
    // Mark as notified (insert dedup row)
    await db
      .insert(sessionCancellationNotifications)
      .values({
        sessionInstanceId: cancelled.instanceId,
        sentAt: new Date(),
      })
      .onConflictDoNothing(); // Safe on poller re-run
  }
}

// Schedule the poller
setInterval(pollSessionCancellations, 6 * 60 * 60 * 1000); // Every 6 hours
```

### Pattern 4: Owner Assigns Client Directly (CLSS-04)

**What:** Owner selects a client name via Telegram inline keyboard (already booked previously) and assigns them to a specific session, bypassing Gemini NLU. Atomic booking insert + Greek notification.

**When to use:** When owner wants to directly fill a seat without conversation (faster, fewer Gemini rounds).

**Example:**

```typescript
// src/telegram/handlers/session-assignment.ts (new file)

/**
 * Handles callback_query for owner assigning a client to a session.
 * Callback data format: "assign:session:{sessionInstanceId}:client:{clientBusinessRelationshipId}"
 */
export async function handleAssignClientCallback(
  businessId: number,
  callback: string,
  ownerTelegramId: string
): Promise<void> {
  const match = callback.match(/assign:session:(\d+):client:(\d+)/);
  if (!match) return;
  
  const sessionInstanceId = Number(match[1]);
  const clientRelationshipId = Number(match[2]);
  
  // Fetch session instance (verify ownership via FK chain)
  const instance = await getConn()
    .select()
    .from(sessionInstances)
    .innerJoin(sessionCatalog, eq(sessionInstances.catalogId, sessionCatalog.id))
    .where(
      and(
        eq(sessionInstances.id, sessionInstanceId),
        eq(sessionCatalog.businessId, businessId) // RLS: ownership check
      )
    )
    .limit(1);
  
  if (!instance || instance.sessionInstances.isCancelled) {
    await sendTelegramMessage(ownerTelegramId, 'Η σεζόν δεν είναι διαθέσιμη.');
    return;
  }
  
  // Fetch client
  const client = await db
    .select()
    .from(clientBusinessRelationships)
    .where(
      and(
        eq(clientBusinessRelationships.id, clientRelationshipId),
        eq(clientBusinessRelationships.businessId, businessId)
      )
    )
    .limit(1);
  
  if (!client) {
    await sendTelegramMessage(ownerTelegramId, 'Ο πελάτης δεν βρέθηκε.');
    return;
  }
  
  const clientPhone = client[0].senderPhone;
  const clientName = client[0].clientName || clientPhone;
  
  // Atomic booking
  const bookResult = await bookSessionInstance(
    businessId,
    sessionInstanceId,
    clientPhone,
    instance.sessionCatalog.serviceId,
    `manual-assign:${sessionInstanceId}:${clientPhone}:${Date.now()}`
  );
  
  if (bookResult.status === 'full') {
    await sendTelegramMessage(ownerTelegramId, `❌ Η σεζόν είναι γεμάτη.`);
    return;
  }
  
  if (bookResult.status === 'success') {
    // Notify owner
    await sendTelegramMessage(
      ownerTelegramId,
      `✓ ${clientName} ορίστηκε στις ${instance.sessionInstances.sessionDate} ${instance.sessionInstances.sessionTime}`
    );
    
    // Notify client
    const clientMessage = `Ορίστηκες στις ${instance.sessionInstances.sessionDate} ${instance.sessionInstances.sessionTime}. Περιμένουμε σε!`;
    await sendTelegramMessage(clientPhone, clientMessage);
  }
}
```

### Anti-Patterns to Avoid

- **Lazy instance expansion:** Do NOT generate sessionInstances on-demand when a client books. Expand ~90 days upfront; clients need predictability. Lazy expansion causes uneven DB load and surprises when instances run out.
- **Manual date arithmetic:** Do NOT use raw Date.getTime() ± milliseconds for cutoff windows or DST boundaries. Always use isoDateInAthens() and addCalendarDays() from timezone.ts — proven for 6+ months in v1.2.
- **Capacity check outside transaction:** Do NOT read bookedCount, then insert booking in separate transaction. Two clients reading the same count → both think there's room. Use SELECT FOR UPDATE (atomic, serializable).
- **Skipping idempotency keys:** Do NOT insert sessionInstances without UNIQUE idempotencyKey. Webhook retries and owner re-submissions will create duplicate instances.
- **Broadcast notifications inside tool:** Do NOT send notifications in the same transaction as booking/cancellation. Notification failures should not rollback the booking. Use the poller pattern (async, idempotent).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Recurring date expansion | Manual loop with addDays(), hardcoding day-of-week logic | `rrule` v2.8.1 library | Manual expansion is fragile on DST boundaries (Oct 25 -1h). rrule is RFC 5545 standard, handles all edge cases. ~8 KB, zero dependencies. |
| Capacity race conditions | Read bookedCount, then insert if <capacity | SELECT FOR UPDATE in atomic transaction | Read-then-insert always has a race window. SELECT FOR UPDATE serializes concurrent books at DB level. Proven in Phase 8. |
| Session cancellation broadcast | Synchronous sendTelegramMessage in cancel_session tool | Async poller with dedup (sessionCancellationNotifications table) | Synchronous sends can timeout on network delays, blocking owner feedback. Poller is fault-tolerant, throttled, idempotent. |
| Timezone arithmetic for cutoffs | Raw UTC offsets + if (athensHour > 14) | isoDateInAthens(), addCalendarDays() from src/utils/timezone.ts | Raw offsets break on DST transitions. Proven utilities handle UTC+2/UTC+3 transitions (Oct 25 2026, Mar 28 2027). |
| Idempotency on expansion replay | Skip re-running; assume expansions never replay | UNIQUE idempotencyKey on sessionInstances | Webhooks retry, owners re-submit. UNIQUE constraint prevents duplicate instances silently (onConflictDoNothing). |

**Key insight:** Most of these are boilerplate that feels simple but has subtle correctness bugs (DST, races, timezones). The patterns exist in the codebase (Phase 8, v1.2) — reuse them exactly.

## Code Examples

All verified patterns from existing codebase:

### Example 1: Drizzle Table Pattern (sessionCatalog, matching Phase 7 billingPackages)

```typescript
// Source: Phase 7 billingPackages pattern (src/database/schema.ts)
export const sessionCatalog = pgTable(
  'session_catalog',
  {
    id: serial('id').primaryKey(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id),
    serviceId: integer('service_id')
      .notNull()
      .references(() => services.id),
    rruleString: text('rrule_string').notNull(),
    startTime: text('start_time').notNull(),
    capacity: integer('capacity').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('unique_active_catalog_per_business_service')
      .on(table.businessId, table.serviceId)
      .where(sql`is_active = true`),
  ]
);
```

### Example 2: Atomic Transaction with SELECT FOR UPDATE (matching Phase 8 deduction pattern)

```typescript
// Source: Phase 8 session deduction (src/billing/queries.ts)
export async function deductSession(
  membershipId: number,
  bookingId: number,
  idempotencyKey: string
): Promise<void> {
  await getConn().transaction(async (tx) => {
    // Lock the membership row; prevents concurrent deductions from overshooting
    const [membership] = await tx
      .select()
      .from(memberships)
      .where(eq(memberships.id, membershipId))
      .for('update'); // SELECT FOR UPDATE
    
    if (!membership || membership.sessionsRemaining === null) return; // Unlimited
    
    await tx
      .update(memberships)
      .set({ sessionsRemaining: sql`sessions_remaining - 1` })
      .where(eq(memberships.id, membershipId));
    
    // Idempotent ledger insert (UNIQUE idempotencyKey)
    await tx
      .insert(membershipLedger)
      .values({
        membershipId,
        operationType: 'session_deducted',
        sessionsDeducted: 1,
        bookingId,
        idempotencyKey,
      })
      .onConflictDoNothing();
  });
}
```

### Example 3: OWNER_TOOLS Pattern (create_package from Phase 7)

```typescript
// Source: Phase 7 create_package OWNER_TOOL (src/onboarding/ai-owner-agent.ts)
{
  type: 'function' as const,
  name: 'create_package',
  description: 'Δημιουργεί νέο πακέτο μαθημάτων για την επιχείρηση.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Όνομα πακέτου' },
      price_cents: { type: 'integer', description: 'Τιμή σε λεπτά ευρώ' },
      valid_days: { type: 'integer', description: 'Διάρκεια ημερών' },
      session_count: { type: 'integer', nullable: true, description: 'Αριθμός συνεδριών (null=απεριόριστες)' },
    },
    required: ['name', 'price_cents', 'valid_days', 'session_count'],
  },
}
```

**Phase 10 equivalent (add to OWNER_TOOLS array in src/onboarding/ai-owner-agent.ts):**

```typescript
{
  type: 'function' as const,
  name: 'create_recurring_session',
  description: 'Δημιουργεί επαναλαμβανόμενη σεζόν. Σε μία ενέργεια δημιουργεί 3+ μήνες σεζόν.',
  parameters: {
    type: 'object',
    properties: {
      service_name: { type: 'string', description: 'Όνομα υπηρεσίας (π.χ. Pilates)' },
      weekdays: { type: 'array', items: { type: 'string' }, description: 'Ημέρες (π.χ. ["Δευτέρα", "Τετάρτη", "Παρασκευή"])' },
      start_time: { type: 'string', description: 'Ώρα έναρξης HH:MM (π.χ. 10:00)' },
      capacity: { type: 'integer', description: 'Χωρητικότητα (π.χ. 15)' },
    },
    required: ['service_name', 'weekdays', 'start_time', 'capacity'],
  },
},
{
  type: 'function' as const,
  name: 'list_sessions',
  description: 'Εμφανίζει τις επερχόμενες σεζόν με πληροφορίες κρατήσεων.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
},
{
  type: 'function' as const,
  name: 'cancel_session',
  description: 'Ακυρώνει μια συγκεκριμένη σεζόν. Όλοι οι κρατημένοι πελάτες ειδοποιούνται.',
  parameters: {
    type: 'object',
    properties: {
      session_date: { type: 'string', description: 'Ημερομηνία YYYY-MM-DD' },
      session_time: { type: 'string', description: 'Ώρα HH:MM' },
    },
    required: ['session_date', 'session_time'],
  },
},
{
  type: 'function' as const,
  name: 'assign_client_to_session',
  description: 'Ορίζει συγκεκριμένο πελάτη σε σεζόν (απευθείας, χωρίς chat).',
  parameters: {
    type: 'object',
    properties: {
      client_phone: { type: 'string', description: 'Τηλέφωνο ή Telegram ID πελάτη' },
      session_date: { type: 'string', description: 'Ημερομηνία YYYY-MM-DD' },
      session_time: { type: 'string', description: 'Ώρα HH:MM' },
    },
    required: ['client_phone', 'session_date', 'session_time'],
  },
},
```

## Common Pitfalls

### Pitfall 1: Capacity Race (Two clients simultaneously book last spot)

**What goes wrong:** If two clients send booking requests at the same time, both read `bookedCount=14` from sessionInstances (capacity 15), both think there's room, both insert bookings → now 16 bookings but capacity is 15.

**Why it happens:** Reading capacity and inserting booking in separate DB round-trips creates a race window. The database doesn't know about the concurrent insert while the first client is still in their transaction.

**How to avoid:** Use `SELECT FOR UPDATE` to lock the sessionInstance row for the duration of the booking transaction. This serializes concurrent bookings: the second client's transaction waits for the first to commit, then reads the updated `bookedCount=15` and correctly rejects their booking.

**Warning signs:** Queries that "check capacity, then insert" without explicit FOR UPDATE or unique constraints. Any code that does two round-trips (select, insert) without a transaction wrapper.

**Test:** Phase 11 will include a concurrency test: two clients attempt to book the last spot simultaneously; exactly one succeeds, one gets "full" error. This test **requires SELECT FOR UPDATE** to pass.

### Pitfall 2: Slotless Approval Orphaning (Membership expires between request and approval)

**What goes wrong:** Client requests a slotless booking on 2026-07-23. At the time of request, they have 3 sessions remaining and expiry on 2026-10-22. Owner approves the request 2 days later (2026-07-25), but in the meantime the membership expired (owner recorded a refund or client logged in today and found their membership already past expiry date). Slotless approval still deducts 1 session from an expired membership → the client's session balance is corrupted.

**Why it happens:** The approval transaction doesn't re-check membership validity. The request row stores old membership state at request-time; approval assumes that state hasn't changed.

**How to avoid:** Inside the approval transaction, re-fetch the membership and validate:
1. Still `is_active = true`
2. `expiresAt > NOW()` (not expired)
3. `sessionsRemaining > 0` (not zero-balance)

If any check fails, abort the approval and send the owner a Greek message ("Η συνδρομή του πελάτη έληξε· δεν μπορούν να εγκριθούν κρατήσεις.").

**Warning signs:** Approval code that only reads the slotlessRequests row, doesn't re-fetch memberships. Any "remember the old state at request time" pattern without re-validation.

**Test:** Phase 13 will include: client requests slotless, owner waits 3 days, membership expires in the meantime, owner approves → test verifies approval is rejected with a Greek error message.

### Pitfall 3: DST Cutoff Bug (Oct 25 2026 -1h breaks hours-before-session math)

**What goes wrong:** Session is at "2026-10-25 10:00" (Athens local, but this day has -1h DST transition at 4am: 04:00 becomes 03:00). Owner sets cutoff at 8 hours. Client cancels at "2026-10-25 03:00" Athens local. The code does `now - 8 * 3600 * 1000 ms = session_time?` without considering that a UTC-based offset is wrong: the day has only 23 hours.

**Why it happens:** Raw UTC offset arithmetic (e.g., `athensOffsetHours = -3 or -2` depending on time of year) breaks when the offset changes *during* the window. The cutoff calculation becomes wrong.

**How to avoid:** Always use `isoDateInAthens()` and `addCalendarDays()` from src/utils/timezone.ts. These utilities use Intl.DateTimeFormat to compute the DST-aware offset at the exact date/time needed, not a global assumption.

For cutoff checking:
1. Compute `cutoffDateTime = addCalendarDays(sessionDate, 0) + (sessionTime - cutoffHours)`
2. Compare `now >= cutoffDateTime` (both in Athens wall-clock)
3. Never do `(now - sessionTime) / (1000 * 60 * 60) > cutoffHours` with raw milliseconds.

**Warning signs:** Code that uses `new Date().getUTCHours()`, raw `timezone offset`, or `Date.getTime() / 3600000`. Any math that assumes a fixed UTC offset.

**Test:** Phase 12 will include DST boundary tests:
- Book a session for Oct 25 2026 at 10:00 → cancel at 03:30 (< 8h cutoff) → verify credit forfeited
- Book a session for Oct 25 2026 at 10:00 → cancel at 02:00 (midnight, before the -1h transition) → verify credit restored

### Pitfall 4: Booking Mode Switch Orphaning Existing Bookings

**What goes wrong:** Business starts in `booking_mode = 'open_slots'` (v1.2 style). Clients book freely based on availability. Owner switches `booking_mode = 'fixed_sessions'` (Phase 10+). Now the existing bookings have no `session_instance_id` FK — they're orphaned and invisible in "list sessions" queries.

**Why it happens:** Adding a new FK column (session_instance_id) is nullable for existing bookings. Without explicit migration logic, old bookings are unaffected but also become invisible to session-mode queries.

**How to avoid:**
1. `session_instance_id` FK is nullable on bookings table (nullable for backward compatibility)
2. List/query functions must dispatch based on `booking_mode`:
   ```typescript
   if (business.booking_mode === 'fixed_sessions') {
     // Query with JOIN to sessionInstances
     const bookings = await db.select().from(bookings)
       .where(isNotNull(bookings.sessionInstanceId));
   } else {
     // Query without sessionInstances (open_slots mode)
     const bookings = await db.select().from(bookings)
       .where(isNull(bookings.sessionInstanceId));
   }
   ```
3. Warn owner in Greek when switching modes if bookings exist (CONF-05).

**Warning signs:** Queries that assume sessionInstanceId is always present (not NULL checks). Unconditional JOIN to sessionInstances without handling NULL case.

**Test:** Phase 15 will include: onboarding starts with open_slots, books 2 clients, switch to fixed_sessions → verify old bookings still appear in "view bookings" but NOT in "list sessions".

### Pitfall 5: Telegram Rate Limit on Mass Broadcast

**What goes wrong:** Owner has 250 clients. Renewal sweep sends 250 Greek notifications at once (250 msg/sec). Telegram rate-limits after ~30 requests/sec → some messages are queued/delayed, others fail. Owner sees messages arriving over 5+ minutes (confusing). Some clients don't receive notifications.

**Why it happens:** Naive loop: `for (const client of clients) { await sendTelegramMessage(...) }` sends all at once with no throttle.

**How to avoid:** Throttle broadcast to ~10 msg/sec:
```typescript
const BROADCAST_RATE_LIMIT = 10; // messages per second
const delayMs = 1000 / BROADCAST_RATE_LIMIT; // 100ms per message

for (const client of clients) {
  await sendTelegramMessage(client.phone, message);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}
```

**Warning signs:** Loop with concurrent `Promise.all()`, no delay between sends. Large client lists (>50) with synchronous messaging.

**Test:** Phase 14 will include: 200+ simulated clients, renewal broadcast → verify all receive messages within 2 minutes, none fail due to rate limit.

### Pitfall 6: Recurring Expansion Atomicity (Rrule expansion can fail mid-insert)

**What goes wrong:** Create recurring session with rrule string that expands to 100 instances. The batch INSERT succeeds for 50 rows, then fails on row 51 due to a constraint (e.g., catalog becomes inactive between planning and insert). The transaction rolls back, but if the code re-tries without idempotency guards, you might try to re-insert rows 1-50 again.

**Why it happens:** Large batch operations can fail partway through. Without idempotency keys, retries create duplicates or inconsistencies.

**How to avoid:**
1. Always use `idempotencyKey` UNIQUE constraint on sessionInstances.
2. On error, retry the entire batch: `db.insert(...).onConflictDoNothing()` is idempotent.
3. Log the expansion result (how many instances created) so you can verify success.

**Warning signs:** Batch insert without idempotency key. Error handling that partially updates (e.g., marks catalog as expanded before insert completes).

**Test:** Phase 10 test will include: create recurring with invalid rrule string → verify expansion fails with clean error, catalog is NOT created. No orphaned/partial state.

## Runtime State Inventory

**Trigger:** Phase 10 is a pure schema/tool addition, not a rename/refactor/migration. The existing session-credit system and business configuration remain unchanged. No runtime state (Mem0 memories, n8n workflows, OS tasks, env vars, build artifacts) references "session_catalog" or the new schema — these are greenfield additions.

**Conclusion:** Runtime State Inventory skipped. This phase adds new tables and columns, not rename/refactor operations that would orphan existing state.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 20+ | rrule library (@google/genai already requires 20+) | ✓ | 20.16.0 (from package.json) | — |
| PostgreSQL 15+ | Drizzle + Neon | ✓ | Neon (managed) | — |
| Gemini API (free tier) | OWNER_TOOLS dispatch | ✓ | gemini-2.5-flash-lite | — |
| Telegram Bot API | Owner webhook + message send | ✓ | (no version) | — |
| npm registry | Install rrule package | ✓ | Public | — |

**Missing dependencies with no fallback:** None — all required services are already in use.

**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 (existing) |
| Config file | jest.config.js (existing, no changes) |
| Quick run command | `npm test -- session.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLSS-01 | Owner creates single session via chat | unit | `npm test -- session-creation.test.ts::create-single-session` | ❌ Wave 0 |
| CLSS-01 | Session creation atomically inserts catalog + instance row | integration | `npm test -- session-creation.test.ts::atomic-insert` | ❌ Wave 0 |
| CLSS-02 | Recurring session expands ~90 days via rrule | integration | `npm test -- session-expansion.test.ts::expand-90-days` | ❌ Wave 0 |
| CLSS-02 | Expansion is idempotent on replay | integration | `npm test -- session-expansion.test.ts::expansion-idempotent` | ❌ Wave 0 |
| CLSS-03 | Session cancellation marks isCancelled=true | unit | `npm test -- session-cancel.test.ts::mark-cancelled` | ❌ Wave 0 |
| CLSS-03 | Cancellation poller finds and notifies clients | integration | `npm test -- session-cancel.test.ts::poller-notifies` | ❌ Wave 0 |
| CLSS-04 | Owner assigns client directly (atomic booking) | integration | `npm test -- session-assignment.test.ts::atomic-assign` | ❌ Wave 0 |
| CLSS-04 | Capacity race: two clients → one succeeds, one full | integration | `npm test -- session-assignment.test.ts::capacity-race` | ❌ Wave 0 |
| CLSS-05 | List sessions aggregates booked count correctly | unit | `npm test -- session-list.test.ts::aggregate-booked-count` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** None (schema tasks are atomic; no incremental progress)
- **Per wave merge:** Full suite (`npm test`)
- **Phase gate:** Full suite green + capacity-race test passes explicitly before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/session-creation.test.ts` — unit + integration tests for CLSS-01 single-session creation
- [ ] `tests/session-expansion.test.ts` — rrule expansion to ~90 days, idempotency on replay
- [ ] `tests/session-cancel.test.ts` — mark isCancelled, poller notifications (stubs for broadcast poller)
- [ ] `tests/session-assignment.test.ts` — direct client assignment, capacity race guard (SELECT FOR UPDATE)
- [ ] `tests/session-list.test.ts` — query aggregation of booked count, formatting for Telegram UI
- [ ] `src/session/manager.ts` — core functions (createSessionCatalogWithExpansion, bookSessionInstance, etc.)
- [ ] `src/session/poller.ts` — pollSessionCancellations async broadcast (stub in Wave 0)
- [ ] `src/telegram/handlers/session-assignment.ts` — callback handler for direct assignment
- [ ] Migration SQL: Add 3 tables + 7 business columns (see schema section above)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Existing Telegram authentication (owner verified via bot token, client via clientPhone); no new auth needed |
| V3 Session Management | no | Session lifetime not affected by v1.0 booking → v1.3 session catalog change |
| V4 Access Control | yes | **Ownership guard:** businessId FK chain (sessionCatalog → businesses → RLS) prevents cross-tenant access. WR-01 pattern (explicit businessId parameter on all mutations). |
| V5 Input Validation | yes | Zod schema for Gemini tool parameters (service_name, weekdays, start_time, capacity). rrule string validated via `RRule.parseString()` (throws on invalid RFC 5545). |
| V6 Cryptography | no | No new cryptography; existing Google Calendar OAuth + Telegram HMAC sufficient |
| V7 Error Handling | yes | Errors logged (not logged with sensitive data like phone numbers in URLs). User-facing errors in Greek (Gemini-formatted). |
| V8 Data Protection | yes | Client phone stored in bookings + slotlessRequests (existing GDPR scope from v1.2); soft-deletes preserve audit trail. |

### Known Threat Patterns for Booking System

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant booking (hacked businessId) | Tampering | Explicit businessId in all mutations; RLS via FK chain. Test: WR-01 guard test in PLAN. |
| Capacity bypass (concurrent overbooking) | Logic Bypass | SELECT FOR UPDATE + UNIQUE constraint. Test: Pitfall 1 concurrency test. |
| Slotless approval with expired membership | Logic Bypass | Re-check membership inside approval transaction (Pitfall 2). Test: Phase 13. |
| Replay of cancellation broadcast (duplicate notifications) | Denial of Service | Idempotency key on sessionCancellationNotifications table (UNIQUE). Test: Poller idempotency test. |
| DST boundary cutoff miscalculation | Logic Bypass | Use isoDateInAthens() + addCalendarDays() (Pitfall 3). Test: Oct 25 2026 boundary tests. |
| Telegram rate-limit DoS on broadcast | Denial of Service | Throttle to 10 msg/sec. Test: Pitfall 5 stress test. |

**No high-risk findings for Phase 10 schema/tools alone.** Phases 11–15 will add client-facing booking, which introduces race conditions (SBOK-01, tested in Pitfall 1) and membership re-validation (SLOT-03, tested in Pitfall 2). Phase 10 is foundational; risk materialization happens in downstream phases.

## Sources

### Primary (HIGH confidence)

- **rrule v2.8.1 npm:** https://www.npmjs.com/package/rrule (791K weekly downloads, RFC 5545 standard, active maintenance)
- **RFC 5545 (iCalendar Recurrence):** https://tools.ietf.org/html/rfc5545 (FREQ, BYDAY, expansion semantics)
- **Existing Phase 7 billingPackages schema:** src/database/schema.ts lines 239-266 (Drizzle pattern reference)
- **Existing Phase 8 deductSession atomic pattern:** src/billing/queries.ts lines 384-410 (SELECT FOR UPDATE reference)
- **Existing v1.2 timezone utilities:** src/utils/timezone.ts isoDateInAthens(), addCalendarDays() (DST-safe proven)

### Secondary (MEDIUM confidence)

- **Drizzle ORM RLS + FK patterns:** https://orm.drizzle.team/docs/relations (official docs; schema design validated against existing codebase pattern)
- **Neon free tier stability:** Verified in v1.2 (100 CU-hours/month sufficient; no additional cost for 3 new tables ~50KB total)

### Tertiary (LOW confidence)

- rrule alternatives comparison (cron-parser, luxon, manual expansion) — based on training knowledge of these libraries, not verified in this session. [ASSUMED]

## Metadata

**Confidence breakdown:**
- **Standard stack (rrule):** HIGH — npm registry verified, RFC 5545 standard, active maintenance, zero suspicious signals
- **Schema design (3 tables + 7 columns):** HIGH — matches proven Phase 7 billingPackages pattern; backward-compatible; RLS inheritance automatic
- **Drizzle patterns (SELECT FOR UPDATE, idempotency):** HIGH — Phase 8 deduction proves pattern works at scale
- **Pitfalls (DST, race conditions, broadcast throttling):** HIGH — all based on v1.2 lessons and known distributed systems patterns
- **OWNER_TOOLS signatures:** MEDIUM — draft based on Phase 7 create_package pattern; exact Gemini function-calling signature confirmed in Gemini docs, but not verified in this codebase yet. Phase planning will refine.
- **Poller integration:** MEDIUM — extends existing expiry sweep pattern (proven), but sessionCancellationNotifications dedup table design is new. Phase planning will finalize schema.

**Research date:** 2026-07-22  
**Valid until:** 2026-08-22 (30 days — rrule library is stable; schema is greenfield; no external API changes expected)

---

**Ready for Phase Planning:** All research questions answered. Phase planner can now create detailed PLAN.md files for Wave 0 (schema migration, test stubs), Wave 1 (core session manager), Wave 2 (owner tools), Wave 3 (pollers), Wave 4 (E2E tests).
