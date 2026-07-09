---
phase: 03-calendar-sync-agenda-reminders
plan: 4
subsystem: scheduler
tags: [in-process-poller, telegram, timezone, typescript, jest]

# Dependency graph
requires:
  - phase: 03-calendar-sync-agenda-reminders (Plan 03-01)
    provides: "listAllBusinessIds/findBusinessById/listBookingsForDate/claimAgendaSlot/findServiceById query layer with the atomic UPDATE...WHERE...RETURNING claimAgendaSlot idempotency guard"
  - phase: 03-calendar-sync-agenda-reminders (Plan 03-02)
    provides: "in-process poller precedent (expiry-poller.ts/calendar/poller.ts shape) and the existing JEST_WORKER_ID-guarded poller-start block in src/server.ts"
provides:
  - "src/scheduler/agenda.ts: runAgendaSweep()/startAgendaPoller(intervalMs?) -- the daily 8am-Athens owner agenda sweep"
  - "src/server.ts now starts the agenda poller at boot alongside the expiry and calendar-sync pollers"
affects: [03-05-client-reminders]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-before-claim ordering: listBookingsForDate (cheap read, skip-if-empty) runs BEFORE claimAgendaSlot (the atomic claim), which runs BEFORE the outbound Telegram send -- a lost claim race means no message is ever sent, never a duplicate"

key-files:
  created:
    - src/scheduler/agenda.ts
    - tests/scheduler-agenda.test.ts
  modified:
    - src/server.ts

key-decisions:
  - "10-minute default poller interval (D-09 discretion), matching the plan's stated frequent-enough/cheap-enough-to-run-continuously rationale"
  - "formatAgendaMessage kept non-exported (internal helper only), matching the plan's <interfaces> contract which lists only runAgendaSweep/startAgendaPoller as the public surface"

patterns-established:
  - "Third in-process poller (after expiry-poller.ts and calendar/poller.ts) using the identical per-business try/catch + setInterval wrapper shape -- confirms this is now the codebase's standard shape for any future Phase 3 poller (e.g. 03-05's reminder sweep)"

requirements-completed: [OWNR-03]

coverage:
  - id: D1
    description: "Daily agenda sweep (runAgendaSweep): every business with today's confirmed appointments and a configured ownerTelegramId gets exactly one Greek-language Telegram summary; businesses with zero appointments or no owner contact are skipped with no calls to claimAgendaSlot/sendTelegramMessage; claimAgendaSlot is always called after confirming bookings exist and strictly before the Telegram send, so a lost claim race never produces a duplicate send; a single business's query failure is isolated and logged, never blocking the rest of the sweep"
    requirement: "OWNR-03"
    verification:
      - kind: unit
        ref: "tests/scheduler-agenda.test.ts (Tests 1-6)"
        status: pass
    human_judgment: false
  - id: D2
    description: "startAgendaPoller: in-process setInterval wrapper (10-minute default, matching D-09) that repeatedly invokes runAgendaSweep and stops cleanly on clearInterval; wired into src/server.ts's existing JEST_WORKER_ID-guarded boot block alongside startExpiryPoller/startCalendarSyncPoller"
    requirement: "OWNR-03"
    verification:
      - kind: unit
        ref: "tests/scheduler-agenda.test.ts (Tests 7-8)"
        status: pass
      - kind: integration
        ref: "npx tsc --noEmit && npm test (full 24-suite/194-test regression suite)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Real Telegram delivery of the daily agenda to a live owner account, and true once-per-day idempotency against a real confirmed booking for 'today'"
    human_judgment: true
    rationale: "Requires a live Telegram bot delivery and a real confirmed booking dated 'today' in Athens local time -- not mockable in CI. This plan's own tasks are fully autonomous (no checkpoint task); the plan's Task 2 <verify> block documents this as a human-check for whoever runs the live poller against a fixture business."

# Metrics
duration: 3min
completed: 2026-07-09
status: complete
---

# Phase 3 Plan 4: Daily Agenda Summary

