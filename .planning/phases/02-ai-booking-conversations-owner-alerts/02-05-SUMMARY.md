---
phase: 02-ai-booking-conversations-owner-alerts
plan: 5
subsystem: api
tags: [telegram, webhook, postgres, drizzle, setInterval, booking-lifecycle]

# Dependency graph
requires:
  - phase: 02-ai-booking-conversations-owner-alerts (Plan 02-04)
    provides: "Owner alert message with Αποδοχή/Απόρριψη inline-keyboard buttons (sendTelegramMessageWithKeyboard), the callback_query stub branch, and updateBookingOwnerMessageId wiring this plan reads via ownerTelegramMessageId"
provides:
  - "Fully implemented callback_query branch: data validation, owner-identity verification, approve/reject status transitions, reschedule cascade, button-clearing, client notification"
  - "findBookingByIdUnscoped / findBusinessById / listAllBusinessIds query functions"
  - "In-process 2-hour pending-booking expiry poller (runExpirySweep/startExpiryPoller) wired into server.ts at boot"
affects: [phase-3-calendar-sync-reminders, phase-5-production-readiness]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Owner-approval callback_query handling: parse -> ack (before any DB work) -> unscoped lookup -> re-derived ownership check -> status re-check (idempotent re-tap guard) -> mutate -> notify -> clear buttons"
    - "Plain in-process setInterval poller (no cron/Redis) guarded by JEST_WORKER_ID so it never leaks an open handle into the Jest suite"

key-files:
  created:
    - src/conversation/expiry-poller.ts
    - tests/expiry-poller.test.ts
  modified:
    - src/database/queries.ts
    - src/webhooks/telegram.ts
    - src/server.ts
    - tests/booking-queries.test.ts
    - tests/telegram-webhook.test.ts

key-decisions:
  - "findBookingByIdUnscoped is the only unscoped-by-business lookup in the codebase, restricted by comment + immediate ownership re-check to the callback_query owner-verification path only (T-02-20)"
  - "answerCallbackQuery is always the first Telegram API call in the callback_query branch, before any DB read/write, per RESEARCH.md Pitfall 4"
  - "Booking status is re-checked to still be pending_owner_approval immediately before mutating, making a second tap or Telegram's callback redelivery a safe no-op (T-02-18)"
  - "Reschedule approval cascades updateBookingStatus onto both the new booking (confirmed) and the original (cancelled) in the same handler invocation; rejection never touches the original"
  - "server.ts's poller-start guard uses only process.env.JEST_WORKER_ID, not config.nodeEnv !== 'test' — config.ts's own EnvSchema collapses NODE_ENV to only 'development' | 'production', so that comparison is a TS2367 type error, not a valid runtime check"

patterns-established:
  - "Unscoped-lookup + re-derived-ownership-check pattern for any future owner-only action arriving via an ID the server itself generated and handed to Telegram (e.g. future daily-agenda quick actions)"

requirements-completed: [OWNR-02, BOOK-01, BOOK-04]

coverage:
  - id: D1
    description: "Owner taps Αποδοχή/Απόρριψη on a pending booking's alert: validated (malformed data, wrong owner, already-resolved booking all safely ignored), correctly transitions status including the reschedule cascade, clears the alert's buttons, and notifies the client"
    requirement: "OWNR-02"
    verification:
      - kind: unit
        ref: "tests/telegram-webhook.test.ts#POST /webhooks/telegram — callback_query owner approval (Plan 02-05)"
        status: pass
      - kind: unit
        ref: "tests/telegram-webhook.test.ts#parseCallbackData"
        status: pass
    human_judgment: true
    rationale: "Requires live Telegram inline-keyboard rendering and real button-tap delivery — not mockable in CI, per 02-VALIDATION.md's Manual-Only Verification entry for OWNR-02. The plan's <human-check> for Task 1 covers this."
  - id: D2
    description: "Pending bookings left unanswered past their 2-hour expiresAt are proactively swept to expired and the client is notified in Greek, with the owner's original alert buttons cleared so a late tap can't resurrect it"
    requirement: "BOOK-01"
    verification:
      - kind: unit
        ref: "tests/expiry-poller.test.ts#runExpirySweep"
        status: pass
      - kind: unit
        ref: "tests/expiry-poller.test.ts#startExpiryPoller"
        status: pass
    human_judgment: true
    rationale: "A genuine 2-hour real-time wait is impractical in a planning/execution session; the plan's <human-check> for Task 2 confirms the real DB + Telegram wiring via a manually-shortened cutoff, per 02-VALIDATION.md's manual-only entry for D-09."

duration: 20min
completed: 2026-07-08
status: complete
---

# Phase 2 Plan 5: Owner Approval Loop & Booking Expiry Sweep Summary

