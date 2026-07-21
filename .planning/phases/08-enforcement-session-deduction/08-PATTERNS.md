# Phase 8: Enforcement & Session Deduction - Pattern Map

**Mapped:** 2026-07-21
**Files analyzed:** 8 new/modified files
**Analogs found:** 7 / 8 matches

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/database/schema.ts` | schema | data-definition | `src/database/schema.ts` (existing) | exact |
| `src/database/migrations/0005-enforcement-policy.sql` | migration | data-definition | `src/database/schema.ts` (Phase 7 pattern) | role-match |
| `src/billing/queries.ts` | service/queries | CRUD | `src/billing/queries.ts` (Phase 7) | exact |
| `src/billing/enforcement.ts` | service | CRUD | `src/billing/queries.ts` (transaction pattern) | role-match |
| `src/conversation/function-executor.ts` | controller | request-response | `src/conversation/function-executor.ts` (existing) | exact |
| `src/onboarding/ai-owner-agent.ts` | controller/NLU | request-response | `src/onboarding/ai-owner-agent.ts` (existing Phase 7) | exact |
| `src/billing/__tests__/enforcement.test.ts` | test | test | `src/billing/queries.ts` (test pattern in Phase 7) | role-match |
| `src/conversation/__tests__/booking-enforcement.test.ts` | test | test | `src/conversation/function-executor.ts` (test pattern Phase 2+) | role-match |

## Pattern Assignments

### `src/database/schema.ts` (schema, data-definition)

**Analog:** `src/database/schema.ts` lines 12–44 (businesses table)

**Task:** Add `enforcementPolicy` column to businesses table (Phase 8, ENFC-01).

**Imports pattern** (lines 1–10):
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

**Table extension pattern** (lines 42–44, add after existing columns):
```typescript
// Phase 8 (nullable — table is non-empty; nullable for backward compatibility):
// enforcement policy for this business: 'block' (refuse unpaid clients) or 'flag'
// (allow and alert owner). Default is 'flag' (safest). Queried fresh on every
// booking attempt (no caching) per ENFC-01 requirement.
enforcementPolicy: text('enforcement_policy'),
```

**Nullable column convention** (existing pattern from lines 20–34):
- Non-empty table → nullable column with no default
- RLS and multi-tenant comments follow schema at lines 18–34

---

### `src/database/migrations/0005-enforcement-policy.sql` (migration, data-definition)

**Analog:** Phase 7 migration pattern (inferred from schema.ts Phase 7 comments)

**Pattern:** SQL migration file for schema changes; structure:

```sql
-- Phase 8: Add enforcement_policy column to businesses table
-- D-01: nullable because table is non-empty (Phase 1 seed businesses exist)

ALTER TABLE businesses ADD COLUMN enforcement_policy TEXT;

-- No explicit default; Postgres leaves NULL for existing rows.
-- New rows created via src/onboarding/steps.ts use NULL (app provides default at query time).
```

**Drizzle Kit Push:** After migration, run `npx drizzle-kit push` (standard Phase 1–5 pattern).

---

### `src/billing/queries.ts` (service/queries, CRUD)

**Analog:** `src/billing/queries.ts` lines 225–295 (createMembership transaction pattern)

**Task:** Add four new query functions for Phase 8: `getActiveMembershipForClient`, `getEnforcementPolicy`, `insertBookingWithSessionDeduction`, `cancelBookingWithRefund`.

**Imports pattern** (existing lines 1–18):
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

**Query function 1: getActiveMembershipForClient** (read-only pre-flight):
```typescript
/**
 * Returns the client's current active membership for a business,
 * or null if no active non-expired membership exists.
 * Uses getConn() for RLS enforcement.
 */
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
        gt(memberships.expiresAt, new Date()) // Not expired
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
```

**Query function 2: getEnforcementPolicy** (read-only config):
```typescript
/**
 * Returns the enforcement policy for a business ('block' or 'flag').
 * Defaults to 'flag' if not set (safest policy — allow and alert owner).
 * Uses getConn() for RLS enforcement.
 */
