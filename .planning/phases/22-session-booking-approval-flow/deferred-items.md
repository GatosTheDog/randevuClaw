# Deferred Items — Phase 22 Plan 01

Out-of-scope pre-existing issues discovered during execution (SCOPE BOUNDARY rule:
only auto-fix issues directly caused by this plan's changes). Confirmed pre-existing
via `git stash` baseline check (before any Plan 01 edits) reproducing identically.

## 1. No local Postgres test DB available in this execution environment

`tests/session-booking-flow.test.ts`, `tests/session-assignment.test.ts`,
`tests/cancellation-cutoff.test.ts`, and the new `tests/session/session-approval.test.ts`
(added by Task 3) all connect to a real local Postgres instance at
`postgresql://manolis@localhost:5432/randevuclaw_test` (or `SESSION_TEST_DATABASE_URL`/
`BILLING_TEST_DATABASE_URL` env override). No Postgres server is reachable on port 5432
in this sandbox (`psql` is not installed; a direct `pg` connection attempt fails).
These suites cannot execute to completion here regardless of code correctness.
Re-run `npx jest --testPathPattern="(session-booking-flow|session-assignment|expiry-poller|session-approval)" --maxWorkers=1`
on a machine with the local test DB provisioned (see each file's header comment for
one-time setup instructions) to get a real pass/fail signal.

## 2. Pre-existing TS6200 identifier conflict when session-booking-flow + session-assignment run together

`tests/session-booking-flow.test.ts` and `tests/session-assignment.test.ts` both declare
top-level `const` bindings (TEST_DATABASE_URL, db, eq, sessionInstances, sessionCatalog,
bookings, services, bookSessionInstance, insertTestBusiness, insertTestSessionCatalog,
insertTestSessionInstance) with no top-level `import`/`export`, so ts-jest's type-checker
treats each as a global script. When both files match the same `--testPathPattern` run,
TypeScript raises `TS6200: Definitions of the following identifiers conflict with those
in another file`. Reproduced on the pre-Plan-01 baseline (via a git stash of Plan 01's
own edits) — not introduced by this plan. Fix would require adding an `export {}` or a
real top-level `import` to each file to force module scope; out of scope for this plan
per SCOPE BOUNDARY (files not in this plan's `files_modified` list).

## 3. Pre-existing stale Business/Booking test fixtures in tests/expiry-poller.test.ts

`OWNER_BUSINESS_1` (used across all 7 `runExpirySweep` tests) and `makeExpiredBooking()`'s
default object are missing fields added to the `Business`/`Booking` interfaces in later
phases (`bookingMode`, `allowMultiBooking`, `cancellationCutoffEnabled`,
`cancellationCutoffHours`, and others for Business; `sessionInstanceId` was already
present but typed as required `number | null` while the fixture omits it, producing an
`undefined` mismatch). This causes `TS2322`/`TS2345` compile errors that block the whole
suite. Reproduced identically on the pre-Plan-01 baseline (git stash check) — not
introduced by Task 1's edits to `expiry-poller.ts` (confirmed via `git diff
src/database/queries.ts` showing zero changes to the `Business`/`Booking` interfaces).
Fixing the fixtures to include the missing fields is out of scope for this plan (the
fixtures predate Phase 22 and are shared test infrastructure, not a Phase 22 deliverable).

**Verification performed instead:** `npx tsc --noEmit -p tsconfig.json` shows zero type
errors attributable to `src/session/manager.ts` or `src/conversation/expiry-poller.ts`
(the two files Task 1 modifies) — confirming Task 1's own code is type-correct even
though the pre-existing test fixture gaps prevent the test file from compiling.
