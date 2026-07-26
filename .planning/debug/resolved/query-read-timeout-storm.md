---
status: resolved
trigger: "Query read timeout storm,"
created: 2026-07-26T00:00:00Z
updated: 2026-07-26T01:00:00Z
resolved: 2026-07-26T01:00:00Z
commit: 766ca99
---

## Current Focus
<!-- OVERWRITE on each update - always reflects NOW -->

reasoning_checkpoint:
  hypothesis: |
    drizzle-orm's NodePgSession.transaction() (node-postgres driver,
    node_modules/drizzle-orm/node-postgres/session.js:180-195) leaks the
    checked-out pool client whenever the initial `begin` statement itself
    rejects (as it does on a query_timeout hit during the storm), because
    that line (184) sits OUTSIDE the try/catch/finally that calls
    `session.client.release()` (192-194). Each such leak permanently
    consumes one slot of appPool's/pool's capacity (default max=10, unset in
    db.ts) since the client is neither idle (no eviction timer) nor ever
    released (can't be reused). This compounds within a burst and across
    incidents (only a full process restart clears it), which is why the
    storm doesn't self-resolve and why nearly every transaction fails once
    a few leaks accumulate — a materially stronger explanation than "Neon
    cold start" alone (which is a real, contributing trigger for the
    INITIAL begin-timeout, but doesn't by itself explain the non-recovery).
  confirming_evidence:
    - "Direct source read: node_modules/drizzle-orm/node-postgres/session.js
      lines 180-195 — `await tx.execute(begin)` at line 184 is before the
      `try` at line 185; `finally { session.client.release() }` (192-194)
      never runs if line 184 itself throws."
    - "Deterministic script (no live-timing dependency): db.transaction()
      against a FakePool (real `pg.Pool` subclass) whose checked-out
      FakeClient.query() rejects for the literal 'begin' statement text —
      FakeClient.release() confirmed NEVER called (client.released stayed
      false) after the transaction rejected."
    - "Second script proves the fix pattern: manually `pool.connect()`,
      wrap ONLY that client with `drizzle(client, {schema})` (a supported
      NodePgClient type per session.d.ts: Pool | PoolClient | Client), and
      guarantee release via our OWN outer try/finally — release fires even
      when 'begin' itself throws (isPool becomes false inside drizzle, so
      drizzle's own internal release attempt is skipped entirely, and ours
      is the only one that runs)."
    - "Verified against the REAL local Postgres test DB (not just fakes):
      happy-path transaction and an in-callback business-logic-error path
      both leave pool.totalCount/idleCount clean with the wrapped pattern
      (no hang, no leak, pool endable cleanly)."
    - "grep confirmed exactly 3 call sites use db.transaction()/
      appDb.transaction() directly: src/database/queries.ts:112
      (withBusinessContext, the hot path exposed to this incident),
      src/billing/queries.ts:325 (createMembership),
      src/session/slotless-requests.ts:97 (approveSlotlessRequest) — all
      three share the identical leak exposure."
  falsification_test: |
    If db.transaction()'s checked-out client's .release() WAS called even
    when the initial 'begin' execute rejects, this hypothesis is wrong.
    Directly falsifiable by source read (confirmed) and by the deterministic
    FakePool script (confirmed: released stayed false, not true).
  fix_rationale: |
    Add a `runInTransaction(pool, callback)` helper (src/database/db.ts)
    that checks out a client itself, wraps ONLY that client with
    `drizzle(client, {schema})`, and guarantees release in our own
    try/finally regardless of what drizzle's internal transaction() does or
    when it throws. This addresses the root cause directly (the leak
    mechanism itself, for ANY transient begin/rollback/commit failure — not
    just Neon-cold-start-triggered ones) rather than a symptom (e.g. merely
    raising query_timeout, which would reduce frequency but not close the
    actual resource leak, or restructuring withBusinessContext to avoid
    holding the transaction over Gemini, which addresses a DIFFERENT window
    — the idle-in-transaction crash already fixed in 2b70a74 — not this
    begin-time leak). Applying it to all 3 call sites (not just the hot
    path) closes the same gap everywhere it exists, per one-fix-for-one-
    root-cause rather than three separate patches.
  blind_spots: |
    Have not deployed+observed a live post-fix recurrence of the exact
    idle-gap-then-burst scenario in production (session working from
    documented incident evidence, not an active fire, per orchestrator
    framing — user confirmed no live reproduction available right now).
    The Neon-cold-start contribution to the FIRST begin-timeout in a burst
    is not eliminated by this fix (a fresh connection's first BEGIN can
    still legitimately take a few seconds during a genuine compute wake) —
    this fix specifically closes the LEAK that turns "one slow begin" into
    "permanently reduced pool capacity forever after," which is the part
    that made the storm compound and never self-heal. Have not implemented
    Neon dashboard/autoscaling-history checks (follow-up (a) from the prior
    session) — deprioritized since the leak mechanism fully explains the
    non-self-resolving severity without needing to inspect Neon's own
    infrastructure config.

next_action: |
  RESOLVED. Human checkpoint accepted the self-verified evidence (deterministic
  FakePool repro, real-Postgres pool-state tests, tsc clean, full jest A/B with
  zero regressions) without requiring a live production re-verification, given
  no live fire was reproducible at checkpoint time. Fix committed as 766ca99.
  Session archived to .planning/debug/resolved/query-read-timeout-storm.md.

## Symptoms
<!-- Written during gathering, then immutable -->

expected: DB transactions inside withBusinessContext (src/database/queries.ts)
  complete normally regardless of how long the DB connection pool has been
  idle beforehand.
actual: After a DB idle gap (>1hr observed), nearly every withBusinessContext
  transaction (BEGIN/ROLLBACK) fails with DrizzleQueryError "Query read
  timeout" (~12000ms, matching query_timeout config, or ~24000ms when a
  rollback retry also times out). Non-fatal (caught by client-side
  query_timeout, no process crash since 2b70a74) but represents real
  functional failures — onboarding/booking writes fail almost every attempt
  during the storm window.
