# Phase 29: Booking & List Clarity - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning

<domain>
## Phase Boundary

What clients and owners see in booking, cancellation, and callback flows accurately reflects bookable reality and shows meaningful context instead of raw IDs or dead ends. Requirements: UX-01 (same-day past-time slots), UX-02 (contextual cancel-confirm prompts), UX-04 (service/class names in lists), UX-05 (open-slot booking button clarity), UX-06 (callback fallback recovery).

</domain>

<decisions>
## Implementation Decisions

### Same-day past-time slot filter (UX-01)

- **D-01 (LOCKED):** `listSessions()` (`src/session/manager.ts:498-529`) gains an optional param (e.g. `excludePastToday`, default `false`) rather than an unconditional filter. Pass `true` only from the 5 client-booking-facing call sites (`client-menu.ts:138` `showBookSessionList`, `function-executor.ts:541/591/669/745` — `listSessionsForClientTool`, `bookSessionTool` ×2, `rescheduleSessionTool`). The 8 owner-facing call sites (`admin-menu.ts:286/315`, `ai-owner-agent.ts:801/823/857/925/1111`, `ai-onboarding-agent.ts:507`) keep the current default so an owner can still find and act on (cancel/assign) a same-day class after its start time via chat — confirmed `ai-owner-agent.ts:823`'s `cancel_session` tool would otherwise be unable to locate that class at all.
- **D-02 (LOCKED — corrects a duplication smell, not required but near-zero-cost):** Since this touches the exact "is this session's time already past" logic, consolidate the two existing near-identical inline copies of `hoursUntilSession(sessionDate, sessionTime)` (one in `client-menu.ts:103-119`, one in `function-executor.ts` per that file's own "copied verbatim" comment) into one shared export in `src/utils/timezone.ts` (which already owns `isoDateInAthens`/`addCalendarDays`). `manager.ts`'s new filter reuses this shared helper instead of introducing a third copy.

### Open-slot booking button (UX-05)

- **D-03 (LOCKED):** For businesses where `bookingMode !== 'fixed_sessions'`, relabel the root-menu button itself (currently unconditional "Κράτηση μαθήματος" at `client-menu.ts:78`) so the menu signals the real behavior upfront, instead of the client discovering the redirect only after tapping. Exact new label is Claude's discretion (see below) — keep it short, matching existing tone.
- **D-04 (LOCKED):** `showBookSessionList`'s open-slot redirect branch (`client-menu.ts:129-136`, currently bare `sendTelegramMessage` with no keyboard) gets the same trailing back-button keyboard its sibling `available.length === 0` branch already has, three lines below it. This is a "match the existing sibling pattern" fix, not new design.
- **Not folded into this decision:** `business.slotlessRequestsEnabled` (`src/session/slotless-requests.ts`) is a separate, unrelated concept from `bookingMode` — not in scope here.

### Callback fallback recovery (UX-06)

- **D-05 (LOCKED):** Fix all 3 silence layers found in `src/webhooks/telegram.ts` and the two menu handlers:
  1. **Layer 2 — recognized prefix, unknown action:** `admin-menu.ts:667-669` and `client-menu.ts:581-583` default cases currently send text only (`'Άγνωστη ενέργεια...'`) with no keyboard — add the back-menu keyboard to both.
  2. **Client cancel-flow early-returns:** `handleCancelExecute` (`client-menu.ts:390-419`) has 3 early-return guards (booking not found / wrong owner / wrong status) that `sendTelegramMessage` + `return` with no keyboard. Admin's equivalent `handleClassCancelExecute` (`admin-menu.ts:355-374`) already converges both its success and not-found branches on a trailing back-menu keyboard — make the client function match that existing, already-correct pattern.
  3. **Layer 1 — genuinely unparseable callback_data:** `parseCallbackData()` returning `null` (`telegram.ts:544-561`) currently logs a warning and returns with nothing sent to the user beyond the automatic spinner-dismiss. Send a back-menu message here too instead of a fully silent drop. Same fix applies to the narrower legacy instance at `telegram.ts:1031-1035` (`approve_<id>`/`reject_<id>` callback for an unknown booking).
- **Claude's Discretion:** Whether to also attach a native Telegram toast (`answerCallbackQuery`'s optional `text` param, currently unused everywhere) alongside the back-menu message/keyboard, or keep the existing text+keyboard-only pattern. Not required — the existing pattern (message + keyboard) is sufficient to satisfy "back-to-menu recovery option."

