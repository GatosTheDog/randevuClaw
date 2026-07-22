---
phase: 10-session-catalog-schema
plan: "05"
subsystem: scheduler
tags: [session-cancellation, poller, notifications, dedup, telegram]
dependency_graph:
  requires:
    - "10-02"  # sessionInstances table in schema
    - "10-03"  # session manager (cancel_session sets isCancelled=true)
    - "10-04"  # owner AI agent (cancel_session tool trigger)
  provides:
    - sessionCancellationNotifications table (UNIQUE on sessionInstanceId)
    - pollSessionCancellations() poller function
    - startSessionCancellationPoller() registration helper
  affects:
    - src/server.ts (poller registered in JEST_WORKER_ID guard)
    - Neon DB (session_cancellation_notifications table live)
tech_stack:
  added: []
  patterns:
    - LEFT JOIN + isNull() dedup check (avoids double-query JS filter)
    - botTokenStore.run() wrapping all Telegram sends (T-10-17)
    - Nested per-business + per-client try/catch isolation (membership-expiry pattern)
    - onConflictDoNothing append-only dedup insert
key_files:
  created:
    - src/scheduler/session-cancellation.ts
    - migrations/0011_session_cancellation_notifications.sql
  modified:
    - src/database/schema.ts (sessionCancellationNotifications table appended after slotlessRequests)
    - src/server.ts (startSessionCancellationPoller registered in !JEST_WORKER_ID block)
decisions:
  - "Follow startXxxPoller() export pattern from membership-expiry.ts (not bare setInterval in index.ts) — server.ts is the canonical poller registration point in this codebase"
  - "Insert dedup row after ALL clients processed (not before) — avoids at-most-once vs. at-least-once tradeoff noted in membership-expiry comments; session cancellations are rare, duplicate notification risk is low"
  - "Worktree was behind main (Phase 10 commits not yet merged) — fast-forward merged main before implementing"
metrics:
  duration: "350 seconds (~6 minutes)"
  completed: "2026-07-23"
  tasks_completed: 2
  files_changed: 4
status: complete
requirements:
  - CLSS-03
---

# Phase 10 Plan 05: Session Cancellation Notification Poller Summary

**One-liner:** Async poller that broadcasts Greek Telegram cancellation notices to all booked clients when a session instance is marked isCancelled=true, deduplicated via a UNIQUE append-only sessionCancellationNotifications table.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Add sessionCancellationNotifications table + migration | 71ec610 | src/database/schema.ts, migrations/0011_session_cancellation_notifications.sql |
| 2 | Create session-cancellation.ts poller + register in server.ts | 753e1c4 | src/scheduler/session-cancellation.ts, src/server.ts |

## What Was Built

### sessionCancellationNotifications table (schema.ts)

Appended after `slotlessRequests` in `src/database/schema.ts`. Columns: `id` (serial PK), `sessionInstanceId` (FK → sessionInstances.id, NOT NULL), `sentAt` (timestamp defaultNow), `createdAt` (timestamp defaultNow). Table-level constraint: `uniqueIndex('unique_session_cancellation_notification').on(table.sessionInstanceId)` — enforces one dedup row per cancelled instance at DB level.

### Migration 0011 (migrations/0011_session_cancellation_notifications.sql)

Idempotent `DO $$ IF NOT EXISTS` block creates the table. `CREATE UNIQUE INDEX IF NOT EXISTS` for the dedup constraint. `GRANT SELECT, INSERT ON ... TO randevuclaw_app` (no UPDATE/DELETE — append-only). `GRANT USAGE, SELECT ON SEQUENCE` for id serial. Applied to live Neon DB via `drizzle-kit push` (exits 0, `[✓] Changes applied`).

### pollSessionCancellations() (src/scheduler/session-cancellation.ts)

Outer loop: `listAllBusinessIds()` → per-business try/catch → `findBusinessById` + botToken guard (skip + warn if missing). Per-business: one LEFT JOIN query (`sessionInstances INNER JOIN sessionCatalog LEFT JOIN sessionCancellationNotifications WHERE isCancelled=true AND notification.id IS NULL`) finds all unnotified cancelled instances for the business in a single DB round-trip.

Per cancelled instance: `bookings INNER JOIN clientBusinessRelationships WHERE bookingStatus IN ('confirmed', 'pending_owner_approval')` finds booked clients. Per-client inner try/catch: `botTokenStore.run(business.botToken, () => sendTelegramMessage(clientPhone, greekMsg))`. After all clients: `db.insert(sessionCancellationNotifications).values({sessionInstanceId}).onConflictDoNothing()` — marks instance as processed regardless of client count (prevents re-querying 0-booking cancelled sessions every 6 hours).

