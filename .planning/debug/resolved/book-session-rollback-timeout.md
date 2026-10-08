---
status: resolved
trigger: "DrizzleQueryError 'Failed query: rollback ... Query read timeout' in withBusinessContext (businessId=2, elapsedMs=24064) during book_session tool (session_instance_id=183), Telegram webhook, prod fly.io 2026-10-07 08:47:16"
created: 2026-10-07
updated: 2026-10-07
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

status_note: RESOLVED. Fix applied, self-verified (deterministic repro + A/B suite), and confirmed by user in prod on fly.io (2026-10-07).

reasoning_checkpoint:
  hypothesis: |
    withBusinessContext is not re-entrant. handleFoundBusiness (src/webhooks/telegram.ts:169) wraps the whole client
    AI turn in outer transaction T1. In T1, bookSessionTool -> checkEnforcementAndGetMembership ->
    getActiveMembershipForDeduction takes SELECT ... FOR UPDATE on the client's memberships row. bookSessionInstance
    then opens a SEPARATE transaction T2 (new connection) whose deductSession (INSERT membership_ledger -> FK key-share
    lock on memberships row, then UPDATE memberships) blocks on T1's lock while T1 awaits T2 in JS: an application-level
    cross-connection deadlock invisible to Postgres. On Neon's -pooler endpoint the server statement_timeout startup
    param is ignored, so only the 12s client query_timeout fires; drizzle's ROLLBACK then queues behind the
    still-blocked statement and times out again => 2 x 12s = 24s, and the ROLLBACK error masks the original error.
  confirming_evidence:
    - "Deterministic repro on real local Postgres via tests/session-booking-ambient-lock.test.ts test 1 (pre-fix):
       withBusinessContext(biz, () => executeTool('book_session', ...)) with a finite membership blocks 10095ms and fails at
       exactly `insert into membership_ledger` (deductSession, manager.ts:305) with 'canceling statement due to statement
       timeout'; stack shows bookSessionTool -> withBusinessContext -> runInTransaction nested inside the outer
       withBusinessContext, the same chain as the prod trace."
    - "Neon -pooler probe: SHOW statement_timeout = 0, pg_sleep(11) completed in 11092ms => server statement_timeout not
       enforced via pooler; explains read-timeout (12s) + rollback read-timeout (12s) = 24064ms instead of a 10s
       statement-timeout error."
    - "Source: getActiveMembershipForDeduction .for('update') (billing/queries.ts:434) runs on getConn() = T1;
       withBusinessContext (queries.ts:98) never checks the ambient context; enforcement.ts header and bookSessionInstance
       comments both assume the nested call is 'the SAME withBusinessContext transaction'."
    - "Control: test 2 (inner failure) passes pre-fix because T2 is independent; real-DB tests that call
       bookSessionInstance WITHOUT an ambient context pass, which is why the suite never caught this."
  falsification_test: |
    If bookSessionInstance executed on the ambient connection (join) and book_session STILL blocked/timed out, the
    lock-wait hypothesis would be wrong. Conversely if the pre-fix repro had succeeded quickly the hypothesis would be
    wrong (it did not: 10s block at the ledger insert).
  fix_rationale: |
    Add withAmbientBusinessContext (src/database/queries.ts): when a withBusinessContext transaction for the SAME
    business is already ambient, run the callback inside it as a SAVEPOINT (drizzle nested tx), otherwise behave exactly
    like withBusinessContext. bookSessionInstance uses it when the caller supplies a non-null membership (that membership
    was read+row-locked under the caller's ambient transaction, so deduction must run in that same transaction - the
    documented SESS-01/T-08-01 invariant). Restricting the join to that case leaves every other nested call (escl:approve
    reads the new booking via the admin pool and relies on the inner commit; owner tools) unchanged. Savepoint keeps
    failure isolation (an inner error does not poison the outer transaction), matching the previous independent-T2
    semantics. Also preserve the callback's ORIGINAL error when rollback itself fails (runInTransaction) so the masked
    root cause is visible in logs next time.
  blind_spots: |
    Cannot reproduce through the Neon pooler end-to-end (only the dev DB probe + local direct Postgres). The restriction
    "join only if caller passed a membership" assumes every lock-holding caller passes it (bookSessionTool single/multi,
    client-menu, reschedule do). Joined bookings now commit with the outer turn transaction (T1), so a later failure in
    the same turn rolls the booking back (and row locks on the session instance are held for the rest of the turn).
    rescheduleSessionTool has an additional T1 write (restoreCredit) before bookSessionInstance - covered by the same join
    but not separately exercised by a test. Other nested withBusinessContext sites were not audited for the same pattern.

