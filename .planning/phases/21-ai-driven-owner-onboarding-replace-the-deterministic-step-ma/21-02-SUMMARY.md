---
phase: 21-ai-driven-owner-onboarding-replace-the-deterministic-step-ma
plan: 02
subsystem: telegram
tags: [telegram, webhook, onboarding, gemini, routing]

# Dependency graph
requires:
  - phase: 21 (same phase, prior wave)
    provides: "src/onboarding/ai-onboarding-agent.ts — aiOnboardingAgent(business, senderTelegramId, messageText, today) (21-01)"
provides:
  - "src/webhooks/telegram.ts — both onboarding-incomplete entry points (typed message + callback_query tap) now call aiOnboardingAgent instead of the deterministic step machine"
affects: [21-03-remove-old-step-machine]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "'' reply convention: aiOnboardingAgent returning '' means a tool already sent its own Telegram message — both call sites skip sendTelegramMessage on empty reply, matching the existing aiOwnerAgent convention"

key-files:
  created:
    - none (test file was already tracked; rewritten in place)
  modified:
    - src/webhooks/telegram.ts
    - tests/webhooks/telegram-webhook.onboarding.test.ts

key-decisions:
  - "Task 2's test description originally contained the literal string 'dispatchOnboardingStep' in prose (to explain what it replaces) — renamed to keep the acceptance-criteria grep for that string at zero matches, since a description string is still a textual match even though it isn't a code reference"
  - "Task 1 (telegram.ts rewiring) was executed and committed by an earlier subagent run of this plan (aa02b79) before that run was killed by a transient API connection error just as it started Task 2. Verified aa02b79's diff against the plan's Task 1 <done> criteria — correct, not redone. Task 2 was completed inline (not via a fresh subagent) after two more subagent attempts died at the exact same point (writing the large rewritten test file) — see Issues Encountered."

requirements-completed:
  - "D-01/D-02: wire the new stateless Gemini onboarding agent into both Telegram entry points (typed message + inline-keyboard tap) that currently reach an onboarding owner"
  - "Preserve the ARCH-03 routing guard (owner + !onboardingCompleted -> onboarding agent) at both entry points"

coverage:
  - id: D1
    description: "A message from the business owner while onboardingCompleted=false is routed to aiOnboardingAgent (not dispatchOnboardingStep, which no longer exists after this plan removes the import)"
    requirement: "D-01/D-02"
    verification:
      - kind: unit
        ref: "tests/webhooks/telegram-webhook.onboarding.test.ts#Scenario A"
        status: pass
    human_judgment: false
  - id: D2
    description: "An inline-keyboard tap (callback_query) from the business owner while onboardingCompleted=false is routed to aiOnboardingAgent with the tap's callback_data as messageText, after answerCallbackQuery + keyboard-clear"
    requirement: "D-01/D-02"
    verification:
      - kind: unit
        ref: "tests/webhooks/telegram-webhook.onboarding.test.ts#Scenario B2"
        status: pass
    human_judgment: false
  - id: D3
    description: "When aiOnboardingAgent returns '', neither entry point sends an additional Telegram reply"
    requirement: "D-01/D-02"
    verification:
      - kind: unit
        ref: "tests/webhooks/telegram-webhook.onboarding.test.ts#Scenario B3"
        status: pass
    human_judgment: false
  - id: D4
    description: "A message from the business owner while onboardingCompleted=true is still routed to aiOwnerAgent, and non-owner clients still route to routeConversationMessage — both unaffected by this plan"
    requirement: "Preserve ARCH-03 guard"
    verification:
      - kind: unit
        ref: "tests/webhooks/telegram-webhook.onboarding.test.ts#Scenario C, Scenario D"
        status: pass
    human_judgment: false

duration: ~70min (across three subagent attempts + inline completion)
completed: 2026-07-25
status: complete
---

# Phase 21 Plan 02: Wire aiOnboardingAgent into Telegram Webhook Summary

**Both Telegram entry points that reach an onboarding-incomplete owner (typed message and inline-keyboard tap) now call the new stateless `aiOnboardingAgent` instead of the deleted deterministic step machine, with zero remaining references to `dispatchOnboardingStep`/`onboarding/router`.**

## Performance

- **Tasks:** 2
- **Files modified:** 2 (`src/webhooks/telegram.ts`, `tests/webhooks/telegram-webhook.onboarding.test.ts`)

## Accomplishments
- `handleFoundBusiness`'s `!business.onboardingCompleted` branch calls `aiOnboardingAgent(business, senderTelegramId, messageText, today)`, skipping `sendTelegramMessage` when the reply is `''`
- The owner callback_query branch (added same-day, pre-phase-21, to fix a silently-dropped inline-keyboard-tap bug) now calls `aiOnboardingAgent` with the tap's `data` as `messageText`, after `answerCallbackQuery` + `editTelegramMessageReplyMarkup([])`, mirroring the message-path structure
- `dispatchOnboardingStep`, `findActiveSessionByOwnerTelegramId`, `createOrResetOnboardingSession` imports removed from `telegram.ts`
- `tests/webhooks/telegram-webhook.onboarding.test.ts` rewritten: Scenario A (message path, collapsed from old A+B), Scenario B2 (new — callback_query path), Scenario B3 (new — `''` no-reply case, both paths), Scenarios C/D/E unchanged in behavior with `dispatchOnboardingStep` mock references removed/replaced by `aiOnboardingAgent` assertions

