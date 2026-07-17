# Architecture Research

**Domain:** Billing & Membership for chat-native appointment booking
**Researched:** 2026-07-17
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   Telegram Webhook Layer                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ Platform bot │  │ Business bot │  │ Owner chat handler │  │
│  └──────┬───────┘  └──────┬───────┘  └─────────┬──────────┘  │
├─────────┴─────────────────┴───────────────────┴─────────────┤
│                   Gemini Function-Calling Layer               │
│  ┌──────────────────┐  ┌──────────────────────────────────┐  │
│  │ aiBookingAgent   │  │ ownerAgent (NLU + tool dispatch) │  │
│  └──────┬───────────┘  └──────────────┬───────────────────┘  │
├─────────┴──────────────────────────────┴─────────────────────┤
│                   Billing Service Layer (NEW)                  │
│  ┌────────────┐  ┌─────────────────┐  ┌────────────────────┐  │
│  │ Packages   │  │ Memberships     │  │ Session Ledger     │  │
│  │ (config)   │  │ (lifecycle)     │  │ (audit trail)      │  │
│  └────────────┘  └─────────────────┘  └────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                   Postgres / Neon (RLS enforced)              │
│  ┌──────────┐  ┌────────────────┐  ┌──────────────────────┐  │
│  │ bookings │  │client_members  │  │ membership_ledger    │  │
│  │          │  │ hips           │  │                      │  │
│  └──────────┘  └────────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| `billing_packages` table | Owner-defined package configs per business | Drizzle pgTable, business_id FK, RLS |
| `client_memberships` table | Purchase records: expiry, sessions remaining, status | Drizzle pgTable, links package + client |
| `membership_ledger` table | Immutable append-only debit/credit event log | UNIQUE on (business_id, idempotency_key) |
| `membership_expiry_notifications` table | Dedup guard for expiry alerts | UNIQUE on (membership_id, notification_type, date) |
| Booking confirmation handler | Atomic: insert booking + deduct session in one tx | `db.transaction()` with `SELECT FOR UPDATE` |
| Cancellation handler | Atomic: cancel booking + reverse ledger entry in one tx | Reversing CREDIT entry, restore sessions_remaining |
| Expiry poller | Sweep memberships expiring in ≤3 days, notify once | Extend existing reminder setInterval |

## Recommended Project Structure

```
src/
├── billing/
│   ├── schema.ts           # billing_packages, client_memberships, membership_ledger, expiry_notifications tables
│   ├── queries.ts          # typed query layer: createPackage, createMembership, deductSession, restoreSession, getClientBalance
│   ├── poller.ts           # membership expiry sweep (extends reminder poller pattern)
│   └── index.ts            # exports
├── onboarding/             # existing — add package config step
├── booking/                # existing — wrap confirmation + cancel in billing transactions
└── owner/                  # existing — add payment recording Gemini tool
```

### Structure Rationale

- **`billing/` as new top-level module:** Billing is a distinct domain; keeps schema/queries/poller isolated from booking logic
- **`queries.ts` typed layer:** Matches existing pattern (bookings/queries.ts, onboarding/queries.ts) — consistent access pattern
- **No new `src/billing/handlers/`:** Owner payment recording routes through existing ownerAgent Gemini function-calling, not a new handler

## Architectural Patterns

### Pattern 1: Atomic Transaction Coupling

**What:** Session deduction is in the same `db.transaction()` as booking confirmation — never before or after.
**When to use:** Any operation that mutates both `bookings` and `membership_ledger`.
**Trade-offs:** Slightly longer transaction window; prevents orphaned bookings or phantom debits.

**Example:**
```typescript
await db.transaction(async (tx) => {
  // 1. Confirm booking
  await tx.update(bookings).set({ status: 'confirmed' }).where(eq(bookings.id, bookingId));
  // 2. Deduct session (idempotent ON CONFLICT)
  await tx.insert(membership_ledger).values({
    operation_type: 'DEBIT', sessions_delta: -1, idempotency_key: `${bookingId}-confirm`,
    ...
  }).onConflictDoNothing();
  // 3. Decrement denormalized balance
  await tx.update(client_memberships)
    .set({ sessions_remaining: sql`sessions_remaining - 1` })
    .where(eq(client_memberships.id, membershipId));
});
```

### Pattern 2: Immutable Ledger (Append-Only)

**What:** Never UPDATE ledger rows. Cancellations add a reversing CREDIT entry; reschedules add CREDIT for old booking + DEBIT for new. `sessions_remaining` on the membership is a denormalized cache of the ledger sum.
**When to use:** All session balance mutations.
**Trade-offs:** Slightly more rows; enables full audit trail and safe retry without reconciliation.

### Pattern 3: Idempotency via ON CONFLICT

**What:** Every ledger INSERT has a deterministic `idempotency_key` = `${bookingId}-${operation}-${timestamp_floor}`. UNIQUE constraint on `(business_id, idempotency_key)` makes retries safe.
**When to use:** All ledger inserts; expiry notification inserts.
**Trade-offs:** Slightly larger index; eliminates duplicate-send/double-debit bugs on Telegram retry.

## Data Flow

### Booking Confirmation with Session Deduction

```
Client: "Κλείσε ξανά Παρασκευή 10πμ"
    ↓
aiBookingAgent (Gemini) → executeTool('create_booking', ...)
    ↓
bookingConfirmHandler()
    ↓ db.transaction()
    ├── checkMembershipValid(clientId, businessId)   ← throws if no active membership + enforcement=block
    ├── INSERT bookings (status=pending_owner_approval)
    ├── INSERT membership_ledger (DEBIT, idempotency_key)  ← ON CONFLICT doNothing
    └── UPDATE client_memberships SET sessions_remaining = sessions_remaining - 1
    ↓
Owner approval callback_query
    ↓ (no additional billing action needed — already deducted)
```