next_action: none - session resolved, archived to .planning/debug/resolved/, knowledge-base entry appended

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: book_session books session_instance 183 for business 2 and replies to client quickly
actual: transaction takes 24s, rollback fails with "Query read timeout"; tool throws "Tool execution threw unexpectedly"; booking fails
errors: |
  DrizzleQueryError: Failed query: rollback / caused by Error: Query read timeout (pg/lib/client.js:652)
  stack: runInTransaction (dist/database/db.js:123) <- withBusinessContext (queries.js:112) <- bookSessionTool (function-executor.js:545) <- executeTool <- aiBookingAgent <- routeConversationMessage <- webhooks/telegram.js:136
  log msgs: "withBusinessContext: transaction failed/rolled back" (elapsedMs 24064), "Tool execution threw unexpectedly" (tool=book_session args business_id=2 session_instance_id=183)
reproduction: unknown; client books via Telegram bot, prod
started: 2026-10-07 08:47:16 (prod). Related earlier incident 2026-07-26 (see knowledge-base.md)

## Eliminated
<!-- APPEND only - prevents re-investigating -->

- hypothesis: "Recurrence / incomplete fix of KB entry query-read-timeout-storm (drizzle leaks pool client when initial 'begin' times out)"
  evidence: |
    runInTransaction (src/database/db.ts:105-131) is present and used by withBusinessContext (queries.ts:122), and the
    stack trace itself shows runInTransaction in the chain, so the fix is deployed. The failing statement is ROLLBACK,
    not BEGIN: rollback is inside drizzle's try/catch so the old leak path (begin outside try) does not apply. Also
    the 24s = 2 x 12s shape means the transaction had RUN (begin succeeded, some statement stalled), not a begin
    stall. The KB entry only supplies the 12s/24s timing vocabulary, not the mechanism.
  timestamp: 2026-10-07

## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: 2026-10-07
  checked: src/database/db.ts runInTransaction + pool config
  found: pool/appPool: connectionTimeoutMillis 5000, statement_timeout 10000, query_timeout 12000, idle_in_transaction_session_timeout 15000. runInTransaction checks out client, drizzle(client).transaction(cb), client.release(err) in finally.
  implication: Client-side query_timeout (12s) does not cancel the server-side statement; a following query on the same connection (drizzle's ROLLBACK) queues behind it and also times out at 12s -> 24s. Server statement_timeout (10s) should have fired first for a lock wait but evidently did not (or error would be "canceling statement due to statement timeout").

- timestamp: 2026-10-07
  checked: src/webhooks/telegram.ts:169-174 (handleFoundBusiness client branch) + git blame/show 60b009a
  found: |
    `await withBusinessContext(business.id, async () => { await routeConversationMessage(...); await markTelegramUpdateProcessed(...) })`.
    Commit 60b009a ("kill idle gemini calls", 2026-07-26) moved the owner/onboarding AI branches OUT of a transaction
    ("AI calls run outside any transaction — each tool call opens its own short withBusinessContext") but left the
    CLIENT conversation branch wrapped in an outer withBusinessContext covering the whole Gemini turn.
  implication: Every client tool call runs inside T1 (connection A); any tool that calls withBusinessContext (bookSessionInstance, cancelSession etc.) opens a nested, independent T2 on connection B.

- timestamp: 2026-10-07
  checked: src/database/queries.ts withBusinessContext (lines 98-146)
  found: Always `runInTransaction(appPool, ...)`; never inspects currentTx (AsyncLocalStorage). Not re-entrant.
  implication: Nested call = second transaction on a second pooled connection, not a savepoint/join of the outer one.

- timestamp: 2026-10-07
  checked: src/billing/queries.ts:415-437 getActiveMembershipForDeduction; src/billing/enforcement.ts:41; src/conversation/function-executor.ts bookSessionTool (single path)
  found: |
    getActiveMembershipForDeduction does `.for('update')` on the memberships row via getConn(). bookSessionTool calls
    checkEnforcementAndGetMembership (-> that FOR UPDATE) BEFORE bookSessionInstance, outside any of its own
    withBusinessContext, so getConn() = outer T1 => T1 holds FOR UPDATE on the client's memberships row until the
    whole AI turn commits. Then bookSessionInstance(..., enfResult.membership) opens T2 and, when
    membership.sessionsRemaining !== null, runs deductSession: INSERT membership_ledger (FK memberships.id =>
    FOR KEY SHARE, conflicts with FOR UPDATE) then UPDATE memberships (row lock).
  implication: T2 blocks on a lock held by T1, and T1 is awaiting T2 => undetectable (to Postgres) deadlock, resolved only by client/server timeouts.

- timestamp: 2026-10-07
  checked: .env.local DATABASE_URL host shape (credentials redacted)
  found: host is a Neon `-pooler` endpoint (PgBouncer transaction mode)
  implication: plausible reason server-side startup params (statement_timeout, idle_in_transaction_session_timeout) are not enforced; to be verified empirically.

- timestamp: 2026-10-07
  checked: empirical probe (scratchpad/stmt-timeout-check.js) against the Neon -pooler endpoint in .env.local using the SAME Pool options as db.ts (statement_timeout 10000, query_timeout 12000, idle_in_transaction_session_timeout 15000); read-only SHOW + SELECT pg_sleep(11)
  found: |
    SHOW statement_timeout = 0 ; SHOW idle_in_transaction_session_timeout = 5min (Neon default, NOT our 15s);
    SELECT pg_sleep(11) COMPLETED after 11092ms, i.e. server-side statement_timeout(10s) is NOT enforced through the
    pooler (PgBouncer drops pg startup params). Only the client-side query_timeout (12s) is active, and it does NOT
    cancel the server statement.
  implication: |
    Explains why a lock wait surfaced as "Query read timeout" at 12s instead of Postgres "canceling statement due to
    statement timeout" at 10s, and why drizzle's ROLLBACK (queued behind the still-blocked statement on the same
    connection) also took the full 12s => 24064ms. Also means idle_in_transaction_session_timeout=15s is not enforced
    either (outer T1 sitting idle across Gemini is not killed at 15s; Neon default 5min applies).

