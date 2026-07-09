---
phase: 02-ai-booking-conversations-owner-alerts
plan: 4
subsystem: ai
tags: [gemini, google-genai, function-calling, telegram, zod, jest]

requires:
  - phase: 02-ai-booking-conversations-owner-alerts (plan 1)
    provides: "Typed query layer (services/bookings/business_hours/conversation_turns), partial unique index for slot atomicity, businesses.ownerTelegramId"
  - phase: 02-ai-booking-conversations-owner-alerts (plan 2)
    provides: "Telegram Bot API client (sendTelegramMessage, sendTelegramMessageWithKeyboard), Telegram webhook shell with business resolution + dedup"
  - phase: 02-ai-booking-conversations-owner-alerts (plan 3)
    provides: "checkAvailability(businessId, serviceId, calendarDate, referenceNow?), resolveGreekTemporalExpressions(text, referenceDate)"
provides:
  - "aiBookingAgent(userMessage, business, clientPhone, previousInteractionId) — sequential Gemini function-calling loop, Greek system prompt grounded in live business data, 429 exponential backoff"
  - "executeTool(name, args, context) — tool dispatcher with cross-tenant, booking-ownership, and idempotent-retry-vs-slot-taken guardrails for check_availability/book_appointment/cancel_appointment/reschedule_appointment"
  - "routeConversationMessage(business, senderId, rawMessageText, channel) — channel-agnostic conversation core (D-03) tying consent, Greek preprocessing, AI conversation, and turn persistence together"
  - "Telegram webhook's business-found branch now drives a real Gemini conversation instead of Plan 02-02's static greeting"
affects: [02-05]

tech-stack:
  added: ["@google/genai@^2.10.0"]
  patterns:
    - "Sequential (never Promise.all) tool-call execution inside aiBookingAgent's for..of loop over interaction.steps function_call entries — the load-bearing correctness property preventing concurrent double-booking races"
    - "Single requestId (randomUUID) generated once per aiBookingAgent invocation, threaded through every executeTool call in that turn via ToolContext, for idempotent-retry detection"
    - "Local structural TypeScript interfaces (GeminiCreateParams/GeminiInteractionResult/GeminiFunctionResultInput) wrapping the real @google/genai SDK call, since its internal Interaction/Step/Tool types are not exported from the package"
    - "Shared resolveConflictOrTaken(clientPhone, requestId) helper disambiguates an insertBooking() null return (either unique-index conflict) into idempotent-replay (same request_id, cached result, no second alert) vs. genuine slot_taken (different request_id, no alert)"
    - "Channel-agnostic core (ConversationChannel interface) — routeConversationMessage takes a { sendMessage } adapter so the same booking-conversation logic will serve WhatsApp again without modification once Business Verification clears"

key-files:
  created:
    - src/conversation/ai-agent.ts
    - src/conversation/function-executor.ts
    - src/conversation/router.ts
    - tests/ai-agent.test.ts
    - tests/function-executor.test.ts
    - tests/conversation-router.test.ts
  modified:
    - package.json
    - package-lock.json
    - src/webhooks/telegram.ts
    - tests/telegram-webhook.test.ts

key-decisions:
  - "Adapted AI-SPEC's illustrative camelCase pseudocode (systemInstruction, top-level temperature/max_output_tokens/top_p) to the REAL installed @google/genai@2.10.0 SDK's actual field names (system_instruction, previous_interaction_id, nested generation_config), verified directly against node_modules/@google/genai/dist/node/node.d.ts — the pseudocode's literal field names would not have compiled"
  - "GEMINI_MODEL = 'gemini-3.5-flash' kept exactly as AI-SPEC specified — confirmed present in the real SDK's Model union type, no substitution needed"
  - "ai-agent.ts defines its own minimal local structural types for the Gemini interaction/step/tool-result shapes instead of importing the SDK's internal types, since GoogleGenAIInteraction/Interaction/Step are not exported from @google/genai's public API surface"
  - "checkAvailabilityTool casts AvailabilityResult to Record<string, unknown> at the executeTool boundary (no index signature on the interface) — a static-type-only widening, no behavior change, since every tool result must be JSON-serializable back to Gemini"

