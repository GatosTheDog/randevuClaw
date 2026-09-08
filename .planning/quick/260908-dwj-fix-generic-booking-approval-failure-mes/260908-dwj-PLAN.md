---
phase: quick-260908-dwj
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/webhooks/telegram.ts
  - tests/webhooks/client-menu.test.ts
autonomous: true
requirements: []

must_haves:
  truths:
    - "When an owner taps Έγκριση/Απόρριψη on a sbk: session booking that already auto-expired (2-hour pending-approval window elapsed), the owner sees a message explicitly stating it expired and to ask the client to book again — not the generic 'not found or already processed' message."
    - "When an owner taps on a sbk: session booking that was already confirmed by a prior action, the owner sees a message stating it was already approved."
    - "When an owner taps on a sbk: session booking that was already cancelled or rejected, the owner sees a message stating it was already rejected."
    - "When the booking genuinely cannot be found by id on the post-CAS-miss re-read, the owner still sees the original generic 'Η κράτηση δεν βρέθηκε ή έχει ήδη επεξεργαστεί.' message, unchanged."
    - "This 4-way distinction applies identically on BOTH the sbk:approve and sbk:reject callback flows — neither call site is left with the old single generic message."
  artifacts:
    - "src/webhooks/telegram.ts: new module-scope resolveSbkCasFailureMessage(currentStatus) helper, placed immediately above the `if ('sbkAction' in parsed)` block, returning one of 4 Greek messages based on 'expired' / 'confirmed' / 'cancelled'-or-'rejected' / anything else (default, including null/undefined)."
    - "src/webhooks/telegram.ts: both the sbkAction approve arm's and reject arm's `if (!updated)` block (on a updateBookingStatusIfPending CAS miss) now does a FRESH findBookingByIdUnscoped(sbk.bookingId) re-read and passes its bookingStatus into resolveSbkCasFailureMessage before sending the result to the owner."
    - "tests/webhooks/client-menu.test.ts Suite F: 8 new tests (4 status branches x 2 actions) proving each branch sends the correct message and never falls through into the reschedule-cascade/capacity-release code paths."
  key_links:
    - "updateBookingStatusIfPending(sbk.bookingId, ...) returns null (CAS miss) -> findBookingByIdUnscoped(sbk.bookingId) fresh re-read (never reusing the earlier pre-CAS targetBooking read used for the T-22-02 cross-tenant guard) -> resolveSbkCasFailureMessage(currentBooking?.bookingStatus) -> sendTelegramMessage(senderTelegramId, message)."
---

<objective>
Fix the sbk: session-booking approve/reject owner callback handlers in `src/webhooks/telegram.ts` so that a `updateBookingStatusIfPending` CAS miss no longer always reports the same generic "not found or already processed" message. Instead, re-read the booking's actual current status and tell the owner specifically whether it already expired (2-hour auto-expiry), was already approved, was already rejected/cancelled, or genuinely doesn't exist.

Purpose: An owner tapping a stale approve/reject button currently gets zero useful signal about WHY the tap failed — most commonly because the booking auto-expired 2 hours after creation (D-09), which looks identical to "someone already handled this" or "bad tap". A precise message lets the owner correctly tell the client to re-book (expired) vs. do nothing (already resolved).

Output: Updated `src/webhooks/telegram.ts` (both sbkAction approve and reject arms share one new helper), and 8 new regression tests in `tests/webhooks/client-menu.test.ts` (Suite F) covering all 4 branches on both call sites.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

**Target code (read in full already) — `src/webhooks/telegram.ts`'s `if ('sbkAction' in parsed) { ... }` block (currently lines 927-1044):** This is the Phase 22 (OWNR-05/06/07) session-class booking approve/reject handler, discriminated from every other callback_query branch by `'sbkAction' in parsed`. It is NOT the same code as the older, separate `approve_<id>`/`reject_<id>` legacy handler further down the file (~line 1233+, for open-slot bookings) — that legacy branch silently ignores a CAS miss with zero owner-facing message and is explicitly OUT OF SCOPE for this fix; do not touch it.

