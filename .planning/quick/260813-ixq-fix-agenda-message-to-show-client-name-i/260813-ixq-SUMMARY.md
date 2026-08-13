---
phase: quick-260813-ixq
plan: 01
subsystem: telegram-bot
tags: [agenda, client-identification, telegram]

requires:
  - phase: quick-260813-g86
    provides: runAgendaSweep/showTodaysAgenda both passing ['confirmed', 'pending_owner_approval'] to listBookingsForDate
provides:
  - formatAgendaMessage now resolves and displays the client's registered display name instead of the raw clientPhone/Telegram id on every agenda line
affects: [scheduler/agenda, telegram/handlers/admin-menu]

tech-stack:
  added: []
  patterns:
    - "clientNamesByPhone map built via a per-unique-clientPhone findClientBusinessRelationship lookup loop, mirroring the existing serviceNamesById pattern"

key-files:
  created: []
  modified:
    - src/scheduler/agenda.ts
    - src/telegram/handlers/admin-menu.ts
    - tests/calendar-agenda-reminder-queries.test.ts

key-decisions:
  - "formatAgendaMessage's third parameter is a required Map<string, string>, not optional — both call sites already build it unconditionally before calling formatAgendaMessage, so there is no partial-caller case to support."

patterns-established:
  - "rel?.clientName ?? clientPhone fallback pattern reused verbatim from admin-menu.ts's existing rel.clientName ?? rel.senderPhone convention"

requirements-completed: []

coverage:
  - id: D1
    description: "Agenda lines (both the 08:00 auto-push via runAgendaSweep and the on-demand /agenda menu via showTodaysAgenda) display the resolved client display name instead of the raw clientPhone/Telegram id"
    verification:
      - kind: unit
        ref: "tests/calendar-agenda-reminder-queries.test.ts#shows resolved client name when a clientBusinessRelationship with clientName exists"
        status: pass
    human_judgment: false
  - id: D2
    description: "Bookings with no matching clientBusinessRelationship (or no clientName) still render the raw clientPhone, never blank/undefined"
    verification:
      - kind: unit
        ref: "tests/calendar-agenda-reminder-queries.test.ts#falls back to the raw phone when no clientBusinessRelationship exists"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-08-13
status: complete
---

# Quick Task 260813-ixq: Resolve client name in agenda messages Summary

**Both the 08:00 auto-push agenda and the on-demand /agenda command now show the client's registered display name (via `findClientBusinessRelationship`) instead of the raw `clientPhone` Telegram id, with a raw-phone fallback when no relationship/name exists.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-08-13T00:00:00Z (approx, not recorded precisely)
- **Completed:** 2026-08-13
- **Tasks:** 2 completed
- **Files modified:** 3

## Accomplishments
- `formatAgendaMessage` now accepts a third `clientNamesByPhone: Map<string, string>` parameter and uses `clientNamesByPhone.get(booking.clientPhone) ?? booking.clientPhone` when building each agenda line.
- `runAgendaSweep` (08:00 auto-push) builds a `clientNamesByPhone` map with one `findClientBusinessRelationship` lookup per unique `booking.clientPhone`, mirroring its existing `serviceNamesById` loop.
- `showTodaysAgenda` (on-demand `/agenda`) builds the identical map and passes it through, mirroring `runAgendaSweep`'s pattern and the codebase's established `rel.clientName ?? rel.senderPhone` fallback convention.
- Added two regression tests proving the resolved-name case and the no-relationship fallback case.

## Task Commits

1. **Task 1: Thread a resolved clientNamesByPhone map through formatAgendaMessage in both call sites** - `8b74373` (feat)
2. **Task 2: Add regression tests for resolved-name display and phone fallback** - `c8b6fd4` (test)

## Files Created/Modified
- `src/scheduler/agenda.ts` - `formatAgendaMessage` gained a third `clientNamesByPhone` param; `runAgendaSweep` builds the map via `findClientBusinessRelationship` before calling it.
- `src/telegram/handlers/admin-menu.ts` - `showTodaysAgenda` builds the same map and passes it through, mirroring the mirrored `serviceNamesById` loop already present.
- `tests/calendar-agenda-reminder-queries.test.ts` - Two new isolated-module tests: resolved-name display and raw-phone fallback.

## Decisions Made
None beyond what the plan specified — plan executed as written.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. `npx tsc --noEmit` reported zero errors after both call sites were updated; the pre-existing Test 8 in the same describe block continued to pass unmodified (it does not assert on message content, only on `listBookingsForDate`'s call arguments, so it was unaffected by the new `findClientBusinessRelationship` dependency).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

No blockers. This is a standalone quick-task fix; no follow-on phase depends on it directly.

---
*Phase: quick-260813-ixq*
*Completed: 2026-08-13*

## Self-Check: PASSED

- FOUND: src/scheduler/agenda.ts
- FOUND: src/telegram/handlers/admin-menu.ts
- FOUND: tests/calendar-agenda-reminder-queries.test.ts
- FOUND commit: 8b74373
- FOUND commit: c8b6fd4
