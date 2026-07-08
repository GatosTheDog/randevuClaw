---
phase: 02-ai-booking-conversations-owner-alerts
plan: 3
subsystem: booking-logic
tags: [availability, timezone, greek-nlp, intl, jest]

requires:
  - phase: 02-ai-booking-conversations-owner-alerts
    provides: "Typed query layer (findServiceById, findBusinessHoursForDay, findActiveBookingSlotsForDate, expireStalePendingBookings) from Plan 02-01, with per-booking duration already correct in the JOIN"
provides:
  - "checkAvailability(businessId, serviceId, calendarDate, referenceNow?) — 1-hour-granularity slot computation using each booking's own service duration, closed-day handling, stale-pending sweep, and past-slot filtering for today"
  - "resolveGreekTemporalExpressions(text, referenceDate) — colloquial Greek date/time phrase resolution appended as a system hint before the message reaches Gemini"
  - "isoDateInAthens/weekdayOfIsoDate/addCalendarDays — DST-safe Europe/Athens calendar-date arithmetic with zero new date-library dependency"
affects: [02-04, 02-05]

tech-stack:
  added: []
  patterns:
    - "Noon-UTC-anchor trick (new Date(`${isoDate}T12:00:00Z`)) for DST-safe weekday/day-arithmetic without a date library or repeated Intl calls"
    - "Ordered-pattern-list matching for Greek temporal-expression extraction: most-specific keyword checked before its substring-colliding sibling (μεθαύριο before αύριο), and a 3-tier time-regex fallback (στις-anchored -> bare+marker -> leading-bare) to avoid misreading stray digits as clock times"
    - "Mocked-query-layer unit tests (jest.mock('../src/database/queries')) for pure business-logic modules that only need typed query contracts, not a live/local Postgres connection"

key-files:
  created:
    - src/utils/timezone.ts
    - src/conversation/greek-preprocessor.ts
    - src/business/availability.ts
    - tests/timezone.test.ts
    - tests/greek-preprocessor.test.ts
    - tests/availability.test.ts
  modified: []

key-decisions:
  - "Time-of-day words (πρωί/απόγευμα/μεσημέρι/βράδυ) alone, with no accompanying weekday/relative-day keyword or digit, never resolve to a date or time — only act as AM/PM context once a hard date+hour anchor already exists (matches corpus Test 2, 16)"
  - "Time extraction only fires on 3 explicit shapes (στις-prefixed, bare-number-with-marker, leading-bare-number) rather than any bare digit anywhere in the text, specifically to avoid misreading numbers like the '3' in 'σε 3 μέρες' as a clock time"
  - "checkAvailability treats findActiveBookingSlotsForDate's return value as the sole source of truth for which bookings are active — it applies no independent status re-filtering, since the query layer (Plan 02-01) already scopes to pending_owner_approval/confirmed"
  - "expireStalePendingBookings failures are caught and logged, never propagated — a transient sweep failure must not block an availability read"

patterns-established:
  - "Pattern: ordered pattern-list matching where substring-colliding keywords are checked most-specific-first (prevents 'μεθαύριο' being misread as 'αύριο')"
  - "Pattern: noon-UTC-anchored date arithmetic as the DST-safe alternative to a date library for Europe/Athens calendar-date math"

requirements-completed: [BOOK-03]

coverage:
  - id: D1
    description: "checkAvailability computes correct 1-hour-granularity slots, using each existing booking's OWN service duration rather than the caller's requested duration, and respects closed business-hours days"
    requirement: "BOOK-03"
    verification:
      - kind: unit
        ref: "tests/availability.test.ts — Test 1 (hourly 08:00..20:00), Test 2 (excludes 10:00 via the existing 55-min booking, not the requested 50-min service), Test 4 (closed day)"
        status: pass
    human_judgment: false
  - id: D2
    description: "checkAvailability applies no independent booking-status filtering beyond what findActiveBookingSlotsForDate already returns (a rejected booking never occupies a slot), returns a structured service_not_found error for an unknown serviceId, sweeps stale pending bookings (2h cutoff) before reading active bookings, and never offers a slot that has already passed today in Athens wall-clock time"
    requirement: "BOOK-03"
    verification:
      - kind: unit
        ref: "tests/availability.test.ts — Test 3 (rejected booking), Test 5 (unknown service), Test 6 (stale-sweep call args), plus 2 additional tests (sweep-failure resilience, past-slot filtering)"
        status: pass
    human_judgment: false
  - id: D3
    description: "resolveGreekTemporalExpressions resolves the full 20-phrase Greek colloquial date/time corpus (relative days, weekday nominative/genitive forms, bare-hour AM/PM heuristics, explicit π.μ./μ.μ. markers, undotted variants, reversed word order) deterministically against a fixed reference instant"
    requirement: "BOOK-03"
    verification:
      - kind: unit
        ref: "tests/greek-preprocessor.test.ts — 20 corpus-phrase tests plus annotation/robustness tests (empty string, no-Greek-content)"
        status: pass
    human_judgment: false
  - id: D4
    description: "isoDateInAthens/weekdayOfIsoDate/addCalendarDays are DST-safe and independent of the server process's own local timezone"
    requirement: "BOOK-03"
    verification:
      - kind: unit
        ref: "tests/timezone.test.ts — January UTC+2 rollover case, weekday lookups, same-month and month-rollover addition"
        status: pass
    human_judgment: false