export async function getEnforcementPolicy(businessId: number): Promise<'block' | 'flag'> {
  const rows = await getConn()
    .select({ policy: businesses.enforcementPolicy })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  
  const policy = rows[0]?.policy;
  return policy === 'block' ? 'block' : 'flag'; // Default to 'flag'
}
```

**Query function 3: insertBookingWithSessionDeduction** (atomic transaction with SELECT FOR UPDATE):
```typescript
/**
 * Atomically inserts a booking and deducts 1 session from the client's
 * membership inside a single db.transaction() with SELECT FOR UPDATE locking
 * to prevent concurrent deduction races (SESS-01, SESS-03).
 *
 * For unlimited sessions (sessionCount === null), skips deduction entirely.
 * Appends ledger entry (append-only, idempotency-keyed) if deduction occurs.
 *
 * Returns { booking, ledgerEntry } on success or { error: string } on failure.
 */
export async function insertBookingWithSessionDeduction(
  businessId: number,
  clientPhone: string,
  bookingData: {
    serviceId: number;
    calendarDate: string;
    calendarTime: string;
    requestId: string;
    expiresAt: Date;
  },
  membershipId?: number
): Promise<
  | { booking: Booking; ledgerEntry: { id: number; operationType: string } | null }
  | { error: string }
> {
  try {
    const result = await db.transaction(async (tx) => {
      // 1. If membershipId not provided, no deduction occurs — return booking only
      if (!membershipId) {
        const bookingRows = await tx
          .insert(bookings)
          .values({
            businessId,
            clientPhone,
            ...bookingData,
          })
          .returning();
        return { booking: bookingRows[0], ledgerEntry: null };
      }

      // 2. Acquire write lock on membership row (SELECT FOR UPDATE)
      const membershipRows = await tx
        .select()
        .from(memberships)
        .where(eq(memberships.id, membershipId))
        .for('update'); // Drizzle syntax for SELECT FOR UPDATE

      if (membershipRows.length === 0) {
        throw new Error('MEMBERSHIP_NOT_FOUND');
      }

      const membership = membershipRows[0];

      // 3. Validate membership is active and not expired
      if (!membership.isActive || new Date() > membership.expiresAt) {
        throw new Error('MEMBERSHIP_EXPIRED_OR_INACTIVE');
      }

      // 4. Insert booking
      const bookingRows = await tx
        .insert(bookings)
        .values({
          businessId,
          clientPhone,
          ...bookingData,
        })
        .returning();

      if (bookingRows.length === 0) {
        throw new Error('BOOKING_INSERT_FAILED');
      }

      const booking = bookingRows[0];

      // 5. If unlimited sessions (sessionCount === null), skip ledger + decrement
      if (membership.sessionCount === null) {
        return { booking, ledgerEntry: null };
      }

      // 6. Append ledger entry (immutable, idempotency-keyed)
      const idempotencyKey = `booking:${booking.id}:deduct`;
      const ledgerRows = await tx
        .insert(membershipLedger)
        .values({
          membershipId: membership.id,
          operationType: 'session_deducted',
          sessionsDeducted: 1,
          bookingId: booking.id,
          idempotencyKey,
        })
        .onConflictDoNothing() // Webhook replay safety
        .returning();

      const ledgerEntry = ledgerRows[0] ?? null;

      // 7. Decrement sessions_remaining
      await tx
        .update(memberships)
        .set({ sessionsRemaining: membership.sessionCount - 1 })
        .where(eq(memberships.id, membership.id));

      return { booking, ledgerEntry };
    });

    return result;
  } catch (error) {
    logger.error({ err: error, membershipId }, 'insertBookingWithSessionDeduction failed');
    return { error: (error as Error).message };
  }
}
```

**Query function 4: cancelBookingWithRefund** (expiry-aware credit restore):
```typescript
/**
 * Atomically cancels a booking and restores 1 session credit if the membership
 * was still active at cancel-time. If membership expired at cancel-time, no
 * credit is restored (sessions forfeited — SESS-02, SESS-04).
 *
 * Returns { cancelled, creditRestored, reason? }.
 */