errors: |
  DrizzleQueryError "Query read timeout" on 'begin' or 'rollback' statements,
  ~12000ms (matches query_timeout:12000 config) or ~24000ms (~2x, when a
  rollback retry also times out).
timeline: |
  Documented incident: 2026-07-25T17:58:18Z-18:02:00Z (initial storm, 9+
  Telegram updateIds over ~8 min, no self-resolving), recurred again
  2026-07-25T18:46:30Z-18:47:09Z (post-fix live verification of the
  separate crash fix — storm recurred unchanged, confirming it is a
  distinct, still-open issue). Both preceded by long DB-idle gaps (first
  occurrence: >1hr idle, last DB-touching log line 16:42:32Z same day).
  No fresh recurrence reported since; user is following up on this
  documented incident, not an active live storm.
reproduction: |
  Not yet deliberately reproduced in this session. Suspected trigger (from
  prior session): leave the app/DB idle for >15 minutes (matches
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS=15000, plausibly also a Neon
  compute-suspend interval), then send a real Telegram message that
  triggers a withBusinessContext transaction. Both documented occurrences
  followed exactly this pattern.

## Eliminated
<!-- APPEND only - prevents re-investigating after /clear -->

- hypothesis: "The storm is caused by the same missing-error-listener gap
    that caused the fatal crash."
  test: "Fixed in commit 2b70a74 (src/database/db.ts, pool 'connect'-time
    error listener). Live production verification (2026-07-25T18:46:30Z-
    18:47:09Z) showed the crash stopped recurring, but the SAME
    DrizzleQueryError 'Query read timeout' storm on begin/rollback recurred
    unchanged in that same verification window."
  result: "Eliminated as the (sole) cause of the storm. The listener fix
    resolves the fatal crash pathway only; the storm is a separate,
    still-unexplained manifestation — most likely stale/invalidated pooled
    connections surviving a Neon compute-suspend or long idle gap (flagged,
    not yet confirmed root cause)."

