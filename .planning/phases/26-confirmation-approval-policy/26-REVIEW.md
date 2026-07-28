---
phase: 26-confirmation-approval-policy
reviewed: 2026-07-28T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - src/conversation/function-executor.ts
  - src/onboarding/ai-owner-agent.ts
  - src/session/manager.ts
  - src/utils/greek-messages.ts
  - src/webhooks/telegram.ts
  - tests/ai-owner-cancel-session.test.ts
  - tests/ai-owner-confirmation-policy.test.ts
  - tests/COVERAGE.md
  - tests/session-assignment.test.ts
  - tests/session-booking-flow.test.ts
  - tests/telegram-webhook.test.ts
  - tests/webhooks/client-menu.test.ts
findings:
  critical: 1
  warning: 4
  info: 1
  total: 6
status: issues_found
---

# Phase 26: Code Review Report

**Reviewed:** 2026-07-28
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

CONF-01 (real Telegram-button confirmation gating the 5 destructive owner
actions) is implemented correctly for every reachable production code path:
none of the 5 tool schemas (`delete_service`, `update_service_price`,
`close_day`, `cancel_session`, `assign_client_to_session`) expose a
Gemini-controllable `confirmed` flag, all 5 route through a real
`callback_query` button tap before mutating, and every mutation in
`handleOwnerToolConfirmCallback` re-derives tenant ownership from
`business.id` rather than trusting the raw callback_data ID. However, a
dead/orphaned module (`src/onboarding/edit-router.ts`) still contains
completely unguarded direct mutations of the exact same resources (service
delete/price, business hours) — currently unreachable, but a latent risk
worth removing (WR-03).

CONF-02 (defer old-booking cancellation until owner approval) is
structurally correct — the old booking is genuinely left untouched until
approve/reject, and reject correctly leaves the client with their original
booking intact. **However, tracing the credit ledger through the full
approve path surfaces a real double-deduction bug (CR-01):** a client who
reschedules a session-class booking and has the reschedule **approved**
loses 2 session credits for what should be 1 rescheduled appointment. This
is a regression introduced by this phase's exact change (deferring the old
booking's cancellation without also deferring/skipping the new booking's
credit deduction), and it is not caught by any existing test.

