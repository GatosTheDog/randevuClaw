---
phase: quick-260813-ji5
plan: 01
subsystem: payments
tags: [drizzle-orm, postgres, telegram, billing]

requires:
  - phase: 07-billing-configuration-payment-recording
    provides: billing_packages/memberships/membership_ledger schema, createMembership, deductSession idempotency convention
  - phase: 08-booking-enforcement-session-deduction
    provides: checkEnforcementAndGetMembership enforcement pre-check layer
provides:
  - "checkEnforcementAndGetMembership always sets shouldAlert:true for 'flag' and 'allow' policies when the client has no valid/capacity membership"
  - "getUnbilledBookingsForClient query helper (LEFT JOIN + isNull) isolating bookings with no session_deducted ledger row"
  - "createMembership retroactive reconciliation: finite packages deduct pre-existing unbilled bookings from the starting session count, atomically and idempotently"
  - "payment-recording UI surfaces the retroactive-deduction count and a per-client unbilled indicator"
affects: [billing, payment-flow, enforcement]

tech-stack:
  added: []
  patterns:
    - "LEFT JOIN with the disambiguating condition (operationType='session_deducted') inside the join's ON clause, not the outer WHERE, to avoid silently downgrading to an INNER JOIN"
    - "Query executor parameter typed as Pick<typeof db, 'select'> (not typeof db) so both getConn() and a runInTransaction tx client satisfy it without a cast"

key-files:
  created:
    - tests/billing-unbilled-bookings.test.ts
  modified:
    - src/billing/enforcement.ts
    - src/billing/queries.ts
    - src/telegram/handlers/payment-flow.ts
    - tests/booking-enforcement.test.ts
    - tests/billing-membership-creation.test.ts
    - tests/billing-payment-flow.test.ts

key-decisions:
  - "getUnbilledBookingsForClient's conn parameter typed as Pick<typeof db, 'select'> instead of the plan's literal typeof db — tx (PgTransaction) lacks the $client property that typeof db requires, so Pick<'select'> is the minimal structural type both getConn() and tx satisfy without a cast"
  - "showClientSelection's unbilled-indicator wiring was adapted to the actual current code shape (recentKeyboard + neverBookedKeyboard, both always built per the 260813-jgj fix) rather than the plan's literal 'G-07-6 allClients branch' / 'clients branch' description, which referenced an older pre-260813-jgj code structure"

requirements-completed: []

coverage:
  - id: D1
    description: "checkEnforcementAndGetMembership sets shouldAlert:true for both 'flag' and 'allow' policies whenever hasCapacity is false; 'block' unchanged"
    verification:
      - kind: unit
        ref: "tests/booking-enforcement.test.ts#'allow' policy + no membership allows booking and sets shouldAlert:true (always-on unbilled-booking alert)"
        status: pass
      - kind: unit
        ref: "tests/booking-enforcement.test.ts#'allow' policy + exhausted membership (sessionsRemaining: 0) also sets shouldAlert:true"
        status: pass
    human_judgment: false
  - id: D2
    description: "getUnbilledBookingsForClient correctly isolates confirmed/pending_owner_approval bookings with no session_deducted ledger row"
    verification:
      - kind: integration
        ref: "tests/billing-unbilled-bookings.test.ts (4 tests) — could not execute in this sandbox, local Postgres test DB auth unavailable"
        status: unknown
    human_judgment: true
    rationale: "Integration tests require a real local Postgres connection (postgresql://manolis@localhost:5432/randevuclaw_test). This sandbox's Bash tool cannot authenticate to that server (SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string) — confirmed via a baseline run of the pre-existing, unmodified tests/billing-membership-creation.test.ts, which fails identically. This is an environment/credentials gap, not a code defect. npx tsc --noEmit passes with the new code; a human with local DB access should run `npx jest --testPathPattern=billing-unbilled-bookings` to confirm."
  - id: D3
    description: "createMembership retroactively reconciles unbilled bookings for finite packages, atomically and idempotently, never for unlimited packages"
    verification:
      - kind: integration
        ref: "tests/billing-membership-creation.test.ts#unbilled-booking reconciliation (quick 260813-ji5) (2 tests) — could not execute in this sandbox, local Postgres test DB auth unavailable"
        status: unknown
    human_judgment: true
    rationale: "Same local-Postgres-auth environment gap as D2 (see rationale above). Logic was verified against the exact structure and idempotency convention already proven by the file's existing (also-unexecutable-here) passing tests, plus a full npx tsc --noEmit pass."
  - id: D4
    description: "Payment-recording UI shows the owner both the retroactive-deduction count on membership creation and a per-client unbilled indicator before client selection"
    verification:
      - kind: unit
        ref: "tests/billing-payment-flow.test.ts#quick-260813-ji5: annotates a client button label with an unbilled-booking indicator"
        status: pass
      - kind: unit
        ref: "tests/billing-payment-flow.test.ts#quick-260813-ji5: leaves the label unmodified when the client has no unbilled bookings"
        status: pass
      - kind: unit
        ref: "tests/billing-payment-flow.test.ts#quick-260813-ji5: includes the retroactive-deduction count when greater than 0"
        status: pass
      - kind: unit
        ref: "tests/billing-payment-flow.test.ts#creates membership when sender is the correct owner (byte-identical-when-zero assertion)"
        status: pass
    human_judgment: false

