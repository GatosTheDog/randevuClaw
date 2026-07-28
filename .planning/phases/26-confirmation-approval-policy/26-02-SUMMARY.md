---
phase: 26-confirmation-approval-policy
plan: 02
subsystem: booking
tags: [telegram, gemini-function-calling, owner-approval, session-booking, greek-ui]

# Dependency graph
requires:
  - phase: 26-confirmation-approval-policy
    provides: 26-01's rescheduledFromBookingId plumbing (unrelated surface, same phase)
  - phase: 22-session-booking-approval
    provides: Έγκριση/Απόρριψη keyboard pattern, sbk:approve/reject CAS gate, sendTelegramMessageWithKeyboard convention reused by every new otc:* keyboard
provides:
  - CONFIRM_LABELS Greek button-label constants (src/utils/greek-messages.ts)
  - executeOwnerTool's close_day/update_service_price/delete_service/assign_client_to_session cases send a confirmation keyboard and return '' instead of mutating on first Gemini-triggered invocation
  - cancel_session's free-chat path reuses the admin-menu's menu:classes:cancel_yes/no contract instead of mutating directly
  - handleOwnerToolConfirmCallback dispatcher that executes or aborts each of the 4 non-cancel_session confirmations after a real owner button tap
  - pendingServicePriceChanges server-held staging Map for the new price (never in callback_data)
  - otc:<action>:<id>[:<secondId>]:<yes|no> callback_data parsing + owner-only routing in telegram.ts
affects: [28-admin-menu-discoverability, 29-booking-list-clarity]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Confirm-then-return-empty-string contract: a Gemini tool case sends a confirmation keyboard and returns '' (mirrors the pre-existing create_package/record_payment contract) instead of mutating on its first invocation; the actual mutation moves to a separate confirm/abort dispatcher invoked only by a real button tap."
    - "Server-held staging Map for values that must never appear in callback_data (pendingServicePriceChanges), keyed by the resource id, self-expiring via an unref()'d setTimeout so it never keeps the process (or a Jest worker) alive."

key-files:
  created:
    - src/utils/greek-messages.ts
    - tests/ai-owner-confirmation-policy.test.ts
  modified:
    - src/onboarding/ai-owner-agent.ts
    - src/webhooks/telegram.ts
    - tests/ai-owner-cancel-session.test.ts
    - tests/telegram-webhook.test.ts
    - tests/COVERAGE.md

key-decisions:
  - "pendingServicePriceChanges map + setter helper were introduced in Task 1's commit (not Task 2's, as PLAN.md's task-boundary narrative suggested) because update_service_price's Task-1 case needs the map to compile and behave correctly at that commit boundary — deferring it to Task 2 would have left Task 1's own commit in a broken/incomplete intermediate state."
  - "The pending-price-change cleanup setTimeout is .unref()'d, unlike the pendingRenewalBatches precedent it mirrors — that precedent's timer only ever fires behind a JEST_WORKER_ID-gated poller in server.ts, so it never actually runs under Jest; this Map is populated directly by a unit-tested tool case, so an un-unref()'d timer kept the Jest worker alive for up to 10 minutes past test completion."
  - "assign_client_to_session's confirmation reuses CONFIRM_LABELS.CONFIRM/CANCEL (commit-type styling) per planner discretion, per 26-CONTEXT.md's D-05 — it is the owner's own outbound decision, not a request being reviewed."

patterns-established:
  - "Confirm-then-return-empty-string contract for destructive Gemini tool calls, paired with a dedicated confirm/abort dispatcher keyed off callback_data — reusable for any future destructive owner tool added outside this phase's named 5."

requirements-completed: [CONF-01]

