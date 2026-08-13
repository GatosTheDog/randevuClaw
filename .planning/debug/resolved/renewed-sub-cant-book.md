---
status: resolved
trigger: "Client renewed subscription/membership, has sessions remaining, package should be active — bot still refuses booking with a message like 'χρειάζεστε ενεργή συνδρομή'."
created: 2026-08-13
updated: 2026-08-13T09:14:42.000Z
resolved: 2026-08-13T09:14:42.000Z
commit: 9d92e62
---

## Symptoms

- **Expected behavior:** After a client renews their membership/package and has sessions remaining and a valid (future) expiry, `bookAppointmentTool`/`bookSessionTool` should allow booking.
- **Actual behavior:** Client renewed, has sessions remaining, but bot refuses booking as if there's no active subscription.
- **Error messages:** Bot replies with enforcement block message (Greek), e.g. "Για να κάνετε κράτηση, χρειάζεστε ενεργή συνδρομή." (from `src/billing/enforcement.ts` block path).
- **Timeline:** Reported now; unclear if regression or has always been broken for renewals specifically (as opposed to first-time purchases).
- **Reproduction:** Client had an existing membership (possibly expired or exhausted), then renewed. Renewal should replace/update the active membership row. Booking attempt right after renewal fails enforcement check.

## Prior investigation (from code review, not yet verified as root cause)

Suspect areas to verify with evidence, not just inspection:

