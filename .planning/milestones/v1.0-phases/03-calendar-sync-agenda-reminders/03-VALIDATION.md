---
phase: 03
slug: calendar-sync-agenda-reminders
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-09
audited: 2026-07-09
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 + ts-jest (existing, from Phase 1/2) |
| **Config file** | `jest.config.js` (existing) |
| **Quick run command** | `npm test -- --testPathPattern="calendar-sync\|calendar-poller\|calendar-agenda\|scheduler-agenda\|scheduler-reminders"` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~8 seconds (quick), ~30 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run quick command scoped to touched module
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd-verify-work`:** Full suite must be green, including DST-transition and retry-poller tests
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-T1 | 03-01 | 1 | OWNR-04, OWNR-03, NOTF-01 | — | Schema columns for calendarSyncStatus, agendaSentDate, reminder24hSentAt, reminder1hSentAt | unit | `npm test -- --testPathPattern="calendar-agenda-reminder-queries"` | ✅ | ✅ green |
| 03-01-T2 | 03-01 | 1 | OWNR-04, OWNR-03, NOTF-01 | — | Typed query layer returns correct shapes; claimAgendaSlot/claimReminderSlot atomic upserts | unit | `npm test -- --testPathPattern="calendar-agenda-reminder-queries"` | ✅ | ✅ green |
| 03-02-T1 | 03-02 | 2 | OWNR-04 | — | Confirmed booking creates Google Calendar event; googleapis mocked | unit | `npm test -- --testPathPattern="calendar-sync"` | ✅ | ✅ green |
| 03-02-T1 | 03-02 | 2 | OWNR-04 | — | Rescheduled booking updates (not re-inserts) existing Calendar event | unit | `npm test -- --testPathPattern="calendar-sync"` | ✅ | ✅ green |
| 03-02-T1 | 03-02 | 2 | OWNR-04 | — | Cancelled booking deletes Calendar event; missing eventId is a no-op (safe) | unit | `npm test -- --testPathPattern="calendar-sync"` | ✅ | ✅ green |
| 03-02-T1 | 03-02 | 2 | OWNR-04 | — | Calendar API failure is non-blocking (resolves false, marks pending, never throws) | unit | `npm test -- --testPathPattern="calendar-sync"` | ✅ | ✅ green |
| 03-02-T1 | 03-02 | 2 | OWNR-04 | — | Null googleRefreshToken → resolves false without any Calendar API call | unit | `npm test -- --testPathPattern="calendar-sync"` | ✅ | ✅ green |
| 03-02-T2 | 03-02 | 2 | OWNR-04 | — | OAuth URL contains offline access, consent prompt, and calendar scope | unit | `npm test -- --testPathPattern="google-oauth"` | ✅ | ✅ green |
| 03-02-T2 | 03-02 | 2 | OWNR-04 | — | exchangeAuthCodeForTokens throws on missing refresh_token | unit | `npm test -- --testPathPattern="google-oauth"` | ✅ | ✅ green |
| 03-02-T3 | 03-02 | 2 | OWNR-04 | — | Calendar sync retry poller retries failed syncs; permanently abandons at retryCount >= 10 | unit | `npm test -- --testPathPattern="calendar-poller"` | ✅ | ✅ green |
| 03-02-T3 | 03-02 | 2 | OWNR-04 | — | Poller error-isolates: one business failure does not stop next business | unit | `npm test -- --testPathPattern="calendar-poller"` | ✅ | ✅ green |
| 03-03-T1 | 03-03 | manual | OWNR-04 | — | Real OAuth consent flow stores working refresh token (manual only) | manual | see Manual-Only table | N/A | ⬜ manual |
| 03-04-T1 | 03-04 | 3 | OWNR-03 | — | Daily agenda sent once per day; claimAgendaSlot called before send (atomic guard) | unit | `npm test -- --testPathPattern="scheduler-agenda"` | ✅ | ✅ green |
| 03-04-T1 | 03-04 | 3 | OWNR-03 | — | Business with ownerTelegramId null skipped; no empty-agenda spam | unit | `npm test -- --testPathPattern="scheduler-agenda"` | ✅ | ✅ green |
| 03-04-T1 | 03-04 | 3 | OWNR-03 | — | claimAgendaSlot false → sendTelegramMessage never called (idempotency) | unit | `npm test -- --testPathPattern="scheduler-agenda"` | ✅ | ✅ green |
| 03-04-T1 | 03-04 | 3 | OWNR-03 | — | Error isolation: one business failing does not stop next | unit | `npm test -- --testPathPattern="scheduler-agenda"` | ✅ | ✅ green |
| 03-04-T2 | 03-04 | 3 | OWNR-03 | — | Agenda poller starts and fires at given interval; stops on clearInterval | unit | `npm test -- --testPathPattern="scheduler-agenda"` | ✅ | ✅ green |
| 03-05-T1 | 03-05 | 4 | NOTF-01 | D-14 | 24h reminder sent within 24h window; NOT sent when > 24h away | unit | `npm test -- --testPathPattern="scheduler-reminders"` | ✅ | ✅ green |
| 03-05-T1 | 03-05 | 4 | NOTF-01 | D-14 | Booking confirmed < 24h before appointment never gets 24h reminder (D-14) | unit | `npm test -- --testPathPattern="scheduler-reminders"` | ✅ | ✅ green |
| 03-05-T1 | 03-05 | 4 | NOTF-01 | — | 1h reminder sent within 60min window; NOT sent after appointment has passed | unit | `npm test -- --testPathPattern="scheduler-reminders"` | ✅ | ✅ green |
| 03-05-T1 | 03-05 | 4 | NOTF-01 | — | claimReminder24hSlot/1hSlot false → send skipped (idempotency) | unit | `npm test -- --testPathPattern="scheduler-reminders"` | ✅ | ✅ green |
| 03-05-T1 | 03-05 | 4 | NOTF-01 | — | Error isolation: one business failing does not stop next | unit | `npm test -- --testPathPattern="scheduler-reminders"` | ✅ | ✅ green |
| 03-05-T2 | 03-05 | 4 | NOTF-01 | — | Reminder poller starts and fires at given interval; stops on clearInterval | unit | `npm test -- --testPathPattern="scheduler-reminders"` | ✅ | ✅ green |
| 03-06-T1 | 03-06 | 5 | OWNR-03 | D-09 | 8am gate: runAgendaSweep sends nothing and does NOT call claimAgendaSlot before 08:00 Athens | unit | `npm test -- --testPathPattern="scheduler-agenda" --testNamePattern="8am"` | ✅ | ✅ green |
| 03-06-T1 | 03-06 | 5 | OWNR-03 | D-09 | 8am gate: runAgendaSweep DOES send at exactly 08:00 or later | unit | `npm test -- --testPathPattern="scheduler-agenda" --testNamePattern="8am"` | ✅ | ✅ green |
| 03-06-T2 | 03-06 | 5 | NOTF-01 | CR-01 | 24h reminder uses "σήμερα" for same-day, "αύριο" for next-day (never hardcoded) | unit | `npm test -- --testPathPattern="scheduler-reminders" --testNamePattern="same-day"` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/calendar-sync.test.ts` — Calendar create/update/delete on booking confirm/cancel/reschedule, `googleapis` mocked (10 tests)
- [x] `tests/calendar-poller.test.ts` — retry-poller sweep behavior and max-retry cutoff (7 tests)
- [x] `tests/calendar-agenda-reminder-queries.test.ts` — claimAgendaSlot/claimReminderSlot atomic DB operations (3 tests)
- [x] `tests/scheduler-agenda.test.ts` — 8am Athens trigger incl. gate, `agendaSentDate` idempotency guard (9 tests)
- [x] `tests/scheduler-reminders.test.ts` — 24h/1h trigger windows, D-14 skip, same-day label, sent-state idempotency (11 tests)
- [x] `tests/google-oauth.test.ts` — OAuth URL construction, token exchange (4 tests)
- [x] `tests/timezone.test.ts` — isoDateInAthens, weekdayOfIsoDate, addCalendarDays (6 tests)
- [x] Jest fake timers + `jest.mock('googleapis', ...)` conventions established and used across all Phase 3 test files

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Google OAuth consent flow completes and stores a working refresh token | OWNR-04 | Requires live Google account interaction (fixture business owner) — not automatable | Run the OAuth setup flow for both fixture businesses; confirm `googleRefreshToken` populated in DB and a test event round-trips via a real `calendar.events.insert`/`delete` call |
| Real Telegram delivery of agenda/reminder messages renders correctly in Greek | OWNR-03, NOTF-01 | Message rendering/formatting on an actual device is not covered by mocked Telegram client tests | Trigger one agenda send and one reminder send against a real fixture business chat; visually confirm Greek text and formatting |

---

## Validation Audit 2026-07-09

| Metric | Count |
|--------|-------|
| Gaps found | 11 (all TBD in original draft) |
| Resolved | 25 automated (58 tests green) |
| Escalated to manual | 2 (OAuth live flow, real Telegram delivery) |

---

## Validation Sign-Off

- [x] All tasks have automated verify or manual-only justification
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all requirements (OWNR-04, OWNR-03, NOTF-01)
- [x] No watch-mode flags
- [x] Feedback latency < 30s (suite runs in ~8s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 2026-07-09 — 58/58 tests green, 2 manual-only with justification
