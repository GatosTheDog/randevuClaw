---
phase: 03-calendar-sync-agenda-reminders
plan: 5
subsystem: scheduler
tags: [in-process-poller, telegram, timezone, dst-safe, typescript, jest, tdd]

# Dependency graph
requires:
  - phase: 03-calendar-sync-agenda-reminders (Plan 03-01)
    provides: "claimReminder24hSlot/claimReminder1hSlot atomic idempotency guards, findBookingsNeedingReminder, listAllBusinessIds query layer"
  - phase: 03-calendar-sync-agenda-reminders (Plan 03-04)
    provides: "in-process poller precedent (agenda.ts shape) and the existing JEST_WORKER_ID-guarded poller-start block in src/server.ts"
provides:
  - "src/scheduler/reminders.ts: runReminderSweep()/startReminderPoller(intervalMs?) -- the DST-safe 24h/1h client reminder sweep"
  - "src/server.ts now starts the reminder poller at boot -- the 4th and final Phase 3 poller"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DST-safe reminder timing: all time comparisons use calendarDaysBetween (noon-UTC-anchor) + wall-clock minutesSinceMidnight arithmetic -- never raw Date.getTime() subtraction between reminder trigger and appointment instants"
    - "D-14 permanent eligibility gate: hadAtLeastHoursMarginAtBookingTime() is a pure function of booking.createdAt (immutable), evaluated once per booking, produces the same result forever -- no catch-up sends"
    - "Independent 24h/1h if-blocks: both reminder types checked independently (not else-if), so a booking simultaneously eligible for both still gets each exactly once"
    - "jest.setSystemTime() for Date control in tests: avoids the recursive stack-overflow that jest.spyOn(global, Date) causes when the mock itself calls new Date(arg)"

key-files:
  created:
    - src/scheduler/reminders.ts
    - tests/scheduler-reminders.test.ts
  modified:
    - src/server.ts

key-decisions:
  - "15-minute default poller interval (D-10, locked -- not discretionary unlike the agenda poller's D-09 discretion)"
  - "minutesUntilAppointment() handles the late-night edge case (01:00 appointment, 01:05 now) correctly because calendarDate comparison happens first: same Athens calendar day means apptTimeMin - nowTimeMin = -5, correctly negative (past)"
  - "jest.setSystemTime() chosen over jest.spyOn(global, Date) for Date control in tests -- the spyOn approach caused Maximum call stack size exceeded because new Date(arg) inside the mock recursively triggered the mock itself (auto-fix Rule 1)"

patterns-established:
  - "Fourth in-process poller (after expiry-poller.ts, calendar/poller.ts, scheduler/agenda.ts) using identical per-business try/catch + setInterval wrapper shape -- the codebase's standard for all Phase 3 background jobs is now fully established"

requirements-completed: [NOTF-01]

coverage:
  - id: D1
    description: "DST-safe 24h/1h reminder sweep: each confirmed booking's client receives both reminders exactly once; D-14 gate permanently skips a reminder whose window had elapsed at booking creation time; late-night appointments correctly identified as past once calendarDate matches and clock-time difference is negative"
    requirement: "NOTF-01"
    verification:
      - kind: unit
        ref: "tests/scheduler-reminders.test.ts (11 tests: Tests 1/1b, 2, 3, 4/4b, 5, 6, 7, 8a/8b)"
        status: pass
    human_judgment: false
  - id: D2
    description: "startReminderPoller: in-process setInterval wrapper (15-minute default, D-10 locked) wired into src/server.ts's existing JEST_WORKER_ID-guarded boot block alongside the other 3 Phase 3 pollers"
    requirement: "NOTF-01"
    verification:
      - kind: unit
        ref: "tests/scheduler-reminders.test.ts (Tests 8a/8b)"
        status: pass
      - kind: integration
        ref: "npx tsc --noEmit && npm test (full 25-suite/205-test regression suite)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Real Telegram delivery of 1h-prior reminder to a live client account, and true once-per-reminder idempotency against a real confirmed booking within the reminder window"
    human_judgment: true
    rationale: "Requires a live Telegram delivery and a real confirmed booking within the 1h window -- not mockable in CI. This is the last of ROADMAP.md Phase 3's 4 success criteria (SC3 reminders, SC4 DST/late-night) to confirm end-to-end. Exercise by calling runReminderSweep() directly via a local script with a fixture booking ~50min in the future."

# Metrics
duration: 5min
completed: 2026-07-09
status: complete
---

# Phase 3 Plan 5: Client Appointment Reminders Summary

**DST-safe 24h/1h Telegram reminder sweep with permanent D-14 eligibility gates and noon-UTC-anchor calendar arithmetic, implemented as the 4th in-process Phase 3 poller alongside the expiry, calendar-sync, and agenda sweeps.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-09T11:11:33Z
- **Completed:** 2026-07-09T11:16:58Z
- **Tasks:** 2 completed (TDD Task 1: RED + GREEN, Task 2: wire)
- **Files modified:** 3 (1 new source file, 1 new+updated test file, 1 modified source file)

