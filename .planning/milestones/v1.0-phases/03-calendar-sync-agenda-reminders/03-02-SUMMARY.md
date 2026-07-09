---
phase: 03-calendar-sync-agenda-reminders
plan: 2
subsystem: integrations
tags: [googleapis, oauth2, google-calendar, typescript, jest, telegram]

# Dependency graph
requires:
  - phase: 03-calendar-sync-agenda-reminders (Plan 03-01)
    provides: "5 additive Neon columns + 9-function typed query layer for calendar-sync/agenda/reminder state (googleRefreshToken, calendarSyncStatus, googleCalendarEventId, calendarSyncRetryCount, findBookingsNeedingCalendarSync, incrementCalendarSyncRetryCount, updateCalendarSyncStatus, updateBookingGoogleEventId, updateBusinessGoogleRefreshToken)"
provides:
  - "src/google/oauth.ts: OAuth2 client construction, CSRF-guarded consent URL, auth-code exchange (rejects a missing refresh_token loudly), refresh-token persistence"
  - "src/calendar/sync.ts: syncBookingToCalendar/deleteBookingFromCalendar/getCalendarClientForBusiness -- the only code that ever calls the Google Calendar API, best-effort and non-blocking per D-15"
  - "src/calendar/poller.ts: in-process retry sweep with a 10-attempt cap (D-16) before permanent 'failed' abandonment"
  - "scripts/setup-google-calendar.ts: one-time CSRF-guarded loopback OAuth CLI for fixture businesses (D-05/D-07)"
  - "Calendar sync/delete hooks wired into the Telegram callback_query approve branch (incl. reschedule-cascade delete) and cancelAppointmentTool"
affects: [03-03-oauth-setup-checkpoint, 03-04-daily-agenda, 03-05-client-reminders]

# Tech tracking
tech-stack:
  added: [googleapis]
  patterns:
    - "Best-effort external-API wrapper: syncBookingToCalendar/deleteBookingFromCalendar NEVER throw -- every Calendar API call site returns boolean success and logs+marks 'pending' on failure, so the booking DB row stays the source of truth (D-15)"
    - "CSRF-guarded one-shot loopback OAuth flow: crypto.randomBytes state token generated per script run, verified exactly on the http.createServer callback before any code exchange (T-03-04)"

key-files:
  created:
    - src/google/oauth.ts
    - src/calendar/sync.ts
    - src/calendar/poller.ts
    - scripts/setup-google-calendar.ts
    - tests/google-oauth.test.ts
    - tests/calendar-sync.test.ts
    - tests/setup-google-calendar.test.ts
    - tests/calendar-poller.test.ts
  modified:
    - src/config.ts
    - src/utils/logger.ts
    - src/webhooks/telegram.ts
    - src/conversation/function-executor.ts
    - src/server.ts
    - tests/jest.setup.ts
    - tests/config.test.ts
    - tests/telegram-webhook.test.ts
    - tests/function-executor.test.ts
    - package.json

key-decisions:
  - "Config's 3 new Google OAuth env vars (GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI) were added to src/config.ts and tests/jest.setup.ts during Task 1's commit rather than waiting for Task 2, because src/google/oauth.ts (Task 1) references config.googleClientId etc. and Task 1's own tsc/test verification cannot pass without them (Rule 3 blocking fix)"
  - "googleapis is the only new direct dependency; google-auth-library stays purely transitive -- the OAuth2 client type is inferred via InstanceType<typeof google.auth.OAuth2> from the googleapis import itself, per T-03-SC's Package Legitimacy Audit scope"
  - "MAX_CALENDAR_SYNC_RETRIES = 10 at the 5-minute poll interval (~50 min total retry window) before permanent 'failed' abandonment, per D-16's planner-discretion max-retry policy"