Additional warnings cover a timer-cleanup race in the `update_service_price`
staging map, a missing validation gap on negative/zero prices, and missing
best-effort error handling around post-mutation Telegram notifications in
the new confirm/abort dispatcher (inconsistent with the rest of the
codebase's established best-effort notification pattern).

## Critical Issues

### CR-01: Session-class reschedule approval double-deducts a session credit

**File:** `src/conversation/function-executor.ts:772-787`, `src/session/manager.ts:311-324`, `src/webhooks/telegram.ts:625-636`

**Issue:**
`rescheduleSessionTool` (function-executor.ts) creates the new
`pending_owner_approval` booking `N` by calling `bookSessionInstance` with
the client's **real, current** `activeMembership`:

```ts
// function-executor.ts:772-787
const activeMembership = await getActiveMembershipForDeduction(context.business.id, context.clientPhone);
const newKey = context.idempotencyKey + ':reschedule:' + parsed.new_session_instance_id;

const result = await bookSessionInstance(
  context.business.id,
  parsed.new_session_instance_id,
  context.clientPhone,
  newSession.serviceId,
  newKey,
  activeMembership,     // <-- real membership, not null
  undefined,            // initialStatus defaults to pending_owner_approval
  original.id
);
```

`bookSessionInstance` unconditionally deducts 1 credit for any non-null
membership with a finite `sessionsRemaining` (session/manager.ts:311-324):

```ts
if (membership !== null && membership !== undefined && membership.sessionsRemaining !== null) {
  await deductSession(membership.id, bookingId, `booking:${bookingId}:deduction`);
}
```

The original booking `O` had already deducted 1 credit when it was first
created. `O` is now deliberately left untouched (per this phase's own D-03
design) until the owner approves or rejects `N`:

* **On reject** — `N`'s freshly-deducted credit is restored via
  `restoreCredit` in `telegram.ts`'s `sbk reject` branch, and `O` is
  untouched. Net: 1 credit spent (correct — client keeps their original
  booking).
* **On approve** — `telegram.ts`'s `sbk approve` branch cascades: `O` is
  cancelled, but its credit is **deliberately not restored**, per the
  comment at telegram.ts:619-625: *"No credit restore here — the old
  booking's credit was never touched by rescheduleSessionTool (D-03), so
  restoring it now would over-refund the client."* This reasoning is
  incorrect: `N`'s credit **was** freshly deducted by `bookSessionInstance`
  above. The result is **2 credits spent for 1 attended session** — the
  client is silently overcharged every time a session reschedule is
  approved.

This is a direct regression versus the codebase's own established pattern
for the equivalent **open-slot** reschedule (`rescheduleAppointmentTool`,
same file, lines 456-462), which explicitly avoids this exact problem via
`linkRescheduledBooking` (billing/queries.ts:549-564): it re-links the new
booking to the *same* membership ledger entry with `sessionsDeducted: 0`
("Counter unchanged — only the link is needed for findMembershipByBooking")
instead of calling `deductSession` again. The session-class reschedule path
added/modified by this phase never adopted the equivalent safeguard.

No existing test (including the new `sbok03-allow` test in
`tests/session-booking-flow.test.ts`) asserts `sessionsRemaining` after an
approved session reschedule, so this regression is currently untested.

**Fix:** mirror the open-slot flow's "link, don't deduct" pattern instead of
passing the real membership into `bookSessionInstance`:

```ts
// function-executor.ts — rescheduleSessionTool
// Reschedules must be credit-neutral: `original` already spent 1 credit.
// Do NOT let bookSessionInstance deduct a second one for the new booking —
// pass null so its internal deduction guard is skipped, then explicitly
// link the ledger (mirrors rescheduleAppointmentTool's CR-02 handling via
// linkRescheduledBooking) so a future cancel of the approved booking can
// still find the membership and restore correctly.
const newKey = context.idempotencyKey + ':reschedule:' + parsed.new_session_instance_id;

const result = await bookSessionInstance(
  context.business.id,
  parsed.new_session_instance_id,
  context.clientPhone,
  newSession.serviceId,
  newKey,
  null,               // <-- was `activeMembership`; skip deduction here
  undefined,
  original.id
);

if (result.status === 'success' && result.bookingId) {
  const originalMembershipId = await findMembershipByBooking(original.id);
  if (originalMembershipId !== null) {
    await linkRescheduledBooking(originalMembershipId, result.bookingId);
  }
}
```

(`findMembershipByBooking` and `linkRescheduledBooking` are already imported
into this file for the open-slot path.) With this change: reject still
restores nothing extra (no ledger row was created for `N` to restore), and
approve still cancels `O` without restoring it — net 1 credit consumed
either way, matching the open-slot behavior exactly.

## Warnings

### WR-01: `update_service_price` staging map has a timer-cleanup race that can expire a newer pending change early

**File:** `src/onboarding/ai-owner-agent.ts:60-83`

**Issue:** `pendingServicePriceChanges` is keyed only by `serviceId`, and
each call to `setPendingServicePriceChange` schedules its own independent
10-minute `setTimeout(() => pendingServicePriceChanges.delete(serviceId), ...)`.
If the owner triggers `update_service_price` twice for the **same service**
before confirming (e.g. "change Pilates to €20" then, before tapping
confirm, "actually make it €25"), the map entry is overwritten with the
second (newer) value, but the **first** call's timer is still scheduled and
will unconditionally delete whatever is currently in the map at
`T1 (first call's time) + 10min` — which by then holds the *second*
request's value. The second request's own, later-firing timer becomes
redundant, and the entry disappears up to ~10 minutes earlier than the
owner would expect from their most recent request. Tapping "Επιβεβαίωση" in
that window reports "expired" (`Το αίτημα αλλαγής τιμής έληξε...`) even
though the owner believes they just asked for the change moments ago.
Additionally, the **older** Telegram message (still showing the *first*
proposed price and still tappable) shares the same `callback_data:
otc:svc_price:<id>:yes` — tapping it applies whatever price is *currently*
staged (the second, different price), not the price displayed in that
specific message, since there is no per-message/per-request token tying a
button to the exact value it displayed.

**Fix:** store (and clear) the specific timer handle per entry so a newer
request cancels the older one's pending deletion, and/or store a monotonic
token that the confirm handler must match:

```ts
export const pendingServicePriceChanges = new Map<
  number,
  { businessId: number; newPriceCents: number; timer: NodeJS.Timeout }
>();

function setPendingServicePriceChange(
  serviceId: number,
  value: { businessId: number; newPriceCents: number }
): void {
  const existing = pendingServicePriceChanges.get(serviceId);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => pendingServicePriceChanges.delete(serviceId), PENDING_PRICE_CHANGE_TTL_MS).unref();
  pendingServicePriceChanges.set(serviceId, { ...value, timer });
}
```

### WR-02: `update_service_price` accepts non-positive `new_price_cents` with no validation

**File:** `src/onboarding/ai-owner-agent.ts:605-626`

**Issue:** Unlike `add_service` (which guards `price_cents && price_cents > 0 ? price_cents : null`), the `update_service_price` case only checks
`new_price_cents === undefined`. A Gemini-parsed `new_price_cents` of `0`
or a negative number is staged, displayed in the confirmation prompt
(`(new_price_cents / 100).toFixed(2)`), and applied verbatim on confirm —
there is nothing preventing a service price from being driven negative.

**Fix:**
```ts
if (!service_name || new_price_cents === undefined || new_price_cents <= 0) {
  return 'Μη έγκυρη τιμή.';
}
```

### WR-03: Orphaned `edit-router.ts` module still contains fully unguarded direct mutations of CONF-01-protected resources

**File:** `src/onboarding/edit-router.ts:113,157,202,237`

**Issue:** `routeOwnerEdit` (and its Greek-keyword-triggered
`διαγραφή υπηρεσίας` / `αλλαγή τιμής` / `αλλαγή ωραρίου` / `νέα υπηρεσία`
handlers) directly execute `getConn().delete(services)`,
`getConn().update(services).set({ price: newPrice })`, and
`getConn().insert(businessHours)` — the same resources CONF-01 was written
to protect — with **zero** button-based confirmation (the delete flow only
asks for a typed numeric reply in a second message; the price-change flow
has no confirmation step at all). Grepping the codebase confirms this
module is never imported or called from any production file
(`telegram.ts`, `ai-owner-agent.ts`, `ai-onboarding-agent.ts`) — only
`isOwnerEditCommand` is imported, and only from tests
(`tests/onboarding/edit-router.test.ts`). `routeOwnerEdit` itself has zero
test coverage. This appears to be leftover code from before Phase 21
replaced the deterministic owner-onboarding state machine with the
Gemini-driven `aiOwnerAgent`.

Currently unreachable, so not an active bypass of CONF-01 today — but it is
dead code that reimplements exactly the destructive actions this phase
just spent effort gating, with none of the new protections. If any future
phase re-wires `isOwnerEditCommand`/`routeOwnerEdit` back into the message
dispatch (plausible, since the exported keyword-matching helper still
exists and is still exercised by tests), CONF-01's guarantee would be
silently defeated for whichever entry point does so.

**Fix:** delete `src/onboarding/edit-router.ts` and
`tests/onboarding/edit-router.test.ts` (or, if this module is intentionally
kept as a fallback for a future phase, route its mutations through the same
`otc:` confirmation dispatcher instead of duplicating unguarded
`getConn()` calls).

### WR-04: `handleOwnerToolConfirmCallback` sends post-mutation Telegram notifications without the codebase's established best-effort try/catch

**File:** `src/onboarding/ai-owner-agent.ts:982-1120`

**Issue:** In all 4 branches (`svc_del`, `svc_price`, `hrs_close`,
`assign`), the DB mutation runs first and the confirmation
`sendTelegramMessage` call(s) run after, but — unlike every other
notification-after-mutation call site in this codebase (see the repeated
CR-03a/b/c "best-effort, must never surface as an error" comments in
`function-executor.ts` and `webhooks/telegram.ts`) — none of these sends
are wrapped in `try/catch`. If `sendTelegramMessage` throws (e.g. the
target chat is unreachable), the exception propagates out of
`handleOwnerToolConfirmCallback`, is caught by
`handleTelegramWebhookPost`'s outer catch, and results in the owner
receiving the generic `'Παρουσιάστηκε πρόβλημα. Δοκιμάστε ξανά σε λίγο.'`
fallback — even though the mutation (service deleted, price changed, hours
closed, client assigned) already committed successfully. In the `assign`
case specifically, the first `sendTelegramMessage` call is to the
**client**; if that one throws, the second call — the owner's own "ο
πελάτης ορίστηκε" confirmation — never executes at all, silently dropping
the owner's feedback for an action they just took.

**Fix:** wrap each post-mutation notification exactly like the rest of the
codebase does, e.g.:
```ts
try {
  await sendTelegramMessage(ownerTelegramId, `OK: υπηρεσία "${service.name}" διαγράφηκε`);
} catch (err) {
  logger.error({ err, serviceId: params.id }, 'svc_del: owner confirmation notification failed (best-effort)');
}
```
applied to all 4 branches' post-mutation sends (and, in `assign`, to both
the client and owner sends independently so one failing does not skip the
other).

## Info

### IN-01: `tests/COVERAGE.md` has not been updated since Phase 8 (pre-existing, not introduced by this phase)

**File:** `tests/COVERAGE.md`

**Issue:** The file jumps directly from "Phase 8" to "Phase 26" — Phases
9 through 25 never appended their own sections (confirmed via `git log`:
the file was last touched at Phase 8 before this phase's edit). This
phase's addition is fine in isolation, but the file's stated purpose
("Updated at the end of each phase") has been silently unmet for 17+
phases, making it an unreliable index.

**Fix:** out of scope for this phase to backfill, but worth flagging to
project maintainers — either enforce this file's update as part of the
phase-completion checklist, or remove it if it's no longer being
maintained.

---

_Reviewed: 2026-07-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
