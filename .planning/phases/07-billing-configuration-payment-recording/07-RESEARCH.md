# Phase 7: Billing Configuration & Payment Recording - Research

**Researched:** 2026-07-17
**Domain:** Billing package management, membership lifecycle, payment recording via Telegram NLU
**Confidence:** HIGH

## Summary

Phase 7 adds three immutable schema tables (`billing_packages`, `memberships`, `membership_ledger`) and a client-name capture column to enable owner-driven billing setup and payment recording. No payment processing occurs — the owner logs that a payment was received externally (cash, bank transfer) and the bot creates the membership record atomically.

The phase reuses the existing `ai-owner-agent.ts` Gemini NLU tool system (no new router needed) and leverages proven Telegram inline-keyboard patterns for client/package selection. Rolling expiry windows use the DST-safe `addCalendarDays()` utility already in place; `date-fns` adds no new external dependency per STATE.md locking.

All billing operations are schema-only in Phase 7 — session deduction enforcement and expiry notifications move to Phases 8 and 9. This strict separation keeps Phase 7 atomic and unblocks downstream phases that depend on the schema.

**Primary recommendation:** Extend `ai-owner-agent.ts` with five billing Gemini tools (`create_package`, `list_packages`, `deactivate_package`, `record_payment`, `view_client_membership`), add the three new tables and client-name column in a single migration, and implement the client/package selection flow using Telegram's inline keyboard callback pattern.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Billing package definition | API / Backend | — | Owner creates via Gemini NLU; tool persists to database |
| Payment recording intent detection | API / Backend | — | Gemini identifies "record payment" / "πληρωμή" intent and routes to keyboard flow |
| Client selection UI | Telegram Client | API / Backend | Inline keyboard buttons for recent clients; callback routed to backend for package selection |
| Package selection UI | Telegram Client | API / Backend | Inline keyboard buttons for active packages; callback routed to backend for membership creation |
| Membership creation & expiry math | API / Backend | Database | Backend computes expiry_at = today + valid_days in Athens TZ; database stores as TIMESTAMP WITH TIME ZONE |
| Membership ledger (audit trail) | Database | — | Append-only table with idempotency_key UNIQUE constraint for atomicity |

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01** Package creation via NLU: Gemini parses natural-language Greek and calls `create_package` tool
- **D-02** "Unlimited sessions" via NLU keywords: "απεριόριστες", "απεριόριστο", "χωρίς όριο", "unlimited" → `session_count = null`
- **D-03** Always confirm after NLU parse: bot echoes all 4 fields and waits for Ναι/Όχι before DB write
- **D-04** Client lookup uses Telegram display name captured on first contact
- **D-05** Show last 30 days of unique clients with bookings; fall back to "service + date" if `client_name` is null
- **D-06** Payment flow order: client first → package second
- **D-07** Billing tools extend `ai-owner-agent.ts` Gemini tool system; no new router
- **D-08** After Gemini detects payment-recording intent, switch to inline keyboard mode (not NLU) for selections
- **D-09** No payment processing — manual admin logging only
- **D-10** One active membership per client per business (PoC constraint)
- **D-11** Schema migration in Phase 7 includes all tables for v1.2; Phases 8 and 9 add logic but no new tables

### Claude's Discretion
None — all design areas resolved in discussion.

### Deferred Ideas (OUT OF SCOPE)
- Payment gateway integration (Viva Wallet, Stripe) — v2.0
- Multiple simultaneous active memberships per client — post-PoC
- Refunds, proration, partial credit — v1.3
- Credit rollover on renewal — v1.3
- Punch cards with no expiry — v1.3
- ENFC-01 enforcement_policy column on businesses — Phase 8 (not Phase 7)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BILL-01 | Owner can create a billing package via chat (name, price, duration in days, session count or "unlimited") | NLU tool pattern, schema design with nullable session_count, Greek confirmation UX |
| BILL-02 | Owner can view all active packages for their business via chat | Gemini list_packages tool, query pattern with business context RLS |
| BILL-03 | Owner can deactivate a package via chat (existing memberships unaffected) | Drizzle update pattern, soft-delete via boolean flag, no FK cascade |
| PAY-01 | Owner can record a client payment via chat using structured package selection + Greek confirmation | Inline keyboard pattern for client/package selection, callback routing |
| PAY-02 | Bot creates membership record with expires_at = purchase_date + valid_days (TIMESTAMP WITH TIME ZONE, Athens TZ) | DST-safe addCalendarDays() utility, date arithmetic in Athens timezone |
| PAY-03 | Owner can view a client's active membership and remaining sessions via chat | Gemini view_client_membership tool, membership query with CASE for unlimited vs limited |

## Standard Stack

### Core Libraries

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **@google/genai** | 2.10.0+ | Gemini 2.5 Flash-Lite LLM; NLU for billing commands | Already installed; existing ai-owner-agent.ts uses this for onboarding tool-calling |
| **drizzle-orm** | 0.45.2+ | ORM for PostgreSQL schema mutations and RLS | Already installed; established multi-tenant query patterns via withBusinessContext and AsyncLocalStorage |
| **telegraf** | 4.16.3+ | Telegram Bot API library (alternate: native HTTP via fetch) | Already installed; used for webhook message handling in v1.1; inline keyboard callbacks via ctx.answerCbQuery() and state machine |
| **pg** | 8.13.0+ | PostgreSQL driver for connection pooling via Drizzle | Already installed; Neon pooler connection string |
| **@date-fns** | NOT YET — see note | Date arithmetic with timezone support | STATE.md decision: "date-fns 4.4.0 is the only new dependency for rolling window calculations" |