1. **Timezone bug hypothesis:** `memberships.expires_at` is a plain `TIMESTAMP` (no `WITH TIME ZONE`) — see `migrations/0006_billing_schema.sql:66` and `src/database/schema.ts:328` (`timestamp('expires_at').notNull()`, no `{ withTimezone: true }`), despite inline comments claiming tz-safety. Both `getActiveMembershipForDeduction` (`src/billing/queries.ts:419-436`) and `getClientActiveMembership` (`src/billing/queries.ts:676` area) use `gt(memberships.expiresAt, new Date())` (strict greater-than). If the DB session timezone or app process's local timezone isn't UTC, a genuinely-valid membership could compare as already expired.
2. **Renewal upsert hypothesis:** `memberships` has partial unique index `unique_active_membership` on `(businessId, clientPhone)` WHERE `isActive` (schema.ts, ~line 311-336). Renewal likely does an `onConflictDoUpdate`. Need to verify: does renewal correctly update `sessionsRemaining`, `expiresAt`, and `isActive` on the existing row? Is there any path where a stale/expired/exhausted row survives instead of being replaced by the renewal's fresh values (e.g., a race, wrong conflict target, or the old row not matching the partial index predicate because `isActive` was already flipped false, so the insert creates a second inactive-then-active row instead of updating)?
3. Enforcement gate: `checkEnforcementAndGetMembership` (`src/billing/enforcement.ts:41-69`) calls `getActiveMembershipForDeduction`. If that query returns `null` post-renewal (due to #1 or #2), `hasCapacity` is false and booking is blocked regardless of `sessionsRemaining`.

## Current Focus
<!-- OVERWRITE on each update - always reflects NOW -->

```yaml
reasoning_checkpoint:
  hypothesis: >
    createMembership() (src/billing/queries.ts) throws and rolls back its ENTIRE
    transaction — including the legitimate memberships.onConflictDoUpdate that would
    have set fresh expiresAt/sessionsRemaining/isActive=true — whenever a client's
    renewal payment is recorded on the same Athens calendar day as any prior
    payment_recorded ledger entry for that same membership row. This happens because
    (a) nothing in the codebase ever sets memberships.isActive=false, so the same
    client's membership row (and therefore memberId) never changes across renewals,
    and (b) the ledger idempotencyKey is
    `${businessId}:${clientPhone}:payment_recorded:${purchaseDate}:${memberId}` — for
    a same-day second renewal all four components are identical to the first
    renewal's key, so the plain `.insert()` (no onConflictDoNothing) hits the UNIQUE
    constraint on membership_ledger.idempotency_key and throws, and
    runInTransaction's clientDb.transaction() rolls back everything, including the
    membership row update. The owner sees a generic error
    ("Σφάλμα κατά την καταγραφή πληρωμής. Ελέγξτε αν η συνδρομή ήδη υπάρχει...")
    that does not convey the renewal failed, so the membership row is left with its
    PRE-renewal (expired/exhausted) expiresAt/sessionsRemaining/isActive, which
    getActiveMembershipForDeduction / checkEnforcementAndGetMembership then correctly
    (from the DB's-eye view) treats as "no active membership" and blocks booking.
  confirming_evidence:
    - "src/billing/queries.ts:361-372 — createMembership's onConflictDoUpdate targets [businessId, clientPhone] WHERE isActive=true and correctly sets fresh expiresAt/sessionsRemaining/isActive=true — the intended renewal update logic is correct in isolation."
    - "src/billing/queries.ts:380-389 — the membership_ledger insert has NO onConflictDoNothing (unlike deductSession/restoreCredit/linkRescheduledBooking which all guard with onConflictDoNothing), so a UNIQUE idempotency_key collision throws instead of no-op'ing."
    - "src/database/db.ts:105-129 runInTransaction wraps the callback in clientDb.transaction(...); any thrown error inside the callback causes drizzle to ROLLBACK the whole transaction (confirmed by reading drizzle's transaction semantics + the try/catch here rethrowing txError)."
    - "grep across src/ for `memberships).*isActive.*false` / `update(memberships)` confirms memberships.isActive is NEVER set to false anywhere in the codebase — only billingPackages.isActive is ever deactivated. So the code comment at queries.ts:317-318 ('A legitimate renewal after the previous membership was deactivated produces a new memberId') describes a code path that does not exist — memberId is always identical across renewals for the same client."
    - "tests/billing-membership-creation.test.ts:106-132 ('idempotency_key prevents duplicate membership_ledger rows on replay') already asserts exactly this rollback behavior happens today: calling createMembership twice for the same client produces a rejected promise, and the codebase treats this as intended replay protection."
    - "PRIMARY CORROBORATION: .planning/milestones/v1.2-phases/07-billing-configuration-payment-recording/07-REVIEW.md WR-05 (lines 317-334) — the ORIGINAL code review already found and described this exact bug: 'if the owner legitimately records a second payment for the same client on the same calendar day (client bought in the morning, used all sessions, owner records a renewal the same afternoon), the ledger INSERT hits the UNIQUE constraint and rolls back the entire transaction — including the membership upsert. The second payment is silently lost.' The review's own suggested fix (append memberId, OR use Date.now()/UUID for the two-different-rows case) was only PARTIALLY applied."
    - "07-REVIEW-FIX.md WR-05 (lines 81-85) confirms only the memberId suffix was applied ('Applied fix: Appended memberId to the idempotency key... Note: double-tap on the same active membership row still triggers a constraint violation... preserving the T-07-04 replay guard') — i.e. the fix explicitly left the same-row/same-day case unresolved, mistakenly treating it as intentional double-tap protection rather than the legitimate-renewal regression the original WR-05 finding described."
    - "handleConfirmMembership (src/telegram/handlers/payment-flow.ts:204-259) already receives a `callbackQueryId` parameter that is UNIQUE per Telegram user tap (and stable across webhook-retry redeliveries of the same tap) but currently does NOT use it for idempotency — it's a dead parameter inside the function body after WR-02 removed the internal answerCallbackQuery call."
  falsification_test: >
    If memberships.isActive were ever set to false somewhere (making memberId change
    across renewals) OR if the ledger insert used onConflictDoNothing, this hypothesis
    would be false. Neither is the case (confirmed via grep + full read of queries.ts).
    A live DB reproduction (create membership, exhaust or backdate it, call
    createMembership again same day, assert the second call throws AND the
    memberships row still has the OLD expiresAt/sessionsRemaining) would directly
    confirm this — blocked in this environment by no local/reachable Postgres
    instance (no DATABASE_URL, no local psql). Falling back to the existing test
    (tests/billing-membership-creation.test.ts:106-132), which already exercises and
    asserts this exact rollback mechanism as passing/expected behavior today, as
    the closest available executed evidence.
  fix_rationale: >
    Root cause is the idempotency key design conflating two distinct concerns:
    (1) true replay protection (same Telegram update redelivered) and (2) business
    identity of the renewal (same client, same day). Telegram guarantees
    callback_query.id is unique per tap and stable across redelivery retries of that
    tap — this is the correct idempotency key material, not a synthesized
    business/date/memberId string. Fix: make createMembership accept a caller-
    supplied idempotencyKey (matching the existing pattern already used by
    deductSession/restoreCredit/linkRescheduledBooking, all of which take
    idempotencyKey as a parameter rather than deriving it from business fields), and
    have handleConfirmMembership pass a key derived from the already-available
    callbackQueryId. This fixes the root cause (wrong idempotency scope) rather than
    the symptom (could not just catch-and-ignore the ledger insert error, since that
    would silently accept legitimate renewals but also silently swallow real
    double-tap replays without any distinguishing signal).
  blind_spots: >
    Have not verified live against a real Postgres instance in the original
    environment (none reachable there) — relying on static code tracing +
    drizzle/pg source inspection + the project's own prior review documentation
    (07-REVIEW.md/07-REVIEW-FIX.md) which independently found and partially fixed
    the same defect, PLUS a subsequent live verification against a real Postgres 16
    instance (see Resolution.verification below). The original timezone hypothesis
    (plain `timestamp` column without `withTimezone`, per schema.ts:328 and
    migrations/0006_billing_schema.sql:66, contradicting inline comments claiming
    "TIMESTAMP WITH TIME ZONE") was NOT disproven, only deprioritized — it remains a
    theoretical secondary risk if the fly.io process ever runs with a non-UTC TZ, but
    is not required to explain the reported symptom and is out of scope for this fix.
    Also have not verified whether Telegram ever redelivers a callback_query with a
    genuinely different ID for what a user perceives as "the same tap" (would weaken
    the new fix's replay protection, but would not reintroduce the renewal-rollback
    bug either way). Live end-to-end verification against the real Telegram bot in
    production has NOT been performed — deferred to post-deploy per explicit user
    decision (see Resolution.verification human checkpoint note).
```