export async function cancelBookingWithRefund(
  bookingId: number,
  businessId: number
): Promise<{ cancelled: boolean; creditRestored: boolean; reason?: string }> {
  try {
    // 1. Lookup booking
    const booking = await findBookingById(businessId, bookingId);
    if (!booking) {
      return { cancelled: false, creditRestored: false, reason: 'booking_not_found' };
    }

    // 2. Lookup ledger entry to find which membership was deducted
    const ledgerRows = await getConn()
      .select()
      .from(membershipLedger)
      .where(
        and(
          eq(membershipLedger.bookingId, bookingId),
          eq(membershipLedger.operationType, 'session_deducted')
        )
      )
      .limit(1);

    const membershipId = ledgerRows[0]?.membershipId;

    if (!membershipId) {
      // No ledger entry — no session was deducted (unlimited or pre-Phase-8)
      // Still cancel the booking, but no refund
      const cancelResult = await updateBookingStatus(bookingId, 'cancelled');
      return { cancelled: cancelResult, creditRestored: false, reason: 'no_session_to_restore' };
    }

    // 3. Atomic cancel + conditional refund
    return await db.transaction(async (tx) => {
      // 3a. Cancel booking
      const updatedBooking = await tx
        .update(bookings)
        .set({ bookingStatus: 'cancelled' })
        .where(and(eq(bookings.id, bookingId), eq(bookings.businessId, businessId)))
        .returning();

      if (updatedBooking.length === 0) {
        throw new Error('BOOKING_CANCEL_FAILED');
      }

      // 3b. Fetch membership to check expiry
      const membershipRows = await tx
        .select()
        .from(memberships)
        .where(eq(memberships.id, membershipId))
        .limit(1);

      if (membershipRows.length === 0) {
        return { cancelled: true, creditRestored: false, reason: 'membership_not_found' };
      }

      const membership = membershipRows[0];

      // 3c. Check if membership is still valid at cancel time
      const now = new Date();
      if (now > membership.expiresAt) {
        // Membership expired — no credit restored (sessions forfeited)
        return { cancelled: true, creditRestored: false, reason: 'membership_expired' };
      }

      // 3d. If unlimited (sessionCount === null), no refund
      if (membership.sessionCount === null) {
        return { cancelled: true, creditRestored: false, reason: 'unlimited_membership' };
      }

      // 3e. Append credit-restore entry to ledger
      const idempotencyKey = `booking:${bookingId}:restore`;
      await tx
        .insert(membershipLedger)
        .values({
          membershipId: membership.id,
          operationType: 'credit_restored',
          sessionsDeducted: -1, // Negative = credit
          bookingId: bookingId,
          idempotencyKey,
        })
        .onConflictDoNothing(); // Webhook replay safety

      // 3f. Increment sessions_remaining
      await tx
        .update(memberships)
        .set({ sessionsRemaining: membership.sessionCount + 1 })
        .where(eq(memberships.id, membership.id));

      return { cancelled: true, creditRestored: true };
    });
  } catch (error) {
    logger.error({ err: error, bookingId }, 'cancelBookingWithRefund failed');
    return { cancelled: false, creditRestored: false, reason: (error as Error).message };
  }
}
```

---

### `src/billing/enforcement.ts` (service, CRUD)

**Analog:** `src/billing/queries.ts` (transaction and membership validation patterns)

**New file:** Centralized enforcement policy check and message building.

**Imports pattern** (follow Phase 7 billing queries):
```typescript
import { logger } from '../utils/logger';
import { getActiveMembershipForClient, getEnforcementPolicy, Membership } from './queries';
import { sendTelegramMessage } from '../telegram/client';
```

**Core pattern: Enforcement check before booking** (follows RESEARCH.md Pattern 2):
```typescript
/**
 * Pre-flight membership validation before booking. Returns one of:
 * - { allowed: true, membership: Membership }
 * - { allowed: false, message: string, shouldAlert: false } (policy="block")
 * - { allowed: true, membership: null, shouldAlert: true } (policy="flag", no membership)
 *
 * ENFC-01, ENFC-02, ENFC-03 enforcement logic in one place.
 */