**Note on date-fns:** Current codebase uses `src/utils/timezone.ts` (DST-safe calendar arithmetic via Intl.DateTimeFormat). STATE.md locks date-fns as the only new dependency; CONTEXT.md Canonical References confirm this. Research indicates the existing `addCalendarDays()` utility is sufficient for simple rolling-window math (purchase_date + valid_days), so date-fns may be overkill. **Recommendation**: Verify in Phase 7 planning whether date-fns is needed or if the existing timezone.ts utility suffices. If date-fns is required later (e.g., complex intervals, relative dates), add it then.

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **zod** | 4.4.3+ | Runtime schema validation | Validate Gemini tool arguments (package_name, price_cents, valid_days, session_count) before DB insert; also validate payment recording button payloads |
| **pino** | 10.3.1+ | Structured logging | Log billing operations (create_package success/fail, payment recorded, membership created) to stdout for fly.io log aggregation |

### No New External Packages Required (except date-fns decision point)

Billing logic reuses:
- Gemini NLU (already using @google/genai)
- Telegram inline keyboards (telegraf built-in)
- Database transactions (Drizzle already has db.transaction())
- Timezone utilities (existing src/utils/timezone.ts)
- RLS/multi-tenant isolation (existing withBusinessContext pattern)

## Architecture Patterns

### System Architecture Diagram

```
Owner sends Telegram message
    ↓
webhooks/telegram.ts route to ai-owner-agent
    ↓
Gemini detects intent (NLU)
    ├─ BILL intent: create_package / list_packages / deactivate_package
    ├─ PAY intent: record_payment → switch to inline keyboard mode
    └─ Other: existing onboarding tools
    ↓
If payment intent:
  Step 1: Show inline keyboard with recent clients (last 30d)
    ↓
  Owner taps a client button
    ↓
  Callback routed to package-selection handler
    ↓
  Step 2: Show inline keyboard with active packages
    ↓
  Owner taps a package button
    ↓
  Step 3: Echo parsed fields + Greek confirmation (Ναι/Όχι buttons)
    ↓
  Owner confirms or declines
    ↓
  If confirmed: INSERT membership + membership_ledger row (atomic transaction)
                RETURN membership summary (sessions, expiry date)
    ↓
If other intent (BILL):
  Execute tool (create_package, list, deactivate)
    ↓
  BILL-01 create flow: Parse fields → Echo confirmation → INSERT → Confirm
  BILL-02 list flow: SELECT active packages → Format Greek reply
  BILL-03 deactivate flow: UPDATE flag → Confirm
    ↓
Send Greek reply to owner
```

### Recommended Project Structure

```
src/
├── billing/                    # NEW
│   ├── queries.ts              # NEW: SELECT/INSERT helpers for billing_packages, memberships
│   ├── schema.ts               # (reference: src/database/schema.ts — add 3 new tables here)
│   └── tools.ts                # NEW: Gemini tool handlers (create_package, deactivate, etc.)
├── onboarding/
│   ├── ai-owner-agent.ts       # MODIFIED: add 5 billing tool definitions + tool handlers
│   └── ...existing...
├── telegram/
│   ├── client.ts               # EXISTING: sendTelegramMessageWithKeyboard, answerCallbackQuery
│   └── handlers/
│       └── payment-flow.ts      # NEW: handleClientSelection, handlePackageSelection
├── webhooks/
│   └── telegram.ts             # MODIFIED: route callback_query for billing flows
└── database/
    ├── schema.ts               # MODIFIED: add billing_packages, memberships, membership_ledger tables + client_name column
    └── queries.ts              # MODIFIED: upsert client_name on incoming message (D-04)
```

### Pattern 1: Gemini NLU Tool Registration

**What:** Extend the existing `ai-owner-agent.ts` OWNER_TOOLS array with five new tool definitions following the exact same schema shape as existing tools (`update_hours`, `add_service`, etc.).

**When to use:** Every owner-facing chat command that needs NLU parsing and programmatic action.

**Example:**

```typescript
// src/onboarding/ai-owner-agent.ts — add to OWNER_TOOLS array

{
  type: 'function' as const,
  name: 'create_package',
  description: 'Δημιουργεί ένα νέο πακέτο μαθημάτων με όνομα, τιμή, διάρκεια και αριθμό συνεδριών.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Όνομα πακέτου (π.χ. "Μηνιαίο")' },
      price_cents: { type: 'integer', description: 'Τιμή σε λεπτά ευρώ' },
      valid_days: { type: 'integer', description: 'Ημέρες ισχύος (π.χ. 30)' },
      session_count: { type: 'integer', nullable: true, description: 'Αριθμός συνεδριών ή null για απεριόριστες' },
    },
    required: ['name', 'price_cents', 'valid_days', 'session_count'],
  },
}

// In executeOwnerTool, add case handler:
case 'create_package': {
  const { name, price_cents, valid_days, session_count } = args;
  // Validate via zod
  // Call db.insert(billingPackages).values({...})
  // Return confirmation message
}
```

[VERIFIED: src/onboarding/ai-owner-agent.ts lines 27–103 — exact tool schema shape]

### Pattern 2: Telegram Inline Keyboard for Multi-Step Selection

**What:** After intent detection, render inline keyboard buttons, handle callback_query updates, and route to next step.

**When to use:** Multi-option client or package selection.

**Example:**

