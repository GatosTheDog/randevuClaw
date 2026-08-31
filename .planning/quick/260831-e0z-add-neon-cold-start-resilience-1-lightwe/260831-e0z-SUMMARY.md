---
phase: quick-260831-e0z
plan: 01
subsystem: database
tags: [neon, postgres, pg, resilience, retry, cold-start, drizzle]

requires:
  - phase: null
    provides: "src/database/db.ts's runInTransaction (query-read-timeout-storm fix) and pool/appPool error listeners (db-idle-transaction-crash fix)"
provides:
  - "Keep-alive poller pinging both pool and appPool with SELECT 1 every ~90s"
  - "isTransientConnectionError + withConnectionRetry narrowly-scoped retry helper for Neon cold-start connection failures"
  - "runInTransaction's bare pool.connect() retried on transient connection errors"
  - "findBusinessByWebhookId and listAllBusinessIds retried on transient connection errors"
affects: [database, scheduler, webhooks]

tech-stack:
  added: []
  patterns: ["setInterval poller guarded by JEST_WORKER_ID (matches startExpiryPoller et al.)", "narrow error-substring + Error.cause-chain classification for transient DB errors", "retry wrapper applied only before any side-effecting work begins"]

key-files:
  created:
    - src/database/keepalive.ts
    - tests/db-keepalive-poller.test.ts
    - tests/db-connection-retry.test.ts
  modified:
    - src/database/db.ts
    - src/database/queries.ts
    - src/server.ts

key-decisions:
  - "Retry wraps ONLY the bare pool.connect() call in runInTransaction, strictly before the transaction callback runs, so a retry can never re-execute a callback with side effects (e.g. Telegram sends)"
  - "isTransientConnectionError matches only the 'Connection terminated' substring (direct message or via Error.cause chain) — narrow, not a generic retry-on-any-error policy"
  - "withConnectionRetry defaults to maxRetries=2 with [300, 800]ms backoff, both overridable, so tests can use near-zero delays without changing production behavior"

requirements-completed: []

coverage:
  - id: D1
    description: "Keep-alive poller pings both pool and appPool with SELECT 1 every ~90s, isolated per-pool, never throws, registered in server.ts's JEST_WORKER_ID-guarded block"
    verification:
      - kind: unit
        ref: "tests/db-keepalive-poller.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "isTransientConnectionError classifies 'Connection terminated' errors (direct and via Error.cause) and rejects unrelated errors; withConnectionRetry bounds retries at maxRetries with backoff, never retries non-transient errors"
    verification:
      - kind: unit
        ref: "tests/db-connection-retry.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "runInTransaction's connection-acquisition step uses withConnectionRetry without disturbing the existing client.release() try/finally guarantee (query-read-timeout-storm fix)"
    verification:
      - kind: unit
        ref: "tests/db-transaction-begin-leak.test.ts"
        status: pass
    human_judgment: false
    rationale: "Orchestrator independently re-ran this suite against a real local Postgres instance (Docker randevuclaw-pg container, port 5433) after executor's sandbox reported it lacked DB access. All 4/4 tests pass, including the 2 live-connection integration tests (happy-path commit/release, in-callback-error rollback/release) that the executor could not verify."
  - id: D4
    description: "The pre-existing checked-out-client error-listener guarantee (db-idle-transaction-crash fix) is unaffected by this plan's changes"
    verification:
      - kind: integration
        ref: "tests/db-checked-out-client-error.test.ts"
        status: pass
    human_judgment: false
    rationale: "Orchestrator independently re-ran this suite against the same real local Postgres instance. Both tests pass, confirming the error-listener guarantee is unaffected by the new connection-retry logic upstream of it."

duration: 23min
completed: 2026-08-31
status: complete
---

# Phase quick-260831-e0z Plan 01: Neon Cold-Start Resilience Summary

**Added a 90-second SELECT-1 keep-alive poller for both Neon pools plus a narrowly-scoped connection-retry helper (2 retries, 300ms/800ms backoff) applied only to runInTransaction's pre-callback pool.connect() and two pure-read query functions, matching today's live production incident.**

## Performance

- **Duration:** 23 min
- **Started:** 2026-08-31T10:16:57+03:00
- **Completed:** 2026-08-31T10:39:47+03:00
- **Tasks:** 3
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- `src/database/keepalive.ts`: `runKeepAlivePing()` pings `pool` and `appPool` with `SELECT 1`, each independently try/catch'd and log-only on failure, never rejects; `startKeepAlivePoller(intervalMs = 90_000)` schedules it, registered in `src/server.ts`'s existing `JEST_WORKER_ID`-guarded poller block.
- `src/database/db.ts`: `isTransientConnectionError` walks the error/cause chain matching the `'Connection terminated'` substring; `withConnectionRetry` retries only that transient class up to `maxRetries` (default 2) with `[300, 800]`ms backoff, rethrowing any other error (or an exhausted-retries transient error) immediately unchanged.
- `runInTransaction`'s first statement changed from `await pool.connect()` to `await withConnectionRetry(() => pool.connect())` — the only change to that function; the existing `try { clientDb.transaction(...) } finally { client.release(...) }` block is untouched.
- `src/database/queries.ts`: `findBusinessByWebhookId` and `listAllBusinessIds` each wrap their existing `db.select(...)` call in `withConnectionRetry(() => ...)`.
- `tests/db-keepalive-poller.test.ts` (5 tests) and `tests/db-connection-retry.test.ts` (11 tests) — all 16 pass.

