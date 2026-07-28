---
phase: 29-booking-list-clarity
plan: 06
subsystem: telegram
tags: [telegram, greek-messages, information-disclosure, drizzle-consolidation]

# Dependency graph
requires:
  - phase: 29-01
    provides: "hoursUntilSession (timezone.ts), BACK_MENU_LABELS.CLIENT, findSessionInstanceById"
  - phase: 29-05
    provides: "findServiceById/BACK_MENU_LABELS already imported into client-menu.ts; explicit scope handoff for handleCancelExecute and the local hoursUntilSession duplicate"
provides:
  - "showClientBookings and showCancelBookingList render service names via a batched Map<number,string> lookup (D-10)"
  - "showCancelConfirm(chatId, business, senderTelegramId, bookingId) — ownership-guarded, shows real date + service name, anti-enumeration on both failure paths (D-09, T-29-05)"
  - "handleCancelExecute's 3 named early-returns and handleClientMenuCallback's default case all send a back-menu keyboard (D-05.1, D-05.2)"
  - "client-menu.ts's local hoursUntilSession duplicate is deleted; the shared src/utils/timezone.ts export is used instead (D-02 fully consolidated)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ownership guard runs BEFORE any booking-derived text is composed, and returns an IDENTICAL generic response for 'not found' vs 'not yours' to prevent ID enumeration via response-shape comparison"

key-files:
  created: []
  modified:
    - src/telegram/handlers/client-menu.ts
    - tests/webhooks/client-menu.test.ts

key-decisions:
  - "showCancelConfirm's ownership-guard failure path uses sendTelegramMessageWithKeyboard with the exact same text ('Κράτηση δεν βρέθηκε.') and keyboard for both the not-found and wrong-owner cases — verified via 2 dedicated tests that assert identical call signatures and that findServiceById is never invoked on the failure path (T-29-05)."
  - "Completed the D-02 consolidation and the last '« Αρχικό μενού' literal cleanup that Plan 29-05 explicitly deferred to this plan (see 29-05-SUMMARY.md Decisions/Next Phase Readiness) — both now closed, zero occurrences of that literal remain anywhere in client-menu.ts."

requirements-completed: [UX-02, UX-04, UX-06]

coverage:
  - id: D1
    description: "showClientBookings and showCancelBookingList render '{service name} - {date} {time}' via a batched Map<number,string> lookup (at most 1 findServiceById call per distinct serviceId); unresolved serviceId falls back to '(άγνωστη υπηρεσία)' (D-10)"
    requirement: "UX-04"
    verification:
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts#showClientBookings / showCancelBookingList — service name enrichment (D-10)"
        status: pass
    human_judgment: false
  - id: D2
    description: "showCancelConfirm gains an ownership guard (booking.clientPhone !== senderTelegramId) that runs before any booking-derived text is composed; on success it shows the real calendarDate/calendarTime and resolved service name (D-09)"
    requirement: "UX-02"
    verification:
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts#showCancelConfirm — ownership guard + real date/service context (D-09, T-29-05): owner test"
        status: pass
    human_judgment: false
  - id: D3
    description: "T-29-05: showCancelConfirm's not-found and wrong-owner failure paths send the identical generic 'Κράτηση δεν βρέθηκε.' message + back-menu keyboard, and findServiceById is never called on either failure path (anti-enumeration)"
    requirement: "UX-02"
    verification:
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts#showCancelConfirm — ownership guard + real date/service context (D-09, T-29-05): wrong-owner + not-found tests"
        status: pass
    human_judgment: false
  - id: D4
    description: "handleCancelExecute's 3 named early-returns (not found, wrong owner, wrong status) each send a back-menu keyboard; the 4th (cutoff-check) early return is deliberately left text-only (out of D-05.2's named scope) (D-05.2)"
    requirement: "UX-06"
    verification:
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts#Suite D: cancel flow via handleClientMenuCallback — booking-not-found / ownership guard / wrong-status early-return tests"
        status: pass
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts#Suite D: cancel flow via handleClientMenuCallback — cancel:yes cutoff guard (unmodified, plain sendTelegramMessage)"
        status: pass
    human_judgment: false
  - id: D5
    description: "handleClientMenuCallback's default case (unrecognized clientMenuAction) sends a back-menu keyboard instead of a bare text dead end (D-05.1, T-29-08)"
    requirement: "UX-06"
    verification:
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts#handleClientMenuCallback default case — back-menu keyboard (D-05.1, T-29-08)"
        status: pass
    human_judgment: false
  - id: D6
    description: "client-menu.ts's local hoursUntilSession function definition is deleted; the cutoff check imports and uses the shared src/utils/timezone.ts export instead (D-02); zero remaining '« Αρχικό μενού' literals anywhere in this file"
    verification:
      - kind: other
        ref: "npx tsc --noEmit"
        status: pass
      - kind: other
        ref: "grep -n 'Αρχικό μενού|^function hoursUntilSession' src/telegram/handlers/client-menu.ts (both zero matches)"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-07-28
