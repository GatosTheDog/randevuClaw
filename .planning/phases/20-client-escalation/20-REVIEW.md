---
phase: 20-client-escalation
reviewed: 2026-07-24T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/telegram/escalation.ts
  - tests/escalation.test.ts
  - src/telegram/handlers/client-menu.ts
  - tests/webhooks/client-menu.test.ts
  - tests/client-escalation.test.ts
  - src/webhooks/telegram.ts
findings:
  critical: 1
  warning: 4
  info: 2
  total: 7
status: issues_found
---

# Phase 20: Code Review Report

**Reviewed:** 2026-07-24T00:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Phase 20 adds a client-escalation engine (`src/telegram/escalation.ts`) and admin
callback routing for `escl:` inline-keyboard buttons (`src/webhooks/telegram.ts`).
The core design is sound: `sendEscalationToAdmin` is genuinely best-effort (all
paths swallow errors), the cross-tenant guard re-derives the acting business from
`senderTelegramId` rather than trusting `callback_data`, and `bookSessionInstance`
still enforces per-tenant ownership and capacity via its `SELECT ... FOR UPDATE`
subquery regardless of the `activeMembership=null` bypass.

However, the new `escl:approve` handler in `src/webhooks/telegram.ts` has a
correctness bug that causes it to report a false "booking created" success to
both admin and client when the underlying booking attempt actually failed
(`status: 'conflict'`) — this is a genuine, currently-untested code path. A
matching, pre-existing instance of the same bug also lives in
`client-menu.ts:handleBookSessionExecute` (introduced in Phase 18, in scope
here because the file is under review). Additionally, the "reply to client"
escalation action is UI-only: no code path actually relays the admin's next
message to the client, despite the on-screen prompt promising it will. Test
coverage for the two most important new flows (`class_full` escalation trigger
and the entire `escl:approve` callback handler) is missing.

## Critical Issues

### CR-01: `escl:approve` handler treats `bookSessionInstance` status `'conflict'` as success

**File:** `src/webhooks/telegram.ts:356-384`
**Issue:**
`bookSessionInstance` can return one of three statuses: `'success'`, `'full'`,
or `'conflict'` (`src/session/manager.ts:28`, `:222-224`). `'conflict'` is
returned whenever the `sessionInstanceId` row cannot be matched under the
subquery `catalogId IN (SELECT id FROM session_catalog WHERE business_id =
businessId)` — i.e. the instance is cancelled, doesn't exist, or (critically)
belongs to a *different* business than `ownerBusiness.id`.

The new handler only special-cases `'full'`:

```ts
if (!result || result.status === 'full') {
  await sendTelegramMessage(
    senderTelegramId,
    'Δεν ήταν δυνατή η εξαίρεση: το μάθημα παραμένει πλήρες.'
  );
  return;
}

// Notify client of approval
try {
  await botTokenStore.run(ownerBusiness.botToken!, async () => {
    await sendTelegramMessage(
      escl.clientTelegramId,
      'Η κράτησή σας εγκρίθηκε από τον διαχειριστή! Θα σας δούμε σύντομα.'
    );
  });
} catch (err) { ... }
await sendTelegramMessage(senderTelegramId, 'Εξαίρεση εγκρίθηκε. Η κράτηση δημιουργήθηκε.');
```

