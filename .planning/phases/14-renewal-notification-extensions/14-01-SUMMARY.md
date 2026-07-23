---
phase: "14"
plan: "01"
subsystem: billing/renewal-nudge
tags: [schema, query-layer, drizzle, billing, renewal, notifications]
dependency_graph:
  requires: [phase-13-slotless-booking, phase-09-expiry-notifications]
  provides: [renewal-nudge-schema, renewal-nudge-query-layer, set-last-session-threshold-tool]
  affects: [src/billing/queries.ts, src/billing/tools.ts, src/database/schema.ts, src/database/queries.ts]
tech_stack:
  added: []
  patterns: [dedup-notification-table, onConflictDoNothing-idempotency, zod-tool-handler]
key_files:
  created:
    - migrations/0012_renewal_nudge_notifications.sql
  modified:
    - src/database/schema.ts
    - src/database/queries.ts
    - src/billing/queries.ts
    - src/billing/tools.ts
decisions:
  - "renewalNudgeNotifications uses date column (not text) for nudge_date — matches the DATE type in migration SQL; distinct from membershipExpiryNotifications which uses text for expiryDate (legacy convention)"
  - "findMembershipsAtThreshold uses getConn() for RLS enforcement when called inside withBusinessContext"
  - "setLastSessionThreshold uses db (admin) — owner tool path runs outside withBusinessContext"
  - "handleSetLastSessionThreshold uses parse() (throws) not safeParse() — matches plan spec exactly; Zod ZodError bubbles to the owner agent error handler"
metrics:
  duration: 15
  completed: "2026-07-23"
status: complete
---

# Phase 14 Plan 01: Renewal Nudge Schema + Query Layer + Tool Handler Summary

Renewal nudge schema, query layer, and owner tool handler for the Phase 14 low-session renewal notification system. Provides the data foundation for a sweep poller (future plan) to detect memberships at or below the configured threshold and send dedup-guarded nudge messages.

## What Was Built

### Migration: `migrations/0012_renewal_nudge_notifications.sql`

Idempotent migration creating the `renewal_nudge_notifications` table:
- `membership_id INTEGER NOT NULL REFERENCES memberships(id)`
- `nudge_date DATE NOT NULL`
- `sent_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ`
- `UNIQUE INDEX unique_renewal_nudge ON (membership_id, nudge_date)` — one nudge per membership per calendar day
- GRANT to `randevuclaw_app` role (consistent with all prior phase migrations)

### Schema: `src/database/schema.ts`

Added `renewalNudgeNotifications` Drizzle table export (after `sessionCancellationNotifications`):
- Uses `date()` column type for `nudgeDate` (matching SQL `DATE` — not text)
- `uniqueIndex('unique_renewal_nudge').on(table.membershipId, table.nudgeDate)` for dedup
- Also added `date` to the pg-core imports

### Business Interface: `src/database/queries.ts`

Added two fields after `slotlessRequestsEnabled` in the `Business` interface:
- `lastSessionThresholdEnabled: boolean` — Phase 14 (RENW-01) flag
- `lastSessionThresholdCount: number` — session count trigger

### Query Layer: `src/billing/queries.ts`

Added `renewalNudgeNotifications` to schema imports. Added three new exports:

**`setLastSessionThreshold(businessId, enabled, count)`**
- Updates `businesses.last_session_threshold_enabled` and `businesses.last_session_threshold_count`
- Uses `db` (admin connection) — called from owner tool outside withBusinessContext

**`MembershipAtThreshold` interface**
- Fields: `id`, `businessId`, `clientPhone`, `sessionsRemaining`, `expiresAt`, `threshold`

**`findMembershipsAtThreshold(businessId)`**
- JOIN memberships → businesses; WHERE `isActive=true`, `lastSessionThresholdEnabled=true`, `sessionsRemaining IS NOT NULL`, `sessionsRemaining <= lastSessionThresholdCount`
- Uses `getConn()` for RLS when called inside withBusinessContext

**`insertRenewalNudgeNotification(membershipId, nudgeDate)`**
- `onConflictDoNothing` insert; returns `true` if newly inserted (send nudge), `false` if already exists (skip)
- Uses `db` — dedup inserts happen from the sweep, outside withBusinessContext

### Tool Handler: `src/billing/tools.ts`

Added `SetLastSessionThresholdSchema` (Zod: `enabled: boolean`, `count: z.number().int().min(1).max(20)`) and exported `handleSetLastSessionThreshold`:
- Uses `parse()` (throws on invalid input — consistent with plan spec)
- Returns Greek string: disabled confirmation or `"ενεργοποιήθηκε. Θα ειδοποιούνται πελάτες με N ή λιγότερα μαθήματα."`

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

### Notes

- Worktree branch was behind main (phases 10-13 commits). Merged main into worktree branch before applying Phase 14 changes. All prior work carried forward cleanly with no conflicts.

## Verification

- TypeScript compile: `npx tsc --noEmit` — 0 errors after each task
- `renewalNudgeNotifications` table in schema.ts with `uniqueIndex('unique_renewal_nudge')` on `(membershipId, nudgeDate)` — confirmed
- Business interface has `lastSessionThresholdEnabled` and `lastSessionThresholdCount` — confirmed
- Three new functions exported from billing/queries.ts — confirmed
- `handleSetLastSessionThreshold` exported from billing/tools.ts — confirmed

## Commits

| Hash | Message |
|------|---------|
| d58e82f | feat(14-01): renewal nudge migration + schema table + Business interface fields |
| 62dd101 | feat(14-01): add renewal nudge query functions to billing/queries.ts |
| 8347db4 | feat(14-01): add handleSetLastSessionThreshold to billing/tools.ts |

## Known Stubs

None — this plan is purely schema + query layer; no UI or sweep poller wired yet. The sweep poller that calls `findMembershipsAtThreshold` and `insertRenewalNudgeNotification` is the subject of a future plan.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary crossings introduced. The new table and queries follow the established billing dedup pattern.

## Self-Check: PASSED

- migrations/0012_renewal_nudge_notifications.sql — FOUND
- src/database/schema.ts (renewalNudgeNotifications) — FOUND
- src/database/queries.ts (lastSessionThresholdEnabled, lastSessionThresholdCount) — FOUND
- src/billing/queries.ts (setLastSessionThreshold, findMembershipsAtThreshold, insertRenewalNudgeNotification) — FOUND
- src/billing/tools.ts (handleSetLastSessionThreshold) — FOUND
- Commits d58e82f, 62dd101, 8347db4 — FOUND
