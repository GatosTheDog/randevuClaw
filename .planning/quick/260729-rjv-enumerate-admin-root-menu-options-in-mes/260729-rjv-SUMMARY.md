---
phase: quick
plan: 260729-rjv
subsystem: telegram-bot
tags: [telegram, greek-ux, bot-commands, discoverability]

requires: []
provides:
  - "showAdminRootMenu message text now enumerates all 6 admin menu options as a numbered list, mirroring the existing 4-row/6-button inline keyboard"
  - "Telegram native command menu ((menu) button) registers 5 real client commands: /start, /book, /mybookings, /cancel, /balance, with /book's description booking-mode-aware"
  - "src/webhooks/telegram.ts routes /book, /mybookings, /cancel, /balance as real text-commands to the same handlers their equivalent cmenu: buttons already call, gated by the same consent check /start already has"
affects: [telegram-bot, onboarding, client-menu, admin-menu]

tech-stack:
  added: []
  patterns:
    - "dispatchClientCommand helper in telegram.ts centralizes the consent-gate + mark-processed + exit-log structure shared by /start and the 4 new client text-commands"

key-files:
  created: []
  modified:
    - src/telegram/handlers/admin-menu.ts
    - src/onboarding/ai-onboarding-agent.ts
    - src/webhooks/telegram.ts
    - tests/admin-menu.test.ts
    - tests/onboarding/ai-onboarding-agent.test.ts
    - tests/webhooks/client-menu.test.ts

key-decisions:
  - "reassertMenuButtonAndCommands grew a third business parameter (rather than re-deriving bookingMode) since business was already in scope at its one call site"
  - "Both setMyCommands 5-command arrays (admin-menu.ts and ai-onboarding-agent.ts) are literal, independent copies (as the plan specified) rather than a shared constant, kept in sync by byte-for-byte test assertions in both files"
  - "dispatchClientCommand is purely additive — the existing /start branch was left byte-for-byte unchanged rather than refactored to use the new helper, per the plan's explicit instruction"

patterns-established:
  - "New client text-commands are added as `if (messageText.trim() === '/x') { await dispatchClientCommand(...); return; }` blocks placed after the owner branch's unconditional return, guaranteeing structural unreachability for owners without any explicit owner check"

requirements-completed: []

coverage:
  - id: D1
    description: "showAdminRootMenu's message text enumerates all 6 button labels as a numbered list (1-6), keyboard/callback_data unchanged"
    verification:
      - kind: unit
        ref: "tests/admin-menu.test.ts#showAdminRootMenu — keyboard shape > message text enumerates all 6 button labels as a numbered list"
        status: pass
    human_judgment: false
  - id: D2
    description: "reassertMenuButtonAndCommands and finish_onboarding both register the identical 5-command array (start/book/mybookings/cancel/balance) with booking-mode-aware book description"
    verification:
      - kind: unit
        ref: "tests/admin-menu.test.ts#showAdminRootMenu — menu button re-assertion (D-06.2) > re-asserts using the caller's own business botToken and chatId"
        status: pass
      - kind: unit
        ref: "tests/admin-menu.test.ts#showAdminRootMenu — menu button re-assertion (D-06.2) > registers book command with booking-mode-aware description when bookingMode is fixed_sessions"
        status: pass
      - kind: unit
        ref: "tests/onboarding/ai-onboarding-agent.test.ts#executeOnboardingTool > finish_onboarding > BOT-06: registers owner + client commands and menu buttons after registerBotWebhook and before activateBusiness"
        status: pass
    human_judgment: false
  - id: D3
    description: "/book, /mybookings, /cancel, /balance route to showBookSessionList/showClientBookings/showCancelBookingList/showClientBalance when consent is given, show the consent prompt when it is not, and remain unreachable for owners"
    verification:
      - kind: integration
        ref: "tests/webhooks/client-menu.test.ts#Suite B: /start intercept and CMENU-05 free-text routing > client sends /book|/mybookings|/cancel|/balance → ... called, routeConversationMessage NOT called"
        status: pass
      - kind: integration
        ref: "tests/webhooks/client-menu.test.ts#Suite B: /start intercept and CMENU-05 free-text routing > owner sends /book → showBookSessionList NOT called (owner branch intercepts first)"
        status: pass
      - kind: integration
        ref: "tests/webhooks/client-menu.test.ts#Suite G: client consent gate > /book with consentGiven=false → consent prompt+keyboard sent, showBookSessionList NOT called"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-29