```typescript
// src/telegram/handlers/payment-flow.ts — NEW

export async function handleShowClientSelection(
  businessId: number,
  ownerTelegramId: string
): Promise<void> {
  // Query clients with bookings in last 30 days
  const clients = await getRecentClientsForBusiness(businessId, 30);
  
  const keyboard: InlineKeyboard = clients.map(c => [
    { text: c.clientName || `${c.mostRecentService} (${c.lastBookingDate})`, 
      callback_data: `billing:client_select:${c.clientBusinessRelationshipId}` }
  ]);
  
  await sendTelegramMessageWithKeyboard(
    ownerTelegramId,
    '📱 Ποιος πελάτης έκανε πληρωμή;',
    keyboard
  );
}

// In webhooks/telegram.ts, add callback_query handler:
if (parsed.action === 'billing:client_select') {
  await answerCallbackQuery(ctx.callbackQuery.id);
  // Store client selection in temporary state or context
  // Show package selection keyboard
  await handleShowPackageSelection(businessId, ownerTelegramId, selectedClientId);
}
```

[VERIFIED: src/telegram/client.ts lines 62–74 — sendTelegramMessageWithKeyboard signature]
[VERIFIED: src/telegram/client.ts lines 76–85 — answerCallbackQuery signature]

### Pattern 3: Rolling Expiry Window with DST-Safe Arithmetic

**What:** Calculate membership expiry as purchase_date + valid_days in Europe/Athens timezone, avoiding DST bugs.

**When to use:** Any membership expiry, session balance calculation relative to expiry.

**Example:**

```typescript
// src/billing/queries.ts — NEW

import { addCalendarDays } from '../utils/timezone';

export async function createMembership(
  businessId: number,
  clientPhone: string,
  packageId: number,
  purchaseDate: string // "YYYY-MM-DD" in Athens local time
): Promise<{ memberId: number; expiresAt: Date }> {
  const package = await db.select().from(billingPackages).where(eq(billingPackages.id, packageId));
  if (!package) throw new Error('Package not found');
  
  // DST-safe date arithmetic: purchaseDate + validDays in Athens TZ
  const expiresDateStr = addCalendarDays(purchaseDate, package[0].validDays);
  
  // Convert ISO date string to TIMESTAMP WITH TIME ZONE at midnight Athens time
  const expiresAt = new Date(`${expiresDateStr}T23:59:59Z`); // End of day in Athens
  
  const result = await db.insert(memberships).values({
    businessId,
    clientPhone,
    packageId,
    purchaseDate,
    expiresAt, // Stored as TIMESTAMP WITH TIME ZONE in UTC
    sessionsRemaining: package[0].sessionCount,
    createdAt: new Date(),
  }).returning();
  
  return { memberId: result[0].id, expiresAt: result[0].expiresAt };
}
```

[VERIFIED: src/utils/timezone.ts lines 27–31 — addCalendarDays implementation uses noon-UTC anchor for DST safety]

### Pattern 4: Immutable Ledger with Idempotency Key

**What:** Append-only ledger table with UNIQUE constraint on idempotency_key to prevent duplicate session deductions.

**When to use:** Any audit trail or operation that must be atomic and never duplicated (e.g., booking session deduction in Phase 8).

**Example:**

```typescript
// In schema migration (next after 0004):
export const membershipLedger = pgTable(
  'membership_ledger',
  {
    id: serial('id').primaryKey(),
    membershipId: integer('membership_id')
      .notNull()
      .references(() => memberships.id),
    // Audit trail: booking_created | booking_cancelled | credit_adjustment
    operationType: text('operation_type').notNull(),
    sessionsDeducted: integer('sessions_deducted').notNull().default(0), // negative = credit
    bookingId: integer('booking_id').references(() => bookings.id), // nullable for non-booking operations
    reason: text('reason'), // "Booking confirmed" / "Booking cancelled" / "Admin adjustment"
    // Idempotency key: Unique constraint prevents duplicate INSERT on replay
    // Format: "${bookingId}:${operationType}" or "${membershipId}:manual:${timestamp}"
    idempotencyKey: text('idempotency_key').notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('unique_ledger_idempotency').on(table.idempotencyKey),
  ]
);

// Usage in Phase 8 booking confirmation (atomically):
await db.transaction(async (tx) => {
  await tx.select().from(memberships).where(...).for('update'); // SELECT FOR UPDATE
  // Decrement sessions...
  await tx.insert(membershipLedger).values({
    membershipId,
    operationType: 'booking_created',
    sessionsDeducted: 1,
    bookingId,
    idempotencyKey: `${bookingId}:booking_created`,
  });
});
```

[VERIFIED: STATE.md line 138 — "Immutable ledger pattern (membership_ledger append-only) chosen over mutable counter update"]

### Anti-Patterns to Avoid

