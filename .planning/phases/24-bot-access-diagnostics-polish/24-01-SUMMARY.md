---
phase: 24-bot-access-diagnostics-polish
plan: 01
subsystem: bot-ops
tags: [telegram-bot-api, gemini, error-handling, ux-polish]

# Dependency graph
requires:
  - phase: 05-onboarding
    provides: registerBotWebhook/unregisterBotWebhook pattern in src/telegram/client.ts (callTelegramApiDirect)
  - phase: 16-arch-owner-agent-split
    provides: aiOnboardingAgent finish_onboarding flow and handleFoundBusiness owner/client branching
provides:
  - "setChatMenuButton/setMyCommands Telegram Bot API wrapper functions"
  - "Owner + client persistent Telegram menu button/command registration wired into finish_onboarding (BOT-06)"
  - "Best-effort owner diagnostic notifications on both confirmed client-facing Gemini/routing fallback catch sites (DIAG-01)"
affects: [bot-ops, telegram-client, onboarding, conversation-error-handling]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "New Telegram Bot API calls delegate to the existing private callTelegramApiDirect helper — never a new fetch call site"
    - "Best-effort side-effect notifications wrapped in their own try/catch, placed after the client-facing return value is already finalized, so a notification failure can never alter what the client receives"

key-files:
  created: []
  modified:
    - src/telegram/client.ts
    - src/onboarding/ai-onboarding-agent.ts
    - src/conversation/ai-agent.ts
    - src/webhooks/telegram.ts
    - tests/telegram-client.test.ts
    - tests/onboarding/ai-onboarding-agent.test.ts
    - tests/ai-agent.test.ts
    - tests/telegram-webhook.test.ts

key-decisions:
  - "Telegram's BotCommandScope wire format uses lowercase string type values ('chat' | 'all_private_chats'), not class names — corrected from 24-RESEARCH.md's illustrative pseudocode"
  - "Only /menu (owner) and /start (client) are registered as commands — no /today or /help, since no handler exists for either anywhere in the codebase"
  - "DIAG-01 diagnostic text carries only requestId/updateId, err.name, err.message (and round number at Site 1) — never clientPhone or other business data"
  - "isClientSender guard (business.ownerTelegramId !== senderTelegramId) in handleFoundBusiness's shared catch prevents a duplicate diagnostic when the owner was the sender who hit the failing branch themselves"
  - "Rule 3 fix: tests/telegram-webhook.test.ts's KNOWN_BUSINESS/KNOWN_BUSINESS_2/OWNER_BUSINESS/PENDING_BOOKING fixtures were missing Business/Booking interface fields added by later phases (bookingMode, allowMultiBooking, cancellationCutoffEnabled/Hours, slotlessRequestsEnabled, lastSessionThresholdEnabled/Count, onboardingCompleted, sessionInstanceId) — the whole file failed to compile before this plan touched it; backfilled at the fixture definitions to unblock verification"

patterns-established:
  - "Owner-diagnostic notification pattern: guard on ownerTelegramId+botToken present, derive errorType/errorMessage via `err instanceof Error` check, send via botTokenStore.run(botToken, () => sendTelegramMessage(...)), wrapped in its own try/catch that only logs — reusable for any future client-facing fallback catch site"

requirements-completed: [BOT-06, DIAG-01]

coverage:
  - id: D1
    description: "setChatMenuButton/setMyCommands exported from telegram/client.ts, delegating to callTelegramApiDirect with correct lowercase BotCommandScope wire format and no bot-token leakage into logger calls"
    requirement: "BOT-06"
    verification:
      - kind: unit
        ref: "tests/telegram-client.test.ts#Test 6-10 (setChatMenuButton/setMyCommands body shapes + no-token-in-logs)"
        status: pass
    human_judgment: false
  - id: D2
    description: "finish_onboarding registers owner /menu (chat-scoped) + client /start (all_private_chats) commands and both menu buttons after registerBotWebhook and before activateBusiness, non-blocking on failure"
    requirement: "BOT-06"
    verification:
      - kind: unit
        ref: "tests/onboarding/ai-onboarding-agent.test.ts#BOT-06 registers owner + client commands and menu buttons... / BOT-06 a rejecting setMyCommands still lets activateBusiness run..."
        status: pass
    human_judgment: false
  - id: D3
    description: "aiBookingAgent's generic/unrecoverable Gemini failure sends exactly one owner diagnostic (requestId + error type), client text unchanged; rate-limit branch never notifies; notification failure never changes the resolved result"
    requirement: "DIAG-01"
    verification:
      - kind: unit
        ref: "tests/ai-agent.test.ts#DIAG-01: generic/unrecoverable failure sends exactly one owner diagnostic... / a rejecting owner-notification... / the rate-limit branch never calls sendTelegramMessage..."
        status: pass
    human_judgment: false
  - id: D4
    description: "handleFoundBusiness's shared catch sends exactly one additional owner diagnostic (containing updateId) when the client-conversation branch fails, and zero additional diagnostics when the owner branch fails (isClientSender guard)"
    requirement: "DIAG-01"
    verification:
      - kind: unit
        ref: "tests/telegram-webhook.test.ts#DIAG-01: client-conversation branch failure sends the unchanged client fallback AND one owner diagnostic... / DIAG-01: owner-branch failure sends exactly one message total..."
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-07-27
status: complete
---

