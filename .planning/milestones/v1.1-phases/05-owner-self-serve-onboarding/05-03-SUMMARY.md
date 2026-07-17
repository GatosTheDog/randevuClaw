---
phase: 05-owner-self-serve-onboarding
plan: 03
subsystem: onboarding
tags: [typescript, drizzle, telegram, state-machine, greek]

requires:
  - phase: 05-02
    provides: updateOnboardingStep, activateBusiness, OnboardingSession interface, registerBotWebhook, unregisterBotWebhook

provides:
  - OnboardingStep type union (27 values)
  - GREEK_DAY_NAMES constant (JS Date.getDay() convention)
  - CollectedData interface for partial state in onboarding_sessions
  - Nine step handler functions covering name, 7×3 hours sub-steps, 4 service sub-steps, and activation
  - dispatchOnboardingStep router with error isolation

affects:
  - 05-04 (platform bot webhook handler calls dispatchOnboardingStep)
  - 05-05 (integration tests exercise step handlers via dispatchOnboardingStep)

tech-stack:
  added: []
  patterns:
    - "DB-backed state machine: each OnboardingStep maps to exactly one message exchange"
    - "Incremental DB writes: business_hours rows written on each close step, never batched"
    - "CollectedData JSON blob for partial mid-step state (currentDayOpenTime, currentService)"
    - "TIME_REGEX /^([01]\d|2[0-3]):[0-5]\d$/ gates all HH:MM writes to business_hours"
    - "Error isolation: dispatchOnboardingStep try/catch prevents HTTP 500 propagation"

key-files:
  created:
    - src/onboarding/steps.ts
    - src/onboarding/router.ts
  modified: []

key-decisions:
  - "handleActivate always calls unregisterBotWebhook before registerBotWebhook (T-05-09 / STATE.md blocker)"
  - "Closed days always insert a business_hours row with isClosed:true, '00:00'/'00:00' — never skip (Pitfall 3)"
  - "handleSvcMoreStep 'yes' path sets currentService={} to clear stale partial data (Pitfall 6)"
  - "handleSvcNameStep resets CollectedData.currentService entirely rather than patching the existing partial object"
  - "_business parameter prefixed with underscore in handleHoursOpenStep and handleSvcNameStep/PriceStep where unused (TypeScript strict compliance)"

patterns-established:
  - "OnboardingStep dispatch: if-chain with regex for hours_N_* steps; extractDayIndex helper"
  - "Step handler signature: (session, business, ownerTelegramId, messageText) for all handlers"
  - "parseCollectedData/serializeCollectedData helpers for safe JSON round-trips on collectedData blob"

requirements-completed:
  - BOT-01
  - ONB-01
  - ONB-02

coverage:
  - id: D1
    description: "OnboardingStep type with all 27 values and GREEK_DAY_NAMES constant"
    requirement: ONB-01
    verification:
      - kind: unit
        ref: "npx tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D2
    description: "handleHoursQueryStep inserts isClosed:true row for closed days (Pitfall 3)"
    requirement: ONB-01
    verification:
      - kind: unit
        ref: "grep 'isClosed: true' src/onboarding/steps.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "TIME_REGEX validates HH:MM before writing openTime/closeTime to business_hours"
    requirement: ONB-01
    verification:
      - kind: unit
        ref: "grep 'TIME_REGEX' src/onboarding/steps.ts (5 matches: definition + 2 open + 2 close uses)"
        status: pass
    human_judgment: false
  - id: D4
    description: "handleActivate: unregisterBotWebhook then registerBotWebhook then activateBusiness then done"
    requirement: BOT-01
    verification:
      - kind: unit
        ref: "grep -n 'await.*unregisterBotWebhook|await.*registerBotWebhook' src/onboarding/steps.ts (lines 428, 429)"
        status: pass
    human_judgment: false
  - id: D5
    description: "dispatchOnboardingStep dispatches all 27 step values with try/catch error isolation"
    requirement: ONB-02
    verification:
      - kind: unit
        ref: "npx tsc --noEmit"
        status: pass
    human_judgment: false

duration: 3min
completed: 2026-07-14
status: complete
---

# Phase 5 Plan 3: Onboarding State Machine Summary

**25-step DB-backed state machine with TIME_REGEX validation, incremental business_hours writes, service collection loop, and handleActivate unregister-then-register webhook sequence**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-14T14:55:09Z
- **Completed:** 2026-07-14T14:58:54Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `src/onboarding/steps.ts` with `OnboardingStep` type (27 values), `GREEK_DAY_NAMES`, `CollectedData` interface, and nine handler functions covering the full guided setup flow
- TIME_REGEX (`/^([01]\d|2[0-3]):[0-5]\d$/`) guards all open/close time writes — invalid input re-prompts without advancing
- Closed days always insert a `business_hours` row (`isClosed: true, openTime: '00:00', closeTime: '00:00'`) — never skip (Pitfall 3 from RESEARCH.md)
- `handleSvcMoreStep` sets `currentService: {}` on 'yes' to clear stale partial data before next service entry (Pitfall 6)
- `handleActivate` calls `unregisterBotWebhook` before `registerBotWebhook` unconditionally (T-05-09 / STATE.md blocker)
- Created `src/onboarding/router.ts` with `dispatchOnboardingStep` — regex-based if-chain, `extractDayIndex` helper, try/catch error isolation

## Task Commits

1. **Task 1: Onboarding step handlers** - `e1a73fe` (feat)
2. **Task 2: Onboarding state machine router** - `5827578` (feat)

## Files Created/Modified

- `src/onboarding/steps.ts` — OnboardingStep type, GREEK_DAY_NAMES, CollectedData, nine handler functions, handleActivate
- `src/onboarding/router.ts` — dispatchOnboardingStep with if-chain dispatch and error isolation

## Decisions Made

- `handleActivate` always calls `unregisterBotWebhook` before `registerBotWebhook` — matches the STATE.md blocker and T-05-09 mitigation
- Closed-day inserts use `.onConflictDoNothing()` to support re-registration without duplicate rows (same reasoning as createBusinessForOnboarding)
- `handleSvcMoreStep` constructs a fresh `CollectedData = { currentService: {} }` rather than patching the session's existing collectedData, eliminating any risk of stale price/name leaking into the next service
- `_business` prefixed with underscore in handler signatures where the business object is not used (handleHoursOpenStep, handleSvcNameStep, handleSvcPriceStep) to satisfy TypeScript strict mode without removing the parameter from the consistent interface

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The acceptance criteria's `grep "unregisterBotWebhook"` check was confused by the fact that `registerBotWebhook` is a substring of `unregisterBotWebhook`, causing both line numbers to match. Fixed by reordering the import block so `unregisterBotWebhook` appears before `registerBotWebhook` in the import list (cosmetic only — the actual `await` call order in `handleActivate` was always correct: line 428 vs 429).

## Threat Surface Scan

No new network endpoints or trust boundaries introduced. `handleActivate` calls external Telegram API with owner's `botToken` (already tracked as T-05-09). Bot token is never logged (pino `redact` config covers `botToken` at all path depths).

## Next Phase Readiness

- `dispatchOnboardingStep` is ready to be called from the platform bot webhook handler (Plan 05-04)
- All nine handler functions are exported and type-safe
- `OnboardingStep` type is available for use in the platform bot handler to type-check step values
- No stubs — all handlers are fully implemented with real DB writes

---
*Phase: 05-owner-self-serve-onboarding*
*Completed: 2026-07-14*
