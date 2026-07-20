# Phase 8: Enforcement & Session Deduction - Research

**Researched:** 2026-07-20
**Domain:** Drizzle ORM transactional deduction, PostgreSQL SELECT FOR UPDATE, owner NLU tool extension, schema migration
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Session deduction at booking INSERT — same `appDb.transaction()` as `insertBooking()` in `bookAppointmentTool` (function-executor.ts).
- **D-02:** `membership_ledger` entry `event_type = 'session_deducted'` written inside same transaction. `idempotency_key = 'booking:<bookingId>:deduction'`.
- **D-03:** All three cancel paths restore credit: (a) client taps "Ακύρωση" button, (b) owner taps "Απόρριψη", (c) client says "cancel" via NLU. Owner rejection treated identically to cancellation.
- **D-04:** Credit-restore checks `membership.expiresAt < now (Europe/Athens)`. If expired: skip restore. If valid: write `credit_restored` ledger entry atomically with booking status update.
- **D-05:** `idempotency_key` for credit restore = `booking:<bookingId>:credit`.
- **D-06:** When `membership.sessionCount IS NULL` (unlimited): skip deduction ledger entry, only check `expiresAt` for validity. No credit restore on cancel either.
- **D-07:** Add `enforcement_policy text NOT NULL DEFAULT 'allow'` to `businesses` via schema migration. Allowed values: `'allow'` | `'block'` | `'flag'`.
- **D-08:** Default `'allow'` — backward-compatible; existing businesses unaffected until owner sets policy.
- **D-09:** Owner sets policy via NLU: `set_enforcement_policy` tool in `ai-owner-agent.ts`. Follows Phase 7 tool pattern.
- **D-10:** Enforcement check in `bookAppointmentTool` BEFORE `insertBooking`.
- **D-11:** "Flag" owner alert fires synchronously, BEFORE the Αποδοχή/Απόρριψη keyboard message.
- **D-12:** All ledger writes use `onConflictDoNothing()` on `idempotency_key` UNIQUE constraint (Phase 7 schema already has it). No new constraint needed.

### Claude's Discretion

- Whether to use a CHECK constraint on `enforcement_policy` or rely on app-layer validation only.
- Exact wording of Greek messages beyond the specified templates.

### Deferred Ideas (OUT OF SCOPE)

- Per-service enforcement policies
- Owner UI for enforcement audit log
- "Warn client" mode (third enforcement tier)
- Auto follow-up "here's how to buy a membership" flow after block refusal
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SESS-01 | On confirmed booking, atomically deduct 1 session from client's active membership in the same transaction as the booking insert | D-01/D-02: `getConn()` inside `withBusinessContext` provides the shared `appDb.transaction()`. SELECT FOR UPDATE via `.for('update')` in drizzle-orm 0.45.2 prevents race condition. |
| SESS-02 | On cancellation (booking was within membership validity), restore 1 session credit atomically | D-03/D-04: All three cancel paths add credit restore. Atomicity via existing `appDb.transaction()` from `withBusinessContext`. |
| SESS-03 | On cancellation (membership expired), no credit restored | D-04: Check `membership.expiresAt < now()` in Europe/Athens; skip restore if expired. Find membership via `membership_ledger WHERE booking_id = ? AND operation_type = 'session_deducted'`. |
| SESS-04 | Unlimited-session memberships: no session count change, only expiry check | D-06: `membership.sessionCount IS NULL` signals unlimited. Skip deduction and credit entirely. |
| ENFC-01 | Owner sets enforcement policy per business via chat | D-09: `set_enforcement_policy` Gemini NLU tool added to `OWNER_TOOLS` in `ai-owner-agent.ts`. |
| ENFC-02 | "Block" policy: refuse booking if no active membership, notify client in Greek | D-10: Pre-check in `bookAppointmentTool` before `insertBooking`. Returns Greek refusal without inserting. |
| ENFC-03 | "Flag" policy: allow booking, send owner Greek alert about unpaid client | D-10/D-11: Insert booking proceeds; owner alert fires synchronously before Αποδοχή/Απόρριψη keyboard. |
</phase_requirements>

---

## Summary

Phase 8 extends the booking lifecycle with two orthogonal concerns: (1) a session ledger that debits on booking creation and credits on cancellation/rejection, and (2) a per-business enforcement policy that gates or flags bookings lacking a valid membership.

The critical architectural finding is that the entire Telegram webhook handler is already wrapped in `withBusinessContext(business.id, ...)` (confirmed at `telegram.ts` line 410), which opens a single `appDb.transaction()` covering all DB operations for the request. This means `bookAppointmentTool`, `cancelAppointmentTool`, `handleClientCancelCallback`, and `handleCallbackQuery` all execute inside the same transaction — no additional `db.transaction()` wrapping is needed for atomicity. Any `getConn()` call inside these functions participates in that transaction.

