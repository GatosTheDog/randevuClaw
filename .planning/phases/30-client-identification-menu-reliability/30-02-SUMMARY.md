---
phase: 30-client-identification-menu-reliability
plan: 02
subsystem: telegram-bot-reliability
tags: [telegram-bot-api, retry-backoff, idempotent-hedge, onboarding]

# Dependency graph
requires:
  - phase: 24-bot-access-diagnostics-polish
    provides: original one-shot setMyCommands/setChatMenuButton call in finish_onboarding (BOT-06)
provides:
  - Bounded retry-with-backoff around finish_onboarding's one-shot menu/command setup
  - reassertMenuButtonAndCommands() fire-and-forget hedge wired into showAdminRootMenu
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bounded for-loop retry with exponential backoff (setTimeout, no external lib) for a one-shot lifecycle call"
    - "Fire-and-forget .catch()-guarded background re-assertion of idempotent API calls, never awaited by the caller"

key-files:
  created: []
  modified:
    - src/onboarding/ai-onboarding-agent.ts
    - src/telegram/handlers/admin-menu.ts
    - tests/onboarding/ai-onboarding-agent.test.ts
    - tests/admin-menu.test.ts

key-decisions:
  - "MENU_SETUP_MAX_ATTEMPTS = 3 and MENU_SETUP_BASE_BACKOFF_MS = 300 as local constants near the retry loop, per plan's Claude's-discretion allowance"
  - "reassertMenuButtonAndCommands() wired inside showAdminRootMenu (not the individual /menu text-command or menu:root callback branches) so one change covers both /menu entry points"
  - "No retry loop inside reassertMenuButtonAndCommands — a failed re-assertion is cheap to retry naturally on the owner's next /menu tap, so retry logic is reserved for the one-shot onboarding call only"

patterns-established:
  - "Fire-and-forget idempotent Bot-API hedge: invoke without await, .catch()-swallow with logger.warn, guard on presence of the required token/id"

requirements-completed: [ADMIN-05]

coverage:
  - id: D1
    description: "finish_onboarding's one-shot setMyCommands/setChatMenuButton calls retry up to 3 times with exponential backoff before falling back to the original best-effort swallow (D-06.1)"
    requirement: "ADMIN-05"
    verification:
      - kind: unit
        ref: "tests/onboarding/ai-onboarding-agent.test.ts#D-06.1: retries the full 4-call sequence after one transient setMyCommands rejection and succeeds"
        status: pass
      - kind: unit
        ref: "tests/onboarding/ai-onboarding-agent.test.ts#D-06.1: exhausts all retry attempts, never reaches setChatMenuButton, and still lets activateBusiness run"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every /menu tap (text command or menu:root button) re-asserts the same idempotent setMyCommands/setChatMenuButton calls via a new reassertMenuButtonAndCommands() helper, non-blocking (D-06.2)"
    requirement: "ADMIN-05"
    verification:
      - kind: unit
        ref: "tests/admin-menu.test.ts#resolves even when setChatMenuButton never settles (non-blocking)"
        status: pass
      - kind: unit
        ref: "tests/admin-menu.test.ts#resolves without throwing even when setMyCommands/setChatMenuButton reject (swallow-on-failure)"
        status: pass
      - kind: unit
        ref: "tests/admin-menu.test.ts#re-asserts using the caller's own business botToken and chatId"
        status: pass
      - kind: unit
        ref: "tests/admin-menu.test.ts#skips re-assertion cleanly when business.botToken is null"
        status: pass
    human_judgment: false
  - id: D3
    description: "Real-world Telegram client-side menu-button caching behavior after deploy (spot-check only, not a blocking gate per VALIDATION.md)"
    human_judgment: true
    rationale: "Client-side app cache refresh timing is not observable from server-side automated tests — RESEARCH.md confirms this is a documented platform limitation, not something D-06's code hedges can or should fix. Requires a human sending /start/menu from a real Telegram client after deploy."

# Metrics
duration: 25min
completed: 2026-07-29
status: complete
---

# Phase 30 Plan 02: Menu Button Reliability Hedges Summary

