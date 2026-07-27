# Phase 26: Confirmation & Approval Policy - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-28
**Phase:** 26-confirmation-approval-policy
**Areas discussed:** Reschedule pending-window handling, Confirmation policy scope + button style

---

## Fold check: reschedule todo

**Question:** Fold todo "Require owner approval on reschedule, not just new bookings" (already tagged resolves_phase:26) into this phase's context as a locked decision (CONF-02's exact scope)?

| Option | Selected |
|--------|----------|
| Yes, fold it in | ✓ |
| No, skip | |

**User's choice:** Yes, fold it in.

---

## Reschedule pending-window handling

While scouting `src/conversation/function-executor.ts` (`rescheduleSessionTool`) and `src/webhooks/telegram.ts` (`sbk:approve`/`sbk:reject`), found that `.planning/research/ARCHITECTURE.md`'s claim — that reschedule approval could reuse the `rescheduledFromBookingId` deferred-cancel-on-approve cascade "with zero new state machine" — is wrong for session-class reschedules. That cascade only exists in the older `approve_<id>`/`reject_<id>` callback block (non-session reschedule flow); `sbk:approve`/`sbk:reject` has zero awareness of it. The current `rescheduleSessionTool` cancels the OLD booking immediately and unconditionally, before the new booking is even attempted.

**Question:** What happens to the client's OLD booking while the new slot awaits owner approval?

| Option | Description | Selected |
|--------|-------------|----------|
| Hold old booking until new approved | New booking created as pending_owner_approval with rescheduledFromBookingId=old.id; OLD booking stays confirmed/untouched. On approve: cascade-cancel old. On reject: old booking is simply still there, nothing to restore — client never has zero bookings. Capacity briefly double-counted during the pending window. | ✓ |
| Cancel old immediately (simple, has a gap) | One-line fix: drop the 'confirmed' override. Old cancelled+credit-restored right away; if rejected, client has ZERO booking and must manually re-book. | |

**User's choice:** Hold old booking until new approved.
**Notes:** This directly resolves the open question the original folded todo raised ("what happens to the OLD booking during the pending window") — codified as CONTEXT.md decisions D-01 through D-03.

---

## Confirmation policy scope + button style

**Question 1:** Generic Ναι/Όχι everywhere, or contextual labels per action?

| Option | Description | Selected |
|--------|-------------|----------|
| Contextual labels | Matches UX research finding that ambiguous Ναι/Όχι-only buttons cause misclicks on destructive actions; reuse existing Έγκριση/Απόρριψη pattern for approve-type actions. | ✓ |
| Generic Ναι/Όχι | Simpler, one constant pair reused everywhere. | |

**User's choice:** Contextual labels (Recommended).

**Question 2:** Show a consequence preview (e.g. credit impact) or just restate the action?

| Option | Description | Selected |
|--------|-------------|----------|
| Just restate action | Show what's being confirmed (date/service/client) — matches UX-02's scope. Keeps the fix mechanical/uniform. | ✓ |
| Add consequence preview | Query and show credit/capacity impact — more informative but more work per action type, risks scope expansion. | |

**User's choice:** Just restate action (Recommended).
**Notes:** Codified as CONTEXT.md decisions D-04 through D-07 (exact 5-action scope, contextual labels, no consequence preview, greek-messages.ts constants approach from ARCHITECTURE.md section (d)).

---

## Claude's Discretion

- Exact constant names/shape inside `greek-messages.ts` beyond the button-label strings named in D-05.
- Whether `assign_client_to_session`'s confirmation reuses the delete-type or approve-type label pattern.
- Test coverage shape for the new `rescheduledFromBookingId` wiring on `bookSessionInstance` and the `sbk:approve` cascade extension.

## Deferred Ideas

None — discussion stayed within phase scope. Consequence-preview text was considered and explicitly deferred (not lost), could be a future v1.8 idea.