**In-process 10-minute poller sending a Greek daily Telegram agenda to each business owner once per Athens calendar day, guarded by Plan 03-01's atomic `claimAgendaSlot` and DST-safe `isoDateInAthens` date arithmetic.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-09T12:04:36+03:00
- **Completed:** 2026-07-09T12:06:45+03:00
- **Tasks:** 2 completed
- **Files modified:** 3 (1 new source file, 1 new test file, 1 modified source file)

## Accomplishments
- `src/scheduler/agenda.ts`: `runAgendaSweep()`/`startAgendaPoller(intervalMs?)` -- for each business with a confirmed booking today and a configured `ownerTelegramId`, composes a Greek-language summary (`"Η ατζέντα σας για σήμερα:"` header + one `"<time> - <service> (<phone>)"` line per booking) and sends it once via `sendTelegramMessage`
- Idempotency ordering locked in by test assertion: `listBookingsForDate` (skip if empty) → `claimAgendaSlot` (atomic claim) → `sendTelegramMessage`, so a lost claim race never double-sends
- `src/server.ts` now starts the agenda poller at boot alongside the expiry and calendar-sync pollers, zero new infrastructure
- Zero regressions across the full 24-suite/194-test codebase; the pre-existing "worker process has failed to exit gracefully" Jest warning was confirmed (via `git stash`) to predate this plan's changes, not caused by it

## Task Commits

Each task was committed atomically (TDD Task 1: test → feat):

1. **Task 1: Daily agenda sweep with atomic once-per-day guard** - RED `549943e` (test) → GREEN `6355e2a` (feat)
2. **Task 2: Wire the agenda poller into server startup** - `345fc0e` (feat)

**Plan metadata:** commit pending (docs: complete plan)

_Note: No refactor commit needed for Task 1 -- implementation matched the plan's action block exactly and all 8 behavior tests passed on the first GREEN attempt._

## Files Created/Modified
- `src/scheduler/agenda.ts` - New: `runAgendaSweep`/`startAgendaPoller` (exported), `formatAgendaMessage` (internal)
- `tests/scheduler-agenda.test.ts` - New: 8 tests covering all behavior cases from the plan (business gating, empty-agenda no-spam, claim-before-send ordering, claim-lost no-send, error isolation, poller interval scheduling/default)
- `src/server.ts` - Added `startAgendaPoller` import and call inside the existing `JEST_WORKER_ID`-guarded poller-start block

## Decisions Made
- 10-minute default poller interval, matching the plan's D-09 discretion rationale (frequent enough to land within 10 minutes of 8am Athens time, cheap enough to run continuously)
- `formatAgendaMessage` kept as a non-exported internal helper, exactly matching the plan's `<interfaces>` contract which only commits to `runAgendaSweep`/`startAgendaPoller` as the public surface

## Deviations from Plan

None - plan executed exactly as written. Both tasks' `<action>` blocks were implemented verbatim, including the exact ordering (`listBookingsForDate` before `claimAgendaSlot` before `sendTelegramMessage`) and the Greek message format.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. This plan reuses the existing Telegram bot token and the OAuth/refresh-token state already configured by Plan 03-02/03-03; the agenda poller itself needs no new credentials.

## Next Phase Readiness
- `src/scheduler/agenda.ts`'s `runAgendaSweep`/`startAgendaPoller` exports are the stable, tested contract; no other plan depends on internals beyond these two
- The poller is running at boot; once a business has both `ownerTelegramId` set and a confirmed booking for "today" (Athens), the next 10-minute tick delivers the agenda automatically
- Plan 03-04's Task 2 `<human-check>` (live Telegram delivery + true once-per-day idempotency against a real confirmed booking) is still outstanding and should be exercised alongside Plan 03-05's own human-check when both are live against a real business
- No blockers for Plan 03-05 (client reminders), which follows the same in-process-poller pattern this plan and Plan 03-02 established

---
*Phase: 03-calendar-sync-agenda-reminders*
*Completed: 2026-07-09*
