---
phase: "16-single-bot-architecture"
plan: 2
subsystem: routing
tags: [telegram, onboarding, routing, owner-detection, single-bot]
status: complete

requires:
  - phase: "16-01"
    provides: "businesses.onboarding_completed boolean column + Business interface onboardingCompleted field"

provides:
  - handleFoundBusiness extended with onboarding routing (null guard + onboardingCompleted branch)
  - findActiveSessionByOwnerTelegramId + dispatchOnboardingStep called for in-progress owners
  - createOrResetOnboardingSession + Greek welcome message for first-contact owners
  - aiOwnerAgent path preserved for owners with onboardingCompleted=true
  - handleActivate in steps.ts sets onboardingCompleted=true before congratulatory message

affects:
  - "16-03"
  - "any phase touching handleFoundBusiness owner routing"

tech-stack:
  added: []
  patterns:
    - "Explicit null guard (ownerTelegramId !== null && ===) before identity comparison (T-16-04)"
    - "onboardingCompleted flag drives routing fork at the single business bot entry point"
    - "Flag set atomically with 'done' transition, before confirmatory message (Pitfall 2)"

key-files:
  created: []
  modified:
    - src/webhooks/telegram.ts
    - src/onboarding/steps.ts

key-decisions:
  - "Null guard written as (ownerTelegramId !== null && ownerTelegramId === senderTelegramId) — explicit, not just ===, to document intent and handle DB nulls"
  - "onboardingCompleted=true persisted in handleActivate before sendTelegramMessage — so routing is correct even if the message send fails"
  - "handleCallbackQuery not touched — callbacks originate only after onboarding is complete, so no onboarding check needed there"
  - "Merge of main (phase 16-01 changes) into worktree required before implementation — worktree was at pre-phase-16 HEAD"

patterns-established:
  - "Owner routing fork: null guard → onboardingCompleted check → onboarding path or aiOwnerAgent path"

requirements-completed:
  - ARCH-02
  - ARCH-03
  - AUTH-01
  - AUTH-02
  - AUTH-03

coverage:
  - id: D1
    description: "handleFoundBusiness routes owner with onboardingCompleted=false + active session to dispatchOnboardingStep"
    requirement: "ARCH-03"
    verification:
      - kind: other
        ref: "npx tsc --noEmit (type-checks dispatch call signature)"
        status: pass
    human_judgment: true
    rationale: "No automated unit tests for handleFoundBusiness routing paths exist in this codebase; runtime behavior requires integration test or manual verification"
  - id: D2
    description: "handleFoundBusiness routes owner with onboardingCompleted=false + no active session to createOrResetOnboardingSession + Greek welcome"
    requirement: "ARCH-03"
    verification:
      - kind: other
        ref: "npx tsc --noEmit"
        status: pass
    human_judgment: true
    rationale: "Same as D1 — no unit test harness for this path"
  - id: D3
    description: "handleFoundBusiness routes owner with onboardingCompleted=true to aiOwnerAgent (existing path preserved, ARCH-02)"
    requirement: "ARCH-02"
    verification:
      - kind: other
        ref: "npx tsc --noEmit"
        status: pass
    human_judgment: true
    rationale: "Regression coverage requires integration test"
  - id: D4
    description: "Null ownerTelegramId on business never matches any sender (T-16-04)"
    requirement: "AUTH-01"
    verification:
      - kind: other
        ref: "grep 'business.ownerTelegramId !== null' src/webhooks/telegram.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "handleActivate sets onboardingCompleted=true before congratulatory message (ARCH-03, Pitfall 2)"
    requirement: "ARCH-03"
    verification:
      - kind: other
        ref: "grep -n 'onboardingCompleted' src/onboarding/steps.ts"
        status: pass
    human_judgment: false

duration: "~2 min"
completed: "2026-07-23"
---

# Phase 16 Plan 2: Owner Routing + Onboarding Flag Summary

