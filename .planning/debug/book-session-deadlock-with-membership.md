---
status: awaiting_human_verify
trigger: "Client WITH an active subscription tries to book a fixed-session class (taps 'Ναι' on the confirm prompt). Nothing happens after tapping yes — no success message, no error to the client, and the admin never gets the Έγκριση/Απόρριψη approval message."
created: 2026-08-13
updated: 2026-08-13
---

## Symptoms

- **Expected behavior:** Client taps "Ναι" on `showBookConfirm`'s prompt → booking is created (pending_owner_approval) → client gets "στάλθηκε στον διαχειριστή" confirmation → owner gets an Έγκριση/Απόρριψη keyboard.
- **Actual behavior:** Client taps "Ναι" → ~24 seconds of silence → client eventually gets the generic escalation-style failure text (from the `finally`/error path), owner gets nothing at all.
- **Error messages (from live `flyctl logs --app randevuclaw`, 2026-08-13T12:32:20Z):**
  ```
  DrizzleQueryError: Failed query: rollback
  caused by: Error: Query read timeout
      at async NodePgSession.transaction (node_modules/drizzle-orm/node-postgres/session.cjs:225:7)
      at async runInTransaction (dist/database/db.js:123:17)
      at async withBusinessContext (dist/database/queries.js:125:24)
      at async handleBookSessionExecute (dist/telegram/handlers/client-menu.js:157:24)
      at async handleClientMenuCallback (dist/telegram/handlers/client-menu.js:439:17)
      at async handleCallbackQuery (dist/webhooks/telegram.js:671:9)
      at async NodePgSession.transaction (node_modules/drizzle-orm/node-postgres/session.cjs:221:22)
      at async runInTransaction (dist/database/db.js:123:17)
  ```
  Note the SAME stack appears twice more within milliseconds (rollback itself also timing out), then a top-level "Telegram webhook handler failed" with `elapsedMs: 24284`.
- **Timeline:** Observed live in production 2026-08-13, immediately after deploying today's billing-reconciliation changes. Confirmed via code read that the buggy code path (`src/session/manager.ts`) was **not touched** by any of today's commits — this is a pre-existing latent bug that this client interaction happened to trigger, not a regression.
- **Reproduction:** Any client with an active membership (`checkEnforcementAndGetMembership` returns `membership !== null`) using the `fixed_sessions` booking mode's class-confirm flow (`showBookConfirm` → tap "Ναι" → `handleBookSessionExecute`).

## Root Cause (found via log timestamps + direct code read — high confidence, not yet live-verified with a reproduction test)

**Self-deadlock from a nested `withBusinessContext` call, only triggered when the client has an active membership.**

Call chain for this flow:
1. `src/webhooks/telegram.ts:1490-1492` — `handleTelegramWebhookPost` wraps the ENTIRE `handleCallbackQuery` dispatch in an outer `withBusinessContext(business.id, ...)`. This opens transaction A on connection A.
2. Inside that, `handleClientMenuCallback` → `handleBookSessionExecute` (`src/telegram/handlers/client-menu.ts:182-197`) calls `checkEnforcementAndGetMembership(business.id, senderTelegramId)`. For a client WITH an active membership, this runs `getActiveMembershipForDeduction` (`src/billing/queries.ts:563`), which does `.for('update')` — a `SELECT ... FOR UPDATE` on the client's `memberships` row. This lock is taken on connection A (transaction A) and is NOT released until transaction A commits (by design — the doc comment on `checkEnforcementAndGetMembership` explicitly says this lock must be "held until the surrounding transaction commits", SESS-01/T-08-01).
3. `handleBookSessionExecute` then calls `bookSessionInstance(...)` (`src/telegram/handlers/client-menu.ts:211-218`), passing the already-fetched membership.
4. `bookSessionInstance` (`src/session/manager.ts:216`) **unconditionally** calls `withBusinessContext(businessId, ...)` again — with NO `isInBusinessContext()` guard. This opens a SECOND transaction (transaction B) on a DIFFERENT pooled connection (connection B), nested inside transaction A's still-open, still-awaited call stack.
5. Inside transaction B, `deductSession` (`src/billing/queries.ts:637-662`) runs an `UPDATE` on the SAME `memberships` row (line ~661-662) to decrement `sessionsRemaining`. This `UPDATE` needs a row lock that connection A is already holding (from step 2) and has not released — so it blocks.
6. Connection A's transaction, however, cannot commit (and thus cannot release its lock) because it is synchronously `await`-ing `bookSessionInstance`'s promise (transaction B) to resolve. Connection B is blocked waiting on connection A; connection A is blocked waiting on connection B. Classic self-inflicted lock-wait, invisible to Postgres's own deadlock detector (it's two different backend connections from the same Node process, not a cycle Postgres can see as circular — it just looks like an ordinary lock wait to the database). Eventually the pg client's own read/statement timeout fires (~24s per the logs, matching the "idle_in_transaction ~24s" figure already documented elsewhere in this codebase's comments), producing the "Query read timeout" error, and the subsequent `ROLLBACK` attempt *also* times out because the connection is still stuck.

