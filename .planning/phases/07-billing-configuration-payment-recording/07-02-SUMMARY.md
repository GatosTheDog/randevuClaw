---
phase: "07"
plan: "02"
subsystem: database
tags: [schema, drizzle, billing, memberships, migration]
status: checkpoint

dependencies:
  requires:
    - 07-01  # billing test stubs must exist before schema work
  provides:
    - billingPackages schema export
    - memberships schema export
    - membershipLedger schema export
    - clientBusinessRelationships.clientName column
    - migrations/0006_billing_schema.sql
  affects:
    - src/database/schema.ts
    - migrations/

tech_stack:
  added: []
  patterns:
    - Drizzle partial uniqueIndex with WHERE clause (is_active = true)
    - Immutable ledger pattern with idempotency_key UNIQUE constraint
    - Nullable column addition to non-empty table (nullable convention)

key_files:
  created:
    - migrations/0006_billing_schema.sql
  modified:
    - src/database/schema.ts

decisions:
  - "billingPackages uniqueIndex uses partial WHERE is_active = true — allows reusing a package name after deactivation"
  - "membershipLedger uses both inline .unique() and explicit uniqueIndex — inline enforces DB constraint, index improves query performance"
  - "memberships partial index WHERE is_active = true enforces D-10 one-active-membership at DB level without blocking future memberships"
  - "clientName added as nullable text column following established phase-annotation convention (non-empty table cannot add NOT NULL without default)"

metrics:
  duration_min: 5
  completed_date: "2026-07-20"
  tasks_completed: 2
  tasks_total: 3
  files_changed: 2
---

# Phase 7 Plan 02: Billing Schema Extension Summary

**One-liner:** Drizzle schema extended with billingPackages, memberships, membershipLedger tables and clientName column; SQL reference migration created; DB push awaiting human verification.

## Status

**CHECKPOINT — Task 3 (drizzle-kit push) awaiting human execution.**

Tasks 1 and 2 are committed. Task 3 is a blocking human-verify checkpoint: the human must run `npx drizzle-kit push` to apply the schema to the live Neon DB.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend schema.ts with billing tables and client_name | af57130 | src/database/schema.ts |
| 2 | Create migrations/0006_billing_schema.sql | 83281ff | migrations/0006_billing_schema.sql |

## Task 3 (Pending Human Action)

**Task 3:** Push schema to Neon DB via drizzle-kit push  
**Status:** Awaiting human execution  
**Resume signal:** Type "approved" when drizzle-kit push exits 0 and npm test passes

## Verification Results

### Task 1 — schema.ts

```
grep -c 'clientName'              → 1  ✓
grep -c 'export const billingPackages'  → 1  ✓
grep -c 'export const memberships'      → 1  ✓
grep -c 'export const membershipLedger' → 1  ✓
grep -c 'idempotencyKey'          → 2  ✓
grep -c 'is_active = true'        → 4  ✓ (≥2 required)
npx tsc --noEmit                  → exit 0  ✓
```

### Task 2 — migration SQL

```
file exists                       → ✓
grep -c 'billing_packages'        → 8   ✓ (≥3 required)
grep -c 'idempotency_key'         → 3   ✓
grep -c 'randevuclaw_app'         → 7   ✓ (≥3 required)
grep -c 'IF NOT EXISTS'           → 9   ✓ (≥3 required)
grep -c 'client_name'             → 3   ✓
grep -c 'membership_ledger'       → 8   ✓
```

## Schema Design Notes

### billingPackages

- `priceCents` (integer, e.g. 8000 = €80.00) — follows existing services.price cents convention
- `sessionCount` nullable — null = unlimited sessions (D-02)
- `isActive` boolean default true — soft-delete, never hard-delete (D-03)
- Partial `uniqueIndex('unique_active_package_name').where(sql`is_active = true`)` — allows re-creating a package with the same name after deactivation

### memberships

- `clientPhone` = Telegram from.id stringified — consistent with bookings.clientPhone
- `expiresAt` = TIMESTAMP (stored as TIMESTAMP WITH TIME ZONE) — DST-safe rolling expiry
- `sessionsRemaining` nullable — null = unlimited (D-02)
- Partial `uniqueIndex('unique_active_membership').where(sql`is_active = true`)` — enforces D-10 one active membership per (business, client)

### membershipLedger

- `idempotencyKey` has both inline `.unique()` and `uniqueIndex()` — DB constraint + query index
- `sessionsDeducted` = 0 default — payment_recorded entries with no session count
- `bookingId` nullable — Phase 8+ will set this on booking-triggered deductions
- No UPDATE grant to randevuclaw_app — append-only ledger (D-11)

### clientBusinessRelationships.clientName

- Nullable per convention (table is non-empty; can't add NOT NULL without default)
- Upserted on every incoming Telegram message from a client (D-04)
- Used in payment flow inline keyboard buttons (D-05)

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — this plan creates schema only. No data source wiring deferred.

## Threat Flags

None — all new tables have business_id FK (multi-tenant isolation), idempotency_key UNIQUE (replay protection), and are covered by randevuclaw_app role grants per STRIDE register.

## Self-Check: PASSED

- [x] src/database/schema.ts — modified and committed (af57130)
- [x] migrations/0006_billing_schema.sql — created and committed (83281ff)
- [x] npx tsc --noEmit exits 0
- [x] Both commits exist in git log
- [ ] Task 3 (drizzle-kit push) — PENDING human action
