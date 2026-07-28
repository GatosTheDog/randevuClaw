---
phase: 29-booking-list-clarity
plan: 04
subsystem: telegram
tags: [telegram, admin-menu, greek-messages, session-manager]

# Dependency graph
requires:
  - phase: 29-booking-list-clarity
    provides: "findSessionInstanceById(businessId, instanceId), BACK_MENU_LABELS.ADMIN, findServiceById (Plan 29-01)"
provides:
  - "showCancelClassConfirm(chatId, business, instanceId) — new business parameter, resolves real session/service context"
  - "showClassesMenu / showCancelClassList — service-name-aware list rendering via batched Map<number,string> lookup"
  - "handleMenuCallback default case — back-to-menu keyboard on unrecognized menuAction"
  - "admin-menu.ts — single BACK_MENU_LABELS.ADMIN source for all back-menu button text (12 usages)"
affects: [29-05, 29-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Batched Map<number,string> service-name lookup (one findServiceById call per distinct serviceId, not per row) — copied verbatim from showTodaysAgenda's existing pattern (Plan 17-02)"
    - "Unrecognized dispatcher action resolves to a usable keyboard, never a dead-end text-only reply (D-05.1)"

key-files:
  created: []
  modified:
    - src/telegram/handlers/admin-menu.ts
    - tests/admin-menu.test.ts

key-decisions:
  - "showCancelClassConfirm's not-found and unknown-service paths were kept as two independent early-exit checks (session null -> return; service null -> string fallback) rather than merged, matching the plan's exact behavior spec."
  - "showCancelClassList batches serviceIds over the capped (post-slice, max 10) list, not the full unsliced sessions array, to avoid resolving names for rows that are never rendered."

requirements-completed: [UX-02, UX-04, UX-06]

coverage:
  - id: D1
    description: "showCancelClassConfirm(chatId, business, instanceId) shows the real session date, time, and resolved service name instead of a bare '#<id>' — with 'Το μάθημα δεν βρέθηκε.' for a missing/cross-business instance and '(άγνωστη υπηρεσία)' fallback for a missing service row (UX-02, D-08)"
    requirement: "UX-02"
    verification:
      - kind: unit
        ref: "tests/admin-menu.test.ts#showCancelClassConfirm — real context instead of raw instance id (D-08)"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D2
    description: "showClassesMenu and showCancelClassList render '${serviceName} - ${date} ${time}' via a batched Map<number,string> lookup (at most 1 findServiceById call per distinct serviceId), with '(άγνωστη υπηρεσία)' fallback for an unresolved service (UX-04, D-10)"
    requirement: "UX-04"
    verification:
      - kind: unit
        ref: "tests/admin-menu.test.ts#showClassesMenu — service names via batched lookup (D-10)"
        status: pass
      - kind: unit
        ref: "tests/admin-menu.test.ts#showCancelClassList — service names via batched lookup (D-10)"
        status: pass
    human_judgment: false
  - id: D3
    description: "handleMenuCallback's default case (an unrecognized/stale menuAction) now sends a back-to-menu keyboard instead of a bare Greek text line with no forward path (UX-06 admin-side Layer 2 gap, D-05.1)"
    requirement: "UX-06"
    verification:
      - kind: unit
        ref: "tests/admin-menu.test.ts#handleMenuCallback — default case (unrecognized menuAction, D-05.1)"
        status: pass
    human_judgment: false
  - id: D4
    description: "All 11 pre-existing inline '« Πίσω στο Μενού' literals plus the new default-case button in admin-menu.ts now source their text from the shared BACK_MENU_LABELS.ADMIN constant (D-07) — rendered text unchanged, 12 total usages"
    verification:
      - kind: other
        ref: "grep -c BACK_MENU_LABELS.ADMIN src/telegram/handlers/admin-menu.ts (12) / grep -c '« Πίσω στο Μενού' (0)"
        status: pass
      - kind: unit
        ref: "tests/admin-menu.test.ts (all pre-existing back-menu-keyboard assertions, unmodified, still pass)"
        status: pass
    human_judgment: false

duration: 9min
completed: 2026-07-28
status: complete
---

# Phase 29 Plan 04: Admin-side booking-list clarity — cancel-confirm context, service names, dead-end recovery, back-menu consolidation Summary

**showCancelClassConfirm now renders the real session date/time/service name instead of a raw `#42` id; showClassesMenu and showCancelClassList show the service name via a batched (non-N+1) lookup; an unrecognized admin menu tap gets a working back-to-menu button instead of a dead end; all 12 back-menu button renders in admin-menu.ts now source from one shared BACK_MENU_LABELS.ADMIN constant.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-28T22:09:00+03:00 (approx)
- **Completed:** 2026-07-28T22:18:00+03:00 (approx)
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments
- `showCancelClassConfirm(chatId, business, instanceId)` gained a `business` parameter, calls `findSessionInstanceById` + `findServiceById` to render `Να ακυρωθεί το μάθημα:\n${serviceName}\n${date} ${time};` — replacing the old `Να ακυρωθεί το μάθημα #${instanceId};`. Not-found session -> `'Το μάθημα δεν βρέθηκε.'` with no keyboard; unresolved service -> `'(άγνωστη υπηρεσία)'` fallback (UX-02, D-08).
- `showClassesMenu` and `showCancelClassList` both batch-resolve service names into a `Map<number,string>` (one `findServiceById` call per distinct `serviceId`, proven via a dedicated N+1-guard test) and render `${serviceName} - ${date} ${time}` lines/buttons instead of bare date/time (UX-04, D-10).
- `handleMenuCallback`'s `default:` case now sends a back-to-menu keyboard (`BACK_MENU_LABELS.ADMIN` -> `menu:root`) instead of a bare `'Άγνωστη ενέργεια μενού.'` text message with no forward path (UX-06 admin-side Layer 2 gap, D-05.1).
- All 11 pre-existing inline `'« Πίσω στο Μενού'` literals in `admin-menu.ts` plus the new default-case button (12 total) now import and use the shared `BACK_MENU_LABELS.ADMIN` constant from `src/utils/greek-messages.ts` (D-07) — rendered text is byte-for-byte unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: showCancelClassConfirm shows date + service name instead of a raw instance id (D-08, D-06)** - `b71853c` (feat)
2. **Task 2: showClassesMenu and showCancelClassList show service names (D-10)** - `bccb499` (feat)
3. **Task 3: Default-case recovery keyboard (D-05.1) + consolidate back-menu literals onto BACK_MENU_LABELS (D-07)** - `e7274f6` (feat)

**Plan metadata:** (this commit, follows this SUMMARY)

## Files Created/Modified
- `src/telegram/handlers/admin-menu.ts` - `showCancelClassConfirm` new `business` param + real context; `showClassesMenu`/`showCancelClassList` batched service-name lookup; `handleMenuCallback` default-case keyboard; all back-menu literals replaced with `BACK_MENU_LABELS.ADMIN`
- `tests/admin-menu.test.ts` - new describe blocks for `showCancelClassConfirm`, `showClassesMenu`, `showCancelClassList` (happy path, not-found, unknown-service fallback, N+1-guard), and `handleMenuCallback`'s default case

## Decisions Made
- Kept `showCancelClassConfirm`'s not-found (`session === null`) and unknown-service (`service === null`) paths as two independent checks rather than merging them, matching the plan's exact behavior spec (early return with no keyboard for not-found; string fallback, keyboard still sent, for unknown service).
- `showCancelClassList` batches `serviceIds` over the already-capped (`slice(0, 10)`) session list, not the full unsliced `sessions` array, avoiding wasted `findServiceById` calls for rows that are never displayed — called out explicitly in the plan's action step.

## Deviations from Plan

None - plan executed exactly as written. All acceptance criteria for all 3 tasks passed on the first implementation attempt; no Rule 1-4 auto-fixes were needed.

## Issues Encountered

- **Local test-DB port mismatch (environment-only, not a code issue):** same pre-existing environment quirk documented in `29-01-SUMMARY.md` — the test suite's fallback DB URL resolves to the wrong Postgres container in this dev environment. All verification in this plan was run with `SESSION_TEST_DATABASE_URL=postgresql://manolis:password@localhost:5433/randevuclaw_test` explicitly set, per the plan's environment note. No code changes made for this — out of scope.
- `tests/admin-menu.test.ts` was not touched in a way that intersects the documented pre-existing `tests/session-booking-flow.test.ts` SBOK-04 failure (that file was not modified by this plan).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The admin-side halves of UX-02, UX-04, and UX-06 are now closed; `admin-menu.ts` has zero remaining `« Πίσω στο Μενού'` inline literals (confirmed via grep: 0 matches, 12 `BACK_MENU_LABELS.ADMIN` usages).
- `npm test -- --testPathPattern="admin-menu" --testTimeout=20000` is fully green (31/31 tests). `npx tsc --noEmit` passes clean.
- Ready for the remaining Wave 2 plans of Phase 29 (client-side halves in 29-05/29-06, if not already complete).

---
*Phase: 29-booking-list-clarity*
*Completed: 2026-07-28*

## Self-Check: PASSED

- Both key-files (`src/telegram/handlers/admin-menu.ts`, `tests/admin-menu.test.ts`) confirmed present on disk.
- All 3 task commits (`b71853c`, `bccb499`, `e7274f6`) confirmed present in git log (`git log --oneline -3`).
- All 31 tests in `npm test -- --testPathPattern="admin-menu" --testTimeout=20000` pass (22 pre-existing tests + 9 new tests added across Tasks 1-3 = 31 passing, 0 failing).
- `npx tsc --noEmit` passes clean.
- Re-ran all `<acceptance_criteria>` from every task: all PASS (verified via the grep counts above and the full test run).
- Re-ran the plan-level `<verification>`: `npm test -- --testPathPattern="admin-menu" --testTimeout=20000` (31/31 pass) and `npx tsc --noEmit` (clean) — both match the plan's required commands.
