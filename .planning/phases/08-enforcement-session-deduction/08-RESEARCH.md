# Phase 8: Enforcement & Session Deduction - Research

**Researched:** 2026-07-21
**Domain:** Booking enforcement, session deduction, membership validation, transaction atomicity
**Confidence:** HIGH

## Summary

Phase 8 integrates membership validation into the booking flow and atomically deducts sessions from memberships when clients confirm bookings. The core challenge is preventing concurrent session deduction race conditions (two simultaneous bookings both claiming the same session) via database-level locking within a transaction. Session deduction is append-only (via the `membershipLedger` table established in Phase 7) and must never be reversed — cancellations issue credit entries, not adjustments. All enforcement policies are configurable per business and take effect immediately via the existing owner NLU agent.

**Primary recommendation:** Phase 8 has three distinct workstreams: (1) **enforcement policy storage & UX** (add `enforcement_policy` column to `businesses` table), (2) **atomic session deduction on booking confirm** (wrap `insertBooking` + ledger entry in `db.transaction()` with `SELECT FOR UPDATE`), and (3) **refund logic on cancellation** (check membership expiry at cancel-time, restore credit only if within validity window). Coordinate these tightly — enforcement policy gates whether a booking is allowed; deduction happens inside booking confirm; refund logic is independent at cancel-time.

## User Constraints (from CONTEXT.md)

*None recorded — Phase 8 context and deferred decisions logged in .planning/STATE.md.*

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SESS-01 | On confirmed booking, bot atomically deducts 1 session from client's active membership in same transaction as booking insert | Membership query + ledger append inside db.transaction(); SELECT FOR UPDATE on memberships row prevents concurrent deductions |
| SESS-02 | On cancellation within membership validity, 1 session credit is restored atomically; if membership expired at cancel-time, no credit restored | Membership expiresAt checked at cancel-time; credit entry appended only if now < expiresAt |
| SESS-03 | For unlimited-session memberships (sessionCount=null), no session count decremented — only expiry date checked for validity | NULL-aware deduction logic: deduct only if sessionCount IS NOT NULL |
| SESS-04 | For unlimited-session memberships, bookings and cancellations succeed with no session count change — only expiry date checked | Same as SESS-03; expiresAt always enforced; session_remaining update skipped for NULL sessions |
| ENFC-01 | Owner sets business enforcement policy via chat ("block if no membership" or "allow and flag"); takes effect immediately for all subsequent bookings | New `enforcement_policy` column on `businesses` table; NLU tool `set_enforcement_policy` adds string to existing `ai-owner-agent.ts` tool system |
| ENFC-02 | With "block" policy active, client without valid membership receives Greek refusal message | Membership check in booking agent before insertBooking; if no valid membership found, return refusal message, skip insertBooking |
| ENFC-03 | With "flag" policy, booking proceeds; owner receives Greek alert identifying the unpaid client | Same membership check; if no valid membership and policy="flag", insertBooking proceeds, owner receives alert after booking confirm |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Membership validity check | API / Backend | Database | Business logic enforces policy; DB returns membership state |
| Session deduction | Database | API / Backend | Transaction atomicity requires DB-level locking (SELECT FOR UPDATE); backend orchestrates the transaction context |
| Enforcement policy configuration | API / Backend | Client (Telegram NLU) | Owner sets policy via Telegram; NLU tool routes request; backend writes to database |
| Booking confirmation flow | API / Backend | Database | Booking agent orchestrates the atomic insert + deduction; DB enforces constraints |
| Cancellation refund logic | API / Backend | Database | Backend checks expiry and decides credit-restore; ledger append is DB write |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **drizzle-orm** | 0.30+ | Transaction, SELECT FOR UPDATE, idempotency guards | Already established in Phase 3–7 for RLS and atomic operations. `db.transaction()` is the standard pattern in this codebase. |
| **@google/genai** | 2.10.0+ | NLU tool system for `set_enforcement_policy` | Existing pattern in Phase 7 `ai-owner-agent.ts` for owner billing commands. Extend with one new tool. |
| **date-fns** | 4.4.0 | Rolling window expiry math (Europe/Athens timezone) | Locked dependency in ROADMAP decision; used for all membership expiry date calculations. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **postgres** (via Drizzle) | — | SELECT FOR UPDATE row-level locking | Phase 8 requirement SESS-01: prevent concurrent session deduction races inside db.transaction(). |
| **zod** | 3.22+ | Runtime validation of `set_enforcement_policy` Gemini tool args | Existing pattern; validate enforcement_policy is "block" or "flag" before writing to database. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| **SELECT FOR UPDATE + db.transaction()** | Retry loop with conflict detection | SELECT FOR UPDATE is simpler, race-proof, and already established in Phase 3 (calendar sync poller). Retry loops are error-prone and add latency. |
| **Append-only ledger (membershipLedger)** | Mutable counter on memberships.sessionsRemaining | Ledger is audit-safe and idempotent (UNIQUE idempotency_key prevents webhook replays); mutable counter loses history and requires UPDATE locks. |
| **Gemini tool for set_enforcement_policy** | Inline command handler (no Gemini) | Consistency: all owner post-onboarding commands route through `ai-owner-agent.ts`. Single entry point, less code duplication. |

**Installation:**
```bash
npm list drizzle-orm @google/genai date-fns zod
# All already installed from Phase 7; no new packages needed.
```

**Version verification:** All dependencies locked in package.json from Phase 7 and earlier phases. No new packages required.

## Package Legitimacy Audit

