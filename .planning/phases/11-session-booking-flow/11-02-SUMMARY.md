---
phase: 11-session-booking-flow
plan: "02"
subsystem: conversation
tags:
  - session-booking
  - ai-agent
  - function-executor
  - SBOK-01
  - SBOK-03
  - SBOK-04
dependency_graph:
  requires:
    - "11-01"  # bookSessionInstance with activeMembership (SBOK-02)
    - "10-session-catalog-schema"  # listSessions, session_instances schema
  provides:
    - list_sessions_for_client Gemini tool
    - book_session Gemini tool (single + multi)
    - reschedule_session Gemini tool (SBOK-03 expiry gate)
  affects:
    - src/conversation/ai-agent.ts
    - src/conversation/function-executor.ts
    - src/database/queries.ts
tech_stack:
  added: []
  patterns:
    - Sequential multi-booking loop (no Promise.all — T-11-07 capacity race prevention)
    - SBOK-03 expiry gate: sessionDate > isoDateInAthens(membership.expiresAt)
    - Owner alert best-effort (session bookings auto-confirmed, no keyboard)
key_files:
  created: []
  modified:
    - src/conversation/ai-agent.ts
    - src/conversation/function-executor.ts
    - src/database/queries.ts
    - tests/ai-agent.test.ts
decisions:
  - "[Phase 11-02]: ToolContext.business extended with bookingMode and allowMultiBooking — ai-agent.ts narrows Business to ToolContext at the executeTool call site (not in function-executor)"
  - "[Phase 11-02]: book_session multi-path uses sequential for-loop (not Promise.all) to prevent concurrent capacity races within a single turn (T-11-07)"
  - "[Phase 11-02]: rescheduleSessionTool cancels old booking before booking new one — no transaction rollback on new-session failure; partial failure logged and returned to Gemini"
  - "[Phase 11-02]: buildSystemInstruction refactored from inline array literal to mutable rules[] for conditional fixed_sessions block injection"
  - "[Phase 11-02]: Booking interface extended with sessionInstanceId (nullable) — required for not_a_session_booking guard in reschedule_session"
metrics:
  duration_minutes: 8
  completed_date: "2026-07-23"
  tasks_completed: 2
  files_modified: 4
status: complete
---

# Phase 11 Plan 02: Session Booking Tools Summary

Three client-facing Gemini tools wired into the AI booking agent: `list_sessions_for_client`, `book_session` (single and multi), and `reschedule_session` with SBOK-03 expiry gate.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Add 3 tool declarations to BOOKING_TOOLS + update buildSystemInstruction + Business interface | f449b53 | ai-agent.ts, queries.ts |
| 2 | Implement 3 handler functions + ToolContext extension + test fixture fix | 597cd2f | function-executor.ts, ai-agent.test.ts |

## What Was Built

### ai-agent.ts

- `BOOKING_TOOLS` now has 9 entries (6 existing + 3 new session tools)
- `buildSystemInstruction` refactored from a flat array literal to a mutable `rules[]` array with a conditional block that fires when `business.bookingMode === 'fixed_sessions'`:
  - Instructs Gemini to use `list_sessions_for_client` + `book_session` instead of `check_availability` + `book_appointment`
  - Adds multi-booking instruction when `business.allowMultiBooking` is true
- `executeTool` call site narrows `Business` to the `ToolContext.business` shape, passing `bookingMode` and `allowMultiBooking` through

### database/queries.ts

- `Business` interface: added `bookingMode: string` and `allowMultiBooking: boolean` (already in schema, Phase 10/11)
- `Booking` interface: added `sessionInstanceId: number | null` (Phase 10 column, required for `reschedule_session`'s `not_a_session_booking` guard)

### function-executor.ts

- `ToolContext.business` extended with `bookingMode: string` and `allowMultiBooking: boolean`
- Three new Zod schemas: `ListSessionsArgsSchema`, `BookSessionArgsSchema`, `RescheduleSessionArgsSchema`
- Three new dispatch cases in `executeTool` switch
- **`listSessionsForClientTool`**: calls `listSessions(businessId)`, maps to `spots_left = capacity - bookedCount`; returns `{ sessions: [], message }` when empty
- **`bookSessionTool`** (single path): enforcement check → `listSessions` to resolve `serviceId` → `bookSessionInstance` with `enfResult.membership` → best-effort owner alert (no keyboard — session bookings are auto-confirmed)
- **`bookSessionTool`** (multi path, SBOK-04): guards `allowMultiBooking`, single enforcement check before loop, sequential `for-of` loop (not `Promise.all`) over `session_instance_ids`, partial success allowed
- **`rescheduleSessionTool`** (SBOK-03): ownership guard → `not_a_session_booking` gate → `listSessions` to resolve new session → SBOK-03 expiry gate (`sessionDate > isoDateInAthens(expiresAt)`) → cancel+restore credit → `getActiveMembershipForDeduction` → `bookSessionInstance` on new instance

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Worktree branch behind main — session module missing**
- **Found during:** Task 1 TypeScript verification
- **Issue:** Worktree branch `worktree-agent-a460578f411e2c8f8` was at v1.2 milestone close (`944b613`); `src/session/` directory did not exist in the worktree
- **Fix:** Committed WIP, ran `git rebase main`, rebased cleanly (1 commit, no conflicts)
- **Files modified:** None (rebase brought in Phase 10/11 code)

**2. [Rule 2 - Missing] Booking interface missing sessionInstanceId field**
- **Found during:** Task 2 TypeScript verification (`tsc --noEmit`)
- **Issue:** `Booking` interface in `database/queries.ts` lacked `sessionInstanceId: number | null` — the schema column was added in Phase 10 but the TypeScript interface was never updated
- **Fix:** Added `sessionInstanceId: number | null` to `Booking` interface
- **Files modified:** `src/database/queries.ts`
- **Commit:** f449b53

**3. [Rule 1 - Bug] Test fixture BUSINESS missing new required fields**
- **Found during:** Task 2 regression test run (`npm test -- tests/ai-agent.test.ts`)
- **Issue:** `BUSINESS` fixture object in `tests/ai-agent.test.ts` was missing `bookingMode` and `allowMultiBooking`, causing 11 type errors
- **Fix:** Added `bookingMode: 'open_slots'` and `allowMultiBooking: false` to the fixture
- **Files modified:** `tests/ai-agent.test.ts`
- **Commit:** 597cd2f

## Verification Results

```
npx tsc --noEmit  → exit 0
npm test tests/ai-agent.test.ts  → 11/11 passed

grep -c "book_session|list_sessions_for_client|reschedule_session" ai-agent.ts  → 8 (>= 3)
grep -c "bookSessionTool|listSessionsForClientTool|rescheduleSessionTool" function-executor.ts  → 6 (>= 6)
grep -c "allowMultiBooking" function-executor.ts  → 3 (>= 1)
grep -c "past_membership_expiry" function-executor.ts  → 1 (>= 1)
```

## Known Stubs

None — all three handlers are fully implemented with real DB calls.

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced. All new tools route through the existing `executeTool` dispatcher which has the cross-tenant `business_id` guard at line 82. The `clientPhone` sourced from `context` (never from Gemini args) closes T-11-06 impersonation. Session multi-booking loop is sequential (T-11-07 DoS mitigation).

## Self-Check: PASSED

- src/conversation/ai-agent.ts — FOUND
- src/conversation/function-executor.ts — FOUND
- Commit f449b53 — FOUND
- Commit 597cd2f — FOUND