## Task Commits

1. **Task 1: Rewire telegram.ts onboarding entry points** - `aa02b79` (feat) — committed by an earlier subagent run of this plan before it was killed by a transient API error at the start of Task 2
2. **Task 2: Rewrite telegram-webhook.onboarding.test.ts** - `66a0ac6` (test) — completed inline in the orchestrator after two further subagent attempts died at the identical point (about to write the large test file)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/webhooks/telegram.ts` - Both onboarding entry points call `aiOnboardingAgent`; dead imports removed
- `tests/webhooks/telegram-webhook.onboarding.test.ts` - Rewritten: 8 tests across 6 describe blocks (A, B2, B3×2, C, D×2, E)

## Decisions Made
- Kept `jest.mock('../../src/onboarding/queries')` (still needed for `findBusinessByOwnerTelegramId` elsewhere in `telegram.ts`) but dropped the two now-deleted function mocks from `setupCommonMocks`
- `makeCallbackQueryUpdate(updateId, fromId, data)` helper added, modeled on `tests/telegram-webhook.test.ts`'s existing helper shape (no default args, since every call site here passes all three explicitly)

## Deviations from Plan

### Process deviation (not a plan-content change)

**Task 2 was completed inline by the orchestrator instead of via a subagent, after repeated subagent failures at the same execution point.**
- **What happened:** Four consecutive `gsd-executor` dispatches for this plan failed: attempt 1 stalled for 600s with zero progress (killed, no trace left); attempts 2–3 both died with "API Error: Connection closed mid-response" at the exact same moment — immediately after finishing analysis and announcing intent to write the large rewritten test file (`tests/webhooks/telegram-webhook.onboarding.test.ts`, ~300 lines). Task 1 (attempt 1's partial work, re-verified and confirmed correct) survived across these retries since it was already committed.
- **Why inline:** Since the failure was 100% reproducible at the identical juncture across independent attempts (not flaky/random), a fifth blind retry was judged unlikely to succeed. The orchestrator had already gathered full context (plan spec, current test file, `telegram.ts` post-Task-1, the `makeCallbackQueryUpdate` reference helper) while investigating attempt 3's failure, so it wrote the file directly instead of re-paying that context cost in a fifth subagent.
- **No plan-content deviation:** Task 2 was implemented exactly per the plan's `<action>` spec (mock module list, Scenario A/B2/B3/C/D/E structure, specific assertions) — the only difference from a normal run is who wrote the file.

### Acceptance-criteria fix

**Test description string accidentally contained a literal grep-blocked substring.** Scenario A's `it()` description originally read "...dispatchOnboardingStep is never referenced" — technically satisfying the *intent* of the acceptance criterion (no code reference to the deleted function) but not its literal form (`grep -c "dispatchOnboardingStep"` returned 1, from the description text itself, not zero). Renamed to "...no legacy step-machine call" to make the grep return exactly zero as specified.

---

**Total deviations:** 1 process deviation (subagent→inline handoff, no content impact), 1 self-caught acceptance-criteria wording fix.
**Impact on plan:** None on scope or correctness — Task 2's implementation matches the plan spec exactly; only the execution path (subagent vs. inline) and one test description string changed.

## Issues Encountered
- Full-suite (`npm test`) run counts fluctuate between runs (e.g. 83/350 immediately after Wave 1 vs. 97/367 seen during this plan's verification) due to real-DB-backed integration test suites (`booking-queries`, `session-*`, `cancellation-cutoff`, `enforcement-*`, `renewal-nudge`, `slotless-requests`, etc.) whose pass/fail outcome depends on live Neon connectivity/timing in this sandbox, not on any change in this plan. `tests/telegram-webhook.test.ts` also fails, but on a pre-existing TS2345 fixture-drift compile error (`Booking`/`Business` interface fields missing from old test fixtures) identical in class to the already-documented `tests/ai-agent.test.ts` baseline issue — confirmed unrelated to this plan's `dispatchOnboardingStep`→`aiOnboardingAgent` rewiring (no reference to either symbol in that file). This plan's own test file (`telegram-webhook.onboarding.test.ts`) passes 8/8 deterministically across repeated runs, and `npx tsc --noEmit` is clean project-wide.

## User Setup Required
None.

## Next Phase Readiness
- Both live Telegram entry points now depend on `src/onboarding/ai-onboarding-agent.ts` (21-01) and no longer reference `src/onboarding/steps.ts`/`src/onboarding/router.ts`/the onboarding-session queries at all from `telegram.ts`
- Plan 21-03 can now safely delete `steps.ts`, `router.ts`, and the dead session-lifecycle exports from `queries.ts` — nothing in `telegram.ts` imports them anymore
- No blockers.

---
*Phase: 21-ai-driven-owner-onboarding-replace-the-deterministic-step-ma*
*Completed: 2026-07-25*
