# Technology Stack: Billing & Membership Features

**Project:** RandevuClaw (v1.2 Billing & Membership System)  
**Researched:** 2026-07-17  
**Overall confidence:** HIGH

## Executive Summary

Billing/membership features require **three targeted additions** to the existing stack: a lightweight date-utility library for expiry windows (date-fns 4.4.0), refined Drizzle transaction patterns for session ledgers (no new package needed), and optional scheduling upgrade beyond setInterval only if expiry notifications scale. Integer-cents currency handling replaces any money library, avoiding floating-point errors while keeping the $0 budget intact.

The existing tech stack (Node.js/TypeScript, Neon/Drizzle, @google/genai, fly.io) already covers 90% of billing requirements. No paid services or infrastructure changes needed.

## Recommended Stack Additions

### Date/Time: Rolling Windows & Expiry Calculations

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **date-fns** | 4.4.0 | Rolling 30/90-day windows, expiry calculations, DST-safe comparisons | Lightweight (13 KB), tree-shakeable, functional API, no immutability overhead. Handles `addDays()`, `isBefore()`, `differenceInDays()` for membership validity. TypeScript support excellent. Already using date-fns in v1.0 for reminders; reuse for billing. |

**Why not:**
- **Luxon** (23 KB): Heavier; only needed for multi-timezone support. RandevuClaw handles single-timezone (Athens/Europe/Athens via PostgreSQL AT TIME ZONE). Overkill for PoC.
- **Day.js** (2 KB): Too minimal; lacks `differenceInDays()` without plugins. date-fns functional approach cleaner for rolling-window logic.
- **Native Temporal**: Experimental in Node 22+, not production-ready for 2026. Date-fns is stable.
- **Manual date math**: Error-prone for DST, leap years, February edge cases; date-fns handles all.

### Database: Ledger-Style Session Tracking

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Drizzle ORM** (existing) | 0.30+ | Transaction-based session deduction, soft deletes for audit trail | Already in stack; extend via transaction + repository pattern. No new package. Atomic ACID guarantees prevent double-deduction on concurrent bookings. |

**Ledger Pattern (Drizzle + PostgreSQL):**

A session ledger is not a separate table but a **transactional approach**:

```typescript
// Pseudo-code: Confirm booking + deduct session atomically
const confirmBooking = await db.transaction(async (tx) => {
  // Step 1: Check membership validity (before deduction)
  const membership = await tx
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.client_id, clientId),
        gte(memberships.expires_at, now) // Still valid
      )
    )
    .for('update'); // Lock row to prevent concurrent deduction

  if (!membership || membership.sessions_remaining <= 0) {
    throw new Error('No valid membership');
  }

  // Step 2: Create booking
  const booking = await tx
    .insert(bookings)
    .values({ client_id: clientId, business_id, time, ... })
    .returning();

  // Step 3: Deduct session (atomic with booking)
  await tx
    .update(memberships)
    .set({
      sessions_remaining: membership.sessions_remaining - 1,
      updated_at: now,
    })
    .where(eq(memberships.id, membership.id));

  return { booking, remaining: membership.sessions_remaining - 1 };
});
```

**Audit Trail (soft deletes + history):**

If you need to track "which session was used for which booking", add a nullable `booking_id` column to `memberships`:

```sql
-- Migration: Add deduction history tracking
ALTER TABLE memberships ADD COLUMN booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL;
ALTER TABLE memberships ADD COLUMN deducted_at TIMESTAMPTZ DEFAULT NULL;
```

On cancellation, restore the session by setting `deducted_at = NULL`, `booking_id = NULL`, and incrementing `sessions_remaining`.

**Why not a separate ledger table:**
- Overcomplicates schema; a single membership row (with session count) + booking link is sufficient for a single-business PoC.
- No need to aggregate ledger entries per query; direct balance reads from memberships table.
- Upgrade path: If scaling to 100+ businesses, migrate to immutable ledger entries + balance snapshots, but not required now.

### Scheduling: Expiry Notifications

| Technology | Version | Purpose | When to Use |
|------------|---------|---------|-------------|
| **setInterval** (existing) | Node.js built-in | Daily sweep for expiry notifications (keep MVP approach) | For PoC (1 business, <50 clients): sufficient. Already used in v1.0 for daily agenda + 1h reminders. Keeps zero-dependency cost. |
| **node-schedule** | 2.1.1 (optional upgrade) | Cron-like wall-clock scheduling for expiry sweeps (6am Athens time daily) | Only if: expiry notifications need specific wall-clock time (e.g., "notify at 6am Athens every day, not 24h intervals"). Adds complexity; defer unless testing shows setInterval drifts. |