status: complete
---

# Quick Task 260729-rjv: Enumerate Admin Root Menu + Register/Route 5 Client Telegram Commands Summary

**Admin root menu text now lists all 6 options as a numbered list; Telegram's native command menu registers and routes 5 real client commands (/start, /book, /mybookings, /cancel, /balance) instead of just /start**

## Performance

- **Duration:** ~20 min
- **Tasks:** 3 completed
- **Files modified:** 6

## Accomplishments
- `showAdminRootMenu`'s message text enumerates all 6 admin button labels as a numbered list (1-6), with the inline keyboard, `callback_data`, and `assertCallbackDataSize` calls byte-for-byte unchanged
- Both `setMyCommands` registration call sites (`reassertMenuButtonAndCommands` in admin-menu.ts and `finish_onboarding` in ai-onboarding-agent.ts) now register the identical, booking-mode-aware 5-command array (start/book/mybookings/cancel/balance)
- `src/webhooks/telegram.ts`'s `handleFoundBusiness` routes `/book`, `/mybookings`, `/cancel`, `/balance` as real text-commands to the same handler functions their equivalent `cmenu:` root-menu buttons already call, gated by the same consent check `/start` already has, and structurally unreachable for owners (positioned after the owner branch's unconditional return)

## Task Commits

Each task was committed atomically:

1. **Task 1: Enumerate all 6 admin root-menu options in the message text (Part A)** - `cb953d0` (feat)
2. **Task 2: Register 5 real client commands at both setMyCommands call sites (Part B, registration)** - `114d6bd` (feat)
3. **Task 3: Route /book, /mybookings, /cancel, /balance as real client commands in the webhook handler (Part B, routing)** - `a725eec` (feat)

**Plan metadata:** committed separately by the orchestrator (docs commit for SUMMARY.md/STATE.md).

## Files Created/Modified
- `src/telegram/handlers/admin-menu.ts` - `showAdminRootMenu` now builds a `menuText` numbered-list local var; `reassertMenuButtonAndCommands` grew a `business: Business` third parameter and registers 5 commands instead of 1
- `src/onboarding/ai-onboarding-agent.ts` - `finish_onboarding`'s `setMyCommands` call inside its retry loop registers the same 5-command array, with a `bookingButtonText` computed once before the loop
- `src/webhooks/telegram.ts` - added `showBookSessionList`/`showClientBookings`/`showCancelBookingList`/`showClientBalance` to the client-menu import; added a new `dispatchClientCommand` helper; added 4 new `if` blocks routing `/book`, `/mybookings`, `/cancel`, `/balance` after the existing `/start` branch
- `tests/admin-menu.test.ts` - added a text-enumeration test to "showAdminRootMenu — keyboard shape"; updated the re-assertion test's expected 5-command array; added a booking-mode-aware coverage test
- `tests/onboarding/ai-onboarding-agent.test.ts` - updated the BOT-06 test's expected `setMyCommands` call to the 5-command array
- `tests/webhooks/client-menu.test.ts` - extended the client-menu mock factory and typed mock consts for the 4 new handler functions; added 5 new tests to Suite B (4 happy-path + 1 owner-unreachability) and 1 new test to Suite G (consent gate)

## Decisions Made
- `reassertMenuButtonAndCommands` grew a third `business: Business` parameter (matching the plan) since `business` was already in scope at its single call site inside `showAdminRootMenu` — avoided re-deriving `bookingMode` via a redundant DB lookup
- The two 5-command arrays in admin-menu.ts and ai-onboarding-agent.ts remain independent literal copies rather than a shared constant (as specified in the plan's threat model, T-quick-02) — kept in sync via byte-for-byte test assertions in both files rather than a shared import, to avoid coupling two otherwise-independent modules
- `dispatchClientCommand` is purely additive: the existing `/start` branch was left byte-for-byte unchanged (not refactored to call the new helper) per the plan's explicit instruction, minimizing risk to already-tested code

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All 3 tasks complete, all touched test suites green (146 tests across tests/admin-menu.test.ts, tests/onboarding/ai-onboarding-agent.test.ts, tests/webhooks/client-menu.test.ts), `npx tsc --noEmit` clean
- No blockers or concerns carried forward

---
*Phase: quick*
*Completed: 2026-07-29*

## Self-Check: PASSED

All 6 modified files verified present on disk; all 3 task commits (cb953d0, 114d6bd, a725eec) verified present in git history.
