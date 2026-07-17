# Project Research Summary: Billing & Membership System for Chat-Native Appointment Booking

**Project:** RandevuClaw v1.2 Billing & Membership Features
**Domain:** Chat-native fitness/wellness appointment booking with token/credit systems
**Researched:** 2026-07-17
**Overall Confidence:** HIGH

## Executive Summary

Adding billing and membership features to a chat-native appointment booking system is a well-established domain with clear best practices from fitness platforms (ClassPass, Mindbody, Everfit). Research converges on three architectural principles: **(1) atomic transaction coupling** (session deduction in the same DB transaction as booking confirmation), **(2) immutable ledger patterns** (append-only credit/debit entries; never UPDATE ledger rows), and **(3) timezone-explicit expiry tracking** (TIMESTAMP WITH TIME ZONE, not DATE, to prevent DST bugs).

Only one new dependency required: **date-fns 4.4.0** for rolling 30/90-day window calculations. Drizzle transactions + setInterval pollers cover everything else. All within existing free tiers — zero infrastructure cost.

Critical risk: **concurrent session deduction race conditions** (two simultaneous bookings both deducting from same balance). Prevention: `SELECT FOR UPDATE` row-level locking inside `db.transaction()`. Second risk: **timezone ambiguity** on DST transitions — requires `TIMESTAMP WITH TIME ZONE` from Phase 7.

## Key Findings

### Stack

- **date-fns 4.4.0** — only new package; lightweight (13 KB), tree-shakeable, handles rolling 30/90-day expiry windows. Luxon/Day.js rejected (too heavy / too minimal).
- **Drizzle transactions (existing)** — `db.transaction()` + `SELECT FOR UPDATE` locking. No new ORM.
- **setInterval (existing)** — extend v1.0 reminder poller pattern with expiry sweep. node-schedule deferred.
- **Integer cents** — all amounts stored as PostgreSQL INTEGER (€49.99 = 4999). No Decimal.js/Dinero.js needed.

### Features

**Table stakes (must ship):**
- Session deduction at booking confirmation (not at service time)
- Credit restoration on cancel (within validity window); forfeiture after expiry or past 24h
- Membership validity check at booking time (block or flag based on business policy)
- Client balance query ("πόσα μαθήματα μου έχουν απομείνει;")
- Owner records payment via chat → bot creates membership with expiry
- Expiry notification at 7-day mark to both client and owner

**Differentiators (defer to v1.3+):**
- Partial credit rollover on renewal
- No-expiry punch cards (configurable option)
- Bulk credit adjustments by owner

**Critical edge cases:**
- Concurrent deductions (two bookings within milliseconds) — race condition
- Reschedule across token boundaries (cancel in expired membership, rebook in new one)
- Cancellation after membership expired — no credit restore
- DST transitions in Athens (late Oct) on expiry boundary dates

### Architecture

Four new tables (all with RLS, business_id FK):

| Table | Purpose |
|-------|---------|
| `billing_packages` | Owner-defined configs: name, price_cents, valid_days, sessions_included (null=unlimited) |
| `client_memberships` | Purchase records: client+package+business, expires_at, sessions_remaining, status |
| `membership_ledger` | Immutable append-only DEBIT/CREDIT log with idempotency_key UNIQUE constraint |
| `membership_expiry_notifications` | Dedup guard: UNIQUE on (membership_id, notification_type, date) |

**Transaction boundaries:**
- Booking confirm: INSERT booking + INSERT ledger DEBIT + UPDATE sessions_remaining — **one transaction**
- Booking cancel: UPDATE booking + INSERT ledger CREDIT + UPDATE sessions_remaining — **one transaction**
- Payment record: INSERT membership + INSERT ledger CREDIT (initial balance) — **one transaction**

**Build order:** Phase 7 (schema + owner tools) → Phase 8 (booking refactor + enforcement) → Phase 9 (poller + notifications). Strict sequential — each phase has hard dependency on previous.

### Critical Pitfalls

1. **Concurrent deduction race** — Prevention: `SELECT FOR UPDATE` in booking transaction (Phase 8)
2. **Timezone DST ambiguity** — Prevention: `TIMESTAMP WITH TIME ZONE` in schema; `Europe/Athens` app timezone (Phase 7)
3. **Cancel-after-expiry credit leak** — Prevention: link `bookings.membership_id` FK; restore only if booking was created within membership validity window (Phase 8)
4. **Ambiguous chat payment recording** — Prevention: structured button-based package selection + explicit Greek confirmation before INSERT (Phase 7)
5. **Duplicate expiry notifications** — Prevention: `membership_expiry_notifications` UNIQUE constraint + `isRunning` poller guard (Phase 9)

## Implications for Roadmap

### Phase 7: Billing Configuration & Payment Recording (LOW risk)

Schema foundation + timezone convention + owner tools. No changes to existing booking flow.

Delivers: 4 new tables, `configure_package` + `record_payment` Gemini tools, structured package-selection UX with confirmation.

### Phase 8: Enforcement & Session Deduction (HIGH risk — concurrent load)

Refactors booking confirmation + cancel handlers to integrate session ledger atomically. Highest concurrency risk; requires load test before shipping.

Delivers: atomic deduction in booking confirm, atomic restoration in cancel, enforcement policy (block vs flag) per business, `booking.membership_id` FK for cancellation-after-expiry logic.

### Phase 9: Notifications & Expiry Management (MEDIUM risk)

Extends existing setInterval reminder poller. Deduplication via notification log table.

Delivers: 7-day expiry sweep, dedup guard, `isRunning` poller protection, client balance query, auto-renewal flow.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | date-fns 4.4.0 verified on npm. Drizzle transactions official docs. setInterval proven in v1.0. |
| Features | HIGH | Table-stakes consensus across ClassPass, Mindbody, Everfit, Punchpass. |
| Architecture | HIGH | Immutable ledger + idempotency proven in fintech production systems. |
| Pitfalls | HIGH | Race condition (SELECT FOR UPDATE), timezone (TIMESTAMP WITH TIME ZONE), dedup (UNIQUE constraint) — all documented solutions. |

## Sources

- [date-fns npm](https://www.npmjs.com/package/date-fns)
- [Drizzle ORM Transactions](https://orm.drizzle.team/docs/transactions)
- [PostgreSQL Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- [ClassPass Cancellation Policy](https://help.classpass.com/)
- [Everfit Session Credits](https://help.everfit.io/)
- [Punchpass Platform](https://punchpass.com/)
- [Designing a Scalable Wallet Ledger System](https://www.bamboodt.com/designing-a-scalable-wallet-ledger-system-for-secure-fintech/)
- [Race Conditions in Booking Systems](https://hackernoon.com/how-to-solve-race-conditions-in-a-booking-system)
- [Timezone Handling for Billing](https://getlago.com/blog/time-zone-nightmares)

---
*Research completed: 2026-07-17*
*Ready for roadmap planning: Yes*
