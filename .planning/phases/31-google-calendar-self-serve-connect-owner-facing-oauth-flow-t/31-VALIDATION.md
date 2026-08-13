---
phase: 31
slug: google-calendar-self-serve-connect-owner-facing-oauth-flow-t
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-13
---

# Phase 31 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest (existing test stack) |
| **Config file** | jest.config.js (existing) |
| **Quick run command** | `npm test -- --testPathPattern="google-oauth\|calendar-ics\|telegram-calendar-command" -x` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30s (quick), full suite per existing baseline |

---

## Sampling Rate

- **After every task commit:** Run the quick run command above, scoped to the task's touched test file(s)
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 31-01-01 | 01 | 1 | D-03 | T-31-01 | /oauth/callback validates HMAC-signed state before exchanging code; rejects invalid/missing state with generic error, no token/secret leaked in logs or response | integration | `npm test -- --testPathPattern="google-oauth" -x` | ❌ Wave 0 | ⬜ pending |
| 31-01-02 | 01 | 1 | D-05 | — | generateIcsEvent produces RFC 5545-valid single VEVENT with unique UID per booking | unit | `npm test -- --testPathPattern="calendar-ics" -x` | ❌ Wave 0 | ⬜ pending |
| 31-01-03 | 01 | 1 | D-01/D-02 | — | /calendar command + settings button both send the OAuth consent link; registered in setMyCommands alongside existing owner commands | integration | `npm test -- --testPathPattern="telegram-calendar-command\|admin-menu" -x` | ✅ (existing fixtures) | ⬜ pending |
| 31-01-04 | 01 | 1 | D-06 | T-31-02 | Disconnect clears businesses.googleRefreshToken; reconnect re-runs OAuth and stores a fresh token (prompt=consent guarantees reissue) | integration | `npm test -- --testPathPattern="google-oauth\|calendar-sync" -x` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*(Task IDs above are provisional — the planner assigns final IDs; this table is the validation contract the planner's tasks must satisfy, not a fixed schedule.)*

---

## Wave 0 Requirements

- [ ] `tests/google-oauth-callback.test.ts` — /oauth/callback route: state HMAC validation, code exchange, refresh token storage, error paths
- [ ] `tests/calendar-ics.test.ts` — generateIcsEvent RFC 5545 format validation, timezone handling, UID uniqueness
- [ ] `tests/telegram-calendar-command.test.ts` — /calendar command handler, settings menu connect/disconnect buttons
- [ ] `src/calendar/ics.ts` — new ICS generation module (does not exist yet)
- [ ] `src/telegram/handlers/calendar-connect.ts` — new command handler for /calendar (does not exist yet)
- [ ] `/oauth/callback` route in `src/server.ts` (does not exist yet — only the throwaway CLI loopback server exists today)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full OAuth consent flow against real Google account | D-03 | Requires a real Google OAuth consent screen interaction (test accounts can't fully automate Google's hosted consent UI in this project's test suite) | Owner taps /calendar in Telegram → completes Google consent → confirm googleRefreshToken populated in DB, and a subsequent booking syncs to that Google Calendar |
| .ics file opens correctly in Google Calendar / Apple Calendar / Outlook when tapped from Telegram | D-05 | Requires manually tapping a Telegram-delivered file across real calendar apps | Book a session as a test client → confirm the .ics attachment opens and creates a correct event in at least one calendar app |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