**Existing Approach (setInterval in v1.0):**

```typescript
// v1.0 pattern (keep this for v1.2)
setInterval(async () => {
  const businessesToNotify = await db
    .select()
    .from(memberships)
    .where(
      and(
        lte(memberships.expires_at, addDays(now, 7)), // Expires in ≤7 days
        gte(memberships.expires_at, now), // Not already expired
        eq(memberships.notified_at, null) // Not already notified
      )
    );

  for (const membership of businessesToNotify) {
    await sendExpiryNotification(membership);
    await db.update(memberships).set({ notified_at: now }).where(...);
  }
}, 24 * 60 * 60 * 1000); // Every 24 hours
```

**Why not Agenda:**
- Agenda requires MongoDB; Neon is PostgreSQL. Adding Mongo breaks single-DB principle and adds cost.
- Agenda's persistence is overkill: expiry notifications are idempotent (sending twice is okay); v1.0 already tracks `notified_at` to prevent duplicates.

**Why not node-cron or other libraries:**
- node-cron: Lightweight but less precise for wall-clock time (requires cron string parsing).
- For PoC, wall-clock scheduling rarely needed; setInterval with `notified_at` tracking is robust and dependency-free.

**Upgrade path:**
- If v1.2 shows need for "exactly 6am Athens daily" (not "every 24h"), upgrade to node-schedule (2.1.1) and use:
  ```typescript
  schedule.scheduleJob('0 6 * * *', async () => { /* sweep */ });
  ```
- Cost: 1 npm package, 2-3 lines of code change. Safe to defer.

### Currency Handling: Avoid Money Libraries

| Technology | Approach | Purpose | Why |
|------------|----------|---------|-----|
| **Integer Cents** | Store all amounts as PostgreSQL `INTEGER` (units = €0.01) | Track prices, session costs, balances, payment records | Avoids floating-point errors (e.g., 0.1 + 0.2 ≠ 0.3 in IEEE 754). Standard in financial systems. No npm package overhead. |

**Schema pattern:**

```sql
CREATE TABLE memberships (
  id UUID PRIMARY KEY,
  client_id UUID NOT NULL,
  business_id UUID NOT NULL,
  price_cents INTEGER NOT NULL, -- e.g., 4999 = €49.99
  sessions_remaining INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE payment_records (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL,
  client_id UUID NOT NULL,
  amount_cents INTEGER NOT NULL, -- What owner recorded
  membership_id UUID REFERENCES memberships(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**In TypeScript:**

```typescript
// Display: format cents as EUR string
const displayPrice = (cents: number): string => {
  return `€${(cents / 100).toFixed(2)}`;
};

// Parse: convert EUR string to cents
const parsePriceEUR = (str: string): number => {
  return Math.round(parseFloat(str.replace('€', '')) * 100);
};

// Calculate: work in cents only
const totalAfterDiscount = (cents: number, percentOff: number): number => {
  return Math.round(cents * (1 - percentOff / 100));
};
```

**Why not Decimal.js / Big.js / Dinero.js:**
- Decimal.js/Big.js: Overkill for fixed-precision EUR (always 2 decimals). Adds 10+ KB to bundle.
- Dinero.js: Immutable domain model; nice API but adds 5+ KB and complex state management for a simple PoC.
- Integer cents: Zero overhead, standard practice, supported natively by PostgreSQL `INTEGER` type.

**When to upgrade (Phase 2+):**
- If business requires fractional cents (rare, only for enterprise B2B). Use Big.js.
- If multi-currency support needed. Use Dinero.js for currency conversions.

## Supporting Libraries (Already in Stack)

| Library | Version | Purpose | Billing-Related Use |
|---------|---------|---------|---------------------|
| **zod** | 3.22+ | Runtime validation | Validate price input from owner ("Add €49.99 plan"), membership data, payment records. |
| **Neon** | (serverless DB) | PostgreSQL hosting | Ledger queries benefit from PostgreSQL's isolation levels (SERIALIZABLE for concurrent deductions). |
| **@google/genai** | 2.10.0+ | Gemini function-calling | AI functions: `record_payment`, `check_balance`, `create_membership` callable by bot. |
| **fly.io** | (PaaS) | App hosting | Hosts the notification sweep (setInterval), no changes needed. |

## Alternatives Considered & Rejected

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| **Date Math** | date-fns 4.4.0 | Luxon 2.4+ | Luxon heavier (23 KB vs 13 KB); single-timezone app doesn't need Luxon's multi-zone strength. |
| **Date Math** | date-fns 4.4.0 | Native Temporal (Stage 3) | Experimental; production-ready only in Node 24+. date-fns stable, proven. |
| **Ledger Pattern** | Drizzle transactions + repository | Separate ledger table | Overcomplicates for PoC; single membership row (with session balance) sufficient until scaling. |
| **Scheduling** | setInterval (existing) | Agenda (MongoDB-backed) | Agenda requires MongoDB. RandevuClaw is Postgres-only. Adds cost + complexity. |
| **Scheduling** | setInterval (existing) | node-cron or later.js | Good alternatives, but setInterval already in v1.0; no upgrade pressure unless wall-clock time critical. |
| **Currency** | Integer cents (no library) | Decimal.js or Big.js | Fixed-precision EUR (always 2 decimals) doesn't need arbitrary-precision. Integer cents is standard, zero overhead. |
| **Currency** | Integer cents (no library) | Dinero.js | Nice API but adds 5+ KB and immutable complexity. Overkill for PoC token/punch-card system. |

## Installation & Integration

### Add date-fns to existing project

```bash
npm install date-fns@4.4.0
```

**TypeScript import (tree-shakeable):**

```typescript
// Only import what you use; unused functions are tree-shaken out
import { addDays, isBefore, differenceInDays } from 'date-fns';

