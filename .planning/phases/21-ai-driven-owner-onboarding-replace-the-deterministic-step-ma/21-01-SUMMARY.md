---
phase: 21-ai-driven-owner-onboarding-replace-the-deterministic-step-ma
plan: 01
subsystem: ai
tags: [gemini, function-calling, onboarding, telegram, drizzle, rls]

# Dependency graph
requires:
  - phase: 21 (same phase, prior groundwork)
    provides: "callback_query onboarding-routing fix + getConn()/RLS call-site refactor (commit 5454622), already in working tree before this plan started"
provides:
  - "src/onboarding/ai-onboarding-agent.ts — a standalone, fully unit-tested Gemini tool-calling onboarding agent (ONBOARDING_TOOLS, buildOnboardingSystemPrompt, executeOnboardingTool, aiOnboardingAgent) not yet wired into the live Telegram webhook"
  - "GEMINI_MODEL exported from ai-owner-agent.ts for reuse by any future onboarding-style agent"
affects: [21-02-wire-ai-onboarding-into-telegram-webhook, 21-03-remove-old-step-machine]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "D-02 stateless resume: system prompt + finish_onboarding completeness check both re-derive hasName/hasAllHours/hasServices from live DB state every call via a shared computeOnboardingCompleteness() helper — no onboarding_sessions step tracking"
    - "return await withBusinessContext(...) inside a try/catch (not bare 'return withBusinessContext(...)') — required for the outer catch to actually see a later promise rejection; ai-owner-agent.ts's existing executeOwnerTool uses the bare form and was NOT touched (out of scope for this plan)"

key-files:
  created:
    - src/onboarding/ai-onboarding-agent.ts
    - tests/onboarding/ai-onboarding-agent.test.ts
  modified:
    - src/onboarding/ai-owner-agent.ts

key-decisions:
  - "GEMINI_MODEL constant changed from private const to export const in ai-owner-agent.ts (value unchanged) — the only line touched in that file, per the plan's success_criteria #5"
  - "set_cancellation_cutoff/set_last_session_threshold JSON schemas mark 'hours'/'count' as not-required (Gemini can omit them) while the underlying Zod schemas in billing/tools.ts still require them — a missing value surfaces as a Greek validation error string, not a schema-level block"

patterns-established:
  - "Pattern: D-02-style stateless completeness derivation — computeOnboardingCompleteness(business, svcList, hoursList) as the single source of truth consumed by both the system prompt (what to ask next) and finish_onboarding (whether it's safe to activate)"

requirements-completed:
  - "D-01: full Gemini tool-calling agent replaces the deterministic step-machine (name, hours, services, class setup, config toggles) in one freeform multi-turn conversation"
  - "D-02: stateless resume — agent re-derives what's configured from DB state every turn, no onboarding_sessions step tracking"
  - "D-03: Gemini generates its own Greek clarifying follow-up when it can't parse a field; MAX_TOOL_ROUNDS cap (mirrors ai-owner-agent.ts) returns a graceful Greek fallback"

coverage:
  - id: D1
    description: "buildOnboardingSystemPrompt derives missing-field state (name/hours/services) from live DB rows, never from a stored step index, and always includes the Greek-only rule line"
    requirement: "D-02"
    verification:
      - kind: unit
        ref: "tests/onboarding/ai-onboarding-agent.test.ts#buildOnboardingSystemPrompt"
        status: pass
    human_judgment: false
  - id: D2
    description: "ONBOARDING_TOOLS declares 10 Gemini function tools (name, hours w/ split-range support, services, booking mode, class schedule, cancellation cutoff, slotless requests, last-session threshold, finish_onboarding)"
    requirement: "D-01"
    verification:
      - kind: unit
        ref: "tests/onboarding/ai-onboarding-agent.test.ts#ONBOARDING_TOOLS"
        status: pass
    human_judgment: false
  - id: D3
    description: "executeOnboardingTool implements all 10 tool cases + default, every mutating case scoped via withBusinessContext/getConn() (RLS tenant isolation), wrapped in a top-level try/catch that returns a Greek error string on failure"
    requirement: "D-01"
    verification:
      - kind: unit
        ref: "tests/onboarding/ai-onboarding-agent.test.ts#executeOnboardingTool"
        status: pass
    human_judgment: false
  - id: D4
    description: "finish_onboarding refuses to activate (returns a Greek missing-fields message, zero webhook/DB mutation) until name+7-day-hours+>=1 service exist; once complete it rotates the webhook (unregister->register->activateBusiness->onboardingCompleted=true) in that exact order and returns '' after sending the confirmation, mirroring handleActivate"
    requirement: "D-01"
    verification:
      - kind: unit
        ref: "tests/onboarding/ai-onboarding-agent.test.ts#executeOnboardingTool > finish_onboarding"
        status: pass
    human_judgment: false
  - id: D5
    description: "aiOnboardingAgent runs a MAX_TOOL_ROUNDS=5 Gemini loop: no function calls -> output_text; a function_call round threads previous_interaction_id into the next call; an always-function_call mock is capped at 5 rounds and returns the graceful Greek fallback; a '' tool result short-circuits the loop"
    requirement: "D-03"
    verification:
      - kind: unit
        ref: "tests/onboarding/ai-onboarding-agent.test.ts#aiOnboardingAgent"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-07-25