patterns-established:
  - "External API integration modules (src/calendar/sync.ts) never throw across their public boundary -- every failure path returns a boolean and delegates retry to the poller, closing RESEARCH.md Pitfall 2 (Calendar sync cascading into booking-confirmation failure)"

requirements-completed: [OWNR-04]

coverage:
  - id: D1
    description: "Google OAuth 2.0 helper (client construction, CSRF-tagged consent URL, auth-code exchange with a loud failure on a missing refresh_token, refresh-token persistence)"
    requirement: "OWNR-04"
    verification:
      - kind: unit
        ref: "tests/google-oauth.test.ts (6 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Calendar sync service: syncBookingToCalendar creates/updates events with D-08's title format and Europe/Athens timezone, best-effort and non-blocking (never throws) on any Google API failure; deleteBookingFromCalendar is an idempotent no-op when there is nothing to delete"
    requirement: "OWNR-04"
    verification:
      - kind: unit
        ref: "tests/calendar-sync.test.ts (11 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "One-time CSRF-guarded loopback OAuth consent-flow CLI (scripts/setup-google-calendar.ts) for the two fixture businesses, plus config fail-fast wiring and secret-redaction extension"
    requirement: "OWNR-04"
    verification:
      - kind: unit
        ref: "tests/setup-google-calendar.test.ts (4 tests), tests/config.test.ts (4 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Confirmed bookings sync to Calendar and cancellations/reschedule-supersessions delete the event via hooks in the Telegram approve branch and cancelAppointmentTool, both wrapped in non-rethrowing try/catch"
    requirement: "OWNR-04"
    verification:
      - kind: unit
        ref: "tests/telegram-webhook.test.ts (extended, 3 new tests), tests/function-executor.test.ts (extended, 1 new test)"
        status: pass
    human_judgment: false
  - id: D5
    description: "In-process retry poller (runCalendarSyncSweep/startCalendarSyncPoller) sweeps pending syncs per business, retries up to 10 times, then permanently marks 'failed'; per-business/per-booking error isolation; started at server boot alongside the expiry poller"
    requirement: "OWNR-04"
    verification:
      - kind: unit
        ref: "tests/calendar-poller.test.ts (8 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A real Google Calendar event appears for an approved booking (title, timezone, no attendee invite) and is removed on cancellation, verified against an actual Google account"
    human_judgment: true
    rationale: "Requires a real Google account, a completed OAuth consent grant for a fixture business (the companion 03-03-PLAN.md checkpoint), and visual confirmation in the Google Calendar UI -- not mockable in CI. This plan's own tasks are fully autonomous (no checkpoint task); the human-verify step lives in 03-03-PLAN.md."

duration: 51min
completed: 2026-07-09
status: complete
---

# Phase 3 Plan 2: Google Calendar Sync Summary

**OAuth 2.0 consent flow + best-effort, non-blocking Google Calendar CRUD (googleapis SDK) wired into booking confirm/cancel/reschedule, with a 10-attempt in-process retry poller and a CSRF-guarded one-time fixture-setup CLI.**

## Performance

- **Duration:** 51 min
- **Started:** 2026-07-09T11:42:02+03:00
- **Completed:** 2026-07-09T12:33:00+03:00
- **Tasks:** 3 completed
- **Files modified:** 18 (4 new source files, 4 new test files, 10 modified files)

