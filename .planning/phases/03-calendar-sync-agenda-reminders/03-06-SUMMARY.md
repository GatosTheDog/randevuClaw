---
phase: 03-calendar-sync-agenda-reminders
plan: 6
subsystem: scheduler
tags: [gap-closure, agenda, reminders, oauth, logger, ownr-03, notf-01]
status: complete

dependency_graph:
  requires: [03-01, 03-02, 03-03, 03-04, 03-05]
  provides: [OWNR-03-truth, NOTF-01-truth, CR-02-fix, WR-02-fix]
  affects: [src/scheduler/agenda.ts, src/scheduler/reminders.ts, scripts/setup-google-calendar.ts, src/utils/logger.ts]

tech_stack:
  added: []
  patterns:
    - Athens-time threshold gate using athensWallClockTime + minutesSinceMidnight before any DB call
    - dayLabel computed from Athens-local ISO date comparison (booking.calendarDate vs todayIso)
    - OAuth callback pathname guard before CSRF state check to absorb auxiliary browser requests
    - Pino redact.paths extended with googleRefreshToken and *.googleRefreshToken

key_files:
  created: []
  modified:
    - src/scheduler/agenda.ts
    - tests/scheduler-agenda.test.ts
    - src/scheduler/reminders.ts
    - tests/scheduler-reminders.test.ts
    - scripts/setup-google-calendar.ts
    - src/utils/logger.ts

decisions:
  - AGENDA_HOUR_THRESHOLD constant exported so tests can import and assert the value without hardcoding 8
  - dayLabel placed before claimReminder24hSlot call so the correct word is chosen atomically with the send
  - Pathname guard returns 204 (not 400) for non-callback requests to avoid alarming browser devtools
  - googleRefreshToken added to both bare and wildcard (*.googleRefreshToken) forms matching the existing redact pattern

metrics:
  duration: "~4 minutes"
  completed: 2026-07-09T13:28:03Z
  tasks_completed: 2
  tasks_total: 2
  files_modified: 6
  tests_added: 3
  tests_total_after: 208
---

# Phase 03 Plan 06: Gap Closure — 8am Gate, Day Label, OAuth Guard, Logger Redact

One-liner: Closed two BLOCKER gaps (OWNR-03 agenda 8am threshold, NOTF-01 same-day reminder label) and two WARNINGs (CR-02 OAuth favicon crash, WR-02 pino redact missing googleRefreshToken), advancing Phase 3 verification score from 5/7 to 7/7.

## What Was Built

### Task 1 — 8am Athens-time threshold gate in runAgendaSweep (OWNR-03 / D-09)

**src/scheduler/agenda.ts:**
- Added `AGENDA_HOUR_THRESHOLD = 8` exported constant
- Added module-private `minutesSinceMidnight(time: string): number` and `athensWallClockTime(date: Date): string` helpers (identical pattern to reminders.ts — duplicated as module-private per plan constraint against adding new shared files)
- `runAgendaSweep()` now begins with `const nowAthens = athensWallClockTime(new Date()); if (minutesSinceMidnight(nowAthens) < AGENDA_HOUR_THRESHOLD * 60) return 0;` — this fires before any DB call, so `claimAgendaSlot` is never called during the pre-08:00 bailout

**tests/scheduler-agenda.test.ts:**
- Test 7: runAgendaSweep at 02:30 UTC (05:30 Athens) sends nothing and never calls claimAgendaSlot
- Test 7b: runAgendaSweep at 05:00 UTC (08:00 Athens) proceeds normally, sends and claims

### Task 2 — Day label fix, OAuth pathname guard, pino redact (NOTF-01, CR-02, WR-02)

**src/scheduler/reminders.ts:**
- Added `const dayLabel = booking.calendarDate === todayIso ? 'σήμερα' : 'αύριο';` before `claimReminder24hSlot`
- The sendTelegramMessage call now uses `dayLabel` in the template string instead of the hardcoded literal "αύριο"

**tests/scheduler-reminders.test.ts:**
- Test 9: same-day booking (calendarDate = todayIso at 07:00 Athens, appointment 22:00 same day) produces a 24h reminder message matching /σήμερα/ and not matching /αύριο/

**scripts/setup-google-calendar.ts:**
- Pathname guard added as the first statement after requestUrl parsing: requests whose pathname does not match the configured OAuth redirect URI receive 204 and return without closing the server or entering the CSRF check

**src/utils/logger.ts:**
- Added `'googleRefreshToken'` and `'*.googleRefreshToken'` to redact.paths array

## Verification Results

```
npx tsc --noEmit            — exit 0 (zero TypeScript errors)
npm test                    — 208 tests passed, 0 failed, 25 suites
scheduler-agenda suite      — 10 tests (including new Test 7, Test 7b)
scheduler-reminders suite   — 12 tests (including new Test 9)
```

Source assertions:
- `grep -c 'AGENDA_HOUR_THRESHOLD' src/scheduler/agenda.ts` → 3 (>= 2) ✓
- `grep -c 'dayLabel' src/scheduler/reminders.ts` → 2 (>= 2) ✓
- `grep -c 'googleRefreshToken' src/utils/logger.ts` → 2 (>= 1) ✓
- pathname guard (line 55) appears before CSRF receivedState check (line 64) ✓

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The OAuth pathname guard (T-03-15) and logger redact extension (T-03-14) close the STRIDE threats listed in the plan's threat model. No new threats identified.

## Self-Check: PASSED

Files created/modified:
- [FOUND] src/scheduler/agenda.ts
- [FOUND] src/scheduler/reminders.ts
- [FOUND] scripts/setup-google-calendar.ts
- [FOUND] src/utils/logger.ts
- [FOUND] tests/scheduler-agenda.test.ts
- [FOUND] tests/scheduler-reminders.test.ts

Commits:
- fe7ece2: feat(03-06): add 8am Athens-time threshold gate to runAgendaSweep (OWNR-03)
- 71d373a: fix(03-06): fix 24h reminder day label, OAuth pathname guard, and logger redact (CR-01, CR-02, WR-02)