status: complete
---

# Phase 21 Plan 01: AI Onboarding Agent (standalone module) Summary

**A standalone, fully unit-tested Gemini tool-calling onboarding agent (10 tools, stateless DB-derived system prompt, MAX_TOOL_ROUNDS=5 loop) that replaces the old regex-based hours parser — not yet wired into the live Telegram webhook.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-07-25T00:XX (Phase 21 execution start, see STATE.md)
- **Completed:** 2026-07-25T00:27:24Z
- **Tasks:** 2
- **Files modified:** 3 (1 new source, 1 new test, 1 one-line export edit)

## Accomplishments
- `src/onboarding/ai-onboarding-agent.ts` — new module exporting `ONBOARDING_TOOLS` (10 Gemini function-tool schemas), `buildOnboardingSystemPrompt`, `executeOnboardingTool`, and `aiOnboardingAgent`, following the exact `aiOwnerAgent` pattern already proven in `ai-owner-agent.ts`
- D-02 stateless resume: a shared `computeOnboardingCompleteness()` helper re-derives hasName/hasAllHours/hasServices from live `businesses`/`services`/`business_hours` rows on every call — no `onboarding_sessions.currentStep` involved anywhere in this module
- `finish_onboarding` mirrors `handleActivate`'s exact ordering (unregister webhook → register webhook → `activateBusiness` → `onboardingCompleted=true` → send confirmation → return `''`), refusing to run any of that until name + all 7 days of hours + ≥1 service exist
- `set_business_hours` accepts an optional second range (`open_time_2`/`close_time_2`) so a message like "9 το πρωι με 9 το βραδυ και ενα διαλυμα απο 1 μεχρι 5" can be captured via Gemini NLU + tool args instead of the old `HH:MM-HH:MM` regex gate
- 24 new unit tests: system-prompt completeness detection, every one of the 10 tool cases, `finish_onboarding`'s incomplete-vs-complete branches with call-order assertions (`invocationCallOrder`), and 4 Gemini-loop scenarios (no-calls passthrough, multi-round with `previous_interaction_id` threading, `MAX_TOOL_ROUNDS` cap, `''` short-circuit)

## Task Commits

Each task was committed atomically:

