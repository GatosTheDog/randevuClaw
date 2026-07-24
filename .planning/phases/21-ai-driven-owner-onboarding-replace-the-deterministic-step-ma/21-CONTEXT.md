# Phase 21: AI-Driven Owner Onboarding - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the deterministic step-machine owner onboarding flow (`src/onboarding/steps.ts`, `src/onboarding/router.ts`, `src/onboarding/edit-router.ts`) with a Gemini tool-calling agent, following the exact pattern `aiOwnerAgent` (`src/onboarding/ai-owner-agent.ts`) already uses for post-onboarding conversation. Covers the full 25-step flow: business name, weekly hours (7 days), services, class-schedule setup (recurrence/capacity), and the v1.3 optional-feature config toggles.

Out of scope: post-onboarding conversation (`aiOwnerAgent` itself is unchanged), client-facing booking flow, billing/membership flows.

</domain>

<decisions>
## Implementation Decisions

### Replacement scope
- **D-01:** Full agent replacement, not a hybrid patch. The entire onboarding flow (name → hours → services → class setup → config toggles) becomes one freeform, multi-turn Gemini tool-calling conversation — the owner can answer multiple fields in one message (e.g. "BodyGlowPilates, ανοιχτά 9-9 όλες τις μέρες, pilates 45λεπτά 15ευρώ"), same conversational feel as `aiOwnerAgent`.
- Tool definitions should mirror `OWNER_TOOLS` in `ai-owner-agent.ts` in style: one tool per discrete onboarding action (e.g. `set_business_name`, `set_business_hours`, `add_service`, `create_recurring_session`/class setup, `set_config_option`), each executed via a function-executor pattern.

### Resumability
- **D-02:** Stateless resume — no step-index or `collectedData` tracking in `onboarding_sessions`. Each turn, the agent re-derives what's already configured by reading current DB state directly (`listServicesForBusiness`, `listBusinessHours`, the `businesses` row itself) and its own system prompt decides what's still missing and what to ask next — exactly how `aiOwnerAgent` already establishes context on every call. This preserves the existing ONB-03 "owner can drop off and resume" guarantee without a separate state machine to keep in sync.
- The `onboarding_sessions` table's `currentStep`/`collectedData` columns become unused by the new flow. Planner should decide whether to drop them (migration) or leave them inert — flag as an open question for research/planning, not decided here.
- `business.onboardingCompleted` (or equivalent completion signal) must still exist so `handleFoundBusiness`/the callback_query branch in `telegram.ts` know when to stop routing to the onboarding agent and start routing to `aiOwnerAgent`/the admin menu.

### Fallback when Gemini can't parse
- **D-03:** Gemini generates its own Greek clarifying follow-up when it can't confidently extract a field from free text — not a fixed canned error string. Must reuse the same `MAX_TOOL_ROUNDS`-style cap `aiOwnerAgent` already applies (see `ai-owner-agent.ts` line ~38, `MAX_TOOL_ROUNDS = 5`) to prevent an infinite back-and-forth if the owner keeps giving unparseable answers — cap should return a graceful Greek "something went wrong, try again" message identical in spirit to `aiOwnerAgent`'s existing round-limit fallback.

### Claude's Discretion
- Exact tool schema/field names for each onboarding action (name, hours, services, class setup, config toggles) — researcher/planner should design these to parallel `OWNER_TOOLS` naming conventions already established in `ai-owner-agent.ts`.
- Whether the onboarding agent is a separate Gemini agent instance/system-prompt from `aiOwnerAgent`, or the same agent with an onboarding-mode system prompt — planner's call, but they are almost certainly separate given very different tool sets and completion semantics.
- Whether `/start` mid-onboarding reset behavior (current `router.ts` line 61-65) is preserved as-is or becomes a tool the agent can call.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing AI-agent pattern to replicate
- `src/onboarding/ai-owner-agent.ts` — the exact Gemini tool-calling pattern to follow: `OWNER_TOOLS` definitions, `MAX_TOOL_ROUNDS` loop cap, `ai.interactions.create` usage (note: model name currently reads `gemini-3.1-flash-lite` after a same-day incident fix — see Specifics below), `executeOwnerTool` dispatch pattern.
- `src/conversation/function-executor.ts` — sibling tool-execution pattern for the client-facing conversation agent; useful cross-reference for how tool results get threaded back to Gemini.

### Code being replaced
- `src/onboarding/steps.ts` — all 10 step-handler functions (`handleNameStep`, `handleHoursQueryStep`, `handleHoursRangeStep`, `handleSvcNameStep`, `handleSvcPriceStep`, `handleSvcDurationStep`, `handleSvcMoreStep`, `handleConfigBookingModeStep`, `handleConfigCancellationCutoffStep`, `handleConfigSlotlessRequestsStep`, `handleConfigLastSessionThresholdStep`, `handleClassSetupQuery`, `handleClassSetupServiceStep`, `handleClassSetupWeekdaysStep`, `handleClassSetupTimeStep`, `handleClassSetupCapacityStep`, `handleClassSetupMoreStep`) — regex/keyword-based free-text parsing, to be replaced by Gemini tool calls.
- `src/onboarding/router.ts` — `dispatchOnboardingStep` step-dispatch switch, to be replaced by a single agent-invocation entry point.
- `src/onboarding/edit-router.ts` — post-onboarding settings-edit flow; same free-text parsing pattern (`handleEditFlow` and friends) — confirm with planner whether this is in scope for this phase or a follow-up (roadmap goal text only mentions the onboarding flow, not post-onboarding edit).
- `src/onboarding/queries.ts` — `OnboardingSession` interface, `findActiveSessionByOwnerTelegramId`, `createOrResetOnboardingSession`, `updateOnboardingStep` — current resumability plumbing, likely simplified per D-02.