## Accomplishments
- `src/scheduler/reminders.ts`: `runReminderSweep()`/`startReminderPoller(intervalMs?)` with 5 internal helpers (`minutesSinceMidnight`, `athensWallClockTime`, `calendarDaysBetween`, `hadAtLeastHoursMarginAtBookingTime`, `minutesUntilAppointment`)
- DST correctness: all time arithmetic uses calendar-date strings and wall-clock minutes; the only `getTime()` subtraction is the noon-UTC-anchored `calendarDaysBetween` (mirrors `addCalendarDays`'s existing technique)
- D-14 gate permanently skips reminders for bookings made too close to their appointment: computed once from `booking.createdAt` (immutable), invariant to when the sweep runs
- Late-night edge case correct: `minutesUntilAppointment` compares `calendarDate === todayIso` first, so a 01:00 appointment at 01:05 on the same Athens calendar day returns -5 (past), not +23h55m (misread as "tomorrow")
- `src/server.ts` now starts all 4 Phase 3 pollers in its `JEST_WORKER_ID` guard: `startExpiryPoller`, `startCalendarSyncPoller`, `startAgendaPoller`, `startReminderPoller`
- Zero regressions across the full 25-suite/205-test codebase

## Task Commits

Each task was committed atomically (TDD Task 1: RED → GREEN):

1. **Task 1: DST-safe 24h/1h reminder sweep** - RED `880edb5` (test) → GREEN `60876a3` (feat)
2. **Task 2: Wire the reminder poller into server startup** - `290fa16` (feat)

## Files Created/Modified
- `src/scheduler/reminders.ts` - New: `runReminderSweep`/`startReminderPoller` (exported), 5 internal DST-safe helpers
- `tests/scheduler-reminders.test.ts` - New: 11 tests covering all behavior cases from the plan
- `src/server.ts` - Added `startReminderPoller` import and call inside the existing `JEST_WORKER_ID`-guarded poller-start block

## Decisions Made
- 15-minute default poller interval (D-10, locked — not discretionary unlike the agenda poller's 10-minute D-09 discretion)
- `minutesUntilAppointment` handles the late-night edge case by comparing `calendarDate === todayIso` first, so same-day appointments are always correctly evaluated in terms of wall-clock minutes remaining/elapsed on that day
- `jest.setSystemTime()` used for Date control in tests (not `jest.spyOn(global, Date)`) — see Deviations below

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `jest.spyOn(global, Date)` caused recursive Maximum call stack size exceeded**
- **Found during:** Task 1 GREEN-phase first test run
- **Issue:** The test file initially used `jest.spyOn(global, 'Date').mockImplementation((arg) => { if (!arg) return fakeNow; return new Date(arg); })` to freeze `new Date()` to a known instant. When the mock implementation called `new (Date as any)(arg)`, it recursively triggered the same mock (since `Date` is now the mock), causing an unbounded call stack explosion in every test that set a fake "now".
- **Fix:** Replaced all `jest.spyOn(global, 'Date').mockImplementation(...)` / `jest.restoreAllMocks()` pairs with `jest.setSystemTime(fakeNow)` inside a `jest.useFakeTimers()` / `jest.useRealTimers()` beforeEach/afterEach block. `jest.setSystemTime` is the correct Jest API for controlling `new Date()` without patching the constructor.
- **Files modified:** `tests/scheduler-reminders.test.ts`
- **Commit:** `60876a3` (included in GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 test-tooling bug in the RED commit's test approach)
**Impact on plan:** No scope changes — all 11 behavior test cases from the plan's `<behavior>` block are present and passing. The fix is purely an internal test-authoring correction; the production implementation in `src/scheduler/reminders.ts` was unchanged.

## Issues Encountered
None beyond the auto-fixed deviation above.

## User Setup Required
None - no new credentials or external service configuration required. The reminder poller reuses the existing Telegram bot token (Phase 2) and the query layer (Plan 03-01). The `human-check` in Task 2 (live Telegram delivery confirmation) requires a fixture business with a confirmed booking within the 60-minute window and can be exercised by calling `runReminderSweep()` directly via a local script.

## Next Phase Readiness
- All 4 Phase 3 pollers are live in the running system: expiry, calendar-sync, agenda, reminders
- Phase 3's ROADMAP Success Criteria 3 (client reminders) and SC4 (DST/late-night correctness) are implemented and unit-tested
- The two Phase 3 human-checks (Plan 03-04's daily agenda live delivery + Plan 03-05's 1h reminder live delivery) are the only remaining confirmations before Phase 3 can be closed
- Plan 03-03 (Google Calendar OAuth setup) remains blocked on human action (OAuth flow) — its status is unchanged by this plan

---
*Phase: 03-calendar-sync-agenda-reminders*
*Completed: 2026-07-09*