### Cleanup scope while touching this code

- **D-06 (LOCKED):** Extract a `findSessionInstanceById(businessId, instanceId)` helper into `src/session/manager.ts` (co-located with `listSessions`/`cancelSession`), replacing the 3 near-duplicate inline Drizzle joins currently in `client-menu.ts:204-217`, `admin-menu.ts` (needed fresh for UX-02's `showCancelClassConfirm` fix), and `telegram.ts:606-612`. This phase already touches all 3 call sites for UX-02/UX-04 — near-zero marginal cost to centralize instead of adding a 3rd/4th copy.
- **D-07 (LOCKED):** Add shared back-menu button label constants (extending `src/utils/greek-messages.ts`, per its existing "button-label strings only" scope) for the admin `'« Πίσω στο Μενού'` → `menu:root` pattern (currently 11+ inline literal repeats) and to reconcile the client side's two inconsistent labels (`'« Πίσω'` vs `'« Αρχικό μενού'`, both → `cmenu:root`) into one. UX-06 (D-05) is already adding several new back-menu keyboards this phase — centralize now rather than adding more inline copies.
- **Explicitly out of scope:** Unifying the 3 different Greek phrasings for `open_slots`/`fixed_sessions` across `admin-menu.ts`/`ai-owner-agent.ts`/`ai-onboarding-agent.ts` — real inconsistency, but touches files unrelated to this phase's actual bugs; not worth the extra diff surface here.

### Cancel-confirm context + list display (UX-02, UX-04)

- **D-08 (LOCKED):** Admin's `showCancelClassConfirm` (`admin-menu.ts:339-353`, currently literally `"Να ακυρωθεί το μάθημα #42;"`) gains a `business` param (its caller, `handleMenuCallback`'s `'classes:cancel_confirm_req'` case, already has `business` in scope) and uses the new `findSessionInstanceById` (D-06) + existing `findServiceById` (`queries.ts:348-358`) to show date + service name instead of the raw instance ID.
- **D-09 (LOCKED):** Client's `showCancelConfirm` (`client-menu.ts:369-383`, currently generic "Να ακυρωθεί αυτή η κράτηση;" with zero context — not literally a raw ID, but an equivalent gap) is enriched the same way, using the already-imported-elsewhere `findBookingByIdUnscoped` (no join needed — `Booking` rows carry `calendarDate`/`calendarTime`/`serviceId` directly) + `findServiceById` (needs a new import into `client-menu.ts`).
- **D-10 (LOCKED):** All 5 identified list gaps get the service-name treatment using the exact `Map<number,string>` dedup-per-serviceId pattern already proven in `formatAgendaMessage`/`showTodaysAgenda`/`runAgendaSweep` (`findServiceById` batched, not N+1): `showClassesMenu` (`admin-menu.ts:290-292`), `showCancelClassList` (`admin-menu.ts:324-328`), `showBookSessionList` (`client-menu.ts:153-157`), `showClientBookings` (`client-menu.ts:316`), `showCancelBookingList` (`client-menu.ts:356-360`).

