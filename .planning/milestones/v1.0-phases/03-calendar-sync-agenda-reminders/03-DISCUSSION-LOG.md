# Phase 3: Calendar Sync, Agenda & Reminders - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-09
**Phase:** 3-Calendar Sync, Agenda & Reminders
**Areas discussed:** Channel (Telegram/WhatsApp), Google Calendar auth for fixture businesses, Scheduling mechanism, Reminder timing + Calendar failure handling

---

## Channel: Telegram or WhatsApp?

| Option | Description | Selected |
|--------|-------------|----------|
| Still pending | Continue Telegram — same pivot as Phase 2 (D-01). | ✓ |
| Cleared, WhatsApp live | Revert to WhatsApp per original ROADMAP wording. | |

**User's choice:** Still pending — Telegram continues.

| Option | Description | Selected |
|--------|-------------|----------|
| Skip templates now | Pure Telegram this phase; submit WhatsApp templates only when WhatsApp re-enables. | ✓ |
| Submit in parallel | Also submit WhatsApp templates now for future-proofing. | |

**User's choice:** Skip templates now.

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse as-is | Same `src/telegram/client.ts` send functions Phase 2 built. | ✓ |
| Need something new | Agenda/reminders need different formatting/features. | |

**User's choice:** Reuse as-is.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, channel-agnostic core | Consistent with Phase 2 D-03. | ✓ |
| Telegram-specific, refactor later | Simpler now, accept future refactor cost. | |

**User's choice:** Yes, channel-agnostic core.

**Notes:** Meta Business Verification submitted 2026-07-07, still within its 1-6 week window as of 2026-07-09 — expected, not a surprise.

---

## Google Calendar auth for fixture businesses

| Option | Description | Selected |
|--------|-------------|----------|
| One-time consent screen, refresh token stored | Real OAuth flow, matches eventual Phase 4 architecture. | ✓ |
| Manual token via OAuth Playground/local script | Faster, no consent-screen code this phase. | |

**User's choice:** One-time consent screen, refresh token stored.

| Option | Description | Selected |
|--------|-------------|----------|
| DB column on businesses table | Per-business, multi-tenant-ready. | ✓ |
| Env var | Simpler now, breaks with multiple accounts. | |

**User's choice:** DB column on businesses table.

| Option | Description | Selected |
|--------|-------------|----------|
| You'll provide 2 calendar IDs | User runs OAuth consent themselves per fixture business. | ✓ |
| One account, two calendars, Claude scaffolds | Claude builds placeholders, user completes consent later. | |

**User's choice:** You'll provide 2 calendar IDs (own account or 2 accounts).

| Option | Description | Selected |
|--------|-------------|----------|
| Title: service + client id, no attendee | No client emails exist; avoids Google invite-email noise. | ✓ |
| Richer details | Add description field with full booking details. | |

**User's choice:** Title: service + client id, no attendee.

---

## Scheduling mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| In-process setInterval poller | Matches Phase 2's expiry-poller precedent, no new infra. | ✓ |
| Supercronic cron process | Matches original stack doc, adds new fly.io process. | |

**User's choice:** In-process setInterval poller.

| Option | Description | Selected |
|--------|-------------|----------|
| Every 5 minutes | Matches expiry-poller's existing interval. | |
| Every 15-30 minutes | Looser accuracy, fewer DB queries. | ✓ |

**User's choice:** Every 15-30 minutes. **Claude's discretion applied:** locked to 15 minutes in CONTEXT.md (D-10) as the concrete value within the chosen range.

| Option | Description | Selected |
|--------|-------------|----------|
| Sent-state columns | reminder24hSentAt/reminder1hSentAt on bookings, agendaSentDate on businesses. | ✓ |
| Separate log table | Dedicated sent-notifications log table. | |

**User's choice:** Sent-state columns.

| Option | Description | Selected |
|--------|-------------|----------|
| Same process (index.ts) | Matches Phase 2's expiry-poller wiring exactly. | ✓ |
| Separate fly.io process | New fly.toml [processes] entry. | |

**User's choice:** Same process (index.ts).

---

## Reminder timing + Calendar failure handling

| Option | Description | Selected |
|--------|-------------|----------|
| Both 24h and 1h | Two touchpoints, fullest reading of SC3. | ✓ |
| Only 24h | Single reminder, day before. | |
| Only 1h | Single reminder, shortly before. | |

**User's choice:** Both 24h and 1h.

| Option | Description | Selected |
|--------|-------------|----------|
| Skip silently | Send whichever reminder(s) still have time to fire. | ✓ |
| Immediate catch-up reminder | Send a reminder right after confirmation if already inside the window. | |

**User's choice:** Skip silently.

| Option | Description | Selected |
|--------|-------------|----------|
| Best-effort, booking still confirms | Booking flow doesn't couple to Google's uptime. | ✓ |
| Blocking | Booking confirmation fails/rolls back if Calendar sync fails. | |

**User's choice:** Best-effort, booking still confirms.

| Option | Description | Selected |
|--------|-------------|----------|
| Sync-status column + retry poller | calendarSyncStatus column + in-process poller retries. | ✓ |
| No retry, log only | PoC-simple, no automatic retry. | |

**User's choice:** Sync-status column + retry poller.

---

## Claude's Discretion

- Exact poller check-interval for the daily-agenda trigger (separate from the 15-min reminder-sweep interval).
- Max-retry/backoff policy for failed Calendar syncs, and whether abandoned syncs surface to the owner.
- Exact DB schema for `googleRefreshToken` and related OAuth fields (access token caching, expiry, scopes).
- Exact Greek wording for the daily agenda message and both reminder messages.
- OAuth consent-flow UI/UX for the fixture businesses (one-off script vs small web page vs chat-driven) — throwaway/fixture-only tooling since Phase 4 replaces it.
- DST-transition and late-night-booking edge case test coverage — must reuse `src/utils/timezone.ts` helpers, not raw `Date` arithmetic.

## Deferred Ideas

- WhatsApp message template submission for reminders — deferred until WhatsApp actually re-enables, not done in parallel this phase.
- Owner self-serve Google account connection (replacing the manual fixture OAuth flow) — Phase 4 territory.
- Max-retry/abandonment policy surfacing to the owner — may deserve a dedicated UX pass later.
- Todo "Pivot to per-business WhatsApp numbers post-PoC" — reviewed, not folded (already reviewed-not-folded in Phase 2 too); unrelated to Phase 3's calendar-sync/agenda/reminder scope.