- timestamp: 2026-10-07
  checked: src/billing/enforcement.ts header comment, src/session/manager.ts bookSessionInstance comments, git history of withBusinessContext (769002b..766ca99)
  found: |
    Design intent documented in comments: "Must be called INSIDE a withBusinessContext transaction so that
    getActiveMembershipForDeduction's SELECT FOR UPDATE lock is held until the surrounding transaction commits" and
    bookSessionInstance: "deduct 1 session credit within the SAME withBusinessContext transaction as the booking
    insert". But withBusinessContext was NEVER re-entrant (original 769002b: always appDb.transaction(...)). A nested
    call opens a second transaction on a second connection, so the enforcement FOR UPDATE (outer T1) and the
    deduction (inner T2) are in DIFFERENT transactions, and the second blocks on the first.
    Callers that hit nested-T2-after-outer-FOR-UPDATE: function-executor bookSessionTool (single + multi path),
    rescheduleSessionTool (getActiveMembershipForDeduction at :794 then bookSessionInstance), client-menu
    handleBookSessionExecute (inside withBusinessContext(handleCallbackQuery) at webhooks/telegram.ts), plus
    bookAppointmentTool.
  implication: Root cause is structural (non-reentrant withBusinessContext + outer wrapper holding a FOR UPDATE row lock), not a transient DB blip. Only triggers when the client has an active FINITE-pack membership (sessionsRemaining !== null) so deductSession touches the locked memberships row.

- timestamp: 2026-10-07
  checked: tests/session-booking-ambient-lock.test.ts run against UNFIXED code (real local Postgres randevuclaw_test)
  found: |
    Test 1 (book_session inside outer withBusinessContext, finite membership) FAILED after 10165ms: tool returned
    error "Failed query: insert into membership_ledger ... on conflict do nothing returning id" caused by
    "canceling statement due to statement timeout" (local direct Postgres enforces the 10s startup statement_timeout).
    Stack: deductSession (billing/queries.ts:514) <- bookSessionInstance (manager.ts:305) <- runInTransaction <-
    withBusinessContext <- bookSessionTool (function-executor.ts:684) <- executeTool <- outer withBusinessContext.
    Test 2 (inner failure leaves outer tx usable) PASSED pre-fix (inner tx is independent).
  implication: ROOT CAUSE CONFIRMED by deterministic reproduction. The blocked statement is the first one touching the memberships row held FOR UPDATE by the outer transaction.

- timestamp: 2026-10-07
  checked: exact prod signature reproduced on UNFIXED code by emulating the Neon pooler locally (temp jest test, since deleted): appPool 'connect' handler runs SET statement_timeout=0 and SET idle_in_transaction_session_timeout='5min' (what the pooler effectively does, per the probe), then outer withBusinessContext -> executeTool('book_session') with finite membership
  found: |
    inner "withBusinessContext: transaction failed/rolled back" elapsedMs=24017 (prod: 24064), 4x "Query read timeout",
    tool result {"error":"Failed query: rollback"} i.e. "Tool execution threw unexpectedly" with rollback as the surfaced
    error. Same emulation on FIXED code: success in 20ms. (A first emulation that left idle_in_transaction_session_timeout
    at 15s failed at ~15s instead: the 15s idle-in-tx kill of the outer T1 ends the deadlock early - not what Neon's
    pooler does.)
  implication: Full causal chain confirmed end to end: nested tx blocks on outer FOR UPDATE -> 12s client query_timeout -> ROLLBACK queued behind blocked statement -> 12s more -> rollback error masks original.

