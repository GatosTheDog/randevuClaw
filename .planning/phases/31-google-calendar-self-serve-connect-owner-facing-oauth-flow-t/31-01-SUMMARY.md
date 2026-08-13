---
phase: 31-google-calendar-self-serve-connect-owner-facing-oauth-flow-t
plan: 01
subsystem: auth
tags: [oauth, google-calendar, telegram-bot, hmac, express]

# Dependency graph
requires:
  - phase: 03-calendar-sync-integration (as originally numbered)
    provides: exchangeAuthCodeForTokens/storeGoogleRefreshToken/getOAuth2AuthUrl in src/google/oauth.ts, reused unchanged
provides:
  - HMAC-signed OAuth state utility (signOAuthState/verifyOAuthState) binding a Google OAuth flow to a specific business
  - Live GET /oauth/callback Express route replacing scripts/setup-google-calendar.ts for real owners
  - /calendar Telegram command + Settings menu button (single shared entry point, handleCalendarCommand)
  - Disconnect action with best-effort Google token revocation (handleCalendarDisconnect)
affects: [any future phase touching Google Calendar sync, owner Settings menu, or Telegram command registration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "HMAC-signed stateless OAuth state parameter (businessId embedded as literal prefix, verified via crypto.timingSafeEqual with explicit length guard) for a multi-tenant Express OAuth callback"
    - "Single state-aware handler function shared by both a Telegram text command and a menu button callback"

key-files:
  created:
    - src/telegram/handlers/calendar-connect.ts
    - tests/google-oauth-callback.test.ts
    - tests/telegram-calendar-command.test.ts
  modified:
    - src/google/oauth.ts
    - src/server.ts
    - src/database/queries.ts
    - src/telegram/handlers/admin-menu.ts
    - src/webhooks/telegram.ts
    - tests/google-oauth.test.ts
    - tests/admin-menu.test.ts

key-decisions:
  - "signOAuthState embeds businessId as a literal string prefix (not just HMAC input) since /oauth/callback has no other channel to learn which business initiated the flow"
  - "verifyOAuthState explicitly checks HMAC buffer-length equality before calling crypto.timingSafeEqual, since that function throws (rather than returning false) on a length mismatch"
  - "Settings menu Google Calendar button uses the same callback_data (menu:settings:calendar) in both connected/disconnected states -- handleCalendarCommand branches internally on business.googleRefreshToken"
  - "Disconnect revokes the Google token best-effort (D-07) inside its own try/catch that only logs a warning on failure -- the local column clear always runs unconditionally afterward"

patterns-established:
  - "New owner Telegram commands are registered in admin-menu.ts's owner setMyCommands array AND routed as a /command text branch in webhooks/telegram.ts's handleFoundBusiness owner branch, AND added as a menu:settings:<action> case in handleMenuCallback before any generic prefix catch-all -- three touch points for one new capability"

requirements-completed: [D-01, D-02, D-03, D-04, D-06, D-07]

coverage:
  - id: D1
    description: "signOAuthState/verifyOAuthState: HMAC-signed OAuth state binds a Google OAuth flow to a specific business, round-trips correctly, and never throws on malformed/tampered input"
    requirement: "D-01"
    verification:
      - kind: unit
        ref: "tests/google-oauth.test.ts#signOAuthState / verifyOAuthState"
        status: pass
    human_judgment: false
  - id: D2
    description: "GET /oauth/callback exchanges the code and stores the refresh token only for a valid code+state pair matching an existing business; returns 400 for missing/tampered/malformed state (never calling exchangeAuthCodeForTokens); returns 404 for a valid state whose business doesn't exist; never logs raw code/state/token values"
    requirement: "D-03"
    verification:
      - kind: integration
        ref: "tests/google-oauth-callback.test.ts#GET /oauth/callback"
        status: pass
    human_judgment: false
  - id: D3
    description: "/calendar command and Settings menu button both call the same handleCalendarCommand entry point: sends an OAuth link when disconnected, offers disconnect when already connected"
    requirement: "D-01, D-02"
    verification:
      - kind: unit
        ref: "tests/telegram-calendar-command.test.ts#handleCalendarCommand"
        status: pass
      - kind: unit
        ref: "tests/admin-menu.test.ts#showSettingsMenu — keyboard shape"
        status: pass
    human_judgment: false
  - id: D4
    description: "handleCalendarDisconnect clears googleRefreshToken unconditionally, with best-effort (non-blocking) Google token revocation"
    requirement: "D-06, D-07"
    verification:
      - kind: unit
        ref: "tests/telegram-calendar-command.test.ts#handleCalendarDisconnect"
        status: pass
    human_judgment: false
  - id: D5
    description: "Full end-to-end real Google OAuth consent flow (owner connects via /calendar or Settings, completes Google's real consent screen, DB stores a real refresh token, a test booking syncs to the connected calendar) and a real disconnect/reconnect cycle (fresh refresh token issued on reconnect via prompt=consent)"
    verification: []
    human_judgment: true
    rationale: "Requires a real Google account and a real Telegram bot completing an actual OAuth consent screen -- cannot be automated in CI (31-VALIDATION.md Manual-Only Verifications). This is Task 3, a checkpoint:human-verify task, and remains PENDING -- see 'Checkpoint Status' section below."

# Metrics
duration: ~35min (Tasks 1-2 only; Task 3 checkpoint pending)
completed: 2026-08-13
status: blocked
---

# Phase 31 Plan 01: Google Calendar Self-Serve Connect Summary

**HMAC-signed OAuth state utility + live GET /oauth/callback Express route + /calendar Telegram command/Settings button/disconnect action, replacing the developer-run scripts/setup-google-calendar.ts CLI — Tasks 1-2 complete and committed; Task 3 (real Google OAuth consent verification) is a pending checkpoint.**

## Checkpoint Status: PENDING

This plan has 3 tasks. **Tasks 1 and 2 are complete, verified by automated tests, and committed.** Task 3 is a `checkpoint:human-verify` task that requires a real Google OAuth consent flow against a real Google account and a real Telegram bot — this cannot be automated or faked, per the plan's own instructions and 31-VALIDATION.md's "Manual-Only Verifications" note.

**What still needs to happen (Task 3, per the plan's how-to-verify steps):**
1. In Telegram, as the business owner, send `/calendar` (or open Settings and tap the Google Calendar button).
2. Tap the returned Google OAuth link and complete the real Google consent screen for a test/sandbox Google account.
3. Confirm the browser shows a success page mentioning the business name, then return to Telegram.
4. Verify in the database that this business's `googleRefreshToken` column is now a non-null string.
5. Approve a test booking for this business and confirm it syncs to the connected Google Calendar.
6. Open Settings again and tap the Google Calendar button — it should now offer "Αποσύνδεση" instead of a connect link. Tap it, confirm `googleRefreshToken` is cleared in the database, then repeat steps 1-3 to confirm reconnecting issues a fresh token (Google's `prompt=consent` re-shows the consent screen).

**Prerequisite (user_setup, from the plan frontmatter):** Before Step 2 above will work, `http://localhost:3000/oauth/callback` (dev) and the production `https://<your-fly-app>.fly.dev/oauth/callback` URL must be registered as Authorized Redirect URIs on the existing Google OAuth 2.0 Client ID in Google Cloud Console -> APIs & Services -> Credentials. `GOOGLE_REDIRECT_URI` must byte-for-byte match whichever URL is used.

**Resume signal:** Type "approved" once the above steps pass, or describe any issues encountered.

## Performance

- **Duration:** ~35 min (Tasks 1-2)
- **Started:** 2026-08-13
- **Tasks:** 2 of 3 completed (Task 3 pending human verification)
- **Files modified:** 9

## Accomplishments

- `signOAuthState(businessId)` / `verifyOAuthState(state)` in `src/google/oauth.ts`: HMAC-SHA256 state binding, embedding businessId as a literal prefix, verified via a length-guarded `crypto.timingSafeEqual` — never throws on malformed input.
- Live `GET /oauth/callback` route in `src/server.ts`: verifies state before any code exchange, looks up the business, exchanges the code, stores the refresh token, and returns an HTML success/error page with the business name HTML-escaped.
- `src/telegram/handlers/calendar-connect.ts`: `handleCalendarCommand` (shared by `/calendar` and the Settings button) and `handleCalendarDisconnect` (best-effort Google revocation + unconditional local column clear).
- `admin-menu.ts`: Google Calendar status line + button in `showSettingsMenu`, two new `handleMenuCallback` cases dispatched before the generic `settings:` catch-all, `calendar` added to the owner's native command list.
- `webhooks/telegram.ts`: `/calendar` text-command routing block mirroring the existing `/invite` block.
- `queries.ts`: `updateBusinessGoogleRefreshToken`'s `refreshToken` parameter widened to `string | null` to support disconnect.
- No raw `code`/`state`/`refreshToken`/`accessToken` value is ever logged — only `businessId` and boolean/status information (verified by a dedicated test).

## Task Commits

Each automated task was committed atomically:

1. **Task 1: Add HMAC-signed OAuth state utility and the live /oauth/callback route** - `3d041b8` (feat)
2. **Task 2: Add the /calendar command, Settings menu button, and disconnect action** - `d50e581` (feat)
3. **Task 3: Manual verification — full OAuth consent flow and disconnect/reconnect cycle** - PENDING (checkpoint:human-verify, not yet started)

## Files Created/Modified

- `src/google/oauth.ts` - Added `signOAuthState`/`verifyOAuthState` HMAC utilities
- `src/server.ts` - Added `GET /oauth/callback` Express route + local `escapeHtml` helper
- `src/database/queries.ts` - Widened `updateBusinessGoogleRefreshToken`'s param type to `string | null`
- `src/telegram/handlers/calendar-connect.ts` - New: `handleCalendarCommand`, `handleCalendarDisconnect`
- `src/telegram/handlers/admin-menu.ts` - Settings menu Google Calendar status/button, `handleMenuCallback` dispatch cases, owner command list entry
- `src/webhooks/telegram.ts` - `/calendar` text-command routing block
- `tests/google-oauth.test.ts` - Extended with `signOAuthState`/`verifyOAuthState` test suite
- `tests/google-oauth-callback.test.ts` - New: `GET /oauth/callback` integration tests (supertest)
- `tests/telegram-calendar-command.test.ts` - New: connect/disconnect/dispatch tests
- `tests/admin-menu.test.ts` - Updated Settings keyboard shape assertions + owner command list regression test

## Decisions Made

- `signOAuthState` embeds `businessId` as a literal string prefix (not just HMAC input) since `/oauth/callback` has no other channel to learn which business initiated the flow — matches the plan's explicit design.
- `verifyOAuthState` explicitly checks HMAC buffer-length equality before calling `crypto.timingSafeEqual`, since that function throws a `RangeError` (rather than returning `false`) on a length mismatch — this is what guarantees the function never throws for any input.
- The Settings menu's Google Calendar button uses the same `callback_data` (`menu:settings:calendar`) in both connected and disconnected states; `handleCalendarCommand` branches internally on `business.googleRefreshToken` — avoids a second dispatch case for what is fundamentally one state-aware action.
- Disconnect revokes the Google token best-effort (D-07) inside its own try/catch that only logs a warning on failure; the local `googleRefreshToken` column clear runs unconditionally afterward regardless of revocation outcome — per D-07's discretion and the plan's explicit instruction that revocation must never block disconnect.

## Deviations from Plan

None — plan executed exactly as written for Tasks 1 and 2. No new npm packages were added (only Node's built-in `crypto`, as scoped). No Rule 1-4 auto-fixes were needed.

## Issues Encountered

None for Tasks 1-2. The plan's own verification commands used `npm test -- --testPathPattern="..." -x`; this project's Jest CLI does not recognize the `-x` flag (not a valid Jest option), so verification was run without it (`npm test -- --testPathPattern="..."`) — this is a plan-documentation quirk, not a code issue, and all specified test path patterns pass.

## User Setup Required

**External service configuration is required before Task 3's manual verification can succeed** — see this plan's `user_setup` frontmatter (31-01-PLAN.md):
- Add `http://localhost:3000/oauth/callback` (dev) and the production `https://<your-fly-app>.fly.dev/oauth/callback` URL as Authorized Redirect URIs on the existing Google OAuth 2.0 Client ID (Google Cloud Console → APIs & Services → Credentials).
- Ensure `GOOGLE_REDIRECT_URI` in `fly.secrets` (production) byte-for-byte matches whichever URL is registered.

## Next Phase Readiness

- Tasks 1-2's code is complete, tested, and committed — the `/calendar` command, Settings button, and `/oauth/callback` route are all live and reachable in the running application.
- **This plan cannot be marked fully complete until Task 3's real Google OAuth consent flow is manually verified** (see "Checkpoint Status" above). No further code changes are expected to be needed for Task 3 — it is pure verification of already-shipped code, unless the manual walkthrough surfaces an issue (e.g., a `redirect_uri_mismatch` from an unregistered callback URL).
- Phase 31 has no other plans currently defined (this is Plan 01 of what STATE.md shows as "Plan 1 of 2" — a Plan 02 may exist per the roadmap for the `.ics` client-side invite link, D-05, which is out of this plan's scope).

---
*Phase: 31-google-calendar-self-serve-connect-owner-facing-oauth-flow-t*
*Completed: 2026-08-13 (Tasks 1-2; Task 3 pending)*