### Webhook routing integration points
- `src/webhooks/telegram.ts` lines ~73-145 (`handleFoundBusiness`) — the `!business.onboardingCompleted` branch that currently calls `dispatchOnboardingStep`; must be updated to call the new onboarding agent instead.
- `src/webhooks/telegram.ts` lines ~814-841 — the callback_query onboarding branch added today (2026-07-24) to route inline-keyboard taps (Ναι/Όχι) to onboarding during setup — same integration point needs updating for the new agent, including the `editTelegramMessageReplyMarkup` "clear keyboard after tap" behavior added in the same fix.

### Prior architecture decision this phase must respect
- `.planning/PROJECT.md` line 116 — ADR: "25-step Telegram onboarding state machine (DB-backed, resumable) — No session storage needed; owner can drop off and resume; chat is the only interface — ✓ Good — ONB-03 resume confirmed." D-02 above is how this phase satisfies that same guarantee under the new architecture.
- `.planning/PROJECT.md` line 125 — prior incident note: "Onboarding-incomplete routing checked before /menu pre-emption in handleFoundBusiness ... the routing block itself was silently dropped by a later merge and had to be restored at v1.4 close." The equivalent routing check must not be dropped again in this rewrite.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getConn()` from `src/database/queries.ts` — **MANDATORY** for any DB read/write inside the new onboarding agent's tool-execution code. Discovered and fixed today (2026-07-24): `steps.ts` and `edit-router.ts` previously used the raw `db` import directly instead of `getConn()`, which opens a second Postgres connection outside the `withBusinessContext` transaction already open for the request. That second connection can deadlock against the dedup-insert transaction's implicit row lock on `businesses` (confirmed via `pg_stat_activity`/`pg_locks` — a genuine, 100%-reproducible silent hang with zero error logged). The new agent's tool-executor MUST use `getConn()` everywhere, never import `db` directly.
- `MAX_TOOL_ROUNDS` pattern from `ai-owner-agent.ts` — reuse directly for the new onboarding agent's loop cap.
- `withBusinessContext` (`src/database/queries.ts`) — already wraps the whole webhook request in an RLS-enforced transaction; the new onboarding agent's DB calls will run inside this automatically via `getConn()`.

### Established Patterns
- Tool-calling shape: `ai.interactions.create({ model, input, tools, system_instruction, previous_interaction_id, generation_config })` via `@google/genai` SDK (confirmed working today with `model: 'gemini-3.1-flash-lite'`).
- Owner vs client routing: `business.ownerTelegramId === senderTelegramId` gate, checked before `!business.onboardingCompleted`, in both the message path (`handleFoundBusiness`) and the callback_query path (`telegram.ts`).
- Inline-keyboard cleanup: `editTelegramMessageReplyMarkup(chatId, messageId, [])` called right after `answerCallbackQuery` to clear buttons post-tap — established convention across `handleCallbackQuery`, now also used in the onboarding callback branch.

### Integration Points
- `src/webhooks/telegram.ts` — both the message-path and callback_query-path onboarding branches need to call the new agent instead of `dispatchOnboardingStep`.
- `src/database/schema.ts` — `onboardingSessions` table (`currentStep`, `collectedData` columns) likely needs a migration if D-02's stateless approach makes them fully unused; planner to confirm scope.

</code_context>

<specifics>
## Specific Ideas

- Triggering bug (verbatim, screenshot 2026-07-24 17:16): owner typed `"9 το πρωι με 9 το βραδυ και ενα διαλυμα απο 1 μεχρι 5"` (free-text Greek: "9am to 9pm with a break from 1 to 5") into the hours-range step, which only accepts strict `ΩΩ:ΛΛ-ΩΩ:ΛΛ` regex and rejected it with "Μη έγκυρο. Χρησιμοποιήστε μορφή...". This exact phrase is a good manual test case for the new agent's hours-parsing tool.
- Same-day incident note (not part of this phase, but relevant history): `GEMINI_MODEL` was flip-flopped between `gemini-2.5-flash-lite` (confirmed dead — HTTP 404 "no longer available to new users" for this API key) and `gemini-3.1-flash-lite` (confirmed working) across both `ai-agent.ts` and `ai-owner-agent.ts` during live debugging today. Currently deployed/committed state uses `gemini-3.1-flash-lite`. The new onboarding agent should use the same constant/model as `ai-owner-agent.ts` — do not hardcode a separate model string that could drift.

</specifics>

<deferred>
## Deferred Ideas

- `src/onboarding/edit-router.ts` (post-onboarding settings editing via chat) uses the same regex free-text pattern as `steps.ts` — arguably deserves the same AI treatment, but the roadmap goal for this phase only names the onboarding flow. Flagged for planner to explicitly scope in or out; if out, note as a follow-up phase.
- Dropping/migrating the now-possibly-unused `onboardingSessions.currentStep`/`collectedData` columns (per D-02) — deferred to planning, not decided as in/out of scope here.

### Reviewed Todos (not folded)
- `2026-07-07-pivot-to-per-business-whatsapp-numbers-post-poc.md` — matched by keyword only ("post", "requirements"); unrelated to this phase (WhatsApp numbers, not onboarding flow). Not folded.
- `2026-07-09-meta-business-verification-not-submitted.md` — matched by keyword only ("plan", "phase"); unrelated (Meta Business Verification, not onboarding flow). Not folded.

</deferred>

---

*Phase: 21-AI-Driven Owner Onboarding*
*Context gathered: 2026-07-24*
