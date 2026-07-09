---
phase: 03-calendar-sync-agenda-reminders
verified: 2026-07-09T15:00:00Z
status: gaps_found
score: 5/7
behavior_unverified: 1
overrides_applied: 0
gaps:
  - truth: "Every business with a confirmed appointment today and a non-null ownerTelegramId receives exactly one Telegram message summarizing that day's appointments, sent once Athens local time crosses 8am"
    status: partial
    reason: "The agenda sweep sends whenever the first poller tick occurs for that Athens calendar day — there is no code that gates the send to after 08:00 Athens time. A server restart at 02:00 sends the agenda at 02:00, not at 08:00. The idempotency guard (claimAgendaSlot) correctly prevents a second send, but the first send is ungated."
    artifacts:
      - path: "src/scheduler/agenda.ts"
        issue: "runAgendaSweep() has no check for athensWallClockTime(now) >= '08:00' before composing and sending the agenda. The function sends on first eligible sweep for the calendar day at any hour."
    missing:
      - "Add an 8am Athens-time threshold check inside runAgendaSweep(): skip the send (but do NOT claim the slot) when minutesSinceMidnight(athensWallClockTime(now)) < 8*60, so the agenda fires the first tick at or after 08:00."
      - "Expose the threshold as a constant (AGENDA_HOUR_THRESHOLD = 8) in agenda.ts and add a test case asserting runAgendaSweep() sends nothing when Athens wall-clock time is before 08:00 but does send when it is 08:00 or later."

  - truth: "A client with a confirmed booking receives a 24h-prior Telegram reminder once Athens local time reaches exactly 24h before their appointment, and a separate 1h-prior reminder once it reaches exactly 1h before — never duplicated even under overlapping poller runs"
    status: partial
    reason: "The 24h reminder text hardcodes 'αύριο' (tomorrow) even when the appointment's calendarDate equals the Athens local date of the current day (same-day appointment within 24h window). CR-01 from 03-REVIEW.md: a booking made the day before a 22:00 appointment fires at ~07:00 with the message 'έχετε ραντεβού αύριο στις 22:00' — but the appointment is TODAY, not tomorrow."
    artifacts:
      - path: "src/scheduler/reminders.ts"
        issue: "Line 145: `Υπενθύμιση: έχετε ραντεβού αύριο στις ${booking.calendarTime}.` — 'αύριο' is always used for the 24h reminder regardless of whether booking.calendarDate equals todayIso."
    missing:
      - "Compute dayLabel before the send: const dayLabel = booking.calendarDate === todayIso ? 'σήμερα' : 'αύριο';"
      - "Replace the hardcoded 'αύριο' with the computed dayLabel in the sendTelegramMessage call."
      - "Add a test case for the same-day 24h reminder path (booking.calendarDate === todayIso, minutesUntil <= 1440) asserting the message text contains 'σήμερα', not 'αύριο'."

behavior_unverified_items:
  - truth: "A confirmed booking automatically creates an event on the owner's Google Calendar; cancelling or rescheduling updates or removes that event without any manual action (ROADMAP SC1)"
    test: "Trigger a booking confirmation (owner taps Αποδοχή in Telegram), then cancel it; check the business owner's actual Google Calendar."
    expected: "An event titled '<service> — Client <phone>' appears on confirmation; it is removed on cancellation. No manual action required."
    why_human: "Requires a real Google account with a non-null googleRefreshToken for at least one fixture business (03-03-PLAN.md human checkpoint was deferred — OAuth tokens not provisioned). The code path is fully wired and unit-tested but cannot be behaviorally confirmed without a live credential."

