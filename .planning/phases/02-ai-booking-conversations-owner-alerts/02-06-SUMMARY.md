---
phase: 02-ai-booking-conversations-owner-alerts
plan: 6
subsystem: api
tags: [gemini, function-calling, idempotency, telegram, error-handling]

# Dependency graph
requires:
  - phase: 02-ai-booking-conversations-owner-alerts
    provides: aiBookingAgent Gemini tool-call loop and function-executor.ts mutation layer (plans 02-01 through 02-05)
provides:
  - Bounded Gemini tool-call loop (MAX_TOOL_ROUNDS=6) that guarantees aiBookingAgent always returns
  - Non-empty-string interactionId contract (string | null) across the rate-limit fallback path
  - Per-call idempotency keys so two mutating tool calls in one turn never collide on the same DB idempotency key
  - Telegram notification failures isolated from cancel/reschedule DB-mutation success reporting
affects: [02-07, 02-08, 02-09, any future plan touching ai-agent.ts or function-executor.ts]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-call idempotency key derivation (`${requestId}:${call.id}`) at the tool-dispatch call site, distinct from the turn-constant requestId used for tracing"
    - "Notification-after-mutation isolation: wrap post-mutation side-effect calls (Telegram sends) in their own try/catch so a side-effect failure never overrides an already-committed DB state in the returned result"

key-files:
  created: []
  modified:
    - src/conversation/ai-agent.ts
    - src/conversation/function-executor.ts
    - tests/ai-agent.test.ts
    - tests/function-executor.test.ts

key-decisions:
  - "MAX_TOOL_ROUNDS set to 6 (generous upper bound for a single conversation turn) per 02-REVIEW.md CR-01 fix"
  - "idempotencyKey derived as `${requestId}:${call.id}` — requestId stays turn-constant for logging/tracing, idempotencyKey is unique per mutating call"
  - "cancelAppointmentTool wraps BOTH the owner-FYI and client-confirmation Telegram sends in a single shared try/catch (matches 02-REVIEW.md's CR-03a fix exactly); rescheduleAppointmentTool wraps only its single owner-alert send (CR-03b)"

patterns-established:
  - "Bounded external-API loop guard: any future Gemini/LLM tool-call loop should carry an explicit round cap with a graceful fallback response, not rely on the model always terminating"

requirements-completed: [BOOK-01, BOOK-02, BOOK-04, ASK-01, ASK-02]

coverage:
  - id: D1
    description: "aiBookingAgent bails out gracefully after MAX_TOOL_ROUNDS instead of hanging forever on a Gemini mock that never stops returning function_call steps (CR-01)"
    requirement: "BOOK-01"
    verification:
      - kind: unit
        ref: "tests/ai-agent.test.ts#Test 10 (CR-01): a Gemini mock that never stops returning function_call steps still returns within MAX_TOOL_ROUNDS calls, with the graceful bail-out text"
        status: pass
    human_judgment: false
  - id: D2
    description: "AiAgentResult.interactionId is typed string | null; the rate-limit fallback path returns null instead of the empty string, preventing a poisoned previous_interaction_id on the next turn (CR-06)"
    requirement: "ASK-01"
    verification:
      - kind: unit
        ref: "tests/ai-agent.test.ts#Test 7: 429 on every attempt (4 total) -> resolves with RATE_LIMIT_REPLY_GREEK, never throws"
        status: pass
    human_judgment: false
  - id: D3
    description: "Two mutating tool calls (book_appointment/reschedule_appointment) in the same conversation turn each get their own per-call idempotency key derived from Gemini's own call.id, so the second call is never silently merged into the first booking (CR-02)"
    requirement: "BOOK-02"
    verification:
      - kind: unit
        ref: "tests/ai-agent.test.ts#Test 11 (CR-02): two function_call steps in the same round get distinct idempotencyKey values derived from their own call.id, while requestId stays constant"
        status: pass
      - kind: unit
        ref: "tests/function-executor.test.ts#Test 3: book_appointment success -> owner alert with keyboard, ownerMessageId stored, structured success (idempotencyKey assertion)"
        status: pass
      - kind: unit
        ref: "tests/function-executor.test.ts#Test 10: reschedule_appointment success -> new booking references original, keyboard encodes NEW id, original untouched (idempotencyKey assertion)"
        status: pass
    human_judgment: false
  - id: D4
    description: "cancelAppointmentTool still reports { success: true, booking_id } when a Telegram notification fails after updateBookingStatus already committed (CR-03a)"
    requirement: "BOOK-04"
    verification:
      - kind: unit
        ref: "tests/function-executor.test.ts#Test 13 (CR-03a): cancel_appointment still reports success when the Telegram notification fails after the DB mutation lands"
        status: pass
    human_judgment: false
  - id: D5
    description: "rescheduleAppointmentTool still reports { success: true, booking_id, status } when the owner-alert Telegram send fails after the new booking row already committed (CR-03b)"
    requirement: "ASK-02"
    verification:
      - kind: unit
        ref: "tests/function-executor.test.ts#Test 14 (CR-03b): reschedule_appointment still reports success when the owner-alert Telegram send fails after the new booking already landed"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-08
status: complete
---

# Phase 02 Plan 6: Gap Closure — Bounded Tool Loop, Per-Call Idempotency, Notification Isolation Summary