# Phase 24 Plan 01: Bot Access + Diagnostics Polish Summary

**Persistent Telegram menu button/commands for owner+client (BOT-06) plus best-effort owner diagnostics on both confirmed client-facing Gemini/routing fallback catch sites (DIAG-01)**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-27T18:05:00+03:00 (approx)
- **Completed:** 2026-07-27T18:20:51+03:00
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- `setChatMenuButton`/`setMyCommands` added to `src/telegram/client.ts`, delegating to the existing private `callTelegramApiDirect` helper (no new fetch call site), using Telegram's actual lowercase `BotCommandScope` wire format
- `finish_onboarding` now registers the owner's chat-scoped `/menu` command + menu button and the bot-wide `/start` command + default menu button for clients, in a best-effort block that never blocks `activateBusiness` or the `onboardingCompleted` DB write on failure
- `aiBookingAgent`'s generic/unrecoverable-error catch branch sends a best-effort owner diagnostic (requestId + error type), explicitly excluding the `GeminiRateLimitError` branch
- `handleFoundBusiness`'s shared catch block sends a second, `isClientSender`-guarded owner diagnostic (updateId + error type) only when the failing branch was client-facing, preventing a confusing duplicate when the owner was the sender
- Both client-facing fallback texts (`Το σύστημα δεν απόκρινε...` and `Παρουσιάστηκε πρόβλημα...`) remain byte-for-byte unchanged in every test

## Task Commits

Each task was committed atomically:

1. **Task 1: BOT-06 — persistent menu button + scoped commands** - `96c87d1` (feat)
2. **Task 2: DIAG-01 — owner diagnostic on client-facing fallback** - `447b977` (feat)

_Note: docs/state metadata commit is made separately by the orchestrator._

## Files Created/Modified
- `src/telegram/client.ts` - Added `setChatMenuButton`/`setMyCommands` exported functions
- `src/onboarding/ai-onboarding-agent.ts` - Wired both functions into `finish_onboarding`'s best-effort block
- `src/conversation/ai-agent.ts` - Added owner-diagnostic notification to the generic/unrecoverable catch branch
- `src/webhooks/telegram.ts` - Added `isClientSender`-guarded owner-diagnostic notification to `handleFoundBusiness`'s shared catch
- `tests/telegram-client.test.ts` - 5 new tests covering body shapes + no-token-in-logs
- `tests/onboarding/ai-onboarding-agent.test.ts` - 2 new tests covering call shapes/ordering + non-blocking rejection
- `tests/ai-agent.test.ts` - 3 new tests covering the owner-diagnostic Gemini-catch behavior
- `tests/telegram-webhook.test.ts` - 2 new tests covering the shared-catch owner-diagnostic behavior; fixture backfill (see Deviations)

## Decisions Made
- Telegram's `BotCommandScope.type` wire value is the lowercase string (`"chat"` / `"all_private_chats"`), not a class name — corrected from 24-RESEARCH.md's illustrative pseudocode, per the plan's explicit correction note
- Only `/menu` and `/start` are registered — no speculative `/today`/`/help` commands, since no handler exists for either
- Diagnostic text carries only requestId/updateId, err.name, err.message (and round number at Site 1) — never clientPhone or other business data (T-24-02 mitigation)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] tests/telegram-webhook.test.ts failed to compile before this plan touched it**
- **Found during:** Task 2 (running the plan's verification command against `tests/telegram-webhook.test.ts`)
- **Issue:** `KNOWN_BUSINESS`, `KNOWN_BUSINESS_2`, and `OWNER_BUSINESS` fixtures were missing 8 fields (`bookingMode`, `allowMultiBooking`, `cancellationCutoffEnabled`, `cancellationCutoffHours`, `slotlessRequestsEnabled`, `lastSessionThresholdEnabled`, `lastSessionThresholdCount`, `onboardingCompleted`) added to the `Business` interface by Phases 10-16; `PENDING_BOOKING` was missing `sessionInstanceId` added to the `Booking` interface by Phase 10. This broke TypeScript compilation for the entire file, meaning 0 of its ~20 pre-existing tests could run — pre-dating this plan's changes.
- **Fix:** Backfilled the missing fields at each fixture's single point of definition (all downstream spreads/usages inherit the fix).
- **Files modified:** `tests/telegram-webhook.test.ts`
- **Verification:** `npx tsc --noEmit` passes project-wide; all 20 pre-existing tests in the file now pass alongside the 2 new DIAG-01 tests.
- **Committed in:** `447b977` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to unblock Task 2's verification command; a mechanical fixture backfill with no behavioral changes. No scope creep beyond what was required to make the target test file compile.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- BOT-06 and DIAG-01 are the last two open requirements of the v1.6 milestone (per STATE.md's Roadmap v1.6 decision) — this plan closes both.
- No blockers identified for milestone close.

---
*Phase: 24-bot-access-diagnostics-polish*
*Completed: 2026-07-27*

## Self-Check: PASSED

All 8 modified files confirmed present on disk; both task commits (`96c87d1`, `447b977`) confirmed present in git log.
