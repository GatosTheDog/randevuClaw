---
phase: "15"
plan: "02"
subsystem: onboarding/booking-config
tags: [queries, owner-agent, booking-mode, conf-05, conf-06]
dependency_graph:
  requires: [phase-15-01, phase-14-01, phase-10-session-catalog-schema]
  provides: [setBookingMode-query, change-booking-mode-owner-tool]
  affects: [src/database/queries.ts, src/onboarding/ai-owner-agent.ts]
tech_stack:
  added: []
  patterns: [admin-db-owner-config-update, warn-and-switch-conf-05]
key_files:
  created: []
  modified:
    - src/database/queries.ts
    - src/onboarding/ai-owner-agent.ts
decisions:
  - "setBookingMode uses admin db (not getConn) — owner config update runs outside withBusinessContext, consistent with setLastSessionThreshold pattern"
  - "change_booking_mode warns owner if switching to fixed_sessions with existing sessions, then switches anyway (CONF-05: warn, do not block)"
  - "CONF-06 satisfied by pre-existing set_cancellation_cutoff and set_last_session_threshold tools — no new tools needed"
  - "listSessions already imported from session/manager in ai-owner-agent.ts (Phase 10); no duplicate import added"
metrics:
  duration: 6
  completed: "2026-07-23"
status: complete
---

# Phase 15 Plan 02: Post-Onboarding Booking Mode Switch (CONF-05/CONF-06) Summary

Added `change_booking_mode` owner tool and `setBookingMode` query function. Owner can switch between `open_slots` and `fixed_sessions` booking modes at any time; switching to `fixed_sessions` when sessions already exist warns the owner but proceeds (CONF-05). CONF-06 verified: cancellation cutoff and last-session-threshold config are editable via already-registered tools.

## What Was Built

### `src/database/queries.ts` — `setBookingMode` function

Added after `setCancellationCutoff` following its exact pattern:

```typescript
export async function setBookingMode(businessId: number, mode: string): Promise<void> {
  await db
    .update(businesses)
    .set({ bookingMode: mode })
    .where(eq(businesses.id, businessId));
}
```

Uses admin `db` (not `getConn()`) — owner config updates run outside `withBusinessContext`. The `Business` interface fields `bookingMode`, `lastSessionThresholdEnabled`, and `lastSessionThresholdCount` were already present from Phase 10 and 14-01 respectively (verified, not re-added).

### `src/onboarding/ai-owner-agent.ts` — `change_booking_mode` tool

**Import:** `setBookingMode` added to the `database/queries` import block. `listSessions` was already imported from `session/manager` (Phase 10).

**OWNER_TOOLS entry** (after `send_renewal_reminder`):
- `name: 'change_booking_mode'`
- `mode` parameter with enum `['open_slots', 'fixed_sessions']`

**`executeOwnerTool` case:**
- Validates mode value (returns Greek error if invalid)
- For `fixed_sessions`: calls `listSessions(business.id)`; if sessions exist, warns owner with count + switches mode (CONF-05 warn-and-proceed)
- For `open_slots` (or `fixed_sessions` with no sessions): switches immediately with confirmation message

**CONF-06 verification:** `set_cancellation_cutoff` (line 231) and `set_last_session_threshold` (line 349) confirmed present in `OWNER_TOOLS` — no gaps.

**`ToolArgs` interface:** Added `mode?: string` field for the new tool.

## Deviations from Plan

### Deviation: Merged main into worktree before execution

- **Found during:** Initial setup
- **Issue:** The worktree branch was checked out at `944b613` (v1.2 milestone close, before Phase 10). Phase 15-02 depends on Phase 15-01 and the session module (`src/session/manager.ts`) which are only on main (`83e8c1f`).
- **Fix:** Fast-forward merged `main` into the worktree branch (`git merge main --no-edit`) before starting tasks. The merge was clean (fast-forward, no conflicts).
- **Files:** 70 files updated (all from Phases 10-15-01 prior work)

### Pre-existing complexity warning (out of scope)

The `executeOwnerTool` function had a pre-existing SonarQube cognitive complexity warning (`typescript:S3776`) before this plan ran. Adding one `case` block did not introduce it. Deferred — not in scope for this plan.

## Known Stubs

None. `setBookingMode` writes directly to the DB column; `change_booking_mode` calls it with a validated value.

## Threat Flags

None. `setBookingMode` uses admin `db` scoped to `eq(businesses.id, businessId)` — the `businessId` is sourced from the authenticated `business` object in `executeOwnerTool`, which is resolved via `findBusinessByOwnerTelegramId` upstream. No new network endpoints or trust boundaries introduced.

## Self-Check

### Created files exist

- `src/database/queries.ts` — `setBookingMode` exported at line 448: FOUND
- `src/onboarding/ai-owner-agent.ts` — `change_booking_mode` in OWNER_TOOLS and `executeOwnerTool`: FOUND

### Commits exist

- `3014f61` feat(15-02): add setBookingMode query function to queries.ts (CONF-05)
- `511f39b` feat(15-02): change_booking_mode tool + executeOwnerTool case (CONF-05/CONF-06)

## Self-Check: PASSED
