# Phase 26: Confirmation & Approval Policy - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Owner destructive actions and client-initiated reschedules follow one consistent, safe confirmation/approval model. Nothing mutates without explicit confirmation, whether triggered from the admin menu or free chat, and a rejected reschedule never leaves the client with zero active booking.

Requirements: CONF-01 (uniform Ναι/Όχι confirmation policy), CONF-02 (reschedule requires owner approval like new bookings).

</domain>

<decisions>
## Implementation Decisions

### Reschedule pending-window handling (CONF-02) — CORRECTS a research error

**D-01:** The research synthesis (`.planning/research/ARCHITECTURE.md`) claimed reschedule approval could reuse the `rescheduledFromBookingId` deferred-cancel-on-approve cascade at `src/webhooks/telegram.ts:840-856` "with zero new state machine." **This is wrong for session-class reschedules.** That cascade lives in the OLDER `approve_<id>`/`reject_<id>` callback block, used only by the non-session `rescheduleAppointmentTool` (open-slots reschedule). The session-class reschedule path (`rescheduleSessionTool` in `src/conversation/function-executor.ts:723-814`) and its owner-decision callback (`sbk:approve`/`sbk:reject` in `src/webhooks/telegram.ts:587-631`) are completely separate code paths with **zero awareness of `rescheduledFromBookingId`**. Confirmed via direct read of both files during this discussion, not inferred from docs.

**D-02 (LOCKED):** Currently, `rescheduleSessionTool` cancels the OLD booking unconditionally and immediately (line 768: `updateBookingStatus(original.id, 'cancelled')`, followed by immediate credit restore at line 771) — **before** the new booking is even attempted. If a naive fix just drops the `'confirmed'` override on the `bookSessionInstance` call (line 791), the client would have **zero active bookings** for the entire pending-approval window, and if the owner rejects, they stay at zero — they must manually re-book from scratch. This exactly matches the risk flagged in the folded todo (`2026-07-27-require-owner-approval-on-reschedule-not-just-new-bookings.md`).

**D-03 (LOCKED — chosen approach):** Hold the OLD booking until the NEW one is approved, not cancel-immediately:
- `rescheduleSessionTool` does NOT cancel/restore the old booking upfront. It creates the new booking via `bookSessionInstance(..., rescheduledFromBookingId: original.id)` with the new `pending_owner_approval` default (no `'confirmed'` override), reusing the **existing** `rescheduledFromBookingId` schema column (`src/database/schema.ts:178`) — already present on the `bookings` table, just never wired into the session-booking path before.
- `bookSessionInstance` needs to accept and persist `rescheduledFromBookingId` on insert (currently the function signature has no such parameter — this is new plumbing, not schema work).
- Extend the `sbk:approve` branch (`src/webhooks/telegram.ts:587-604`) to check `updated.rescheduledFromBookingId` and, if set, cascade-cancel the old booking (mirroring the existing pattern at lines 840-856 — same cancel + best-effort calendar cleanup, not restoring credit again since the old booking's credit was never touched).
- The `sbk:reject` branch (lines 606-631) needs NO new logic for the old booking — it stays untouched/still confirmed, since it was never cancelled. Only the new (rejected) booking's capacity/credit gets released, exactly as it already does today for non-reschedule bookings.
- **Accepted trade-off:** during the pending window, both the old and new session instance's `bookedCount` are incremented simultaneously (the client is soft-holding two slots' worth of capacity briefly). This mirrors the exact soft-hold pattern Phase 22 already established for new bookings (OWNR-06) — not a new pattern, just applied to reschedule too.

### Confirmation policy scope + button style (CONF-01)

**D-04 (LOCKED):** Scope is exactly the 5 actions named in REQUIREMENTS.md CONF-01: delete_service, update_service_price, close_day (update_hours), cancel_session (free-chat path only — the admin-menu path already confirms via `showCancelClassConfirm`), assign_client_to_session. No other destructive actions were found in the audit; do not expand this list without re-discussing.

**D-05 (LOCKED):** Use **contextual button labels** per action type, not generic Ναι/Όχι everywhere — e.g. "Διαγραφή/Άκυρο" for delete-type actions, reuse the existing "Έγκριση/Απόρριψη" pair already established in Phase 22 for approve-type actions. Rationale: UX research (`.planning/research/FEATURES.md` Category 1 anti-features) found generic Ναι/Όχι-only buttons on destructive actions cause misclicks/regret; contextual labels are the stronger pattern and some are already in production use.

**D-06 (LOCKED):** Confirmation prompts restate the action + relevant context (date/service/client name) — **no consequence preview** (e.g. credit/capacity impact text). Keeping this phase's fix mechanical and uniform across all 5 actions; a consequence-preview feature would need a per-action-type query and risks scope creep beyond CONF-01's literal ask. UX-02 (contextual cancel-confirm detail, Phase 29) already covers showing date/service in cancel-specific prompts — this decision generalizes that same restraint to the other 4 actions in this phase.

**D-07:** Adopt the `src/utils/greek-messages.ts` constants-file approach from `.planning/research/ARCHITECTURE.md` (not a shared confirmation-keyboard helper — different files use different callback-naming conventions, a global helper would create unwanted coupling). Constants hold button-label strings only; callback_data patterns stay independent per file (`menu:<action>`, `cmenu:<action>`, `sbk:approve/reject:<id>`).

