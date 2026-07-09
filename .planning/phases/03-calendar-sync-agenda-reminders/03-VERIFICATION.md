---
phase: 03-calendar-sync-agenda-reminders
verified: 2026-07-09T16:00:00Z
status: human_needed
score: 7/7
behavior_unverified: 1
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 5/7
  gaps_closed:
    - "OWNR-03 truth: runAgendaSweep now checks AGENDA_HOUR_THRESHOLD (= 8) via minutesSinceMidnight(athensWallClockTime(now)) < 8 * 60 before any DB call; claimAgendaSlot is never called during the pre-08:00 window. New Test 7 and Test 7b both pass."
    - "NOTF-01 truth: 24h reminder text now computes dayLabel = booking.calendarDate === todayIso ? 'σήμερα' : 'αύριο' before claimReminder24hSlot; hardcoded 'αύριο' is gone. New Test 9 (same-day path) passes and asserts message matches /σήμερα/ not /αύριο/."
  gaps_remaining: []
  regressions: []
behavior_unverified_items:
  - truth: "A confirmed booking automatically creates an event on the owner's Google Calendar; cancelling or rescheduling updates or removes that event without any manual action (ROADMAP SC1)"
    test: "Trigger a booking confirmation (owner taps Αποδοχή in Telegram), then cancel it; check the business owner's actual Google Calendar."
    expected: "An event titled '<service> — Client <phone>' appears on confirmation; it is removed on cancellation. No manual action required."
    why_human: "Requires a real Google account with a non-null googleRefreshToken for at least one fixture business (03-03-PLAN.md human checkpoint was deferred — OAuth tokens not provisioned). The code path is fully wired and unit-tested but cannot be behaviorally confirmed without a live credential."
human_verification:
  - test: "Complete the 03-03-PLAN.md OAuth consent-flow CLI for at least one fixture business (npm run setup-calendar -- --business-slug pilates-athens), then trigger a real booking confirmation (owner approves via Telegram), then check that business owner's Google Calendar."
    expected: "A new event appears titled '<service name> — Client <phone>' at the correct Europe/Athens date/time, with no attendee invited. Cancelling the booking removes the event within one poller cycle (5 minutes)."
    why_human: "Requires a real Google account and completed OAuth consent grant. GCP credentials were not available at phase execution time (03-03 was deferred). The CR-02 pathname guard fix is now in place, so the OAuth CLI flow should succeed once credentials are available."

  - test: "With a fixture business that has confirmed bookings for today, restart the server before 08:00 Athens time and observe that no agenda fires; then let the server run until the first poller tick at or after 08:00 and confirm the agenda fires exactly once."
    expected: "Agenda is not sent before 08:00 Athens time. On the first tick at or after 08:00 the agenda sends once. A second sweep later in the day sends nothing."
    why_human: "The 8am threshold is now in code (AGENDA_HOUR_THRESHOLD = 8, Test 7/7b pass), but an end-to-end live poller run against a real Telegram delivery is needed to confirm the timing gate works outside of mock time."

  - test: "With a fixture business having a confirmed booking for today (same-day, within 24h window), wait for or trigger the reminder sweep when minutesUntil <= 24*60 for that booking, then check the client's Telegram."
    expected: "Client receives a message containing 'σήμερα' (today), not 'αύριο' (tomorrow)."
    why_human: "The dayLabel fix is in code (Test 9 passes), but requires live Telegram delivery against a real same-day booking to confirm the correct Greek text is received."

  - test: "With a fixture business having a confirmed booking ~50 minutes in the future, call runReminderSweep() (or wait for the 15-minute tick). Check the client's Telegram. Call the sweep again immediately."
    expected: "Client receives exactly one Greek 1h-prior reminder; the second sweep does not duplicate it."
    why_human: "Requires live Telegram delivery and a real confirmed booking within the reminder window. Not mockable in CI."
---

# Phase 3: Calendar Sync, Agenda & Reminders Verification Report

