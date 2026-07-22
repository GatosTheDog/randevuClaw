---
phase: 10-session-catalog-schema
plan: "02"
subsystem: database
tags: [drizzle, postgres, neon, schema, session-catalog, rrule]

requires:
  - phase: 10-01
    provides: test stubs (session-creation, session-expansion, session-cancel, session-assignment, session-list) and rrule install plan

provides:
  - sessionCatalog Drizzle table export with rruleString, startTime, capacity, isActive, partial uniqueIndex
  - sessionInstances Drizzle table export with catalogId FK, sessionDate, sessionTime, bookedCount, isCancelled, idempotencyKey UNIQUE
  - slotlessRequests Drizzle table export with businessId, clientPhone, requestedDate/Time, serviceId, status CHECK, bookingId nullable FK, idempotencyKey UNIQUE
  - 7 new NOT NULL columns on businesses table (bookingMode, cancellationCutoffEnabled, cancellationCutoffHours, slotlessRequestsEnabled, lastSessionThresholdEnabled, lastSessionThresholdCount, allowMultiBooking)
  - nullable sessionInstanceId column on bookings table
  - migrations/0010_session_catalog_schema.sql (idempotent, 6 sections, all tables + grants)

affects:
  - 10-03 (session manager — imports sessionCatalog, sessionInstances)
  - 10-04 (owner tools — references bookingMode column in executeOwnerTool switch cases)
  - 10-05 (cancellation poller — imports sessionInstances, sessionCatalog)
  - 10-06 (E2E tests — validates live DB tables via drizzle-kit push)
  - Phase 11 (SBOK — sessionInstanceId FK on bookings, allowMultiBooking)
  - Phase 12 (CANC — cancellationCutoffEnabled/Hours)
  - Phase 13 (SLOT — slotlessRequests table, slotlessRequestsEnabled)
  - Phase 14 (RENW — lastSessionThresholdEnabled/Count)

tech-stack:
  added: []
  patterns:
    - "Drizzle table with partial uniqueIndex WHERE clause (matches billingPackages pattern)"
    - "NOT NULL with DEFAULT on non-empty table for backward-compatible column additions"
    - "Idempotency key UNIQUE on sessionInstances prevents rrule expansion replay duplicates"
    - "Nullable FK column (sessionInstanceId) for phased feature rollout without breaking v1.2 bookings"

key-files:
  created:
    - migrations/0010_session_catalog_schema.sql
  modified:
    - src/database/schema.ts

key-decisions:
  - "sessionInstanceId on bookings is nullable (no .references() in Drizzle) — forward reference to sessionInstances defined later in file; FK constraint enforced via migration SQL"
  - "bookingMode defaults to 'open_slots' — existing businesses preserve v1.2 behavior without any UPDATE migration"
  - "idempotencyKey UNIQUE on sessionInstances guards against rrule expansion replay (onConflictDoNothing safe)"
  - "slotlessRequests has a CHECK constraint on status IN ('pending', 'approved', 'rejected') in migration SQL"
  - "All 7 new businesses columns are NOT NULL with DEFAULT — safe on non-empty table, Postgres backfills default for existing rows"

requirements-completed:
  - CLSS-01
  - CLSS-02
  - CLSS-03
  - CLSS-04
  - CLSS-05

coverage:
  - id: D1
    description: "sessionCatalog, sessionInstances, slotlessRequests exported from src/database/schema.ts"
    requirement: CLSS-01
    verification:
      - kind: unit
        ref: "npx tsc --noEmit (exits 0, all 3 exports type-check)"
        status: pass
    human_judgment: false
  - id: D2
    description: "businesses table has 7 new config columns with correct NOT NULL defaults"
    requirement: CLSS-01
    verification:
      - kind: unit
        ref: "npx tsc --noEmit (exits 0, column definitions type-check)"
        status: pass
    human_judgment: false
  - id: D3
    description: "bookings table has nullable sessionInstanceId column"
    requirement: CLSS-01
    verification:
      - kind: unit
        ref: "npx tsc --noEmit (exits 0)"
        status: pass
    human_judgment: false
  - id: D4
    description: "migrations/0010_session_catalog_schema.sql exists with all 6 sections, idempotent, GRANT statements for randevuclaw_app"
    requirement: CLSS-02
    verification:
      - kind: manual_procedural
        ref: "grep -c 'session_catalog' migrations/0010_session_catalog_schema.sql (returns 11)"
        status: pass
    human_judgment: false
  - id: D5
    description: "npx drizzle-kit push exits 0 — live Neon DB has session_catalog, session_instances, slotless_requests tables and all new businesses/bookings columns"
    requirement: CLSS-01
    verification: []
    human_judgment: true
    rationale: "Requires live Neon DB credentials (DATABASE_URL in .env.local) and human to review drizzle-kit prompt before confirming table creation. Cannot be automated without credentials in executor context."

duration: 20min
completed: 2026-07-22
status: awaiting_human_gate
---

# Phase 10 Plan 02: Session Catalog Schema Summary

**Drizzle schema extended with sessionCatalog, sessionInstances, slotlessRequests tables, 7 business config columns, and nullable sessionInstanceId FK — blocking Wave 1 gate awaiting drizzle-kit push to live Neon DB**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-22T00:00:00Z
- **Completed (partial):** 2026-07-22 (stopped at Task 3 checkpoint)
- **Tasks:** 2 of 3 complete (Task 3 is blocking human checkpoint)
- **Files modified:** 2 (src/database/schema.ts, migrations/0010_session_catalog_schema.sql)

