---
phase: 19-class-setup-onboarding
plan: "01"
subsystem: onboarding
tags: [onboarding, class-setup, fixed-sessions, CLSS-01, CLSS-02, CLSS-03, CLSS-04]
status: complete

dependency_graph:
  requires:
    - src/session/manager.ts (createSessionCatalogWithExpansion, buildRRuleString)
    - src/database/queries.ts (listServicesForBusiness, findServiceById)
  provides:
    - class_setup_query → class_setup_service → class_setup_weekdays → class_setup_time → class_setup_capacity → class_setup_more
    - Skip path: class_setup_query Όχι → handleActivate
  affects:
    - src/onboarding/router.ts
    - src/onboarding/steps.ts

tech_stack:
  added: []
  patterns:
    - TDD (RED→GREEN) for step handlers
    - Collecteddata accumulation pattern (classSetup partial state across steps)
    - Defensive guard on missing classSetup fields before DB write

key_files:
  created:
    - tests/onboarding/steps.test.ts
  modified:
    - src/onboarding/steps.ts
    - src/onboarding/router.ts
    - tests/onboarding-flow.test.ts

decisions:
  - class_setup_query branches immediately at handleConfigLastSessionThresholdStep based on business.bookingMode (fixed_sessions vs open_slots); open_slots owners skip class setup entirely
  - Skip path (Όχι at class_setup_query) calls handleActivate directly — zero session_catalog rows created
  - καθημερινά keyword maps to Mon-Fri (indices 1-5 in GREEK_DAY_NAMES) as documented shorthand
  - Capacity validated 1-99 before any DB call (T-19-01)
  - listServicesForBusiness uses businessId from session context only — user text never controls which business is queried (T-19-02)

metrics:
  duration: "7 minutes"
  completed: "2026-07-24"
  tasks_completed: 2
  tests_added: 19
---

# Phase 19 Plan 01: Class Schedule Setup Steps in Onboarding Flow Summary

**One-liner:** Guided multi-turn onboarding dialog for `fixed_sessions` owners to define recurring class schedules via 6 new `class_setup_*` step handlers backed by `createSessionCatalogWithExpansion`.

## Tasks Completed

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 (RED) | Failing tests for class_setup_* handlers | 0fcfa1e | tests/onboarding/steps.test.ts |
| 1 (GREEN) | Implement step handlers + router wiring | 47c5a29 | src/onboarding/steps.ts, src/onboarding/router.ts |

## What Was Built

### OnboardingStep type (src/onboarding/steps.ts)

Added 6 new step variants after `config_last_session_threshold` and before `done`:
- `class_setup_query` — Ναι/Όχι gate (CLSS-04 skip path)
- `class_setup_service` — service selection by name or number
- `class_setup_weekdays` — Greek day name parsing + `καθημερινά` shorthand
- `class_setup_time` — HH:MM 24h validation
- `class_setup_capacity` — 1-99 integer, triggers DB expansion
- `class_setup_more` — loop or exit

### CollectedData interface

Extended with optional `classSetup` field:
```ts
classSetup?: { serviceId?: number; weekdays?: string[]; startTime?: string; capacity?: number }
```

### New Imports

- `listServicesForBusiness`, `findServiceById` from `../database/queries`
- `buildRRuleString`, `createSessionCatalogWithExpansion` from `../session/manager`

### Handler functions (all exported)

- `handleClassSetupQuery` — Ναι→service list + advance; Όχι→handleActivate (zero DB rows); unrecognized→re-send keyboard
- `handleClassSetupServiceStep` — case-insensitive substring match OR 1-based numeric index; no match→numbered list; match→stores serviceId, advance to weekdays
- `handleClassSetupWeekdaysStep` — splits on comma/space, filters GREEK_DAY_NAMES values; `καθημερινά` → [Δευτέρα…Παρασκευή]; <1 match→re-ask
- `handleClassSetupTimeStep` — TIME_ONLY_REGEX `/^([01]\d|2[0-3]):[0-5]\d$/`; valid→store startTime, advance; invalid→error
- `handleClassSetupCapacityStep` — 1-99 guard; defensive guard for missing fields; calls buildRRuleString + createSessionCatalogWithExpansion; sends confirmation with instanceCount; advance to class_setup_more with YES_NO_BUTTONS
- `handleClassSetupMoreStep` — Ναι→reset classSetup={}, advance to class_setup_service; Όχι→handleActivate; unrecognized→re-send keyboard

### handleConfigLastSessionThresholdStep (modified)

Before this change it unconditionally called `handleActivate`. Now:
```
if (business.bookingMode === 'fixed_sessions') → advance to class_setup_query
else (open_slots) → handleActivate (unchanged behavior)
```

### router.ts (src/onboarding/router.ts)

Added 6 `else if` branches after `config_last_session_threshold` and before `done`. Imported all 6 new handler functions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing svc_more test assertion was incorrect**
- **Found during:** GREEN phase (when fixing onboarding-flow.test.ts makeBusiness type error)
- **Issue:** `tests/onboarding-flow.test.ts` test "svc_more 'όχι'" expected `updateOnboardingStep(1, 'done', null)` but `handleSvcMoreStep` advances to `config_booking_mode`, not `done`. The incorrect assertion was hidden by a TypeScript error in `makeBusiness` (missing required `Business` fields). Fixing that type error unmasked the test logic failure.
- **Fix:** Corrected the test assertion to expect `config_booking_mode`; updated test description; fixed `makeBusiness()` to supply all required `Business` fields (`bookingMode`, `allowMultiBooking`, `cancellationCutoffEnabled`, etc.)
- **Files modified:** `tests/onboarding-flow.test.ts`
- **Commit:** 47c5a29

## Known Stubs

None — all handler paths call real functions (mocked in tests). No hardcoded empty values that flow to UI rendering.

## Threat Flags

No new trust boundaries beyond those in the plan's threat register. All mitigations applied:
- T-19-01: capacity validated 1-99 before `createSessionCatalogWithExpansion`
- T-19-02: `listServicesForBusiness(business.id)` — businessId always from session context
- T-19-03: accepted (expansion bounded at 90 days by manager.ts)

## Verification

- `npx tsc --noEmit` — 0 errors
- 19/19 new tests pass (`tests/onboarding/steps.test.ts`)
- 17/17 existing tests pass (`tests/onboarding-flow.test.ts`)

## Self-Check: PASSED

- [x] `src/onboarding/steps.ts` exists and is modified
- [x] `src/onboarding/router.ts` exists and is modified
- [x] `tests/onboarding/steps.test.ts` created (19 tests)
- [x] Commit 0fcfa1e exists (RED — failing tests)
- [x] Commit 47c5a29 exists (GREEN — implementation)
- [x] TypeScript compiles without errors
- [x] All 19 new tests pass
