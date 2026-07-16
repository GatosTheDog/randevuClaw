---
quick_id: 260716-hxo
slug: streamline-hours-onboarding-single-time
status: complete
date: "2026-07-16"
commits:
  - hash: fb4ac3d
    message: "feat(db): add split-hours columns to business_hours (migration 0005)"
  - hash: 587f338
    message: "feat(onboarding): single time-range question with split-hours support"
duration_min: 15
tasks_completed: 3
files_changed: 8
---

# Quick Task 260716-hxo: Streamline Hours Onboarding + Split Hours — Summary

## One-liner

Replaced 2-question open/close flow with a single time-range input accepting "HH:MM-HH:MM" or split "HH:MM-HH:MM,HH:MM-HH:MM"; business_hours gains nullable open_time_2/close_time_2 columns.

## What Was Built

### Task 1 — DB migration + schema + query type (commit fb4ac3d)

- `migrations/0005_split_hours.sql`: `ALTER TABLE business_hours ADD COLUMN IF NOT EXISTS open_time_2 TEXT, close_time_2 TEXT`
- `src/database/schema.ts`: `openTime2` and `closeTime2` nullable text fields in `businessHours` pgTable
- `src/database/queries.ts`: `openTime2: string | null` and `closeTime2: string | null` added to `BusinessHours` interface

### Task 2 — Onboarding step refactor (commit 587f338)

**`src/onboarding/steps.ts`:**
- `OnboardingStep` type: removed 14 `hours_X_open` / `hours_X_close` types; added 7 `hours_X_range` types
- `CollectedData`: removed `currentDayOpenTime` field (no longer needed)
- Added private `parseTimeRange()` helper: validates 1–2 comma-separated HH:MM-HH:MM ranges; enforces open<close, range2.open>range1.close
- Added `handleHoursRangeStep`: parses range, inserts business_hours (with openTime2/closeTime2 when split), advances to next day or svc_name
- Removed `handleHoursOpenStep` and `handleHoursCloseStep`
- Updated `handleHoursQueryStep` yes-branch: now advances to `hours_${day}_range` and sends single-question range prompt

**`src/onboarding/router.ts`:**
- Removed imports of `handleHoursOpenStep`, `handleHoursCloseStep`
- Added import of `handleHoursRangeStep`
- Replaced `/^hours_\d_open$/` and `/^hours_\d_close$/` dispatch branches with `/^hours_\d_range$/`

### Task 3 — Availability checker split-hours support (commit 587f338)

**`src/business/availability.ts`:**
- Extracted `candidatesForRange(openTime, closeTime, durationMin)` private helper
- In `checkAvailability`: replaced single-range loop with spread of both ranges:
  `[...candidatesForRange(primary), ...(openTime2 ? candidatesForRange(secondary) : [])]`
- Removed now-unused `openHour`, `closeHour`, `closeTimeInMinutes` variables

### Test updates (commit 587f338)

- `tests/onboarding-flow.test.ts`: replaced 3 hours_0_open/close tests with 3 hours_0_range tests (single range, split range, invalid format)
- `tests/availability.test.ts`: added `openTime2: null, closeTime2: null` to `makeMondayHours` factory for TypeScript compatibility

## Verification

- `npx tsc --noEmit`: passed (no output)
- `npx jest --testPathPattern="onboarding|availability"`: 33 tests passed across 3 suites

## Deviations from Plan

### Migration — live Neon DB not applied

- **Found during:** Task 1 execution
- **Issue:** `.env.local` read is denied by project security rules; `DATABASE_URL` not available in shell
- **Action:** Applied migration to `randevuclaw_test` (local test DB) successfully. Live Neon DB migration must be applied manually:
  ```bash
  psql $DATABASE_URL -f migrations/0005_split_hours.sql
  ```
- **Impact:** None on code quality or test correctness; tests run against local DB which is migrated.

### `handleNameStep` check

The plan noted to verify whether `handleNameStep` already used `sendTelegramMessageWithKeyboard` for the first hours prompt. Confirmed: it already calls `sendTelegramMessageWithKeyboard` (migrated in 260716-heo). No change needed.

## Known Stubs

None.

## Threat Flags

None. Schema changes are additive nullable columns with no new trust-boundary surface.

## Self-Check: PASSED

- `migrations/0005_split_hours.sql`: FOUND
- `src/database/schema.ts`: openTime2/closeTime2 fields present
- `src/database/queries.ts`: BusinessHours interface updated
- `src/onboarding/steps.ts`: handleHoursRangeStep exported, old handlers removed
- `src/onboarding/router.ts`: hours_\d_range dispatch present
- `src/business/availability.ts`: candidatesForRange helper present, split-hours spread used
- Commits fb4ac3d, 587f338: FOUND