patterns-established:
  - "Pattern: wrap a versioned, partially-unexported third-party SDK behind a small set of local structural types at the single call site, rather than fighting overload resolution against internal type names"
  - "Pattern: dispatcher-level guardrail (cross_tenant_denied) checked exactly once before any per-tool switch branch, so every current and future tool inherits the check for free"

requirements-completed: [BOOK-01, BOOK-02, BOOK-03, BOOK-04, ASK-01, ASK-02, OWNR-02]

coverage:
  - id: D1
    description: "aiBookingAgent runs a correct sequential, idempotency-keyed, rate-limit-resilient Gemini function-calling loop grounded in real business data, with D-07's 'never say confirmed' rule hard-coded into the system prompt"
    requirement: "ASK-01"
    verification:
      - kind: unit
        ref: "tests/ai-agent.test.ts (9 tests, @google/genai + function-executor mocked)"
        status: pass
    human_judgment: false
  - id: D2
    description: "executeTool implements check_availability/book_appointment/cancel_appointment/reschedule_appointment with cross-tenant, booking-ownership, and idempotent-retry-vs-slot-taken guardrails (AI-SPEC Section 6)"
    requirement: "BOOK-01"
    verification:
      - kind: unit
        ref: "tests/function-executor.test.ts (12 tests, database/availability/telegram-client mocked)"
        status: pass
    human_judgment: false
  - id: D3
    description: "routeConversationMessage ties consent, Greek temporal preprocessing, AI conversation, and turn persistence together as a channel-agnostic core; Telegram webhook's business-found branch now drives it instead of the static Plan 02-02 reply"
    requirement: "BOOK-02"
    verification:
      - kind: unit
        ref: "tests/conversation-router.test.ts (4 tests) + tests/telegram-webhook.test.ts (5 tests, updated for the new architecture)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A client can book, cancel, reschedule, or ask a question via a real Telegram + Gemini round trip, with owner alerts flowing correctly (Αποδοχή/Απόρριψη buttons naming the exact booking, FYI-only cancellation alerts)"
    requirement: "BOOK-03"
    verification: []
    human_judgment: true
    rationale: "Requires a deployed/locally-run bot, a registered Telegram webhook, and a live Gemini API call — not mockable in CI. Deferred to end-of-phase human verification per this project's human_verify_mode: end-of-phase config, matching Plan 02-02/02-03's identical precedent for the equivalent live-round-trip checkpoint."

duration: ~50min
completed: 2026-07-08
status: complete
---

# Phase 2 Plan 4: AI Booking Conversation Engine Summary

**Direct @google/genai sequential function-calling loop (aiBookingAgent) + guardrailed tool executor (executeTool) + channel-agnostic conversation router, wired into the Telegram webhook in place of Plan 02-02's static greeting — the load-bearing vertical slice that makes double-booking-proof, idempotent, cross-tenant-safe Greek booking conversations real**

## Performance

- **Duration:** ~50 min
- **Tasks:** 3/3 completed
- **Files modified:** 10 (6 created, 4 modified)