1. **Task 1: Tool schemas + DB-state-derived system prompt** - `b512483` (feat)
2. **Task 2: Tool executor + MAX_TOOL_ROUNDS Gemini loop + finish_onboarding activation** - `ba1c316` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/onboarding/ai-onboarding-agent.ts` - New: 10 tool schemas, system prompt builder, tool executor, Gemini loop
- `tests/onboarding/ai-onboarding-agent.test.ts` - New: 24 unit tests across all four exports
- `src/onboarding/ai-owner-agent.ts` - `GEMINI_MODEL` changed from private `const` to `export const` (value unchanged) — the only line touched

## Decisions Made
- Duplicated `GREEK_WEEKDAYS` locally rather than importing from `ai-owner-agent.ts` (that file doesn't export it) — matches the plan's explicit instruction
- `PLACEHOLDER_BUSINESS_NAME = 'New Business (onboarding)'` sourced verbatim from `scripts/create-business.ts`'s `createBusinessForOnboarding` call, with a comment citing that as the origin
- `set_cancellation_cutoff`/`set_last_session_threshold` JSON schemas mark their numeric fields (`hours`, `count`) as not `required` (letting Gemini omit them when `enabled=false`), while the underlying Zod schemas in `billing/tools.ts` still enforce them — a missing value surfaces as a Greek validation error string rather than blocking at the tool-schema level

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `return withBusinessContext(...)` inside try/catch didn't actually catch async rejections**
- **Found during:** Task 2, writing the `MAX_TOOL_ROUNDS` Gemini-loop test (a mocked `getConn()` missing `.update()` caused a `TypeError` inside `withBusinessContext`'s callback)
- **Issue:** `return withBusinessContext(business.id, async () => {...})` inside a `try { ... } catch (err) { ... }` block does NOT let the `catch` see a later rejection of the returned promise — a well-known JS async/await gotcha (you must `return await`, not bare `return`, for a `try/catch` to observe the rejection). The `executeOnboardingTool` doc comment (mirroring `ai-owner-agent.ts`'s WR-02) explicitly claims "any DB error ... returns a Greek error string to Gemini instead of propagating uncaught" — without the `await`, that claim was false for every `withBusinessContext`-wrapped case.
- **Fix:** Changed all 8 `return withBusinessContext(...)` call sites in `ai-onboarding-agent.ts` to `return await withBusinessContext(...)`, so the outer `try/catch` genuinely catches DB errors and returns the generic Greek fallback string as documented.
- **Files modified:** `src/onboarding/ai-onboarding-agent.ts`
- **Verification:** The `MAX_TOOL_ROUNDS` test (which deliberately omits `getConn().update` from its mock) now passes — 5 rounds each catch the `TypeError`, return the Greek error string, and the loop correctly terminates at the cap and returns the graceful fallback.
- **Committed in:** `ba1c316` (Task 2 commit)
- **Note:** `ai-owner-agent.ts`'s existing `executeOwnerTool` has the same bare-`return withBusinessContext(...)` pattern and is very likely affected by the same gotcha, but that file was intentionally left untouched — out of scope for this plan (only the `GEMINI_MODEL` export line was to change there, per the plan's success criteria). Flagging for a future phase/quick-task if worth a retroactive fix.

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for correctness — without it, `executeOnboardingTool`'s advertised error-catching behavior (and by extension the `finish_onboarding` safety guarantees under real DB failures) would silently not work. No scope creep — fix confined to the new file this plan owns.

## Issues Encountered
- Running the full test file inside the interactive shell without `run_in_background` hit the 120s tool timeout on the first attempt (before the `await` fix, an unhandled rejection appears to have left something pending); switching to `run_in_background` plus polling resolved it, and after the fix the targeted suite completes in ~5.5s.

## User Setup Required
None - no external service configuration required. This plan produces an isolated, unit-tested module; it is not yet reachable from any live code path (that's Plan 21-02's job).

## Next Phase Readiness
- `src/onboarding/ai-onboarding-agent.ts` is ready to be imported and wired into `src/webhooks/telegram.ts` by Plan 21-02, replacing calls into the old step-machine dispatcher for admin messages where `business.onboardingCompleted === false`
- Plan 21-03 can now safely remove the old `src/onboarding/steps.ts` step-machine handlers and the `onboarding_sessions.currentStep`/`collectedData` schema usage, since this plan's `aiOnboardingAgent` has no dependency on either
- No blockers. Full test suite run during this plan confirmed no new failures beyond the pre-existing, phase-unrelated baseline (83 failing / 350 total — up from 326 total only because this plan added 24 new passing tests; the 83 failing count is unchanged and documented in `tests/ai-agent.test.ts`-adjacent fixture drift, not caused by this plan)

---
*Phase: 21-ai-driven-owner-onboarding-replace-the-deterministic-step-ma*
*Completed: 2026-07-25*

## Self-Check: PASSED

- FOUND: src/onboarding/ai-onboarding-agent.ts
- FOUND: tests/onboarding/ai-onboarding-agent.test.ts
- FOUND: b512483 (Task 1 commit)
- FOUND: ba1c316 (Task 2 commit)