duration: 23min
completed: 2026-08-13
status: complete
---

# Quick Task 260813-ji5: Unbilled-Booking Reconciliation + Always-On Owner Alert Summary

**Always-on owner alert for no-capacity bookings under any non-block policy, plus atomic/idempotent retroactive session deduction for pre-existing unbilled bookings when a new membership is created.**

## Performance

- **Duration:** 23 min
- **Started:** 2026-08-13T14:15:18+03:00 (plan commit)
- **Completed:** 2026-08-13T14:38:11+03:00
- **Tasks:** 4 completed
- **Files modified:** 6 (1 new test file)

## Accomplishments

- `checkEnforcementAndGetMembership` now sets `shouldAlert: true` for both `'flag'` and `'allow'` policies whenever the client has no valid/capacity membership — owners with a permissive `'allow'` policy now get the existing best-effort Telegram alert that only `'flag'` used to trigger. `'block'` behavior is untouched.
- New `getUnbilledBookingsForClient(businessId, clientPhone, conn?)` query helper: LEFT JOIN bookings to `membershipLedger` (join condition scoped to `operationType='session_deducted'`, kept inside the `ON` clause so it never degrades to an INNER JOIN), filtered to `confirmed`/`pending_owner_approval` bookings with `isNull(membershipLedger.id)`.
- `createMembership` now retroactively reduces a finite package's starting `sessionsRemaining` by the client's fresh unbilled-booking count (floored at 0), inserting one `session_deducted` ledger row per reconciled booking inside the same transaction as the membership upsert. Uses `onConflictDoNothing()` with the exact `booking:{id}:deduction` idempotency-key convention `deductSession` already established, so a booking can never be double-deducted across live deduction, reconciliation, or repeated/renewed `createMembership` calls. Unlimited packages (`sessionCount: null`) never run this logic. Returns a new `retroactiveSessionsDeducted` field.
- Payment-recording UI (`payment-flow.ts`): `showClientSelection`'s client button labels now show a `⚠️ N ανείσπρακτες κρατήσεις` indicator when a client has unbilled bookings; `handleConfirmMembership`'s success message appends an `Αναδρομική χρέωση: N ...` line only when `retroactiveSessionsDeducted > 0` (byte-identical to before otherwise).

## Task Commits

Each task was committed atomically:

1. **Task 1: Always-on owner alert (Part A)** - `c6608b0` (fix)
2. **Task 2: Add getUnbilledBookingsForClient query helper (Part B, read layer)** - `bec6292` (feat)
3. **Task 3: Wire retroactive reconciliation into createMembership (Part B, write layer)** - `608cfbe` (feat)
4. **Task 4: Surface reconciliation in the payment-recording UI (Part B, presentation)** - `99a762a` (feat)

**Plan metadata:** (recorded separately by the orchestrator)

## Files Created/Modified

- `src/billing/enforcement.ts` - Collapsed the 'flag'-only shouldAlert branch into "any non-'block' policy" once `!hasCapacity`
- `src/billing/queries.ts` - Added `UnbilledBooking`/`getUnbilledBookingsForClient`; wired reconciliation into `createMembership`; added `senderPhone` to `RecentClient`/`getRecentClientsForBusiness`
- `src/telegram/handlers/payment-flow.ts` - `appendUnbilledIndicator` helper; wired unbilled counts into `showClientSelection`'s two keyboards; `handleConfirmMembership` conditional retroactive-deduction line
- `tests/booking-enforcement.test.ts` - 2 new tests for the 'allow'-policy always-on alert
- `tests/billing-unbilled-bookings.test.ts` (new) - 4 tests covering the LEFT JOIN's inclusion/exclusion logic and status scoping
- `tests/billing-membership-creation.test.ts` - 2 new tests covering reconciliation, idempotent renewal, and unlimited-package no-op
- `tests/billing-payment-flow.test.ts` - `getUnbilledBookingsForClient` mock wiring, `senderPhone` added to `RecentClient` fixtures, 2 new `showClientSelection` tests, 1 new `handleConfirmMembership` test, plus a byte-identical-when-zero assertion on the existing success test

## Decisions Made