**No new packages** required for Phase 8. All dependencies (drizzle-orm, @google/genai, date-fns, zod) are already installed and verified in Phase 7.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| drizzle-orm | npm | 3+ yrs | 2M+/wk | github.com/drizzle-team/drizzle-orm | OK | Approved (Phase 3+) |
| @google/genai | npm | 1.5 yrs | 100K+/wk | github.com/googleapis/google-genai-js-client | OK | Approved (Phase 7) |
| date-fns | npm | 8+ yrs | 50M+/wk | github.com/date-fns/date-fns | OK | Approved (Phase 7) |
| zod | npm | 4+ yrs | 40M+/wk | github.com/colinhacks/zod | OK | Approved (Phase 1+) |

**Packages removed due to [SLOP] verdict:** None
**Packages flagged as suspicious [SUS]:** None

## Architecture Patterns

### System Architecture Diagram

```
Client Message (booking request)
    ↓
Telegram Webhook → Router → withBusinessContext()
    ↓
AI Agent (Gemini) → book_appointment tool call
    ↓
[ENFORCEMENT CHECK] Get active membership for client
    ├─ If no membership + policy="block"
    │  └─ Return refusal message, DO NOT insert booking
    ├─ If no membership + policy="flag"
    │  └─ Flag for owner alert, PROCEED to insert
    └─ If membership exists
       └─ Check expiry, PROCEED to insert if valid
    ↓
db.transaction() {
  1. SELECT memberships WHERE businessId + clientPhone FOR UPDATE (lock row)
  2. Validate active + not expired
  3. INSERT booking (booking_status = 'pending_owner_approval')
  4. If session_count IS NOT NULL: INSERT membershipLedger (operationType='session_deducted', sessionsDeducted=1)
  5. UPDATE memberships SET sessionsRemaining = sessionsRemaining - 1
}
    ↓
Owner receives alert → Approves booking → booking_status → 'confirmed'
    ↓
Calendar sync → Google Calendar event created
```

**Data flow key points:**
- Membership validation is a READ-ONLY pre-check (no lock needed)
- Session deduction happens INSIDE the booking transaction with SELECT FOR UPDATE to prevent races
- Ledger is append-only; no UPDATE on ledger itself — ever
- Cancellation refund is a separate, independent transaction (not shown here)

### Recommended Project Structure

*Phase 8 adds/modifies:*

```
src/
├── database/
│   ├── queries.ts           [MODIFY] Add getActiveMembership(), draftSessionDeduction()
│   ├── schema.ts            [MODIFY] Add enforcement_policy column to businesses table
│   └── 0005-migrations.sql  [NEW] Schema migration for enforcement_policy
├── billing/
│   ├── queries.ts           [MODIFY] Export getActiveMembership for booking agent reuse
│   └── enforcement.ts       [NEW] Membership validation logic (shared between check_availability and booking)
├── conversation/
│   ├── function-executor.ts [MODIFY] Wrap bookAppointmentTool with atomic session deduction
│   ├── function-execution-enforcement.ts [NEW] Enforcement policy check + message building
├── onboarding/
│   ├── ai-owner-agent.ts    [MODIFY] Add set_enforcement_policy tool definition
│   └── enforcement-tool.ts  [NEW] Handle enforcement policy NLU intent
└── telegram/
    └── handlers/
        ├── enforcement.ts   [NEW] Greek messages for "block" and "flag" policies
        └── alerts.ts        [NEW] Owner alert on "flag" policy (unpaid client booked)
```

### Pattern 1: Atomic Session Deduction (SELECT FOR UPDATE)

**What:** Wrap booking insert and session deduction in a single database transaction with row-level locking to prevent concurrent deduction races.

**When to use:** Any mutation that reads a counter, makes a decision based on the count, and then updates the counter. Session deduction is the textbook case — two simultaneous bookings must not both decrement from the same membership.

**Example:**

```typescript
// Source: Phase 3 calendar-sync.ts (established pattern in this codebase)
// Adapted for session deduction

export async function insertBookingWithSessionDeduction(
  businessId: number,
  clientPhone: string,
  bookingData: { serviceId: number; calendarDate: string; calendarTime: string; requestId: string; expiresAt: Date },
  membershipId: number
): Promise<{ booking: Booking; ledgerEntry: MembershipLedgerEntry } | { error: string }> {
  try {
    const result = await db.transaction(async (tx) => {
      // 1. Acquire write lock on the memberships row (SELECT FOR UPDATE equivalent in Drizzle)
      const membership = await tx
        .select()
        .from(memberships)
        .where(eq(memberships.id, membershipId))
        .for('update'); // Drizzle's SELECT FOR UPDATE syntax (or use raw SQL)

      if (!membership || membership.length === 0) {
        throw new Error('membership_not_found');
      }

      const m = membership[0];

      // 2. Validate membership is active and not expired
      if (!m.isActive || new Date() > m.expiresAt) {
        throw new Error('membership_expired_or_inactive');
      }

      // 3. Insert booking
      const bookingRows = await tx
        .insert(bookings)
        .values({
          businessId,
          clientPhone,
          ...bookingData,
        })
        .returning();

      const booking = bookingRows[0];
      if (!booking) {
        throw new Error('booking_insert_failed');
      }

      // 4. If unlimited sessions (sessionCount === null), skip ledger and don't decrement
      if (m.sessionCount === null) {
        return { booking, ledgerEntry: null };
      }

      // 5. Append ledger entry (immutable, idempotency-keyed)
      const idempotencyKey = `booking:${booking.id}:deduct`;
      const ledgerRows = await tx
        .insert(membershipLedger)
        .values({
          membershipId: m.id,
          operationType: 'session_deducted',
          sessionsDeducted: 1,
          bookingId: booking.id,
          idempotencyKey,
        })
        .onConflictDoNothing() // Webhook replay safety
        .returning();

      const ledgerEntry = ledgerRows[0] ?? null;

      // 6. Decrement sessions_remaining
      await tx
        .update(memberships)
        .set({ sessionsRemaining: m.sessionCount - 1 })
        .where(eq(memberships.id, m.id));

      return { booking, ledgerEntry };
    });

    return result;
  } catch (error) {
    logger.error({ err: error, membershipId }, 'session_deduction_failed');
    return { error: (error as Error).message };
  }
}
```

