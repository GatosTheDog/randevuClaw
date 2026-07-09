---
phase: 03-calendar-sync-agenda-reminders
plan: 1
subsystem: database
tags: [drizzle-orm, postgres, neon, typescript, jest]

# Dependency graph
requires:
  - phase: 02-ai-booking-conversations-owner-alerts
    provides: bookings/businesses base schema and query-layer conventions (Business/Booking interfaces, chain-builder mock style)
provides:
  - "5 additive Neon columns: businesses.googleRefreshToken, businesses.agendaSentDate, bookings.calendarSyncStatus, bookings.googleCalendarEventId, bookings.calendarSyncRetryCount, bookings.reminder24hSentAt, bookings.reminder1hSentAt"
  - "9 typed query functions for calendar-sync/agenda/reminder state, all consumed verbatim by Plans 03-02/03-04/03-05"
  - "atomic claim-based idempotency pattern (UPDATE...WHERE...RETURNING) for agenda and reminder sent-state guards"
affects: [03-02-calendar-sync, 03-04-daily-agenda, 03-05-client-reminders]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic claim query: UPDATE...WHERE eligibility-guard...RETURNING, `rows.length > 0` as the sole concurrency check (no read-then-write gap) — used by claimAgendaSlot/claimReminder24hSlot/claimReminder1hSlot"

key-files:
  created:
    - tests/calendar-agenda-reminder-queries.test.ts
    - migrations/0002_silent_ben_urich.sql
  modified:
    - src/database/schema.ts
    - src/database/queries.ts

key-decisions:
  - "D-06/D-11/D-16 column shapes implemented exactly as specified in 03-CONTEXT.md and this plan's <interfaces> contract"
  - "Applied migration 0002 to both the live Neon DB (drizzle-kit push) and the local randevuclaw_test Postgres DB used by tests/booking-queries.test.ts, keeping the two schemas in parity"

patterns-established:
  - "Pattern: atomic claim functions (claimAgendaSlot, claimReminder24hSlot, claimReminder1hSlot) return boolean success from `returning().length > 0`, never a separate SELECT-then-UPDATE — the pattern every future sent-state idempotency guard in this codebase should follow"

requirements-completed: [OWNR-04, OWNR-03, NOTF-01]

coverage:
  - id: D1
    description: "businesses/bookings tables extended with 5 additive Phase 3 columns (Google OAuth token storage, calendar-sync status/retry tracking, agenda/reminder sent-state) on the live Neon database"
    requirement: "OWNR-04"
    verification:
      - kind: integration
        ref: "npx drizzle-kit generate && npx drizzle-kit push (migration 0002_silent_ben_urich.sql applied to live Neon DB)"
        status: pass
      - kind: integration
        ref: "tests/booking-queries.test.ts (real-Postgres integration suite against local randevuclaw_test DB, migration 0002 applied)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Typed query layer (9 functions) for calendar-sync, agenda, and reminder state, including atomic claim-based idempotency guards for concurrent poller runs"
    requirement: "NOTF-01"
    verification:
      - kind: unit
        ref: "tests/calendar-agenda-reminder-queries.test.ts (8 tests covering claimAgendaSlot, claimReminder24hSlot, claimReminder1hSlot, incrementCalendarSyncRetryCount, findBookingsNeedingCalendarSync, listBookingsForDate, findBookingsNeedingReminder)"
        status: pass
    human_judgment: false

duration: 7min
completed: 2026-07-09
status: complete
---

# Phase 3 Plan 1: Calendar-Sync/Agenda/Reminder Data Substrate Summary

**5 additive Neon columns (Google OAuth token, calendar-sync status/retry, agenda/reminder sent-state) plus a 9-function typed query layer with atomic UPDATE...WHERE...RETURNING claim guards preventing double-send/double-sync races.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-07-09T11:29:00+03:00
- **Completed:** 2026-07-09T11:36:00+03:00
- **Tasks:** 2 completed
- **Files modified:** 10 (2 modified source files, 1 new test file, 2 new migration artifacts, 5 pre-existing test fixture files patched for interface compatibility)

## Accomplishments
- Extended `businesses`/`bookings` schema with the exact 5 columns this plan's `<interfaces>` contract specifies, pushed live to Neon via `drizzle-kit push`
- Implemented the full 9-function typed query surface (`updateBusinessGoogleRefreshToken`, `claimAgendaSlot`, `updateCalendarSyncStatus`, `updateBookingGoogleEventId`, `incrementCalendarSyncRetryCount`, `findBookingsNeedingCalendarSync`, `listBookingsForDate`, `findBookingsNeedingReminder`, `claimReminder24hSlot`, `claimReminder1hSlot`)
- Closed RESEARCH.md Pitfalls 3 (reminder idempotency bypass) and 5 (agenda sent multiple times) with atomic `UPDATE...WHERE...RETURNING` claim functions — no read-then-write gap
- Zero regressions across the full 19-suite/155-test codebase

## Task Commits

Each task was committed atomically:

1. **Task 1: Phase 3 schema extension and live schema push** - `ac37af4` (feat)
2. **Task 2: Typed query layer (TDD)** - RED `5a815cf` (test) → GREEN `039bb82` (feat)