human_verification:
  - test: "Complete the 03-03-PLAN.md OAuth setup checkpoint for at least one fixture business, then trigger a real confirmed booking via Telegram and check the owner's Google Calendar."
    expected: "Event appears titled '<service name> — Client <phone>' with Europe/Athens timezone; no attendee invite. Cancelling removes it."
    why_human: "Requires a real Google account credential. The 03-03 checkpoint was skipped at execution time due to missing GCP credentials. syncBookingToCalendar silently skips when googleRefreshToken is null (D-15), so no Calendar events have been created against a real calendar yet."

  - test: "With a fixture business that has a confirmed booking for tomorrow and a booking for today, advance Athens local time to just before 08:00 (or verify with server logs) and observe that no agenda fires; then advance past 08:00 and confirm the agenda fires once."
    expected: "Agenda is NOT sent before 08:00 Athens time; it IS sent on the first sweep tick at or after 08:00. A second sweep in the same day sends nothing."
    why_human: "The 8am threshold does not exist in code and cannot be verified with the current implementation — this is a behavioral gap requiring a code fix. This item documents what the fix must achieve."

  - test: "With a fixture business having a confirmed booking for today (same-day, within 24h window), wait for or trigger the reminder sweep when minutesUntil <= 24*60 for that booking."
    expected: "Client receives a message containing 'σήμερα' (today), not 'αύριο' (tomorrow)."
    why_human: "CR-01 confirmed: code always says 'αύριο'. Requires a code fix first; then human confirmation of the real Telegram delivery with correct Greek text."

  - test: "With a fixture business having a confirmed booking ~50 minutes in the future, call runReminderSweep() directly (or wait for the 15-minute tick). Verify the 1h reminder reaches the client's Telegram, then run again immediately."
    expected: "Client receives one Greek 1h-prior reminder; a second sweep does not duplicate it."
    why_human: "Requires live Telegram delivery against a real booking. Not mockable in CI."
---

# Phase 3: Calendar Sync, Agenda & Reminders Verification Report

**Phase Goal:** Calendar sync, daily agenda, and client reminders — every confirmed booking auto-syncs to the owner's Google Calendar; the owner gets a daily 8am Telegram agenda; clients get 24h and 1h Telegram reminders before their appointment.
**Verified:** 2026-07-09T15:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Confirmed booking creates a Google Calendar event; cancel/reschedule removes it (ROADMAP SC1) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | syncBookingToCalendar/deleteBookingFromCalendar fully wired into telegram.ts approve branch and function-executor.ts cancelAppointmentTool; all unit tests pass; no real googleRefreshToken provisioned (03-03 deferred) — cannot observe against a real calendar |
| 2 | Google Calendar API failures never fail or roll back the booking itself (D-15) | ✓ VERIFIED | Both syncBookingToCalendar and deleteBookingFromCalendar are try/catch wrapped, return boolean, never rethrow; tests confirm false return on mock API failure; telegram.ts and function-executor.ts wrap Calendar calls in their own try/catch too |
| 3 | Failed Calendar syncs are retried up to 10 times, then permanently marked 'failed' | ✓ VERIFIED | calendar/poller.ts: MAX_CALENDAR_SYNC_RETRIES = 10; runCalendarSyncSweep calls incrementCalendarSyncRetryCount and updateCalendarSyncStatus('failed') at exhaustion; tests confirm (calendar-poller.test.ts) |
| 4 | Owner receives daily agenda once Athens local time crosses 8am — exactly once per day per business | ✗ FAILED | src/scheduler/agenda.ts has NO 8am threshold check. Agenda sends on first sweep of the calendar day at ANY hour. The per-day idempotency (claimAgendaSlot) is correct, but the first send is ungated to time-of-day. Must-have truth from 03-04-PLAN.md explicitly requires the 8am threshold. |
| 5 | Business with zero confirmed appointments receives no agenda that day | ✓ VERIFIED | listBookingsForDate returns []; if (bookings.length === 0) continue; claimAgendaSlot never called (scheduler-agenda.test.ts Test 3) |
| 6 | 24h/1h reminders sent exactly once per booking per threshold; DST-safe and late-night correct (ROADMAP SC4) | ✗ FAILED | Idempotency and DST arithmetic VERIFIED (all 11 scheduler-reminders tests pass); however the 24h reminder hardcodes 'αύριο' (tomorrow) for same-day appointments — CR-01 from 03-REVIEW.md. A booking for today whose calendarDate === todayIso still receives "ραντεβού αύριο" which is factually wrong user-facing text. |
| 7 | Agenda and reminder timing computed via isoDateInAthens/addCalendarDays, not raw Date arithmetic — DST transitions never cause skipped or duplicated messages | ✓ VERIFIED | agenda.ts uses isoDateInAthens; reminders.ts uses calendarDaysBetween (noon-UTC-anchor), minutesSinceMidnight, athensWallClockTime — no raw getTime() subtraction between reminder trigger and appointment instants; hadAtLeastHoursMarginAtBookingTime is a pure function of immutable booking.createdAt |