## Accomplishments
- `src/google/oauth.ts`: `getOAuth2Client`/`getOAuth2AuthUrl`/`exchangeAuthCodeForTokens`/`storeGoogleRefreshToken`, with a loud failure when Google omits `refresh_token` (the single most common OAuth setup mistake)
- `src/calendar/sync.ts`: `getCalendarClientForBusiness`/`syncBookingToCalendar`/`deleteBookingFromCalendar` -- D-08's exact title format (`"<service> — Client <phone>"`, no attendee invite), Europe/Athens timezone, never throws (D-15, closes RESEARCH.md Pitfall 2)
- `src/calendar/poller.ts`: `runCalendarSyncSweep`/`startCalendarSyncPoller` -- 10-attempt retry cap (D-16) before permanent `'failed'` abandonment, per-business + per-booking error isolation mirroring `expiry-poller.ts`
- `scripts/setup-google-calendar.ts`: one-time CSRF-guarded loopback OAuth CLI (`npm run setup-calendar -- --business-slug <slug>`) for the two fixture businesses (D-05/D-07), rejecting a `state` mismatch before ever exchanging the auth code (T-03-04)
- Calendar sync/delete hooks wired into `src/webhooks/telegram.ts`'s `callback_query` approve branch (including the reschedule-cascade delete of the superseded booking) and `src/conversation/function-executor.ts`'s `cancelAppointmentTool`
- `src/server.ts` now starts the calendar-sync retry poller alongside the expiry poller at boot
- Zero regressions across the full 23-suite/186-test codebase; `googleapis` is the only new direct dependency (`google-auth-library` stays transitive)

## Task Commits

Each task was committed atomically (TDD tasks: test → feat):

1. **Task 1: Google OAuth helper and Calendar sync service** - RED `92b09ab` (test) → GREEN `5c7e54f` (feat)
2. **Task 2: Config wiring and the one-time OAuth consent-flow CLI script** - `f6eefbc` (feat)
3. **Task 3: Wire Calendar sync into the booking lifecycle, retry poller, and server startup** - RED `28836ad` (test) → GREEN `55bccf1` (feat)

**Plan metadata:** commit pending (docs: complete plan)

_Note: No refactor commits needed for either TDD task -- implementation matched each task's action block, and the GREEN commit passed on first attempt._

## Files Created/Modified
- `src/google/oauth.ts` - OAuth2 client construction, CSRF-tagged consent URL, auth-code exchange, refresh-token persistence
- `src/calendar/sync.ts` - Calendar CRUD service (create/update/delete events), best-effort/non-blocking
- `src/calendar/poller.ts` - In-process retry sweep, 10-attempt cap, per-business/per-booking error isolation
- `scripts/setup-google-calendar.ts` - One-time CSRF-guarded loopback OAuth CLI for fixture businesses
- `src/config.ts` - Added `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` to `EnvSchema`/`Config`
- `src/utils/logger.ts` - Extended pino `redact.paths` to cover `googleClientSecret`
- `src/webhooks/telegram.ts` - Calendar sync/delete hooks in the `callback_query` approve branch
- `src/conversation/function-executor.ts` - Calendar delete hook in `cancelAppointmentTool` (fetches full `Business` row via `findBusinessById` since `ToolContext.business` is narrow)
- `src/server.ts` - Starts `startCalendarSyncPoller()` alongside `startExpiryPoller()`
- `package.json` / `package-lock.json` - Added `googleapis` dependency, `setup-calendar` npm script
- `tests/google-oauth.test.ts`, `tests/calendar-sync.test.ts`, `tests/setup-google-calendar.test.ts`, `tests/calendar-poller.test.ts` - New
- `tests/jest.setup.ts`, `tests/config.test.ts`, `tests/telegram-webhook.test.ts`, `tests/function-executor.test.ts` - Extended