- **next_action:** RESOLVED. Human checkpoint accepted code review + full test suite + tsc clean as sufficient evidence, explicitly deferring the live Telegram click-test to post-deploy. Fix committed as 9d92e62. Session archived to .planning/debug/resolved/renewed-sub-cant-book.md.

## Evidence
<!-- APPEND only - facts discovered during investigation -->

- timestamp: 2026-08-13
  checked: src/billing/queries.ts createMembership (lines 299-398) — the renewal upsert (onConflictDoUpdate) and the ledger insert (idempotency-guarded)
  found: onConflictDoUpdate targets (businessId, clientPhone) WHERE isActive=true and correctly sets fresh expiresAt/sessionsRemaining/isActive=true on renewal. But the ledger insert right after (line 383) has no onConflictDoNothing, and its idempotencyKey (`${businessId}:${clientPhone}:payment_recorded:${purchaseDate}:${memberId}`) is IDENTICAL across any two createMembership calls for the same client on the same Athens calendar day, because memberId never changes (see next finding).
  implication: A same-day second renewal call throws on the ledger insert's UNIQUE constraint violation, and since this all runs inside runInTransaction's clientDb.transaction(), the throw rolls back the ENTIRE transaction — undoing the membership row's legitimate update too.

- timestamp: 2026-08-13
  checked: grep across src/ for any `memberships` UPDATE setting isActive to false
  found: No code path anywhere sets memberships.isActive = false. Only billingPackages.isActive is ever deactivated (D-03 soft-delete for packages). The inline comment at queries.ts:317-318 claiming "a legitimate renewal after the previous membership was deactivated produces a new memberId" describes a code path that does not exist in this codebase.
  implication: memberId is permanently stable per (businessId, clientPhone) — every renewal for an existing client updates the SAME row via onConflictDoUpdate, so the ledger idempotencyKey's only varying component across separate renewal events is purchaseDate (today's Athens date). Collision — and therefore full-transaction rollback — is guaranteed whenever two createMembership calls happen for the same client on the same calendar day, regardless of whether that's an accidental double-tap or a legitimate distinct renewal (e.g. exhausted pack renewed same afternoon).