## Accomplishments
- `src/conversation/ai-agent.ts`: `aiBookingAgent` — a sequential (never `Promise.all`), idempotency-keyed Gemini function-calling loop, with a Greek system prompt built from the business's real services/hours (no hallucination surface) and hard-coding the D-07 "never say confirmed" rule as a literal instruction; `callGeminiWithRetry` implements 4-attempt exponential backoff with jitter, returning a graceful `RATE_LIMIT_REPLY_GREEK` message instead of throwing once retries are exhausted
- `src/conversation/function-executor.ts`: `executeTool` dispatches `check_availability`/`book_appointment`/`cancel_appointment`/`reschedule_appointment`, each guarded by a single dispatcher-level cross-tenant `business_id` check (T-02-12), booking-ownership checks on cancel/reschedule (T-02-13), and a shared `resolveConflictOrTaken` helper disambiguating an `insertBooking` conflict into idempotent-replay vs. genuine `slot_taken` (T-02-14, satisfying Plan 02-01's explicit deferral of this logic)
- `src/conversation/router.ts`: `routeConversationMessage` — the channel-agnostic conversation core (D-03) tying consent (`getOrCreateClientRelationship`), Greek temporal preprocessing (`resolveGreekTemporalExpressions`), the AI agent, and conversation-turn persistence together; persists the RAW client message text, never the Gemini-facing annotated version
- `src/webhooks/telegram.ts`: business-found branch now calls `routeConversationMessage` instead of Plan 02-02's static `buildBusinessFoundReplyGreek` reply; business-not-found and callback_query branches untouched
- Full regression suite: 118/118 tests pass (30 new across the 4 test files this plan touches), `npx tsc --noEmit` clean

## Task Commits

1. **Task 1: Gemini sequential function-calling loop with Greek system prompt and 429 backoff** - `ead284a` (feat)
2. **Task 2: Tool executor — check_availability/book_appointment/cancel_appointment/reschedule_appointment with guardrails** - `d382bad` (feat)
3. **Task 3: Channel-agnostic conversation router + wire into the Telegram webhook** - `49d4314` (feat)

## Files Created/Modified
- `src/conversation/ai-agent.ts` - `aiBookingAgent`, `AiAgentResult`, `RATE_LIMIT_REPLY_GREEK`, internal `GeminiRateLimitError`/`BOOKING_TOOLS`/`buildSystemInstruction`/`callGeminiWithRetry`
- `src/conversation/function-executor.ts` - `ToolContext`, `executeTool`, internal per-tool functions + `alertOwnerNewBooking`/`resolveConflictOrTaken` helpers
- `src/conversation/router.ts` - `ConversationChannel`, `routeConversationMessage`
- `src/webhooks/telegram.ts` - `handleFoundBusiness` now delegates to `routeConversationMessage`; dropped now-dead `getOrCreateClientRelationship`/`CONSENT_NOTICE_GREEK_TEMPLATE`/`buildBusinessFoundReplyGreek` imports
- `package.json` / `package-lock.json` - added `@google/genai@^2.10.0`
- `tests/ai-agent.test.ts` - 9 tests, `@google/genai` (manual factory mock around the `interactions` getter) + `function-executor` mocked
- `tests/function-executor.test.ts` - 12 tests, `database/queries`/`business/availability`/`telegram/client` mocked
- `tests/conversation-router.test.ts` - 4 tests, partial `consent/checker` mock (keeps the real `CONSENT_NOTICE_GREEK_TEMPLATE`) plus `database/queries`/`greek-preprocessor`/`ai-agent` mocked
- `tests/telegram-webhook.test.ts` - rewritten: business-found assertions now check `routeConversationMessage` is called with the channel adapter, instead of asserting a direct `sendTelegramMessage` reply; dedup/403/callback_query coverage preserved

## Decisions Made
- Adapted the AI-SPEC's illustrative pseudocode field names to the real `@google/genai@2.10.0` SDK's actual `ai.interactions.create()` signature (see Deviations below) — verified directly against the installed package's type declarations rather than assuming the pseudocode was executable as literally written
- `GEMINI_MODEL = 'gemini-3.5-flash'` kept exactly as specified; confirmed present in the real SDK's model union
- Defined local structural types for the Gemini interaction/step/tool-call shapes in `ai-agent.ts` rather than importing the SDK's internal (non-exported) `Interaction`/`Step`/`Tool` types
- `resolveConflictOrTaken` extracted as a shared private helper used by both `bookAppointmentTool` and `rescheduleAppointmentTool`, per the plan's explicit instruction not to duplicate that block verbatim

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] AI-SPEC's Gemini SDK call shape does not match the actually-installed `@google/genai@2.10.0` package**
- **Found during:** Task 1, immediately after `npm install @google/genai@^2.10.0` and reading its shipped type declarations (`node_modules/@google/genai/dist/node/node.d.ts`) before writing `ai-agent.ts`
- **Issue:** The plan's `<action>` and AI-SPEC Section 3/4 pseudocode specify camelCase fields (`systemInstruction`, top-level `temperature`/`max_output_tokens`/`top_p` directly on the `interactions.create()` params object). The real installed SDK's `ai.interactions.create()` signature uses snake_case (`system_instruction`, `previous_interaction_id`) and nests all sampling parameters under a `generation_config` object. Writing the code exactly as the plan's pseudocode specified would have failed `npx tsc --noEmit` (an explicit acceptance criterion) against the real, currently-published package version the plan itself directs installing.
- **Fix:** Implemented `ai-agent.ts` against the verified real field names/shapes (confirmed `ai.interactions.create()` does exist as a genuine SDK method — a preview "next-gen interactions" surface — with `id`/`steps`/`output_text` on the response and `function_call`/`function_result` step shapes matching the plan's conceptual design almost exactly, just with different field casing/nesting). Defined local structural TypeScript interfaces for the request/response shapes since the SDK's internal `Interaction`/`Step`/`Tool` types are not exported from its public API surface, and cast at the single `ai.interactions.create()` call site.
- **Files modified:** src/conversation/ai-agent.ts
- **Verification:** `npx tsc --noEmit` exits 0; all 9 ai-agent.test.ts behavior cases pass against a manually-mocked `@google/genai` module
- **Committed in:** ead284a (Task 1 commit)

**2. [Rule 1 - Bug] `AvailabilityResult` has no index signature, breaking `executeTool`'s `Record<string, unknown>` return contract**
- **Found during:** Task 2, first `npx tsc --noEmit` run after wiring `checkAvailabilityTool` to return `checkAvailability`'s result directly
- **Issue:** `checkAvailability` (Plan 02-03) returns the `AvailabilityResult` interface, which TypeScript does not treat as structurally assignable to `Record<string, unknown>` (no index signature) — `npx tsc --noEmit` failed
- **Fix:** Added a one-line explanatory comment and a structural cast (`as unknown as Record<string, unknown>`) at the `checkAvailabilityTool` return — a static-type-only widening with zero runtime behavior change, since the value is still the exact same JSON-serializable object
- **Files modified:** src/conversation/function-executor.ts
- **Verification:** `npx tsc --noEmit` exits 0; tests/function-executor.test.ts Test 1 confirms the result is passed through unchanged
- **Committed in:** d382bad (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs — the plan's illustrative pseudocode/type assumptions didn't match the real installed dependency's actual shape)
**Impact on plan:** Both fixes were necessary for the code to compile against the real, currently-published `@google/genai@2.10.0` package this same plan directs installing. No architectural change, no scope creep — the conceptual design (sequential loop, tool schemas, guardrails) is implemented exactly as specified; only the wire-level field names/casing differ from the pseudocode.

## Issues Encountered

None beyond the two deviations documented above.

## User Setup Required

None beyond what Plans 02-01/02-02 already surfaced (live Neon push/seed, live Telegram webhook registration) — this plan adds no new external-service dependency (the `GEMINI_API_KEY` env var was already required and validated by Plan 02-01's fail-fast `Config`).

**Note for end-of-phase human verification:** this plan's `<verify><human-check>` (send a real Telegram message to a fixture business containing a Greek booking request, confirm the AI's Greek reply uses "pending owner confirmation" framing and never "confirmed", and confirm the owner's Telegram account receives a matching Αποδοχή/Απόρριψη alert) is deferred to end-of-phase verification per this project's `human_verify_mode: end-of-phase` config setting — identical precedent to Plans 02-02 and 02-03's live-round-trip checkpoints.

## Next Phase Readiness
- `aiBookingAgent`, `executeTool`, and `routeConversationMessage` are locked exactly to this plan's `<interfaces>` contract — Plan 02-05 (owner accept/reject via `callback_query`) can import all three verbatim
- Plan 02-05's insertion point (`// TODO Plan 02-05` in `handleTelegramWebhookPost`'s `callback_query` branch) is untouched by this plan, exactly as required
- Every guardrail in AI-SPEC Section 6 that prevents double-booking, duplicate owner alerts, cross-tenant leakage, and wrong-client cancellation is implemented and unit-tested in `function-executor.ts` — Plan 02-05 can consume correctly-shaped `pending_owner_approval` booking rows without re-deriving any of this correctness
- **Blocker for going live (not for continuing development):** the live Neon push, live seed run, and live Telegram webhook registration (all pre-existing from Plans 02-01/02-02) are still pending user action; this plan's own human-check (real Gemini + Telegram round trip) is likewise deferred to end-of-phase verification

---
*Phase: 02-ai-booking-conversations-owner-alerts*
*Completed: 2026-07-08*

## Self-Check: PASSED

All claimed files verified present: src/conversation/ai-agent.ts, src/conversation/function-executor.ts, src/conversation/router.ts, tests/ai-agent.test.ts, tests/function-executor.test.ts, tests/conversation-router.test.ts, src/webhooks/telegram.ts, tests/telegram-webhook.test.ts, package.json.
All claimed commits verified present: ead284a, d382bad, 49d4314.