- timestamp: 2026-10-07
  checked: fix verification (tests + A/B)
  found: |
    tests/session-booking-ambient-lock.test.ts (new, 3 tests): pre-fix test 1 FAILED after 10165ms (statement timeout at the
    membership_ledger insert); post-fix all 3 pass, test 1 in ~50ms. Falsification: reverting ONLY src/session/manager.ts
    makes test 1 fail again (10166ms). tests/db-transaction-begin-leak.test.ts +2 tests (original callback error is logged when
    ROLLBACK also fails; no masking log otherwise): 6/6 pass; the masking test fails without the db.ts change.
    Full jest A/B (git stash baseline vs fixed): parallel run - the only diffs are flaky shared-DB suites in BOTH directions
    (session-expansion, renewal-nudge failed only before; session-list, rls-enforcement, session-cancel failed only after but
    all pass in isolation); serial --runInBand run - NOTHING fails only after the fix (failures only in BEFORE: the new test file
    + two flaky suites); 32 pre-existing failing suites in common (missing qrcode/sharp modules, local schema drift).
    tsc: identical to baseline (only the 2 pre-existing qrcode/sharp 'Cannot find module' errors in src/invites/generator.ts).
  implication: Fix removes the deadlock with no regressions attributable to the change.

## Resolution
root_cause: |
  withBusinessContext (src/database/queries.ts) is not re-entrant: a call made while another withBusinessContext is ambient
  opens a SEPARATE transaction on a SEPARATE pooled connection. handleFoundBusiness (src/webhooks/telegram.ts:169; same for
  client-menu callbacks) wraps the whole client AI turn in an outer transaction T1. In T1, bookSessionTool ->
  checkEnforcementAndGetMembership -> getActiveMembershipForDeduction takes SELECT ... FOR UPDATE on the client's memberships
  row. bookSessionInstance then opens a nested independent transaction T2 whose deductSession (INSERT membership_ledger -> FK
  key-share on memberships row, then UPDATE memberships) blocks on T1's lock while T1 awaits T2 in JS - an application-level
  deadlock Postgres cannot detect. Only timeouts end it: on the Neon -pooler endpoint the server-side statement_timeout (10s) and
  idle_in_transaction_session_timeout (15s) startup params are NOT applied (probe: statement_timeout=0, pg_sleep(11) completes),
  so only the 12s client query_timeout fires ("Query read timeout" on the ledger insert); drizzle then sends ROLLBACK on the same
  connection, which queues behind the still-blocked statement and times out another 12s => 24s, and the ROLLBACK error masks
  the original error. Affects any client with an active finite-pack membership (sessionsRemaining !== null) booking or
  rescheduling a session; unlimited/no membership never touches the locked row so it worked, and tests never nested the calls.
  NOT a recurrence of query-read-timeout-storm (that was a leaked client on a failed BEGIN; runInTransaction is deployed and
  in the stack trace).
fix: |
  1) src/database/queries.ts: ALS store now {tx, businessId}; new withAmbientBusinessContext(businessId, cb) - if a
     withBusinessContext transaction for the SAME business is ambient, run cb inside it as a SAVEPOINT (drizzle nested tx,
     failure-isolated), else behave exactly like withBusinessContext. withBusinessContext entry log gains `nested` flag.
  2) src/session/manager.ts bookSessionInstance: use withAmbientBusinessContext when the caller passes a non-null
     activeMembership (it was read+locked under the caller's ambient transaction, so the deduction must run in it - the
     documented SESS-01/T-08-01 invariant); null/undefined membership keep the independent short transaction (escl:approve
     reads the new booking via the admin pool and needs the inner commit).
  3) src/database/db.ts runInTransaction: remember the callback's error and log it when drizzle's ROLLBACK also fails and
     replaces it, so the masked root cause is visible in fly logs.
verification: |
  Deterministic repro on real Postgres pre-fix (10s block at membership_ledger insert) and exact prod signature via Neon-pooler
  emulation pre-fix (24017ms, rollback read timeout, tool error); post-fix both succeed in ms. New regression tests + A/B full
  suite show no regressions (see Evidence). Human verification: user confirmed fixed after deploying to fly.io and testing in
  prod through the real Neon pooler (2026-10-07).
files_changed:
  - src/database/queries.ts
  - src/session/manager.ts
  - src/database/db.ts
  - tests/session-booking-ambient-lock.test.ts (new)
  - tests/db-transaction-begin-leak.test.ts (+2 tests)