For the concurrent deduction race condition, drizzle-orm 0.45.2 exposes `.for('update')` on select queries (confirmed in `drizzle-orm/pg-core/query-builders/select.d.ts`). A `getConn().select().from(memberships).where(...).for('update')` call inside the `bookAppointmentTool` transaction serializes concurrent booking attempts on the same membership row.

The ledger's `bookingId` FK (already nullable in the Phase 7 schema) is the join key for finding the relevant membership at cancel time — no `membership_id` column needs to be added to the `bookings` table.

**Primary recommendation:** Use `getConn()` (not a new `db.transaction()`) for all Phase 8 DB writes. The atomicity guarantee comes from the existing `withBusinessContext` wrapping in telegram.ts. Add SELECT FOR UPDATE to serialize concurrent session deductions.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Session deduction on booking | API / Backend (function-executor.ts bookAppointmentTool) | Database (appDb transaction) | Booking creation and ledger write must be co-located to share a transaction |
| Credit restore on cancel | API / Backend (telegram.ts + function-executor.ts) | Database (appDb transaction) | Three cancel paths all live in the backend; DB write via shared appDb transaction |
| Enforcement pre-check | API / Backend (function-executor.ts bookAppointmentTool) | — | Must run before insertBooking; stays in same booking code path |
| Owner sets enforcement policy | AI / NLU (ai-owner-agent.ts) | Database (businesses table) | Follows established Phase 7 NLU tool pattern |
| Enforcement policy storage | Database / Storage (businesses.enforcement_policy) | — | Simple column on existing businesses table |
| Flag alert to owner | API / Backend (telegram.ts sendTelegramMessage) | — | Synchronous side effect in existing alertOwnerNewBooking flow |

---

## Standard Stack

### Core (all already installed — no new packages)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | 0.45.2 [VERIFIED: local node_modules] | ORM + query builder; `.for('update')` SELECT locking | Already installed; `.for('update')` confirmed available in this version |
| @google/genai | 2.10.0+ [ASSUMED] | Gemini NLU for `set_enforcement_policy` tool | Already used in ai-owner-agent.ts |
| zod | 3.22+ [ASSUMED] | Input validation for enforcement_policy value | Already used in billing/tools.ts |
| postgres (neon) | existing | DB for schema migration | Already in use |

**No new packages required for Phase 8.** [VERIFIED: codebase review — all capabilities implemented with existing dependencies]

### Package Legitimacy Audit

No new packages are introduced in Phase 8. All required capabilities are available through the existing dependency set (drizzle-orm, @google/genai, zod).

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | — | — | — | — | — | No new packages |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Client Telegram message (booking request)
    │
    ▼
telegram.ts: handleTelegramWebhookPost
    │   withBusinessContext(businessId) ─────────────────────────────────┐
    │   └── opens appDb.transaction() (all getConn() calls below share it)│
    ▼                                                                     │
routeConversationMessage → aiBookingAgent → executeTool                   │
    │                                                                     │
    ▼                                                                     │
bookAppointmentTool (function-executor.ts)                                │
    ├── [ENFC-01/02/03] fetchBusinessEnforcementPolicy() ← getConn()     │
    ├── [SESS-01]       getActiveMembershipForDeduction() ← getConn().for('update')
    │                   (SELECT FOR UPDATE — serializes concurrent deductions)
    ├── [ENFC-02]       if policy='block' + no valid membership → Greek refusal (no insert)
    ├── [ENFC-03]       if policy='flag' + no valid membership → set flagOwner=true
    ├──               insertBooking() ← getConn() (same appDb.transaction())
    ├── [ENFC-03]       if flagOwner: sendTelegramMessage(owner, flag alert)
    ├── [SESS-01]       deductSession() ← getConn() (ledger insert + counter update)
    └──               alertOwnerNewBooking() (Αποδοχή/Απόρριψη keyboard)
         all within same appDb.transaction() ────────────────────────────┘

Cancel path A (client taps "Ακύρωση" button):
    telegram.ts → handleCallbackQuery → handleClientCancelCallback
        └── withBusinessContext wraps all → getConn() calls atomic
            ├── updateBookingStatus(cancelled)
            └── restoreCredit() if membership not expired

Cancel path B (owner taps "Απόρριψη"):
    telegram.ts → handleCallbackQuery reject branch
        └── withBusinessContext wraps all → getConn() calls atomic
            ├── updateBookingStatusIfPending(rejected)
            └── restoreCredit() if membership not expired

Cancel path C (client NLU "cancel"):
    function-executor.ts → cancelAppointmentTool
        └── withBusinessContext wraps all → getConn() calls atomic
            ├── updateBookingStatus(cancelled)
            └── restoreCredit() if membership not expired