export async function checkEnforcementAndGetMembership(
  businessId: number,
  clientPhone: string
): Promise<
  | { allowed: true; membership: Membership | null; shouldAlert: false }
  | { allowed: false; message: string; shouldAlert: false }
  | { allowed: true; membership: null; shouldAlert: true }
> {
  const membership = await getActiveMembershipForClient(businessId, clientPhone);
  const policy = await getEnforcementPolicy(businessId);

  if (!membership) {
    if (policy === 'block') {
      // ENFC-02: refuse booking with Greek message
      const refusalMsg = 'Δυστυχώς, δεν διαθέτετε ενεργή ιδιωτική συμφωνία για αυτό το στούντιο. Παρακαλώ επικοινωνήστε με τον ιδιοκτήτη.';
      return { allowed: false, message: refusalMsg, shouldAlert: false };
    }
    // policy === 'flag': allow booking, but flag for owner alert later
    return { allowed: true, membership: null, shouldAlert: true };
  }

  // Member exists — proceed regardless of policy
  return { allowed: true, membership, shouldAlert: false };
}

/**
 * Builds Greek alert message for unpaid client booking (ENFC-03).
 * Used when policy="flag" and no membership exists.
 */
export function buildUnpaidClientAlert(
  clientName: string | null,
  clientPhone: string,
  calendarDate: string,
  calendarTime: string
): string {
  const name = clientName || clientPhone;
  return `⚠️ Νέα κράτηση χωρίς ενεργή συνδρομή\nΠελάτης: ${name}\nΗμερομηνία: ${calendarDate}\nΏρα: ${calendarTime}`;
}
```

---

### `src/conversation/function-executor.ts` (controller, request-response)

**Analog:** `src/conversation/function-executor.ts` lines 156–189 (bookAppointmentTool)

**Task:** Wrap booking tool with atomic deduction and enforcement check.

**Integration pattern** (modify bookAppointmentTool at lines 156–189):

```typescript
import {
  getActiveMembershipForClient,
  getEnforcementPolicy,
  insertBookingWithSessionDeduction,
} from '../billing/queries';
import { checkEnforcementAndGetMembership, buildUnpaidClientAlert } from '../billing/enforcement';