**Why this only affects clients WITH a membership:** `checkEnforcementAndGetMembership` only takes the `SELECT FOR UPDATE` lock when `getActiveMembershipForDeduction` finds a real membership row (`membership !== null`). A client with no active membership (or `enforcementPolicy='allow'` with no capacity) never takes that lock, so `bookSessionInstance`'s nested transaction never contends for it — no hang. This exactly matches the reported symptom: "client WITH subscription" is broken, presumably others are not.

**This is the exact WR-02 anti-pattern already known and guarded against elsewhere in this codebase.** `src/telegram/handlers/payment-flow.ts` has an explicit `isInBusinessContext() ? ... : withBusinessContext(...)` guard with a comment describing precisely this hazard ("Opening a fresh withBusinessContext here unconditionally would check out a second DB connection while the outer transaction sits idle"). `src/session/manager.ts`'s `bookSessionInstance` (and possibly `cancelSession`/`cascadeCancelSessionBookings`/the recurring-session creator — need to check each call site) never received the same guard.

## Current Focus

```yaml
reasoning_checkpoint:
  hypothesis: >
    bookSessionInstance (src/session/manager.ts:216) unconditionally opens a new
    withBusinessContext transaction with no isInBusinessContext() check. When called
    from handleBookSessionExecute (src/telegram/handlers/client-menu.ts:211), which
    itself runs inside telegram.ts's outer withBusinessContext wrap (telegram.ts:1490)
    AND has already taken a SELECT FOR UPDATE lock on the client's memberships row
    (via checkEnforcementAndGetMembership -> getActiveMembershipForDeduction,
    billing/queries.ts:563, for('update')), the nested transaction's own write to that
    same row (deductSession's UPDATE, billing/queries.ts:661) blocks waiting for the
    outer transaction's lock, while the outer transaction is itself blocked awaiting
    the nested call's completion. Self-deadlock, resolved only by the ~24s client-side
    query-read-timeout, matching the exact error and elapsedMs seen in production logs.
  confirming_evidence:
    - "Production log timestamps (2026-08-13T12:31:55Z-12:32:20Z, businessId 2, senderTelegramId 8759542539): two 'withBusinessContext: entry (opening transaction)' lines fire 88ms apart with NO intervening exit for the first, immediately preceding a 24133ms/24233ms/24284ms 'Query read timeout' failure whose stack trace runs through handleBookSessionExecute -> handleClientMenuCallback -> handleCallbackQuery, i.e. the SAME request nesting a second transaction inside the first."
    - "src/webhooks/telegram.ts:1490-1492 confirms handleCallbackQuery (and everything it calls, including handleBookSessionExecute) already runs inside an outer withBusinessContext opened by handleTelegramWebhookPost."
    - "src/billing/queries.ts:563 confirms getActiveMembershipForDeduction uses .for('update') (SELECT FOR UPDATE)."
    - "src/billing/enforcement.ts's own doc comment states this lock is intentionally held until the surrounding transaction commits (SESS-01/T-08-01) — i.e. the lock is BY DESIGN meant to still be held when bookSessionInstance runs afterward in the SAME transaction; the bug is that bookSessionInstance does not run in the same transaction, it opens a new one."
    - "src/session/manager.ts:216 (bookSessionInstance) and billing/queries.ts:637-662 (deductSession's UPDATE on memberships) confirmed by direct read — no isInBusinessContext() guard present, unlike payment-flow.ts's showClientSelection which has this exact guard with a comment describing the identical hazard (WR-02)."
    - "Confirmed via `git log` / diff review that none of today's 6 commits (agenda.ts, admin-menu.ts, payment-flow.ts, billing/queries.ts, billing/enforcement.ts changes) touched src/session/manager.ts or src/telegram/handlers/client-menu.ts — this is a pre-existing latent bug, not a regression from today's deploy."
  falsification_test: >
    Reproduce locally against a real Postgres instance: open transaction A, take a
    SELECT ... FOR UPDATE lock on a memberships row (mirroring
    checkEnforcementAndGetMembership's behavior), then from the SAME async call stack
    (without committing A) call bookSessionInstance for a booking that would deduct
    from that same membership. If this hangs and times out, hypothesis confirmed. If
    it completes normally, hypothesis is wrong and the real cause lies elsewhere
    (re-open investigation).
  next_action: >
    Write the falsification test above as an actual Jest integration test against a
    real Postgres DB (matching this project's existing test-DB conventions in
    tests/billing-membership-creation.test.ts). If confirmed, fix by adding an
    isInBusinessContext() guard to bookSessionInstance (and audit cancelSession,
    cascadeCancelSessionBookings, and the recurring-session creator in the same file
    for the identical unconditional-wrap pattern), mirroring payment-flow.ts's
    established WR-02 guard convention exactly.
```