**Closed 4 CRITICAL gaps in the Gemini booking agent loop and tool executor: bounded MAX_TOOL_ROUNDS loop (CR-01), null-not-empty-string interactionId on rate-limit fallback (CR-06), per-call idempotency keys preventing double-booking merges (CR-02), and notification-failure isolation so cancel/reschedule never falsely report an error after the DB mutation already succeeded (CR-03a/CR-03b).**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-08T19:17:00Z
- **Completed:** 2026-07-08T19:42:10Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `aiBookingAgent`'s `while (true)` tool-call loop is now bounded by `MAX_TOOL_ROUNDS = 6`; a Gemini response that keeps returning `function_call` steps forever no longer hangs the webhook request — it returns a graceful Greek bail-out message after exactly 6 rounds.
- `AiAgentResult.interactionId` is typed `string | null`; the rate-limit fallback path (`GeminiRateLimitError` after 4 exhausted retries) now returns `previousInteractionId ?? null` instead of `previousInteractionId ?? ''`, closing the empty-string-poisons-next-turn bug.
- Each mutating tool call (`book_appointment`/`reschedule_appointment`) within a single conversation turn now gets its own idempotency key (`${requestId}:${call.id}`), derived at the `executeTool` call site in `ai-agent.ts` and consumed by `ToolContext.idempotencyKey` in `function-executor.ts`'s `insertBooking`/`resolveConflictOrTaken` calls — the turn-level `requestId` remains constant for logging/tracing but no longer risks merging two distinct bookings into one.
- `cancelAppointmentTool` wraps its owner-FYI and client-confirmation Telegram sends in a shared try/catch placed after `updateBookingStatus` resolves — a notification failure is now logged but never overrides the `{ success: true, booking_id }` result.
- `rescheduleAppointmentTool` wraps its owner-alert Telegram send (via `alertOwnerNewBooking`) in its own try/catch — a notification failure is logged but never masks the already-committed new booking row.

## Task Commits

Each task was committed atomically:

1. **Task 1: Bound the Gemini tool-call loop, fix the rate-limit interactionId bug, and derive per-call idempotency keys (CR-01, CR-06, CR-02 call site)** - `9d6050e` (fix)
2. **Task 2: Consume the per-call idempotency key and isolate notification failures from DB-mutation success (CR-02 function-executor half, CR-03a, CR-03b)** - `a6dbedd` (fix)

_Note: both tasks are tightly type-coupled (ai-agent.ts's Task 1 code calls `executeTool` with a third-argument shape that only compiles once `ToolContext.idempotencyKey` exists from Task 2). Both files were implemented together in the working tree before either commit was created, then staged and committed separately per the plan's file boundaries — each task's designated test file passes cleanly against the resulting working tree state._

## Files Created/Modified
- `src/conversation/ai-agent.ts` - Added `MAX_TOOL_ROUNDS` constant + round-bound check at the top of the tool-call loop; typed `AiAgentResult.interactionId` as `string | null`; rate-limit fallback returns `null` instead of `''`; derives per-call `idempotencyKey` and passes it in `executeTool`'s context argument
- `src/conversation/function-executor.ts` - Added `ToolContext.idempotencyKey`; `bookAppointmentTool`/`rescheduleAppointmentTool` now key `insertBooking`/`resolveConflictOrTaken` off `context.idempotencyKey` instead of `context.requestId`; `cancelAppointmentTool` and `rescheduleAppointmentTool` isolate their post-mutation Telegram notification sends in try/catch blocks
- `tests/ai-agent.test.ts` - Updated Test 7's assertion from `toBe('')` to `toBeNull()`; added Test 10 (MAX_TOOL_ROUNDS bail-out) and Test 11 (per-call idempotencyKey uniqueness, requestId constancy)
- `tests/function-executor.test.ts` - Updated shared `CONTEXT` constant to give `requestId`/`idempotencyKey` distinct values; added idempotencyKey assertions to Test 3 (book_appointment) and Test 10 (reschedule_appointment); added Test 13 (CR-03a cancel notification-failure isolation) and Test 14 (CR-03b reschedule notification-failure isolation)

## Decisions Made
- Followed 02-REVIEW.md's exact fix code for CR-01, CR-02, and CR-06 (MAX_TOOL_ROUNDS=6, `${requestId}:${call.id}` idempotency key derivation, `?? null` fallback).
- For CR-03a, wrapped both Telegram sends in `cancelAppointmentTool` in a single shared try/catch exactly as specified in the plan's action text (matches 02-REVIEW.md's fix snippet), rather than isolating them individually — this matches the plan's acceptance criteria ("regardless of which notification (or both) threw").
- Implemented both tasks' code changes together in the working tree before committing, since Task 1's `ai-agent.ts` change and Task 2's `ToolContext` interface change are compile-time coupled (an object literal with an excess `idempotencyKey` property fails `tsc`/`ts-jest` type-checking until the interface field exists). Commits still respect the plan's per-task file boundaries.

## Deviations from Plan

None - plan executed exactly as written (see the Decisions Made section for one execution-order clarification: both tasks' code was necessarily written together due to a compile-time type dependency, but committed as two separate, correctly-scoped commits per the plan's file boundaries).

## Issues Encountered

None - all target behaviors were achieved on the first implementation pass; no debugging cycles were required.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CR-01, CR-02, CR-03a, CR-03b, and CR-06 from 02-VERIFICATION.md/02-REVIEW.md are now closed and test-covered.
- Full regression suite (140 tests across 18 suites) and `npx tsc --noEmit` both pass with zero failures/errors.
- Remaining 02-REVIEW.md findings not in this plan's scope (CR-04, CR-05, and the Warnings/Info items) are addressed by sibling gap-closure plans 02-07, 02-08, 02-09 per the phase's gap-closure plan set.

---
*Phase: 02-ai-booking-conversations-owner-alerts*
*Completed: 2026-07-08*

## Self-Check: PASSED

- FOUND: .planning/phases/02-ai-booking-conversations-owner-alerts/02-06-SUMMARY.md
- FOUND: 9d6050e (Task 1 commit)
- FOUND: a6dbedd (Task 2 commit)
