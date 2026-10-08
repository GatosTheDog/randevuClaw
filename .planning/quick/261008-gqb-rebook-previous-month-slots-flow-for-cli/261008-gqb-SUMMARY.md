---
phase: quick-261008-gqb
plan: 01
subsystem: conversation / session booking
tags: [rebook, fixed_sessions, multi-booking, gemini-tools, credits]
status: complete
requires:
  - session manager (listSessions, bookSessionInstance)
  - billing (getClientActiveMembership, checkEnforcementAndGetMembership)
provides:
  - list_previous_month_slots AI tool (read-only)
  - credit-safe shared multi-booking helper (bookSessionInstancesInOrder)
  - src/session/rebook.ts pure helpers
affects:
  - book_session multi-booking path (now dedupes, chronological, stops at remaining credits)
key-files:
  created:
    - src/session/rebook.ts
    - tests/session-rebook.test.ts
    - tests/session-rebook-tool.test.ts
  modified:
    - src/database/queries.ts
    - src/conversation/function-executor.ts
    - src/conversation/ai-agent.ts
    - tests/ai-agent.test.ts
decisions:
  - "Previous month = previous calendar month in Europe/Athens; slot = (weekday, time, service) from CONFIRMED session bookings."
  - "Feature gated by existing allowMultiBooking + fixed_sessions; no schema change."
  - "Server returns Greek weekday_name next to every date so the model never computes weekdays."
metrics:
  tasks: 3
  files: 7
completed: 2026-10-08
---

# Quick 261008-gqb: Rebook previous-month slots flow for clients

A client of a fixed_sessions business with multi-booking enabled can now say "τα ίδια με τον προηγούμενο μήνα"; the bot calls `list_previous_month_slots`, lists last month's weekly slots, asks in Greek whether to rebook all or customise, and books via the existing `book_session` multi-booking path only after the client answers.

## What was built

- **src/session/rebook.ts** (pure, no DB): `previousMonthRange`, `deriveWeeklySlots`, `weeklySlotKey`, `groupUpcomingByWeeklySlot` (unavailable reasons with precedence already_booked > after_membership_expiry > full), `buildRebookProposal`, `formatWeeklySlotLine`, `GREEK_WEEKDAY_NAMES`.
- **src/database/queries.ts**: `listClientConfirmedSessionBookingsInRange` (confirmed + session-instance bookings of one client, inclusive date range).
- **src/conversation/function-executor.ts**: `list_previous_month_slots` tool (gating: not_fixed_sessions, multi_booking_disabled, no_membership; returns previous_slots, other_weekly_slots, summary_lines, suggested_question, membership, max_bookable, total_proposed_sessions, exceeds_credits). The multi-booking loop of `book_session` was extracted into `bookSessionInstancesInOrder`: de-duplicates ids, processes chronologically and sequentially, stops at remaining credits (extra ids returned in new `insufficient_credit_instance_ids`), owner approval keyboard behavior unchanged.
- **src/conversation/ai-agent.ts**: tool declared in `BOOKING_TOOLS`; `book_session` description extended; three Greek prompt rules emitted only for fixed_sessions + allowMultiBooking.

## Commits

- 8fd86ff feat: pure rebook module and client confirmed-bookings range query
- 51dff16 feat: list_previous_month_slots tool and credit-safe multi-booking helper
- 1f521cd feat: declare list_previous_month_slots and add Greek rebook prompt rules

## Verification

- tests/session-rebook.test.ts: 15 pass; tests/session-rebook-tool.test.ts: 9 pass; tests/ai-agent.test.ts: 18 pass (3 new).
- Regression run across session-booking-flow, book-session-deadlock, session-booking-ambient-lock, function-executor-calendar, webhooks/client-menu: 174 pass, 1 fail = the pre-existing, untouched "SBOK-04 multi-booking partial success".
- `tsc --noEmit` reports no errors in touched files.

## Deviations from Plan

None - plan executed as written. (Added one extra integration test, "3b", asserting the `full` reason within membership validity, since case 3's full-instance assertion depends on the run date relative to membership expiry.)

## Known Stubs

None.

## Threat Flags

None. Client identity comes only from ToolContext; cross_tenant_denied check runs before the tool (T-gqb-01); credit cap and id de-duplication implemented (T-gqb-03/04).

## Self-Check: PASSED

Files and commits 8fd86ff, 51dff16, 1f521cd verified present in git log.