**Null-guarded owner identity check in handleFoundBusiness routes pre-onboarding owners to the existing onboarding state machine and sets onboarding_completed=true atomically on activation.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-07-23T17:55:06Z
- **Completed:** 2026-07-23T17:57:17Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Extended `handleFoundBusiness` in `src/webhooks/telegram.ts` with explicit null guard (`ownerTelegramId !== null && ===`) and a routing fork on `onboardingCompleted`
- Owners with `onboardingCompleted=false` resume via `findActiveSessionByOwnerTelegramId` + `dispatchOnboardingStep`, or start fresh via `createOrResetOnboardingSession` + Greek welcome
- Owners with `onboardingCompleted=true` continue to `aiOwnerAgent` unchanged (ARCH-02)
- Client path (non-owner sender) unchanged: `routeConversationMessage` (AUTH-02)
- `handleActivate` in `src/onboarding/steps.ts` now persists `onboardingCompleted=true` on the businesses row after `updateOnboardingStep('done')` and before the congratulatory message (ARCH-03, Pitfall 2)

## Task Commits

1. **Task 1: Extend handleFoundBusiness with onboarding routing** - `1673523` (feat)
2. **Task 2: Terminal onboarding step sets onboarding_completed=true** - `58e0c0d` (feat)

## Files Created/Modified

- `src/webhooks/telegram.ts` - Added imports for `findActiveSessionByOwnerTelegramId`, `createOrResetOnboardingSession`, `dispatchOnboardingStep`; replaced `handleFoundBusiness` body with null-guarded owner routing fork
- `src/onboarding/steps.ts` - Added `db.update(businesses).set({ onboardingCompleted: true })` in `handleActivate` before congratulatory message

## Decisions Made

- Null guard written as `(ownerTelegramId !== null && ownerTelegramId === senderTelegramId)` — explicit intent, safe for DB nulls (T-16-04)
- `onboardingCompleted=true` persisted in `handleActivate` before `sendTelegramMessage` — so routing is correct even if the message send fails (RESEARCH.md Pitfall 2)
- `handleCallbackQuery` not touched — callbacks originate only after onboarding completes, so no onboarding routing check needed there
- Merged main (containing phase 16-01 schema + platform removal) into worktree before implementation — worktree was at pre-phase-16 HEAD (`1832bd1`); merge was a clean fast-forward to `f296d6f`

## Deviations from Plan

**1. [Rule 3 - Blocking] Merged main into worktree before implementation**
- **Found during:** Setup (before Task 1)
- **Issue:** Worktree HEAD was at `1832bd1` (before phase 16 work). The `Business` interface lacked `onboardingCompleted`, and `src/webhooks/platform.ts` still existed. Plan 16-02 depends on Plan 16-01's schema and platform removal.
- **Fix:** `git merge main --no-edit` — fast-forward to `f296d6f` (the phase 16-01 merge commit). TypeScript compiled cleanly after merge.
- **Files affected:** All phase 16-01 artifacts (`schema.ts`, `queries.ts`, `config.ts`, `server.ts`, `migrations/0023_add_onboarding_completed.sql`; `platform.ts` deleted)
- **Committed in:** Merge was a git operation only, not an additional commit on the worktree branch — it fast-forwarded HEAD to the existing merge commit.

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking setup issue)
**Impact on plan:** Required to enable the plan's implementation. No scope creep.

## Issues Encountered

None — once the worktree was brought up to date, both tasks implemented cleanly with zero TypeScript errors.

## Known Stubs

None. Both modified files are routing/logic — no UI-facing data paths, no placeholder values.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes beyond those documented in the plan's threat model.

## Next Phase Readiness

- Phase 16-02 complete: owner routing via the business bot is now onboarding-aware
- Ready for Phase 16-03 (remove platform-bot onboarding session lookup from the platform bot, if any remaining references exist, or next phase as planned)

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/webhooks/telegram.ts | FOUND |
| src/onboarding/steps.ts | FOUND |
| .planning/phases/16-single-bot-architecture/16-02-SUMMARY.md | FOUND |
| commit 1673523 (Task 1) | FOUND |
| commit 58e0c0d (Task 2) | FOUND |

---
*Phase: 16-single-bot-architecture*
*Completed: 2026-07-23*
