---
phase: 31-google-calendar-self-serve-connect-owner-facing-oauth-flow-t
plan: 02
subsystem: calendar
tags: [ics, rfc5545, telegram-bot, calendar-invite, dst-safe]

# Dependency graph
requires:
  - phase: 31-01
    provides: no functional dependency — both plans touch src/webhooks/telegram.ts in different, non-overlapping regions (owner OAuth/settings vs. the client-facing approve confirmation)
  - phase: 03-calendar-sync-integration (as originally numbered)
    provides: addMinutesToLocalTime (now exported from src/calendar/sync.ts) and its DST-safe day-overflow logic, reused unchanged
provides:
  - generateIcsEvent(booking, business, service): hand-rolled RFC 5545 single-VEVENT .ics document string, DST-correct UTC DTSTART/DTEND, escaped SUMMARY/DESCRIPTION
  - sendBookingConfirmationIcs(chatId, booking, business, service): best-effort, never-throwing wrapper that generates the .ics buffer and sends it via Telegram
  - sendTelegramDocument(chatId, fileBuffer, filename, caption?): new Telegram sendDocument API wrapper in src/telegram/client.ts
  - addMinutesToLocalTime exported (was private) from src/calendar/sync.ts
affects: [any future phase touching booking-confirmation delivery, Telegram document/file sending, or calendar-invite generation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DST-safe Athens-local-to-UTC timestamp conversion for RFC 5545 output, reusing the same noon-UTC-anchor + Intl offset-derivation trick as src/utils/timezone.ts's hoursUntilSession, rather than hardcoding a fixed UTC+2/UTC+3 offset"
    - "RFC 5545 TEXT escaping (backslash, semicolon, comma, newline, in that order) mirroring src/invites/generator.ts's escapeXml multi-step replace shape"
    - "Never-throwing best-effort wrapper (sendBookingConfirmationIcs) matching syncBookingToCalendar's established D-15 non-blocking contract — a Telegram document-send failure can never block, delay, or break the client's existing text confirmation"

key-files:
  created:
    - src/calendar/ics.ts
    - tests/calendar-ics.test.ts
  modified:
    - src/calendar/sync.ts
    - src/telegram/client.ts
    - src/webhooks/telegram.ts
    - tests/telegram-client.test.ts
    - tests/telegram-webhook.test.ts

key-decisions:
  - "addMinutesToLocalTime changed from a private function to an exported one in src/calendar/sync.ts, with no other behavior change, so ics.ts's DTEND calculation reuses the exact same DST-safe day-overflow logic instead of a second divergent implementation"
  - "sendBookingConfirmationIcs is called unconditionally right after the existing text-confirmation message in the approve branch, guarded only by the same `service` truthiness check already used for syncBookingToCalendar — no additional try/catch at the call site, since sendBookingConfirmationIcs's own contract already never throws"
  - "DTSTAMP is generated the same way as DTSTART/DTEND (via a shared toIcsUtcTimestamp formatter) but simply from `new Date()` — it does not go through the Athens-offset conversion since it's already a real-time UTC instant"

requirements-completed: [D-05]

coverage:
  - id: D1
    description: "generateIcsEvent produces valid RFC 5545 output: CRLF line endings throughout, starts with BEGIN:VCALENDAR, ends with END:VCALENDAR\\r\\n, exactly one BEGIN:VEVENT/END:VEVENT pair"
    requirement: "D-05"
    verification:
      - kind: unit
        ref: "tests/calendar-ics.test.ts#generateIcsEvent Test 1"
        status: pass
    human_judgment: false
  - id: D2
    description: "UID uniqueness/stability: different booking.id values produce different UIDs; the same booking.id + business.slug always produces the same UID"
    requirement: "D-05"
    verification:
      - kind: unit
        ref: "tests/calendar-ics.test.ts#generateIcsEvent Tests 2-3"
        status: pass
    human_judgment: false
  - id: D3
    description: "DST-correct UTC DTSTART for both winter (UTC+2) and summer (UTC+3) Athens fixture dates, and DTEND exactly durationMin minutes later in UTC including a local-midnight-crossing case that correctly rolls the UTC calendar day"
    requirement: "D-05"
    verification:
      - kind: unit
        ref: "tests/calendar-ics.test.ts#generateIcsEvent Tests 4-7"
        status: pass
    human_judgment: false
  - id: D4
    description: "Special characters (semicolon, comma, backslash, newline) in business/service names are correctly backslash-escaped per RFC 5545 in SUMMARY/DESCRIPTION (T-31-07 mitigation)"
    requirement: "D-05"
    verification:
      - kind: unit
        ref: "tests/calendar-ics.test.ts#generateIcsEvent Test 8"
        status: pass
    human_judgment: false
  - id: D5
    description: "sendBookingConfirmationIcs generates the .ics buffer, calls sendTelegramDocument with filename booking.ics, and never throws even when sendTelegramDocument rejects"
    requirement: "D-05"
    verification:
      - kind: unit
        ref: "tests/calendar-ics.test.ts#sendBookingConfirmationIcs Tests 9-10"
        status: pass
    human_judgment: false
  - id: D6
    description: "sendTelegramDocument correctly POSTs to the sendDocument endpoint with a FormData body (chat_id/document/caption), follows the exact same success/failure/no-context-throw contract as sendTelegramPhoto"
    requirement: "D-05"
    verification:
      - kind: unit
        ref: "tests/telegram-client.test.ts Tests 15-18"
        status: pass
    human_judgment: false
  - id: D7
    description: "Approving a plain booking calls sendBookingConfirmationIcs exactly once, after the text confirmation, with the confirmed booking/business/service; a rejecting/throwing mock never blocks the 200 response or the text confirmation; the reject branch never calls it"
    requirement: "D-05"
    verification:
      - kind: integration
        ref: "tests/telegram-webhook.test.ts Tests 17-19"
        status: pass
    human_judgment: false
  - id: D8
    description: "A real client-received .ics file opens correctly and creates a correct event (right date/time/service/business name) in at least one real calendar app (Google Calendar, Apple Calendar, or Outlook) after a real booking approval"
    verification: []
    human_judgment: true
    rationale: "Requires a real Telegram bot delivering a real .ics file to a real device and a real calendar app opening it — cannot be automated in CI (31-VALIDATION.md Manual-Only Verifications: '.ics file opens correctly in Google Calendar / Apple Calendar / Outlook when tapped from Telegram'). This is Task 3, a checkpoint:human-verify task, and remains PENDING — see 'Checkpoint Status' below."

# Metrics
duration: ~25min (Tasks 1-2 only; Task 3 checkpoint pending)
completed: 2026-08-13
status: blocked
---

# Phase 31 Plan 02: Google Calendar Self-Serve Connect — .ics Client Invite Summary

**Hand-rolled RFC 5545 .ics calendar invite generator + new Telegram sendDocument wrapper, wired into the regular open-slot booking-approval flow (D-05) — Tasks 1-2 complete and committed; Task 3 (real calendar-app verification) is a pending checkpoint.**

## Checkpoint Status: PENDING

This plan has 3 tasks. **Tasks 1 and 2 are complete, verified by automated tests, and committed.** Task 3 is a `checkpoint:human-verify` task that requires opening a real `.ics` file (delivered via a real Telegram bot) in a real calendar app — this cannot be automated or faked, per the plan's own instructions and 31-VALIDATION.md's "Manual-Only Verifications" note.

**What still needs to happen (Task 3, per the plan's how-to-verify steps):**
1. As a test client, book an appointment and have the owner approve it.
2. Confirm you receive both the existing text confirmation message AND a `booking.ics` file attachment in the same Telegram chat.
3. Open the `booking.ics` file on at least one real device/calendar app (Google Calendar, Apple Calendar, or Outlook).
4. Confirm the event is created with the correct date/time (matching the bot's text confirmation, converted correctly to your local timezone) and the correct service/business name.

**Resume signal:** Type "approved" once the above steps pass, or describe any issues encountered.

## Testing note (coordinator constraint)

Per an explicit mid-execution instruction from the orchestrator, **no bare/unscoped `npm test` or `npx jest` was ever run during this plan's execution** — every verification below used a scoped `--testPathPattern`. This did not affect coverage of this plan's own changes (all relevant test files were run directly), but it means no full-suite regression pass was performed as part of this plan; that remains the orchestrator's/wave-level responsibility if desired.

## Performance

- **Duration:** ~25 min (Tasks 1-2)
- **Started:** 2026-08-13
- **Tasks:** 2 of 3 completed (Task 3 pending human verification)
- **Files modified:** 7

## Accomplishments

- `src/calendar/sync.ts`: `addMinutesToLocalTime` changed from private to exported — no other behavior change.
- `src/calendar/ics.ts` (new): `generateIcsEvent` builds a single-VEVENT RFC 5545 document with CRLF line endings, a per-booking-unique UID (`booking-${booking.id}@${business.slug}`), DST-correct UTC DTSTART/DTEND derived via the same noon-UTC-anchor + Intl offset trick as `hoursUntilSession`, and RFC 5545-escaped SUMMARY/DESCRIPTION fields. `sendBookingConfirmationIcs` wraps generation + Telegram delivery in a try/catch that only logs — never throws.
- `src/telegram/client.ts`: `sendTelegramDocument` added, mirroring `sendTelegramPhoto`'s exact structure (botTokenStore guard, FormData, `AbortSignal.timeout`, ok-double-check, logging) — differs only in endpoint (`sendDocument`), form field (`document`, no hardcoded MIME type), and caller-supplied filename.
- `src/webhooks/telegram.ts`: one new call to `sendBookingConfirmationIcs` in the approve branch of `handleCallbackQuery`, immediately after the existing client text-confirmation message, guarded by the same `service` truthiness check already used for `syncBookingToCalendar`.
- No new npm packages added — `.ics` generation is hand-rolled string building (~100 lines including comments), and Telegram document delivery reuses the exact `fetch`/`FormData` pattern already established by `sendTelegramPhoto`.

## Task Commits

Each automated task was committed atomically:

1. **Task 1: Generate RFC 5545 .ics invites and add Telegram document delivery** - `5a643a4` (feat)
2. **Task 2: Send the .ics invite on booking confirmation** - `7b99be6` (feat)
3. **Task 3: Manual verification — .ics file opens correctly in a real calendar app** - PENDING (checkpoint:human-verify, not yet started)

## Files Created/Modified

- `src/calendar/sync.ts` - `addMinutesToLocalTime` exported (was private), no behavior change
- `src/calendar/ics.ts` - New: `generateIcsEvent`, `sendBookingConfirmationIcs`, local `escapeIcsText`/`athensLocalToUtcTimestamp`/`toIcsUtcTimestamp` helpers
- `src/telegram/client.ts` - New: `sendTelegramDocument`
- `src/webhooks/telegram.ts` - New import + one call site in the approve branch of `handleCallbackQuery`
- `tests/calendar-ics.test.ts` - New: 10 tests covering `generateIcsEvent` (CRLF/structure, UID uniqueness/stability, DST-correct winter/summer DTSTART, DTEND duration math including a UTC-day-crossing case, RFC 5545 escaping) and `sendBookingConfirmationIcs` (buffer/filename, never-throws)
- `tests/telegram-client.test.ts` - Extended with 4 new tests (15-18) for `sendTelegramDocument`, mirroring Tests 11-14's structure
- `tests/telegram-webhook.test.ts` - Extended with 3 new tests (17-19): single-call-after-text-confirmation ordering, non-blocking-on-rejection, no-call-on-reject-branch

## Decisions Made

- `addMinutesToLocalTime`'s export was a pure visibility change (private → exported) with zero behavior modification, keeping `syncBookingToCalendar`'s existing DTEND math and this plan's new `ics.ts` DTEND math provably identical (same function, same call).
- `athensLocalToUtcTimestamp` reuses the exact DST-safe offset-derivation algorithm already proven in `src/utils/timezone.ts`'s `hoursUntilSession` (anchor noon UTC, read Athens wall-clock hour via `Intl.DateTimeFormat`, derive `offsetHours = athensHour - 12`) rather than introducing a second timezone-conversion implementation or hardcoding a fixed UTC+2/UTC+3 offset (31-RESEARCH.md Pitfall 5).
- The call site in `handleCallbackQuery`'s approve branch has no additional try/catch wrapper around `sendBookingConfirmationIcs` — its own contract (verified by Task 1's Test 10) already guarantees it never throws, so an extra wrapper would be redundant defensive code, per the plan's explicit instruction.

## Deviations from Plan

None — plan executed exactly as written for Tasks 1 and 2. No new npm packages were added. No Rule 1-4 auto-fixes were needed.

## Issues Encountered

None for Tasks 1-2. `npx tsc --noEmit` ran clean after both tasks. All specified `--testPathPattern` commands passed (28/28 for calendar-ics|telegram-client; 48/48 for telegram-webhook, which also matches an adjacent pre-existing client-menu webhook test file by the same pattern substring).

## Next Phase Readiness

- Tasks 1-2's code is complete, tested, and committed — every client whose regular (open-slot) booking is approved now receives a `.ics` calendar invite via Telegram, with zero new OAuth flow and zero new client-side data collection.
- **This plan cannot be marked fully complete until Task 3's real calendar-app verification is manually confirmed** (see "Checkpoint Status" above). No further code changes are expected to be needed for Task 3 — it is pure verification of already-shipped code, unless the manual walkthrough surfaces an issue (e.g., a calendar app failing to recognize the `.ics` MIME type/extension).
- Phase 31 now has both of its plans' Tasks 1-2 code complete (31-01: OAuth self-serve connect; 31-02: this plan's `.ics` invite). Both plans have a pending Task 3 checkpoint requiring human verification before the phase itself can close.

---
*Phase: 31-google-calendar-self-serve-connect-owner-facing-oauth-flow-t*
*Completed: 2026-08-13 (Tasks 1-2; Task 3 pending)*