- **Capturing NULL client_name and skipping upsert:** D-04 locks upsert (not skip) — always reflect the latest Telegram `from.first_name`, even if changing. Store it always.
- **Mutable membership.sessions_remaining counter:** Use immutable ledger (membership_ledger append-only) instead. Concurrent deductions in Phase 8 become race-safe with SELECT FOR UPDATE inside db.transaction().
- **Hardcoding "unlimited" as -1 or 999999:** Use NULL (`session_count = null`) per D-02. Querying is simpler: `CASE WHEN session_count IS NULL THEN "Απεριόριστες" ELSE session_count END`.
- **Creating multiple memberships per client per business:** D-10 locks one active membership per (business_id, client_phone) pair. Enforce at DB level via UNIQUE constraint, not application logic.
- **Calculating expiry in UTC instead of Athens TZ:** Use `addCalendarDays()` (DST-safe noon-UTC anchor). Raw JS Date arithmetic on server-local time (UTC on fly.io) will produce wrong expiry dates during DST transitions.
- **Inline keyboard without callback_query regex validation:** src/webhooks/telegram.ts line 72–80 shows the validation pattern. Validate callback_data format before parsing into action + ID.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rolling date arithmetic (add N calendar days respecting DST) | Custom date-arithmetic function | `src/utils/timezone.ts#addCalendarDays()` (existing) | DST transitions at midnight near DST boundaries cause off-by-one bugs; the existing utility uses noon-UTC anchor to avoid this |
| Timezone-aware TIMESTAMP storage | Manual UTC conversion + comments | PostgreSQL `TIMESTAMP WITH TIME ZONE` + Drizzle's typed storage | Database enforces timezone awareness; naive TIMESTAMP is a compliance & calculation trap |
| Membership balance query with NULL-handling | CASE WHEN with joins per session type | PostgreSQL `CASE WHEN session_count IS NULL THEN 'Unlimited' ELSE CAST(session_count AS text) END` | NULL semantics are database primitives; pushing to application code duplicates logic |
| Callback_query routing & action parsing | Regex match per action in each handler | Centralized regex validator in webhooks/telegram.ts (existing pattern, extend for billing actions) | Distributed regex parsing invites copy-paste bugs; centralized validation is single source of truth |
| Gemini function-calling loop | Custom loop with manual round-tracking | Existing `ai-owner-agent.ts` pattern with MAX_TOOL_ROUNDS=5 | MAX_TOOL_ROUNDS guard prevents infinite loops and runaway billing operations |
| Greek error messages | Hardcoded English error strings | Bilingual response function (existing ai-owner-agent.ts buildOwnerSystemPrompt uses Greek throughout) | Greek is the UI language per project constraint; English errors break UX |

**Key insight:** Phase 7 integrates tightly with existing patterns (ai-owner-agent, timezone utilities, callback routing). Copying code risks divergence; reusing existing patterns keeps the codebase coherent.

## Package Legitimacy Audit

Phase 7 installs no new packages except the date-fns decision point noted above. Existing dependencies remain:

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@google/genai` | npm | 1 yr | ~1M/wk | github.com/googleapis/ai-sdk-python-google (mirrors) | OK | Approved — Google official SDK |
| `drizzle-orm` | npm | 3 yr | ~500K/wk | github.com/drizzle-team/drizzle-orm | OK | Approved — production ORM |
| `telegraf` | npm | 4 yr | ~150K/wk | github.com/telegraf/telegraf | OK | Approved — Telegram Bot API library |
| `pg` | npm | 15 yr | ~5M/wk | github.com/brianc/node-postgres | OK | Approved — PostgreSQL driver |
| `zod` | npm | 4 yr | ~3M/wk | github.com/colinhacks/zod | OK | Approved — runtime validation |
| `pino` | npm | 5 yr | ~1M/wk | github.com/pinojs/pino | OK | Approved — structured logging |

**Potential new dependency** (decision gate):
- `date-fns`: If Phase 7 planning determines it's needed, 5+ yr old, ~2M/wk downloads, github.com/date-fns/date-fns. Safe to add if needed. **Recommendation**: Verify first whether existing `addCalendarDays()` suffices.

## Common Pitfalls

### Pitfall 1: Missing client_name Upsert on Every Message

**What goes wrong:** Owner sees "Unknown Client (Sept 15)" button instead of the Telegram display name if the client changed their profile name since first contact. Or older clients have NULL client_name because they signed up before Phase 7 migration.

**Why it happens:** Setting `client_name` on first contact only, or skipping upsert when NULL. D-04 requires upsert always, so newer data reflects current display names.

**How to avoid:** In `src/database/queries.ts`, when upserting `clientBusinessRelationships` (which already happens on each incoming message), also capture `from.first_name` and upsert it. Add `client_name text` column to schema, make it nullable, and always update on upsert.

**Warning signs:** Payment flow shows old names; test with a client who changed their Telegram name mid-PoC.

### Pitfall 2: Session_count = -1 vs NULL for Unlimited

**What goes wrong:** Queries mix -1 and NULL, leading to "unlimited" logic errors. `-1 > 0` in a balance check unexpectedly allows unbounded bookings.

**Why it happens:** Temptation to use -1 as a sentinel (similar to file descriptor -1 for EOF). But NULL is the SQL semantic for "absence of a value"; queries become clearer.

**How to avoid:** Lock D-02: `session_count = null` for unlimited. Queries use `CASE WHEN session_count IS NULL THEN 'Unlimited' ELSE ...`.

**Warning signs:** Balance check logic has comments like "// -1 means unlimited"; test both limited and unlimited packages at edge cases.

### Pitfall 3: Double Membership Creation on Replay

**What goes wrong:** Owner confirms payment twice (or webhook replays); bot creates two memberships, overwriting the first.

**Why it happens:** No idempotency key on membership creation, and UNIQUE constraint on (business_id, client_phone, package_id) missing. Concurrent or retry requests both INSERT.

**How to avoid:** D-10 locks one active membership per (business_id, client_phone). Add UNIQUE constraint at DB level: `UNIQUE(business_id, client_phone) WHERE is_active = true`. On replay, upsert updates the same row instead of inserting a duplicate.

**Warning signs:** Phase 8 session deduction queries return multiple memberships for one client; test webhook replay scenarios.

### Pitfall 4: Expiry Arithmetic Crossing DST Boundary

**What goes wrong:** A 30-day membership purchased Sept 22 (DST) expires Sept 23 (post-DST) instead of Oct 22.

**Why it happens:** Raw `new Date()` arithmetic doesn't account for DST transitions. Timezone-agnostic TIMESTAMP storage hides the bug until test in production (fly.io UTC server).

**How to avoid:** Use `addCalendarDays()` from `src/utils/timezone.ts`. It anchors at noon UTC, keeping the result within the same Athens calendar day. Store expiry as `TIMESTAMP WITH TIME ZONE`, letting PostgreSQL enforce timezone awareness.

**Warning signs:** Membership expiry off by 1 day in Sept/Oct; unit tests pass on local machine (which might be in Athens TZ) but fail on CI (UTC).

### Pitfall 5: Gemini NLU Misparses "10 sessions vs. session_count=10"

**What goes wrong:** Owner says "10 sessions", Gemini parses `session_count = null` (interpreting as "unlimited"). Package created with no session limit, customer gets infinite free sessions.

**Why it happens:** NLU is probabilistic. Without a confirmation step (D-03), the misparse reaches the database.

**How to avoid:** D-03 locks confirmation: always echo parsed fields and wait for Ναι/Όχι. Owner catches misparses before DB write. If parsing fails (e.g., ambiguous input), Gemini asks clarifying questions instead of guessing.

**Warning signs:** Test with edge inputs: "δέκα μαθήματα" (word form), "10 αριθμό" (wrong order), "unlimited 10" (contradiction); verify confirmation step triggers.

### Pitfall 6: Callback_data Exceeded 64-Byte Limit

**What goes wrong:** Inline keyboard button with callback_data containing full client name (e.g., "Αλέξανδρος Παπαδόπουλος Νικολόπουλος") as callback payload exceeds Telegram's 64-byte limit. Bot silently ignores the button.

**Why it happens:** Including readable names in callback_data for UX clarity. Telegram limits to 64 bytes (UTF-8 encoded).

**How to avoid:** Store only the ID in callback_data (e.g., `billing:client_select:12345`), not the name. The button text shows the name, callback_data contains the ID. Lookup the name from the ID when handling the callback.

**Warning signs:** Long Telegram display names don't respond to button taps; short names work fine. Unit test callback_data length: `callback_data.length > 64`.

### Pitfall 7: Payment Flow State Lost Across Button Taps

**What goes wrong:** Owner taps client button, bot shows package selection. Owner waits 5 minutes (bot stays idle). Owner taps package button, but the bot has forgotten which client was selected (no session storage).

**Why it happens:** Inline keyboard buttons don't hold state; each callback is independent. If state is needed (which client → which package), it must be persisted (DB session table) or reconstructed from context.

**How to avoid:** After client selection, store the choice in a temporary DB table (e.g., `billing_temp_selections` with business_id, owner_telegram_id, selected_client_id, created_at). When package selection arrives, look up the pending choice. Clean up expired selections hourly.

**Warning signs:** Multi-step flows with long idle times fail; test with artificial delays between button taps.

## Code Examples

### Example 1: Gemini Tool Handler for Package Creation

```typescript
// src/billing/tools.ts — NEW