- `getUnbilledBookingsForClient`'s `conn` parameter is typed `Pick<typeof db, 'select'>` rather than the plan's literal `typeof db`: TypeScript rejected passing `tx` (the `runInTransaction` callback's `PgTransaction` argument) as `typeof db`, because `typeof db` structurally requires a `$client: Pool` property that `PgTransaction` does not have. `Pick<typeof db, 'select'>` is the minimal structural type both `getConn()`'s return value and `tx` satisfy, preserving full type safety with no cast.
- `showClientSelection`'s wiring targets the actual current code structure (`recentKeyboard` + `neverBookedKeyboard`, both unconditionally built per the prior `260813-jgj` fix) rather than the plan's literal reference to an older "G-07-6 `allClients` branch" / "`clients` branch" structure that no longer exists in the file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `typeof db` parameter type incompatible with the transaction client**
- **Found during:** Task 2/3 (`getUnbilledBookingsForClient` + wiring into `createMembership`)
- **Issue:** The plan's contract specified `conn: typeof db = getConn()`, but `tsc --noEmit` rejected passing `tx` (from `runInTransaction`'s callback) as `typeof db`, since `typeof db` requires a `$client: Pool` field `PgTransaction` lacks.
- **Fix:** Changed the parameter type to `conn: Pick<typeof db, 'select'> = getConn()` — structurally satisfied by both `db`/`getConn()` and `tx`, with zero casts.
- **Files modified:** src/billing/queries.ts
- **Verification:** `npx tsc --noEmit` passes with zero errors.
- **Committed in:** bec6292 (Task 2 commit)

**2. [Rule 1 - Bug] Plan's `showClientSelection` branch description was stale**
- **Found during:** Task 4
- **Issue:** The plan described wiring the unbilled indicator into a "G-07-6 `allClients` fallback branch" and a separate main "`clients` branch" — this matches an older pre-`260813-jgj` version of `showClientSelection`. The current code (after the `260813-jgj` fix) always builds both `recentKeyboard` (from `clients`) and `neverBookedKeyboard` (from `neverBookedClients`) unconditionally, with no fallback branching.
- **Fix:** Wired the unbilled-count lookups into both keyboards as they actually exist today (`clients.map(...)` and `neverBookedClients.map(...)`), preserving the plan's intent (both branches get the indicator) without reintroducing dead branch logic.
- **Files modified:** src/telegram/handlers/payment-flow.ts
- **Verification:** `tests/billing-payment-flow.test.ts` full suite (19 tests) passes, including the 2 new unbilled-indicator tests.
- **Committed in:** 99a762a (Task 4 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking type-compatibility fix, 1 bug — plan referenced stale code structure)
**Impact on plan:** Both fixes were necessary to make the plan's own contract compile/execute correctly against the real, current codebase. No scope creep — behavior matches the plan's intent exactly.

## Issues Encountered

- **Executor's sandbox lacked local Postgres credentials; orchestrator resolved it post-execution.** The executor could not run `tests/billing-unbilled-bookings.test.ts` (Task 2) or the 2 new reconciliation tests in `tests/billing-membership-creation.test.ts` (Task 3) — its shell had no password for the local test DB. The orchestrator found the project's dedicated `randevuclaw-pg` Docker container (port 5433, already migrated with the full schema — distinct from an unrelated project's Postgres container that happens to occupy port 5432 on this machine), started it, retrieved `POSTGRES_PASSWORD` via `docker inspect`, and ran both suites directly against it:
  ```
  BILLING_TEST_DATABASE_URL="postgresql://manolis:password@localhost:5433/randevuclaw_test" npx jest --testPathPattern billing-unbilled-bookings -i
  BILLING_TEST_DATABASE_URL="postgresql://manolis:password@localhost:5433/randevuclaw_test" npx jest --testPathPattern billing-membership-creation -i
  ```
  **Result: 4/4 and 8/8 pass respectively** — including `retroactively deducts one unbilled booking, is idempotent across renewal, and never double-deducts`, which reproduces the exact user-reported scenario (8-session package, 1 pre-existing unbilled booking → `sessionsRemaining` = 7 on creation, unchanged — not re-deducted — on a subsequent renewal). The container was stopped again afterward to leave the environment as found. All DB-independent verification also passed: `npx tsc --noEmit` clean, `tests/booking-enforcement.test.ts` and `tests/billing-payment-flow.test.ts` (24 tests) green.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both billing gaps (silent 'allow'-policy bookings, free retroactive sessions on late membership purchase) are closed at the code level and **fully verified against a real Postgres instance** — all 4 test suites touched by this plan pass (booking-enforcement, billing-payment-flow, billing-unbilled-bookings, billing-membership-creation), plus a clean `tsc --noEmit`.
- No blockers for other in-flight work — all changes are additive/backward-compatible (new optional `conn` parameter defaults to existing behavior; new `retroactiveSessionsDeducted` field is additive to `createMembership`'s return type, and its only other caller was updated in the same plan).

---
*Phase: quick-260813-ji5*
*Completed: 2026-08-13*

## Self-Check: PASSED

All modified/created files confirmed present on disk (src/billing/enforcement.ts, src/billing/queries.ts,
src/telegram/handlers/payment-flow.ts, tests/booking-enforcement.test.ts, tests/billing-unbilled-bookings.test.ts,
tests/billing-membership-creation.test.ts, tests/billing-payment-flow.test.ts). All 4 task commits confirmed
present in git log (c6608b0, bec6292, 608cfbe, 99a762a).