async function bookAppointmentTool(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  const parsed = BookAppointmentArgsSchema.parse(args);

  const service = await findServiceById(context.business.id, parsed.service_id);
  if (!service) return { success: false, error: 'service_not_found' };

  // === PHASE 8: ENFORCEMENT CHECK (new) ===
  const enforcementResult = await checkEnforcementAndGetMembership(
    context.business.id,
    context.clientPhone
  );

  if (!enforcementResult.allowed) {
    // policy="block" — refuse booking
    await sendTelegramMessage(context.clientPhone, enforcementResult.message);
    return { error: enforcementResult.message };
  }

  // === BOOKING INSERT WITH OPTIONAL SESSION DEDUCTION (modified) ===
  const expiresAt = new Date(Date.now() + PENDING_BOOKING_TTL_MS);
  
  // If membership exists, use insertBookingWithSessionDeduction; otherwise insertBooking
  const booking = enforcementResult.membership
    ? (
        await insertBookingWithSessionDeduction(
          context.business.id,
          context.clientPhone,
          {
            serviceId: parsed.service_id,
            calendarDate: parsed.calendar_date,
            calendarTime: parsed.calendar_time,
            requestId: context.idempotencyKey,
            expiresAt,
          },
          enforcementResult.membership.id
        )
      ).booking ?? null
    : await insertBooking({
        businessId: context.business.id,
        clientPhone: context.clientPhone,
        serviceId: parsed.service_id,
        calendarDate: parsed.calendar_date,
        calendarTime: parsed.calendar_time,
        requestId: context.idempotencyKey,
        expiresAt,
      });

  if (!booking) {
    return await resolveConflictOrTaken(context.clientPhone, context.idempotencyKey);
  }

  // === ALERT OWNER IF "FLAG" POLICY AND NO MEMBERSHIP (new) ===
  try {
    await alertOwnerNewBooking(booking, service, context.business);
    
    if (enforcementResult.shouldAlert) {
      const clientName = await getClientName(context.business.id, context.clientPhone);
      const alertMsg = buildUnpaidClientAlert(
        clientName,
        context.clientPhone,
        parsed.calendar_date,
        parsed.calendar_time
      );
      await sendTelegramMessage(context.business.ownerTelegramId, alertMsg).catch((e) =>
        logger.warn({ err: e }, 'unpaid_client_alert_send_failed_non_critical')
      );
    }
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'Booking created but alert failed');
  }

  return { success: true, booking_id: booking.id, status: booking.bookingStatus };
}
```

**Cancellation modification** (lines 191–237):

```typescript
async function cancelAppointmentTool(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  const parsed = CancelAppointmentArgsSchema.parse(args);

  const booking = await findBookingById(context.business.id, parsed.booking_id);
  if (!booking) return { success: false, error: 'booking_not_found' };
  if (booking.clientPhone !== context.clientPhone) return { success: false, error: 'not_your_booking' };
  if (!ACTIVE_STATUSES.includes(booking.bookingStatus)) {
    return { success: false, error: 'not_cancellable' };
  }

  // === PHASE 8: ATOMIC CANCEL WITH OPTIONAL REFUND (new) ===
  const refundResult = await cancelBookingWithRefund(booking.id, context.business.id);

  if (!refundResult.cancelled) {
    return { success: false, error: refundResult.reason || 'cancel_failed' };
  }

  // Rest of logic (Calendar delete, owner alert) proceeds unchanged
  try {
    const fullBusiness = await findBusinessById(context.business.id);
    if (fullBusiness) await deleteBookingFromCalendar(booking, fullBusiness);
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'Calendar deletion failed (best-effort)');
  }

  const service = await findServiceById(context.business.id, booking.serviceId);
  try {
    if (context.business.ownerTelegramId) {
      const ownerText = `Ακύρωση ραντεβού από πελάτη:\nΥπηρεσία: ${service?.name ?? 'άγνωστη'}\nΗμερομηνία: ${booking.calendarDate}\nΏρα: ${booking.calendarTime}\nΠελάτης: ${booking.clientPhone}`;
      await sendTelegramMessage(context.business.ownerTelegramId, ownerText);
    }
    const cancelMsg = refundResult.creditRestored
      ? 'Το ραντεβού σας ακυρώθηκε και η συνεδρία επιστράφηκε.'
      : 'Το ραντεβού σας ακυρώθηκε.';
    await sendTelegramMessage(booking.clientPhone, cancelMsg);
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'Cancellation succeeded but notification failed');
  }

  return { success: true, booking_id: booking.id };
}
```

---

### `src/onboarding/ai-owner-agent.ts` (controller/NLU, request-response)

**Analog:** `src/onboarding/ai-owner-agent.ts` lines 37–199 (OWNER_TOOLS array) and 278–399 (executeOwnerTool dispatcher)

**Task:** Add `set_enforcement_policy` tool to OWNER_TOOLS (ENFC-01).

**Tool definition** (add to OWNER_TOOLS array after view_client_membership, around line 199):

```typescript
  {
    type: 'function' as const,
    name: 'set_enforcement_policy',
    description:
      'Ορίζει την πολιτική επιβολής για αποδεκτές κρατήσεις: "block" (απόρριψη χωρίς συνδρομή) ή "flag" (αποδοχή και ειδοποίηση ιδιοκτήτη).',
    parameters: {
      type: 'object',
      properties: {
        policy: {
          type: 'string',
          enum: ['block', 'flag'],
          description: 'Πολιτική: "block" για απόρριψη ή "flag" για ειδοποίηση',
        },
      },
      required: ['policy'],
    },
  },
