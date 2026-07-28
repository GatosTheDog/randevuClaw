---
phase: 27-client-consent-registration
plan: 2
subsystem: telegram-bot
tags: [telegram, consent, gdpr, jest, ts-jest]

# Dependency graph
requires:
  - phase: 27-01
    provides: consentGiven schema default flipped to false, updateClientConsentGiven query function, insertClientBusinessRelationship no longer hardcoding consent
provides:
  - CONSENT_LABELS (greek-messages.ts), CONSENT_PROMPT_GREEK_TEMPLATE + CONSENT_KEYBOARD (consent/checker.ts)
  - getOrCreateClientRelationship returns the real inserted row's consentGiven instead of a hardcoded true
  - /start hard consent gate wired into webhooks/telegram.ts (gates showClientRootMenu)
  - consent:yes/consent:no callback_data parsing + handleCallbackQuery branch (ConsentCallbackResult type)
  - Free-chat hard consent gate in conversation/router.ts (ConversationChannel.sendMessageWithKeyboard), replacing the old soft/prepended notice
affects: [phase-28, phase-29, phase-30, telegram-webhooks, consent, conversation-router]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client-facing Ναι/Όχι consent gate as a hard blocking check before menu/AI reply, mirroring Phase 26's owner-facing confirmation-keyboard pattern but with its own callback_data namespace (consent:yes/consent:no) and its own labels file (CONSENT_LABELS, kept separate from CONFIRM_LABELS)"
    - "ConversationChannel interface extended with sendMessageWithKeyboard so the channel-agnostic conversation core can send an inline keyboard without breaking the WhatsApp-readiness abstraction"

key-files:
  created: []
  modified:
    - src/utils/greek-messages.ts
    - src/consent/checker.ts
    - src/webhooks/telegram.ts
    - src/conversation/router.ts
    - tests/webhooks/client-menu.test.ts
    - tests/conversation-router.test.ts

key-decisions:
  - "CONSENT_LABELS kept as a separate export from CONFIRM_LABELS (Phase 26) — different audience (client-facing vs owner-facing) and a different callback_data convention (consent:yes/no vs otc:.../menu:...)"
  - "getOrCreateClientRelationship's return value for a brand-new row now reflects insertClientBusinessRelationship's actual returned consentGiven (DB-defaulted false per Plan 27-01) instead of a hardcoded true — load-bearing fix without which the entire gate would be silently defeated"
  - "routeConversationMessage's gate checks consentGiven (not isFirstContact) and returns immediately before findLatestConversationTurn/aiBookingAgent/insertConversationTurn — a consented-only invariant now holds for every AI call and every persisted turn (D-03)"
  - "Fixed a pre-existing, unrelated test-fixture drift in tests/conversation-router.test.ts's BUSINESS constant (missing 8 Business interface fields added by later phases) that was blocking this plan's own conversation-router acceptance criterion from running at all (Rule 3 — blocking fix)"

patterns-established:
  - "Client-facing confirmation keyboards get their own callback_data namespace and labels constant, never reusing an owner-facing convention even when the button text happens to be identical (Ναι/Όχι)"

requirements-completed: [COMP-01, COMP-02]

coverage:
  - id: D1
    description: "CONSENT_LABELS/CONSENT_PROMPT_GREEK_TEMPLATE/CONSENT_KEYBOARD exist and are exported; getOrCreateClientRelationship reflects the real inserted row's consentGiven instead of a hardcoded true (Task 1, completed and committed in a prior interrupted session, verified in this session)"
    requirement: "COMP-02"
    verification:
      - kind: unit
        ref: "npx tsc --noEmit"
        status: pass
      - kind: unit
        ref: "npx jest --testPathPattern=\"consent\" --no-coverage"
        status: pass
    human_judgment: false
  - id: D2
    description: "/start with consentGiven=false shows the Ναι/Όχι consent+registration prompt instead of the client menu; consentGiven=true is unchanged; consent:yes/consent:no callback_data is parsed and routed, updateClientConsentGiven called on yes, decline-ack sent on no, showClientRootMenu withheld on no"
    requirement: "COMP-01"
    verification:
      - kind: integration
        ref: "tests/webhooks/client-menu.test.ts Suite G (6 tests, all passing)"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D3
    description: "Free-chat first contact with consentGiven=false is hard-gated: aiBookingAgent, insertConversationTurn, and channel.sendMessage (plain) are never called; instead channel.sendMessageWithKeyboard sends the consent prompt+keyboard. consentGiven=true is unchanged pass-through with the old soft prepend fully removed (D-03)"
    requirement: "COMP-01"
    verification:
      - kind: integration
        ref: "tests/conversation-router.test.ts Test 2 (rewritten hard-gate test) + Tests 1/3/4 (unchanged pass-through)"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-28