coverage:
  - id: D1
    description: "close_day, update_service_price, delete_service, and assign_client_to_session each send a contextual otc:* confirmation keyboard and return '' on their first Gemini-triggered invocation — zero mutation happens before a real owner button tap."
    requirement: "CONF-01"
    verification:
      - kind: unit
        ref: "tests/ai-owner-confirmation-policy.test.ts#Task 1 send-confirmation cases (CONF-01)"
        status: pass
    human_judgment: false
  - id: D2
    description: "cancel_session's free-chat path sends the EXACT SAME menu:classes:cancel_yes/no confirmation the admin-menu path already uses (D-04), instead of calling cancelSession/cascadeCancelSessionBookings directly."
    requirement: "CONF-01"
    verification:
      - kind: unit
        ref: "tests/ai-owner-cancel-session.test.ts#cancel_session tool case — free-chat confirmation reuses admin-menu contract (CONF-01/D-04)"
        status: pass
    human_judgment: false
  - id: D3
    description: "handleOwnerToolConfirmCallback executes or aborts svc_del/svc_price/hrs_close/assign after a real owner tap, with svc_price safe against a missing/expired/cross-tenant staged entry and assign safe against duplicate-tap replay via a deterministic idempotencyKey."
    requirement: "CONF-01"
    verification:
      - kind: unit
        ref: "tests/ai-owner-confirmation-policy.test.ts#handleOwnerToolConfirmCallback"
        status: pass
    human_judgment: false
  - id: D4
    description: "telegram.ts parses otc:<action>:<id>[:<secondId>]:<yes|no> callback_data and routes it through an owner-only guard into handleOwnerToolConfirmCallback exactly once; a non-owner tap is ignored."
    requirement: "CONF-01"
    verification:
      - kind: unit
        ref: "tests/telegram-webhook.test.ts#parseCallbackData (Test 26-01/26-02/26-03)"
        status: pass
      - kind: integration
        ref: "tests/telegram-webhook.test.ts#POST /webhooks/telegram/:webhookId — otc: owner confirm/abort routing (CONF-01) (Test 26-04/26-05)"
        status: pass
    human_judgment: false

duration: 23min
completed: 2026-07-28
status: complete
---

# Phase 26 Plan 02: Uniform confirm-before-mutate policy for CONF-01 destructive owner actions Summary

**All 5 CONF-01 destructive owner actions (delete_service, update_service_price, close_day, cancel_session, assign_client_to_session) now require a real Telegram button tap before any data mutation — 4 via a new `otc:*` confirmation keyboard + `handleOwnerToolConfirmCallback` dispatcher, and cancel_session via the pre-existing admin-menu `menu:classes:cancel_yes/no` contract (D-04).**

## Performance