Greek message: `Η σεζόν σας στις ${sessionDate} ${sessionTime} ακυρώθηκε. Παρακαλώ επικοινωνήστε μαζί μας για νέο ραντεβού.`

### startSessionCancellationPoller() (src/scheduler/session-cancellation.ts)

Matches `startMembershipExpiryPoller()` pattern exactly: `setInterval(() => pollSessionCancellations().catch(...), 6 * 60 * 60 * 1000)`. Returns `NodeJS.Timeout` handle for graceful shutdown.

### server.ts registration

Import added at line 11. `startSessionCancellationPoller()` called inside the `!process.env.JEST_WORKER_ID` guard immediately after `startMembershipExpiryPoller()`. No bare `setInterval` in index.ts — server.ts is the canonical poller registration point.

## Verification

- `npx tsc --noEmit` exits 0 (no output, clean)
- `npm test -- tests/session-cancel.test.ts --testTimeout=10000` passes (5 todo stubs, all pass)
- `npx drizzle-kit push` exits 0 — `[✓] Changes applied` — session_cancellation_notifications table live in Neon DB

## Threat Model Coverage

All mitigations from the plan's threat register applied:

| Threat | Mitigation |
|--------|-----------|
| T-10-15 (Duplicate broadcast DoS) | UNIQUE on sessionInstanceId + onConflictDoNothing |
| T-10-16 (Telegram rate-limit) | Sequential per-client await (not Promise.all) |
| T-10-17 (botToken in logs) | Only `{businessId, method}` logged; botToken never appears in any logger call |
| T-10-18 (Wrong-business clients) | WHERE sessionCatalog.businessId = businessId + clientBusinessRelationships JOIN |
| T-10-19 (Concurrent poller duplicates) | onConflictDoNothing on dedup insert guards overlap |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree was behind main by 10 commits**
- **Found during:** Pre-task setup (schema.ts in worktree had 358 lines; expected 500+)
- **Issue:** Worktree branch was created from the pre-Phase-10 HEAD. All Phase 10 work (schema tables, session manager, migrations, test fixtures) existed only on main.
- **Fix:** Fast-forward merged `main` into `worktree-agent-a39a9a7324a38cd11` — clean merge, no conflicts.
- **Files affected:** All Phase 10 files now present in worktree
- **Impact:** Zero — merge was a fast-forward, no changes to Phase 10 files, no conflicts.

**2. [Rule 2 - Pattern Alignment] Registered via startSessionCancellationPoller() in server.ts, not bare setInterval in index.ts**
- **Found during:** Task 2B implementation
- **Issue:** Plan Task 2B says "register in src/index.ts" but src/index.ts only contains 6 lines (the `app.listen` call). All pollers are registered in `src/server.ts` inside the `!JEST_WORKER_ID` guard using exported `startXxxPoller()` functions.
- **Fix:** Followed the actual codebase pattern — exported `startSessionCancellationPoller()` and registered it in server.ts after `startMembershipExpiryPoller()`.
- **Files affected:** src/server.ts (not index.ts)

## Known Stubs

None. The poller is fully implemented. The `session-cancel.test.ts` file contains 5 `it.todo` stubs — these are Nyquist test stubs planned for when the cancel_session tool is integration-tested; they are intentional scaffolding from Plan 10-01, not gaps in this plan's implementation.

## Threat Flags

None. No new network endpoints, auth paths, or trust boundaries introduced beyond what the threat model already covers. The poller reads from Neon DB (admin connection, business-scoped WHERE clause) and writes to Telegram API inside botTokenStore.run() — both surfaces are documented in the plan's threat model.

## Self-Check: PASSED

- [x] src/scheduler/session-cancellation.ts — FOUND
- [x] migrations/0011_session_cancellation_notifications.sql — FOUND
- [x] src/database/schema.ts has sessionCancellationNotifications (line 511) — FOUND
- [x] src/server.ts has startSessionCancellationPoller (lines 11, 43) — FOUND
- [x] Commit 71ec610 (schema + migration) — FOUND
- [x] Commit 753e1c4 (poller + server.ts) — FOUND
- [x] npx tsc --noEmit exits 0 — PASSED
- [x] npm test session-cancel.test.ts exits 0 — PASSED
- [x] drizzle-kit push exits 0 — PASSED