**Plan metadata:** commit pending (docs: complete plan)

_Note: TDD Task 2 has two commits (test → feat), no refactor commit needed — implementation matched the plan's action block exactly._

## Files Created/Modified
- `src/database/schema.ts` - Extended `businesses` (googleRefreshToken, agendaSentDate) and `bookings` (calendarSyncStatus, googleCalendarEventId, calendarSyncRetryCount, reminder24hSentAt, reminder1hSentAt)
- `src/database/queries.ts` - Extended `Business`/`Booking` interfaces; added the 9 new Phase 3 query functions
- `tests/calendar-agenda-reminder-queries.test.ts` - New: 8 tests (chain-builder mock style matching `tests/fixtures.test.ts`) covering all 7 behavior cases from the plan
- `migrations/0002_silent_ben_urich.sql` - New: additive-only ALTER TABLE statements for the 5 new columns
- `tests/ai-agent.test.ts`, `tests/consent.test.ts`, `tests/conversation-router.test.ts`, `tests/expiry-poller.test.ts`, `tests/function-executor.test.ts`, `tests/idempotency.test.ts`, `tests/telegram-webhook.test.ts`, `tests/webhook.test.ts` - Patched pre-existing Business/Booking object literals with the new required fields (neutral defaults) so the interface extension didn't break their type-checking

## Decisions Made
- Applied migration 0002 to the local `randevuclaw_test` Postgres database (used by `tests/booking-queries.test.ts`'s real-DB integration suite) in addition to the live Neon DB, keeping both schemas in parity — this database's existence and role is documented in that test file's own header comment
- No new npm packages installed this plan (schema/query work only, per this plan's threat model T-03-SC)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Local test-DB schema drift blocking `tests/booking-queries.test.ts`**
- **Found during:** Task 1 verification (full regression test run)
- **Issue:** `tests/booking-queries.test.ts` runs against a real local Postgres DB (`randevuclaw_test`) with migrations applied separately from the live Neon DB (per that file's own header comment). After pushing migration 0002 to Neon, the local test DB was still on the pre-Phase-3 schema, so `INSERT INTO businesses` failed with `column "google_refresh_token" does not exist`.
- **Fix:** Applied `migrations/0002_silent_ben_urich.sql` directly to the local `randevuclaw_test` DB via `psql`.
- **Files modified:** None (DB-only change, no repo files touched)
- **Verification:** Full regression suite (95 tests across 13 suites) passed after the fix
- **Committed in:** N/A (external DB state, not a repo artifact)

**2. [Rule 1 - Bug] Pre-existing test fixtures broke type-checking after Business/Booking interface extension**
- **Found during:** Task 2 GREEN-phase verification (full `npx jest` run)
- **Issue:** Extending `Business`/`Booking` with new non-optional fields (per this plan's `<interfaces>` contract) broke `ts-jest` compilation in 8 pre-existing test files that construct full `Business`/`Booking` object literals without the new fields (`ai-agent.test.ts`, `consent.test.ts`, `conversation-router.test.ts`, `expiry-poller.test.ts`, `function-executor.test.ts`, `idempotency.test.ts`, `telegram-webhook.test.ts`, `webhook.test.ts`). `npx tsc --noEmit` alone didn't catch this since `tsconfig.json` excludes `tests/`.
- **Fix:** Added the new fields with neutral defaults (`googleRefreshToken: null`, `agendaSentDate: null` for Business fixtures; `calendarSyncStatus: 'pending'`, `googleCalendarEventId: null`, `calendarSyncRetryCount: 0`, `reminder24hSentAt: null`, `reminder1hSentAt: null` for Booking fixtures) to each affected fixture. No test assertions or behavior changed.
- **Files modified:** `tests/ai-agent.test.ts`, `tests/consent.test.ts`, `tests/conversation-router.test.ts`, `tests/expiry-poller.test.ts`, `tests/function-executor.test.ts`, `tests/idempotency.test.ts`, `tests/telegram-webhook.test.ts`, `tests/webhook.test.ts`
- **Verification:** Full `npx jest` run — 19 suites, 155 tests, all passing
- **Committed in:** `039bb82` (part of Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1 blocking test-infra fix, 1 bug fix to pre-existing fixtures)
**Impact on plan:** Both fixes were necessary consequences of this plan's own schema/interface changes reaching pre-existing test infrastructure. No scope creep — no unrelated files touched, no behavior changes to existing tests.

## Issues Encountered
None beyond the two auto-fixed deviations above.

## User Setup Required
None - no external service configuration required. (Google Calendar OAuth setup is Plan 03-02's concern, not this plan's.)

## Next Phase Readiness
- The full typed query surface Plans 03-02 (calendar sync), 03-04 (daily agenda), and 03-05 (client reminders) depend on now exists and is idempotency-correct under concurrent/overlapping poller runs
- Live Neon schema and local `randevuclaw_test` schema are both in parity with `src/database/schema.ts`
- No blockers for Wave 2 plans

---
*Phase: 03-calendar-sync-agenda-reminders*
*Completed: 2026-07-09*