```

**Tool handler** (add to executeOwnerTool switch statement, around line 399):

```typescript
    case 'set_enforcement_policy': {
      const policy = args.policy as string;
      if (!['block', 'flag'].includes(policy)) {
        return 'Άκυρη πολιτική. Χρησιμοποίησε "block" ή "flag".';
      }

      // Update businesses table with enforcement_policy
      await db
        .update(businesses)
        .set({ enforcementPolicy: policy })
        .where(eq(businesses.id, business.id));

      const policyLabel = policy === 'block'
        ? 'Άρνηση κρατήσεων χωρίς συνδρομή'
        : 'Αποδοχή κρατήσεων και ειδοποίηση';

      logger.info({ businessId: business.id, policy }, 'Enforcement policy updated');
      return `OK: Πολιτική ορίστηκε σε "${policyLabel}".`;
    }
```

**Imports** (add to existing imports at top):
```typescript
import { businesses } from '../database/schema'; // Already imported, just verify
```

---

## Shared Patterns

### Atomic Transaction with SELECT FOR UPDATE (Concurrency Safety)

**Source:** `src/billing/queries.ts` lines 225–295 (createMembership pattern), adapted for session deduction

**Apply to:** `src/billing/enforcement.ts` insertBookingWithSessionDeduction, cancelBookingWithRefund

**Pattern:**
```typescript
return await db.transaction(async (tx) => {
  // 1. Acquire exclusive lock
  const rows = await tx
    .select()
    .from(table)
    .where(eq(table.id, id))
    .for('update');

  if (rows.length === 0) throw new Error('NOT_FOUND');

  const row = rows[0];

  // 2. Validate state
  if (!row.isValid) throw new Error('INVALID_STATE');

  // 3. Perform mutations inside transaction
  await tx.insert(...);
  await tx.update(...);

  return result;
});
```

**Key details:**
- `.for('update')` is Drizzle's syntax for `SELECT FOR UPDATE`
- Holds lock until transaction commits — no other transaction can acquire the same lock
- Prevents read-skew: concurrent reads cannot both see the same old state
- Rollback on any error inside the transaction — all mutations are atomic

---

### Idempotent Ledger Entries (Webhook Replay Safety)

**Source:** `src/billing/queries.ts` lines 277–286 (membershipLedger.idempotencyKey pattern)

**Apply to:** `src/billing/enforcement.ts` session_deducted and credit_restored ledger entries

**Pattern:**
```typescript
const idempotencyKey = `booking:${booking.id}:deduct`;
const ledgerRows = await tx
  .insert(membershipLedger)
  .values({
    membershipId: membership.id,
    operationType: 'session_deducted',
    sessionsDeducted: 1,
    bookingId: booking.id,
    idempotencyKey,
  })
  .onConflictDoNothing() // Schema has UNIQUE constraint on idempotencyKey
  .returning();