## Evidence
<!-- APPEND only - facts discovered during investigation -->

- timestamp: 2026-07-25T17:58:18Z through 2026-07-25T18:02:00Z
  checked: "fly logs --no-tail --app randevuclaw (from prior session)"
  found: "Nearly every withBusinessContext transaction across 9+ flushed
    updateIds (715645411-715645420) failed with DrizzleQueryError 'Query
    read timeout' on 'begin' or 'rollback', elapsed ~12000ms or ~24000ms.
    Immediately preceded by a >1hr DB-idle gap (last prior DB-touching log
    line 16:42:32Z)."
  implication: "Consistent with serverless-Postgres compute-suspend / stale
    pooled-connection failure after a long idle period; client-side
    query_timeout catches it (no crash), but real functionality fails
    almost every attempt during the storm window."

- timestamp: 2026-07-25T18:46:30Z through 2026-07-25T18:47:09Z
  checked: "Live production verification after deploying 2b70a74 (fly
    deploy, v21, machine 8dd333ae114ee8), fly logs --no-tail + fly status
    (from prior session)"
  found: "Same non-fatal 'Query read timeout' DrizzleQueryError storm on
    begin/rollback (~12s/~24s elapsed) recurred, matching the pre-existing
    pattern exactly — but this time the process did NOT crash (same pid
    642, same machine, no restart, subsequent tool calls succeeded)."
  implication: "Confirms the storm is a distinct, still-open issue from the
    crash — the crash fix (checked-out-client error listener) does not
    address whatever is causing begin/rollback to time out client-side in
    the first place."

- timestamp: 2026-07-26 (this session, re-confirming code shape)
  checked: "src/database/db.ts and src/webhooks/telegram.ts against commit
    2b70a74 (HEAD) — diffed for any change since the prior session."
  found: "Unchanged. pool/appPool still default idleTimeoutMillis (pg-pool
    default 10000ms) and default max (pg-pool default 10). withBusinessContext
    (queries.ts:98-135) still wraps the ENTIRE conversation-handling callback
    (handleFoundBusiness/aiOwnerAgent/aiOnboardingAgent, incl. the Gemini
    round-trip) inside appDb.transaction()."
  implication: "Confirmed pg-pool's default idleTimeoutMillis=10000 means any
    pool client sitting idle for >10s is actively evicted/disconnected
    (node_modules/pg-pool/index.js _release() schedules this on every
    check-in when _isAboveMin(), and min defaults to 0). After a >1hr idle
    gap, NO stale pooled client could physically survive to be handed out —
    ruling out 'reused literal stale socket from before the gap' as the
    direct mechanism, and redirecting toward: (a) fresh connections
    succeeding fast but the first query on them stalling (cold-start-style
    latency), and/or (b) something making the pool itself misbehave after a
    failure (checked next)."