**Bounded retry-with-backoff for `finish_onboarding`'s one-shot Telegram menu/command setup, plus a fire-and-forget `reassertMenuButtonAndCommands()` re-assertion on every `/menu` tap via `showAdminRootMenu`.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-29T00:16:00Z
- **Completed:** 2026-07-29T00:41:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `finish_onboarding`'s `setMyCommands`/`setChatMenuButton` calls (which fire exactly once in a business's entire lifetime) now retry up to 3 times with exponential backoff (300ms base) before falling back to the original best-effort swallow — closing the "no second chance" gap D-06.1 targeted.
- Every `/menu` tap — both the `/menu`/`/start` text-command branch (`webhooks/telegram.ts`) and the `menu:root` callback branch (`admin-menu.ts`) — now re-asserts the same idempotent Bot-API calls via a single new `reassertMenuButtonAndCommands()` helper wired into `showAdminRootMenu`, since both entry points call that one function.
- The re-assertion is deliberately fire-and-forget: never awaited, `.catch()`-guarded, and skipped cleanly when `business.botToken` is falsy — proven by a never-resolving-promise test and a rejection test.
- ADMIN-05's code-addressable gap is now fully closed; the remaining client-side Telegram app-cache limitation is documented in RESEARCH.md and tracked as a manual spot-check in VALIDATION.md, not a blocking gate.

## Task Commits

Each task was committed atomically:

1. **Task 1: Retry + backoff for finish_onboarding's one-shot menu/command setup (D-06.1)** - `dceda4c` (feat)
2. **Task 2: Re-assert menu button + commands on every /menu tap (D-06.2)** - `8adb084` (feat)

**Plan metadata:** committed alongside this SUMMARY.

## Files Created/Modified
- `src/onboarding/ai-onboarding-agent.ts` - `finish_onboarding`'s prior single try/catch replaced with a bounded `for` loop (`MENU_SETUP_MAX_ATTEMPTS = 3`, `MENU_SETUP_BASE_BACKOFF_MS = 300`, exponential backoff via `setTimeout`), wrapping the exact same 4 Bot-API calls in the exact same order; `break` on success, log-and-fall-through on exhaustion.
- `src/telegram/handlers/admin-menu.ts` - Added `setMyCommands`/`setChatMenuButton` to the existing `../client` import; added new private `reassertMenuButtonAndCommands(botToken, chatId)` helper (no retry loop, re-runs the same 4 calls); wired a fire-and-forget, `.catch()`-guarded call into `showAdminRootMenu` after its existing `sendTelegramMessageWithKeyboard` call, guarded by `if (business.botToken)`.
- `tests/onboarding/ai-onboarding-agent.test.ts` - Added 2 tests: retry-then-succeed (1 rejection + 2 succeeding calls in the retry attempt, `setChatMenuButton` only reached in the successful attempt) and exhausted-retry-then-swallow (exactly `MENU_SETUP_MAX_ATTEMPTS` (3) `setMyCommands` calls, `setChatMenuButton` never reached, `activateBusiness` still runs).
- `tests/admin-menu.test.ts` - Added a new `showAdminRootMenu — menu button re-assertion (D-06.2)` describe block with 4 tests: non-blocking on a never-resolving `setChatMenuButton` promise, swallow-on-reject for both API calls, correct `botToken`/`chatId` args passed through, and a clean skip when `business.botToken` is null.

## Decisions Made
- Retry shape (3 attempts, 300ms base exponential backoff) matches the plan's exact prescription — no deviation from the plan's discretion-filled defaults.
- Re-assertion wiring point: inside `showAdminRootMenu` itself (not duplicated in the text-command and callback branches separately) — confirmed via reading `webhooks/telegram.ts:104-132` that both `/menu` entry points funnel through this one function, so one change covers both per the plan's stated rationale.
- No retry loop added to `reassertMenuButtonAndCommands` — matches the plan's explicit design ("a failed re-assertion is cheap to retry naturally on the owner's next `/menu` tap").

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ADMIN-05 is now fully closed at the code level; requirement marked complete in REQUIREMENTS.md.
- Remaining real-world verification (Telegram client-side menu-button caching) is a documented, accepted platform limitation per RESEARCH.md's T-30-06 disposition — a post-deploy manual spot-check per VALIDATION.md, not a blocker for phase completion.
- This was the last plan in Phase 30's single wave; both 30-01 (UX-03) and 30-02 (ADMIN-05) are now complete.

---
*Phase: 30-client-identification-menu-reliability*
*Completed: 2026-07-29*

## Self-Check: PASSED

- All 4 modified source/test files confirmed present on disk (`-f` check).
- Both task commits (`dceda4c`, `8adb084`) confirmed present in `git log`.
- Combined verification command `npm test -- --testPathPattern="onboarding/ai-onboarding-agent|admin-menu"` re-run: 64/64 tests pass.
- `npx tsc --noEmit`: no type errors.
- All `<acceptance_criteria>` for both tasks re-verified passing.