Owner sets policy (NLU):
    ai-owner-agent.ts → set_enforcement_policy tool
        └── UPDATE businesses SET enforcement_policy = ?
            → Greek confirmation reply
```

### Recommended Project Structure

```
src/
├── billing/
│   ├── queries.ts        # EXTEND: add deductSession(), restoreCredit(),
│   │                     #   getActiveMembershipForDeduction(),
│   │                     #   findMembershipByBooking(),
│   │                     #   getBusinessEnforcementPolicy()
│   └── tools.ts          # EXTEND: add handleSetEnforcementPolicy()
├── conversation/
│   └── function-executor.ts  # EXTEND: bookAppointmentTool + cancelAppointmentTool
├── database/
│   ├── schema.ts         # EXTEND: add enforcementPolicy to businesses
│   └── queries.ts        # EXTEND: add enforcementPolicy to Business interface
├── onboarding/
│   └── ai-owner-agent.ts # EXTEND: add set_enforcement_policy to OWNER_TOOLS + executeOwnerTool
├── webhooks/
│   └── telegram.ts       # EXTEND: handleClientCancelCallback + handleCallbackQuery reject branch
migrations/
└── 0007_enforcement_policy.sql  # NEW: ALTER TABLE businesses ADD COLUMN enforcement_policy
tests/
├── function-executor.test.ts    # EXTEND with enforcement + deduction unit tests
├── billing-session-deduction.test.ts  # NEW: integration tests for atomic deduction
└── billing-enforcement-policy.test.ts # NEW: unit tests for set_enforcement_policy NLU tool
```

### Pattern 1: SELECT FOR UPDATE via Drizzle `.for('update')`

**What:** Lock a membership row for the duration of the current transaction to serialize concurrent session deductions.
**When to use:** Inside `bookAppointmentTool` before checking `sessionsRemaining` and before inserting the booking. Only needed for memberships with a finite session count (not unlimited).

```typescript
// Source: drizzle-orm/pg-core/query-builders/select.d.ts (confirmed available in 0.45.2)
// getConn() returns the appDb transaction from withBusinessContext
const [membership] = await getConn()
  .select()
  .from(memberships)
  .where(
    and(
      eq(memberships.businessId, businessId),
      eq(memberships.clientPhone, clientPhone),
      eq(memberships.isActive, true),
      gt(memberships.expiresAt, new Date())
    )
  )
  .for('update')  // [VERIFIED: drizzle-orm 0.45.2 pg-core select.d.ts line 586]
  .limit(1);

if (!membership) return null; // no valid membership
if (membership.sessionsRemaining !== null && membership.sessionsRemaining <= 0) {
  return { error: 'no_sessions_remaining' };
}
```

### Pattern 2: Atomic Session Deduction (counter + ledger in one transaction)

**What:** Decrement `memberships.sessionsRemaining` AND insert a `membership_ledger` row in the same `appDb.transaction()`.
**When to use:** After `insertBooking` succeeds and booking row has an ID. Skip entirely for unlimited memberships (`sessionsRemaining IS NULL`).

```typescript
// Source: billing/queries.ts createMembership pattern (Phase 7) — same tx via getConn()
async function deductSession(
  membershipId: number,
  bookingId: number,
  idempotencyKey: string,  // 'booking:<bookingId>:deduction'
): Promise<void> {
  // 1. Try ledger insert first (idempotency guard)
  const inserted = await getConn()
    .insert(membershipLedger)
    .values({
      membershipId,
      operationType: 'session_deducted',
      sessionsDeducted: 1,
      bookingId,
      idempotencyKey,
    })
    .onConflictDoNothing()
    .returning({ id: membershipLedger.id });

  if (inserted.length === 0) return; // already deducted (idempotent replay)

  // 2. Only if new ledger row: decrement the counter
  await getConn()
    .update(memberships)
    .set({ sessionsRemaining: sql`${memberships.sessionsRemaining} - 1` })
    .where(eq(memberships.id, membershipId));
}
```

### Pattern 3: Credit Restore (expiry check + ledger + counter)

**What:** On cancel/reject, restore 1 session only if the membership was not expired at the time of cancellation.
**When to use:** After `updateBookingStatus` or `updateBookingStatusIfPending` in all three cancel paths.

```typescript
// Source: deductSession pattern above (same idempotency + counter approach, reversed)
async function restoreCredit(
  membershipId: number,
  bookingId: number,
  idempotencyKey: string,  // 'booking:<bookingId>:credit'
): Promise<void> {
  // Expiry check (SESS-03): check membership.expiresAt in Europe/Athens
  const [membership] = await getConn()
    .select({ expiresAt: memberships.expiresAt, sessionsRemaining: memberships.sessionsRemaining })
    .from(memberships)
    .where(eq(memberships.id, membershipId))
    .limit(1);

  if (!membership) return;
  // SESS-04: unlimited memberships have sessionsRemaining IS NULL — no counter to restore
  if (membership.sessionsRemaining === null) return;
  // SESS-03: membership expired at time of cancellation — no credit
  const nowAthens = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Europe/Athens' })
  );
  if (membership.expiresAt < nowAthens) return;

  // Idempotency guard on ledger insert
  const inserted = await getConn()
    .insert(membershipLedger)
    .values({
      membershipId,
      operationType: 'credit_restored',
      sessionsDeducted: -1,  // negative = credit
      bookingId,
      idempotencyKey,
    })
    .onConflictDoNothing()
    .returning({ id: membershipLedger.id });

  if (inserted.length === 0) return; // already restored

  // Increment counter
  await getConn()
    .update(memberships)
    .set({ sessionsRemaining: sql`${memberships.sessionsRemaining} + 1` })
    .where(eq(memberships.id, membershipId));
}
```

### Pattern 4: Finding the Membership at Cancel Time

**What:** Look up `membershipId` from the ledger using `bookingId`, to avoid adding `membership_id` FK to the `bookings` table.
**When to use:** At the start of credit restore in all cancel paths.

```typescript
// The membership_ledger.bookingId column was designed exactly for this (Phase 7 schema comment:
// "Phase 8+: nullable — set when the ledger entry is tied to a specific booking")
async function findMembershipByBooking(bookingId: number): Promise<number | null> {
  const [row] = await getConn()
    .select({ membershipId: membershipLedger.membershipId })
    .from(membershipLedger)
    .where(
      and(
        eq(membershipLedger.bookingId, bookingId),
        eq(membershipLedger.operationType, 'session_deducted')
      )
    )
    .limit(1);
  return row?.membershipId ?? null;
}
// Returns null for unlimited memberships (no deduction row was written).
// Returns null for bookings pre-Phase-8 (no ledger row exists).
// In both null cases: skip credit restore.
```

### Pattern 5: `set_enforcement_policy` Owner NLU Tool

**What:** Gemini NLU tool added to `OWNER_TOOLS` in `ai-owner-agent.ts` following the Phase 7 shape.
**When to use:** When owner sends a message like "ορίσε πολιτική block" or "θέλω να μπλοκάρω απλήρωτους πελάτες".

```typescript
// Source: ai-owner-agent.ts OWNER_TOOLS array — exact same shape as create_package, record_payment
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