- timestamp: 2026-08-13
  checked: .planning/milestones/v1.2-phases/07-billing-configuration-payment-recording/07-REVIEW.md (WR-05) and 07-REVIEW-FIX.md (WR-05)
  found: The ORIGINAL code review for this phase already identified this exact bug — "if the owner legitimately records a second payment for the same client on the same calendar day... the ledger INSERT hits the UNIQUE constraint and rolls back the entire transaction — including the membership upsert. The second payment is silently lost." The suggested fix included appending memberId (handles the "two different rows" sub-case) OR a Date.now()/UUID suffix (handles the "same row, same day" case — the one that actually matters, since rows are never deactivated). Only the memberId suffix was applied; the REVIEW-FIX explicitly reframes the still-blocked same-row/same-day case as "preserving the T-07-04 replay guard" rather than recognizing it as the unresolved regression.
  implication: This is not a novel bug — it's a known, previously-flagged defect (WR-05) whose fix was incomplete. Directly corroborates the hypothesis via independent historical evidence (a prior code review reaching the same conclusion by different means).

- timestamp: 2026-08-13
  checked: src/telegram/handlers/payment-flow.ts handleConfirmMembership signature and body (lines 204-259)
  found: The function already receives `callbackQueryId` as a parameter (Telegram's per-tap unique, redelivery-stable identifier) but never uses it inside the function body — it became a dead parameter after the WR-02 fix removed the internal `answerCallbackQuery(callbackQueryId)` call.
  implication: callbackQueryId is available, unused, and is the semantically correct idempotency key material (true replay detection) as opposed to synthesizing a key from business/date/memberId (which conflates "same tap redelivered" with "same client renewed same day" — two very different events that should NOT share a key).

- timestamp: 2026-08-13 — session-manager independent verification (post-checkpoint, before commit)
  checked: git diff of src/billing/queries.ts and src/telegram/handlers/payment-flow.ts; `npx tsc --noEmit`; `npx jest --testPathPattern="billing-membership-creation|billing-payment-flow"`; independent re-grep of the isActive claim; direct read of 07-REVIEW.md/07-REVIEW-FIX.md WR-05 sections.
  found: tsc clean. billing-payment-flow.test.ts (mocked, no DB) 15/15 pass, including the updated assertion that createMembership is called with `billing:mem_confirm:cb-query-id-3`. billing-membership-creation.test.ts (DB-integration) could not be re-executed in this session's shell — no reachable/correctly-provisioned Postgres for this repo (only an unrelated project's container was running on port 5432; docker inspect confirmed POSTGRES_USER=baseuser, databases ispai/textanalysis). The grep and WR-05/WR-05-FIX claims were independently re-verified and match exactly.
  implication: Environment limitation in the finalizing session, not a code regression — every test in that file fails identically at the same pre-logic DB-connect line (insertTestBusiness), consistent with "no DB reachable" rather than "fix broke something." Combined with the debugger's own earlier live verification against a real Postgres 16 instance (see Resolution.verification) and this session's independent tsc/unit-test/code-review pass, this satisfies the human-accepted verification bar (code review + full test suite + tsc clean; live Telegram click-test deferred to post-deploy).

## Eliminated
<!-- APPEND only - prevents re-investigating after /clear -->

(none — the original timezone hypothesis was deprioritized, not disproven; see reasoning_checkpoint.blind_spots above. It remains a secondary theoretical risk not required to explain the reported symptom.)

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: >
  createMembership() (src/billing/queries.ts) derives its membership_ledger
  idempotencyKey from `${businessId}:${clientPhone}:payment_recorded:${purchaseDate}:${memberId}`.
  Since memberships.isActive is never set to false anywhere in the codebase, memberId
  is permanently stable per (businessId, clientPhone) — every renewal for an existing
  client updates the SAME row. This means the idempotencyKey is identical for any two
  renewal payments recorded for the same client on the same Athens calendar day. The
  ledger insert has no onConflictDoNothing guard, so the second same-day renewal
  throws on the UNIQUE constraint, and because both the ledger insert and the
  memberships onConflictDoUpdate run inside the same runInTransaction(pool, ...) call,
  the throw rolls back BOTH — silently discarding the legitimate membership renewal
  (fresh expiresAt/sessionsRemaining/isActive=true) along with the ledger write. The
  owner sees a generic, non-diagnostic error message and has no way to know the
  renewal did not take effect. This is a previously-flagged-but-incompletely-fixed
  defect (WR-05 in 07-REVIEW.md / 07-REVIEW-FIX.md from the original Phase 7 review).