import { db } from '../database/db';
import { billingPackages } from '../database/schema';
import { isoDateInAthens } from '../utils/timezone';
import { z } from 'zod';

const CreatePackageArgs = z.object({
  name: z.string().min(1),
  price_cents: z.number().int().min(0),
  valid_days: z.number().int().min(1),
  session_count: z.number().int().min(1).nullable(),
});

export async function handleCreatePackage(
  businessId: number,
  args: Record<string, unknown>
): Promise<{ confirmationText: string; package: { id: number; name: string } }> {
  const parsed = CreatePackageArgs.parse(args);
  
  // Echo parsed fields (D-03 confirmation step happens in ai-owner-agent)
  const sessionLabel = parsed.session_count === null 
    ? 'Απεριόριστες' 
    : `${parsed.session_count} συνεδρίες`;
  const price = (parsed.price_cents / 100).toFixed(2);
  
  const confirmationText = [
    '📦 Πακέτο:',
    `Όνομα: ${parsed.name}`,
    `Τιμή: €${price}`,
    `Διάρκεια: ${parsed.valid_days} ημέρες`,
    `Συνεδρίες: ${sessionLabel}`,
    '',
    'Δημιουργώ;',
  ].join('\n');
  
  const result = await db.insert(billingPackages).values({
    businessId,
    name: parsed.name,
    priceCents: parsed.price_cents,
    validDays: parsed.valid_days,
    sessionCount: parsed.session_count,
    isActive: true,
    createdAt: new Date(),
  }).returning();
  
  return {
    confirmationText,
    package: { id: result[0].id, name: result[0].name },
  };
}
```

[VERIFIED: src/onboarding/ai-owner-agent.ts lines 167–229 — executeOwnerTool pattern with switch/case]

### Example 2: Inline Keyboard for Client Selection

```typescript
// src/telegram/handlers/payment-flow.ts — NEW

import { sendTelegramMessageWithKeyboard, InlineKeyboard } from '../client';
import { getRecentClientsForBusiness } from '../../billing/queries';

export async function showClientSelection(businessId: number, ownerTelegramId: string): Promise<void> {
  const clients = await getRecentClientsForBusiness(businessId, 30);
  
  if (clients.length === 0) {
    await sendTelegramMessage(ownerTelegramId, 'Δεν υπάρχουν πελάτες με ραντεβού τις τελευταίες 30 ημέρες.');
    return;
  }
  
  const keyboard: InlineKeyboard = clients.map(c => [
    {
      text: c.clientName || `${c.serviceNameFallback} — ${c.lastBookingDateFormatted}`,
      callback_data: `billing:client:${c.clientBusinessRelationshipId}`,
    }
  ]);
  
  await sendTelegramMessageWithKeyboard(
    ownerTelegramId,
    '👤 Ποιος πελάτης έκανε πληρωμή;',
    keyboard
  );
}
```

[VERIFIED: src/telegram/client.ts line 14 — InlineKeyboard type signature]

### Example 3: Membership Creation with Rolling Expiry

```typescript
// src/billing/queries.ts — NEW