### Pattern 6: Schema Migration (0007_enforcement_policy.sql)

**What:** Add `enforcement_policy` column with CHECK constraint to `businesses`.
**When to use:** Migration must run BEFORE any Phase 8 code is deployed.

```sql
-- Source: migrations/0006_billing_schema.sql — same idempotent ADD COLUMN IF NOT EXISTS pattern
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS enforcement_policy TEXT NOT NULL DEFAULT 'allow'
    CONSTRAINT enforcement_policy_valid CHECK (enforcement_policy IN ('allow', 'block', 'flag'));

-- Also grant UPDATE to randevuclaw_app so the set_enforcement_policy handler can write it
GRANT UPDATE (enforcement_policy) ON businesses TO randevuclaw_app;
```

### Anti-Patterns to Avoid

- **Wrapping in a new `db.transaction()` inside the booking flow**: Everything inside the `withBusinessContext` callback is already inside `appDb.transaction()`. A nested `db.transaction()` opens a SEPARATE connection, breaking atomicity with `insertBooking`. Use `getConn()` directly.
- **Skipping SELECT FOR UPDATE**: Without `for('update')`, two concurrent bookings can both read `sessionsRemaining = 1`, both proceed to insert, and both decrement — overselling sessions. Always lock before deducting.
- **Making the flag alert best-effort (try/catch/ignore)**: CONTEXT.md D-11 explicitly says owner flag alert must be awaited before responding to client. Do NOT use the existing best-effort pattern from alertOwnerNewBooking.
- **Adding `membership_id` to `bookings` table**: The ledger's existing `bookingId` FK is sufficient for credit restore. Adding a new FK to `bookings` creates a circular dependency edge and was not in the locked schema decisions.
- **Checking `membership.sessionsRemaining` without SELECT FOR UPDATE**: Race condition. The check and the decrement must happen inside the same locked transaction.
- **Writing ledger with `onConflictDoUpdate` instead of `onConflictDoNothing`**: Ledger is append-only. Never update an existing ledger row. If the idempotency key conflicts, the correct action is to skip (do nothing), not update.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Concurrent deduction race | Custom optimistic locking / version counter | `getConn().select().for('update')` (drizzle-orm 0.45.2) | Built-in pessimistic locking via PostgreSQL advisory lock at the row level; much simpler |
| Idempotent deduction | Custom "already deducted?" check query | `onConflictDoNothing().returning()` on idempotency_key UNIQUE | Phase 7 pattern already established; two-step check-then-insert has a race window |
| Timezone-safe expiry check | Manual UTC offset arithmetic | `isoDateInAthens()` and `addCalendarDays()` from `src/utils/timezone.ts` | DST-safe patterns already in the codebase; any new arithmetic risks off-by-one at DST transitions |
| NLU validation of policy value | Custom string parse | Zod `.enum(['allow', 'block', 'flag'])` | Pattern from `CreatePackageSchema` in billing/tools.ts |
| Greek date formatting for owner messages | `new Date().toISOString().slice()` | `toLocaleDateString('el-GR', { timeZone: 'Europe/Athens' })` | Pattern already in `handleViewClientMembership` in billing/tools.ts |