**Score:** 5/7 truths verified (1 present, behavior-unverified; 2 failed)

### Deferred Items

None. All identified gaps are actionable within this phase.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/database/schema.ts` | 5 new columns: googleRefreshToken, agendaSentDate, calendarSyncStatus, googleCalendarEventId, calendarSyncRetryCount, reminder24hSentAt, reminder1hSentAt | ✓ VERIFIED | All 7 column additions confirmed in source (businesses: 2, bookings: 5). Migration 0002_silent_ben_urich.sql matches. |
| `src/database/queries.ts` | 9 new Phase 3 functions exported | ✓ VERIFIED | All 9 confirmed present: updateBusinessGoogleRefreshToken, claimAgendaSlot, updateCalendarSyncStatus, updateBookingGoogleEventId, incrementCalendarSyncRetryCount, findBookingsNeedingCalendarSync, listBookingsForDate, findBookingsNeedingReminder, claimReminder24hSlot, claimReminder1hSlot |
| `src/google/oauth.ts` | OAuth2 client construction, consent URL, code exchange, token persistence | ✓ VERIFIED | getOAuth2Client, getOAuth2AuthUrl, exchangeAuthCodeForTokens, storeGoogleRefreshToken all present; CSRF state round-trips into URL; rejects missing refresh_token |
| `src/calendar/sync.ts` | syncBookingToCalendar, deleteBookingFromCalendar, getCalendarClientForBusiness | ✓ VERIFIED | All 3 exports present; never throws; D-08 title format "service — Client phone"; Europe/Athens timezone; per-business OAuth client scope |
| `src/calendar/poller.ts` | runCalendarSyncSweep, startCalendarSyncPoller | ✓ VERIFIED | Both exports present; MAX_CALENDAR_SYNC_RETRIES = 10; per-business/per-booking error isolation |
| `src/scheduler/agenda.ts` | runAgendaSweep, startAgendaPoller | ✗ PARTIAL | Both exports present; correct idempotency (claimAgendaSlot before send); correct error isolation; correct Greek message format. MISSING: 8am Athens-time threshold check — sweep fires at any hour. |
| `src/scheduler/reminders.ts` | runReminderSweep, startReminderPoller | ✗ PARTIAL | Both exports present; correct DST-safe arithmetic; correct D-14 eligibility gate; correct per-booking/per-business isolation. DEFECT: 24h reminder text hardcodes 'αύριο' regardless of whether calendarDate === todayIso (CR-01). |
| `scripts/setup-google-calendar.ts` | CLI with parseBusinessSlugArg, CSRF-guarded loopback OAuth | ✓ VERIFIED | parseBusinessSlugArg exported; CSRF state generated and verified on callback; setup-calendar npm script wired in package.json |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/webhooks/telegram.ts` | `src/calendar/sync.ts` | syncBookingToCalendar called in callback_query approve branch, wrapped in try/catch | ✓ WIRED | Line 181: `if (service) await syncBookingToCalendar(updated, business, service);` inside try/catch |
| `src/conversation/function-executor.ts` | `src/calendar/sync.ts` | deleteBookingFromCalendar called after updateBookingStatus(...,'cancelled') | ✓ WIRED | Line 198-199: fetches full business row via findBusinessById, then calls deleteBookingFromCalendar |
| `src/calendar/poller.ts` | `src/database/queries.ts` | findBookingsNeedingCalendarSync is the sole source of retry candidates | ✓ WIRED | Line 30: `const pending = await findBookingsNeedingCalendarSync(businessId);` |
| `src/scheduler/agenda.ts` | `src/database/queries.ts` | claimAgendaSlot called BEFORE sendTelegramMessage | ✓ WIRED | Line 45: `const claimed = await claimAgendaSlot(businessId, todayIso);` — after listBookingsForDate, before send. Test 4 asserts ordering. |
| `src/server.ts` | `src/scheduler/agenda.ts` | startAgendaPoller() invoked at boot inside JEST_WORKER_ID guard | ✓ WIRED | Line 7 import; line 33: `startAgendaPoller();` |
| `src/scheduler/reminders.ts` | `src/database/queries.ts` | claimReminder24hSlot/claimReminder1hSlot called BEFORE send for each type | ✓ WIRED | Lines 141, 157: both claim functions called before respective sendTelegramMessage calls |
| `src/scheduler/reminders.ts` | `src/utils/timezone.ts` | isoDateInAthens/addCalendarDays are the ONLY date arithmetic source | ✓ WIRED | Lines 8, 121-122: both imported and used exclusively for date computation |
| `src/server.ts` | `src/scheduler/reminders.ts` | startReminderPoller() invoked at boot inside JEST_WORKER_ID guard | ✓ WIRED | Line 8 import; line 34: `startReminderPoller();` |