- timestamp: 2026-07-26 (this session)
  checked: "node_modules/pg/lib/client.js Client.prototype.query() (lines
    626-690): confirmed the client-side `query_timeout` readTimeoutTimer is
    armed at the moment `client.query()` is called on an ALREADY-CONNECTED
    client (i.e., strictly after pool.connect()'s callback/promise already
    resolved, which itself is bounded separately by connectionTimeoutMillis
    on the Pool, not query_timeout)."
  found: "This proves the observed error shape (DrizzleQueryError wrapping
    'Query read timeout' on the LITERAL 'begin'/'rollback' statement text,
    at ~12000ms matching DB_QUERY_TIMEOUT_MS) means: the physical
    connection+auth handshake to Postgres already SUCCEEDED (within the
    5000ms connectionTimeoutMillis budget, or reused a genuinely-idle pool
    client) — it is specifically the round-trip for the BEGIN (or ROLLBACK)
    statement itself that then stalls for >12000ms with no response."
  implication: "Consistent with Neon's connection-proxy/PgBouncer-style
    architecture (also flagged pre-emptively in
    .planning/research/PITFALLS.md:269, 'Neon serverless DB might have
    delayed query responses during cold starts'): the frontend TCP+auth
    handshake can complete fast via the proxy without needing the actual
    suspended compute to be awake yet, deferring the real compute-wake cost
    to the FIRST QUERY sent on that session — exactly BEGIN, exactly
    matching every observed detail. Supports hypothesis (a) as a real,
    contributing trigger, but does not by itself explain why the storm
    fails to self-resolve once the compute finishes waking (see next
    finding, which is the more complete/severe explanation)."

- timestamp: 2026-07-26 (this session) — ROOT CAUSE CONFIRMED
  checked: "node_modules/drizzle-orm/node-postgres/session.js
    NodePgSession.prototype.transaction() (lines 180-195), read directly,
    then proven empirically with two deterministic Node scripts (no live DB
    timing dependency): (1) a real drizzle db.transaction() against a
    FakePool subclassing pg.Pool whose checked-out FakeClient's query()
    rejects with 'Query read timeout' for the literal 'begin' statement
    text — asserting whether FakeClient.release() is ever called; (2) the
    exact same test using drizzle(client) with a manually-checked-out
    client + our OWN outer try/finally, to prove a fix pattern."
  found: "`await tx.execute(sql\`begin...\`)` (line 184) sits OUTSIDE the
    surrounding try/catch/finally block (try starts at line 185, finally at
    192 does `session.client.release()`). When this specific line throws
    (exactly our observed 'begin' timeout), the whole async function
    rejects immediately WITHOUT ever reaching the finally block — the
    checked-out pool client's `.release()` is NEVER called. Script 1
    confirmed this directly: FakeClient.released remained `false` after the
    transaction rejected with 'Failed query: begin'. (By contrast, when
    'rollback' itself times out — i.e. begin succeeded, the callback body
    threw, and the catch block's `tx.execute(rollback)` also rejects — that
    happens INSIDE the try/catch, so `finally` still runs and the client IS
    released; only the bare 'begin'-timeout case leaks.) Script 2 confirmed
    that checking out the client ourselves via `pool.connect()`, wrapping
    ONLY that client instance with `drizzle(client, {schema})` (not the
    pool), and guaranteeing release via our OWN outer try/finally closes the
    leak completely — release fires even when 'begin' itself throws.
    Verified against the REAL local Postgres test DB too (not just fakes):
    happy path and an in-callback business-logic-error path both left
    pool.totalCount/idleCount clean (0 or fully idle) with the wrapped
    pattern."
  implication: "This is the actual root cause of the storm's severity and
    non-self-resolving character: every 'begin'-timeout failure permanently
    leaks ONE checked-out client out of appPool's capacity (default max=10,
    unset in db.ts) — it is neither idle (so eviction never fires) nor ever
    released (so it can never be reused). This compounds WITHIN one burst
    (as documented: ~9-10 failing updateIds during the incident, plausibly
    approaching/exhausting appPool's default max=10) and ACROSS incidents
    over the app's lifetime (nothing but a full process restart/crash clears
    leaked clients — explaining why the app seemed to 'need' the earlier
    crash-and-reboot to recover). This is a materially stronger and more
    complete explanation than 'Neon cold start alone' (prior finding): it
    explains both WHY nearly every transaction in the burst fails (pool
    capacity shrinks with each failure, cascading) and WHY the storm doesn't
    self-heal once the compute should already be awake. It also means this
    isn't Neon-specific or idle-gap-specific — ANY transient 'begin' failure
    for ANY reason (brief network blip, etc.) permanently costs one pool
    slot, on any of the THREE call sites in this codebase that call
    `db.transaction()`/`appDb.transaction()` directly (grep confirmed):
    src/database/queries.ts:112 (withBusinessContext/appDb, the hot path
    exposed to this incident), src/billing/queries.ts:325
    (createMembership/db), src/session/slotless-requests.ts:97
    (approveSlotlessRequest/db)."