**Phase Goal:** Calendar sync, daily agenda, and client reminders — every confirmed booking auto-syncs to the owner's Google Calendar; the owner gets a daily 8am Telegram agenda; clients get 24h and 1h Telegram reminders before their appointment.
**Verified:** 2026-07-09T16:00:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (03-06)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Confirmed booking creates a Google Calendar event; cancel/reschedule removes it (ROADMAP SC1) | PRESENT_BEHAVIOR_UNVERIFIED | syncBookingToCalendar/deleteBookingFromCalendar fully wired into telegram.ts approve branch and function-executor.ts cancelAppointmentTool; all unit tests pass; no real googleRefreshToken provisioned (03-03 deferred) — cannot observe against a real calendar |
| 2 | Google Calendar API failures never fail or roll back the booking itself (D-15) | VERIFIED | Both syncBookingToCalendar and deleteBookingFromCalendar are try/catch wrapped, return boolean, never rethrow; tests confirm false return on mock API failure; telegram.ts and function-executor.ts wrap Calendar calls in their own try/catch |
| 3 | Failed Calendar syncs are retried up to 10 times, then permanently marked 'failed' | VERIFIED | calendar/poller.ts: MAX_CALENDAR_SYNC_RETRIES = 10; runCalendarSyncSweep calls incrementCalendarSyncRetryCount and updateCalendarSyncStatus('failed') at exhaustion; tests confirm (calendar-poller.test.ts) |
| 4 | Owner receives daily agenda once Athens local time crosses 8am — exactly once per day per business | VERIFIED | src/scheduler/agenda.ts line 59: `if (minutesSinceMidnight(nowAthens) < AGENDA_HOUR_THRESHOLD * 60) return 0;` fires before any DB call. AGENDA_HOUR_THRESHOLD = 8 exported constant. Test 7 (02:30 UTC / 05:30 Athens) confirms no send and no claimAgendaSlot call. Test 7b (05:00 UTC / 08:00 Athens) confirms send proceeds normally. |
| 5 | Business with zero confirmed appointments receives no agenda that day | VERIFIED | listBookingsForDate returns []; `if (bookings.length === 0) continue;` skips claimAgendaSlot (scheduler-agenda.test.ts Test 3) |
| 6 | 24h/1h reminders sent exactly once per booking per threshold; DST-safe and late-night correct (ROADMAP SC4) | VERIFIED | Idempotency and DST arithmetic confirmed (all 12 scheduler-reminders tests pass). dayLabel fix: line 144 computes `const dayLabel = booking.calendarDate === todayIso ? 'σήμερα' : 'αύριο';` before claimReminder24hSlot — hardcoded 'αύριο' is gone. Test 9 (same-day path) passes: message matches /σήμερα/ and not /αύριο/. |
| 7 | Agenda and reminder timing computed via isoDateInAthens/addCalendarDays, not raw Date arithmetic — DST transitions never cause skipped or duplicated messages | VERIFIED | agenda.ts uses isoDateInAthens; reminders.ts uses calendarDaysBetween (noon-UTC-anchor), minutesSinceMidnight, athensWallClockTime — no raw getTime() subtraction between reminder trigger and appointment instants; hadAtLeastHoursMarginAtBookingTime is a pure function of immutable booking.createdAt |

**Score:** 7/7 truths verified (1 present, behavior-unverified; 6 verified by code inspection and passing tests)

### Deferred Items