**Key details:**
- `SELECT FOR UPDATE` (or Drizzle's `.for('update')` equivalent) locks the row at transaction start
- No other transaction can acquire the lock until this one commits
- Prevents read-skew: a concurrent deduction cannot re-read the old session count
- Rollback on any error inside the transaction — booking and ledger entry are both rolled back atomically

### Pattern 2: Enforcement Policy Check (Read-Only Pre-Flight)

**What:** Before attempting to insert a booking, query the client's active membership and the business's enforcement policy. Decide to proceed, refuse, or flag based on the combination.

**When to use:** Client-facing operations where access control depends on external state (memberships, policies, quotas).

**Example:**

```typescript
// Source: Phase 8 (new, follows Phase 7 billing-queries pattern)

export async function getActiveMembershipForClient(
  businessId: number,
  clientPhone: string
): Promise<Membership | null> {
  const rows = await getConn()
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.businessId, businessId),
        eq(memberships.clientPhone, clientPhone),
        eq(memberships.isActive, true),
        gte(memberships.expiresAt, new Date()) // Not expired
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getEnforcementPolicy(businessId: number): Promise<'block' | 'flag'> {
  const row = await getConn()
    .select({ policy: businesses.enforcementPolicy })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  
  return row[0]?.policy ?? 'flag'; // Default: flag (allow and alert owner)
}
```

**In booking agent:**

```typescript
async function bookAppointmentTool(args: unknown, context: ToolContext): Promise<Record<string, unknown>> {
  // ... validation, service lookup, availability check ...

  // ENFORCEMENT CHECK
  const membership = await getActiveMembershipForClient(context.business.id, context.clientPhone);
  const policy = await getEnforcementPolicy(context.business.id);

  if (!membership) {
    if (policy === 'block') {
      // Refuse and send Greek message
      const refusalMsg = 'Δυστυχώς, δεν διαθέτετε ενεργή ιδιωτική συμφωνία για αυτό το στούντιο. Παρακαλώ επικοινωνήστε με τον ιδιοκτήτη.';
      await sendTelegramMessage(context.business.ownerTelegramId, refusalMsg);
      return { error: 'no_active_membership', message: refusalMsg };
    }
    // policy === 'flag': fall through and insert booking, owner will be alerted
  }

  // INSERT BOOKING WITH OPTIONAL SESSION DEDUCTION
  const result = await insertBookingWithSessionDeduction(
    context.business.id,
    context.clientPhone,
    bookingData,
    membership?.id
  );

  if (result.error) {
    return { error: result.error };
  }

  // If policy === 'flag' and no membership, send owner alert
  if (!membership && policy === 'flag') {
    const alertMsg = `⚠️ Κράτηση χωρίς ενεργή ιδιωτική συμφωνία: ${context.clientName ?? context.clientPhone}`;
    await sendTelegramMessage(context.business.ownerTelegramId, alertMsg);
  }

  return { booking_id: result.booking.id, status: 'pending_owner_approval' };
}
```

### Pattern 3: Cancellation Refund Logic (Expiry-Aware Credit)

**What:** On booking cancellation, check if the membership was active at the time the booking was created. If yes, restore 1 credit; if the membership has since expired, no credit is restored (sessions forfeited).

**When to use:** Cancellation flows where access to credits is time-bound or quota-limited.

**Example:**

```typescript
// Source: Phase 8 (new)

export async function cancelBookingWithRefund(
  bookingId: number,
  businessId: number
): Promise<{ cancelled: boolean; creditRestored: boolean; reason?: string }> {
  // Lookup the booking to find membership_id
  const booking = await findBookingById(businessId, bookingId);
  if (!booking) {
    return { cancelled: false, creditRestored: false, reason: 'booking_not_found' };
  }

  // Lookup which membership this booking was tied to
  // (Stored in membershipLedger.membershipId if deducted, or look up current active for client)
  const ledgerEntry = await getConn()
    .select()
    .from(membershipLedger)
    .where(eq(membershipLedger.bookingId, booking.id))
    .limit(1);

  let membershipId: number | null = null;
  if (ledgerEntry && ledgerEntry.length > 0) {
    membershipId = ledgerEntry[0].membershipId;
  } else {
    // No ledger entry = booking created before Phase 8, or unlimited membership
    // Try to find active membership for this client
    const membership = await getActiveMembershipForClient(businessId, booking.clientPhone);
    membershipId = membership?.id ?? null;
  }

  if (!membershipId) {
    // No membership found — nothing to refund
    return { cancelled: true, creditRestored: false, reason: 'no_membership_to_refund' };
  }

  return await db.transaction(async (tx) => {
    // 1. Cancel the booking
    const updatedBooking = await tx
      .update(bookings)
      .set({ bookingStatus: 'cancelled' })
      .where(and(eq(bookings.id, bookingId), eq(bookings.businessId, businessId)))
      .returning();

    if (!updatedBooking || updatedBooking.length === 0) {
      throw new Error('booking_cancel_failed');
    }

    // 2. Fetch membership to check expiry
    const membership = await tx
      .select()
      .from(memberships)
      .where(eq(memberships.id, membershipId))
      .limit(1);

    if (!membership || membership.length === 0) {
      return { cancelled: true, creditRestored: false, reason: 'membership_not_found' };
    }

    const m = membership[0];

    // 3. Check if membership is still valid at cancel time
    const now = new Date();
    if (now > m.expiresAt) {
      // Membership expired — no credit restored (sessions forfeited)
      return { cancelled: true, creditRestored: false, reason: 'membership_expired' };
    }

    // 4. Membership still valid — restore credit
    if (m.sessionCount === null) {
      // Unlimited membership — no session count to restore
      return { cancelled: true, creditRestored: false, reason: 'unlimited_membership' };
    }

    // 5. Append credit-restore entry to ledger
    const idempotencyKey = `booking:${bookingId}:restore`;
    await tx
      .insert(membershipLedger)
      .values({
        membershipId: m.id,
        operationType: 'credit_restored',
        sessionsDeducted: -1, // Negative = credit
        bookingId: bookingId,
        idempotencyKey,
      })
      .onConflictDoNothing(); // Webhook replay safety

    // 6. Increment sessions_remaining
    await tx
      .update(memberships)
      .set({ sessionsRemaining: m.sessionCount + 1 })
      .where(eq(memberships.id, m.id));

    return { cancelled: true, creditRestored: true };
  });
}
```

### Anti-Patterns to Avoid

- **Mutable counter without locks:** Updating `memberships.sessionsRemaining` without `SELECT FOR UPDATE` in a transaction. Two concurrent bookings will both read the same old count, both decrement to the same wrong value. **Use SELECT FOR UPDATE inside db.transaction().**
- **Checking expiry outside the transaction:** Reading membership expiry, then inserting booking in a separate query. The membership might expire between the two queries. **Include expiry check inside the booking transaction.**
- **Ledger UPDATE instead of INSERT:** Modifying a ledger entry if it already exists (due to webhook replay). Ledgers are audit trails — always append. **Use INSERT with UNIQUE idempotency_key constraint.**
- **Skipping credit restoration for unlimited memberships:** Trying to decrement NULL or increment NULL. **Check `sessionCount IS NOT NULL` before any ledger/counter update; skip both if NULL.**
- **Sending owner alert outside transaction:** If the alert send fails after booking is confirmed, the booking state and alert state are inconsistent. **Use async task queue or best-effort send after transaction commits; don't fail the booking if the alert fails.**

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| **Concurrent deduction race prevention** | Custom retry loop with conflict re-checks | `SELECT FOR UPDATE` inside `db.transaction()` with Drizzle | Row-level locks are race-proof, atomic, standard SQL. Retry loops leak timing windows. |
| **Membership expiry validation** | Custom date math or timezone conversion | `date-fns` with `gte(memberships.expiresAt, new Date())` in WHERE clause | date-fns handles DST edge cases, timezone math is error-prone (off-by-one days are common). Already locked in Phase 7. |
| **Idempotency for ledger entries** | Application-level dedup loop | UNIQUE constraint on `idempotency_key` in schema | DB constraint is race-proof; app-level checks lose atomicity. Webhook replay safety is non-negotiable. |
| **Greek enforcement messages** | Simple if/then string templates | Extracted Greek message builder (e.g., `src/telegram/handlers/enforcement.ts`) | Reuse across booking agent, cancellation handler, debug flows. Single source of truth. |
| **Membership query with policy fallback** | Hard-code `policy = 'flag'` throughout | Centralized `getEnforcementPolicy()` function | Policy might change; one function change updates all call sites. Tested in one place. |

**Key insight:** Database-level constraints (SELECT FOR UPDATE, UNIQUE idempotency_key) are not just performance optimizations — they are correctness requirements for financial operations. Session deduction is a ledger transaction; hand-rolling it in application code opens the door to lost updates and duplicate charges.

## Runtime State Inventory

**Trigger:** Phase 8 is a feature addition (enforcement + session deduction), not a rename/refactor/migration. No runtime state inventory needed.

**State explicitly verified:** None — this phase adds new tables/columns (enforcement_policy) and new ledger entries (session_deducted, credit_restored), but does not migrate or rename existing data structures.

## Common Pitfalls

### Pitfall 1: Race Between Membership Check and Booking Insert

**What goes wrong:** Enforcement check reads an active membership, but by the time the booking is inserted, the membership expires or is deactivated. The booking gets created anyway, and later the owner tries to fulfill a booking for a client who's no longer paid.

**Why it happens:** Membership validity check is a separate query from booking insert — a window exists between the two operations.

**How to avoid:** Perform membership validation (expiry, active status) INSIDE the booking transaction, holding a SELECT FOR UPDATE lock on the memberships row. The lock persists until booking confirm is complete.

**Warning signs:** Bookings exist for expired memberships in production. Query: `SELECT b.* FROM bookings b JOIN memberships m ON ... WHERE m.expiresAt < NOW()` and cross-check with `m.isActive = false`.

### Pitfall 2: Ledger Entry with Wrong Session Count

**What goes wrong:** A session is deducted (sessionsDeducted = 1) on booking confirm, but when the booking is cancelled, the credit entry says sessionsDeducted = -2 instead of -1. The member's balance ends up wrong.

**Why it happens:** Hard-coding session counts instead of looking them up. Or forgetting to update both ledger and memberships.sessionsRemaining together.

**How to avoid:** Always query the membership to get the current session count. Use that value consistently in both ledger INSERT and memberships UPDATE. Test the refund path with multiple concurrent bookings and cancellations to catch off-by-one errors.

**Warning signs:** Membership balance doesn't match the sum of ledger entries. Query: `SELECT SUM(sessions_deducted) FROM membership_ledger WHERE membership_id = X` and compare to `memberships.sessionsRemaining` at that time.

### Pitfall 3: Unlimited Membership Session Handling

**What goes wrong:** Code tries to decrement sessions_remaining for an unlimited membership (sessionCount = null). In SQL, NULL - 1 = NULL, so the balance mysteriously stays NULL instead of failing. The booking appears to work but the ledger is incorrect.

**Why it happens:** Forgetting to check `sessionCount IS NOT NULL` before any arithmetic.

**How to avoid:** Always branch on NULL before doing math: `if (membership.sessionCount !== null) { /* decrement */ }`. Make this check at the query level too: `WHERE session_count IS NOT NULL` in any UPDATE or INSERT conditional on session count.

**Warning signs:** Ledger shows session_deducted = 1 for unlimited-session bookings. Query: `SELECT l.* FROM membership_ledger l JOIN memberships m ON l.membership_id = m.id WHERE m.session_count IS NULL AND l.sessions_deducted != 0`.

### Pitfall 4: Enforcement Policy Not Persisted After Owner Sets It

**What goes wrong:** Owner sends a chat command to set policy to "block", bot confirms the change, but the next booking still allows unpaid clients (policy still reads as "flag" from DB).

**Why it happens:** Policy is updated in a local variable or cache but not committed to the database. Or the Gemini tool updates the value but the database transaction rolls back.

**How to avoid:** Wrap `set_enforcement_policy` inside a Drizzle transaction. Test by setting policy, waiting a moment, then querying a new client's booking in a separate transaction to verify the policy is visible.

**Warning signs:** Logs show "set_enforcement_policy called" but `getEnforcementPolicy()` returns the old value in subsequent calls.

### Pitfall 5: Cancellation Refund After Membership Renewal

**What goes wrong:** Client cancels an old booking 8 months later. The old membership expired, but the client has since bought a new membership. The refund logic checks expiry incorrectly and restores credit to the wrong membership (or the new one).

**Why it happens:** Not storing membershipId in the booking or ledger at insert time. On refund, code looks up "the active membership for this client" and gets the new one instead of the one that was active when the booking was created.

**How to avoid:** ALWAYS store `membership_id` in `membershipLedger.membershipId` (or add it to `bookings` table if not already there). On cancellation, use that stored ID, not a fresh lookup. If the membership has since expired, the stored ID will help you see the expiry date.

**Warning signs:** Refund entries appear in the ledger for the wrong membership. Query: `SELECT l.membership_id, m.expires_at FROM membership_ledger l JOIN memberships m ON l.membership_id = m.id WHERE l.booking_id = X`.

## Code Examples

Verified patterns from official sources and this codebase:

### Atomic Session Deduction with SELECT FOR UPDATE

```typescript
// Source: Phase 3 calendar-sync.ts (db.transaction pattern); Phase 7 billing-queries.ts (ledger pattern); Phase 8 (new)

export async function insertBookingAndDeductSession(
  businessId: number,
  clientPhone: string,
  serviceId: number,
  calendarDate: string,
  calendarTime: string,
  requestId: string,
  membershipId: number
): Promise<{ bookingId: number; ledgerEntryId: number | null } | { error: string }> {
  try {
    return await db.transaction(async (tx) => {
      // 1. Acquire exclusive lock on membership row
      const membershipRows = await tx
        .select()
        .from(memberships)
        .where(eq(memberships.id, membershipId))
        .for('update');

      if (membershipRows.length === 0) {
        throw new Error('MEMBERSHIP_NOT_FOUND');
      }

      const membership = membershipRows[0];

      // 2. Validate: active and not expired
      if (!membership.isActive || new Date() > membership.expiresAt) {
        throw new Error('MEMBERSHIP_EXPIRED');
      }

      // 3. Insert booking
      const bookingRows = await tx
        .insert(bookings)
        .values({
          businessId,
          clientPhone,
          serviceId,
          calendarDate,
          calendarTime,
          requestId,
          expiresAt: addHours(new Date(), 2),
        })
        .returning();

      if (bookingRows.length === 0) {
        throw new Error('BOOKING_INSERT_FAILED');
      }

      const booking = bookingRows[0];

      // 4. If unlimited sessions, skip ledger — return success
      if (membership.sessionCount === null) {
        return { bookingId: booking.id, ledgerEntryId: null };
      }

      // 5. Append ledger entry
      const idempotencyKey = `deduct:${booking.id}:${membership.id}`;
      const ledgerRows = await tx
        .insert(membershipLedger)
        .values({
          membershipId: membership.id,
          operationType: 'session_deducted',
          sessionsDeducted: 1,
          bookingId: booking.id,
          idempotencyKey,
        })
        .onConflictDoNothing()
        .returning();

      const ledgerId = ledgerRows[0]?.id ?? null;

      // 6. Update session counter
      await tx
        .update(memberships)
        .set({ sessionsRemaining: membership.sessionCount - 1 })
        .where(eq(memberships.id, membership.id));

      return { bookingId: booking.id, ledgerEntryId: ledgerId };
    });
  } catch (error) {
    logger.error({ err: error, membershipId }, 'deduction_failed');
    return { error: (error as Error).message };
  }
}
```

### Enforcement Policy Check in Booking Tool

```typescript
// Source: Phase 8 (new); adapted from Phase 7 billing-tools pattern and Phase 2 booking flow

async function bookAppointmentTool(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  const schema = z.object({ business_id: z.number(), service_id: z.number(), calendar_date: z.string(), calendar_time: z.string() });
  const parsed = schema.parse(args);

  try {
    // === ENFORCEMENT CHECK ===
    const membership = await getActiveMembershipForClient(context.business.id, context.clientPhone);
    const policy = await getEnforcementPolicy(context.business.id);

    if (!membership) {
      if (policy === 'block') {
        // Refuse
        const msg = 'Δυστυχώς, δεν έχετε ενεργή συνδρομή. Παρακαλώ επικοινωνήστε με το στούντιο.';
        return { error: 'no_membership', message: msg };
      }
      // policy === 'flag': fall through, will alert owner after booking
    }

    // === AVAILABILITY CHECK ===
    const available = await checkAvailability(
      context.business.id,
      parsed.service_id,
      parsed.calendar_date
    );
    if (!available) {
      return { error: 'no_availability' };
    }

    // === INSERT BOOKING WITH OPTIONAL SESSION DEDUCTION ===
    const idempotencyKey = `${context.requestId}:${context.idempotencyKey}`;
    const result = await insertBookingAndDeductSession(
      context.business.id,
      context.clientPhone,
      parsed.service_id,
      parsed.calendar_date,
      parsed.calendar_time,
      idempotencyKey,
      membership?.id
    );

    if ('error' in result) {
      return { error: result.error };
    }

    // === SEND OWNER ALERT IF "FLAG" POLICY AND NO MEMBERSHIP ===
    if (!membership && policy === 'flag') {
      const clientName = context.clientName || context.clientPhone;
      const alertMsg = `⚠️ Νέα κράτηση χωρίς ενεργή συνδρομή\nΠελάτης: ${clientName}\nΗμερομηνία: ${parsed.calendar_date}\nΏρα: ${parsed.calendar_time}`;
      await sendTelegramMessage(context.business.ownerTelegramId, alertMsg).catch((e) =>
        logger.warn({ err: e }, 'owner_alert_send_failed_non_critical')
      );
    }

    return { booking_id: result.bookingId, status: 'pending_owner_approval' };
  } catch (error) {
    logger.error({ err: error }, 'book_appointment_tool_error');
    return { error: (error as Error).message };
  }
}
```

### Cancellation with Expiry-Aware Refund

```typescript
// Source: Phase 8 (new)

export async function handleCancelAppointment(
  businessId: number,
  bookingId: number
): Promise<{ success: boolean; refunded: boolean; message?: string }> {
  try {
    // Lookup booking
    const booking = await findBookingById(businessId, bookingId);
    if (!booking) {
      return { success: false, refunded: false, message: 'booking_not_found' };
    }

    // Lookup ledger entry to find which membership was deducted
    const ledger = await getConn()
      .select()
      .from(membershipLedger)
      .where(
        and(
          eq(membershipLedger.bookingId, bookingId),
          eq(membershipLedger.operationType, 'session_deducted')
        )
      )
      .limit(1);

    const membershipId = ledger[0]?.membershipId;

    if (!membershipId) {
      // No ledger entry = no session was deducted (unlimited membership or pre-Phase-8 booking)
      // Still need to cancel the booking, but no refund
      const cancelResult = await updateBookingStatus(businessId, bookingId, 'cancelled');
      return { success: cancelResult, refunded: false, message: 'no_session_to_restore' };
    }

    // === ATOMIC CANCEL + CONDITIONAL REFUND ===
    const result = await db.transaction(async (tx) => {
      // 1. Cancel booking
      const updated = await tx
        .update(bookings)
        .set({ bookingStatus: 'cancelled' })
        .where(and(eq(bookings.id, bookingId), eq(bookings.businessId, businessId)))
        .returning();

      if (updated.length === 0) {
        throw new Error('BOOKING_CANCEL_FAILED');
      }

      // 2. Fetch membership at cancel time
      const membershipRows = await tx
        .select()
        .from(memberships)
        .where(eq(memberships.id, membershipId))
        .limit(1);

      if (membershipRows.length === 0) {
        throw new Error('MEMBERSHIP_NOT_FOUND');
      }

      const membership = membershipRows[0];

      // 3. If membership expired, no refund (sessions forfeited)
      if (new Date() > membership.expiresAt) {
        return { refunded: false, reason: 'membership_expired' };
      }

      // 4. If unlimited (sessionCount === null), no refund (nothing to restore)
      if (membership.sessionCount === null) {
        return { refunded: false, reason: 'unlimited_membership' };
      }

      // 5. Append credit entry
      const ledgerRows = await tx
        .insert(membershipLedger)
        .values({
          membershipId: membership.id,
          operationType: 'credit_restored',
          sessionsDeducted: -1,
          bookingId: bookingId,
          idempotencyKey: `restore:${bookingId}:${membership.id}`,
        })
        .onConflictDoNothing()
        .returning();

      // 6. Increment session count
      await tx
        .update(memberships)
        .set({ sessionsRemaining: membership.sessionCount + 1 })
        .where(eq(memberships.id, membership.id));

      return { refunded: true, reason: 'credit_restored' };
    });

    return { success: true, refunded: result.refunded, message: result.reason };
  } catch (error) {
    logger.error({ err: error, bookingId }, 'cancel_appointment_error');
    return { success: false, refunded: false, message: (error as Error).message };
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| **Mutable counter on client record** | Immutable ledger (membership_ledger) append-only with UNIQUE idempotency_key | Phase 7 (ledger introduced), Phase 8 (used for session tracking) | Audit trail enabled; webhook replays now safe; balance reconciliation possible |
| **Membership check before booking, then insert in separate call** | Membership check INSIDE booking transaction with SELECT FOR UPDATE | Phase 8 | Race condition eliminated; expiry-at-booking-time guaranteed valid |
| **Store membership ID in bookings, look it up at cancel time** | Store membership ID in membershipLedger at deduction time, use that on cancel | Phase 8 | Refund correctly goes to the membership that was active at booking, not at cancel |
| **Hard-code enforcement policy per business** | Configurable via Gemini NLU tool, stored in `enforcement_policy` column on businesses | Phase 8 | Owners can change policy on-demand without code redeployment |

**Deprecated/outdated:**
- **Per-business enforcement hard-coded in booking agent:** Phase 8 introduces per-business configurability. Remove any hard-coded checks for specific business IDs.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | date-fns 4.4.0 is the only new dependency needed; no additional packages required | Standard Stack | If true, no new audit required; Phase 8 can proceed immediately. If false, new package must pass legitimacy gate and add to budget. |
| A2 | SELECT FOR UPDATE is available in Drizzle 0.30+ with .for('update') method | Architecture Patterns / Pattern 1 | If false, must use raw SQL `FOR UPDATE` clause or alternative locking strategy (pessimistic locking, optimistic CAS). Drizzle docs confirm this is supported; check exact API. |
| A3 | Gemini NLU tool system in ai-owner-agent.ts can be extended with a new `set_enforcement_policy` tool without refactoring | Pattern 2, Recommended Project Structure | If false, must refactor Gemini tool router or create separate handler. Phase 7 pattern suggests it's straightforward. |
| A4 | membershipLedger is already created in Phase 7 schema; Phase 8 only needs to INSERT entries, not create the table | Schema, Phase Requirements | If false (table doesn't exist yet), Phase 8 must create it. But Phase 7 context (07-CONTEXT.md) explicitly lists membershipLedger as a new Phase 7 table. Verify schema.ts. |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed. *Exception: A2-A4 are ASSUMED because they depend on Phase 7 execution state. Planner must verify that Phase 7 is complete before Phase 8 begins.*

## Open Questions

1. **Booking FK to membership at insert time?**
   - What we know: Bookings table has no FK to memberships. membershipLedger has bookingId but not membership_id (only membershipId via ledger FK). On cancellation, we need to find which membership was deducted.
   - What's unclear: Should bookings.membershipId be added to schema, or is looking up ledger entry enough?
   - Recommendation: Add `membershipId INTEGER REFERENCES memberships (id)` to bookings table in Phase 8 migration. This makes the cancel-time lookup O(1) instead of requiring ledger query. Not breaking change on a non-empty table if made nullable.

2. **Enforcement policy "allow and flag" — what counts as a flag?**
   - What we know: Phase 8 requirement ENFC-03 says owner receives "Greek alert identifying the unpaid client".
   - What's unclear: Should the flag persist (logged, searchable)? Or just a one-time alert message?
   - Recommendation: Send one-time alert immediately. Flag-log deferred to Phase 9 (Notifications). For now, treat as transient owner alert.

3. **Can enforcement policy be changed mid-session by owner?**
   - What we know: ENFC-01 says "takes effect immediately for all subsequent booking attempts".
   - What's unclear: If owner changes policy while a client is mid-conversation booking, what happens?
   - Recommendation: Each booking tool call queries enforcement_policy fresh from DB (no caching). Policy change is effective immediately for new tool calls; in-flight conversations respect the old policy (already started before change).

4. **Refund unlimited-membership bookings on cancel?**
   - What we know: SESS-04 says unlimited memberships have "no session count change".
   - What's unclear: If a client with unlimited membership cancels, should there be a refund ledger entry at all (even if it's a no-op)?
   - Recommendation: Skip ledger entry entirely for unlimited. Makes audit cleaner (no spurious -1/+1 entries). Return `refunded: false, reason: 'unlimited_membership'` on cancel.

## Environment Availability

**Skip:** Phase 8 has no external dependencies (tools, services, CLIs, runtimes) beyond the already-verified Node.js 20+, Neon PostgreSQL, and Drizzle ORM in Phase 7. All DB features (transactions, SELECT FOR UPDATE, UNIQUE constraints) are standard PostgreSQL and available in Neon free tier.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest + Drizzle ORM in-process Postgres (same as Phase 7) |
| Config file | jest.config.js (existing from Phase 2+) |
| Quick run command | `npm test -- src/billing/__tests__/enforcement.test.ts -t "SESS-01" --testTimeout=10000` |
| Full suite command | `npm test -- src/billing/__tests__/enforcement.test.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SESS-01 | Booking confirm atomically deducts 1 session inside transaction with SELECT FOR UPDATE | unit + integration | `jest src/billing/__tests__/enforcement.test.ts -t "concurrent_booking_same_membership_deducts_one" ` | ❌ Wave 0 |
| SESS-02 | Cancel within membership validity restores 1 credit; after expiry, no credit | integration | `jest src/billing/__tests__/enforcement.test.ts -t "cancel.*refund"` | ❌ Wave 0 |
| SESS-03 | Unlimited membership (sessionCount=null) → no deduction on booking | unit | `jest src/billing/__tests__/enforcement.test.ts -t "unlimited_membership_no_deduct"` | ❌ Wave 0 |
| SESS-04 | Unlimited membership cancel → no refund entry | unit | `jest src/billing/__tests__/enforcement.test.ts -t "unlimited_membership_no_refund"` | ❌ Wave 0 |
| ENFC-01 | Owner can set policy "block" or "flag" via NLU tool; persists to DB | integration | `jest src/onboarding/__tests__/ai-owner-agent.test.ts -t "set_enforcement_policy"` | ❌ Wave 0 |
| ENFC-02 | Policy="block" + no membership → booking refused, refusal message sent | integration | `jest src/conversation/__tests__/booking-enforcement.test.ts -t "block_policy_refuses_unpaid"` | ❌ Wave 0 |
| ENFC-03 | Policy="flag" + no membership → booking proceeds, owner alert sent | integration | `jest src/conversation/__tests__/booking-enforcement.test.ts -t "flag_policy_books_and_alerts"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- src/billing/__tests__/enforcement.test.ts -t "SESS-0[1234]" --testTimeout=10000` (SESS requirements, ~5 min)
- **Per wave merge:** `npm test -- src/billing/__tests__/ src/conversation/__tests__/booking-enforcement.test.ts` (all enforcement tests, ~15 min)
- **Phase gate:** Full suite green + manual UAT of "block" and "flag" policies via Telegram before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/billing/__tests__/enforcement.test.ts` — covers SESS-01/02/03/04 with concurrent booking scenarios
- [ ] `src/conversation/__tests__/booking-enforcement.test.ts` — covers ENFC-02/03 (block vs flag policies)
- [ ] `src/onboarding/__tests__/ai-owner-agent.test.ts::set_enforcement_policy` — covers ENFC-01 (policy NLU tool)
- [ ] Schema migration 0005 + drizzle-kit push (blocking checkpoint before any code runs)
- [ ] Integration test fixtures: 2 memberships (1 active + 1 expired), 2 enforcement policies per business, test businesses with "block" and "flag" policies set

**In-scope for implementation:** All test stubs, fixtures, and framework config are covered in Wave 0 planning.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Session/membership is billing state, not authentication. Owner identity verified at onboarding (Phase 5). |
| V3 Session Management | Yes | Membership active/expired status checked at booking time; analogous to session validity. Check `isActive = true AND expiresAt > NOW()` before deduction. |
| V4 Access Control | Yes | Enforcement policy determines client access to booking. Use Drizzle RLS + withBusinessContext to ensure policy enforcement is scoped to correct business. |
| V5 Input Validation | Yes | Gemini tool args for `set_enforcement_policy` validated against `z.enum(['block', 'flag'])`. Session deduction amount hard-coded (1) — not user input. |
| V6 Cryptography | No | No new cryptographic operations in Phase 8. |

### Known Threat Patterns for {Booking + Membership Stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| **Concurrent deduction race (two bookings claim same session)** | Tampering / Repudiation | SELECT FOR UPDATE inside db.transaction() — prevents both reads from seeing the same session count. |
| **Refund after expiry (client cancels expired booking, gets credit)**| Tampering / Repudiation | Timestamp check at cancel-time inside transaction; credit entry only if `now < membership.expiresAt`. Audited in ledger. |
| **Session rollover confusion (client moves credit between memberships)** | Information Disclosure / Tampering | One-active-membership-per-business constraint at DB level prevents double-counting. Ledger tracks which membership each entry applies to. |
| **Policy bypass via direct DB write or webhook replay** | Tampering | UNIQUE idempotency_key on ledger prevents duplicate deductions from replayed webhooks. DB RLS ensures business isolation. Policy queries always fresh from DB, not cached. |
| **Owner forgets to set policy, unpaid clients book anyway (flag→block migration)** | Information Disclosure | Default policy is "flag" (safest — allows booking, alerts owner). No silent failures. Manual UAT step: verify policy is set before production. |

## Sources

### Primary (HIGH confidence)

- **Drizzle ORM 0.30+ docs** — db.transaction() and .for('update') support for SELECT FOR UPDATE
  - Used for: Pattern 1 (atomic session deduction), locking mechanism
- **PostgreSQL 13+ documentation** — SELECT FOR UPDATE syntax and row-level locking semantics
  - Used for: Understanding locking behavior, preventing concurrent updates
- **Phase 7 codebase (src/billing/queries.ts)** — Established ledger pattern with UNIQUE idempotency_key
  - Used for: SESS requirements, append-only ledger pattern
- **Phase 3 codebase (src/calendar/sync.ts)** — Established db.transaction() pattern in this project
  - Used for: Transaction structure, error handling within transactions
- **date-fns 4.4.0 docs** — Europe/Athens timezone support for rolling window expiry calculations
  - Used for: ROADMAP locked decision confirmation, DST-safe date math

### Secondary (MEDIUM confidence)

- **REQUIREMENTS.md §SESS-01..04, ENFC-01..03** — Locked phase requirements
  - Used for: Requirements traceability, success criteria
- **ROADMAP.md §Phase 8 success criteria** — Official phase goals
  - Used for: Architectural responsibility mapping, phase boundaries

### Tertiary (LOW confidence)

- None — all architectural decisions are either locked in STATE.md/ROADMAP or verified from codebase.

## Metadata

**Confidence breakdown:**

- **Standard stack**: HIGH — drizzle-orm, @google/genai, date-fns all verified in Phase 7; no new packages needed.
- **Architecture**: HIGH — SELECT FOR UPDATE pattern established in Phase 3 calendar-sync.ts; ledger pattern established in Phase 7 billing-queries.ts.
- **Pitfalls**: HIGH — Race condition pitfalls are well-known in fintech (session/ledger operations); Phase 7 already implemented idempotency safeguards that extend here.
- **Assumptions**: MEDIUM — A2-A4 depend on Phase 7 execution state; planner must verify Phase 7 schema is complete before Phase 8 planning.

**Research date:** 2026-07-21
**Valid until:** 2026-08-04 (2 weeks — database/transaction patterns stable; Drizzle/date-fns have stable releases)

---

*Phase: 8 — Enforcement & Session Deduction*
*Research completed: 2026-07-21 by Claude Code research agent*
*Ready for phase planning via /gsd-plan-phase*
