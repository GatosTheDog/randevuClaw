# Phase 31: Google Calendar Self-Serve Connect - Context

**Gathered:** 2026-08-13
**Status:** Ready for planning

<domain>
## Phase Boundary

The Google Calendar sync engine (OAuth client, `syncBookingToCalendar`, retry poller, DB columns) already exists and works. What's missing is a self-serve way for an owner to connect their Google account without a developer running `scripts/setup-google-calendar.ts` manually. This phase delivers:

1. Owner-facing OAuth connect flow (Telegram command + settings button, live callback route on the server).
2. Owner disconnect/reconnect capability.
3. A lightweight client-side calendar touchpoint (`.ics` invite link on booking confirmation) — not a second OAuth integration.

</domain>

<decisions>
## Implementation Decisions

### Owner connect entry point
- **D-01:** Add a standalone `/calendar` Telegram command AND a button in the `/settings` menu — both trigger the same OAuth-link-send flow. Owners who skip it at onboarding (or want to reconnect) aren't stuck.
- **D-02:** Not gated to onboarding-only — must remain reachable any time from settings.

### Server-side OAuth callback
- **D-03:** Add a real `/oauth/callback` Express route to `src/server.ts` (currently only exists as a throwaway local `http.createServer` inside `scripts/setup-google-calendar.ts`). This route exchanges the code via the already-existing `exchangeAuthCodeForTokens()` / `storeGoogleRefreshToken()` (`src/google/oauth.ts`) — reuse, don't reimplement.
- **D-04 (Claude's discretion):** Exact wording/design of the browser-side "success, return to Telegram" landing page — functional minimum is fine for PoC.

### Client-side calendar
- **D-05:** Client-side calendar integration for this phase is an `.ics` invite link/file sent by the bot on booking confirmation — no client Google OAuth, no new per-client token storage, no GDPR-relevant new data collection. Full client-side Google sync is explicitly out of scope (too much scope/risk for a PoC).

### Disconnect / reconnect
- **D-06:** Add a "disconnect calendar" action (in `/settings` / via `/calendar` when already connected) that clears `businesses.googleRefreshToken`. Reconnecting is just re-running the same connect flow (D-01).
- **D-07 (Claude's discretion):** Whether disconnect also revokes the token with Google (`oauth2Client.revokeToken`) or just clears the local column — either is acceptable; revoking is the more correct default if trivial to add.

### Claude's Discretion
- Exact Greek copy for all new bot messages (connect prompt, success/failure, disconnect confirmation) — must match the existing bot's Greek-only tone (see PROJECT.md constraints).
- Whether `.ics` is generated inline or via a small library — existing `package.json` has no ICS library yet; pick whatever's lightest for a PoC (a hand-rolled minimal `.ics` string is likely sufficient given the simple single-event use case).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing calendar sync implementation (reuse, don't rebuild)
- `src/google/oauth.ts` — `getOAuth2Client()`, `getOAuth2AuthUrl()`, `exchangeAuthCodeForTokens()`, `storeGoogleRefreshToken()`
- `src/calendar/sync.ts` — `syncBookingToCalendar()`, `deleteBookingFromCalendar()`, `getCalendarClientForBusiness()`
- `src/calendar/poller.ts` — retry sweep, `MAX_CALENDAR_SYNC_RETRIES`
- `scripts/setup-google-calendar.ts` — the CLI this phase replaces for production owners; its header comment explicitly calls out "Phase 4 replaces it with real self-serve chat-driven onboarding" — this IS that phase (renumbered to 31 in the current roadmap)
- `src/config.ts` — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (already required env vars; `GOOGLE_REDIRECT_URI` must now point at the real `/oauth/callback` route, not the CLI's loopback address)
- `src/database/schema.ts` — `businesses.googleRefreshToken` (line ~26), `bookings.calendarSyncStatus`/`googleCalendarEventId`/`calendarSyncRetryCount` (lines ~197-203)
- Tests: `tests/calendar-sync.test.ts`, `tests/calendar-poller.test.ts`, `tests/google-oauth.test.ts`, `tests/setup-google-calendar.test.ts`

### Bot command/menu patterns to follow
- `src/telegram/handlers/admin-menu.ts` — existing settings menu structure/button patterns; showTodaysAgenda for command-handler shape
- `src/server.ts` — where webhook/HTTP routes are registered; `startCalendarSyncPoller()` call site (~line 32) for how background processes are wired at boot

No project ADRs/specs reference this beyond the CLI script's own header comment (quoted above) and CLAUDE.md's stack section on Google Calendar API — both covered above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getOAuth2AuthUrl()` / `exchangeAuthCodeForTokens()` / `storeGoogleRefreshToken()` (`src/google/oauth.ts`) — fully implemented, just needs a live HTTP route and a Telegram command to call them instead of the CLI script.
- `syncBookingToCalendar()` already no-ops safely (`sync.ts:60-64`, logs and returns `false`) when `googleRefreshToken` is null — so connect/disconnect is safe to ship incrementally without touching the sync/poller code at all.

### Established Patterns
- Telegram command registration: commands are registered at `setMyCommands` call sites (per recent quick-task history — `260729-s9c` added several owner commands this way) and routed in the webhook handler. `/calendar` should follow that exact same registration + routing pattern.
- Settings menu buttons follow the existing `admin-menu.ts` structure (inline keyboard buttons calling handler functions).

### Integration Points
- New `/oauth/callback` route lives in `src/server.ts` alongside the existing Telegram webhook route.
- `/calendar` command and settings button both call a new handler that sends `getOAuth2AuthUrl()` as a link — no new DB writes at that point; the DB write happens only in the `/oauth/callback` handler after a successful code exchange.
- `.ics` generation is a new, small, self-contained utility (likely `src/calendar/ics.ts`) invoked from wherever booking-confirmation messages are already sent to the client (same call site pattern as the existing owner-notification-on-booking flow).

</code_context>

<specifics>
## Specific Ideas

No specific UI/copy examples were given beyond the three locked decisions above. Standard Telegram bot UX (command + settings button, Greek copy) applies.

</specifics>

<deferred>
## Deferred Ideas

- **Full client-side Google Calendar OAuth sync** — explicitly deferred (D-05). Would need its own phase: per-client token storage, GDPR review, and a second full OAuth integration. Not started.
- Token-revocation-on-disconnect (D-07) is Claude's discretion within this phase, not deferred — but if it turns out non-trivial during planning, downgrading to "clear local column only" and deferring `oauth2Client.revokeToken` to a follow-up is acceptable.

### Reviewed Todos (not folded)
None — no pending todos matched this phase during discussion.

</deferred>

---

*Phase: 31-google-calendar-self-serve-connect-owner-facing-oauth-flow-t*
*Context gathered: 2026-08-13*