**Key insight:** The transaction atomicity is FREE — it comes from the existing `withBusinessContext` wrapper in telegram.ts. Phase 8 only needs to write `getConn()` calls; the transaction boundary is already managed.

---

## Common Pitfalls

### Pitfall 1: Using `db` or `appDb` directly instead of `getConn()`
**What goes wrong:** DB writes bypass the active `appDb.transaction()` from `withBusinessContext`, breaking atomicity with the booking insert. Session can be deducted even if the booking insert was rolled back (or vice versa).
**Why it happens:** `createMembership` in billing/queries.ts uses `db.transaction()` directly — this was correct in Phase 7 because payment recording is NOT inside a `withBusinessContext` flow. Phase 8 deduction IS inside the flow.
**How to avoid:** In `bookAppointmentTool` and all cancel handlers: always use `getConn()`. Never call `db.insert()` or `appDb.insert()` directly in Phase 8 code.
**Warning signs:** TypeScript will compile fine either way; only an integration test that verifies rollback behavior will catch this.

### Pitfall 2: Confusing `db.transaction()` (admin) with `appDb.transaction()` (RLS)
**What goes wrong:** Using `db.transaction()` bypasses PostgreSQL row-level security — a client of business A could potentially read or modify data for business B.
**Why it happens:** `db` is the admin connection; `appDb` has RLS. The existing `createMembership` uses `db.transaction()` because it's called from `handleConfirmMembership` in payment-flow.ts, which explicitly wraps in `withBusinessContext(businessId, ...)` at the call site.
**How to avoid:** Phase 8 code never needs its own `db.transaction()`. Use `getConn()` and let `withBusinessContext` own the transaction boundary.

### Pitfall 3: Unlimited membership deduction
**What goes wrong:** Inserting a `session_deducted` ledger row for an unlimited membership (where `sessionsRemaining IS NULL`), then accidentally trying to decrement `NULL - 1` which returns NULL, silently corrupting the membership state.
**Why it happens:** Forgetting to check `membership.sessionsRemaining !== null` before the deduction path.
**How to avoid:** D-06 is explicit: when `sessionsRemaining IS NULL`, skip the entire deduction path (no ledger row, no counter update). The only check is `expiresAt > now`.

### Pitfall 4: Credit restore for pre-Phase-8 bookings
**What goes wrong:** `findMembershipByBooking(bookingId)` returns `null` for bookings created before Phase 8 (no ledger row). The credit restore code tries to restore null → exception or silent corruption.
**Why it happens:** Assuming all bookings have a membership deduction ledger row.
**How to avoid:** `findMembershipByBooking` returning `null` must be handled as "no deduction was made → skip restore". This also covers unlimited memberships correctly.

### Pitfall 5: `enforcement_policy` column NOT NULL before migration runs
**What goes wrong:** Deploying Phase 8 code (which reads `business.enforcementPolicy`) before the `0007_enforcement_policy.sql` migration runs will cause TypeScript type errors at runtime (the field is undefined on the row) or DB errors.
**Why it happens:** Migration not run in step order.
**How to avoid:** Migration must be applied to both the Neon live DB AND `randevuclaw_test` before running tests or deploying. Add a Wave 0 task that explicitly applies the migration.

### Pitfall 6: `Business` interface in queries.ts not updated
**What goes wrong:** `findBusinessById`, `findBusinessByWebhookId`, and other functions return the `Business` interface which doesn't include `enforcementPolicy`. TypeScript will narrow the result to `undefined` for the new column even after the migration.
**Why it happens:** The `Business` interface and the Drizzle schema definition in `schema.ts` are both sources of truth; adding to one without the other breaks type inference.
**How to avoid:** Update BOTH `src/database/schema.ts` (Drizzle column definition) AND the `Business` interface in `src/database/queries.ts` (TypeScript shape).

### Pitfall 7: Flag alert sent AFTER the Αποδοχή/Απόρριψη keyboard
**What goes wrong:** Owner sees the approval keyboard first, then the unpaid-client warning below it — they may already have tapped "Αποδοχή" before reading the warning, which defeats the purpose of the flag.
**Why it happens:** The flag alert is inserted after `alertOwnerNewBooking` in the booking flow.
**How to avoid:** D-11 is explicit: flag alert must fire BEFORE the Αποδοχή/Απόρριψη keyboard message. In `bookAppointmentTool`, call `sendTelegramMessage(owner, flagAlert)` before `alertOwnerNewBooking(booking, service, business)`.