const expiryDate = addDays(new Date(), 30); // 30-day pass
const isExpired = isBefore(now, expiryDate);
const daysUntilExpiry = differenceInDays(expiryDate, now);
```

### Drizzle Transaction Pattern (No new packages)

Already using Drizzle 0.30+ from v1.0. Extend with transaction pattern above in `src/lib/billing/session.ts`:

```typescript
import { db } from '@/db';
import { and, eq, gte, lte } from 'drizzle-orm';

export const deductSessionOnBooking = async (
  clientId: string,
  businessId: string
): Promise<{ remaining: number }> => {
  return db.transaction(async (tx) => {
    const membership = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.client_id, clientId)))
      .for('update');

    if (!membership || membership.sessions_remaining <= 0) {
      throw new Error('No sessions remaining');
    }

    await tx
      .update(memberships)
      .set({ sessions_remaining: membership.sessions_remaining - 1 })
      .where(eq(memberships.id, membership.id));

    return { remaining: membership.sessions_remaining - 1 };
  });
};
```

### Keep Existing setInterval (No changes)

v1.0 already has expiry reminders pattern. Extend to membership expiry:

```typescript
// In src/server/schedules.ts (existing file)
setInterval(async () => {
  const soon = addDays(new Date(), 7); // 7-day window

  const expiring = await db
    .select()
    .from(memberships)
    .where(
      and(
        lte(memberships.expires_at, soon),
        gte(memberships.expires_at, new Date()),
        isNull(memberships.notified_at)
      )
    );

  for (const m of expiring) {
    await sendMembershipExpiryNotification(m);
  }
}, 24 * 60 * 60 * 1000);
```

### No Changes to fly.toml or Neon

- fly.io hosting: Same Machine runs both webhook + setInterval. No scale changes needed for PoC.
- Neon database: No new schema patterns require special config. PostgreSQL's transaction isolation (SERIALIZABLE) is default.

## Version Lock & Updates

| Package | Version | Lock Strategy | Notes |
|---------|---------|---------------|-------|
| date-fns | 4.4.0 | ^4.4.0 (minor updates allowed) | Stable; minor releases backward-compatible. |
| node-schedule | 2.1.1 (if added) | ~2.1.1 (patch only) | Mature, last updated 4 years ago; no active development. Use if needed, but setInterval preferred for MVP. |
| Drizzle ORM | 0.30+ (existing) | ^0.30.0 | Actively maintained; minor updates safe. |
| Neon | (serverless) | N/A | No version lock; Neon manages PostgreSQL version. Current: PostgreSQL 15-17. |

## Sources

### Date Libraries
- [date-fns - npm](https://www.npmjs.com/package/date-fns)
- [date-fns vs Day.js vs Luxon 2026: Best Date Library — PkgPulse Guides](https://www.pkgpulse.com/guides/best-javascript-date-libraries-2026)
- [date-fns vs Day.js vs Luxon: Date Library Comparison 2026](https://reintech.io/blog/date-fns-vs-dayjs-vs-luxon-comparison-2026)

### Drizzle ORM & Transactions
- [Drizzle ORM - Transactions](https://orm.drizzle.team/docs/transactions)
- [Drizzle ORM Best Practices: Principles, Patterns, and Real-World Case Studies](https://www.paulserban.eu/blog/post/drizzle-orm-best-practices-principles-and-patterns-in-real-world-case-studies)
- [Repository Pattern in Nest.js with Drizzle ORM](https://medium.com/@vimulatus/repository-pattern-in-nest-js-with-drizzle-orm-e848aa75ecae)

### Job Scheduling
- [agenda vs cron vs later vs node-cron vs node-schedule | Job Scheduling Libraries in Node.js](https://npm-compare.com/agenda,cron,later,node-cron,node-schedule)
- [Comparing the best Node.js schedulers - LogRocket Blog](https://betterstack.com/community/guides/scaling-nodejs/best-nodejs-schedulers/)
- [Cron vs setInterval in Node.js — Which Should You Use?](https://dev-brains-ai.com/blog/cron-vs-setinterval-nodejs)
- [node-schedule - npm](https://www.npmjs.com/package/node-schedule)

### Currency & Money Handling
- [Mastering Money Calculations in JavaScript: The Best Libraries Compared](https://miladezzat.medium.com/mastering-money-calculations-in-javascript-the-best-libraries-compared-8e4ae03dac58)
- [Store and retrieve precise monetary values in JavaScript with Dinero.js - LogRocket Blog](https://blog.logrocket.com/store-retrieve-precise-monetary-values-javascript-dinero-js/)
- [decimal.js vs big.js vs bignumber.js 2026 — PkgPulse Guides](https://www.pkgpulse.com/guides/decimal-js-vs-big-js-vs-bignumber-js-arbitrary-2026)
- [Currency Calculations in JavaScript - Honeybadger Developer Blog](https://www.honeybadger.io/blog/currency-money-calculations-in-javascript/)

### Domain Patterns (Fitness/Booking)
- [ClassPass Cancellation & Token Deduction](https://help.classpass.com/hc/en-us/articles/207942743-What-is-the-reservation-cancellation-policy)
- [Mindbody ClassPass Integration Guide](https://support.mindbodyonline.com/s/article/Managing-ClassPass-Bookings?language=en_US)

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| **date-fns** | HIGH | Latest 4.4.0 verified on npm. Tree-shakeable. Already used in v1.0 (reminders). TypeScript support solid. |
| **Drizzle Transactions** | HIGH | Drizzle 0.30+ is in production. Transactions + `for('update')` locking is proven pattern for concurrent deductions. PostgreSQL isolation levels (SERIALIZABLE) reliable. |
| **setInterval Scheduling** | HIGH | Already working in v1.0 (daily agenda, 1h reminders). Idempotency via `notified_at` field prevents duplicates. No new risks. |
| **Integer Cents Currency** | HIGH | Standard practice in fintech. No floating-point errors. PostgreSQL `INTEGER` type native support. Zero overhead. |
| **No Money Library Needed** | HIGH | Dinero.js/Decimal.js/Big.js overkill for fixed EUR precision. Integer cents sufficient and simpler. |
| **node-schedule (deferred)** | HIGH | 2.1.1 stable, but setInterval adequate for MVP. Can add if wall-clock time becomes critical. Zero risk to defer. |

## Gaps to Address (Phase-Specific Research)

- **Phase 7 (Membership Configuration):** How should owner set up packages via chat? (Fixed 30 days, or allow owner to specify 15/30/90 days?). Validate via zod + Gemini function schema.
- **Phase 8 (Enforcement Rules):** Business policy edge cases: What if client tries to book outside membership window? What if owner cancels client's membership mid-validity?
- **Phase 9 (Balance Notifications):** Optimal expiry notification timing (7 days before? 1 day before?). Test with real owner feedback before hardcoding.

## Cost Assessment

| Service | Current Cost | Billing Stack Impact | Status |
|---------|-------------|---------------------|--------|
| **Gemini API** | Free tier (1,000 req/day) | +10–20 calls/day for billing functions (record_payment, check_balance) | Still within free tier ✅ |
| **Neon** | Free tier (100 CU/month) | +1–2M queries/month for ledger reads + transaction overhead | Still within free tier ✅ |
| **fly.io** | $1.94/month (post-trial) | No additional cost; setInterval runs on existing Machine | No change ✅ |
| **npm packages** | Free (date-fns) | 1 new package; others existing | No cost ✅ |
| **PostgreSQL** | Included in Neon | Native transaction support; no extra cost | No cost ✅ |

**Total incremental cost: $0** — All additions fit within existing free tiers.
