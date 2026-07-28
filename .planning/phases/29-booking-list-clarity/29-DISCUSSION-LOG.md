# Phase 29: Booking & List Clarity - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-28
**Phase:** 29-booking-list-clarity
**Areas discussed:** Past-time slot filter scope, Open-slot booking button, Unknown-callback recovery depth, Cleanup-while-touching-it scope

---

## Past-time slot filter scope

| Option | Description | Selected |
|--------|-------------|----------|
| Optional param on listSessions() | Add `excludePastToday` param, default false; pass true only from the 5 client-facing call sites. One choke point, owner tools untouched. | ✓ |
| Filter at each of the 5 call sites | Leave listSessions() untouched; duplicate the time check at each client-facing caller. | |
| Filter unconditionally inside listSessions() | Simplest change, but breaks owner's same-day cancel/assign chat tools. | |

**User's choice:** Optional param on listSessions() (Recommended).
**Notes:** Research (via Explore agent) found 13 total call sites, 5 client-facing (want filter) vs 8 owner-facing (must NOT filter — owner needs to find/cancel/assign a same-day already-started class via chat). This became D-01. Also surfaced a duplication smell (two near-identical `hoursUntilSession` copies) worth consolidating while touching this logic — became D-02, not separately asked since it's a near-zero-cost technical follow-on rather than a real fork.

---

## Open-slot booking button

| Option | Description | Selected |
|--------|-------------|----------|
| Relabel + fix redirect | Change button text for open-slot businesses AND add missing back-button to the redirect branch. | ✓ |
| Hide entirely | Root menu omits the button when bookingMode !== 'fixed_sessions'. Loses discoverability nudge. | |
| Keep as-is, just add back-button | Minimal fix, doesn't address the "no upfront signal" half of the gap. | |

**User's choice:** Relabel + fix redirect (Recommended).
**Notes:** Research found the button is NOT a true no-op today — it already redirects to a helpful "write in chat" message for open-slot businesses, but gives no upfront signal and (unlike its sibling empty-list branch) has no back-button. Became D-03/D-04.

---

## Unknown-callback recovery depth

| Option | Description | Selected |
|--------|-------------|----------|
| All 3 layers | Fix menu default-cases, client cancel-flow early-returns, AND the top-level parseCallbackData()===null silent drop. | ✓ |
| Layers 1+2 only | Fix the realistic stale-button scenarios, skip the genuinely-malformed-data case. | |
| Layer 2 only | Just the two menu default cases — narrowest reading. | |

**User's choice:** All 3 layers (Recommended).
**Notes:** Research found 3 distinct silence levels in `telegram.ts`/`admin-menu.ts`/`client-menu.ts`, plus a useful precedent: admin's `handleClassCancelExecute` already does the desired "always show back-menu keyboard" pattern correctly — client's `handleCancelExecute` is the one that needs to catch up to it. Became D-05.

---

## Cleanup-while-touching-it scope

| Option | Description | Selected |
|--------|-------------|----------|
| (a) findSessionInstanceById + (b) back-menu constants | Extract the helper (already touching all 3 call sites for UX-02/04 anyway) and centralize back-menu labels (needed anyway for UX-06's new buttons). Skip (c). | ✓ |
| All 3 — (a), (b), and (c) | Also unify 3 different Greek phrasings for booking-mode across files. | |
| None — minimal patch only | Add more inline duplication rather than centralizing anything. | |

**User's choice:** (a) and (b) only (Recommended).
**Notes:** Research found 3 near-duplicate inline session-lookup joins, 2 inconsistent client back-button labels for the same target, and 3 different Greek phrasings for booking-mode. (a) and (b) are near-zero marginal cost since this phase already touches those exact call sites for other reasons; (c) touches unrelated files for a cosmetic inconsistency, explicitly deferred. Became D-06/D-07; (c) recorded as a deferred idea.

---

## Claude's Discretion

- Exact Greek wording for the relabeled open-slot booking button (D-03).
- Exact Greek wording for new back-menu messages accompanying the Layer-1/early-return fixes (D-05).
- Boundary semantics for "already passed" (`<=` vs `<` on exact-current-minute edge case).
- Naming/shape of the new `findSessionInstanceById` helper and the new `greek-messages.ts` constants.
- Whether `assign_client_to_session`'s owner-tool call site needs any UX touch beyond its unchanged default filter behavior — not flagged as a gap, no change expected.

## Deferred Ideas

- Unifying the 3 different Greek phrasings for `open_slots`/`fixed_sessions` across `admin-menu.ts`/`ai-owner-agent.ts`/`ai-onboarding-agent.ts` — real inconsistency, out of scope for this phase, candidate for a future polish pass.