---

## Code Examples

### Session deduction integration into `bookAppointmentTool`

```typescript
// Source: src/conversation/function-executor.ts — bookAppointmentTool extension
async function bookAppointmentTool(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  const parsed = BookAppointmentArgsSchema.parse(args);
  const service = await findServiceById(context.business.id, parsed.service_id);
  if (!service) return { success: false, error: 'service_not_found' };

  // --- Phase 8: enforcement check + session deduction ---

  // Fetch enforcement policy (uses getConn() — inside appDb.transaction())
  const enforcementPolicy = context.business.enforcementPolicy ?? 'allow';

  // Find valid membership (SELECT FOR UPDATE if policy !== 'allow' or has session count)
  let membership: ActiveMembershipForDeduction | null = null;
  if (enforcementPolicy !== 'allow') {
    membership = await getActiveMembershipForDeduction(
      context.business.id,
      context.clientPhone
    );
    if (!membership && enforcementPolicy === 'block') {
      const businessName = context.business.name;
      return {
        success: false,
        error: 'no_membership',
        message: `Για να κάνετε κράτηση, χρειάζεστε ενεργή συνδρομή. Επικοινωνήστε με ${businessName} για ανανέωση.`,
      };
    }
  } else {
    // 'allow' policy but we still need to deduct if membership exists
    membership = await getActiveMembershipWithLock(context.business.id, context.clientPhone);
  }

  // --- insert booking (unchanged) ---
  const expiresAt = new Date(Date.now() + PENDING_BOOKING_TTL_MS);
  const booking = await insertBooking({ ... });

  if (booking) {
    // Phase 8: flag alert BEFORE Αποδοχή/Απόρριψη keyboard (D-11)
    if (enforcementPolicy === 'flag' && !membership && context.business.ownerTelegramId) {
      const clientName = await getClientName(context.business.id, context.clientPhone);
      const flagText = `⚠️ Νέα κράτηση από πελάτη χωρίς ενεργή συνδρομή: ${clientName ?? context.clientPhone}, ${service.name}, ${booking.calendarDate} ${booking.calendarTime}.`;
      await sendTelegramMessage(context.business.ownerTelegramId, flagText);
    }

    // Phase 8: session deduction (D-01/D-02/D-06)
    if (membership && membership.sessionsRemaining !== null) {
      await deductSession(
        membership.id,
        booking.id,
        `booking:${booking.id}:deduction`
      );
    }

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

### Credit restore integration into `handleClientCancelCallback`

```typescript
// Source: src/webhooks/telegram.ts — handleClientCancelCallback extension
// (Inside withBusinessContext — getConn() is the appDb transaction)
async function handleClientCancelCallback(bookingId: number, senderTelegramId: string): Promise<void> {
  const booking = await findBookingByIdUnscoped(bookingId);
  if (!booking) return;
  if (booking.clientPhone !== senderTelegramId) return;
  const CANCELLABLE = ['pending_owner_approval', 'confirmed'];
  if (!CANCELLABLE.includes(booking.bookingStatus)) return;

  await updateBookingStatus(booking.id, 'cancelled');

  // Phase 8: credit restore (D-03/D-04/D-05) — atomic with status update via getConn()
  const membershipId = await findMembershipByBooking(booking.id);
  if (membershipId !== null) {
    await restoreCredit(membershipId, booking.id, `booking:${booking.id}:credit`);
  }

  // ... existing calendar delete + owner notification (unchanged) ...
}
```

---

## Runtime State Inventory

This is a schema-extension + logic-extension phase, not a rename/refactor. No runtime state migration is required.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | No rename of existing keys/columns | None |
| Live service config | None affected | None |
| OS-registered state | None | None |
| Secrets/env vars | No new env vars required | None |
| Build artifacts | None | None |

**New data**: The `enforcement_policy` column is added with `DEFAULT 'allow'`, so all existing businesses get the backward-compatible default automatically. No data backfill script needed.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest (existing) |
| Config file | `jest.config.ts` (existing) |
| Quick run command | `npx jest --testPathPattern="session-deduction\|enforcement-policy" --no-coverage` |
| Full suite command | `npx jest --no-coverage` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SESS-01 | Booking insert + ledger deduction + counter decrement are atomic | integration | `npx jest billing-session-deduction -t "deducts session atomically"` | ❌ Wave 0 |
| SESS-01 | SELECT FOR UPDATE prevents double deduction in concurrent requests | integration | `npx jest billing-session-deduction -t "concurrent deduction race"` | ❌ Wave 0 |
| SESS-01 | Deduction idempotency key prevents double-deduct on replay | unit | `npx jest function-executor -t "deduction idempotency"` | ❌ Wave 0 extension |
| SESS-02 | Credit restore on client cancel (membership valid) | unit | `npx jest function-executor -t "credit restored on cancel"` | ❌ Wave 0 extension |
| SESS-03 | No credit restore when membership expired at cancel time | unit | `npx jest function-executor -t "no credit on expired membership"` | ❌ Wave 0 extension |
| SESS-04 | Unlimited membership: no deduction, booking proceeds | unit | `npx jest function-executor -t "unlimited membership no deduction"` | ❌ Wave 0 extension |
| ENFC-01 | `set_enforcement_policy` tool updates businesses.enforcement_policy | unit | `npx jest billing-enforcement-policy -t "set policy"` | ❌ Wave 0 |
| ENFC-02 | Block policy: booking refused with Greek message | unit | `npx jest function-executor -t "block policy refuses booking"` | ❌ Wave 0 extension |
| ENFC-03 | Flag policy: booking succeeds + owner receives Greek alert | unit | `npx jest function-executor -t "flag policy sends owner alert"` | ❌ Wave 0 extension |

### Sampling Rate
- **Per task commit:** `npx jest --testPathPattern="function-executor|session-deduction|enforcement-policy" --no-coverage`
- **Per wave merge:** `npx jest --no-coverage`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/billing-session-deduction.test.ts` — covers SESS-01 (atomic deduction, idempotency, SELECT FOR UPDATE); integration test against `randevuclaw_test` DB following `billing-membership-creation.test.ts` pattern
- [ ] `tests/billing-enforcement-policy.test.ts` — covers ENFC-01 (set_enforcement_policy tool); unit test with jest.mock following `billing-tools.test.ts` pattern
- [ ] Extend `tests/function-executor.test.ts` — add test cases for SESS-02, SESS-03, SESS-04, ENFC-02, ENFC-03 following existing mock-based unit test pattern
- [ ] Apply `migrations/0007_enforcement_policy.sql` to `randevuclaw_test` before integration tests run