## Task Commits

Each task was committed atomically:

1. **Task 1: Keep-alive poller for both DB pools** - `da05077` (feat)
2. **Task 2: isTransientConnectionError + withConnectionRetry, applied to runInTransaction's connection step and the two failing read queries** - `b05fe45` (feat)
3. **Task 3: Unit tests for isTransientConnectionError and withConnectionRetry** - `6e3e9e7` (test)

_Plan metadata commit intentionally deferred to the orchestrator per plan constraints (SUMMARY.md/STATE.md are not committed by this executor)._

## Files Created/Modified
- `src/database/keepalive.ts` - New: `runKeepAlivePing`, `startKeepAlivePoller` (Neon cold-start mitigation)
- `src/database/db.ts` - New: `isTransientConnectionError`, `withConnectionRetry`; `runInTransaction`'s `pool.connect()` now retried
- `src/database/queries.ts` - `findBusinessByWebhookId` and `listAllBusinessIds` reads wrapped in `withConnectionRetry`
- `src/server.ts` - `startKeepAlivePoller()` registered as the first call in the `JEST_WORKER_ID`-guarded poller block
- `tests/db-keepalive-poller.test.ts` - New: 5 unit tests for the keep-alive poller
- `tests/db-connection-retry.test.ts` - New: 11 unit tests for `isTransientConnectionError`/`withConnectionRetry`

## Decisions Made
- Retry wraps ONLY the bare `pool.connect()` call in `runInTransaction`, strictly before the transaction callback runs, so a retry can never re-execute a callback that may have already sent a Telegram message or written data (per plan's safety-critical constraint).
- `isTransientConnectionError` matches only the `'Connection terminated'` substring (direct message or via `Error.cause` chain) — a narrow classification, not a generic retry-on-any-error policy, so business-logic errors always propagate immediately with zero retries.
- `withConnectionRetry`'s `maxRetries`/`retryDelaysMs` parameters default to 2/[300, 800] but are overridable, letting `tests/db-connection-retry.test.ts` use near-zero delays without changing production behavior.

## Deviations from Plan

None - plan executed exactly as written. One minor test-authoring adjustment (not a deviation from the plan's substance): `tests/db-connection-retry.test.ts`'s cause-chain test constructs `new Error('outer wrapper')` and assigns `.cause` directly via a typed cast, rather than the ES2022 `Error(message, { cause })` two-argument constructor form, because this project's `tsconfig.json` targets `ES2020`/`lib: ["ES2020"]` and TypeScript's ES2020 lib types don't include that constructor overload (Node itself supports `.cause` at runtime regardless of the `lib` target). Test intent and coverage are identical to what the plan specified.

## Issues Encountered

**Executor's sandbox lacked local Postgres; orchestrator resolved it post-execution.** The executor's sandbox had no live Postgres access, so it could only run the `FakePool`-based tests in `db-transaction-begin-leak.test.ts` and confirmed (via `git stash`) that the 4 live-DB tests failed identically on the pre-plan baseline — ruling out a regression, but leaving D3/D4 unconfirmed for the actual fix.

The orchestrator then independently started the project's dedicated `randevuclaw-pg` Docker container (port 5433, pre-migrated) and re-ran all 4 test files individually (per the user's standing constraint: never batch test files, one `npx jest <file>` invocation at a time):
```
DB_ERROR_TEST_DATABASE_URL="postgresql://manolis:password@localhost:5433/randevuclaw_test" npx jest tests/db-transaction-begin-leak.test.ts
DB_ERROR_TEST_DATABASE_URL="postgresql://manolis:password@localhost:5433/randevuclaw_test" npx jest tests/db-checked-out-client-error.test.ts
npx jest tests/db-connection-retry.test.ts
npx jest tests/db-keepalive-poller.test.ts
```
**Result: 4/4, 2/2, 11/11, 5/5 — all 22 tests pass.** This fully confirms both prior-incident regression guarantees (client-release-on-failed-begin, checked-out-client error isolation) hold with the new retry logic in place. Container stopped afterward to leave the environment as found.

`npx tsc --noEmit` reports zero errors throughout.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Both resilience layers (keep-alive poller, narrowly-scoped connection retry) are live and **fully verified against a real Postgres instance** — all 4 test suites touched by this plan pass (22/22 tests total), plus a clean `tsc --noEmit`.
- No new npm dependency added; `src/session/manager.ts` untouched, as required.

---
*Phase: quick-260831-e0z*
*Completed: 2026-08-31*

## Self-Check: PASSED

All created/modified files found on disk; all 3 task commits (`da05077`, `b05fe45`, `6e3e9e7`) found in git log.
