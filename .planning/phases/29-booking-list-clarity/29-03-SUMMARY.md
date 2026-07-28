---
phase: 29-booking-list-clarity
plan: 03
subsystem: api
tags: [telegram, webhook, callback-recovery, drizzle]

# Dependency graph
requires:
  - phase: 29-01
    provides: "findSessionInstanceById(businessId, instanceId) and BACK_MENU_LABELS (ADMIN/CLIENT)"
provides:
  - "handleCallbackQuery's null-parse branch (Layer 1) sends a Greek back-menu recovery message instead of a silent drop"
  - "The legacy approve_/reject_ 'booking not found' branch sends the same ADMIN back-menu recovery message instead of a silent drop"
  - "escl:approve resolves serviceId via the businessId-scoped findSessionInstanceById instead of an ad-hoc unscoped Drizzle join"
affects: [29-04, 29-05, 29-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Recovery-keyboard identity check reuses the exact `business.ownerTelegramId === senderTelegramId` idiom already used elsewhere in telegram.ts, rather than inventing a new pattern"

key-files:
  created: []
  modified:
    - src/webhooks/telegram.ts
    - tests/telegram-webhook.test.ts

key-decisions:
  - "The legacy approve_/reject_ 'booking not found' branch always uses the ADMIN back-menu label unconditionally (no ownership check added) since that path is owner-only by construction — matches the plan's explicit instruction not to invent a new identity check where none existed."
  - "escl:approve's serviceId lookup swap to findSessionInstanceById is a pure read-path fix; bookSessionInstance's own businessId-scoped capacity guard (T-10-02) was already safe and is unchanged."

requirements-completed: [UX-06]

coverage:
  - id: D1
    description: "handleCallbackQuery's null-parse (Layer 1) branch sends a Greek recovery message with a back-to-menu keyboard, selecting ADMIN vs CLIENT label/destination based on verified business.ownerTelegramId === senderTelegramId identity, instead of a fully silent drop"
    requirement: "UX-06"
    verification:
      - kind: integration
        ref: "tests/telegram-webhook.test.ts#Test 9: malformed callback data — acks (dismiss spinner) but never looks up or mutates a booking, and sends a CLIENT back-menu recovery keyboard (D-05 Layer 1)"
        status: pass
      - kind: integration
        ref: "tests/telegram-webhook.test.ts#Test 9b: malformed callback data from the actual business owner sends the ADMIN back-menu recovery keyboard (D-05 Layer 1)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The legacy approve_/reject_ 'booking not found' branch sends the ADMIN back-menu recovery message unconditionally instead of a silent log-and-return"
    requirement: "UX-06"
    verification:
      - kind: integration
        ref: "tests/telegram-webhook.test.ts#Test 10: nonexistent booking id — no crash, no mutation, still 200, and sends the ADMIN back-menu recovery keyboard unconditionally (D-05 Layer 1, legacy branch)"
        status: pass
    human_judgment: false
  - id: D3
    description: "escl:approve's serviceId lookup uses the businessId-scoped findSessionInstanceById(ownerBusiness.id, instanceId) instead of an ad-hoc, businessId-unscoped Drizzle join, incidentally closing a cross-business information-read gap (T-29-06); dead db/schema/eq imports removed"
    verification:
      - kind: other
        ref: "npx tsc --noEmit"
        status: pass
      - kind: other
        ref: "grep confirms no db/sessionInstances/sessionCatalog/eq references remain in src/webhooks/telegram.ts"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-28
status: complete
---

# Phase 29 Plan 03: Callback recovery + cross-business join cleanup in telegram.ts Summary

**Closed both remaining D-05 silent-drop gaps in handleCallbackQuery (unparseable callback_data and the legacy approve_/reject_ "booking not found" branch) with Greek back-menu recovery messages, and swapped escl:approve's ad-hoc unscoped Drizzle join for the businessId-scoped findSessionInstanceById helper.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-28T22:04:00+03:00 (approx)
- **Completed:** 2026-07-28T22:19:35+03:00
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `src/webhooks/telegram.ts`'s `handleCallbackQuery` no longer silently drops a callback_query whose `data` fails `parseCallbackData()` — sends 'Η ενέργεια δεν αναγνωρίστηκε.' plus a back-menu keyboard, picking the ADMIN (`menu:root`) or CLIENT (`cmenu:root`) destination via the file's existing `business.ownerTelegramId === senderTelegramId` identity idiom (D-05 Layer 1).
- The legacy `approve_<id>`/`reject_<id>` "booking not found" branch sends 'Η κράτηση δεν βρέθηκε.' plus the ADMIN back-menu keyboard unconditionally instead of only logging a warning — this path is owner-only by construction, so no new identity check was added.
- `escl:approve`'s serviceId resolution now calls `findSessionInstanceById(ownerBusiness.id, escl.instanceId)` (D-06, from Plan 29-01) instead of its own inline `db.select(...).innerJoin(...)` — the old join had no businessId filter at all, so this incidentally closes a minor cross-business information-read gap (T-29-06). The now-dead `db`, `sessionInstances`/`sessionCatalog`, and `eq` imports were removed (confirmed unused elsewhere via grep before removal).

## Task Commits

Each task was committed atomically:

1. **Task 1: Back-menu recovery for malformed callback_data and unknown legacy bookings (D-05 Layer 1)** - `3448c82` (fix)
2. **Task 2: escl:approve uses findSessionInstanceById instead of its own unscoped join (D-06)** - `0130d82` (refactor)

**Plan metadata:** (this commit, follows this SUMMARY)

## Files Created/Modified
- `src/webhooks/telegram.ts` - null-parse branch and legacy "booking not found" branch now send Greek back-menu recovery keyboards; `escl:approve` uses `findSessionInstanceById` instead of an ad-hoc join; dead `db`/`sessionInstances`/`sessionCatalog`/`eq` imports removed; `InlineKeyboard` and `BACK_MENU_LABELS` imported.
- `tests/telegram-webhook.test.ts` - Test 9 extended with a CLIENT-keyboard assertion, new Test 9b proves the admin/client label-selection logic with a matching-owner sender, Test 10 extended with an ADMIN-keyboard assertion; new `BACK_MENU_LABELS` import.

## Decisions Made
- The legacy approve_/reject_ "booking not found" branch uses the ADMIN label unconditionally, with no new ownership check — matches the plan's explicit instruction that this branch is reached only via the owner-only Έγκριση/Απόρριψη button, so adding an identity check would be inventing a pattern that never existed and isn't needed.
- escl:approve's fix is scoped to the serviceId read path only; the actual booking mutation immediately below (`bookSessionInstance`) already had its own businessId-scoped capacity guard (T-10-02) and required no change.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' acceptance criteria passed on the first implementation attempt; no Rule 1-4 auto-fixes were needed.

## Issues Encountered

- **Local test-DB port mismatch (environment-only, not a code issue — same as Plan 29-01):** the test suite's default fallback DB URL resolves to the wrong Postgres container in this dev environment. Not relevant to this plan's scoped test run (`telegram-webhook.test.ts` uses fully mocked queries/telegram-client modules, no real DB connection), but `SESSION_TEST_DATABASE_URL=postgresql://manolis:password@localhost:5433/randevuclaw_test` was set for all verification runs per the environment note, consistent with prior plans.
- **Atomic per-task commits across a shared file:** both tasks modify `src/webhooks/telegram.ts` in non-overlapping regions (imports, the null-parse block, the escl:approve block, the legacy booking-lookup block). To keep task commits genuinely atomic (not just staged together), Task 2's edits were temporarily reverted, Task 1 was committed alone, then Task 2's edits were re-applied and committed separately — both `npx tsc --noEmit` and the full scoped test run were re-verified clean after each commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 3 truths in this plan's `must_haves` are now enforced and tested: malformed callback_data always gets a back-menu recovery message with correct admin/client routing; the legacy "booking not found" path gets the same recovery pattern; escl:approve's serviceId lookup is businessId-scoped.
- `tests/telegram-webhook.test.ts` is fully green (42/42) and `npx tsc --noEmit` passes clean across the whole project.
- Wave 2 plans 29-04/29-05/29-06 (admin-menu.ts, client-menu.ts) are unaffected by this plan's changes — no shared call sites were touched beyond the imports already available from Plan 29-01.

---
*Phase: 29-booking-list-clarity*
*Completed: 2026-07-28*

## Self-Check: PASSED

- Both key-files (`src/webhooks/telegram.ts`, `tests/telegram-webhook.test.ts`) confirmed present on disk with the expected changes.
- Both task commits (`3448c82`, `0130d82`) confirmed present in `git log`.
- All 42 tests in the scoped run (`npm test -- --testPathPattern="telegram-webhook" --testTimeout=30000`) pass.
- `npx tsc --noEmit` passes clean.
- `grep` confirms zero remaining occurrences of `db.select({ serviceId: sessionCatalog.serviceId })`, and zero remaining `db`/`sessionInstances`/`sessionCatalog`/`eq` imports/usages in `src/webhooks/telegram.ts`.
- Verified zero files outside the plan's declared scope (`src/webhooks/telegram.ts`, `tests/telegram-webhook.test.ts`) were touched by either task commit.