## Accomplishments

- Extended `src/database/schema.ts` with 3 new exported tables: `sessionCatalog`, `sessionInstances`, `slotlessRequests` — all using existing Drizzle pgTable patterns (billingPackages analog), partial uniqueIndex WHERE clauses, and inline phase-cited JSDoc comments
- Added 7 NOT NULL columns to `businesses` with safe defaults: `bookingMode` ('open_slots'), `cancellationCutoffEnabled` (false), `cancellationCutoffHours` (8), `slotlessRequestsEnabled` (false), `lastSessionThresholdEnabled` (false), `lastSessionThresholdCount` (1), `allowMultiBooking` (false)
- Added nullable `sessionInstanceId` column to `bookings` (no Drizzle forward-reference FK — constraint in migration SQL; existing open_slots bookings unaffected)
- Created idempotent `migrations/0010_session_catalog_schema.sql` with all 6 sections (businesses ALTER TABLE, bookings ALTER TABLE, session_catalog CREATE, session_instances CREATE, slotless_requests CREATE, role grants)
- `npx tsc --noEmit` exits 0 — zero TypeScript errors after all schema changes

## Task Commits

1. **Task 1: Extend src/database/schema.ts** - `be113a5` (feat)
2. **Task 2: Create migrations/0010_session_catalog_schema.sql** - `ae37329` (feat)
3. **Task 3: drizzle-kit push** — BLOCKING HUMAN CHECKPOINT (not yet complete)

## Files Created/Modified

- `src/database/schema.ts` — Added 3 new session tables at end of file; 7 new businesses columns after enforcementPolicy; nullable sessionInstanceId on bookings; all follow established Phase 7/8/9 conventions
- `migrations/0010_session_catalog_schema.sql` — Idempotent reference migration; 6 sections; CREATE TABLE in DO $$ blocks; CREATE UNIQUE INDEX IF NOT EXISTS; GRANT to randevuclaw_app role

## Decisions Made

- `sessionInstanceId` on bookings has no Drizzle `.references()` because `sessionInstances` is defined later in the file — forward-reference FK in Drizzle requires an `AnyPgColumn` annotated cast (same pattern noted in existing `rescheduledFromBookingId` comment). The FK constraint is enforced via Section 2 of the migration SQL, where both tables already exist.
- `bookingMode` is `text('booking_mode').notNull().default('open_slots')` — NOT nullable, unlike earlier phase conventions. Plan specifies NOT NULL with DEFAULT is safe here; Postgres backfills existing rows without a separate UPDATE pass.
- Section 2 (bookings.session_instance_id) references session_instances which is created in Section 4 — migration header comment documents the ordering dependency; drizzle-kit push handles ordering automatically from schema.ts.
- slotless_requests status CHECK constraint (`IN ('pending', 'approved', 'rejected')`) is in migration SQL only (not in Drizzle schema column definition) — Drizzle does not natively support inline CHECK on text columns in the same ergonomic way; the constraint is applied at DB level via migration (T-10-05 mitigation per threat model).

## Deviations from Plan

None — plan executed exactly as written for Tasks 1 and 2. Task 3 is a blocking checkpoint returned to human as specified.

## Threat Flags

None — no new security surface beyond what is documented in the plan's threat model. All T-10-02 / T-10-05 / T-10-06 mitigations are implemented: businessId FK on all 3 new tables, idempotencyKey UNIQUE on sessionInstances and slotlessRequests, CHECK constraint on slotlessRequests.status in migration SQL, role grants in Section 6.

## Known Stubs

None in this plan. Task 1 adds schema columns and table definitions only — no data-flow or UI rendering paths that could produce empty/placeholder output.

## Issues Encountered

None.

## Next Phase Readiness (after drizzle-kit push)

**BLOCKED:** Wave 2 (10-03 session manager, 10-04 owner tools) and all downstream phases cannot proceed until drizzle-kit push completes and the live Neon DB has the new tables and columns.

After drizzle-kit push is confirmed:
- Wave 2 can import `sessionCatalog`, `sessionInstances`, `slotlessRequests` from `src/database/schema.ts`
- `src/session/manager.ts` (Plan 10-03) depends on `sessionCatalog` and `sessionInstances` exports
- `src/onboarding/ai-owner-agent.ts` switch cases (Plan 10-04) depend on `businesses.bookingMode` column being live in DB
- `src/scheduler/session-cancellation.ts` (Plan 10-05) depends on `sessionInstances.isCancelled` being live in DB

## Self-Check

- [x] `src/database/schema.ts` exists and exports sessionCatalog, sessionInstances, slotlessRequests — FOUND
- [x] `migrations/0010_session_catalog_schema.sql` exists — FOUND
- [x] Commit `be113a5` exists — FOUND
- [x] Commit `ae37329` exists — FOUND
- [x] `npx tsc --noEmit` exits 0 — PASSED

## Self-Check: PASSED

---
*Phase: 10-session-catalog-schema*
*Completed (partial, awaiting drizzle-kit push): 2026-07-22*