When `result.status === 'conflict'`, this falls through to the "success"
branch: the admin is told "Εξαίρεση εγκρίθηκε. Η κράτηση δημιουργήθηκε" (the
exception was approved, the booking was created) and the client is told their
booking was approved — even though **no booking row was ever inserted**. This
is a false-confirmation bug that misleads both parties about the state of the
system, and it is reachable in normal operation any time the session instance
was cancelled/deleted between the escalation being sent and the admin tapping
"approve" (a realistic race — the class filled/emptied, or the owner deleted
the session, while the escalation message sat in the admin's chat).

It is also the failure mode for a cross-tenant edge case: if the acting owner
(`senderTelegramId`) is registered as `ownerTelegramId` on more than one
business, `findBusinessByOwnerTelegramId` (`.limit(1)`, first match) can
resolve to a *different* business than the one that actually sent the
escalation. In that scenario `bookSessionInstance(ownerBusiness.id, ...)`
silently returns `'conflict'` (instance not owned by that business) and the
bug reports false success instead of surfacing the mismatch.

**Fix:** Handle all three statuses explicitly, e.g.:
```ts
if (!result || result.status !== 'success') {
  const msg = result?.status === 'full'
    ? 'Δεν ήταν δυνατή η εξαίρεση: το μάθημα παραμένει πλήρες.'
    : 'Δεν ήταν δυνατή η εξαίρεση: το μάθημα δεν βρέθηκε ή δεν ανήκει σε αυτή την επιχείρηση.';
  await sendTelegramMessage(senderTelegramId, msg);
  return;
}
```

## Warnings

### WR-01: `handleBookSessionExecute` has the same `'conflict'`-as-success gap (client-menu.ts)

**File:** `src/telegram/handlers/client-menu.ts:226`
**Issue:** `if (!bookResult || bookResult.status === 'full')` has the identical
gap as CR-01 — `bookResult.status === 'conflict'` (e.g. the session instance
was concurrently cancelled) falls through to the success path, sending
`'Η κράτησή σας επιβεβαιώθηκε! Θα σας δούμε σύντομα.'` to the client with no
booking actually created. This predates Phase 20 (introduced in Phase 18,
commit `56a1c03`) but the file is in this phase's review scope and the pattern
was just copied verbatim into the new escalation handler (CR-01), so it should
be fixed in both places together.
**Fix:** Same as CR-01 — branch on `bookResult.status !== 'success'` rather
than enumerating only `'full'`.

### WR-02: "Reply to client" escalation action does not relay anything to the client

**File:** `src/webhooks/telegram.ts:386-395`
**Issue:** Tapping "Απάντηση πελάτη" sends the admin a prompt:
`Γράψε το μήνυμα που θέλεις να στείλεις στον πελάτη (...) και αποστολή.`
implying that the admin's next message will be delivered to the client. The
inline comment claims *"The actual message relay is handled by the existing
free-text flow (CMENU-05)"* — but CMENU-05 is the **client**-side free-text
router (`routeConversationMessage`), not an admin-reply relay. There is no
state anywhere (no pending-reply map, no session flag) that intercepts the
owner's next free-text message and forwards it to `escl.clientTelegramId`.
Concretely: any message the owner types next is routed by
`handleFoundBusiness` straight to `aiOwnerAgent` (owner management AI) since
`business.ownerTelegramId === senderTelegramId`— it will never reach the
client, and may instead be misinterpreted by the owner-management AI as a
business command. This makes the "Reply" button a dead end that actively
misleads the admin about what will happen to their next message.
**Fix:** Either implement the promised interception (e.g. a short-lived
`pendingReplyTarget: Map<ownerTelegramId, clientTelegramId>` consulted at the
top of the owner branch in `handleFoundBusiness` before routing to
`aiOwnerAgent`), or change the copy to something that doesn't promise
automatic relay (e.g. tell the admin to use a specific command/format), until
the feature is actually wired.

### WR-03: No test exercises the `class_full` escalation trigger or capacity-full messaging

**File:** `tests/webhooks/client-menu.test.ts`
**Issue:** The suite tests the `membership_expired` enforcement-block path
(`book:yes — enforcement blocks...`, lines 389-415) but there is no test for
`bookSessionInstance` returning `{status: 'full'}` from `handleBookSessionExecute`
— i.e. the primary scenario this phase exists for ("class is full, notify
admin with an approve button"). `sendEscalationToAdmin(..., 'class_full',
instanceId)` and the `instanceId`-bearing keyboard variant are consequently
unverified by any integration test.
**Fix:** Add a test mocking `bookSessionInstance` to resolve `{status:
'full'}` and asserting `sendEscalationToAdmin` is called with `'class_full'`
and the correct `instanceId`.

### WR-04: No test exercises `handleCallbackQuery`'s `escl:approve` / `escl:reply` branches

**File:** `tests/client-escalation.test.ts`
**Issue:** This file only tests `parseCallbackData`, `buildEscalationKeyboard`,
and `sendEscalationToAdmin`'s guard clauses in isolation. It never drives a
full request through `handleTelegramWebhookPost` / `handleCallbackQuery` with
`escl:approve:...` or `escl:reply:...` `callback_query.data`, so none of the
properties called out as "known security-relevant patterns to verify" in this
phase's own design intent are actually asserted by a test: the cross-tenant
guard (`findBusinessByOwnerTelegramId` mismatch), the idempotency key
preventing a double-tap from creating two bookings, or — as this review found
— the `'conflict'` status handling gap (CR-01). The one mock that stands in
for `bookSessionInstance` in this file (`{ status: 'confirmed' }`,
line 56) isn't even a value the real `BookSessionResult` type can produce
(`'success' | 'full' | 'conflict'`), so it's unused by any assertion here
without anyone noticing the mismatch.
**Fix:** Add an integration test (posting a synthetic webhook body through
`handleTelegramWebhookPost`, or calling `handleCallbackQuery` directly) that
covers: (1) approve succeeds and books, (2) approve when capacity is still
full, (3) approve when `bookSessionInstance` returns `'conflict'` (should NOT
report success — see CR-01), (4) approve from a non-owner is ignored, (5)
duplicate approve taps produce exactly one booking via the idempotency key.

## Info

### IN-01: Unused import `EscalationReason` in client-menu.ts

**File:** `src/telegram/handlers/client-menu.ts:19`
**Issue:** `EscalationReason` is imported but never referenced as a type
anywhere in the file (`sendEscalationToAdmin` is called with string literals,
which TypeScript narrows on its own).
**Fix:** Remove `EscalationReason` from the import, or use it to type a local
constant if that's the intent.

### IN-02: `slotless_disabled` escalation reason is defined but never triggered in production code

**File:** `src/telegram/escalation.ts:25,45`
**Issue:** `EscalationReason` includes `'slotless_disabled'` with a Greek
phrase mapped in `REASON_PHRASES`, but grepping the codebase shows
`sendEscalationToAdmin` is only ever called with `'membership_expired'` and
`'class_full'` (both in `client-menu.ts`). The slotless-request flow
(`src/conversation/function-executor.ts:259-273`, `src/session/slotless-requests.ts`)
has its own separate approve/reject notification mechanism and never calls
`sendEscalationToAdmin`. `'slotless_disabled'` is exercised only by direct
unit-test calls (`tests/escalation.test.ts`), not by any real client-facing
code path — it's effectively dead in production, which is worth confirming
was an intentional scope cut for this phase (vs. a missed wiring step implied
by the reason's existence).
**Fix:** Either wire a real caller for `'slotless_disabled'` (e.g. when
`slotlessRequestsEnabled` is false and a client would otherwise hit a dead
end), or note in a comment/plan doc that it's reserved for a future phase.

---

_Reviewed: 2026-07-24T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