---

## Security Domain

`security_enforcement` is enabled (absent = enabled per config.json).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | n/a — phase extends existing auth flows |
| V3 Session Management | no | n/a |
| V4 Access Control | yes | Enforcement policy gating before `insertBooking`; ownership check already in place via `withBusinessContext` |
| V5 Input Validation | yes | Zod validation on `set_enforcement_policy` tool args: `.enum(['allow', 'block', 'flag'])` |
| V6 Cryptography | no | n/a — no new secrets |

### Known Threat Patterns for Phase 8 Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Booking with forged `business_id` to bypass enforcement | Spoofing | Existing dispatcher-level cross-tenant check in `executeTool` (line 75–78 of function-executor.ts) |
| Replay attack: re-send a booking Telegram update to deduct sessions again | Repudiation | `idempotency_key = 'booking:<bookingId>:deduction'` + `onConflictDoNothing()` prevents duplicate deduction |
| Concurrent session deduction race (overselling sessions) | Tampering | `SELECT ... FOR UPDATE` via `.for('update')` serializes concurrent bookings on same membership |
| Cancelling another client's booking to steal their credit | Elevation of Privilege | `booking.clientPhone !== context.clientPhone` check in cancelAppointmentTool (existing, unchanged) |
| Owner policy set by non-owner (policy spoofing) | Tampering | `set_enforcement_policy` tool only reachable via `aiOwnerAgent`, which is gated on `business.ownerTelegramId === senderTelegramId` in telegram.ts |
| Null pointer on `business.enforcementPolicy` before migration | Denial of Service | Default `'allow'` in migration + null-coalescing in code: `context.business.enforcementPolicy ?? 'allow'` |

---

## Environment Availability

All required tools and services are available (Phase 8 uses no new external dependencies).

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL (randevuclaw_test) | integration tests | ✓ [ASSUMED — used by billing-membership-creation tests] | local | — |
| Neon (live DB) | schema migration deployment | ✓ [ASSUMED — Phase 7 already deployed] | managed | — |
| drizzle-orm `for('update')` | SELECT FOR UPDATE | ✓ [VERIFIED: select.d.ts line 586 in 0.45.2] | 0.45.2 | — |

**Missing dependencies with no fallback:** None.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Mutable counter-only (no ledger) | Immutable ledger + mutable counter (dual-write) | Phase 7 design decision | Audit trail for all session events; idempotency via ledger UNIQUE constraint |
| No session enforcement | Optional enforcement_policy per business | Phase 8 | Owners can choose behavior; default is backward-compatible 'allow' |

