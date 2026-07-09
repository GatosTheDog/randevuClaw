---
phase: 03
slug: calendar-sync-agenda-reminders
status: verified
threats_open: 0
asvs_level: 1
created: 2026-07-09
---

# Phase 03 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| application → Neon Postgres | `businesses.googleRefreshToken` stored in DB — long-lived OAuth credential, not just data | Refresh token (high sensitivity) |
| in-process pollers → query functions | No client-facing input reaches query functions directly; all arguments originate from server-side poller loops | Business IDs, booking IDs, date strings (low sensitivity) |
| application → Google Calendar API | Outbound only; refresh token grants read/write to exactly one business owner's calendar per row | OAuth tokens, event details (high sensitivity) |
| local browser → scripts/setup-google-calendar.ts loopback | OAuth authorization-code callback; any local process could hit this port | Authorization code (high sensitivity) |
| in-process poller → Telegram Bot API (agenda) | Proactive outbound per businessId; must never leak one business's appointments to another owner | Appointment lists (medium sensitivity) |
| in-process poller → Telegram Bot API (reminders) | Proactive outbound per booking; must use exact `booking.clientPhone` for each iteration | Client phone, appointment time (medium sensitivity) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-03-01 | Information Disclosure | `businesses.googleRefreshToken`, `GOOGLE_CLIENT_SECRET` | high | mitigate | `src/utils/logger.ts` redacts `googleClientSecret` (line 11) and `googleRefreshToken` (line 12, 15); `src/calendar/sync.ts` and `src/google/oauth.ts` never log token — only `businessId`/`bookingId` on error | closed |
| T-03-02 | Tampering | `src/database/queries.ts` `claimAgendaSlot` / `claimReminder24hSlot` / `claimReminder1hSlot` | medium | mitigate | Atomic `UPDATE...WHERE...RETURNING` (queries.ts:465–475) — no read-then-write gap; closes duplicate-send race | closed |
| T-03-03 | Tampering | `src/database/queries.ts` `incrementCalendarSyncRetryCount` | low | accept | See accepted risks log — AR-03-01 | closed |
| T-03-04 | Spoofing | `scripts/setup-google-calendar.ts` OAuth callback | high | mitigate | `crypto.randomBytes(16)` state token generated per run (line 37); callback rejects state mismatch before any code exchange (line 64–65) | closed |
| T-03-05 | Elevation of Privilege | `src/calendar/sync.ts` `getCalendarClientForBusiness` | high | mitigate | OAuth client always constructed from the specific `business` row argument (sync.ts:20–23); no global/cached credential path exists | closed |
| T-03-06 | Denial of Service | Google Calendar API quota (500 queries/user/day free tier) | medium | mitigate | `MAX_CALENDAR_SYNC_RETRIES = 10` at 5-minute interval (poller.ts:15); permanently abandons at ≥10 retries (poller.ts:50) | closed |
| T-03-07 | Tampering | Booking-approval webhook replay interacting with Calendar sync | low | accept | See accepted risks log — AR-03-02 | closed |
| T-03-SC | Tampering | `googleapis` npm package (sole new direct dependency in Phase 03) | high | mitigate | Verified official Google library (15M+/week downloads, 10+ year history) in 03-RESEARCH.md Package Legitimacy Audit; `google-auth-library` stays transitive only | closed |
| T-03-08 | Information Disclosure | Human choosing which Google account to authorize during OAuth setup | medium | accept | See accepted risks log — AR-03-03 | closed |
| T-03-09 | Information Disclosure | `src/scheduler/agenda.ts` | high | mitigate | `listBookingsForDate(businessId, ...)` always called with the same `businessId` in the current iteration (agenda.ts:65–91); message sent only to that business's `ownerTelegramId` | closed |
| T-03-10 | Tampering | `claimAgendaSlot` (carry-forward from T-03-02) | medium | accept | Mitigation already in place from T-03-02; Plan 03-04 only consumes the atomic guard | closed |
| T-03-11 | Information Disclosure | `src/scheduler/reminders.ts` | high | mitigate | `sendTelegramMessage` always called with `booking.clientPhone` from the current iteration's row (reminders.ts:148, 164); no cross-booking substitution possible | closed |
| T-03-12 | Tampering | `claimReminder24hSlot` / `claimReminder1hSlot` (carry-forward from T-03-02) | medium | accept | Mitigation already in place from T-03-02; Plan 03-05 consumes each atomic guard independently | closed |
| T-03-13 | Denial of Service | Reminder sweep re-processing ineligible bookings every 15 minutes | low | accept | See accepted risks log — AR-03-04 | closed |
| T-03-14 | Information Disclosure | `src/utils/logger.ts` `redact.paths` | medium | mitigate | `googleRefreshToken` and `*.googleRefreshToken` added to redact list (logger.ts:12, 15) — prevents accidental plaintext logging if a future call emits a business row | closed |
| T-03-15 | Tampering | `scripts/setup-google-calendar.ts` pathname guard | low | mitigate | Pathname guard added before CSRF check (setup-google-calendar.ts:55): auxiliary requests (favicon, prefetch) receive 204 and are ignored without triggering CSRF rejection or closing the server | closed |
| T-03-16 | Spoofing | `src/scheduler/reminders.ts` `dayLabel` | low | accept | See accepted risks log — AR-03-05 | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `high` count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-03-01 | T-03-03 | `incrementCalendarSyncRetryCount` is not attacker-reachable — only called by the server-side retry poller. A true race losing an increment would at worst delay permanent abandonment by one poller cycle, not corrupt data. | gsd-security-auditor | 2026-07-09 |
| AR-03-02 | T-03-07 | Phase 2's `updateBookingStatusIfPending` compare-and-swap already prevents double-approval. Even if duplicate hooks fired, `calendar.events.update`/`.insert` against the same `googleCalendarEventId` is naturally idempotent. | gsd-security-auditor | 2026-07-09 |
| AR-03-03 | T-03-08 | The Google account choice during OAuth setup is a deliberate, informed human action outside the code's control. The `<instructions>` in Plan 03-03 flag that the same or different accounts may be used per fixture. | gsd-security-auditor | 2026-07-09 |
| AR-03-04 | T-03-13 | `hadAtLeastHoursMarginAtBookingTime` is a pure function of `booking.createdAt` (immutable); re-evaluation is cheap. `findBookingsNeedingReminder`'s WHERE clause already bounds candidates to a 2-day window and unsent rows, so the re-evaluated set shrinks naturally as reminders are sent. | gsd-security-auditor | 2026-07-09 |
| AR-03-05 | T-03-16 | `dayLabel` is derived from `booking.calendarDate` vs `isoDateInAthens(now)` — both internal values, never sourced from user input. No injection or spoofing vector exists. | gsd-security-auditor | 2026-07-09 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-09 | 17 | 17 | 0 | gsd-security-auditor (L1 grep, asvs_level=1, block_on=high) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-07-09
