---
phase: 07-billing-configuration-payment-recording
plan: "03"
subsystem: billing
tags: [billing, queries, membership, ledger, DST, test-fixtures]
dependency_graph:
  requires:
    - "07-02 (billing schema: billingPackages, memberships, membershipLedger tables)"
    - "src/utils/timezone.ts (addCalendarDays, isoDateInAthens)"
    - "src/database/queries.ts (getConn, withBusinessContext)"
  provides:
    - "src/billing/queries.ts — 8 exported typed async functions for billing CRUD"
    - "tests/helpers/billing-fixtures.ts — insertTestPackage, insertTestMembership"
    - "DST-safe membership expiry logic (isoDateInAthens + addCalendarDays)"
  affects:
    - "src/database/queries.ts — exported getConn, upserted clientName on insertClientBusinessRelationship"
    - "07-04 billing/tools.ts (imports createPackage, activatePackage, etc.)"
    - "07-05 payment-flow.ts (imports createMembership, getClientActiveMembership)"
tech_stack:
  added: []
  patterns:
    - "db.transaction() for atomic membership + ledger dual-insert"
    - "onConflictDoUpdate with targetWhere for partial-index upsert (D-10)"
    - "Deterministic idempotencyKey format: {businessId}:{clientPhone}:payment_recorded:{purchaseDate}"
    - "jest.resetModules() + require() pattern for real-DB integration tests (billing-queries pattern)"
key_files:
  created:
    - src/billing/queries.ts
    - tests/helpers/billing-fixtures.ts
  modified:
    - src/database/queries.ts
    - tests/billing-dst-arithmetic.test.ts
    - tests/billing-membership-creation.test.ts
    - tests/billing-view-membership.test.ts
    - tests/consent.test.ts
    - tests/consent-schema.test.ts
decisions:
  - "Exported getConn from database/queries.ts (previously private) so billing/queries.ts can import it for RLS-enforced reads (T-07-03)"
  - "Applied migration 0006_billing_schema.sql to local randevuclaw_test DB for integration tests"
  - "Each billing-membership-creation test uses a unique clientPhone to avoid idempotencyKey collisions within the same test run day"
  - "billing test files follow booking-queries.test.ts pattern: set DATABASE_URL + jest.resetModules() + require() for real-DB integration"
metrics:
  duration: 12 min
  completed_date: "2026-07-20"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 8
status: complete
---

# Phase 07 Plan 03: Billing Query Layer Summary

**One-liner:** Billing CRUD query layer with DST-safe membership creation, atomic ledger writes, and idempotency-enforced replay protection.

## What Was Built

**`src/billing/queries.ts`** — 8 exported typed async functions covering the full billing lifecycle:

| Function | Description | Connection |
|----------|-------------|------------|
| `createPackage` | Insert package with isActive=false (D-03 pending flow) | admin db |
| `activatePackage` | Activate pending package, returns boolean | admin db |
| `cancelPendingPackage` | Delete pending package (cancel D-03 flow) | admin db |
| `listPackages` | List active packages newest-first | getConn() (RLS) |
| `deactivatePackage` | Soft-delete package | admin db |
| `getRecentClientsForBusiness` | Recent clients with last booking service fallback | getConn() (RLS) |
| `createMembership` | Atomic membership + ledger insert via db.transaction() | admin db tx |
| `getClientActiveMembership` | Non-expired active membership or null | getConn() (RLS) |

**`createMembership`** implements the full D-10/D-11/T-07-04 safety model:
- `isoDateInAthens(new Date())` for DST-safe purchase date
- `addCalendarDays(purchaseDate, pkg.validDays)` for DST-safe expiry
- `onConflictDoUpdate` with `targetWhere: sql\`is_active = true\`` to target the partial unique index
- Deterministic `idempotencyKey` = `${businessId}:${clientPhone}:payment_recorded:${purchaseDate}`
- Single `db.transaction()` — ledger UNIQUE constraint rollback prevents duplicate memberships on replay

**`src/database/queries.ts`** updated:
- `getConn` exported (was private) — needed by billing/queries.ts for RLS-scoped reads
- `insertClientBusinessRelationship` now accepts `clientName?: string` and uses `onConflictDoUpdate` to upsert on every call (D-04: always reflect latest Telegram from.first_name)
- `ClientBusinessRelationship` interface updated with `clientName: string | null`