### Claude's Discretion
- Exact Greek wording for the relabeled open-slot booking button (D-03).
- Exact Greek wording for the new back-menu messages accompanying Layer-1/early-return fixes (D-05) — reuse existing tone (e.g. admin's `'Τι άλλο θέλεις να κάνεις;'` style).
- Exact boundary semantics for "already passed" — a class starting at exactly the current minute counts as bookable or not (`<=` vs `<`). Low-stakes; pick either and note it in the PLAN.
- Naming/shape of the new `findSessionInstanceById` and the new back-menu constants in `greek-messages.ts`.
- Whether `assign_client_to_session`'s owner-tool call site (`ai-owner-agent.ts:857/1111`) needs any UX touch beyond keeping its default (non-excluding) `listSessions()` behavior — not flagged as a gap during discussion, no change expected.

### Folded Todos

**`2026-07-27-fix-same-day-past-time-slots-showing-as-bookable.md`** — Original problem: `listSessions()` filters by date only, never by time-of-day when `sessionDate === today`, so already-started same-day slots still show as bookable. Already tagged `resolves_phase: 29`. Fully folded — its diagnosis (exact function, exact gap) is the technical basis for D-01/D-02; scope IS UX-01.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` — UX-01, UX-02, UX-04, UX-05, UX-06 exact requirement text (lines 23-28).
- `.planning/ROADMAP.md` — Phase 29 goal, 5 success criteria, declared dependency on Phase 26 (contextual cancel-confirm prompts extend Phase 26's confirmation pattern).

### Folded todo (technical diagnosis)
- `.planning/todos/pending/2026-07-27-fix-same-day-past-time-slots-showing-as-bookable.md` — exact `listSessions()` gap, already scoped to `src/session/manager.ts:483` (now confirmed at line 498-529).

### Prior locked decisions (Phase 26 — still binding, referenced by D-06 note below)
- `.planning/phases/26-confirmation-approval-policy/26-CONTEXT.md` D-06: consequence-preview text was explicitly deferred from cancel-confirm prompts in Phase 26 ("UX-02 already covers showing date/service in cancel-specific prompts — this decision generalizes that same restraint"). This phase (UX-02) is that deferred piece — restate action + context, no consequence preview, consistent with Phase 26's precedent.
- `src/utils/greek-messages.ts` (Phase 26/27) — "button-label strings only" scope; D-07's new back-menu constants extend this file consistent with its existing design intent, not a new pattern.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `findServiceById(businessId, serviceId): Promise<Service | null>` (`src/database/queries.ts:348-358`) — established name-resolution helper, already used in `showTodaysAgenda`/`runAgendaSweep`/`formatAgendaMessage`.
- `findBookingByIdUnscoped(bookingId): Promise<Booking | null>` (`src/database/queries.ts:493-496`) — already imported into `client-menu.ts`, sufficient for D-09 (no join needed).
- `formatAgendaMessage` (`src/scheduler/agenda.ts:43-49`) — the exact `Map<number,string>` dedup pattern to copy for D-10's 5 list fixes.
- `handleClassCancelExecute` (`admin-menu.ts:355-374`) — the already-correct "always show back-menu keyboard regardless of branch" pattern that D-05's client-side fix should match.

### Established Patterns
- Callback-data-per-file convention (Phase 26): `menu:<action>`, `cmenu:<action>` — no global callback helper; D-07's new constants are labels only, not a callback-routing change.
- `src/utils/timezone.ts` already owns `isoDateInAthens`/`addCalendarDays` — the natural home for D-02's consolidated `hoursUntilSession`.

### Integration Points
- `src/session/manager.ts` — `listSessions()` signature change (D-01) + new `findSessionInstanceById` export (D-06).
- `src/telegram/handlers/admin-menu.ts` — `showCancelClassConfirm` (D-08), `showClassesMenu`/`showCancelClassList` list fixes (D-10), default-case fix (D-05.1).
- `src/telegram/handlers/client-menu.ts` — `showCancelConfirm` (D-09), `showBookSessionList`/`showClientBookings`/`showCancelBookingList` list fixes (D-10), `handleCancelExecute` (D-05.2), root-menu button relabel (D-03), default-case fix (D-05.1).
- `src/webhooks/telegram.ts` — `parseCallbackData()` null-path fix + legacy `approve_/reject_` unknown-booking path (D-05.3).
- `src/utils/greek-messages.ts` — new back-menu constants (D-07).
- `src/utils/timezone.ts` — consolidated `hoursUntilSession` (D-02).

</code_context>

<specifics>
## Specific Ideas

No exact copy specified beyond matching each area's existing tone (admin's terse confirmations, client's existing redirect-message style) — see Claude's Discretion above for the specific wording gaps left open.

</specifics>

<deferred>
## Deferred Ideas

- Unifying the 3 different Greek phrasings for `open_slots`/`fixed_sessions` across `admin-menu.ts`/`ai-owner-agent.ts`/`ai-onboarding-agent.ts` — real inconsistency found during research, explicitly scoped out of this phase (see "Cleanup scope" above) since it touches files unrelated to this phase's actual bugs. Candidate for a future polish pass.

### Reviewed Todos (not folded)

- `2026-07-27-research-telegram-persistent-menu-button-reliability.md` — tagged `resolves_phase: 30`, not this phase.
- `2026-07-07-pivot-to-per-business-whatsapp-numbers-post-poc.md`, `2026-07-09-meta-business-verification-not-submitted.md` — unrelated planning/infra items, matched only on generic keywords.

</deferred>

---

*Phase: 29-booking-list-clarity*
*Context gathered: 2026-07-28*