### Claude's Discretion
- Exact constant names/shape inside `greek-messages.ts` beyond the button-label strings named in D-05.
- Whether `assign_client_to_session`'s confirmation reuses the same contextual-label pattern as delete-type or approve-type actions (planner's call based on whether it reads more like an "add" or a "commit" action).
- Test coverage shape for the new `rescheduledFromBookingId` wiring on `bookSessionInstance` and the `sbk:approve` cascade extension.

### Folded Todos

**`2026-07-27-require-owner-approval-on-reschedule-not-just-new-bookings.md`** — Original problem: reschedule auto-confirms (Phase 22 explicit override), user wants it to require owner approval like new bookings, and flagged the exact same "what happens to the old booking" question this discussion resolved as D-01 through D-03. Fully folded — its scope IS CONF-02, and its open question is now a locked decision.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research (v1.7 milestone)
- `.planning/research/ARCHITECTURE.md` — integration analysis for all 15 v1.7 items; **note its "reschedule reuses telegram.ts:840-856 with zero new state machine" claim (section (a)) is WRONG for session-class reschedules — see D-01/D-02 above for the corrected analysis.** Its confirmation-keyboard-pattern guidance (section (d)) and build-order notes remain accurate and should still be followed.
- `.planning/research/FEATURES.md` — Category 1 (Confirmation & Approval Policies) table-stakes/anti-features analysis backing D-05/D-06.
- `.planning/research/PITFALLS.md` — pitfall #2 (reversing reschedule approval with in-flight data) and #1 (state-machine races on confirmation-policy refactoring) both apply directly to this phase.
- `.planning/REQUIREMENTS.md` — CONF-01, CONF-02 exact requirement text.
- `.planning/ROADMAP.md` — Phase 26 goal and success criteria.

### Prior locked decisions (Phase 22, v1.6 — still binding)
- Soft-hold capacity pattern: `bookedCount` incremented at insert time regardless of `pending_owner_approval` vs `confirmed` status (OWNR-06). D-03's "briefly double-counted capacity" trade-off is this exact same pattern, just applied to two session instances at once during a reschedule's pending window.
- `releaseSessionCapacity` (`src/session/manager.ts`) is the single shared implementation for capacity release on reject/expiry — reuse it, do not duplicate.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/database/schema.ts:178` — `rescheduledFromBookingId` column already exists on `bookings` table (added for the non-session reschedule flow); reuse it for session-class reschedules per D-03, no migration needed.
- `src/webhooks/telegram.ts:840-856` — existing cascade-cancel-on-approve pattern (for the non-session reschedule flow) is the template to mirror inside `sbk:approve`, not code to literally reuse (different callback block).
- `src/session/manager.ts` `releaseSessionCapacity` + `restoreCredit` from `src/billing/queries.ts` — reuse unchanged for the `sbk:reject` path (no new logic needed there per D-03).
- Existing "Έγκριση/Απόρριψη" button pair (Phase 22, `sbk:approve`/`sbk:reject` keyboard) — reuse verbatim for approve-type confirmations per D-05.

### Established Patterns
- `withBusinessContext` ambient transaction wraps the entire `handleCallbackQuery` call — capacity release + credit restore inside `sbk:reject` already runs atomically with the status update, no new transaction wrapper needed for the cascade-cancel addition either.
- `updateBookingStatusIfPending` — atomic CAS pattern (Phase 22) already guards against double-tap races on `sbk:approve`/`sbk:reject`; the new cascade-cancel logic added to the approve branch should follow the same idempotency discipline (a second approve tap must not attempt to cancel an already-cancelled old booking).

### Integration Points
- `bookSessionInstance` (`src/session/manager.ts:190-313`) signature needs a new optional parameter to accept and persist `rescheduledFromBookingId` on insert (currently absent — this is new plumbing).
- `rescheduleSessionTool` (`src/conversation/function-executor.ts:723-814`) — remove the immediate cancel/restore block (lines 767-772) and the `'confirmed'` override (line 791); pass `rescheduledFromBookingId: original.id` instead.
- `src/webhooks/telegram.ts:587-604` (`sbk:approve` branch) — add the cascade-cancel-old-booking logic here.
- New file `src/utils/greek-messages.ts` — button-label constants, imported into `admin-menu.ts`, `client-menu.ts`, and wherever the 5 CONF-01 confirmation prompts live (mostly `src/onboarding/ai-owner-agent.ts` tool handlers and `src/telegram/handlers/admin-menu.ts`).

</code_context>

<specifics>
## Specific Ideas

No UI mockups or exact copy specified — Greek button text and prompt wording follow the existing tone/patterns already in the codebase (short, direct, matches Phase 22's Έγκριση/Απόρριψη style).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. The consequence-preview idea (D-06) was explicitly considered and deferred as out-of-scope-for-this-phase, not lost — could be a future v1.8 idea if requested.

### Reviewed Todos (not folded)

- `2026-07-27-add-client-registration-question-as-first-bot-message.md`, `2026-07-27-fix-same-day-past-time-slots-showing-as-bookable.md`, `2026-07-27-research-telegram-persistent-menu-button-reliability.md` — matched Phase 26 by the keyword tool with low relevance; each already carries its own `resolves_phase` tag pointing to Phase 27, 29, and 30 respectively. Confirmed not relevant here, no action needed.

</deferred>

---

*Phase: 26-confirmation-approval-policy*
*Context gathered: 2026-07-28*
