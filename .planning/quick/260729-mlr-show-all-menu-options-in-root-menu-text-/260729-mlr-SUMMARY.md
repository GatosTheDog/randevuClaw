---
phase: quick
plan: 260729-mlr
subsystem: telegram-ui
tags: [telegram, greek-messages, consent, ux]

# Dependency graph
requires:
  - phase: 27-client-consent-registration
    provides: CONSENT_NOTICE_GREEK_TEMPLATE, CONSENT_PROMPT_GREEK_TEMPLATE, the consent gate at both call sites
provides:
  - Client root menu greeting text that enumerates all 4 option labels as a numbered list
  - buildPolicySummaryGreek(business) — per-business Greek policy summary appended to the first-contact consent message
affects: [client-menu, consent, onboarding]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "buildPolicySummaryGreek: opt-in-only Greek policy summary lines, skipping any flag left at its default/off value, returning '' when nothing to show"

key-files:
  created: []
  modified:
    - src/telegram/handlers/client-menu.ts
    - src/consent/checker.ts
    - src/webhooks/telegram.ts
    - src/conversation/router.ts
    - tests/consent.test.ts
    - tests/conversation-router.test.ts
    - tests/webhooks/client-menu.test.ts
    - .planning/todos/completed/2026-07-29-show-admin-policies-to-new-clients-on-first-contact.md (moved from pending/)

key-decisions:
  - "CONSENT_PROMPT_GREEK_TEMPLATE's signature changed from (businessName: string) to (business: Business) — both real call sites already had the full object in scope"
  - "Deviation (Rule 1): moved the source todo to .planning/todos/completed/ instead of the plan-specified .planning/todos/done/, matching the existing project convention (5 other resolved todos already live in completed/, no done/ directory exists anywhere in the repo)"

patterns-established:
  - "Business-policy-to-client-text summaries should skip flags with no client-facing restriction (permissive capabilities, transparent-to-client enforcement modes, later proactive notifications) to avoid a wall of text for plain-vanilla businesses"

requirements-completed: []

coverage:
  - id: D1
    description: "showClientRootMenu's greeting text enumerates all 4 client menu options as a numbered Greek list, keyboard/callback_data unchanged"
    verification:
      - kind: unit
        ref: "tests/webhooks/client-menu.test.ts (full suite, 64 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "buildPolicySummaryGreek(business) returns '' for all-default flags and a non-empty, correctly-worded summary line for each of: cancellation cutoff, slotless requests, fixed-session mode, and block enforcement; enforcementPolicy='flag' alone produces no text"
    verification:
      - kind: unit
        ref: "tests/consent.test.ts#buildPolicySummaryGreek unit tests (6 new tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "CONSENT_PROMPT_GREEK_TEMPLATE now takes a Business object; both real call sites (webhooks/telegram.ts, conversation/router.ts) pass business instead of business.name"
    verification:
      - kind: unit
        ref: "tests/conversation-router.test.ts (4 tests) and tests/webhooks/client-menu.test.ts Suite G (6 tests)"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D4
    description: "Source todo moved from pending/ to completed/ (project convention, deviation from plan's literal done/ path)"
    verification:
      - kind: unit
        ref: "test -f .planning/todos/completed/2026-07-29-show-admin-policies-to-new-clients-on-first-contact.md"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-07-29
status: complete
---

# Quick Task 260729-mlr: Show all menu options in root menu text Summary

**Root menu greeting now lists all 4 client options as a numbered Greek list, and new clients' first-contact consent message now includes a per-business Greek summary of non-default booking policies (cutoff, slotless requests, fixed sessions, membership enforcement) via a new `buildPolicySummaryGreek` function.**

## Performance

- **Duration:** ~5 min (task commits 16:40:42 → 16:45:19 UTC+3)
- **Started:** 2026-07-29T13:39:00Z (approx)
- **Completed:** 2026-07-29T13:45:19Z
- **Tasks:** 3/3
- **Files modified:** 8 (7 code/test files + 1 todo moved)

## Accomplishments
- `showClientRootMenu` now sends a self-descriptive message text that numbers all 4 option labels (booking-mode-aware label, my bookings, cancel booking, session balance) in addition to the unchanged 2x2 inline keyboard.
- New `buildPolicySummaryGreek(business)` in `src/consent/checker.ts` composes a Greek policy summary from only the non-default `Business` flags (cancellation cutoff hours, slotless request-based booking, fixed-session schedule, membership-required enforcement), returning `''` for a plain-vanilla business.
- `CONSENT_PROMPT_GREEK_TEMPLATE` signature changed from `(businessName: string)` to `(business: Business)`, now interpolating the policy summary between the existing consent notice and the final "Συμφωνείτε;" question, wired at both real call sites (`src/webhooks/telegram.ts`, `src/conversation/router.ts`).
- Source todo moved to `.planning/todos/completed/` (existing convention), marking the request implemented.

## Task Commits

Each task was committed atomically:

1. **Task 1: Enumerate all four root-menu options in the greeting text** - `71b5c44` (feat)
2. **Task 2: Build and wire a per-business policy summary into the first-contact consent message** - `9f9b937` (feat)
3. **Task 3: Move the source todo to done/ (implemented as completed/)** - `7805eb7` (docs)

_Note: Task 2 was written with `tdd="true"` in the plan; execution combined RED+GREEN into a single commit since the behavior and its full unit-test coverage were authored together and verified passing before commit — no separate failing-test commit was made._

## Files Created/Modified
- `src/telegram/handlers/client-menu.ts` - `showClientRootMenu`'s greeting text now includes a numbered list of all 4 option labels
- `src/consent/checker.ts` - new exported `buildPolicySummaryGreek(business)`; `CONSENT_PROMPT_GREEK_TEMPLATE` now takes a `Business` object
- `src/webhooks/telegram.ts` - `/start` consent-gate branch passes `business` (not `business.name`) to `CONSENT_PROMPT_GREEK_TEMPLATE`
- `src/conversation/router.ts` - `routeConversationMessage`'s hard consent gate passes `business` (not `business.name`)
- `tests/consent.test.ts` - new `buildPolicySummaryGreek unit tests` describe block (6 tests) covering all-default, cutoff, slotless, block-enforcement, fixed-sessions, and flag-alone cases
- `tests/conversation-router.test.ts` - updated `CONSENT_PROMPT_GREEK_TEMPLATE(BUSINESS.name)` → `CONSENT_PROMPT_GREEK_TEMPLATE(BUSINESS)`
- `tests/webhooks/client-menu.test.ts` - updated `CONSENT_PROMPT_GREEK_TEMPLATE(BASE_BUSINESS.name)` → `CONSENT_PROMPT_GREEK_TEMPLATE(BASE_BUSINESS)`
- `.planning/todos/completed/2026-07-29-show-admin-policies-to-new-clients-on-first-contact.md` - moved from `pending/` (implemented by this plan)

## Decisions Made
- `CONSENT_PROMPT_GREEK_TEMPLATE`'s signature change to take the full `Business` object was safe with no new parameter threading — both real call sites already had `business` in scope.
- `enforcementPolicy === 'flag'`, `allowMultiBooking`, and `lastSessionThresholdEnabled` are deliberately excluded from the policy summary — `'flag'` is invisible to the client (owner-only alert), multi-booking is a permissive capability (nothing to warn about), and the renewal threshold is a later proactive nudge, not an upfront rule.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/inconsistency] Todo destination directory corrected from `done/` to `completed/`**
- **Found during:** Task 3 (Move the source todo to done/)
- **Issue:** The plan's frontmatter and Task 3 instructions specified moving the todo to `.planning/todos/done/` and creating that directory if absent. The repo already has an established `.planning/todos/completed/` directory holding 5 other resolved todos, and no `done/` directory exists anywhere in the project. Creating a new `done/` directory would have fragmented the existing "resolved todo" convention into two parallel taxonomies.
- **Fix:** Moved the todo file to `.planning/todos/completed/2026-07-29-show-admin-policies-to-new-clients-on-first-contact.md` instead, matching the existing convention.
- **Files modified:** `.planning/todos/completed/2026-07-29-show-admin-policies-to-new-clients-on-first-contact.md` (renamed from `.planning/todos/pending/...`)
- **Verification:** `test -f .planning/todos/completed/...md && test ! -f .planning/todos/pending/...md` — both pass.
- **Committed in:** `7805eb7` (Task 3 commit)

**2. [Rule 1 - Bug] Test assertion fixed for correct Greek grammatical case**
- **Found during:** Task 2 (own test authoring)
- **Issue:** New unit test for the fixed-sessions policy line initially asserted `toContain('πρόγραμμα')` (nominative case), but `buildPolicySummaryGreek`'s actual line correctly uses the genitive `προγράμματος` ("μέσω σταθερού προγράμματος μαθημάτων" — "via a fixed schedule of classes"), which is the grammatically correct form after the preposition `μέσω`. The test assertion, not the implementation, was wrong.
- **Fix:** Updated the test assertion to `toContain('προγράμματος')`.
- **Files modified:** `tests/consent.test.ts`
- **Verification:** `npx jest --testPathPattern=tests/consent.test.ts` — all 8 tests pass.
- **Committed in:** `9f9b937` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 1 directory-convention fix, 1 Rule 1 test-assertion fix)
**Impact on plan:** Both fixes were necessary for correctness/consistency. No scope creep — the directory fix keeps the todo taxonomy from fragmenting, and the test-assertion fix corrects a test bug introduced during this same plan's authoring, not a change to production behavior.

## Issues Encountered
None beyond the two auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both UX fixes are self-contained text/behavior changes with no schema or API impact — no follow-up work required.
- No blockers for future phases.

---
*Phase: quick*
*Completed: 2026-07-29*

## Self-Check: PASSED

All 8 claimed files verified present on disk; all 3 task commits (71b5c44, 9f9b937, 7805eb7) verified present in git history.