status: complete
---

# Phase 29 Plan 06: Client cancel flow — service names, ownership-guarded confirm, back-menu recovery Summary

**showClientBookings/showCancelBookingList now show service names via a batched lookup, showCancelConfirm gained a mandatory ownership guard (previously had none) before rendering real date/service context with anti-enumeration on failure, and handleCancelExecute's 3 named early-returns plus the dispatcher's default case all offer a working back-to-menu button — closing out client-menu.ts's Phase 29 work.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-28T22:39:00+03:00 (approx)
- **Completed:** 2026-07-28T22:46:49+03:00
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments
- `showClientBookings`' list lines and `showCancelBookingList`'s button labels both now read `{service name} - {date} {time}`, resolved via a batched `Map<number,string>` lookup capped at 1 `findServiceById` call per distinct `serviceId` (D-10); an unresolved `serviceId` falls back to `(άγνωστη υπηρεσία)`. Both functions' local back-button literals are consolidated onto `BACK_MENU_LABELS.CLIENT`.
- `showCancelConfirm` gained a brand-new ownership guard — this function previously had **zero** ownership check at all. Because `callback_data` is attacker-controllable input (any Telegram user can send a hand-crafted `callback_query.data` string, not only literal button taps), and this plan's D-09 enrichment was about to make the function render another client's real booking details, the guard (`booking.clientPhone !== senderTelegramId`) now runs BEFORE any booking-derived text is composed. Both failure cases — booking not found, and booking belongs to someone else — return the byte-identical generic `'Κράτηση δεν βρέθηκε.'` message and keyboard, so an attacker cannot distinguish a nonexistent bookingId from someone else's real one by comparing response shapes (T-29-05). On the success path, the prompt now shows the real `calendarDate`, `calendarTime`, and resolved service name instead of a context-free "cancel this booking?".
- `handleCancelExecute`'s 3 named early-returns (booking not found, wrong owner, wrong status) each now send a back-menu keyboard instead of dead-ending on plain text. The 4th (cutoff-check) early return is deliberately left text-only, per CONTEXT.md's explicit 3-guard scope boundary — its message already states the actionable reason (hours remaining).
- `handleClientMenuCallback`'s `default` case (an unrecognized `clientMenuAction`) now sends a back-menu keyboard instead of a bare text line with no forward path (T-29-08), mirroring the identical fix already applied to `admin-menu.ts` in Plan 29-04.
- The last remaining occurrence of the literal `'« Αρχικό μενού'` in this file (inside `handleCancelExecute`'s trailing keyboard, explicitly left for this plan by Plan 29-05) is now `BACK_MENU_LABELS.CLIENT` — zero occurrences of that literal remain anywhere in `client-menu.ts`.
- `client-menu.ts`'s local `hoursUntilSession` duplicate (used only by `handleCancelExecute`'s cutoff check) is deleted; the shared canonical export from `src/utils/timezone.ts` (added in Plan 29-01) is imported and used instead, with no behavior change to the cutoff logic itself. This completes D-02's consolidation.

## Task Commits

Each task was committed atomically:

1. **Task 1: showClientBookings and showCancelBookingList show service names (D-10)** - `6cf3d79` (feat)
2. **Task 2: showCancelConfirm shows date + service name, with a new ownership guard closing an info-disclosure gap (D-09)** - `002b30f` (feat)
3. **Task 3: handleCancelExecute's 3 named early-returns + dispatcher default case get back-menu keyboards; remove the local hoursUntilSession duplicate (D-05.1, D-05.2, D-02)** - `ecbdfc5` (fix)