### Cancellation with Credit Restoration

```
Client: "Ακύρωσε την κράτησή μου"
    ↓
cancelBookingHandler()
    ↓ db.transaction()
    ├── UPDATE bookings SET status='cancelled'
    ├── SELECT membership_ledger WHERE booking_id=X AND operation_type='DEBIT'  ← check if session was deducted
    ├── IF debit exists AND membership NOT expired:
    │   ├── INSERT membership_ledger (CREDIT, idempotency_key=`${bookingId}-cancel`)
    │   └── UPDATE client_memberships SET sessions_remaining = sessions_remaining + 1
    └── IF membership expired at time of cancel: no credit (forfeited)
```

### Owner Records Payment

```
Owner: "ο Γιώργης πλήρωσε — Μηνιαίο Pass"
    ↓
ownerAgent (Gemini) → resolve client + package (buttons for disambiguation)
    ↓ explicit confirmation step ("Να δημιουργήσω πακέτο για Γιώργη; ναι/όχι")
    ↓
createMembership(clientId, packageId, businessId)
    ├── INSERT client_memberships (purchased_at=now, expires_at=now+valid_days, status='ACTIVE')
    └── INSERT membership_ledger (CREDIT, sessions_delta=+package.sessions_included, reason='purchase')
```

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-250 clients/day | Current setInterval pollers + Neon free tier — no changes needed |
| 250-2k clients/day | Upgrade Neon to paid; consider pg-boss for reliable poller scheduling |
| 2k+ clients/day | Separate billing service; event-driven (booking confirmed → billing event) |

### Scaling Priorities

1. **First bottleneck:** Neon free 100 CU-hour/month — upgrade tier before concurrent transaction load increases
2. **Second bottleneck:** setInterval pollers on fly.io single machine — add pg-boss job queue for poller reliability

## Anti-Patterns

### Anti-Pattern 1: Deduct Outside Transaction

**What people do:** Check membership → confirm booking → deduct session as separate operations.
**Why it's wrong:** Race condition between two concurrent bookings both seeing positive balance.
**Do this instead:** Wrap booking insert + ledger debit in single `db.transaction()`.

### Anti-Pattern 2: Mutable Ledger Updates

**What people do:** UPDATE membership_ledger SET cancelled=true on cancellation.
**Why it's wrong:** Destroys audit trail; makes idempotent retry unsafe.
**Do this instead:** Always INSERT a reversing CREDIT entry; never modify existing ledger rows.

### Anti-Pattern 3: Free-form Gemini Payment Parsing

**What people do:** Let Gemini infer "Γιάννης paid 5 passes" into a membership record.
**Why it's wrong:** Ambiguous (which package? which client?); silent data integrity errors.
**Do this instead:** Structured owner flow — package selection via buttons + Greek confirmation before INSERT.

### Anti-Pattern 4: Storing Expiry as DATE

**What people do:** `expiry_date DATE` instead of `TIMESTAMP WITH TIME ZONE`.
**Why it's wrong:** DATE loses time-of-day; DST transitions make boundary queries ambiguous.
**Do this instead:** `expires_at TIMESTAMP WITH TIME ZONE`; app timezone set to `Europe/Athens`.

## Integration Points

### Existing Code Touched

| Module | Change | Notes |
|--------|--------|-------|
| `src/booking/` confirmation handler | Wrap in `db.transaction()` + call deductSession | Only if business has enforcement=block |
| `src/booking/` cancel handler | Add restoreSession inside cancel transaction | Only if debit ledger entry exists |
| `src/owner/` agent tools | Add `record_payment`, `view_client_balance`, `configure_package` Gemini tools | New tools alongside existing owner tools |
| `src/database/schema.ts` | Add 4 new tables | Additive migration; no existing columns changed |
| Reminder poller (`src/pollers/reminders.ts`) | Add `sweepMembershipExpirations()` call | Extend existing sweep pattern |

### New Tables

| Table | FK Dependencies | RLS Required |
|-------|-----------------|--------------|
| `billing_packages` | `businesses.id` | Yes — business_id filter |
| `client_memberships` | `businesses.id`, `clients.id`, `billing_packages.id` | Yes — business_id filter |
| `membership_ledger` | `businesses.id`, `client_memberships.id`, `bookings.id` (nullable) | Yes — business_id filter |
| `membership_expiry_notifications` | `businesses.id`, `client_memberships.id` | Yes — business_id filter |

## Build Order

1. **Phase 7:** Schema migration (4 new tables) → owner Gemini tools (configure_package, record_payment) → package config + payment recording via chat
2. **Phase 8:** Booking confirmation refactor (add deductSession to transaction) → cancel handler refactor (add restoreSession) → enforcement policy config → client balance query
3. **Phase 9:** Expiry notification poller extension → expiry sweep tests → client self-service balance check

## Sources

- [Drizzle ORM Transactions Documentation](https://orm.drizzle.team/docs/transactions)
- [Mastering PostgreSQL Row-Level Security for Multi-Tenancy](https://ricofritzsche.me/mastering-postgresql-row-level-security-rls-for-rock-solid-multi-tenancy/)
- [Designing a Scalable Wallet Ledger System for Fintech](https://www.bamboodt.com/designing-a-scalable-wallet-ledger-system-for-secure-fintech/)
- [Payment Systems: Ledgers, Idempotency, and Reconciliation](https://prachub.com/concepts/payment-systems-ledgers-idempotency-and-reconciliation/)

---
*Architecture research for: RandevuClaw v1.2 Billing & Membership*
*Researched: 2026-07-17*