fix: >
  Made createMembership()'s `idempotencyKey` a REQUIRED caller-supplied parameter
  instead of deriving it internally from
  `${businessId}:${clientPhone}:payment_recorded:${purchaseDate}:${memberId}`.
  handleConfirmMembership (payment-flow.ts) now passes
  `` `billing:mem_confirm:${callbackQueryId}` `` — Telegram's callback_query.id is
  unique per user tap and stable across webhook-redelivery retries of that same
  tap, so exact replay (same tap redelivered) is still blocked and rolls back
  correctly, while two DISTINCT renewals for the same client on the same Athens
  calendar day (the actual reported bug) now each get their own key and both
  succeed — the second correctly overwrites expiresAt/sessionsRemaining/
  isActive on the same membership row instead of colliding and rolling back.
verification: >
  Live-verified against a real Postgres 16 instance (docker container, all 14
  migrations + drizzle-kit push applied) since no reachable DB existed in the
  original investigation environment:
  - tests/billing-membership-creation.test.ts (6 tests, including 2 rewritten +
    1 new regression test) — all pass. The new test
    "two same-day renewals with different idempotency keys both succeed and the
    second overwrites membership fields" directly reproduces the exact bug
    scenario (same client, same day, 1-session pack exhausted then renewed with
    a 10-session pack) and confirms both createMembership calls succeed, the
    membership row is updated to the SECOND package's values
    (packageId/sessionsRemaining/isActive), and both ledger rows persist (no
    rollback). Live logs show memberId stays identical across both calls
    (confirming the "memberId never changes" evidence) and expiresAtDate moves
    from 2026-08-23 (first, 10-day pack) to 2026-09-12 (second, 30-day pack) —
    proving the second write took effect.
  - The rewritten exact-replay test (same callbackQueryId-derived key twice)
    still correctly throws and rolls back — true double-tap/webhook-redelivery
    protection is preserved.
  - Full regression pass across related suites: billing-payment-flow.test.ts,
    billing-enforcement-policy.test.ts, billing-package-creation.test.ts,
    booking-enforcement.test.ts, enforcement-session-deduction.test.ts — 39/39
    tests pass across all 6 suites, no regressions.
  - `npx tsc --noEmit` — clean, no type errors from the signature change.
  - Session-manager independent re-verification (before commit, separate shell
    with no reachable project-specific Postgres): `npx tsc --noEmit` clean;
    `npx jest --testPathPattern="billing-membership-creation|billing-payment-flow"`
    — billing-payment-flow.test.ts (mocked) 15/15 pass; billing-membership-creation.test.ts
    (DB-integration) could not be re-executed (no reachable DB in that shell —
    environment gap, not a regression: all failures were identical DB-connect
    errors at the same pre-logic line, unrelated to the fix). Diff content,
    the "isActive never set false" grep claim, and the WR-05/WR-05-FIX
    citations were independently re-checked against the actual files and match.
  HUMAN CHECKPOINT (2026-08-13): user confirmed "Commit now" — accepted code
  review + full test suite + tsc clean as sufficient evidence, explicitly
  deferring the live Telegram click-test to post-deploy. Fix committed as
  9d92e62.
  Not yet verified: end-to-end against the real Telegram bot / production
  deployment — deferred to post-deploy per explicit user decision above.
files_changed:
  - src/billing/queries.ts (createMembership signature + JSDoc — idempotencyKey
    is now a required caller-supplied parameter)
  - src/telegram/handlers/payment-flow.ts (handleConfirmMembership passes
    callbackQueryId-derived idempotencyKey)
  - tests/billing-membership-creation.test.ts (updated 5 call sites, rewrote
    replay test, added same-day-different-key regression test)
  - tests/billing-payment-flow.test.ts (updated createMembership
    call-argument assertion)
