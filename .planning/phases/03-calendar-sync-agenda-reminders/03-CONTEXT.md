# Phase 3: Calendar Sync, Agenda & Reminders - Context

**Gathered:** 2026-07-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Confirmed bookings automatically sync to the owner's Google Calendar (create on confirm, update/remove on reschedule/cancel), the owner gets a daily agenda message summarizing that day's appointments, and clients get a reminder before their appointment — all via Telegram (Phase 2's channel pivot still stands; WhatsApp remains shelved). Covers requirements OWNR-04, OWNR-03, NOTF-01. Does NOT cover owner self-serve Google account onboarding (fixtures stand in through this phase — Phase 4 replaces them), and does NOT cover WhatsApp message-template submission (deferred until WhatsApp actually re-enables).

</domain>

<decisions>
## Implementation Decisions

### Messaging Channel (carries forward Phase 2 D-01, re-confirmed)
- **D-01:** Meta Business Verification is still pending (submitted 2026-07-07, not yet cleared). Phase 3 continues on **Telegram** — same pivot as Phase 2. Agenda and reminder messages are Telegram messages.
- **D-02:** ROADMAP.md SC3's "sent via a Meta-approved message template" clause does not apply this phase — Telegram has no 24h-window/template-approval system. WhatsApp template submission is explicitly deferred until WhatsApp is actually re-enabled (Phase 5 or later), not done in parallel now.
- **D-03:** Reuse `src/telegram/client.ts`'s existing `sendTelegramMessage` / `sendTelegramMessageWithKeyboard` as-is for agenda and reminder sends — no new Telegram send helpers needed.
- **D-04:** Calendar-sync/agenda/reminder trigger logic is structured channel-agnostic (core scheduling/business logic separate from the Telegram send call), matching Phase 2's D-03 channel-adapter split — so WhatsApp slots back in later as a drop-in adapter, not a rework.

### Google Calendar Auth (fixture businesses)
- **D-05:** One-time real OAuth consent-screen flow run per fixture business owner (not a manual OAuth-Playground token paste) — matches the eventual Phase 4 self-serve architecture so there's no rework when real onboarding replaces fixtures.
- **D-06:** Refresh token stored per-business in a DB column on `businesses` (e.g. `googleRefreshToken`), not an env var — multi-tenant-ready, consistent with how `phoneNumberId`/`ownerTelegramId` are already stored per business in `schema.ts`.
- **D-07:** User (project owner) will provide the 2 Google Calendar IDs/tokens for the two fixture businesses (pilates studio, hair salon) by running the OAuth consent flow themselves once the flow is built — not something Claude fabricates or auto-provisions.
- **D-08:** Calendar event content: title = service name + client identifier (e.g. "Pilates — Client 3941xxxx"), no attendee/email invite — no client email address exists in the data model, and adding an attendee would trigger Google's own invite-email flow, which isn't wanted.

### Scheduling Mechanism
- **D-09:** Daily 8am Athens agenda uses the same **in-process `setInterval` poller** pattern as Phase 2's `expiry-poller.ts` — no Supercronic/cron process, no Redis. Checks periodically, fires once per business per day when Athens local time crosses 8am.
- **D-10:** Reminder sweep (24h/1h before appointment) polls on a **15-minute** interval (user chose the "15-30 min" range; 15 min picked as the concrete value — tighter accuracy than the alternative, still far looser than the expiry-poller's 5-min interval since reminder timing tolerance is looser than owner-approval expiry).
- **D-11:** Idempotency for agenda/reminders uses **sent-state columns**, not a separate log table: `reminder24hSentAt` / `reminder1hSentAt` timestamp columns on `bookings`, and an `agendaSentDate` (or equivalent) column on `businesses` — mirrors the existing `bookingStatus`/`expiresAt` column pattern already in `schema.ts`.
- **D-12:** All Phase 3 pollers (agenda, reminder sweep, calendar-sync retry) run in the **same process** as `expiry-poller.ts` — started from `index.ts` alongside the Express server. No `fly.toml` `[processes]` changes.

### Reminder Timing & Calendar Failure Handling
- **D-13:** Send **both** a 24h-prior and a 1h-prior reminder per booking (ROADMAP SC3's fullest reading).
- **D-14:** If a booking is confirmed too close to a reminder's trigger point to still catch it (e.g. booked 20h out — misses the 24h mark; booked 30min out — misses both), that reminder is **skipped silently**. No catch-up/immediate reminder is sent. Only reminders that still have time to fire, fire.
- **D-15:** Google Calendar API failures (rate limit, auth revoked, network) on create/update/delete are **best-effort, non-blocking** — the booking confirmation flow never fails or rolls back because of a Calendar sync failure. The `bookings` table (already the source of truth per Phase 2 schema) remains authoritative; Calendar is a mirror, not a dependency of the booking flow.
- **D-16:** Failed Calendar syncs are retried via a **sync-status column + retry poller**: a `calendarSyncStatus` column on `bookings` (`pending` / `synced` / `failed`, mirroring the same enum-as-text pattern used for `bookingStatus`), swept by the same in-process poller pattern (D-12) until it succeeds or is abandoned per planner's discretion on max-retry policy.

### Claude's Discretion
- Exact poller check-interval for the daily-agenda trigger (D-09) — e.g. every 5/10/15 min checking "has 8am Athens passed today and agenda not yet sent" — not specified, left to planner; should be cheap enough to run frequently without meaningfully changing behavior (agenda still fires once per day either way, per D-11's sent-state guard).
- Max-retry policy / backoff for failed Calendar syncs (D-16) — count/interval before giving up, and whether "abandoned" syncs get surfaced to the owner — left to planner.
- Exact DB schema for `googleRefreshToken` and related OAuth fields (access token caching, expiry, scopes) — left to planner, following the existing Drizzle conventions in `schema.ts`.
- Exact Greek wording for the daily agenda message and both reminder messages — no specific phrasing mandated, follow the tone established in Phase 1/2 CONTEXT.md.
- OAuth consent-flow UI/UX (a one-off setup script vs a small web page vs a chat-driven flow) for the fixture businesses (D-05/D-07) — left to planner; this is throwaway/fixture-only tooling since Phase 4 replaces it with real self-serve onboarding.
- DST-transition and late-night-booking edge case test coverage (ROADMAP SC4) — build on the existing `src/utils/timezone.ts` DST-safe helpers (`isoDateInAthens`, `weekdayOfIsoDate`, `addCalendarDays`); planner should ensure agenda/reminder trigger-time computation reuses these rather than raw `Date` arithmetic.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project scope & requirements
- `.planning/PROJECT.md` — core value, constraints (budget, stack, language, GDPR), key decisions
- `.planning/REQUIREMENTS.md` — OWNR-03, OWNR-04, NOTF-01 full requirement text (note: still framed around "WhatsApp" — read as "Telegram" per D-01, same caveat as Phase 2's D-04)
- `.planning/ROADMAP.md` §"Phase 3: Calendar Sync, Agenda & Reminders" — goal and 4 success criteria this phase must satisfy (note: SC3's "Meta-approved message template" clause does not apply this phase — see D-02)
- `.claude/CLAUDE.md` — locked tech stack; Google Calendar API via `googleapis`, OAuth 2.0 with `calendar` scope; **no Redis**, Supercronic mentioned as an option but Phase 3 sticks with the in-process poller precedent (D-09/D-12) instead

### Messaging channel pivot (inherited from Phase 2)
- `.planning/phases/02-ai-booking-conversations-owner-alerts/02-CONTEXT.md` — D-01 through D-04 (Telegram pivot, channel-agnostic core/adapter split) — still the canonical record until PROJECT.md/ROADMAP.md/REQUIREMENTS.md are updated at the next transition

### Prior phase context
- `.planning/phases/02-ai-booking-conversations-owner-alerts/02-CONTEXT.md` — full Phase 2 decisions (booking approval flow, availability model, D-12 full data model for services/hours)
- `.planning/phases/01-foundation-webhook-business-resolution/01-CONTEXT.md` — D-05 (Postgres-only dedup/no-Redis precedent, directly informs D-09/D-12), D-13 (app-level tenant isolation)

### No dedicated research doc yet for Phase 3
- `.planning/research/SUMMARY.md` / `.planning/research/ARCHITECTURE.md` / `.planning/research/PITFALLS.md` were written pre-Phase-1 and don't cover Google Calendar sync, agenda scheduling, or reminder mechanics specifically — the phase researcher should treat Google Calendar API integration, OAuth token refresh, and DST-safe scheduling as open research questions for this phase, not pre-answered.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/telegram/client.ts` — `sendTelegramMessage`, `sendTelegramMessageWithKeyboard`, `answerCallbackQuery` — reused as-is for agenda/reminder sends (D-03).
- `src/conversation/expiry-poller.ts` — the exact pattern to replicate for agenda/reminder/calendar-retry pollers (D-09/D-12): plain `setInterval`, per-business try/catch isolation, per-item try/catch isolation, returns a count, exported `startXPoller(intervalMs)` returning the interval handle for tests/graceful shutdown.
- `src/utils/timezone.ts` — `isoDateInAthens`, `weekdayOfIsoDate`, `addCalendarDays` — DST-safe Athens date math, must be reused (not reimplemented) for agenda-trigger-time and reminder-trigger-time computation.
- `src/database/schema.ts` — `businesses` table already has nullable-column precedent (`ownerTelegramId` added in Phase 2 to a non-empty table) for adding `googleRefreshToken` the same way; `bookings` table already has the `bookingStatus`/`expiresAt` column pattern to mirror for `calendarSyncStatus`/`reminder24hSentAt`/`reminder1hSentAt`.
- `src/database/queries.ts` — existing typed query layer conventions (e.g. `expireStalePendingBookings`, `listAllBusinessIds`, `findBusinessById`) to extend with new agenda/reminder/calendar-sync queries.

### Established Patterns
- In-process `setInterval` poller with per-item isolation (no cron/Redis) — locked precedent from Phase 2, reused for all Phase 3 background jobs (agenda, reminder sweep, Calendar-sync retry) per D-09/D-12.
- Nullable-column additive migrations for non-empty tables (`ownerTelegramId` precedent) — same approach applies to `googleRefreshToken` on `businesses`.
- Partial unique index / status-scoped query pattern (`unique_active_slot_per_business`) — the closest existing precedent for a status-column (`calendarSyncStatus`) driving a retry-poller's WHERE clause.

### Integration Points
- Calendar sync hooks into the same booking-confirmation/cancellation/reschedule code paths already built in Phase 2 (`src/conversation/function-executor.ts`, owner `callback_query` approval handling) — Phase 3 adds a Calendar API call at each of those transition points, best-effort per D-15.
- `googleapis` is not yet a dependency (see `package.json`) — Phase 3 adds it.
- No OAuth consent-flow code exists yet — Phase 3 builds the one-time fixture-owner authorization flow (D-05/D-07).

</code_context>

<specifics>
## Specific Ideas

No particular UI/copy references given beyond the framing decisions above. Calendar event title format specifically constrained to "service + client identifier, no attendee" (D-08). Open to standard approaches for exact Greek agenda/reminder wording, OAuth flow UX, and DB schema.

</specifics>

<deferred>
## Deferred Ideas

- WhatsApp message template submission for reminders — explicitly deferred until WhatsApp is actually re-enabled (D-02), not done in parallel this phase.
- Owner self-serve Google account connection (replacing the manual fixture OAuth flow) — Phase 4 (Owner Self-Serve Onboarding & Multi-Tenancy) territory.
- Max-retry/abandonment policy surfacing to the owner (e.g. "Calendar sync has failed 5 times, check your Google connection") — left as planner's discretion for this phase but may deserve a dedicated UX pass later if it becomes a real pain point.

### Reviewed Todos (not folded)
- **Pivot to per-business WhatsApp numbers post-PoC** (`.planning/todos/pending/2026-07-07-pivot-to-per-business-whatsapp-numbers-post-poc.md`) — reviewed, not folded (matched at score 0.6 on "whatsapp, requirements" keywords). Same todo already reviewed-not-folded in Phase 2's CONTEXT.md. Concerns Phase 1's routing/business-identity model post-PoC, unrelated to Phase 3's calendar-sync/agenda/reminder scope. Remains relevant for whenever WhatsApp is reintroduced.

</deferred>

---

*Phase: 3-Calendar Sync, Agenda & Reminders*
*Context gathered: 2026-07-09*