- timestamp: 2026-07-26 (this session) — fix verification
  checked: "tests/db-transaction-begin-leak.test.ts (new, 4 tests); npx tsc
    --noEmit; full npx jest suite, A/B compared via git stash (baseline
    HEAD vs this session's working tree)."
  found: "New test suite: 4/4 pass, including 2 against the real local
    Postgres test DB (happy path + in-callback-error path), both leaving
    pool.totalCount === pool.idleCount afterward (no leak). tsc: zero
    errors. Full suite: baseline 33 suites failed/25 passed (81 tests
    failed/239 passed, 320 total) vs after-fix 32 suites failed/26 passed
    (81 tests failed/243 passed, 324 total) — IDENTICAL failed-test count
    (81), zero regressions; the only delta is the new suite (+1 suite, +4
    tests, all passing)."
  implication: "Fix closes the confirmed leak mechanism without
    regressions. Pre-existing ~32 failing suites (local test-DB schema
    drift, stale Business-fixture types) confirmed unrelated via the same
    stash comparison — matches what the earlier resolved
    db-idle-transaction-crash session already documented."

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: |
  drizzle-orm's NodePgSession.transaction() (node-postgres driver,
  node_modules/drizzle-orm/node-postgres/session.js:180-195) checks out a
  pool client via `this.client.connect()`, then does
  `await tx.execute(sql\`begin...\`)` BEFORE entering its own try/finally
  block (try starts the next line; finally at 192-194 calls
  `session.client.release()`). If that initial 'begin' statement itself
  rejects — exactly what happens when the client-side query_timeout fires
  during the storm — the whole transaction() call rejects immediately
  without ever reaching the finally block, so the checked-out client is
  NEVER released back to the pool. This is a permanent leak of one pool
  slot (appPool/pool default max=10, unset in db.ts) per occurrence: the
  client is neither idle (no eviction timer starts) nor released (can't be
  reused). It compounds within a single burst (documented incident: ~9-10
  failing updateIds, plausibly approaching/exhausting default max=10) and
  across incidents over the app's lifetime (only a full process
  restart/crash clears leaked clients). This fully explains both why the
  storm doesn't self-resolve (pool capacity keeps shrinking as more begins
  fail) and why nearly every transaction fails during the storm window —
  independent of, and more complete than, the "Neon cold start" theory,
  which remains a plausible trigger for the very FIRST begin-timeout in a
  burst (Neon's proxy architecture can complete TCP+auth fast while
  deferring compute-wake cost to the first query on the session — see
  Evidence) but does not by itself explain why later requests keep failing
  once compute should already be awake.

  Confirmed empirically (not just by source read): a deterministic Node
  script using a FakePool (real pg.Pool subclass) whose checked-out client's
  query() rejects for the literal 'begin' text shows `.release()` is never
  called. A second script proves the fix (manually check out the client,
  wrap ONLY that client instance with `drizzle(client, {schema})` instead of
  the pool, guarantee release via our OWN outer try/finally) closes the leak
  completely, verified both against fakes and against a real local Postgres
  test DB (happy path and in-callback-error path both leave the pool clean).

  Exactly 3 call sites in this codebase are exposed to this same leak
  (grep-confirmed): src/database/queries.ts:112 (withBusinessContext/
  appDb.transaction, the hot path hit by this incident),
  src/billing/queries.ts:325 (createMembership/db.transaction),
  src/session/slotless-requests.ts:97 (approveSlotlessRequest/
  db.transaction).