status: complete
---

# Phase 27 Plan 2: Client Consent & Registration — Hard Gate Wiring Summary

**Wired the hard Ναι/Όχι consent gate into both client entry points — `/start` and free-form chat — so a client only reaches the menu or an AI reply after explicitly accepting, replacing the old soft/prepended consent notice with a real blocking gate (COMP-01/COMP-02, D-01/D-02/D-03).**

## Performance

- **Duration:** ~15 min (this continuation session; Task 1 was completed and committed in a prior interrupted session)
- **Started:** 2026-07-28T14:17:53+03:00 (Task 1 commit, prior session)
- **Completed:** 2026-07-28T14:27:26+03:00 (Task 3 commit, this session)
- **Tasks:** 3 completed
- **Files modified:** 6 (2 source files touched only by Task 1; 2 source + 2 test files touched by Tasks 2–3)

## Continuation Note

A previous executor run for this plan hit a session usage limit after completing Task 1's edits but before committing. The orchestrator verified Task 1's acceptance criteria (all `grep` checks, `npx tsc --noEmit`, and the targeted `consent` jest suite) independently and committed it as commit `008c19b`. This session verified that commit's state matched the plan's Task 1 spec exactly, then executed Task 2 and Task 3 fresh.

## Accomplishments
- `CONSENT_LABELS` (`{ ACCEPT: 'Ναι', DECLINE: 'Όχι' }`) added to `greek-messages.ts`, kept separate from Phase 26's `CONFIRM_LABELS` — different audience and callback_data convention
- `CONSENT_PROMPT_GREEK_TEMPLATE`/`CONSENT_KEYBOARD` added to `consent/checker.ts`; `getOrCreateClientRelationship` fixed to return the real inserted row's `consentGiven` instead of a hardcoded `true` (load-bearing fix — without it every new client would silently read back as already-consented)
- `/start` branch in `webhooks/telegram.ts` now checks `consentGiven` before calling `showClientRootMenu`; unconsented clients see the merged prompt+keyboard instead
- `ConsentCallbackResult` type + `consent:yes`/`consent:no` regex arm added to `parseCallbackData`; `handleCallbackQuery` branch calls `updateClientConsentGiven` + `showClientRootMenu` on yes, sends a Greek decline-ack and withholds the menu on no
- `ConversationChannel` interface extended with `sendMessageWithKeyboard`; `routeConversationMessage` now hard-gates on `consentGiven` (not `isFirstContact`) before any `aiBookingAgent` call or `insertConversationTurn`, replacing the old soft/prepended-notice behavior entirely (D-03)
- Telegram's `routeConversationMessage` call site wired with `sendMessageWithKeyboard: sendTelegramMessageWithKeyboard`

## Task Commits

Each task was committed atomically:

1. **Task 1: Consent domain logic — labels, merged prompt+keyboard, getOrCreateClientRelationship fix** - `008c19b` (feat) — completed in a prior interrupted session, committed by the orchestrator after independent verification
2. **Task 2: /start gate + consent:yes/consent:no callback wiring** - `29cbf9c` (feat)
3. **Task 3: Free-chat hard gate in conversation/router.ts + call-site wiring** - `50423f0` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/utils/greek-messages.ts` - `CONSENT_LABELS` export (Task 1)
- `src/consent/checker.ts` - `CONSENT_PROMPT_GREEK_TEMPLATE`, `CONSENT_KEYBOARD`, fixed `getOrCreateClientRelationship` (Task 1)
- `src/webhooks/telegram.ts` - `/start` consent gate, `ConsentCallbackResult` type, `consent:yes`/`consent:no` parsing + handling, `CONSENT_DECLINE_ACK_GREEK`, updated `routeConversationMessage` call site (Tasks 2, 3)
- `src/conversation/router.ts` - `ConversationChannel.sendMessageWithKeyboard`, hard consent gate replacing the old soft prepend (Task 3)
- `tests/webhooks/client-menu.test.ts` - Suite G: 6 new tests covering the `/start` gate and `consent:yes`/`consent:no` callback routing (Task 2)
- `tests/conversation-router.test.ts` - Test 2 rewritten for the hard-gate behavior; `makeChannel()` extended; `BUSINESS` fixture fixed (Task 3)

## Decisions Made
- `CONSENT_LABELS` kept separate from `CONFIRM_LABELS` per the plan's explicit design intent (client-facing vs owner-facing, different callback_data namespace)
- `getOrCreateClientRelationship`'s hardcoded-true bug fix is the single point that makes the entire gate observable — verified via `inserted.consentGiven` grep and the existing `tests/consent.test.ts` coverage
- `routeConversationMessage`'s gate returns immediately on `!consentGiven`, before `findLatestConversationTurn` — no AI call, no persisted turn, matching D-03's "real behavior change, not a copy-paste" requirement
- Client-facing consent callback (`consent:yes`/`consent:no`) carries no ids at all — the handler trusts only the webhook-scoped, HMAC-verified `business` param plus Telegram's own `callback_query.from.id`, per the threat model's T-27-04 disposition

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed pre-existing test-fixture drift in tests/conversation-router.test.ts**
- **Found during:** Task 3 (running the plan's own required verification command, `npx jest --testPathPattern="conversation-router" --no-coverage`)
- **Issue:** The file's `BUSINESS: queries.Business` fixture was missing 8 fields added to the `Business` interface by later phases (`bookingMode`, `allowMultiBooking`, `cancellationCutoffEnabled`, `cancellationCutoffHours`, `slotlessRequestsEnabled`, `lastSessionThresholdEnabled`, `lastSessionThresholdCount`, `onboardingCompleted`). This is unrelated to this plan's own changes (confirmed by stashing this plan's diff and reproducing the identical failure on the pre-existing commit) but blocked the test suite from even loading, which would have made Task 3's own required acceptance criterion impossible to pass.
- **Fix:** Added the 8 missing fields with sensible defaults (matching the precedent in `tests/webhooks/client-menu.test.ts`'s `BASE_BUSINESS`).
- **Files modified:** `tests/conversation-router.test.ts`
- **Verification:** `npx jest --testPathPattern="conversation-router" --no-coverage` now passes (4/4 tests); `npx tsc --noEmit` clean.
- **Committed in:** `50423f0` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to make Task 3's own required verification command runnable at all. No scope creep — only the missing fields were added, no other test-fixture behavior changed.

## Issues Encountered
None beyond the deviation documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- ROADMAP Phase 27 Success Criteria #1 and #2 are both satisfied: `/start` and free-chat show the identical hard consent gate on first (and every subsequent unconsented) contact
- Success Criteria #3 is satisfied by Plan 27-01 + this plan together: `consentGiven` is the single explicit opt-in flag, only true once the client accepts
- Accepting (Ναι) immediately unblocks the client (shows the menu); declining (Όχι) leaves them gated with a clear, recoverable acknowledgment
- All existing Suite A-F tests in `tests/webhooks/client-menu.test.ts` and Tests 1/3/4 in `tests/conversation-router.test.ts` remain green alongside the new gate tests (Suite G + rewritten Test 2)
- No blockers for Phase 28 (admin menu discoverability) or later phases

---
*Phase: 27-client-consent-registration*
*Completed: 2026-07-28*

## Self-Check: PASSED

- FOUND: src/utils/greek-messages.ts
- FOUND: src/consent/checker.ts
- FOUND: src/webhooks/telegram.ts
- FOUND: src/conversation/router.ts
- FOUND: tests/webhooks/client-menu.test.ts
- FOUND: tests/conversation-router.test.ts
- FOUND: .planning/phases/27-client-consent-registration/27-02-SUMMARY.md
- FOUND: 008c19b
- FOUND: 29cbf9c
- FOUND: 50423f0