**Owner Telegram callback_query taps now drive real approve/reject/reschedule-cascade state transitions with identity verification and idempotent re-tap handling, plus a plain in-process poller that proactively expires and notifies clients on stale pending bookings — closing Phase 2's booking lifecycle end-to-end.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-08
- **Tasks:** 2
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments
- Replaced Plan 02-02's `// TODO Plan 02-05` callback_query stub with full validation (regex-checked `data`), owner-identity verification (`findBookingByIdUnscoped` + `findBusinessById` + comparison against `callback_query.from.id`), approve/reject status transitions, the reschedule cascade (confirming the new booking cancels the original in the same handler invocation), button-clearing, and client notification — completing OWNR-02
- Added 3 additive, narrowly-scoped query functions (`findBookingByIdUnscoped`, `findBusinessById`, `listAllBusinessIds`) with no changes to any existing export
- Implemented a plain in-process `setInterval`-based expiry poller (`runExpirySweep`/`startExpiryPoller`) that sweeps every business's stale `pending_owner_approval` bookings past the D-09 2-hour cutoff, notifies the client in Greek, and clears the owner alert's buttons — with per-business error isolation so one business's DB failure never blocks the sweep for others
- Wired the poller into `server.ts` at boot, guarded against the Jest test environment to avoid an open-handle leak

## Task Commits

Each task was committed atomically:

1. **Task 1: Owner callback_query handling — validation, approve/reject, reschedule cascade** - `2057a2b` (feat)
2. **Task 2: 2-hour pending-booking expiry poller with client notification** - `b4e33a0` (feat)

**Plan metadata:** (this commit, following SUMMARY.md creation)

## Files Created/Modified
- `src/database/queries.ts` - Added `findBookingByIdUnscoped`, `findBusinessById`, `listAllBusinessIds`
- `src/webhooks/telegram.ts` - Added `parseCallbackData` export and `handleCallbackQuery`; replaced the callback_query stub branch
- `src/conversation/expiry-poller.ts` - New: `runExpirySweep()`, `startExpiryPoller(intervalMs?)`
- `src/server.ts` - Starts the expiry poller at boot, guarded by `JEST_WORKER_ID`
- `tests/booking-queries.test.ts` - 3 new real-DB integration tests for the new query functions
- `tests/telegram-webhook.test.ts` - 1 new `parseCallbackData` unit test + 8 new callback_query integration tests
- `tests/expiry-poller.test.ts` - New: 6 tests covering the sweep, error isolation, button-clearing, and interval scheduling

## Decisions Made
- `findBookingByIdUnscoped`'s unscoped nature is documented inline and enforced by an immediate business-ownership re-check in its one call site (`handleCallbackQuery`) — never exposed to any client-facing path (T-02-20)
- `answerCallbackQuery` is called before any DB read/write in every code path through `handleCallbackQuery`, including the malformed-data early-exit (dismisses Telegram's client-side spinner regardless of validity)
- Booking-queries Test 3 (`listAllBusinessIds` includes the two seeded fixtures) calls `seed()` directly inside the test rather than assuming an external one-time `npm run db:seed` has already been run against the local `randevuclaw_test` database — `seed()` is idempotent, so this makes the test self-contained without depending on manual local setup

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `config.nodeEnv !== 'test'` is an impossible comparison, dropped from server.ts's poller guard**
- **Found during:** Task 2 (`npx tsc --noEmit` after wiring `startExpiryPoller` into `server.ts`)
- **Issue:** The plan's action text specified `if (config.nodeEnv !== 'test' && !process.env.JEST_WORKER_ID)`, but `src/config.ts`'s own `EnvSchema` derivation collapses `NODE_ENV` to only `'development' | 'production'` (its own comment explains `'test'` is intentionally folded into `'development'`). TypeScript correctly flags the comparison as `TS2367: This comparison appears to be unintentional because the types have no overlap.`
- **Fix:** Removed the `config.nodeEnv !== 'test'` half of the guard, keeping only `!process.env.JEST_WORKER_ID` (the guard that actually does the work — Jest always sets this var). Dropped the now-unused `config` import from `server.ts`.
- **Files modified:** `src/server.ts`
- **Verification:** `npx tsc --noEmit` passes; `npm test` (full suite) shows no open-handle leak from the poller
- **Committed in:** `b4e33a0` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking/type-error fix)
**Impact on plan:** Non-functional — the removed half of the guard was always a no-op given `config.ts`'s existing type; the real guard (`JEST_WORKER_ID`) is unchanged and verified working. No scope creep.

## Issues Encountered
None beyond the type-error fix documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 2's booking lifecycle is now closed end-to-end: pending -> confirmed/rejected (owner-driven, via this plan) or pending -> expired (time-driven, via this plan's poller) or cancelled (client-driven, via prior plans)
- All 5 of Phase 2's ROADMAP success criteria now have their implementation in place; the two `human_judgment: true` coverage items (live Telegram button taps, real-time expiry wiring) are the only remaining manual verification steps before Phase 2 is considered fully validated
- Phase 3 (Calendar Sync & Reminders) can build on a stable `Booking.bookingStatus` state machine with no further transitions expected from this phase

---
*Phase: 02-ai-booking-conversations-owner-alerts*
*Completed: 2026-07-08*

## Self-Check: PASSED

All created/modified files found on disk; both task commits (`2057a2b`, `b4e33a0`) verified present in `git log`.