None. All identified gaps are resolved or pending human verification only.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/database/schema.ts` | 5 new columns: googleRefreshToken, agendaSentDate, calendarSyncStatus, googleCalendarEventId, calendarSyncRetryCount, reminder24hSentAt, reminder1hSentAt | VERIFIED | All 7 column additions confirmed in source (businesses: 2, bookings: 5). Migration 0002_silent_ben_urich.sql matches. |
| `src/database/queries.ts` | 9 new Phase 3 functions exported | VERIFIED | All 9 confirmed: updateBusinessGoogleRefreshToken, claimAgendaSlot, updateCalendarSyncStatus, updateBookingGoogleEventId, incrementCalendarSyncRetryCount, findBookingsNeedingCalendarSync, listBookingsForDate, findBookingsNeedingReminder, claimReminder24hSlot, claimReminder1hSlot |
| `src/google/oauth.ts` | OAuth2 client construction, consent URL, code exchange, token persistence | VERIFIED | getOAuth2Client, getOAuth2AuthUrl, exchangeAuthCodeForTokens, storeGoogleRefreshToken all present; CSRF state round-trips into URL; rejects missing refresh_token |
| `src/calendar/sync.ts` | syncBookingToCalendar, deleteBookingFromCalendar, getCalendarClientForBusiness | VERIFIED | All 3 exports present; never throws; D-08 title format "service — Client phone"; Europe/Athens timezone; per-business OAuth client scope |
| `src/calendar/poller.ts` | runCalendarSyncSweep, startCalendarSyncPoller | VERIFIED | Both exports present; MAX_CALENDAR_SYNC_RETRIES = 10; per-business/per-booking error isolation |
| `src/scheduler/agenda.ts` | runAgendaSweep with 8am Athens gate, startAgendaPoller | VERIFIED | AGENDA_HOUR_THRESHOLD = 8 exported (line 17); minutesSinceMidnight + athensWallClockTime helpers present; early return at line 59 fires before any DB call; claimAgendaSlot correctly placed AFTER time gate and BEFORE send; Test 7 and Test 7b both pass. |
| `src/scheduler/reminders.ts` | runReminderSweep with correct dayLabel, startReminderPoller | VERIFIED | dayLabel computed at line 144 from booking.calendarDate === todayIso comparison; template at line 149 uses dayLabel — no hardcoded 'αύριο'; Test 9 (same-day path) passes and asserts /σήμερα/ and not /αύριο/. |
| `scripts/setup-google-calendar.ts` | CLI with parseBusinessSlugArg, CSRF-guarded loopback OAuth, pathname guard | VERIFIED | parseBusinessSlugArg exported; CSRF state generated and verified on callback; pathname guard (lines 55-59) checks requestUrl.pathname against googleRedirectUri.pathname before CSRF check — auxiliary browser requests receive 204 and do not close the server. |
| `src/utils/logger.ts` | googleRefreshToken in pino redact.paths | VERIFIED | Lines 12 and 13: 'googleRefreshToken' and '*.googleRefreshToken' present in redact.paths array, matching the bare and wildcard forms used for all other secrets. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/webhooks/telegram.ts` | `src/calendar/sync.ts` | syncBookingToCalendar called in callback_query approve branch, wrapped in try/catch | WIRED | Line 181: `if (service) await syncBookingToCalendar(updated, business, service);` inside try/catch |
| `src/conversation/function-executor.ts` | `src/calendar/sync.ts` | deleteBookingFromCalendar called after updateBookingStatus(...,'cancelled') | WIRED | Line 198-199: fetches full business row via findBusinessById, then calls deleteBookingFromCalendar |
| `src/calendar/poller.ts` | `src/database/queries.ts` | findBookingsNeedingCalendarSync is the sole source of retry candidates | WIRED | Line 30: `const pending = await findBookingsNeedingCalendarSync(businessId);` |
| `src/scheduler/agenda.ts` | `src/database/queries.ts` | claimAgendaSlot called BEFORE sendTelegramMessage and AFTER 8am gate | WIRED | Line 59: time gate; line 77: `const claimed = await claimAgendaSlot(businessId, todayIso);` — Test 7 confirms claimAgendaSlot is never reached before 08:00. |
| `src/server.ts` | `src/scheduler/agenda.ts` | startAgendaPoller() invoked at boot inside JEST_WORKER_ID guard | WIRED | Line 7 import; line 33: `startAgendaPoller();` |
| `src/scheduler/reminders.ts` | `src/database/queries.ts` | claimReminder24hSlot/claimReminder1hSlot called BEFORE send for each type | WIRED | Lines 145, 161: both claim functions called before respective sendTelegramMessage calls; dayLabel computed at line 144 before claimReminder24hSlot |
| `src/scheduler/reminders.ts` | `src/utils/timezone.ts` | isoDateInAthens/addCalendarDays are the ONLY date arithmetic source | WIRED | Lines 8, 121-122: both imported and used exclusively for date computation |
| `src/server.ts` | `src/scheduler/reminders.ts` | startReminderPoller() invoked at boot inside JEST_WORKER_ID guard | WIRED | Line 8 import; line 34: `startReminderPoller();` |