**Not deprecated:** The `sessionsRemaining` counter on `memberships` is still the read path for PAY-03 (view membership balance). The ledger is append-only audit; the counter is what `getClientActiveMembership` queries.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `randevuclaw_test` DB has `0006_billing_schema.sql` applied (billing tables exist for integration tests) | Validation Architecture | Integration tests fail on missing tables; fix: run the migration on local test DB |
| A2 | `withBusinessContext` wraps the entire request for both message and callback_query paths (verified at telegram.ts line 410) | Architecture Patterns | If not wrapped, `getConn()` returns admin `db`, atomicity still holds but RLS bypassed — low risk for session deduction correctness |
| A3 | `@google/genai` `interactions.create` accepts the new `set_enforcement_policy` tool without schema changes to the Gemini call | Standard Stack | If Gemini rejects the tool format, Phase 7 tools all use the same shape so the issue would be pre-existing |

**All assumptions are LOW risk given evidence from the codebase.**

---

## Open Questions (RESOLVED)

1. **CHECK constraint vs. app-layer validation for `enforcement_policy`**
   RESOLVED: Add both — CHECK constraint in the migration (Pattern 6, defense in depth) AND Zod `.enum(['allow', 'block', 'flag'])` in the NLU tool handler (billing/tools.ts). Plan 01 adds the CHECK constraint; Plan 02 adds the Zod validation. No downside; DB-level safety supplements app-layer guard.
   - What we know: CONTEXT.md says "Planner decides." The CHECK constraint is free to add in the migration and provides DB-level safety. App-layer validation via Zod is already planned.
   - What's unclear: Whether the `randevuclaw_app` role can violate the constraint (it shouldn't but a direct SQL injection attack bypasses Zod).
   - Recommendation: Add both — CHECK constraint in the migration (defense in depth) AND Zod `.enum()` in the NLU tool handler. No downside.

2. **`getClientActiveMembership` vs. a new `getActiveMembershipForDeduction` function**
   RESOLVED: Add a new `getActiveMembershipForDeduction()` function with `.for('update')` SELECT locking. The existing `getClientActiveMembership` stays untouched (PAY-03 read path does not need row locking). New function created in Plan 03 (billing/queries.ts extension).
   - What we know: Existing `getClientActiveMembership` in billing/queries.ts does NOT use `.for('update')`. Phase 8 needs the locked variant.
   - What's unclear: Whether to overload the existing function with a `lockForUpdate?: boolean` param or add a new function.
   - Recommendation: Add a new `getActiveMembershipForDeduction()` function that returns the raw membership row (including `id`) and uses `.for('update')`. The existing `getClientActiveMembership` stays untouched (PAY-03 doesn't need locking).

---

## Sources

### Primary (HIGH confidence)
- `src/webhooks/telegram.ts` — Confirmed `withBusinessContext(business.id)` wraps ALL of `handleCallbackQuery` and `handleFoundBusiness` at line 410. [VERIFIED: local codebase]
- `drizzle-orm/pg-core/query-builders/select.d.ts` v0.45.2 — `.for('update')` available on PgSelect queries at line 586. [VERIFIED: local node_modules]
- `src/billing/queries.ts` — `createMembership` confirms `db.transaction()` + `onConflictDoNothing()` pattern; `getClientActiveMembership` confirms read path. [VERIFIED: local codebase]
- `src/database/schema.ts` — Confirmed `membershipLedger.bookingId` FK exists (Phase 7 schema), enabling credit-restore lookup without adding `membership_id` to `bookings`. [VERIFIED: local codebase]
- `migrations/0006_billing_schema.sql` — Migration pattern (IF NOT EXISTS guards, GRANT statements) for `0007_enforcement_policy.sql`. [VERIFIED: local codebase]
- `src/onboarding/ai-owner-agent.ts` — `OWNER_TOOLS` array shape for `set_enforcement_policy` tool definition. [VERIFIED: local codebase]
- `.planning/phases/08-enforcement-session-deduction/08-CONTEXT.md` — All D-01..D-12 locked decisions. [VERIFIED: local codebase]

### Secondary (MEDIUM confidence)
- `src/utils/timezone.ts` — `isoDateInAthens` for expiry comparison. Confirmed implementation matches claimed DST-safety. [VERIFIED: local codebase]
- `tests/billing-membership-creation.test.ts` — Integration test pattern (jest.resetModules + real Postgres) for new Phase 8 integration tests. [VERIFIED: local codebase]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies already installed; Drizzle `.for('update')` confirmed in local node_modules
- Architecture: HIGH — `withBusinessContext` wrapping confirmed in source; no ambiguity about transaction ownership
- Pitfalls: HIGH — all pitfalls derived from reading actual code paths; no speculation required
- Test patterns: HIGH — existing test files provide clear templates for new tests

**Research date:** 2026-07-20
**Valid until:** 2026-08-20 (stable domain; only changes if drizzle-orm or Gemini SDK is upgraded)
