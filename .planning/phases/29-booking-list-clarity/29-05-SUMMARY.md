---
phase: 29-booking-list-clarity
plan: 05
subsystem: telegram
tags: [telegram, greek-messages, session-manager, drizzle-consolidation]

# Dependency graph
requires:
  - phase: 29-01
    provides: "listSessions(businessId, limitDays, excludePastToday), findSessionInstanceById(businessId, instanceId), BACK_MENU_LABELS.CLIENT"
provides:
  - "showClientRootMenu's booking button label reflects business.bookingMode ('Κράτηση μαθήματος' vs 'Κράτηση ραντεβού')"
  - "showBookSessionList excludes same-day past-time sessions (excludePastToday=true), offers a back button on the open-slot redirect, and shows service names per row"
  - "handleBookSessionExecute resolves session data via the shared, businessId-scoped findSessionInstanceById helper instead of an inline unscoped Drizzle join"
affects: [29-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Batched Map<number,string> service-name lookup before rendering a list, capped at 1 findServiceById call per distinct serviceId (mirrors src/scheduler/agenda.ts's formatAgendaMessage pattern)"

key-files:
  created: []
  modified:
    - src/telegram/handlers/client-menu.ts
    - tests/webhooks/client-menu.test.ts

key-decisions:
  - "Task 3's acceptance criterion 'zero remaining occurrences of « Αρχικό μενού» anywhere in this file' was only partially honored: the occurrence inside handleBookSessionExecute (this plan's scope) was consolidated onto BACK_MENU_LABELS.CLIENT; the sibling occurrence inside handleCancelExecute was deliberately left untouched because the dispatching prompt explicitly reserved handleCancelExecute for Plan 29-06. The explicit cross-plan scope boundary takes precedence over the task-level acceptance criterion's overreach into another plan's territory."
  - "The plan's per-task read_first pointed at hoursUntilSession-consolidation context from Plan 29-01, but this plan's scope never touches client-menu.ts's own local hoursUntilSession helper (used only by handleCancelExecute) — left untouched, consistent with the handleCancelExecute scope boundary above."

requirements-completed: [UX-01, UX-04, UX-05]

coverage:
  - id: D1
    description: "showClientRootMenu's booking button reads 'Κράτηση μαθήματος' for fixed_sessions businesses and 'Κράτηση ραντεβού' for open_slots businesses (D-03); the stale void business; placeholder is removed"
    requirement: "UX-05"
    verification:
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts#showClientRootMenu: booking button label reflects bookingMode (D-03)"
        status: pass
    human_judgment: false
  - id: D2
    description: "showBookSessionList calls listSessions(business.id, 14, true), so a same-day class whose start time has already passed is never shown in the /menu booking list (client-side half of UX-01)"
    requirement: "UX-01"
    verification:
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts#book — fixed_sessions business → listSessions called with (business.id, 14, true) (D-01)"
        status: pass
    human_judgment: false
  - id: D3
    description: "showBookSessionList's open-slot redirect now sends a keyboard with a '« Πίσω' back button (previously dead-ended with no way back), matching the sibling no-availability branch's existing pattern (D-04)"
    requirement: "UX-05"
    verification:
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts#book — business.bookingMode === open_slots → back-button keyboard sent, listSessions NOT called (D-04)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Each row in showBookSessionList's keyboard reads '{service name} - {date} {time}' via a batched Map<number,string> findServiceById lookup (at most 1 call per distinct serviceId among available sessions); an unresolved serviceId falls back to '(άγνωστη υπηρεσία)' (D-10)"
    requirement: "UX-04"
    verification:
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts#book — available sessions render with the resolved service name alongside date/time (D-10)"
        status: pass
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts#book — a serviceId with no matching service falls back to \"(άγνωστη υπηρεσία)\" (D-10)"
        status: pass
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts#book — 2 available sessions sharing one serviceId result in exactly 1 findServiceById call (batching)"
        status: pass
    human_judgment: false
  - id: D5
    description: "handleBookSessionExecute resolves serviceId/sessionDate/sessionTime via findSessionInstanceById(business.id, instanceId) instead of its own inline, businessId-unscoped Drizzle join; the null-lookup path (not found, wrong business, or cancelled) sends 'Το μάθημα δεν βρέθηκε.' and never calls bookSessionInstance (D-06); dead db/schema/eq imports removed"
    requirement: "UX-01"
    verification:
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts#book:yes — findSessionInstanceById returns null → \"Το μάθημα δεν βρέθηκε.\" sent, bookSessionInstance NOT called (D-06)"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit"
        status: pass
    human_judgment: false

duration: 7min
completed: 2026-07-28
status: complete
---

# Phase 29 Plan 05: Client /menu booking flow — same-day exclusion, open-slot labeling, service names, shared session lookup Summary

**client-menu.ts's `/menu` → "Κράτηση μαθήματος" flow now excludes already-started same-day classes, labels its root-menu button and redirect text correctly for open-slot businesses with a working back button, shows service names next to each date/time, and resolves session data through the shared businessId-scoped `findSessionInstanceById` helper instead of an unscoped inline Drizzle join.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-07-28T22:30:00+03:00 (approx)
- **Completed:** 2026-07-28T22:36:38+03:00
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments
- `showClientRootMenu`'s booking button now reads `Κράτηση μαθήματος` for `fixed_sessions` businesses and `Κράτηση ραντεβού` for `open_slots` businesses (D-03) — the client sees an accurate label before ever tapping the button. The stale `void business;` suppress-comment is gone since `business` is now genuinely read.
- `showBookSessionList` calls `listSessions(business.id, 14, true)` — a same-day class that has already started never appears in the `/menu` booking list, completing the client-side half of UX-01 (Plan 29-02 already covered the free-chat AI tool layer).
- `showBookSessionList`'s open-slot redirect branch now sends a keyboard with a `« Πίσω` back button instead of dead-ending with no way back (D-04), and its text reads "...κράτηση ραντεβού..." to stay consistent with Task 1's new button label.
- Each row in the book-a-class list now reads `{service name} - {date} {time}` via a batched `Map<number,string>` lookup capped at 1 `findServiceById` call per distinct `serviceId` among the available sessions (D-10); an unresolved `serviceId` falls back to `(άγνωστη υπηρεσία)`.
- `handleBookSessionExecute` resolves `serviceId`/`sessionDate`/`sessionTime` via a single `findSessionInstanceById(business.id, instanceId)` call instead of its own inline, businessId-unscoped Drizzle join (D-06) — this also closes an incidental information-disclosure gap (T-29-01) where the old read-side lookup had no businessId filter at all. Dead `db`/`sessionInstances`/`sessionCatalog`/`eq` imports are removed.
- 3 of the file's 4 remaining `'« Πίσω'`/`'« Αρχικό μενού'` inline literals within this plan's scope are consolidated onto `BACK_MENU_LABELS.CLIENT` (D-07); the 4th (inside `handleCancelExecute`) is explicitly out of scope — see Deviations.

## Task Commits

Each task was committed atomically:

1. **Task 1: Relabel the root-menu booking button for non-fixed_sessions businesses (D-03)** - `1597cd8` (feat)
2. **Task 2: showBookSessionList — exclude past-time sessions, add back-button to the redirect, show service names (D-01, D-04, D-10)** - `f536509` (feat)
3. **Task 3: handleBookSessionExecute uses findSessionInstanceById instead of its own inline join (D-06)** - `33387fa` (refactor)

**Plan metadata:** (this commit, follows this SUMMARY)

## Files Created/Modified
- `src/telegram/handlers/client-menu.ts` - booking button label conditional on `bookingMode`; `showBookSessionList` gains `excludePastToday=true`, a back-button on its redirect, and batched service-name enrichment; `handleBookSessionExecute` uses `findSessionInstanceById`, dead Drizzle imports removed
- `tests/webhooks/client-menu.test.ts` - new `showClientRootMenu` label suite; updated open-slot redirect assertion; new listSessions-args/service-name/fallback/batching tests; `book:yes` tests re-mocked onto `findSessionInstanceById`; new null-lookup test

## Decisions Made
- The Task 3 acceptance criterion "zero remaining occurrences of `« Αρχικό μενού` anywhere in this file" was only partially satisfied: the occurrence inside `handleBookSessionExecute` (in scope) is now `BACK_MENU_LABELS.CLIENT`; the sibling occurrence inside `handleCancelExecute` was left untouched because the dispatching instructions explicitly reserved `handleCancelExecute` for Plan 29-06. The cross-plan scope boundary set by the orchestrator takes precedence over this single acceptance-criterion line, which appears to have been written before the file was split across two sequential plans. Plan 29-06 should complete this consolidation.
- `client-menu.ts`'s own local `hoursUntilSession` helper (used only by `handleCancelExecute`'s cutoff check) was left untouched for the same reason — it is not read by any function this plan edits.

## Deviations from Plan

None requiring auto-fixes — all 3 tasks' code changes matched the plan's `<action>` blocks exactly. One acceptance-criterion line ("zero remaining `« Αρχικό μενού` occurrences anywhere in this file") could not be fully satisfied without violating the explicit cross-plan scope boundary in the dispatching instructions ("do not touch ... handleCancelExecute; those are 29-06's job"). Per the priority ordering (explicit orchestrator scope boundary > an internal acceptance-criterion detail that conflicts with it), the boundary was honored and the acceptance criterion is documented here as intentionally not fully met — see Decisions Made above. 1 occurrence of `« Αρχικό μενού` remains, inside `handleCancelExecute`, for Plan 29-06 to resolve.

**Total deviations:** 0 auto-fixed; 1 documented scope-conflict resolution (favoring the explicit cross-plan boundary).
**Impact on plan:** None on this plan's own correctness — all of this plan's own `must_haves` and `success_criteria` are met. The 1 remaining `« Αρχικό μενού` literal is functionally correct (unchanged behavior), just not yet consolidated onto the shared constant; Plan 29-06 already has direct ownership of that function and can absorb this trivial one-line change alongside its own UX-02 work there.

## Issues Encountered

- **Local test-DB port mismatch (environment-only, pre-existing, same as Plans 29-01/29-02):** ran all verification with `SESSION_TEST_DATABASE_URL=postgresql://manolis:password@localhost:5433/randevuclaw_test` explicitly set, per the documented dev-environment quirk. No code changes made for this.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `showClientRootMenu`, `showBookSessionList`, and `handleBookSessionExecute` are fully updated per this plan's scope; `tests/webhooks/client-menu.test.ts` is fully green (52/52 tests) and `npx tsc --noEmit` passes clean.
- Plan 29-06 (Wave 3) can now safely proceed with `showClientBookings`, `showCancelBookingList`, `showCancelConfirm`, and `handleCancelExecute` in the same file — this plan touched none of those functions.
- Plan 29-06 should additionally pick up the 1 remaining `« Αρχικό μενού` literal inside `handleCancelExecute` (documented above) while it is already touching that function for its own UX-02 work, completing D-07's client-side consolidation.

---
*Phase: 29-booking-list-clarity*
*Completed: 2026-07-28*

## Self-Check: PASSED

- Both key-files (`src/telegram/handlers/client-menu.ts`, `tests/webhooks/client-menu.test.ts`) confirmed present on disk.
- All 3 task commits (`1597cd8`, `f536509`, `33387fa`) confirmed present in `git log`.
- `npm test -- --testPathPattern="client-menu" --testTimeout=20000` (with `SESSION_TEST_DATABASE_URL` set): 52/52 tests pass.
- `npx tsc --noEmit` passes clean.
- `grep -n "db\.select({ serviceId"` and a search for `sessionInstances|sessionCatalog|drizzle-orm` imports in `src/telegram/handlers/client-menu.ts` both return zero matches — the dead inline join and its imports are fully removed.
- `grep -n "Αρχικό μενού" src/telegram/handlers/client-menu.ts` returns exactly 1 match (inside `handleCancelExecute`, out of this plan's scope — see Deviations).
- Verified zero files outside the plan's declared `files_modified` were touched.
