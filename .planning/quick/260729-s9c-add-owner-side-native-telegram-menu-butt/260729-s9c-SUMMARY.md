---
phase: quick
plan: 260729-s9c
subsystem: telegram-bot
tags: [telegram, bot-commands, setMyCommands, admin-menu, onboarding, greek-ux]

requires:
  - phase: quick-260729-rjv
    provides: "Client-side native Telegram command menu pattern (5 commands, routed in handleFoundBusiness) — this plan mirrors that pattern for the owner side"
provides:
  - "Owner's native Telegram (☰) command menu expanded from 1 command (/menu) to 7 (menu/settings/classes/clients/agenda/payment/invite)"
  - "handleFoundBusiness owner branch routes all 6 new commands directly to their matching admin sub-menu handler, skipping the root menu"
affects: [telegram-bot, admin-menu, onboarding]

tech-stack:
  added: []
  patterns:
    - "Owner-scoped setMyCommands array kept in sync across two independent call sites (admin-menu.ts reassertMenuButtonAndCommands, ai-onboarding-agent.ts finish_onboarding) via mirrored test assertions"
    - "Native-menu-routed sub-menu commands mirror the existing /menu-or-/start block structure exactly (clearPendingReply -> handler -> markTelegramUpdateProcessed -> logger.info -> return)"

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
  - "Copied the 6 new command descriptions verbatim from showAdminRootMenu's existing button labels (Ρυθμίσεις, Μαθήματα, Πελάτες, Ατζέντα Σήμερα, Καταχώρηση Πληρωμής, Πρόσκληση Πελάτη) rather than writing new copy"
  - "/payment routes to showClientSelection(business.id, senderTelegramId) — businessId-first signature, differing from the other 5 handlers' (chatId, business) signature, per showClientSelection's existing contract in payment-flow.ts"
  - "No consent gate added to the 6 new owner branches — the owner branch's entry condition (business.ownerTelegramId === senderTelegramId) already gates all of them, matching the existing /menu-or-/start block"

patterns-established:
  - "Owner-scoped setMyCommands 7-command array must be updated identically in both admin-menu.ts and ai-onboarding-agent.ts whenever a new admin sub-menu command is added — both are asserted byte-for-byte in their respective test files"

requirements-completed: []

coverage:
  - id: D1
    description: "Owner's native Telegram (☰) command menu registers 7 commands (menu/settings/classes/clients/agenda/payment/invite) identically at both setMyCommands call sites; client-scoped 5-command array in both files left unchanged"
    verification:
      - kind: unit
        ref: "tests/admin-menu.test.ts#re-asserts using the caller's own business botToken and chatId"
        status: pass
      - kind: unit
        ref: "tests/onboarding/ai-onboarding-agent.test.ts#BOT-06: registers owner + client commands and menu buttons after registerBotWebhook and before activateBusiness"
        status: pass
    human_judgment: false
  - id: D2
    description: "handleFoundBusiness's owner branch routes /settings, /classes, /clients, /agenda, /payment, /invite directly to showSettingsMenu, showClassesMenu, showClientsList, showTodaysAgenda, showClientSelection, and handleInviteGeneration respectively, and non-owners are not intercepted"
    verification:
      - kind: integration
        ref: "tests/webhooks/client-menu.test.ts#Suite H: owner native-menu routed commands (quick 260729-s9c)"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-07-29
status: complete
---

# Quick Task 260729-s9c: Add owner-side native Telegram menu button commands Summary

**Owner's native Telegram (☰) command menu expanded from 1 command (/menu) to 7, with /settings, /classes, /clients, /agenda, /payment, /invite each routed directly to their matching admin sub-menu handler, mirroring the client-side pattern shipped earlier the same day (260729-rjv).**

## Performance

- **Duration:** ~12 min
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- `reassertMenuButtonAndCommands` (admin-menu.ts) and `finish_onboarding` (ai-onboarding-agent.ts) both register the identical owner-scoped 7-command array (menu/settings/classes/clients/agenda/payment/invite) via `setMyCommands`
- `handleFoundBusiness`'s owner branch gained 6 new `if` blocks routing `/settings`, `/classes`, `/clients`, `/agenda`, `/payment`, `/invite` directly to `showSettingsMenu`, `showClassesMenu`, `showClientsList`, `showTodaysAgenda`, `showClientSelection`, and `handleInviteGeneration` respectively — skipping the root menu entirely
- 7 new integration tests (Suite H) added to `tests/webhooks/client-menu.test.ts` covering all 6 happy paths plus one representative non-owner non-trigger case

## Task Commits

Each task was committed atomically:

1. **Task 1: Register 7 owner commands at both setMyCommands call sites** - `6fdd246` (feat)
2. **Task 2: Route the 6 new owner commands in the webhook handler + add test coverage** - `a1464d1` (feat)

## Files Created/Modified
- `src/telegram/handlers/admin-menu.ts` - `reassertMenuButtonAndCommands`'s owner-scoped `setMyCommands` call grows from 1 to 7 commands
- `src/onboarding/ai-onboarding-agent.ts` - `finish_onboarding`'s owner-scoped `setMyCommands` call mirrors the same 7-command array
- `src/webhooks/telegram.ts` - `handleFoundBusiness`'s owner branch gains 6 new routed command blocks; imports extended from `admin-menu` and `payment-flow`
- `tests/admin-menu.test.ts` - updated the owner-scoped `setMyCommands` assertion to the new 7-item array
- `tests/onboarding/ai-onboarding-agent.test.ts` - updated the equivalent BOT-06 assertion to the new 7-item array
- `tests/webhooks/client-menu.test.ts` - added `admin-menu`/`payment-flow` partial mocks, 6 new typed mock consts, `setupCommonMocks` defaults, and new Suite H (7 tests)

## Decisions Made
- Copied the 6 new command descriptions verbatim from `showAdminRootMenu`'s existing inline-keyboard button labels — no new Greek copy written
- `/payment` calls `showClientSelection(business.id, senderTelegramId)` (businessId-first) per that function's existing signature in `payment-flow.ts`, differing from the other 5 handlers' `(chatId, business)` shape
- No consent gate added to the 6 new owner branches — the owner branch's entry condition already gates all of this, exactly like the existing `/menu`-or-`/start` block

## Deviations from Plan

None - plan executed exactly as written.

**Note:** During Task 1's commit, the pre-staged `.planning/quick/260729-s9c-add-owner-side-native-telegram-menu-butt/260729-s9c-PLAN.md` file (staged in the git index prior to this executor's invocation, not by this executor) was inadvertently swept into the first task commit (`6fdd246`) since `git add <specific files>` does not unstage already-index'd files. Content-wise this is harmless (the PLAN.md was always destined for the repo), but it means the plan file landed one commit earlier than the orchestrator's usual docs-commit convention. No code files were affected.

## Issues Encountered
None.

## Next Phase Readiness
- Owner-side native Telegram menu now fully mirrors the client-side expansion (260729-rjv) — both sides of the bot's command surface are now equally discoverable via the native (☰) button.
- No blockers for future work.

---
*Phase: quick*
*Completed: 2026-07-29*

## Self-Check: PASSED

All modified files (admin-menu.ts, ai-onboarding-agent.ts, telegram.ts, admin-menu.test.ts, ai-onboarding-agent.test.ts, client-menu.test.ts) and this SUMMARY.md verified present on disk. Both task commits (6fdd246, a1464d1) verified present in git log.