### Data-Flow Trace (Level 4)

Not applicable to this phase. All data-rendering artifacts are Telegram message sends (outbound push), not display components. Data flows from DB queries through business logic to sendTelegramMessage calls — all paths verified at Level 3 (wiring).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase 3 scheduler suites (22 tests: 10 agenda + 12 reminders, including new Test 7, 7b, 9) | `npx jest --testPathPattern="scheduler-agenda\|scheduler-reminders"` | 22 passed, 0 failed | PASS |
| AGENDA_HOUR_THRESHOLD constant exported and value is 8 | `grep 'AGENDA_HOUR_THRESHOLD = 8' src/scheduler/agenda.ts` | 1 match (line 17) | PASS |
| dayLabel computed in reminders.ts before claim call | `grep 'dayLabel' src/scheduler/reminders.ts` | 2 matches (line 144 declaration, line 149 usage) | PASS |
| pathname guard fires before CSRF check in setup-google-calendar.ts | lines 55-59 appear before line 61 CSRF check | Confirmed by source read | PASS |
| googleRefreshToken in logger redact.paths (bare + wildcard) | `grep 'googleRefreshToken' src/utils/logger.ts` | 2 matches (lines 12-13) | PASS |

### Probe Execution

No conventional probe scripts found. Not applicable.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| OWNR-04 | 03-01, 03-02, 03-03 | Confirmed bookings auto-sync to Google Calendar (create/update/delete on booking/cancel/reschedule) | HUMAN NEEDED | Code fully implemented and unit-tested; OAuth consent (03-03) deferred — no real Calendar events have been written yet. CR-02 pathname guard is now fixed. |
| OWNR-03 | 03-04, 03-06 | Owner receives daily agenda message gated to 08:00 Athens time | VERIFIED | AGENDA_HOUR_THRESHOLD = 8; early return before DB calls at line 59; Test 7 (before 08:00, no send, no claim) and Test 7b (at 08:00, proceeds normally) both pass. |
| NOTF-01 | 03-05, 03-06 | Client receives reminder before appointment with correct day label | VERIFIED | dayLabel computed from booking.calendarDate === todayIso comparison; Test 9 (same-day path) asserts message matches /σήμερα/ not /αύριο/; DST-safe arithmetic unchanged and all 12 reminders tests pass. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | All previously identified BLOCKERs and WARNINGs resolved by 03-06 | — | — |

Previous BLOCKERs now resolved:
- `src/scheduler/agenda.ts`: 8am threshold gate now present (AGENDA_HOUR_THRESHOLD = 8, line 59 early return)
- `src/scheduler/reminders.ts` line 144: dayLabel computed dynamically — hardcoded 'αύριο' removed

Previous WARNINGs now resolved:
- `scripts/setup-google-calendar.ts` lines 55-59: pathname guard returns 204 for non-callback requests before CSRF check
- `src/utils/logger.ts` lines 12-13: 'googleRefreshToken' and '*.googleRefreshToken' added to redact.paths

No TBD, FIXME, or XXX debt markers found in any Phase 3 source files.

### Human Verification Required

#### 1. Google Calendar Round-Trip (ROADMAP SC1)

