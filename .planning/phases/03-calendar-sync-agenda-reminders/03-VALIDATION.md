---
phase: 03
slug: calendar-sync-agenda-reminders
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-09
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 + ts-jest (existing, from Phase 1/2) |
| **Config file** | `jest.config.js` (existing) |
| **Quick run command** | `npm test -- --testPathPattern="calendar\|scheduler"` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds (quick), TBD (full, grows with suite) |

---

## Sampling Rate

- **After every task commit:** Run the quick command scoped to the touched module (`calendar/`, `scheduler/`)
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd-verify-work`:** Full suite must be green, including DST-transition and retry-poller tests
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

*Task IDs are assigned during planning — this table is completed by the planner/executor once PLAN.md tasks exist. Requirement-to-test-type mapping below is locked from research and should not change during planning.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | OWNR-04 | — | Confirmed booking creates Google Calendar event | integration | `npm test -- src/calendar/sync.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | OWNR-04 | — | Cancelled booking deletes Google Calendar event | integration | `npm test -- src/calendar/sync.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | OWNR-04 | — | Rescheduled booking updates Google Calendar event | integration | `npm test -- src/calendar/sync.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | OWNR-04 | — | Calendar API failure is non-blocking (booking stays confirmed, sync marked pending/failed) | unit | `npm test -- src/calendar/retry.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | OWNR-04 | — | Calendar sync retry poller retries failed syncs up to max-retry limit | unit | `npm test -- src/calendar/poller.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | OWNR-03 | — | Daily agenda sent once per day at 8am Athens time | unit | `npm test -- src/scheduler/agenda.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | OWNR-03 | — | DST transition doesn't skip agenda or send it twice | integration | `npm test -- src/scheduler/agenda.test.ts --testNamePattern=DST` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NOTF-01 | — | 24h reminder sent 24h before appointment | unit | `npm test -- src/scheduler/reminders.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NOTF-01 | — | 1h reminder sent 1h before appointment | unit | `npm test -- src/scheduler/reminders.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NOTF-01 | — | Reminder skipped silently if booking confirmed too close to trigger point (D-14) | unit | `npm test -- src/scheduler/reminders.test.ts --testNamePattern=tooClose` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | NOTF-01 | — | Reminder/agenda not sent twice (idempotency via sent-state columns, concurrent poller runs) | unit | `npm test -- src/scheduler/reminders.test.ts --testNamePattern=idempotent` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/calendar/sync.test.ts` — Calendar create/update/delete on booking confirm/cancel/reschedule, `googleapis` mocked
- [ ] `src/calendar/retry.test.ts` — best-effort/non-blocking failure handling, `calendarSyncStatus` transitions
- [ ] `src/calendar/poller.test.ts` — retry-poller sweep behavior and max-retry cutoff
- [ ] `src/scheduler/agenda.test.ts` — 8am Athens trigger incl. DST transition, `agendaSentDate` idempotency guard
- [ ] `src/scheduler/reminders.test.ts` — 24h/1h trigger windows, skip-if-too-close (D-14), sent-state idempotency
- [ ] Jest fake timers + `jest.mock('googleapis', ...)` conventions established in Wave 0 for reuse across all Phase 3 test files

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Google OAuth consent flow completes and stores a working refresh token | OWNR-04 | Requires live Google account interaction (fixture business owner) — not automatable | Run the OAuth setup flow for both fixture businesses; confirm `googleRefreshToken` populated in DB and a test event round-trips via a real `calendar.events.insert`/`delete` call |
| Real Telegram delivery of agenda/reminder messages renders correctly in Greek | OWNR-03, NOTF-01 | Message rendering/formatting on an actual device is not covered by mocked Telegram client tests | Trigger one agenda send and one reminder send against a real fixture business chat; visually confirm Greek text and formatting |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