duration: ~15min
completed: 2026-07-08
status: complete
---

# Phase 2 Plan 3: Availability Engine & Greek Temporal Preprocessing Summary

**checkAvailability (1-hour slots, per-booking duration correctness, closed-day/stale-sweep handling) and resolveGreekTemporalExpressions (20-phrase validated Greek colloquial date/time corpus), both pure Athens-timezone-correct modules with zero new date-library dependency**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2/2 completed
- **Files modified:** 6 (all created, 0 modified)

## Accomplishments
- `src/utils/timezone.ts`: `isoDateInAthens`, `weekdayOfIsoDate`, `addCalendarDays` — all noon-UTC-anchored so a UTC-hosted fly.io Machine still resolves "today" correctly for Europe/Athens, with zero new dependency (no date-fns)
- `src/conversation/greek-preprocessor.ts`: `resolveGreekTemporalExpressions` resolves the full 20-phrase Greek colloquial corpus (relative days, weekday nominative/genitive forms, bare-hour AM/PM heuristics, explicit markers with dotted/undotted variants, and reversed time-before-weekday word order) into an unambiguous ISO date/24h-time hint appended before the message reaches Gemini
- `src/business/availability.ts`: `checkAvailability` computes 1-hour-granularity open slots for a service on a date, fixing RESEARCH.md's "assume caller's duration" bug by reading each existing booking's own duration from `findActiveBookingSlotsForDate`'s JOIN, sweeping stale pending bookings first, handling closed days and unknown services as structured (non-throwing) results, and never offering a slot that has already passed today
- 37 tests across 3 new test files, all passing; full regression suite (94/94) and `npx tsc --noEmit` both clean

## Task Commits

1. **Task 1: Europe/Athens date utilities and Greek temporal-expression preprocessor** - `26cd5a4` (feat)
2. **Task 2: Availability engine — 1-hour slots, correct per-booking duration, closed-day handling** - `3b69270` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/utils/timezone.ts` - `isoDateInAthens`, `weekdayOfIsoDate`, `addCalendarDays` (DST-safe, noon-UTC-anchored)
- `src/conversation/greek-preprocessor.ts` - `TemporalResolution` interface, `resolveGreekTemporalExpressions`
- `src/business/availability.ts` - `AvailabilityResult` interface, `checkAvailability`
- `tests/timezone.test.ts` - 6 tests: January UTC+2 rollover, weekday lookups, day addition/month rollover
- `tests/greek-preprocessor.test.ts` - 23 tests: all 20 corpus phrases + annotation/empty-string/no-Greek-content robustness
- `tests/availability.test.ts` - 8 tests: hourly slot generation, per-booking-duration exclusion, rejected-booking non-exclusion, closed day, unknown service, stale-sweep call args, sweep-failure resilience, past-slot filtering

## Decisions Made
- Time-of-day words alone (no weekday/relative-day keyword, no digit) never resolve a date or time on their own — they only disambiguate AM/PM once a real hour digit is already present (corpus Test 2 and 16 both require this)
- Time extraction fires only on 3 explicit shapes (an `στις`-anchored match, a bare number with an adjacent am/pm marker, or a bare number at the very start of the text) rather than any bare digit anywhere, specifically so a stray number like the "3" in "σε 3 μέρες" is never misread as a clock time
- `checkAvailability` treats `findActiveBookingSlotsForDate`'s return value as the sole source of truth for active bookings — no independent status re-filtering, trusting Plan 02-01's query-layer scoping to `pending_owner_approval`/`confirmed`
- `expireStalePendingBookings` failures are caught, logged, and swallowed — a transient sweep failure must never block an availability read (verified with a dedicated resilience test beyond the plan's 6 named behavior cases)

## Deviations from Plan

None - plan executed exactly as written. One test beyond the plan's 6 named behavior cases was added (sweep-failure resilience) plus one additional test for the "past slot for today" behavior described in the plan's `<action>` step but not enumerated among the 6 named `<behavior>` tests — both are additive coverage, not deviations, and both pass.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. Both modules are pure/mocked-query-layer and require no live database or third-party credential to test or run.

## Next Phase Readiness
- `checkAvailability` and `resolveGreekTemporalExpressions` are locked exactly to the `<interfaces>` contract this plan's frontmatter specifies — Plan 02-04 (AI agent/Gemini function-calling integration) can import both verbatim
- The per-booking-duration correctness fix (T-02-09) and the Athens-timezone-correct date arithmetic are both proven via unit tests, not just typechecking
- No blockers for Plan 02-04

---
*Phase: 02-ai-booking-conversations-owner-alerts*
*Completed: 2026-07-08*

## Self-Check: PASSED

All claimed files verified present: src/utils/timezone.ts, src/conversation/greek-preprocessor.ts, src/business/availability.ts, tests/timezone.test.ts, tests/greek-preprocessor.test.ts, tests/availability.test.ts.
All claimed commits verified present: 26cd5a4, 3b69270.