**Plan metadata:** (this commit, follows this SUMMARY)

## Files Created/Modified
- `src/telegram/handlers/client-menu.ts` — `showClientBookings`/`showCancelBookingList` gain batched service-name enrichment; `showCancelConfirm` gains a new signature `(chatId, business, senderTelegramId, bookingId)`, an ownership guard, and real date/service context; `handleCancelExecute`'s 3 named early-returns and `handleClientMenuCallback`'s default case gain back-menu keyboards; local `hoursUntilSession` deleted in favor of the shared `src/utils/timezone.ts` import
- `tests/webhooks/client-menu.test.ts` — new `showClientBookings`/`showCancelBookingList` service-name/fallback/batching suite; new `showCancelConfirm` ownership-guard suite (owner success, wrong-owner, not-found, dispatcher-wiring); updated `cancel:yes` ownership-guard test + 2 new early-return tests (not-found, wrong-status) to assert keyboard delivery; new dispatcher-default-case test

## Decisions Made
- The dispatcher's `'cancel:confirm'` case test asserts `showCancelConfirm` was wired correctly by verifying its observable side effects (`findBookingByIdUnscoped` called with the dispatched `bookingId`, `findServiceById` called with the dispatched `business.id`, and the success text sent to the dispatched `chatId`) rather than a `jest.spyOn` on the module's exported binding — under this codebase's `ts-jest`/CommonJS compilation, a same-file internal call (`handleClientMenuCallback` → `showCancelConfirm`) resolves to the local function binding, not `module.exports.showCancelConfirm`, so a spy on the exports object would not observe the call. The behavioral assertion proves the same fact (all 4 args reached the function as the call site passes them) without relying on an interception mechanism that doesn't apply to this compilation target.
- showCancelConfirm's ownership-guard failure message and keyboard are byte-identical for both "not found" and "wrong owner" — this was verified with 2 dedicated tests per the plan's threat-model requirement (T-29-05), each also asserting `findServiceById` is never called on the failure path (proving no booking-derived data is composed before the guard passes).

## Deviations from Plan

None — plan executed exactly as written. All 3 tasks' code changes match the plan's `<action>` blocks; all acceptance criteria are met on the first implementation attempt.

**Total deviations:** 0.
**Impact on plan:** None.

## Issues Encountered

- **Local test-DB port mismatch (environment-only, pre-existing, same as Plans 29-01/29-05):** ran all verification with `SESSION_TEST_DATABASE_URL=postgresql://manolis:password@localhost:5433/randevuclaw_test` explicitly set, per the documented dev-environment quirk. No code changes made for this.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `showClientBookings`, `showCancelBookingList`, `showCancelConfirm`, and `handleCancelExecute` are fully updated per this plan's scope; `tests/webhooks/client-menu.test.ts` is fully green (64/64 tests) and `npx tsc --noEmit` passes clean.
- This is the last plan of Phase 29 (`29-booking-list-clarity`). All 3 requirements assigned to this plan (UX-02, UX-04, UX-06) are complete for `client-menu.ts`; D-02's shared `hoursUntilSession` consolidation is now fully closed across every file that previously held a local copy.
- STATE.md and ROADMAP.md are intentionally NOT updated by this plan — per the dispatching instructions, the orchestrator owns those writes after all plans in this phase complete.

---
*Phase: 29-booking-list-clarity*
*Completed: 2026-07-28*

## Self-Check: PASSED

- Both key-files (`src/telegram/handlers/client-menu.ts`, `tests/webhooks/client-menu.test.ts`) confirmed present on disk.
- All 3 task commits (`6cf3d79`, `002b30f`, `ecbdfc5`) confirmed present in `git log`.
- `npm test -- --testPathPattern="client-menu" --testTimeout=20000` (with `SESSION_TEST_DATABASE_URL` set): 64/64 tests pass.
- `npx tsc --noEmit` passes clean.
- `grep -n "Αρχικό μενού"` and `grep -n "^function hoursUntilSession"` against `src/telegram/handlers/client-menu.ts` both return zero matches — the last literal and the local duplicate are fully removed.
- Verified zero files outside the plan's declared `files_modified` were touched.