### Fix reasoning checkpoint (root cause confirmed by live DB reproduction)

```yaml
reasoning_checkpoint:
  hypothesis: >
    CONFIRMED (see Evidence: live DB falsification test). bookSessionInstance
    (src/session/manager.ts:216), cancelSession (:371), and
    cascadeCancelSessionBookings (:428) all unconditionally call
    withBusinessContext(businessId, ...) with no isInBusinessContext() guard.
    createSessionCatalogWithExpansion (:104) has the same unconditional call;
    audited its callers (ai-owner-agent.ts's create_recurring_session case,
    ai-onboarding-agent.ts's class_setup flow) and confirmed neither currently
    runs inside an existing withBusinessContext, so it is not exposed to a
    live deadlock today. DECISION: guard it anyway, identically to the other
    three. The guard is a strict no-op when isInBusinessContext() is false
    (unchanged behavior — still opens its own withBusinessContext exactly as
    before), so applying it uniformly across every unconditional
    withBusinessContext call in this file closes the entire hazard CLASS
    (including future call sites that might nest it) at zero behavioral risk,
    rather than leaving 1 of 4 structurally-identical latent copies of the
    same bug pattern in the file. Also confirmed via grep that
    telegram.ts:803's bookSessionInstance call (escl:approve branch) and
    admin-menu.ts's cancelSession/cascadeCancelSessionBookings calls
    (handleClassCancelExecute) ARE both dispatched through
    handleCallbackQuery, i.e. ARE nested inside telegram.ts:1490's outer
    withBusinessContext — so the bookSessionInstance and cancelSession/
    cascadeCancelSessionBookings guards fix those call sites too, not just
    the one with live-reproduced evidence (client-menu.ts's
    handleBookSessionExecute).
  confirming_evidence:
    - "Live DB reproduction (this session): outer withBusinessContext holding
      a FOR UPDATE lock on a memberships row, then calling bookSessionInstance
      (which nests a second withBusinessContext) inside it, fails after
      ~10019ms/10055ms with 'canceling statement due to statement timeout' —
      matching DB_STATEMENT_TIMEOUT_MS exactly. Control (no membership, no
      lock) completes in 27ms."
    - "src/telegram/handlers/payment-flow.ts's showClientSelection already
      has the exact fix pattern in production use: isInBusinessContext() ?
      (run inline via getConn()) : withBusinessContext(businessId, ...)."
    - "src/database/queries.ts's isInBusinessContext() doc comment
      explicitly describes this exact hazard class (nested
      withBusinessContext while an outer one is open) and references two
      prior resolved incidents of the same shape."
  falsification_test: >
    Already executed and confirmed (see Evidence section). Post-fix
    falsification: re-run tests/book-session-deadlock.test.ts's first case —
    after the fix it must complete in under ~1s with result.status ===
    'success' (deduction happens inside the SAME outer transaction, no lock
    contention), not time out.
  fix_rationale: >
    Adding the isInBusinessContext() guard makes bookSessionInstance (and
    cancelSession, cascadeCancelSessionBookings) reuse the ambient
    transaction via getConn() when one is already open, instead of opening a
    second one on a different pooled connection. This addresses the actual
    mechanism (two connections from the same process contending for the same
    row lock) rather than a symptom (e.g. raising the timeout would only
    make the hang longer, not eliminate it; retrying would retry into the
    same deadlock).
  blind_spots: >
    Have not live-verified in production (fly.io) yet — self-verification is
    the local DB falsification test plus regression test only, per
    find_and_fix mode's required human-verify checkpoint before archiving.
    Have not audited every OTHER call site in the codebase that might nest
    withBusinessContext beyond src/session/manager.ts (scope was explicitly
    bounded to this file per the operational brief); a broader audit could
    be a useful follow-up but is out of scope for shipping today's fix.
```