## Decisions Made
- Config's 3 new env vars were added to `src/config.ts`/`tests/jest.setup.ts` in Task 1's own commit rather than deferring to Task 2, since `src/google/oauth.ts` (Task 1) references them and Task 1's own `tsc --noEmit`/test verification requires them to exist to compile -- documented as a deviation below (Rule 3)
- `google-auth-library` intentionally never added as a direct dependency; the `OAuth2Client` type is inferred via `InstanceType<typeof google.auth.OAuth2>` from the `googleapis` import, keeping the Package Legitimacy Audit scope to exactly one new direct dependency (T-03-SC)
- `MAX_CALENDAR_SYNC_RETRIES = 10` at the poller's 5-minute interval (~50 min total retry window), matching D-16's planner-discretion max-retry policy

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Config field extension pulled forward from Task 2 into Task 1**
- **Found during:** Task 1 implementation (`src/google/oauth.ts` writing)
- **Issue:** The plan's own Task 1 action text says `googleClientId`/`googleClientSecret`/`googleRedirectUri` "are added to `Config` by Task 2 of this plan, so this file can be written now referencing them" -- but Task 1's own `<verify>` block (`npx tsc --noEmit && npm test`) cannot pass until those fields actually exist on `Config`, since `src/google/oauth.ts` references `config.googleClientId` etc. directly.
- **Fix:** Added the 3 `EnvSchema`/`Config` fields to `src/config.ts` and matching `??=` test-env defaults to `tests/jest.setup.ts` as part of Task 1's GREEN commit. Task 2 then added only the *remaining* config-adjacent work it owns (the `config.test.ts` assertions extending the full-env test + a new `GOOGLE_CLIENT_ID`-missing test, the `logger.ts` secret-redaction extension, and the setup script itself) without re-touching the already-landed `EnvSchema`/`Config` fields.
- **Files modified:** `src/config.ts`, `tests/jest.setup.ts` (Task 1 commit `5c7e54f`)
- **Verification:** `npx tsc --noEmit` clean; full 186-test suite passing after all 3 tasks
- **Committed in:** `5c7e54f` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 blocking task-ordering fix, explicitly anticipated by the plan's own Task 1 action text)
**Impact on plan:** No scope creep -- the moved work was always Task 2's own declared scope, just landed one commit earlier than the plan's task numbering implied, because the plan's own interface contract required it. Task 2's commit still delivers all of its remaining declared file changes.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
**External OAuth authorization is required before Calendar sync can do anything for a real business**, but running that authorization flow is this plan's own tooling output (`scripts/setup-google-calendar.ts`), not a manual dashboard step for this plan. The actual human checkpoint -- running `npm run setup-calendar -- --business-slug <slug>` for each fixture business and completing the Google consent screen -- is the companion `03-03-PLAN.md`'s job, not this plan's. Until that checkpoint runs, every business's `googleRefreshToken` is `null`, so `syncBookingToCalendar`/`deleteBookingFromCalendar` silently skip (return `false`/`true` respectively) with no user-visible error, exactly as D-15 intends.

Prerequisite dashboard config (documented in this plan's frontmatter `user_setup`, executed by the project owner before/alongside 03-03-PLAN.md's checkpoint):
- Google Cloud Console: create an OAuth 2.0 client (Desktop app or Web application), enable the Google Calendar API for that project, set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` env vars, and add the redirect URI verbatim to the OAuth client's Authorized redirect URIs list.

## Next Phase Readiness
- `src/calendar/sync.ts`'s `syncBookingToCalendar`/`deleteBookingFromCalendar` exports are the stable, tested contract the companion `03-03-PLAN.md` checkpoint and any future phase can rely on
- The retry poller is running at boot; once a business has a `googleRefreshToken`, any booking left in `calendarSyncStatus='pending'` self-heals within 5 minutes without further code changes
- No blockers for `03-03-PLAN.md` (the OAuth setup checkpoint) or `03-04`/`03-05` (daily agenda, client reminders), both of which build on Plan 03-01's query layer independently of this plan's Calendar-specific code

---
*Phase: 03-calendar-sync-agenda-reminders*
*Completed: 2026-07-09*

## Self-Check: PASSED

All created files verified on disk (src/google/oauth.ts, src/calendar/sync.ts, src/calendar/poller.ts, scripts/setup-google-calendar.ts, tests/google-oauth.test.ts, tests/calendar-sync.test.ts, tests/setup-google-calendar.test.ts, tests/calendar-poller.test.ts) and all 6 task/summary commits verified in git log (92b09ab, 5c7e54f, f6eefbc, 28836ad, 55bccf1, 4af57f4).
