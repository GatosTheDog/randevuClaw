---
phase: 12-cancellation-cutoff
plan: "02"
subsystem: cancellation-cutoff
tags:
  - cancellation
  - billing
  - cutoff
  - confirmation-flow
  - gemini
dependency_graph:
  requires:
    - 12-01 (cancellationCutoffEnabled/Hours on Business interface + schema columns)
  provides:
    - hoursUntilSessionInAthens DST-safe helper in function-executor.ts
    - ToolContext.business.cancellationCutoffEnabled / cancellationCutoffHours
    - cancelAppointmentTool cutoff check + two-message confirmation flow
    - CANC-03 (credit restored when outside window), CANC-04 (credit forfeited inside window), CANC-05 (pending_confirmation warning payload)
  affects:
    - 12-03 (any Gemini system-prompt additions for the confirmation turn)
tech_stack:
  added:
    - hoursUntilSessionInAthens (module-level, no new imports — Intl.DateTimeFormat 'Europe/Athens')
    - confirmed: z.boolean().optional() added to CancelAppointmentArgsSchema
  patterns:
    - Noon-UTC Intl offset measurement (same as isoDateInAthens in timezone.ts)
    - Best-effort try/catch for all notifications (CR-03a pattern)
    - pending_confirmation payload (new — Gemini relays warning, calls again with confirmed=true)
key_files:
  created: []
  modified:
    - src/conversation/function-executor.ts
    - src/database/schema.ts
    - src/database/queries.ts
decisions:
  - "Two-message flow: first call returns pending_confirmation (no DB write); second call with confirmed=true cancels without restoring credit"
  - "Rule 3 auto-fix: worktree predates Plan 01 — cancellationCutoffEnabled/Hours added to schema.ts + Business interface so TS compiles clean"
  - "hoursUntilSessionInAthens implemented without importing timezone.ts utilities (they do not expose this calculation)"
  - "Forfeiture path and normal path both perform best-effort calendar delete via existing findBusinessById + deleteBookingFromCalendar (no duplication)"
metrics:
  duration: "~15 minutes"
  completed: "2026-07-23"
  tasks_completed: 2
  files_modified: 3
status: complete
---

# Phase 12 Plan 02: Cancellation Cutoff Enforcement — Summary

Wired the cancellation cutoff check and two-message confirmation flow into `cancelAppointmentTool`. When a client cancels inside the cutoff window, the tool returns a `pending_confirmation` warning payload without any DB mutation; when the client confirms with "ναι" (Gemini passes `confirmed=true`), the booking is cancelled without credit restoration.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Extend ToolContext.business + add hoursUntilSessionInAthens helper | 07142c9 | src/conversation/function-executor.ts, src/database/schema.ts, src/database/queries.ts |
| 2 | Cutoff check + two-message confirmation in cancelAppointmentTool | 07142c9 | src/conversation/function-executor.ts |

Both tasks were committed together because the schema/interface fix (Rule 3 deviation) and the function-executor changes are a single atomic compilation unit.

## What Was Built

**`hoursUntilSessionInAthens(sessionDate, sessionTime): number`** (module-level, before `executeTool` export):
- Uses noon-UTC Intl offset pattern (`Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Athens', hour: '2-digit', hour12: false })`) to measure the Athens UTC offset for the session's calendar date — DST-safe for Oct 25 2026 and Mar 28 2027 transitions.
- Returns hours remaining until session; negative if session is in the past.
- No new library imports.

**`ToolContext.business` extended** with:
- `cancellationCutoffEnabled: boolean` (Phase 12 CANC-01)
- `cancellationCutoffHours: number` (Phase 12 CANC-01)

**`CancelAppointmentArgsSchema` extended** with:
- `confirmed: z.boolean().optional()` — carries the second-call confirmation flag from Gemini.

**`cancelAppointmentTool` cutoff logic** (inserted after ACTIVE_STATUSES check, before `updateBookingStatus`):
- CANC-05 (first call, inside window, `confirmed` not true): returns `{ success: false, pending_confirmation: true, booking_id, warning: "Θα χάσετε..." }` with no DB write.
- CANC-04 (second call, `confirmed=true`, inside window): calls `updateBookingStatus('cancelled')`, skips `restoreCredit`, performs best-effort calendar delete + owner forfeiture alert + client forfeiture notification, returns `{ success: true, booking_id, credit_forfeited: true }`.
- CANC-03 (outside window or cutoff disabled): falls through to existing `updateBookingStatus` + `restoreCredit` + calendar delete + normal notifications path — no regression.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Schema columns and Business interface missing in worktree**
- **Found during:** Task 1 — first `npx tsc --noEmit` run
- **Issue:** This worktree branched before Plan 01 ran; `businesses` schema lacked `cancellationCutoffEnabled` and `cancellationCutoffHours` columns and the `Business` interface in `queries.ts` lacked both fields. TypeScript error `TS2739` on `ai-agent.ts` line 323.
- **Fix:** Added both columns to `src/database/schema.ts` (`boolean().notNull().default(false)` and `integer().notNull().default(8)`) and both fields to the `Business` interface in `src/database/queries.ts` — matching Plan 01's schema additions in the main repo. Drizzle schema definitions don't run migrations; the actual DB columns were already applied by migration 0010 in Plan 01.
- **Files modified:** src/database/schema.ts, src/database/queries.ts (same commit 07142c9)

## Threat Mitigations

| Threat ID | Category | Mitigation | Location |
|-----------|----------|-----------|----------|
| T-12-02-01 | Tampering | `confirmed=true` on first call is ignored if `hoursLeft < cutoffHours` is not yet true — cutoff check runs regardless of `confirmed` value | function-executor.ts cancelAppointmentTool |
| T-12-02-02 | Tampering | Session in past (negative hoursLeft) treated as inside window — ACTIVE_STATUSES check runs first (already blocks cancelled/rejected/expired bookings) | function-executor.ts |
| T-12-02-04 | DoS | `pending_confirmation` path has zero DB mutations — no side effects from repeated unconfirmed cancel attempts | function-executor.ts |

## Logic Branch Verification

| Condition | restoreCredit called? | Return shape |
|-----------|----------------------|-------------|
| cutoffEnabled=false | Yes (normal path) | `{ success: true, booking_id }` |
| cutoffEnabled=true, hoursLeft >= cutoffHours | Yes (normal path) | `{ success: true, booking_id }` |
| cutoffEnabled=true, hoursLeft < cutoffHours, confirmed != true | No (no DB write) | `{ success: false, pending_confirmation: true, booking_id, warning }` |
| cutoffEnabled=true, hoursLeft < cutoffHours, confirmed=true | No (forfeiture) | `{ success: true, booking_id, credit_forfeited: true }` |

## Known Stubs

None. All code paths are fully wired.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes at trust boundaries beyond those already in the plan's threat model.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| src/conversation/function-executor.ts exists | FOUND |
| src/database/schema.ts exists | FOUND |
| src/database/queries.ts exists | FOUND |
| Commit 07142c9 exists | FOUND |
| hoursUntilSessionInAthens defined (line 88) | FOUND |
| ToolContext.business.cancellationCutoffEnabled (line 29) | FOUND |
| ToolContext.business.cancellationCutoffHours (line 31) | FOUND |
| confirmed in CancelAppointmentArgsSchema (line 67) | FOUND |
| pending_confirmation in cancelAppointmentTool (line 303) | FOUND |
| credit_forfeited in cancelAppointmentTool (line 349) | FOUND |
| npx tsc --noEmit | PASSED (0 errors) |
