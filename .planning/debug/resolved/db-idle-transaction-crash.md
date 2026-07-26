---
status: resolved
trigger: "DB crash issue — Node process crashes on Postgres idle-in-transaction timeout after DB idle period, following up on CYCLE 4 CANDIDATE flagged in .planning/debug/resolved/webhook-hang-no-reply.md (or .planning/debug/webhook-hang-no-reply.md if not yet resolved)"
created: 2026-07-25T18:10:00Z
updated: 2026-07-25T18:50:00Z
resolved: 2026-07-25T18:50:00Z
commit: 2b70a74fb37106c1a78f86ab3aa4e1696ae9eea9
---

## Current Focus
<!-- OVERWRITE on each update - always reflects NOW -->

reasoning_checkpoint:
  hypothesis: |
    Node crashes because pg-pool's checked-out clients have NO 'error'
    listener attached. pg-pool (node_modules/pg-pool/index.js) creates one
    internal 'idleListener' per client and only keeps it attached while the
    client sits IDLE in the pool: `_acquireClient()` (line 344) does
    `client.removeListener('error', idleListener)` on every checkout, and
    `_release()` (line 385) re-adds it on check-in. drizzle-orm's
    node-postgres session.transaction() (node_modules/drizzle-orm/node-postgres/session.js:180-195)
    calls `this.client.connect()` (Pool#connect, a checkout) to run
    BEGIN/callback/COMMIT-ROLLBACK, then `client.release()` — it never
    attaches its own 'error' listener to the acquired client, and neither
    does our app code (db.ts only has `pool.on('error', ...)` /
    `appPool.on('error', ...)`, which is the POOL-level event fired only via
    the idleListener path, i.e. only for idle clients). So for the entire
    window a transaction is open (including while `callback()` awaits an
    external Gemini call, per src/webhooks/telegram.ts:838 wrapping
    handleFoundBusiness/aiOwnerAgent/aiOnboardingAgent inside
    withBusinessContext), the checked-out client has zero 'error' listeners.
    When Postgres asynchronously terminates that connection
    (idle_in_transaction_session_timeout, 15000ms, matches
    DB_IDLE_IN_TRANSACTION_TIMEOUT_MS in db.ts), pg's Client._handleErrorEvent
    (node_modules/pg/lib/client.js:411-418) first rejects any active/queued
    query (`_errorAllQueries`), THEN does `this.emit('error', err)`. With zero
    listeners, Node's EventEmitter throws synchronously inside that emit —
    an uncaught exception outside any promise chain, invisible to our
    try/catch in withBusinessContext/telegram.ts, crashing the process.
    This also explains why the "storm" of non-crashing DrizzleQueryError
    'Query read timeout' entries (on begin/rollback, ~12000ms) is a
    DIFFERENT, non-fatal manifestation of the same underlying condition
    (round-trip timing out client-side because a query WAS in flight when the
    stall/termination happened, so the promise rejects normally instead of
    hitting the zero-listener throw) — compounding hypothesis 1 (stale
    pooled connections after a long DB-idle/Neon-suspend gap) is not ruled
    out as a contributing trigger for those, but is NOT required to explain
    the fatal crash itself, which is fully and independently explained by
    hypothesis 2 (the listener gap) alone.
  confirming_evidence:
    - "Direct source read: node_modules/pg-pool/index.js _acquireClient() line 344 removes the client's only 'error' listener (idleListener) at checkout time; _release() (line 385) is the only place it's re-added, on check-in. Nothing else attaches a listener to a checked-out client."
    - "Direct source read: node_modules/drizzle-orm/node-postgres/session.js transaction() (lines 180-195) checks out a client via this.client.connect(), runs begin/callback/commit-rollback via tx.execute()/client.query(), and calls session.client.release() in `finally` — no error listener is ever attached to the checked-out client by drizzle."
    - "Direct source read: src/database/db.ts only registers pool.on('error', ...) / appPool.on('error', ...) at the Pool level, which (per pg-pool internals above) only fires via the idle-client path — confirmed by prior evidence entry (2026-07-25T18:04:14Z) showing the crash's error was emitted directly on the raw pg Client (Client._handleErrorEvent), NOT routed through Pool's error handling."
    - "Direct source read: node_modules/pg/lib/client.js _handleErrorEvent (line 411) calls this.emit('error', err) unconditionally after _errorAllQueries(err) — Node's EventEmitter throws synchronously when an 'error' event has zero listeners, matching the observed crash signature 'node:events:502 Unhandled error event' wrapping Postgres code 25P03 (idle_in_transaction_session_timeout)."
    - "Direct source read: src/webhooks/telegram.ts line 838 (`await withBusinessContext(business.id, async () => { ... await handleFoundBusiness(...) ... })`, line 943) confirms the Gemini-calling business logic runs INSIDE the open transaction, giving a real window (Gemini round-trip can take several seconds, per prior webhook-hang-no-reply debug cycle raising Gemini timeouts to 25s) for the transaction to sit idle-in-transaction long enough to hit the 15000ms server-side timeout while no query is in flight to catch the rejection."
  falsification_test: |
    If a checked-out pg Pool client with NO additional listener attached
    receives a manually-emitted 'error' event (simulating what
    Client._handleErrorEvent does), the emit() call throws synchronously
    (proven via a direct unit test against the real pool/appPool from
    src/database/db.ts, no live idle_in_transaction_session_timeout needed).
    If instead the emit does NOT throw with no fix applied, this hypothesis
    is wrong and the crash must come from elsewhere.
  fix_rationale: |
    Attach a listener to each client's 'error' event exactly once, at
    physical-connection time (Pool's 'connect' event, fired once per new
    client — pg-pool: `if (isNew) { this.emit('connect', client) }` in
    _acquireClient), rather than relying on pool-level 'error' (idle-only).
    Because pg-pool's checkout/checkin logic only ever adds/removes ITS OWN
    idleListener function reference via removeListener, a separate listener
    we attach via 'connect' is never removed — it persists across every
    future checkout for that client's lifetime, closing the exact gap
    without needing to fork/wrap drizzle's session.transaction() or touch
    every .transaction()/getConn() call site. This addresses the root cause
    (missing listener during checkout) rather than a symptom (e.g. suppressing
    the crash with a global process.on('uncaughtException'), which would mask
    unrelated future bugs and is explicitly avoided).
  blind_spots: |
    Have not verified against a live Neon instance whether compute-suspend
    (hypothesis 1) is ALSO occurring and contributing to the DrizzleQueryError
    storm — this fix does not address stale-connection staleness after long
    idle gaps (a client could still hand back a broken connection from the
    pool and time out at query_timeout; that's a recoverable, already-handled
    path, not a crash, so out of scope for this fix but flagged as a residual
    reliability concern). Also have not restructured withBusinessContext call
    sites to stop holding a DB transaction open across the Gemini network
    call (a structural/architectural improvement, not required to stop the
    crash, and out of scope for a minimal fix — flagged for follow-up).

next_action: |
  DONE. Fix committed (2b70a74) and deployed to production (fly.io app
  randevuclaw, v21, machine 8dd333ae114ee8). Live production verification
  confirmed: a real idle-then-burst cycle recurred (18:46:30Z-18:47:09Z,
  same "Query read timeout" DrizzleQueryError storm on begin/rollback as
  before) but the process did NOT crash this time — same pid (642), same
  machine, no restart/reboot, subsequent tool calls succeeded normally.
  Session archived to resolved/.

  RESIDUAL OPEN ISSUE (flagged, not fixed by this session, out of scope):
  Hypothesis 1 (stale/invalidated pooled connections after a long DB-idle
  gap, possibly Neon compute-suspend related) is CONFIRMED to still occur —
  the "Query read timeout" storm on begin/rollback recurred in production
  post-fix, unchanged. It is non-fatal (caught by client-side query_timeout,
  no crash) but represents real functional failures (onboarding/booking
  writes failing almost every attempt during the storm window). A follow-up
  debug/fix session should investigate: (a) Neon compute-suspend/autoscaling
  behavior around long idle gaps, (b) whether pg Pool needs a connection
  validation/ping-before-use step, (c) whether withBusinessContext should
  stop holding a DB transaction open across the Gemini network call
  (structural fix, also flagged in blind_spots above).

## Symptoms
<!-- Written during gathering, then immutable -->

expected: DB queries/transactions inside withBusinessContext (src/database/queries.ts) complete normally under all connection states, and the Node process never crashes on a Postgres-side connection termination.
actual: After a DB idle gap (>1hr observed), nearly every withBusinessContext transaction (BEGIN/ROLLBACK) fails with DrizzleQueryError "Query read timeout" (~12000ms, matching query_timeout config, or ~24000ms when a rollback retry also times out). This recurred across at least 9 independent Telegram updateIds over ~8 minutes with no sign of self-resolving, then escalated to a full unhandled process crash.
errors: |
  Repeated: DrizzleQueryError "Query read timeout" on 'begin' or 'rollback' statements.
  Crash: node:events:502 "Uncaught, unspecified 'error' event" wrapping Postgres
  error code 25P03 ("terminating connection due to idle-in-transaction timeout"),
  emitted on a raw pg Client instance (Client._handleErrorEvent) — NOT routed
  through Pool's error handling. Process exited ("Main child exited normally
  with code: 1"), fly.io machine rebooted (~13s downtime).
timeline: |
  First observed 2026-07-25T17:58:18Z (during unrelated webhook-registration
  fix verification, immediately after a queued Telegram update backlog began
  draining). Storm continued ~8 min without self-resolving. Escalated to full
  process crash at 2026-07-25T18:04:14Z, machine rebooted ~18:04:27Z. Preceded
  by a >1hr DB-idle gap (last prior DB-touching log line: 16:42:32Z same day).
  This is a NEW/DISTINCT issue discovered mid-verification of an unrelated fix
  (Telegram webhook re-registration) — not previously reported by the user
  directly.
reproduction: |
  Not yet deliberately reproduced. Suspected trigger: leave the app/DB idle
  for >15 minutes (matches DB_IDLE_IN_TRANSACTION_TIMEOUT_MS=15000 and
  plausibly a Neon compute-suspend interval), then send a real message that
  triggers a withBusinessContext transaction (any client or owner Telegram
  message). Prior occurrence followed exactly this pattern (>1hr idle, then
  a burst of queued messages).

## Eliminated
<!-- APPEND only - prevents re-investigating after /clear -->

- hypothesis: "Root cause is the same as the prior webhook-registration issue (stale Telegram webhook URL) or the earlier Gemini-timeout/client-swallow issues."
  test: "This DB timeout/crash storm was observed AFTER the webhook re-registration fix was already confirmed working (Telegram delivering correctly, app processing updates) — the failures are inside withBusinessContext's DB transaction, unrelated to webhook delivery or Gemini calls."
  result: "Eliminated as the same root cause. This is a materially different failure class: DB connection lifecycle, confirmed via direct fly logs showing DrizzleQueryError and a raw pg Client error event, not a webhook-routing or Gemini-timeout symptom."

## Evidence
<!-- APPEND only - facts discovered during investigation -->

- timestamp: 2026-07-25T17:58:18Z through 2026-07-25T18:02:00Z
  checked: "fly logs --no-tail --app randevuclaw, observed while verifying an unrelated fix"
  found: "Nearly every withBusinessContext transaction across 9+ flushed updateIds (715645411-715645420) failed with DrizzleQueryError 'Query read timeout' on 'begin' or 'rollback', elapsed ~12000ms or ~24000ms. Immediately preceded by a >1hr DB-idle gap (last prior DB-touching log line 16:42:32Z)."
  implication: "Consistent with serverless-Postgres compute-suspend / stale pooled-connection failure after a long idle period; app's defensive query_timeout (added in a prior debug cycle) is catching it, but real functionality (onboarding tool execution, business data writes) fails almost every attempt."

- timestamp: 2026-07-25T18:04:14Z
  checked: "fly logs --no-tail, continued monitoring"
  found: "Node crashed outright: 'node:events:502 throw er; // Unhandled error event', underlying Postgres error 'terminating connection due to idle-in-transaction timeout' (code 25P03), emitted directly on a raw pg Client instance (Client._handleErrorEvent), NOT routed through Pool's error handling. Process exited (code 1), fly.io machine rebooted (~13s downtime, 18:04:14 to 18:04:27)."
  implication: "pg Pool's `.on('error')` handler (present in src/database/db.ts:38 and :61) only covers clients sitting IDLE in the pool — it does not cover a client actively checked out mid-transaction when Postgres asynchronously terminates that connection out-of-band. Root gap identified by direct code read; needs an error listener attached for the lifetime of each checkout, not just at Pool level."

- timestamp: 2026-07-25T18:46:30Z through 2026-07-25T18:47:09Z
  checked: "Live production verification after deploying the fix. Committed fix as 2b70a74, ran `fly deploy --app randevuclaw` (deployed as v21, machine 8dd333ae114ee8, healthy 1/1 checks), then pulled `fly logs --no-tail` and `fly status` following a real DB-idle gap and subsequent Telegram message burst."
  found: "Same non-fatal 'Query read timeout' DrizzleQueryError storm on begin/rollback (~12s/~24s elapsed) recurred multiple times, matching the pre-existing hypothesis-1 pattern exactly. Critically, the process did NOT crash: same pid (642), same machine (8dd333ae114ee8), no restart/reboot in `fly status` (still v21, started, checks passing) or logs; a second `fly logs` pull showed continuous pid=642 activity straight through the storm and afterward, with subsequent set_business_hours tool calls succeeding normally."
  implication: "Live production confirmation that the specific fatal crash (uncaught 'error' event on a checked-out client during idle_in_transaction_session_timeout) is fixed by the pool 'connect'-listener change. The separate, non-fatal stale-connection/Query-read-timeout storm (hypothesis 1) is confirmed to still occur and remains an open, flagged follow-up — out of scope for this session per its original root-cause scoping (crash only, not the broader connection-reliability storm)."

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: |
  pg-pool (node_modules/pg-pool/index.js) removes its own internal 'error'
  listener (idleListener) from a client the instant it's checked out
  (_acquireClient, line 344: `client.removeListener('error', idleListener)`)
  and only re-attaches it on check-in (_release, line 385). drizzle-orm's
  node-postgres session.transaction() (used by both appDb.transaction() in
  withBusinessContext, and db.transaction() elsewhere) checks out a client via
  `pool.connect()` to run BEGIN / callback / COMMIT-ROLLBACK, then releases
  it — it never attaches an 'error' listener of its own to that checked-out
  client, and neither did our app code (src/database/db.ts only had
  `pool.on('error', ...)`/`appPool.on('error', ...)`, which — per pg-pool's
  internals — only ever fires via the idle-client path, never for a
  checked-out client).

  src/webhooks/telegram.ts runs the entire conversation-handling callback
  (handleFoundBusiness -> aiOwnerAgent/aiOnboardingAgent -> Gemini calls)
  INSIDE the open withBusinessContext transaction, so a checked-out appPool
  client can sit idle-in-transaction for several seconds while awaiting a
  Gemini round trip. When that window exceeds
  idle_in_transaction_session_timeout (15000ms, db.ts), Postgres
  asynchronously terminates the connection (error code 25P03). pg's
  Client._handleErrorEvent (node_modules/pg/lib/client.js:411) rejects any
  in-flight query first, then unconditionally does `this.emit('error', err)`.
  With zero listeners on that specific checked-out client instance, Node's
  EventEmitter throws synchronously — an uncaught exception outside any
  promise chain/try-catch, crashing the whole process. This matches every
  observed detail: "node:events:502 Unhandled error event", Postgres code
  25P03, emitted directly on a raw pg Client (Client._handleErrorEvent) and
  NOT routed through Pool-level error handling.

  (The separate, non-fatal "storm" of DrizzleQueryError 'Query read timeout'
  entries on begin/rollback during the same incident is a related but
  distinct, already-correctly-handled manifestation: a query WAS in flight
  when the stall happened, so it rejected normally via client-side
  query_timeout instead of hitting the zero-listener throw. Root cause for
  the crash itself does not depend on this secondary pattern, which may
  additionally involve stale pooled connections after a long DB-idle gap —
  flagged as a residual reliability concern, not required to fix the crash.)
fix: |
  src/database/db.ts: added `pool.on('connect', client => client.on('error', ...))`
  and `appPool.on('connect', client => client.on('error', ...))`. Pool's
  'connect' event fires exactly once per new physical client connection
  (pg-pool: `if (isNew) { this.emit('connect', client) }`), so this listener
  is attached once and, because pg-pool only ever adds/removes ITS OWN
  idleListener function reference via removeListener, our separately-attached
  listener is never stripped — it persists across every future checkout for
  that client's entire lifetime, whether idle or checked out. This closes the
  exact gap without needing to fork/wrap drizzle-orm's session.transaction()
  or touch any individual .transaction()/getConn() call site.
verification: |
  1. Wrote tests/db-checked-out-client-error.test.ts: checks out a real
     client from both `pool` and `appPool` (against a local Postgres test DB)
     and manually emits 'error' on it (simulating exactly what
     Client._handleErrorEvent does), asserting the emit does not throw.
  2. Confirmed RED before the fix: stashed src/database/db.ts and reran —
     both assertions failed with "Unhandled error. (Error: simulated
     idle_in_transaction_session_timeout...)" — the exact crash signature,
     proving the test reproduces the real bug mechanism.
  3. Restored the fix, reran — both assertions pass; log output confirms the
     new listener actually caught and logged the simulated error rather than
     merely satisfying a vacuous assertion.
  4. Regression check: ran the full test suite before and after the fix.
     31 test suites / 78 tests fail identically on both the original,
     unmodified codebase and the fixed codebase — confirmed pre-existing and
     unrelated (a mix of local test-DB schema drift, e.g. "column
     'booking_mode' of relation 'businesses' does not exist", stale `Business`
     type fixtures missing newer required fields, and an unrelated ts-jest
     global-scope variable collision across some test files when run in one
     process). None of these mention db.ts, and none reference the
     checked-out-client error path.
  5. Ran a targeted batch of tests that actually exercise db.ts/appDb (the
     new regression test, telegram webhook onboarding integration test) with
     --runInBand: all pass. `npx tsc --noEmit` shows zero errors for db.ts.
  6. LIVE PRODUCTION VERIFICATION (2026-07-25T18:46:30Z-18:47:09Z): committed
     fix as 2b70a74, deployed via `fly deploy --app randevuclaw` (v21,
     machine 8dd333ae114ee8, healthy). A real DB-idle-then-burst cycle
     occurred naturally in production; the pre-existing non-fatal
     "Query read timeout" storm recurred (confirming hypothesis 1 is a
     separate, still-open issue), but the process did NOT crash — same pid
     (642), same machine, no restart in `fly status`/logs, subsequent tool
     calls succeeded normally. This is direct evidence, not inference, that
     the fatal crash is fixed. CONFIRMED — session closed.
files_changed:
  - src/database/db.ts (added persistent per-client 'error' listeners on
    Pool's 'connect' event for both `pool` and `appPool`, closing the
    checked-out-client error-handling gap)
  - tests/db-checked-out-client-error.test.ts (new regression test proving
    the exact crash mechanism is fixed)