**Test:** Complete the 03-03-PLAN.md OAuth consent-flow CLI for at least one fixture business (`npm run setup-calendar -- --business-slug pilates-athens`), then trigger a real booking confirmation (owner approves via Telegram), then check that business owner's Google Calendar.
**Expected:** A new event appears titled "\<service name\> — Client \<phone\>" at the correct Europe/Athens date/time, with no attendee invited. Cancelling the booking removes the event within one poller cycle (5 minutes).
**Why human:** Requires a real Google account and completed OAuth consent grant. GCP credentials were not available at phase execution time (03-03 was deferred). The CR-02 pathname guard fix is now in place, so the OAuth CLI flow should succeed once real credentials are provided.

#### 2. Daily Agenda Timing Gate (live end-to-end)

**Test:** With the 8am threshold fix in place (AGENDA_HOUR_THRESHOLD = 8), restart the server before 08:00 Athens time with at least one fixture business that has confirmed bookings for today. Observe server logs during the pre-08:00 window, then let the first poller tick run at or after 08:00.
**Expected:** No agenda is sent before 08:00. On the first tick at or after 08:00 the agenda sends once and is logged. A second sweep later that day sends nothing.
**Why human:** Tests 7 and 7b confirm mock-time behavior; a live poller run against a real Telegram delivery is needed for end-to-end confirmation.

#### 3. 24h Reminder Day-Label Correctness (live end-to-end)

**Test:** Create a confirmed booking for today whose appointment time is 15+ hours in the future. Trigger the reminder sweep when minutesUntil <= 1440. Check the client's Telegram.
**Expected:** Client receives a message saying "ραντεβού **σήμερα** στις HH:MM" — not "αύριο".
**Why human:** Test 9 confirms mock-time behavior; requires live Telegram delivery against a real same-day booking for end-to-end confirmation of the Greek text.

#### 4. 1h Reminder Live Delivery

**Test:** With a fixture business, create a confirmed booking ~50 minutes in the future. Call `runReminderSweep()` once (or wait for the 15-minute tick). Check the client's Telegram. Call the sweep again immediately.
**Expected:** Client receives exactly one Greek 1h-prior reminder; the second sweep sends nothing (claimReminder1hSlot prevents double-send).
**Why human:** Requires live Telegram delivery and a real confirmed booking within the reminder window.

### Gaps Summary

No implementation gaps remain. Both BLOCKERs identified in the initial verification (03-VERIFICATION.md, status gaps_found) were resolved by plan 03-06:

- **Gap 1 closed — 8am threshold gate:** `src/scheduler/agenda.ts` now checks `minutesSinceMidnight(athensWallClockTime(new Date())) < AGENDA_HOUR_THRESHOLD * 60` as the first statement in `runAgendaSweep()`, before any DB call. The exported constant `AGENDA_HOUR_THRESHOLD = 8` allows tests to assert the value directly. New Test 7 and Test 7b cover the before-08:00 and at-08:00 paths respectively.

- **Gap 2 closed — dayLabel fix:** `src/scheduler/reminders.ts` line 144 now computes `const dayLabel = booking.calendarDate === todayIso ? 'σήμερα' : 'αύριο'` before calling `claimReminder24hSlot`. The hardcoded literal 'αύριο' is removed from the template string. New Test 9 asserts the same-day path produces a message matching /σήμερα/ and not /αύριο/.

- **Warning CR-02 resolved:** `scripts/setup-google-calendar.ts` pathname guard (lines 55-59) absorbs auxiliary browser requests (favicon, prefetch) with 204 before entering the CSRF check — the server no longer terminates prematurely before the real OAuth callback arrives.

- **Warning WR-02 resolved:** `src/utils/logger.ts` redact.paths now includes 'googleRefreshToken' and '*.googleRefreshToken', matching the bare and wildcard patterns used for all other secrets.

**The only remaining item is human action:** OAuth credentials must be provisioned for at least one fixture business to confirm ROADMAP SC1 (real Calendar event creation) end-to-end. The code, wiring, and tests for the Calendar sync path are all in place. The 03-06 gap closure advances the verified score from 5/7 to 7/7 with 208 tests passing and zero TypeScript errors.

---

_Verified: 2026-07-09T16:00:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification: after 03-06 gap closure (previous status: gaps_found, score: 5/7)_