fix: |
  Added `runInTransaction<T>(pool, callback)` to src/database/db.ts: checks
  out a client via `pool.connect()` itself, wraps ONLY that client instance
  with `drizzle(client, {schema})` (a PoolClient is a supported NodePgClient
  per drizzle-orm's own node-postgres/session.d.ts: Pool | PoolClient |
  Client — not a hack), and guarantees `client.release(err)` in its OWN
  try/finally around the whole `clientDb.transaction(callback)` call.
  Passing a bare client (not a Pool) makes drizzle's internal `isPool` check
  false, so drizzle's own (leak-prone) checkout/release logic is skipped
  entirely for this call — release is solely our own responsibility and
  fires unconditionally, regardless of whether begin, the callback body,
  commit, or rollback is what throws. Releasing with a truthy error (when
  the transaction rejected) matches pg-pool's own convention: it discards
  the connection rather than returning a possibly protocol-broken client to
  the idle queue.

  Swapped all 3 exposed call sites to use it instead of calling
  `db.transaction()`/`appDb.transaction()` directly (same tx-callback
  shape, zero changes needed to any callback body):
  - src/database/queries.ts: withBusinessContext now calls
    `runInTransaction(appPool, ...)` instead of `appDb.transaction(...)`.
  - src/billing/queries.ts: createMembership now calls
    `runInTransaction(pool, ...)` instead of `db.transaction(...)`.
  - src/session/slotless-requests.ts: approveSlotlessRequest now calls
    `runInTransaction(pool, ...)` instead of `db.transaction(...)`.
verification: |
  1. Wrote tests/db-transaction-begin-leak.test.ts with 4 tests:
     (a) DOCUMENTS the bug: a deterministic FakePool (subclasses the real
         pg.Pool so drizzle-orm's own `instanceof Pool` check recognizes
         it) whose checked-out client's query() always rejects for the
         literal 'begin' text, run through plain `drizzle(pool).transaction()`
         — confirms `.release()` is NEVER called (client.released === false).
     (b) FIX: the same FakePool run through `runInTransaction()` instead —
         confirms `.release()` IS called (client.released === true), with a
         truthy error argument.
     (c) Happy path against the REAL local Postgres test DB
         (postgresql://manolis@localhost:5432/randevuclaw_test): a trivial
         `runInTransaction(pool, tx => tx.execute('select 1 as one'))`
         commits successfully; pool.idleCount === pool.totalCount
         afterward (client properly returned to idle, no leak).
     (d) In-callback-error path against the same real Postgres test DB:
         callback throws after a successful begin; confirms proper
         rollback + release (pool.totalCount === pool.idleCount afterward,
         i.e. no dangling checked-out client).
     All 4 pass.
  2. `npx tsc --noEmit`: zero errors across the whole project after the
     change (one generic-inference cast needed inside runInTransaction
     itself, documented inline as a structural TS artifact, not a type
     safety gap — the exported function's own signature is fully
     type-checked at every call site).
  3. Full `npx jest` suite, A/B compared via git stash:
     - Baseline (HEAD, stashed): 33 suites failed / 25 passed (58 total),
       81 tests failed / 239 passed (320 total).
     - After this fix: 32 suites failed / 26 passed (58 total), 81 tests
       failed / 243 passed (324 total).
     IDENTICAL failed-test count (81) before and after — zero regressions.
     The only deltas are the new db-transaction-begin-leak.test.ts suite
     (+1 suite, +4 tests, all passing). The pre-existing ~32 failing suites
     (local test-DB schema drift, e.g. "column booking_mode of relation
     businesses does not exist" from missing migrations 0006+ on the local
     randevuclaw_test DB, plus stale Business-fixture types) are confirmed
     via this same stash comparison to be pre-existing and unrelated —
     already documented in the earlier resolved db-idle-transaction-crash
     session, not touched or worsened by this fix.
  HUMAN CHECKPOINT (2026-07-26): user accepted the self-verified evidence
  above and explicitly declined a live production re-verification, since no
  live fire is currently reproducible (this session investigated a
  documented past incident, not an active one, per the original task
  framing). Fix committed as 766ca99.
files_changed:
  - src/database/db.ts (added exported runInTransaction<T>(pool, callback)
    helper closing the checked-out-client leak on a failed initial 'begin')
  - src/database/queries.ts (withBusinessContext now uses
    runInTransaction(appPool, ...) instead of appDb.transaction(...))
  - src/billing/queries.ts (createMembership now uses
    runInTransaction(pool, ...) instead of db.transaction(...))
  - src/session/slotless-requests.ts (approveSlotlessRequest now uses
    runInTransaction(pool, ...) instead of db.transaction(...))
  - tests/db-transaction-begin-leak.test.ts (new regression test proving
    the exact leak mechanism and the fix)