### Data-Flow Trace (Level 4)

Not applicable to this phase. All data-rendering artifacts are Telegram message sends (outbound push), not display components. Data flows from DB queries through business logic to `sendTelegramMessage` calls — all paths verified at Level 3 (wiring).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Phase 3 test suite (49 tests across 6 new suites) | `npx jest --testPathPattern="calendar-agenda-reminder-queries|calendar-sync|calendar-poller|google-oauth|scheduler-agenda|scheduler-reminders"` | 49 passed, 0 failed | ✓ PASS |
| Full regression suite (all 25 suites) | `npx jest` | 205 passed, 0 failed | ✓ PASS |
| TypeScript compilation | `npx tsc --noEmit` | Exit 0 | ✓ PASS |
| googleapis installed as direct dependency | `grep googleapis package.json` | `"googleapis": "^173.0.0"` | ✓ PASS |
| All 4 pollers started in server.ts JEST_WORKER_ID guard | `grep -c "start.*Poller" src/server.ts` | 4 lines (expiry, calendarSync, agenda, reminders) | ✓ PASS |

### Probe Execution

No conventional probe scripts found. Not applicable.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| OWNR-04 | 03-01, 03-02, 03-03 | Confirmed bookings auto-sync to Google Calendar (create/update/delete on booking/cancel/reschedule) | ⚠️ HUMAN NEEDED | Code fully implemented and unit-tested; OAuth consent (03-03) deferred — no real Calendar events have been written yet |
| OWNR-03 | 03-04 | Owner receives daily agenda message | ✗ PARTIAL | Agenda sweep exists and is idempotent, but the 8am Athens threshold is not implemented in code — the sweep fires at any hour |
| NOTF-01 | 03-05 | Client receives reminder before appointment | ✗ PARTIAL | Reminder sweep exists and is idempotent with DST-safe arithmetic, but the 24h reminder text is factually wrong for same-day appointments (always says 'αύριο' instead of 'σήμερα') |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/scheduler/reminders.ts` | 145 | Hardcoded 'αύριο' in 24h reminder template regardless of calendarDate vs todayIso | BLOCKER | Client receives "ραντεβού αύριο" when appointment is today — factually incorrect user-facing text; confirmed by 03-REVIEW.md CR-01 |
| `src/scheduler/agenda.ts` | (entire sweep) | No time-of-day threshold check — agenda fires at any Athens hour on first sweep of the day | BLOCKER | Sends agenda at 02:00 if server restarts at 02:00; violates must-have truth from 03-04-PLAN.md; 03-CONTEXT.md D-09 explicitly requires the 8am gate |
| `scripts/setup-google-calendar.ts` | 52-58 | Favicon/prefetch requests trigger CSRF rejection before the real OAuth callback arrives | WARNING | (CR-02 from 03-REVIEW.md) OAuth CLI may terminate before completing the consent flow if browser fires auxiliary requests. Not a correctness bug in production booking logic but prevents human checkpoint 03-03 from succeeding. |
| `src/utils/logger.ts` | redact.paths | googleRefreshToken not in pino redact list | WARNING | (WR-02 from 03-REVIEW.md) A future logger.info(business) call would emit the OAuth refresh token in plaintext. No such call exists today, but the defensive guard is missing. |

No TBD, FIXME, or XXX debt markers found in any Phase 3 source files.

### Human Verification Required

#### 1. Google Calendar Round-Trip (ROADMAP SC1)

**Test:** Complete the 03-03-PLAN.md OAuth consent-flow CLI for at least one fixture business (`npm run setup-calendar -- --business-slug pilates-athens`), then trigger a real booking confirmation (owner approves via Telegram), then check that business owner's Google Calendar.
**Expected:** A new event appears titled "\<service name\> — Client \<phone\>" at the correct Europe/Athens date/time, with no attendee invited. Cancelling the booking removes the event within one poller cycle (5 minutes).
**Why human:** Requires a real Google account, completed OAuth consent grant (GCP credentials not available at phase execution time — 03-03 was deferred), and visual confirmation in the Google Calendar UI. The CR-02 bug in setup-google-calendar.ts (favicon kills the flow) must be fixed first.

#### 2. Daily Agenda Timing Gate (after code fix)

**Test:** With the 8am threshold fix applied, restart the server, confirm Athens local time is before 08:00, and observe that no agenda fires even if there are confirmed bookings for today. Then let the server run until past 08:00 Athens time.
**Expected:** Agenda fires on the first sweep tick at or after 08:00 Athens time. A second sweep later in the day sends nothing.
**Why human:** The 8am threshold check does not exist in the current code (gap). After the fix is applied, a live poller run is needed to confirm the timing gate works end-to-end against a real Telegram delivery.

#### 3. 24h Reminder Day-Label Correctness (after code fix)

**Test:** With the dayLabel fix applied (CR-01), create a confirmed booking for today whose appointment time is 15+ hours in the future. Trigger the reminder sweep when minutesUntil <= 1440. Check the client's Telegram.
**Expected:** Client receives a message saying "ραντεβού **σήμερα** στις HH:MM" — not "αύριο".
**Why human:** Requires a real Telegram delivery to confirm the Greek text is correct. The code fix must be applied first.

#### 4. 1h Reminder Live Delivery

**Test:** With a fixture business, create a confirmed booking ~50 minutes in the future. Call `runReminderSweep()` once (or wait for the 15-minute tick). Check the client's Telegram. Call the sweep again immediately.
**Expected:** Client receives exactly one Greek 1h-prior reminder; the second sweep sends nothing (claimReminder1hSlot prevents double-send).
**Why human:** Requires live Telegram delivery and a real confirmed booking within the reminder window.

### Gaps Summary

Two implementation gaps block the phase goal from being fully achieved:

**Gap 1 — 8am threshold missing from agenda sweep (BLOCKER):** `src/scheduler/agenda.ts`'s `runAgendaSweep()` has no check for Athens wall-clock time being at or after 08:00. The must-have truth from 03-04-PLAN.md and the context decision D-09 both require this gate. The fix is small: add a `minutesSinceMidnight(athensWallClockTime(new Date())) < 8 * 60` early-return before processing any business. The idempotency guard (`claimAgendaSlot`) should NOT be claimed when bailing out early for time-of-day — only skip the send, keep the slot unclaimed so the first tick at or after 08:00 can claim it.

**Gap 2 — Wrong day label in 24h reminder text (BLOCKER):** `src/scheduler/reminders.ts` line 145 hardcodes "αύριο" (tomorrow) in the 24h reminder message, producing factually incorrect text when `booking.calendarDate === todayIso`. This is CR-01 from 03-REVIEW.md. The fix is two lines: compute `const dayLabel = booking.calendarDate === todayIso ? 'σήμερα' : 'αύριο'` and use it in the template string. A test case for the same-day path should be added to scheduler-reminders.test.ts.

**Deferred — OAuth credentials for Google Calendar (human action):** Plan 03-03 was skipped due to missing GCP credentials at execution time. The code for the OAuth flow (scripts/setup-google-calendar.ts) is fully built and unit-tested. The CR-02 bug (favicon kills the flow) should be fixed before the human runs this checkpoint. Once both code fixes above are applied and 03-03 is completed, ROADMAP SC1 (real Calendar event creation) can be confirmed end-to-end.

**All other Phase 3 deliverables are solid:** schema (5 columns), query layer (9 functions, atomic claim guards), Calendar sync service (best-effort/non-blocking), retry poller (10-attempt cap, per-business isolation), DST-safe reminder arithmetic (noon-UTC-anchor technique, isoDateInAthens exclusive), server startup wiring (all 4 pollers started). 205 tests pass, zero TypeScript errors, zero debt markers.

---

_Verified: 2026-07-09T15:00:00Z_
_Verifier: Claude (gsd-verifier)_