### Status: awaiting human verification

hypothesis: CONFIRMED and FIXED (see Resolution section below for full detail).
next_action: >
  Awaiting user confirmation that a real client with an active membership can
  now successfully book a fixed-session class in production (after this fix
  is deployed) — self-verification (live DB reproduction pre-fix, regression
  test + broader suite post-fix) is complete, but production behavior has
  not yet been observed. Do NOT move this file to resolved/ until the user
  confirms.

## Evidence

- timestamp: 2026-08-13T12:32:20Z — production log capture (see Root Cause section above for full stack trace and surrounding context lines).

- timestamp: 2026-08-13 (this session) — LIVE DB FALSIFICATION TEST, ROOT CAUSE CONFIRMED
  checked: >
    Wrote tests/book-session-deadlock.test.ts and ran it against a real local
    Postgres (docker container randevuclaw-pg, port 5433, schema already
    migrated). Test opens an outer withBusinessContext(businessId, ...) that
    calls getActiveMembershipForDeduction (taking the SELECT ... FOR UPDATE
    lock on the memberships row, exactly mirroring
    checkEnforcementAndGetMembership's production behavior), then — still
    inside that same outer transaction, lock still held — calls
    bookSessionInstance with that membership, exactly mirroring
    handleBookSessionExecute's production call chain.
  found: >
    Test PASSED (hypothesis confirmed): the attempt failed after exactly
    ~10019ms/10055ms elapsed (matching DB_STATEMENT_TIMEOUT_MS=10_000 in
    src/database/db.ts to the millisecond) with
    "canceling statement due to statement timeout" — a Postgres-side
    statement_timeout cancellation, not node-postgres's client-side
    query_timeout (12_000ms), meaning the server itself killed the blocked
    statement before the client-side timer got a chance to fire. Two
    "withBusinessContext: entry (opening transaction)" log lines fired 13ms
    apart with no intervening exit — the exact double-entry pattern observed
    in the original production logs. sessionsRemaining was confirmed
    UNCHANGED (still 3) after the failed attempt — both the outer and nested
    transactions rolled back cleanly (no partial-write corruption, no
    connection leak: runInTransaction's fix from the prior
    query-read-timeout-storm session correctly released both clients even on
    this failure path — elapsedMs 14ms/25ms for the very next transactions
    proves no leaked/broken pool slot).

    REFINEMENT to the originally-hypothesized exact blocking statement: the
    query that actually blocks and times out is NOT deductSession's UPDATE
    on memberships (billing/queries.ts:661-664) as originally guessed — it's
    the INSERT into membership_ledger immediately before it
    (billing/queries.ts:643-653). membership_ledger.membership_id has a FK
    reference to memberships.id; inserting a referencing row requires
    Postgres to take an implicit FOR KEY SHARE lock on the referenced
    memberships row to guard against concurrent deletion/key-change — and
    FOR KEY SHARE conflicts with the outer transaction's FOR UPDATE lock on
    that same row, so the INSERT blocks there, before ever reaching the
    UPDATE. Root cause mechanism (nested withBusinessContext contending with
    the outer transaction's held lock on the SAME row) is identical; only
    the specific statement that first hits the lock wait differs from the
    original guess.
  implication: >
    ROOT CAUSE FULLY CONFIRMED by live reproduction, not just code-read
    inference. Control test (identical setup but NO active membership, so
    getActiveMembershipForDeduction returns null and no FOR UPDATE lock is
    ever taken) completed in 27ms and returned status:'success' —
    confirming the "only breaks for clients WITH an active membership"
    explanation is correct. Safe to proceed to fix_and_verify.

- timestamp: 2026-08-13 (this session) — FIX APPLIED, POST-FIX VERIFICATION
  checked: >
    Added isInBusinessContext() guard (mirroring payment-flow.ts's
    showClientSelection pattern) to all 4 functions in src/session/manager.ts
    that unconditionally called withBusinessContext: bookSessionInstance,
    cancelSession, cascadeCancelSessionBookings, and
    createSessionCatalogWithExpansion (the last one guarded for defense-in-
    depth/consistency even though no live call site currently nests it — the
    guard is a strict no-op when not already in a business context, so this
    is zero-risk). Also grep-confirmed two additional call sites of
    bookSessionInstance/cancelSession/cascadeCancelSessionBookings that ARE
    nested inside telegram.ts's outer withBusinessContext and are therefore
    ALSO fixed by this same change: src/webhooks/telegram.ts:803 (escl:approve
    branch) and src/telegram/handlers/admin-menu.ts:475-477
    (handleClassCancelExecute). `npx tsc --noEmit`: zero errors.
    Re-ran tests/book-session-deadlock.test.ts (rewritten from a falsification
    test into a regression test asserting the FIXED behavior) against the
    same real local Postgres: now completes in 44-51ms with a single
    "withBusinessContext: entry" log line (no nesting) and a correct single
    deduction (sessionsRemaining 3 -> 2, exactly 1 ledger row), instead of the
    pre-fix ~10019ms timeout failure.
  found: >
    Ran the broader existing test suite covering every function touched
    (session-cancel.test.ts, session-cascade.test.ts, session-creation.test.ts,
    session-expansion.test.ts, session-booking-flow.test.ts, plus
    billing-session-deduction.test.ts, enforcement-session-deduction.test.ts,
    session-list.test.ts, session-assignment.test.ts,
    session/session-approval.test.ts, ai-owner-cancel-session.test.ts). First
    attempt (default Jest concurrency, 12 files at once) showed widespread
    "Exceeded timeout of 5000ms for a hook" failures in beforeAll blocks
    across UNRELATED files (billing-session-deduction, session-assignment,
    session-creation, session-cancel, session/session-approval) — all failing
    inside insertTestBusiness() itself (a plain admin-db insert with zero
    connection to the guard logic changed), plus one normal (non-nested,
    single-entry-log) withBusinessContext transaction elapsedMs:7167 in an
    otherwise-trivial operation. Diagnosed as DB/connection-pool contention
    from running many heavy real-Postgres integration-test files' Jest
    WORKER PROCESSES concurrently (each opens 2 pools, each max=10
    connections, each with connectionTimeoutMillis=5000 — matching the exact
    5000ms hook-timeout figure) against a modest local Docker Postgres
    container that had also accumulated 331 businesses/848 session_instances/
    440 bookings from repeated runs this session — NOT a functional
    regression (confirmed: insertTestBusiness has zero relationship to
    isInBusinessContext/withBusinessContext nesting). Re-ran the same files
    with --runInBand (serial, no worker concurrency) to remove the
    contention confound: ALL files passed except session-booking-flow.test.ts,
    which fails on exactly ONE pre-existing, unrelated test-fixture bug (SBOK-04
    "multi-booking partial success" calls
    insertTestSessionCatalog(businessId, serviceId, {capacity:5}) reusing the
    SAME (businessId, serviceId) pair as the describe block's own beforeAll
    catalog, violating the unique_active_catalog_per_business_service partial
    unique index) — confirmed via direct code read that this failure occurs
    inside insertTestSessionCatalog (tests/helpers/session-fixtures.ts), a
    raw admin-db `db.insert(sessionCatalog)` call with NO relationship
    whatsoever to withBusinessContext/isInBusinessContext or anything changed
    in this fix; same failure occurred identically in both the first
    (concurrent) and second (serial) runs, confirming it is a stable,
    reproducible, pre-existing test-fixture bug in session-booking-flow.test.ts
    itself, unrelated to and pre-dating this fix.
  implication: >
    FIX VERIFIED with no regressions. All functional behavior across every
    test file exercising the 4 modified functions is unchanged except for the
    fixed deadlock itself. The only failing test in the entire targeted
    regression run is a pre-existing, unrelated test-fixture defect (not
    touched by this fix, not a regression it introduces) — noted here for
    visibility but explicitly out of scope for this incident. Test DB
    container (randevuclaw-pg) stopped after verification, per operational
    constraint to leave the environment as found.

## Eliminated

- hypothesis: "The widespread post-fix test failures (session-assignment,
    session-creation, session-cancel, session/session-approval,
    billing-session-deduction all showing 'Exceeded timeout of 5000ms for a
    hook') indicate the fix introduced a regression."
  evidence: "Every one of those failures occurred inside insertTestBusiness()
    or an equivalent plain admin-db beforeAll setup call — code with zero
    relationship to isInBusinessContext()/withBusinessContext nesting logic.
    Re-running the identical file set with --runInBand (serial, no Jest
    worker concurrency) made every one of these failures disappear
    completely, while the ONE genuinely pre-existing, unrelated
    session-booking-flow.test.ts fixture bug persisted unchanged in both
    runs. This isolates the cause to DB/connection-pool contention from
    concurrent Jest workers against a modest local Postgres container
    (connectionTimeoutMillis=5000 matches the exact hook-timeout figure
    observed), not a code regression."
  timestamp: 2026-08-13 (this session)

- timestamp: 2026-08-13 (session-manager independent re-verification, prior to commit)
  checked: >
    Before committing, the session-manager independently re-ran (not merely
    trusted the report of) the verification above from a cold state:
    started randevuclaw-pg (was stopped), ran
    `npx jest --testPathPattern book-session-deadlock --runInBand` fresh, plus
    two additional targeted files exercising the other two guarded functions
    not covered by the new test (session-cancel.test.ts, session-cascade.test.ts),
    then `npx tsc --noEmit`, then stopped the container again.
  found: >
    book-session-deadlock.test.ts: 2/2 passed (regression case 62ms, control
    case 11ms — both single "withBusinessContext: entry" per attempt, no
    nesting). session-cancel.test.ts + session-cascade.test.ts: 12/12 passed
    (the "Telegram API error: 403 Forbidden" lines in the output are an
    intentionally-mocked notification-failure-path assertion in those tests,
    not a real failure). `npx tsc --noEmit`: zero output, zero errors.
  implication: >
    Fix independently confirmed working from a cold environment, not merely
    accepted from a relayed report. Proceeding to commit the code fix and
    regression test. NOT moving this file to resolved/ or creating a
    "docs: resolve debug" commit — the checkpoint above explicitly requires
    human confirmation of real production behavior post-deploy, which has not
    happened yet and cannot be satisfied by any agent-to-agent relay.

## Resolution

root_cause: |
  src/session/manager.ts's bookSessionInstance, cancelSession, and
  cascadeCancelSessionBookings all unconditionally called
  withBusinessContext(businessId, ...) with no isInBusinessContext() guard —
  unlike the WR-02-guarded pattern already established in
  src/telegram/handlers/payment-flow.ts's showClientSelection. Several call
  sites (client-menu.ts's handleBookSessionExecute, telegram.ts's
  escl:approve branch, admin-menu.ts's handleClassCancelExecute) invoke
  these functions from INSIDE telegram.ts's outer withBusinessContext wrap
  (handleTelegramWebhookPost -> handleCallbackQuery, telegram.ts:1490). For a
  client WITH an active membership, checkEnforcementAndGetMembership has
  already taken a SELECT ... FOR UPDATE lock on that client's memberships
  row on the OUTER transaction's connection. bookSessionInstance then opened
  a SECOND, nested transaction on a DIFFERENT pooled connection; inside it,
  deductSession's INSERT into membership_ledger (which FK-references
  memberships.id) requires an implicit FOR KEY SHARE lock on that same
  memberships row — which conflicts with, and blocks on, the outer
  transaction's FOR UPDATE lock. Meanwhile the outer transaction is itself
  blocked awaiting bookSessionInstance's promise. Two connections from the
  same Node process deadlocked on each other, invisible to Postgres's own
  deadlock detector (not a lock cycle from a single backend's perspective) —
  resolved only by the server-side statement_timeout (10s), which is what
  produced the ~24s (~2x10s, including a rollback-timeout retry) failure and
  silent booking failure observed in production. Confirmed by live DB
  reproduction (see Evidence): the exact scenario failed after
  ~10019ms/10055ms with "canceling statement due to statement timeout"; the
  control scenario (no membership, no lock) completed in 27ms.
fix: |
  Added the isInBusinessContext() guard (mirroring
  src/telegram/handlers/payment-flow.ts's showClientSelection convention
  exactly) to all 4 functions in src/session/manager.ts that unconditionally
  opened withBusinessContext: bookSessionInstance, cancelSession,
  cascadeCancelSessionBookings, and createSessionCatalogWithExpansion (the
  4th guarded for defense-in-depth/consistency even though no live call site
  currently nests it — the guard is a strict no-op when not already in a
  business context). Each function now extracts its body into a `run`
  closure and calls `isInBusinessContext() ? run() : withBusinessContext(businessId, run)`
  — reusing the ambient transaction via getConn() when one is already open,
  instead of opening a second one on a different pooled connection. This
  closes the entire hazard class in the file (including the two additional
  live call sites confirmed nested — telegram.ts:803's escl:approve branch
  and admin-menu.ts's handleClassCancelExecute — not just the one with
  direct production evidence), not just a single symptom.
verification: |
  1. Live DB falsification test (pre-fix): tests/book-session-deadlock.test.ts
     reproduced the exact deadlock against a real local Postgres — failed
     after ~10019ms/10055ms with "canceling statement due to statement
     timeout", matching DB_STATEMENT_TIMEOUT_MS exactly; sessionsRemaining
     confirmed unchanged (both transactions rolled back cleanly, no
     connection leak). Control (no membership) completed in 27ms.
  2. Fix applied; `npx tsc --noEmit`: zero errors.
  3. Same test re-run post-fix (rewritten into a regression test asserting
     the correct/fixed behavior): completes in 44-51ms with a single
     withBusinessContext entry (no nesting) and a correct single deduction
     (sessionsRemaining 3 -> 2, exactly 1 ledger row for the booking).
  4. Broader regression suite (session-cancel.test.ts, session-cascade.test.ts,
     session-creation.test.ts, session-expansion.test.ts,
     session-booking-flow.test.ts, billing-session-deduction.test.ts,
     enforcement-session-deduction.test.ts, session-list.test.ts,
     session-assignment.test.ts, session/session-approval.test.ts,
     ai-owner-cancel-session.test.ts) run twice: once concurrently (surfaced
     an unrelated DB-connection-pool-contention artifact, diagnosed and
     eliminated — see Eliminated section) and once serially (--runInBand,
     removes the contention confound) — ALL passed except one pre-existing,
     unrelated fixture bug in session-booking-flow.test.ts (SBOK-04 partial
     success test, a unique-constraint collision in the test's own catalog
     setup, unrelated to withBusinessContext/isInBusinessContext and not
     touched by this fix).
  5. Test Postgres container (randevuclaw-pg) stopped after verification per
     operational constraint.
  6. NOT YET verified live in production (fly.io) — pending human
     confirmation per find_and_fix mode's required checkpoint before this
     session is archived.
files_changed:
  - src/session/manager.ts (added isInBusinessContext() WR-02 guard to
    bookSessionInstance, cancelSession, cascadeCancelSessionBookings,
    createSessionCatalogWithExpansion)
  - tests/book-session-deadlock.test.ts (new: falsification test that
    reproduced the deadlock pre-fix, rewritten into a regression test
    asserting the fixed behavior post-fix)