- **Duration:** 23 min
- **Started:** 2026-07-28T08:02:52Z
- **Completed:** 2026-07-28T08:25:40Z
- **Tasks:** 3
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments
- New `src/utils/greek-messages.ts` centralizes `CONFIRM_LABELS` (DELETE/CONFIRM/APPROVE/REJECT/CANCEL) as the single source for new confirmation-keyboard button text, per D-07
- `executeOwnerTool`'s `close_day`, `update_service_price`, `delete_service`, and `assign_client_to_session` cases now send a contextual confirmation keyboard and return `''` instead of mutating immediately — the actual DB mutation moved to the new `handleOwnerToolConfirmCallback` dispatcher, invoked only after a real owner button tap
- `update_service_price` stages its new price server-side in a new `pendingServicePriceChanges` Map (10-minute self-expiring, `.unref()`'d) — the price itself never appears in `callback_data` (T-26-08)
- `cancel_session`'s free-chat path now reuses the EXACT SAME `menu:classes:cancel_yes/no` callback_data contract the admin-menu's `showCancelClassConfirm` already confirms with, per D-04 — zero new confirmation UI or telegram.ts routing needed for this one action
- `telegram.ts`'s `parseCallbackData` gained an `otc:<action>:<id>[:<secondId>]:<yes|no>` arm and `handleCallbackQuery` routes it through an owner-only guard into `handleOwnerToolConfirmCallback` exactly once

## Task Commits

Each task was committed atomically:

1. **Task 1: Create greek-messages.ts and switch the 5 CONF-01 tool cases to confirm-then-return-empty-string** - `9e7adbd` (feat)
2. **Task 2: Add the confirm/abort dispatcher, execute-on-confirm logic, and pending price map** - `9a01347` (feat)
3. **Task 3: Route otc: callback_data in telegram.ts and record Phase 26 in COVERAGE.md** - `75eb3a7` (feat)

_No TDD tasks in this plan — all three were straight `auto` tasks with unit/integration test additions per acceptance criteria._

## Files Created/Modified
- `src/utils/greek-messages.ts` (new) - `CONFIRM_LABELS` Greek button-label constants
- `src/onboarding/ai-owner-agent.ts` - 5 tool cases rewritten to confirm-then-return-''; new `pendingServicePriceChanges` Map + setter; new exported `OwnerToolConfirmParams` type and `handleOwnerToolConfirmCallback` function
- `src/webhooks/telegram.ts` - new `OwnerToolConfirmCallbackResult` type, `otc:` parsing arm in `parseCallbackData`, new owner-only routing branch in `handleCallbackQuery`
- `tests/ai-owner-cancel-session.test.ts` - updated to assert the confirmation keyboard is sent and `cancelSession`/`cascadeCancelSessionBookings` are no longer called directly
- `tests/ai-owner-confirmation-policy.test.ts` (new) - 9 tests covering the 4 send-confirmation cases plus the dispatcher's confirmed/aborted/expired/success paths
- `tests/telegram-webhook.test.ts` - `parseCallbackData` coverage for `otc:` (svc_del-shaped, assign-shaped, malformed) plus an integration test proving the owner-only guard
- `tests/COVERAGE.md` - new "Phase 26 — confirmation-approval-policy" section

## Decisions Made
- `pendingServicePriceChanges` map + setter were added in Task 1's own commit rather than Task 2's (see Deviations) — necessary for Task 1's own case to compile/behave correctly at its commit boundary.
- The pending-price-change cleanup timer is `.unref()`'d rather than a bare `setTimeout` (unlike the `pendingRenewalBatches` precedent it otherwise mirrors) — see Deviations for why the bare form was a blocking issue here specifically.
- `assign_client_to_session`'s confirmation uses `CONFIRM_LABELS.CONFIRM`/`CANCEL` (commit-type styling), per 26-CONTEXT.md's Claude's-Discretion note — it's the owner's own outbound decision, not a request being reviewed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Moved pendingServicePriceChanges Map + setter from Task 2 into Task 1's commit**
- **Found during:** Task 1 (rewriting the `update_service_price` case)
- **Issue:** PLAN.md's Task 1 action text describes `update_service_price` staging its new price in "a new module-level `pendingServicePriceChanges` Map (added in Task 2 of this plan)". Since both cases live in the same file and Task 1's own required verification (`npx jest --testPathPattern="ai-owner-cancel-session.test.ts"`, which imports the whole module) needs the file to compile and behave correctly at Task 1's commit boundary, deferring the Map to Task 2 would have left Task 1's commit in a broken intermediate state (referencing an undefined identifier).
- **Fix:** Defined `pendingServicePriceChanges` and its `setPendingServicePriceChange` setter helper in Task 1's commit, immediately after `GREEK_WEEKDAYS`. Task 2's commit then only adds `OwnerToolConfirmParams`/`handleOwnerToolConfirmCallback`, which consume the already-existing Map.
- **Files modified:** src/onboarding/ai-owner-agent.ts
- **Verification:** `npx tsc --noEmit` clean at both the Task 1 and Task 2 commit boundaries (verified by temporarily isolating Task 2's block before committing Task 1).
- **Committed in:** `9e7adbd` (Task 1 commit)

**2. [Rule 3 - Blocking] Added `.unref()` to the pending-price-change cleanup timer**
- **Found during:** Task 2 (writing tests/ai-owner-confirmation-policy.test.ts)
- **Issue:** `npx jest --testPathPattern="ai-owner-confirmation-policy.test.ts"` — this plan's own required Task 2 verification command — hung past its 120s timeout. Root cause: `setPendingServicePriceChange`'s 10-minute cleanup `setTimeout` (mirroring `scheduler/membership-expiry.ts`'s unguarded `pendingRenewalBatches` cleanup pattern) kept the Jest worker process alive, because — unlike that precedent, whose timer only ever fires behind a `JEST_WORKER_ID`-gated poller in `server.ts` and therefore never actually runs under Jest — this plan's tests call `update_service_price` directly, with no poller gate in between, so the timer genuinely schedules and blocks process exit.
- **Fix:** Added `.unref()` to the returned timer handle. Production self-expiry behavior (map entry deleted after 10 minutes) is unaffected; the process (and Jest) can now exit normally without waiting on this specific timer.
- **Files modified:** src/onboarding/ai-owner-agent.ts
- **Verification:** `npx jest --testPathPattern="ai-owner-confirmation-policy.test.ts"` completes in ~12s (no `--forceExit` needed); confirmed via a before/after run with `--detectOpenHandles`.
- **Committed in:** `9a01347` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking)
**Impact on plan:** Both fixes were necessary to make this plan's own required verification commands pass/complete. No scope creep — no application behavior changed beyond making the intermediate commit states and the test suite itself sound.

## Issues Encountered
None beyond the two auto-fixed items above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CONF-01 is fully satisfied: every one of the 5 named destructive owner actions requires an explicit owner confirmation before mutating data, whether triggered via the admin menu (cancel_session, unchanged) or free chat (all 5, newly true).
- Phase 26 (both plans) is now complete: CONF-02 (26-01) and CONF-01 (26-02) are both shipped.
- The other 4 actions (delete_service, update_service_price, close_day, assign_client_to_session) still have no admin-menu entry point — that arrives in Phase 28's ADMIN-04, which can reuse `CONFIRM_LABELS` and the `otc:` callback_data convention established here.

---
*Phase: 26-confirmation-approval-policy*
*Completed: 2026-07-28*

## Self-Check: PASSED

All 7 modified/created source and test files confirmed present on disk; all 3 task commit hashes (9e7adbd, 9a01347, 75eb3a7) confirmed in git log.
