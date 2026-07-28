---
phase: 28-admin-menu-discoverability
plan: 1
subsystem: ui
tags: [telegram, admin-menu, inline-keyboard, discoverability, greek-messages]

# Dependency graph
requires:
  - phase: 07-billing-payment-flow
    provides: showClientSelection / showPackageSelection / showMembershipConfirmation payment-recording flow
  - phase: 17-admin-menu
    provides: showAdminRootMenu, showSettingsMenu, showClassesMenu, handleMenuCallback dispatcher
  - phase: 21-owner-onboarding-agent
    provides: Gemini NLU owner agent that parses free-form Greek phrasing for hours/services/classes
provides:
  - Root-level "Καταχώρηση Πληρωμής" /menu button wired to the existing payment-recording flow
  - 3 new Settings-submenu example-phrase buttons (hours, services/prices, class-setup)
  - Upgraded "Νέο μάθημα (chat)" prompt from single rigid example to multi-example style
affects: [28-02-admin-menu-discoverability, future admin-menu UX phases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Menu callback exact-match cases placed before startsWith() prefix cases in switch(true) — first-match-wins ordering"
    - "Example-phrase guidance buttons (informational, non-mutating) live inside existing submenus rather than as new root-level clutter"

key-files:
  created: []
  modified:
    - src/telegram/handlers/admin-menu.ts
    - tests/admin-menu.test.ts

key-decisions:
  - "Payment button reuses showClientSelection(business.id, chatId) directly — pure wiring, no new payment logic (D-10/D-11/D-12)"
  - "Example-phrase buttons show exactly 3 bullet-point Greek phrases per category to illustrate range of free-form phrasing, not one rigid command (D-06/D-07)"
  - "All 3 new example-phrase buttons live inside the existing Settings submenu, not as new root-menu buttons (D-09)"
  - "New settings:*_examples cases placed before the startsWith('settings:') fallback case in the switch(true) block so they aren't swallowed by handleSettingsToggle's default branch"

patterns-established:
  - "Multi-example Greek guidance text (3 bullets) for setup-related menu actions"

requirements-completed: [ADMIN-02, ADMIN-03, ADMIN-04]

coverage:
  - id: D1
    description: "Owner can tap 'Καταχώρηση Πληρωμής' from the /menu root and reach the existing payment-recording client-selection flow"
    requirement: "ADMIN-03"
    verification:
      - kind: unit
        ref: "tests/admin-menu.test.ts#handleMenuCallback — payment action > calls showClientSelection exactly once with (business.id, chatId)"
        status: pass
      - kind: unit
        ref: "tests/admin-menu.test.ts#showAdminRootMenu — keyboard shape > sends exactly one message with a 4-row keyboard totalling 6 buttons"
        status: pass
    human_judgment: false
  - id: D2
    description: "Owner can tap example-phrase buttons inside Settings (hours, services/prices, class-creation), each showing 3 distinct Greek example phrases"
    requirement: "ADMIN-04"
    verification:
      - kind: unit
        ref: "tests/admin-menu.test.ts#showSettingsMenu — keyboard shape > sends an 8-row keyboard with the 3 new example-phrase buttons before the back button"
        status: pass
      - kind: unit
        ref: "tests/admin-menu.test.ts#handleMenuCallback — settings example-phrase actions > settings:hours_examples/services_examples/classes_examples sends exactly one message with 3 bullet phrases"
        status: pass
    human_judgment: false
  - id: D3
    description: "'Νέο μάθημα (chat)' button now sends the same multi-example guidance style instead of one rigid command, closing ADMIN-02's named decorative-button gap"
    requirement: "ADMIN-02"
    verification:
      - kind: unit
        ref: "tests/admin-menu.test.ts#handleMenuCallback — settings example-phrase actions > classes:create sends exactly one message with 3 bullet phrases (upgraded from single rigid example)"
        status: pass
    human_judgment: false
  - id: D4
    description: "End-to-end owner-facing Telegram UX (actual button taps in a live chat) reads and behaves as intended"
    verification: []
    human_judgment: true
    rationale: "No live Telegram environment available in this executor session; verified via unit tests against mocked sendTelegramMessage/sendTelegramMessageWithKeyboard calls and manual code trace only."

duration: 20min
completed: 2026-07-28
status: complete
---

# Phase 28 Plan 1: Payment Button + Setup Example-Phrase Discoverability Summary

**Wired the existing payment-recording flow and Gemini NLU setup guidance into `/menu` via a new root-level "Καταχώρηση Πληρωμής" button and 3 new Settings-submenu example-phrase buttons, and upgraded the "Νέο μάθημα (chat)" prompt to the same multi-example style.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-28T16:38:00Z (approx.)
- **Completed:** 2026-07-28T16:58:19+03:00
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `/menu` root now has a 4-row/6-button keyboard: existing 2x2 grid unchanged, a new "Καταχώρηση Πληρωμής" row (`menu:payment`) routing to `showClientSelection(business.id, chatId)`, and the existing invite row
- Settings submenu now has an 8-row keyboard: 4 existing toggle rows unchanged, 3 new example-phrase rows (hours/services/classes), then the back button
- 3 new `handleMenuCallback` cases (`settings:hours_examples`, `settings:services_examples`, `settings:classes_examples`) each send exactly one message with 3 distinct Greek example phrases, placed before the `startsWith('settings:')` fallback case so they aren't swallowed by `handleSettingsToggle`
- `classes:create` case body replaced with the same 3-bullet multi-example style (button label/callback_data unchanged), closing ADMIN-02's named decorative-button gap
- All new callback_data strings guarded with `assertCallbackDataSize`

## Task Commits

Each task was committed atomically:

1. **Task 1: Payment button wiring (ADMIN-03)** - `833f354` (feat)
2. **Task 2: Setup example-phrase buttons + classes:create upgrade (ADMIN-02, ADMIN-04)** - `06e7584` (feat)

_Note: TDD tasks may have multiple commits (test → feat → refactor) — here both tasks combined test additions with implementation in a single commit each, since the acceptance-criteria test assertions and implementation were verified together before each commit._

## Files Created/Modified
- `src/telegram/handlers/admin-menu.ts` - Added payment button row + `menu:payment` case; added 3 Settings example-phrase button rows + cases; upgraded `classes:create` case body
- `tests/admin-menu.test.ts` - Updated keyboard-shape test for the 4-row/6-button root menu; added `handleMenuCallback — payment action`, `showSettingsMenu — keyboard shape`, and `handleMenuCallback — settings example-phrase actions` describe blocks; added `jest.mock('../src/telegram/handlers/payment-flow')`

## Decisions Made
- Payment button placed as its own row below the existing 5 root-menu buttons, above the invite row (D-11/D-12)
- Example-phrase buttons live inside the existing Settings submenu rather than as new root-menu buttons (D-09)
- Each example-phrase message uses exactly 3 bullet phrases to show the range of free-form Greek phrasing the Gemini NLU owner agent already accepts, without dictating one exact syntax (D-06/D-07)
- No Phase 26 Ναι/Όχι confirmation pattern added to any of these actions — payment reuses `showClientSelection`'s own confirmation step; example prompts are informational/non-destructive (D-13)

## Deviations from Plan

None functionally — plan executed as written. One acceptance-criterion text mismatch was identified and is documented for transparency:

### Acceptance Criteria Note (not a code deviation)

**Criterion:** `grep -c "menu:payment" src/telegram/handlers/admin-menu.ts` returns >= 2

**Actual:** Returns 1.

**Reason:** The plan's action text (and the established codebase convention followed by every other existing button — `menu:invite`, `menu:agenda`, `menu:clients`, etc.) declares the callback_data literal exactly once as a `const` and reuses it by variable name everywhere else (the `assertCallbackDataSize` call and the keyboard entry both reference `callbackDataPayment`, not the string literal again). This is confirmed identical for every other existing root-menu button (`grep -c "menu:invite"` also returns 1). The plan's own `case menuAction === 'payment':` uses the bare stripped action (`'payment'`, not `'menu:payment'`), unlike the namespaced `settings:*_examples` cases where the grep count of 2 is naturally satisfied because the case literal (`'settings:hours_examples'`) and the const literal (`'menu:settings:hours_examples'`) are different strings that both happen to contain the substring. Duplicating the raw string a second time in `admin-menu.ts` purely to satisfy this grep count would break the file's own established DRY convention. All other acceptance criteria for Task 1 pass, and the functional intent (const declared, size-guarded, wired into the keyboard, routed to `showClientSelection`) is fully verified by the passing test suite.

**Impact:** None — no functional gap. Logged for transparency per the acceptance-criteria hard-gate protocol.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ADMIN-02, ADMIN-03, and ADMIN-04 are satisfied by this plan's wiring
- Phase 28's remaining scope (ADMIN-01 reply-to-client relay) is covered by plan 28-02
- No blockers for 28-02

---
*Phase: 28-admin-menu-discoverability*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: src/telegram/handlers/admin-menu.ts
- FOUND: tests/admin-menu.test.ts
- FOUND: .planning/phases/28-admin-menu-discoverability/28-01-SUMMARY.md
- FOUND commit: 833f354
- FOUND commit: 06e7584
- `npx tsc --noEmit` exits 0
- `npx jest --testPathPattern="admin-menu" --no-coverage` — 23/23 tests pass