const ledgerEntry = ledgerRows[0] ?? null; // May be null on replay
```

**Key details:**
- Schema: `idempotencyKey: text('idempotency_key').notNull().unique()` (Phase 7, line 314)
- `.onConflictDoNothing()` silently ignores the duplicate on webhook replay
- `.returning()` returns empty array if conflict, so app detects and skips redundant work
- Deterministic key format ensures same operation always produces same key

---

### Read-Only RLS-Enforced Queries

**Source:** `src/billing/queries.ts` lines 108–114 (listPackages), 133–140 (getPackageById), 301–336 (getClientActiveMembership)

**Apply to:** All `getActiveMembershipForClient`, `getEnforcementPolicy` queries

**Pattern:**
```typescript
export async function readSensitiveData(businessId: number): Promise<Data | null> {
  return getConn() // NOT db — uses RLS-enforced transaction if available
    .select()
    .from(table)
    .where(eq(table.businessId, businessId))
    .limit(1);
}
```

**Key details:**
- `getConn()` returns `currentTx.getStore() ?? db` from `src/database/queries.ts` line 22
- Inside `withBusinessContext`, `getConn()` returns the RLS-enforced transaction
- Outside `withBusinessContext` (routing, polling), `getConn()` returns admin `db`
- RLS policy in PostgreSQL enforces `app.current_business_id` at database layer

---

### Greek Error/Alert Messages (Localization)

**Source:** `src/conversation/function-executor.ts` lines 122, 228–231 (Greek messages)

**Apply to:** `src/billing/enforcement.ts` refusal message and unpaid alert

**Pattern:**
```typescript
// Refusal (ENFC-02)
const refusalMsg = 'Δυστυχώς, δεν διαθέτετε ενεργή ιδιωτική συμφωνία για αυτό το στούντιο. Παρακαλώ επικοινωνήστε με τον ιδιοκτήτη.';

// Alert (ENFC-03)
const alertMsg = `⚠️ Νέα κράτηση χωρίς ενεργή συνδρομή\nΠελάτης: ${clientName}\nΗμερομηνία: ${calendarDate}\nΏρα: ${calendarTime}`;

// Cancellation confirmation (modified)
const cancelMsg = refundResult.creditRestored
  ? 'Το ραντεβού σας ακυρώθηκε και η συνεδρία επιστράφηκε.'
  : 'Το ραντεβού σας ακυρώθηκε.';
```

**Key details:**
- All Greek strings are hardcoded in the function (no external string map yet — Phase 9 may extract to i18n)
- Client-facing messages use formal Greek; owner messages use informal emoji + Greek
- Message sent via `sendTelegramMessage(phoneId, text)` (established pattern from Phase 2+)

---

### Best-Effort Non-Blocking Notifications

**Source:** `src/conversation/function-executor.ts` lines 177–184 and 226–234 (alertOwnerNewBooking, cancellation alert)

**Apply to:** All owner alerts in Phase 8 (unpaid client alert, policy updates)

**Pattern:**
```typescript
try {
  await sendTelegramMessage(context.business.ownerTelegramId, alertMsg);
} catch (err) {
  logger.warn({ err }, 'alert_send_failed_non_critical');
  // NO rethrow — DB mutation has already committed, alert failure must not surface to client
}
```

**Key details:**
- DB mutation (booking insert/update, policy update) commits FIRST
- Alert send attempt AFTER commit, wrapped in try/catch
- If alert fails, log it but do NOT return error to client
- Client receives success response; owner eventually sees alert or not

---

## No Analog Found

No files require new patterns not found in codebase:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| — | — | — | All Phase 8 files follow established patterns from Phase 2–7 |

---

## Metadata

**Analog search scope:** 
- `src/database/schema.ts` (schema extensions)
- `src/billing/queries.ts` (transaction + ledger patterns)
- `src/conversation/function-executor.ts` (tool executor, error handling)
- `src/onboarding/ai-owner-agent.ts` (NLU tool definitions, tool executor)
- `src/calendar/sync.ts` (transaction patterns)
- `src/database/queries.ts` (RLS + withBusinessContext pattern)

**Files scanned:** 6 core analogs + 5 reference patterns

**Pattern extraction date:** 2026-07-21

**Key patterns identified:**
1. Atomic session deduction via `db.transaction()` + `SELECT FOR UPDATE` prevents concurrent races
2. Append-only ledger with UNIQUE idempotencyKey handles webhook replays safely
3. RLS-enforced queries via `getConn()` inside `withBusinessContext` ensure tenant isolation
4. Enforcement policy stored in database, queried fresh on every booking (no caching)
5. Best-effort async notifications after DB commit prevent inconsistent state on send failure

---

*Phase: 8 — Enforcement & Session Deduction*
*Pattern mapping completed: 2026-07-21*