Inside the sbkAction block: a `targetBooking = await findBookingByIdUnscoped(sbk.bookingId)` read happens near the top (T-22-02 cross-tenant guard, ~line 949) BEFORE the CAS attempt — this is a pre-CAS snapshot and must never be reused to determine the post-CAS-miss message, since a race could have changed the booking's status between that read and the CAS attempt. The approve arm (~lines 958-966) calls `const updated = await updateBookingStatusIfPending(sbk.bookingId, 'confirmed');` then, on `!updated`, currently does `await sendTelegramMessage(senderTelegramId, 'Η κράτηση δεν βρέθηκε ή έχει ήδη επεξεργαστεί.'); return;`. The reject arm's `else` block (~lines 1000-1005) does the exact same thing with `updateBookingStatusIfPending(sbk.bookingId, 'rejected')`.

**Known bookingStatus values in this codebase (verified via grep across src/):** `pending_owner_approval` (initial), `confirmed`, `rejected`, `cancelled`, `expired` (set by `expireStalePendingBookings` in `src/database/queries.ts`, driven by `src/conversation/expiry-poller.ts`'s `EXPIRY_CUTOFF_MS = 2 * 60 * 60 * 1000` — the 2-hour D-09 window). Since a CAS miss means the row is no longer `pending_owner_approval`, the re-read's status will be one of `confirmed` / `rejected` / `cancelled` / `expired` — or the row may be gone entirely (`null`), or in principle some future/unknown value, which must safely fall back to the existing generic message rather than crash or mislead.

**`findBookingByIdUnscoped` (verified in `src/database/queries.ts`, ~line 492):** already imported at the top of `telegram.ts` (line 6) — a plain unscoped-by-business SELECT by id, returning `Booking | null`. No new import needed; this task only adds one more call to it, inside each `if (!updated)` block, after the CAS has already failed.

**`src/utils/greek-messages.ts` (read in full already):** its own top-of-file comment documents its scope as button-LABEL strings only ("no prompt-template functions"), per D-07. The 4 new sentences this task adds are full sentences, not button labels, and every other Greek message in `telegram.ts` (including the two existing strings this task replaces) is already an inline string literal in that file — so the 4 new messages stay inline in `telegram.ts` too, consistent with the surrounding code, not added to `greek-messages.ts`.

**Test file for this exact branch — `tests/webhooks/client-menu.test.ts` (read relevant sections already), NOT `tests/telegram-webhook.test.ts`:** `tests/telegram-webhook.test.ts`'s "callback_query owner approval (Plan 02-05)" describe block tests the unrelated legacy `approve_<id>`/`reject_<id>` handler (uses `approve_42`/`reject_42` callback_data, not `sbk:approve:...`). The correct target is `tests/webhooks/client-menu.test.ts`'s `describe('Suite F: sbk: session booking approval routing', ...)` block (~line 1424), which already has `SESSION_BOOKING` fixture, `mockedFindBookingByIdUnscoped`, `mockedUpdateBookingStatusIfPending`, `mockedSendTelegramMessage`, `postToWebhook`, and `makeCallbackQueryUpdate` all set up and in scope, plus an existing "T-22-03 double-tap idempotency" test (~line 1521) as the closest precedent for a CAS-miss test in this exact suite.

@src/webhooks/telegram.ts
@tests/webhooks/client-menu.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Status-aware sbk: approve/reject failure messaging</name>
  <files>src/webhooks/telegram.ts</files>
  <action>
Add a new module-scope function `resolveSbkCasFailureMessage(currentStatus: string | null | undefined): string` immediately above the `if ('sbkAction' in parsed) {` line (~line 933). It switches on `currentStatus`: case `'expired'` returns "Η κράτηση έληξε αυτόματα (πέρασαν 2 ώρες χωρίς απάντηση). Ζητήστε από τον πελάτη να κάνει νέα κράτηση."; case `'confirmed'` returns "Η κράτηση έχει ήδη εγκριθεί."; cases `'cancelled'` and `'rejected'` (fallthrough, same return) return "Η κράτηση έχει ήδη απορριφθεί."; the `default` case (covers `null`, `undefined`, and any other/unrecognized status value — never throws or crashes on an unexpected value) returns the existing generic string "Η κράτηση δεν βρέθηκε ή έχει ήδη επεξεργαστεί." verbatim, matching exactly what both call sites already send today so this default is a strict behavioral superset, never a regression. Add a short header comment above the function referencing this quick task and explaining that `currentStatus` must come from a FRESH lookup taken AFTER a CAS miss, never from the pre-CAS `targetBooking` snapshot read earlier in this same block for the T-22-02 cross-tenant guard, since a race could change the booking's status between the two reads.

In the approve arm (`if (sbk.sbkAction === 'approve')`, ~lines 958-966): the `if (!updated) { await sendTelegramMessage(senderTelegramId, 'Η κράτηση δεν βρέθηκε ή έχει ήδη επεξεργαστεί.'); return; }` block changes to: call `const currentBooking = await findBookingByIdUnscoped(sbk.bookingId);` (a second, fresh call to this function — distinct from the earlier `targetBooking` read), then `await sendTelegramMessage(senderTelegramId, resolveSbkCasFailureMessage(currentBooking?.bookingStatus));`, then `return;` unchanged.

Apply the identical replacement to the reject arm's `else` block (~lines 1000-1005): same fresh `findBookingByIdUnscoped(sbk.bookingId)` call, same `resolveSbkCasFailureMessage(currentBooking?.bookingStatus)` call, same `sendTelegramMessage(senderTelegramId, ...)` and `return`.

`findBookingByIdUnscoped` is already imported at the top of this file (line 6) — no import changes needed. Do NOT modify the separate legacy `approve_<id>`/`reject_<id>` handler (`BookingCallbackResult` branch, ~line 1233 onward) — its own CAS-miss handling (silent `return` with no owner message, ~lines 1273-1278) is a different, unrelated code path and stays untouched.
  </action>
  <verify>
    <automated>npx tsc --noEmit && npx jest --testPathPattern=client-menu.test.ts --testTimeout=20000</automated>
  </verify>
  <done>resolveSbkCasFailureMessage exists as a module-scope function in src/webhooks/telegram.ts; both the sbkAction approve arm and reject arm call it with a freshly re-looked-up booking status (via a new findBookingByIdUnscoped call made strictly after the CAS miss) instead of sending the old hardcoded generic string; the legacy approve_/reject_ handler is untouched; tsc reports zero new errors; the pre-existing tests/webhooks/client-menu.test.ts suite still passes unmodified.</done>
</task>

<task type="auto">
  <name>Task 2: Test coverage for all 4 CAS-miss branches on both approve and reject</name>
  <files>tests/webhooks/client-menu.test.ts</files>
  <action>
In `describe('Suite F: sbk: session booking approval routing', ...)` (~line 1424), add 8 new `it(...)` tests directly after the existing "T-22-03 double-tap idempotency" test (~line 1531), one per status branch per action. Each test follows this shape: force a CAS miss with `mockedUpdateBookingStatusIfPending.mockResolvedValue(null);`, control what the POST-CAS re-read of `findBookingByIdUnscoped` returns for the specific case under test, `await postToWebhook(makeCallbackQueryUpdate(<unique updateId, e.g. 20-27>, OWNER_TELEGRAM_ID, '<sbk:approve:5 or sbk:reject:5>'))`, then assert `res.status` is 200 and `mockedSendTelegramMessage` was called with `(OWNER_TELEGRAM_ID, '<expected message>')`.

For the 6 status-branch cases (not the 2 not-found cases), set `mockedFindBookingByIdUnscoped.mockResolvedValue({ ...SESSION_BOOKING, bookingStatus: '<status>' } as any);` (a single mockResolvedValue covering every call in that test, mirroring the existing "already-resolved booking (re-tap)" precedent pattern in tests/telegram-webhook.test.ts) — this satisfies both the earlier T-22-02 cross-tenant guard's read (businessId still matches BASE_BUSINESS.id) and the new post-CAS-miss re-read (returns the target status). For the 2 not-found cases, chain `mockedFindBookingByIdUnscoped.mockResolvedValueOnce({ ...SESSION_BOOKING } as any).mockResolvedValueOnce(null);` so the first call (T-22-02 guard) still finds a valid same-business booking and only the second call (the new post-CAS-miss re-read) returns null, simulating the row disappearing between the two reads.

The 8 cases:
- approve (`sbk:approve:5`), bookingStatus `'expired'` -> "Η κράτηση έληξε αυτόματα (πέρασαν 2 ώρες χωρίς απάντηση). Ζητήστε από τον πελάτη να κάνει νέα κράτηση."
- approve, bookingStatus `'confirmed'` -> "Η κράτηση έχει ήδη εγκριθεί."
- approve, bookingStatus `'cancelled'` -> "Η κράτηση έχει ήδη απορριφθεί."
- approve, second findBookingByIdUnscoped call resolves `null` -> "Η κράτηση δεν βρέθηκε ή έχει ήδη επεξεργαστεί."
- reject (`sbk:reject:5`), bookingStatus `'expired'` -> same expired message as above
- reject, bookingStatus `'confirmed'` -> same already-approved message as above
- reject, bookingStatus `'rejected'` -> same already-rejected message as above (proves `'cancelled'` and `'rejected'` both map to the identical message, exercised via the two different action arms)
- reject, second findBookingByIdUnscoped call resolves `null` -> same generic not-found message

On at least one of the 8 tests, additionally assert `expect(mockedUpdateBookingStatus).not.toHaveBeenCalled();` and `expect(mockedReleaseSessionCapacity).not.toHaveBeenCalled();` as a sanity check that a CAS miss never falls through into the reschedule-cascade or capacity-release code paths that only run on a successful (non-null) `updated` result.
  </action>
  <verify>
    <automated>npx jest --testPathPattern=client-menu.test.ts --testTimeout=20000</automated>
  </verify>
  <done>8 new tests exist in Suite F of tests/webhooks/client-menu.test.ts, covering all 4 CAS-miss status branches (expired / already-confirmed / already-rejected-or-cancelled / not-found) on both the sbk:approve and sbk:reject flows; all new tests pass; the full pre-existing + new client-menu.test.ts suite passes with zero regressions.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Telegram owner client -> callback_query webhook handler | Already authenticated upstream (per-bot webhook secret token + Telegram's own callback_query.from.id) and already ownership-checked (T-22-01 owner-only guard, T-22-02 cross-tenant guard) before any code touched by this task executes. This task changes only the CONTENT of a message already destined for a verified owner of the same business — it introduces no new trust boundary. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-quick260908dwj-01 | Information Disclosure | resolveSbkCasFailureMessage's status-specific wording | low | accept | The recipient is always the already-verified owner of the SAME business as the booking (T-22-01/T-22-02 guards run unconditionally before this code path is reached) — no data is exposed to anyone who wasn't already authorized to see this booking's full status. |
| T-quick260908dwj-02 | Tampering (unintended side effects) | extra findBookingByIdUnscoped read added on the CAS-miss path | low | accept | Read-only, side-effect-free query; only reached after updateBookingStatusIfPending has already returned null (the row is not mutated), so it cannot introduce a duplicate mutation or a new race; at most it doubles one already-cheap SELECT on an already-rare (CAS-miss) branch. |
</threat_model>

<verification>
Task 1's `tsc --noEmit` + targeted jest run confirms the new helper compiles and the pre-existing Suite F tests (including the T-22-03 double-tap idempotency test, which forces a CAS miss but does not assert on the message) still pass unmodified after the message-resolution logic changes. Task 2's targeted jest run proves the actual behavioral fix: each of the 4 status branches produces its own distinct, correct Greek message on BOTH the approve and reject call sites, and a CAS miss still never triggers the reschedule-cascade or capacity-release logic reserved for a successful transition. Do not run the full `npm test` suite (machine crash risk per project memory) — only the `--testPathPattern=client-menu.test.ts` runs above, plus `npx tsc --noEmit`.
</verification>

<success_criteria>
- A sbk:approve or sbk:reject tap that loses the CAS (updateBookingStatusIfPending returns null) sends the owner one of 4 distinct messages based on a FRESH re-read of the booking's actual current status: expired, already-confirmed, already-rejected/cancelled, or the original generic not-found string as a safe default.
- Both the approve and reject arms share the exact same resolution logic via one helper function — no duplicated branching.
- The unrelated legacy approve_<id>/reject_<id> handler is untouched.
- 8 new tests in tests/webhooks/client-menu.test.ts Suite F cover all 4 branches x 2 actions; all pass alongside the full pre-existing suite.
- `npx tsc --noEmit` reports zero new errors.
</success_criteria>

<output>
Create `.planning/quick/260908-dwj-fix-generic-booking-approval-failure-mes/260908-dwj-SUMMARY.md` when done
</output>