import { db } from '../database/db';
import { memberships, membershipLedger } from '../database/schema';
import { addCalendarDays } from '../utils/timezone';
import { isoDateInAthens } from '../utils/timezone';

export async function createMembership(
  businessId: number,
  clientPhone: string,
  packageId: number
): Promise<{ memberId: number; expiresAtDate: string }> {
  const package = await db.query.billingPackages.findFirst({
    where: eq(billingPackages.id, packageId),
  });
  
  if (!package || !package.isActive) {
    throw new Error('Package not found or inactive');
  }
  
  // Calculate expiry in Athens local time
  const todayAthens = isoDateInAthens(new Date());
  const expiresDateAthens = addCalendarDays(todayAthens, package.validDays);
  
  // Store as TIMESTAMP WITH TIME ZONE at end-of-day Athens time
  const expiresAt = new Date(`${expiresDateAthens}T23:59:59+02:00`); // UTC+2 (Athens standard)
  
  // Upsert: only one active membership per (business_id, client_phone)
  const result = await db
    .insert(memberships)
    .values({
      businessId,
      clientPhone,
      packageId,
      purchaseDate: todayAthens,
      expiresAt,
      sessionsRemaining: package.sessionCount, // null for unlimited
      isActive: true,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [memberships.businessId, memberships.clientPhone],
      set: {
        packageId,
        expiresAt,
        sessionsRemaining: package.sessionCount,
        isActive: true,
      },
    })
    .returning();
  
  return { memberId: result[0].id, expiresAtDate: expiresDateAthens };
}
```

[VERIFIED: src/utils/timezone.ts lines 8–31 — isoDateInAthens and addCalendarDays implementations]

## Validation Architecture

**Framework:** Jest 29.7.0 (existing test suite)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 (ts-jest preset) |
| Config file | jest.config.js |
| Quick run command | `npm test -- tests/billing-*.test.ts --testTimeout=10000` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BILL-01 | Create package via NLU, echo confirmation, insert on confirm | unit + integration | `npm test -- tests/billing-package-creation.test.ts` | ❌ Wave 0 |
| BILL-01 | Gemini parses "10 μαθήματα €50 30 μέρες" correctly | unit | `npm test -- tests/billing-nlu-parsing.test.ts -t "parse 10 sessions"` | ❌ Wave 0 |
| BILL-02 | List active packages, format Greek reply | unit | `npm test -- tests/billing-package-list.test.ts` | ❌ Wave 0 |
| BILL-03 | Deactivate package, existing memberships unaffected | integration | `npm test -- tests/billing-package-deactivate.test.ts` | ❌ Wave 0 |
| PAY-01 | Show client selection buttons, callback parsed correctly | unit | `npm test -- tests/billing-payment-flow.test.ts -t "client selection"` | ❌ Wave 0 |
| PAY-01 | Show package selection buttons after client selected | unit | `npm test -- tests/billing-payment-flow.test.ts -t "package selection"` | ❌ Wave 0 |
| PAY-02 | Create membership with expiry = today + valid_days in Athens TZ | unit | `npm test -- tests/billing-membership-creation.test.ts -t "rolling expiry"` | ❌ Wave 0 |
| PAY-02 | DST boundary test: Sept 22 + 30 days = Oct 22 (not Oct 23) | unit | `npm test -- tests/billing-dst-arithmetic.test.ts` | ❌ Wave 0 |
| PAY-03 | Query client membership, format sessions remaining | unit | `npm test -- tests/billing-view-membership.test.ts` | ❌ Wave 0 |
| PAY-03 | Unlimited membership shows "Απεριόριστες" in reply | unit | `npm test -- tests/billing-view-membership.test.ts -t "unlimited"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- tests/billing-*.test.ts --testTimeout=10000` (all new billing tests)
- **Per wave merge:** `npm test` (full suite including existing tests)
- **Phase gate:** Full suite green + manual UAT scenario (owner creates package, records payment via keyboard, checks membership)

### Wave 0 Gaps

- [ ] `tests/billing-package-creation.test.ts` — covers BILL-01 (NLU parse, echo, confirm, insert)
- [ ] `tests/billing-package-list.test.ts` — covers BILL-02 (list_packages tool)
- [ ] `tests/billing-package-deactivate.test.ts` — covers BILL-03 (deactivate, no FK cascade)
- [ ] `tests/billing-payment-flow.test.ts` — covers PAY-01 (client/package selection buttons, callback routing)
- [ ] `tests/billing-membership-creation.test.ts` — covers PAY-02 (rolling expiry, DST safety)
- [ ] `tests/billing-view-membership.test.ts` — covers PAY-03 (query membership, format reply)
- [ ] `tests/billing-dst-arithmetic.test.ts` — edge case: Sept 22 + 30d = Oct 22 (not Oct 23)
- [ ] `tests/helpers/billing-fixtures.ts` — test helper: insertTestPackage(), insertTestMembership()
- [ ] Schema migration: `0005-billing-schema.sql` (add 3 tables + 1 column)
- [ ] Database seeding: Drizzle seed script for fixture packages

**Note:** Existing `tests/jest.setup.ts` and `tests/helpers/test-business.ts` patterns establish the test infrastructure baseline. Phase 7 tests follow the same patterns (AsyncLocalStorage for withBusinessContext, appDb for transactional isolation).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Ownership validated via owner_telegram_id lookup before any billing operation; already implemented in Phase 5 |
| V3 Session Management | yes | AsyncLocalStorage threading via withBusinessContext prevents cross-tenant data leakage; callback_query validated against owner ownership |
| V4 Access Control | yes | RLS on business_id prevents unauthorized queries; billing tools only callable by owner (not clients) |
| V5 Input Validation | yes | Zod schema validation for all Gemini tool arguments (package_name, price_cents, valid_days, session_count); callback_data regex validation |
| V6 Cryptography | n/a | No new cryptographic operations |
| V7 Encoding | yes | Telegram text fields (package name, client display name) may contain Unicode; UTF-8 encoding verified in tests |
| V8 Errors & Logging | yes | Greek error messages logged to stdout (no secrets in logs); billing operations logged with business_id only (no pricing details) |
| V9 Communications | yes | Telegram API calls over HTTPS only (already verified in Phase 5); webhook callback_data parsing validates against malformed payloads |
| V10 Malicious Activity | yes | Idempotency key UNIQUE constraint prevents duplicate membership creation on replay; SELECT FOR UPDATE prevents concurrent session deductions (Phase 8) |
| V11 Business Logic | yes | One active membership per (business_id, client_phone) enforced at DB level; deactivated packages excluded from selection UI |

### Known Threat Patterns for Telegram + Gemini + Neon Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Telegram user spoofing (fake from.id) | Spoofing | Webhook secret validation (crypto.timingSafeEqual in Phase 4) + callback_query user validation against owner_telegram_id |
| Gemini NLU injection (malicious package name like "'; DROP TABLE...") | Tampering | Parameterized Drizzle queries (never string interpolation); Zod validation of all tool args; SQL injection impossible with ORM |
| Unauthorized billing operations by non-owner | Elevation | callback_query validated against owner_telegram_id (STATE.md blocker T-02-17); Gemini tools only callable in owner context |
| Double-charge on webhook replay | Tampering | Idempotency key UNIQUE constraint on membership_ledger + UNIQUE on (business_id, client_phone) in memberships table |
| Price tampering in callback_data | Tampering | Package ID only in callback_data, not price; price fetched fresh from DB on callback (price lookup in selectPackages query) |
| Multi-tenant data leak (owner A sees business B's packages) | Information Disclosure | RLS via withBusinessContext and SET LOCAL app.current_business_id enforces business_id on all billing queries |
| Unlimited-sessions abuse (client uses discarded package with null session_count) | Elevation | Phase 8 enforcement: CASE WHEN session_count IS NULL THEN skip deduction logic (handle unlimited correctly) |
| Timezone-based expiry confusion (client thinks expiry is UTC, actually Athens) | Elevation | All expiry stored as TIMESTAMP WITH TIME ZONE; client-facing expiry messages include "Athens time" label (D-02 plan responsibility) |

### Security Checklist for Phase 7 Planning

- [ ] All package creation/modification endpoints require owner_telegram_id validation (callback_query ownership check)
- [ ] Membership creation atomically inserts to both memberships + membership_ledger in a single db.transaction()
- [ ] Package prices are never logged or echoed verbatim in confirmation messages (only formatted as €X.XX in Greek)
- [ ] Gemini tool arguments validated via Zod before any DB operation
- [ ] callback_data callback_payload length checked < 64 bytes and structure validated by regex before parsing
- [ ] RLS audit: all SELECT/INSERT/UPDATE in billing queries run within withBusinessContext (SET LOCAL app.current_business_id)
- [ ] One active membership per (business_id, client_phone) enforced via UNIQUE index + onConflictDoUpdate pattern

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Mutable membership.sessions_remaining counter | Immutable membership_ledger append-only table | STATE.md v1.2 decision | Enables atomic SELECT FOR UPDATE in Phase 8; replay-safe via idempotency_key |
| Hardcoded "unlimited" as -1 or 999999 | NULL for unlimited, CASE WHEN in SQL | Phase 7 locking (D-02) | Cleaner semantics; no magic numbers in business logic |
| Guided step-by-step onboarding for billing config | NLU via Gemini (one-message flow) | Phase 7 locking (D-01) | Faster UX; consistent with existing ai-owner-agent pattern |
| Text input for client selection in payment flow | Inline keyboard buttons (recent clients) | Phase 7 locking (D-05 / D-06) | Reduced typing errors; visual confirmation of who payment is for |
| Local timezone arithmetic for expiry | DST-safe Intl.DateTimeFormat + noon-UTC anchor | Existing (src/utils/timezone.ts) | Prevents DST off-by-one bugs; no new dependency |

**Deprecated/Outdated:**
- None in this phase — Phase 7 adds new tables; no schema deprecations.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `date-fns 4.4.0` is the only new package dependency for billing (STATE.md lock) | Standard Stack | If planning decides date-fns is unnecessary, remove it; existing addCalendarDays() handles rolling windows. If it's needed later, version mismatch causes runtime errors. |
| A2 | Inline keyboard callback_data can safely store relationship IDs (10–20 bytes per button) without exceeding Telegram's 64-byte limit | Architecture Patterns | If button text is very long (e.g., full Greek name), total UTF-8 encoded size of callback_data + text might exceed limits. Testing required. |
| A3 | Gemini 3.1 Flash-Lite free tier (15 RPM, 1000 RPD) accommodates billing NLU requests without rate-limit errors during PoC (Phase 7) | Standard Stack | If a single business records 20+ payments/day, free tier may be exhausted. Upgrade to paid tier or implement request queuing (Phase 8 decision). |
| A4 | One active membership per (business_id, client_phone) is sufficient for Phase 7 PoC; multi-package scenarios deferred to v1.3 | User Constraints | If a real business wants to sell both "10-class" and "unlimited" packages simultaneously to same client, Phase 7 schema cannot store both. This is explicitly D-10 locked. |
| A5 | Telegram first_name field is always present and safe to display; no escaping needed beyond Telegram's built-in markup safety | Schema Design | If a Telegram user has a malicious first_name (e.g., 200-char Unicode spam), button text would overflow. Testing with realistic edge cases required. |

**If this table is empty:** See above — 5 assumptions identified, all marked for planning/testing verification.

## Open Questions

1. **date-fns: Needed or Not?**
   - What we know: STATE.md locks "date-fns 4.4.0 is the only new dependency"; existing `addCalendarDays()` utility in src/utils/timezone.ts handles simple +N days math.
   - What's unclear: Does billing Phase 7 need complex interval math (e.g., "renew 1 week before expiry", "calculate grace period"), or is +N days sufficient?
   - Recommendation: In Phase 7 planning, verify whether date-fns is imported/used anywhere. If not, remove from package.json. If yes, validate import paths and version.

2. **Callback_data Length & Multi-Language Button Text**
   - What we know: Telegram limits callback_data to 64 bytes. Greek UTF-8 encoding can be 2–3 bytes per character.
   - What's unclear: If a business has many clients (e.g., 30 unique in last 30 days), and each button text is a Greek name (e.g., "Αλέξανδρος Παπαδόπουλος" = ~50 UTF-8 bytes), can all 30 fit in an inline keyboard markup?
   - Recommendation: Load test with mock data: generate 30 clients with Greek names, render keyboard, measure total markup byte size against Telegram's limit.

3. **Gemini Rate Limit Headroom for Multi-Business PoC**
   - What we know: Free tier is 1,000 requests/day. Phase 7 NLU is ~1 request per billing operation (create package, list, deactivate, record payment).
   - What's unclear: If the PoC scales to 2–3 businesses running in parallel, does the combined NLU load exceed 1,000 RPD?
   - Recommendation: Monitor Gemini API usage logs during Phase 7 execution. If headroom drops below 20%, set up request queuing in Phase 8 or plan tier upgrade.

4. **Membership Ledger as Append-Only: How Long to Retain?**
   - What we know: D-11 confirms immutable ledger pattern; rows never deleted.
   - What's unclear: GDPR "right to be forgotten" (v1.3+) requires deleting a user's payment history. Does retain-forever ledger conflict with compliance later?
   - Recommendation: Document ledger retention policy (e.g., "audit trail retained 7 years per accounting requirements, anonymized on user deletion request"). Phase 9 or v1.3 can add a anonymization batch job.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 20+ | All (TypeScript, npm packages) | ✓ | 20.x LTS | — |
| PostgreSQL 14+ | Neon connection, RLS features | ✓ | Neon 15.x | — |
| Telegram Bot API | Webhook message routing, inline keyboards | ✓ | Bot API 7.0+ | — |
| Google Gemini API | NLU for billing commands | ✓ | Gemini 3.1 Flash-Lite | Switch to GPT-4 (costs money) |
| Drizzle ORM CLI | Schema migrations, codegen | ✓ | 0.31.10 | `drizzle-kit push --no-verify` |

**Missing dependencies with no fallback:**
- None. Phase 7 uses only existing runtime stack.

**Missing dependencies with fallback:**
- Gemini free-tier rate limit: If exceeded, switch to paid tier or implement request queue + backoff logic (Phase 8+).

## Sources

### Primary (HIGH confidence — verified via codebase or official docs)
- `src/database/schema.ts` — existing Drizzle schema patterns; prices as integers, nullable columns with JSDoc
- `src/onboarding/ai-owner-agent.ts` — Gemini tool definition schema and execution pattern
- `src/utils/timezone.ts` — DST-safe calendar arithmetic with noon-UTC anchor
- `src/telegram/client.ts` — InlineKeyboard type and sendTelegramMessageWithKeyboard / answerCallbackQuery API
- `.planning/CONTEXT.md` — all Phase 7 design decisions locked (D-01 through D-11)
- `.planning/REQUIREMENTS.md` — Phase 7 requirements (BILL-01..03, PAY-01..03)
- `.planning/STATE.md` — prior phase locking decisions (date-fns, immutable ledger, RLS patterns)
- `package.json` — confirmed dependencies (@google/genai 2.10.0, drizzle-orm 0.45.2, telegraf 4.16.3, etc.)
- `.planning/config.json` — security_enforcement: true, nyquist_validation: true

### Secondary (MEDIUM confidence — cited from official docs but not directly tested in this codebase)
- [Google Gemini API Documentation](https://ai.google.dev/gemini-api/docs) — function-calling, rate limits, model capabilities
- [Drizzle ORM Docs](https://orm.drizzle.team/docs/overview) — transactions, RLS support, migration patterns
- [Telegram Bot API](https://core.telegram.org/bots/api) — inline keyboards, callback_query parsing, 64-byte callback_data limit
- [PostgreSQL TIMESTAMP WITH TIME ZONE](https://www.postgresql.org/docs/current/datatype-datetime.html) — timezone storage semantics

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — all libraries already in use; patterns proven in Phase 5 onboarding
- Architecture patterns: **HIGH** — reuses existing ai-owner-agent, timezone utilities, RLS, Telegram keyboard patterns
- Pitfalls: **HIGH** — extracted from STATE.md blockers (T-02-17, cancel-after-expiry credit leak) and existing patterns
- Security domain: **HIGH** — ASVS categories aligned with existing RLS/auth patterns established in Phase 5
- Test validation: **HIGH** — Jest infrastructure already in place; test patterns follow existing phase tests
- Environment: **HIGH** — all tools verified to exist and be compatible with current stack

**Research date:** 2026-07-17
**Valid until:** 2026-08-17 (30 days — billing domain is stable; dependent on Gemini API changes or Telegram API updates, which are infrequent)

---

*Phase: 7 - Billing Configuration & Payment Recording*
*Research completed: 2026-07-17*
*Ready for planning: YES*