**Test layer:**
- `tests/helpers/billing-fixtures.ts` — `insertTestPackage` and `insertTestMembership` helpers (bypass D-03 for test setup)
- `tests/billing-dst-arithmetic.test.ts` — 3 tests confirming noon-UTC anchor avoids DST off-by-ones
- `tests/billing-membership-creation.test.ts` — 5 real-DB integration tests (PAY-02)
- `tests/billing-view-membership.test.ts` — 4 real-DB integration tests (PAY-03)

## Verification Results

- `npx tsc --noEmit` — exits 0
- `npm test -- tests/billing-dst-arithmetic.test.ts` — 3 passed, 0 todos
- `npm test -- tests/billing-membership-creation.test.ts tests/billing-view-membership.test.ts` — 9 passed, 0 todos
- `npm test` — 247 passed, 25 todos (stubs for later plans), 1 pre-existing skip; 0 failures

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Exported `getConn` from `database/queries.ts`**
- **Found during:** Task 1 implementation
- **Issue:** `getConn` was a private (non-exported) function in `database/queries.ts`. The plan specified `billing/queries.ts` should import it for RLS-enabled reads, but private functions cannot be imported.
- **Fix:** Added `export` before `function getConn()` in `database/queries.ts`
- **Files modified:** `src/database/queries.ts`
- **Commit:** d712d98

**2. [Rule 1 - Bug] Added `clientName: null` to consent test mock objects**
- **Found during:** Task 2 verification
- **Issue:** After adding `clientName: string | null` to `ClientBusinessRelationship` interface, existing mock objects in `tests/consent.test.ts` and `tests/consent-schema.test.ts` were missing the required field, causing TypeScript type errors.
- **Fix:** Added `clientName: null` to all `ClientBusinessRelationship` mock objects in both files
- **Files modified:** `tests/consent.test.ts`, `tests/consent-schema.test.ts`
- **Commit:** 09ebd77

**3. [Rule 3 - Blocking] Applied migration 0006 to local test DB and used `jest.resetModules()` pattern**
- **Found during:** Task 3 test execution
- **Issue:** Billing integration tests failed with "The server does not support SSL connections" because they used the default `DATABASE_URL` from `jest.setup.ts` which points to `testdb?sslmode=require`. The local test DB (`randevuclaw_test`) didn't have the billing schema applied.
- **Fix:** Applied `migrations/0006_billing_schema.sql` to `randevuclaw_test`. Updated billing test files to follow the `booking-queries.test.ts` pattern: set `DATABASE_URL` to the local non-SSL URL, call `jest.resetModules()`, and use `require()` for module imports.
- **Files modified:** `tests/billing-membership-creation.test.ts`, `tests/billing-view-membership.test.ts`
- **Commit:** 9db7f3a

**4. [Rule 1 - Bug] Used unique clientPhone per test in billing-membership-creation tests**
- **Found during:** Task 3 test execution
- **Issue:** Tests 2 and 3 shared `clientPhone = 'test-client-001'` with test 1. Since all ran on the same calendar day, the idempotencyKey UNIQUE constraint prevented tests 2 and 3 from calling `createMembership` for the same client on the same day.
- **Fix:** Each test case uses a unique clientPhone (e.g., `expires-test-${Date.now()}`).
- **Files modified:** `tests/billing-membership-creation.test.ts`
- **Commit:** 9db7f3a (same commit as fix 3)

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundaries introduced. This plan creates a pure DB query layer. The security controls are:
- Drizzle parameterized queries throughout (T-07-02 — no string interpolation in SQL)
- `getConn()` for reads (T-07-03 — RLS enforced in withBusinessContext)
- Deterministic idempotencyKey + UNIQUE constraint (T-07-04 — replay protection)
- businessId WHERE clause in all queries (defense-in-depth beyond RLS)

## Known Stubs

None. The billing query functions are fully implemented. The 25 `it.todo` stubs in other billing test files (`billing-package-creation.test.ts`, `billing-package-list.test.ts`, etc.) are intentional — they are scheduled for Plans 07-04 and 07-05.

## Self-Check: PASSED

- src/billing/queries.ts — FOUND
- tests/helpers/billing-fixtures.ts — FOUND
- Commit d712d98 — FOUND (feat(07-03): create billing queries layer)
- Commit 09ebd77 — FOUND (feat(07-03): upsert clientName)
- Commit 9db7f3a — FOUND (feat(07-03): add billing test fixtures)
