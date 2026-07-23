---
phase: 13-slotless-booking
plan: "01"
subsystem: session
tags: [slotless-booking, query-layer, drizzle, transactions]
requires: [src/database/schema.ts, src/database/db.ts, src/database/queries.ts, src/billing/queries.ts]
provides: [src/session/slotless-requests.ts]
affects: []
tech_stack:
  added: []
  patterns: [db.transaction for multi-table atomicity, getConn for RLS-enforced reads, onConflictDoNothing idempotency, SELECT FOR UPDATE locking]
key_files:
  created:
    - src/session/slotless-requests.ts
  modified:
    - src/database/schema.ts
decisions:
  - approveSlotlessRequest uses db.transaction (admin db) not withBusinessContext — the approval is an owner-initiated action arriving from a Telegram callback, not wrapped in an existing withBusinessContext session; db.transaction gives atomicity without RLS scoping
  - Booking insert in approveSlotlessRequest is inline (tx.insert) not via insertBooking — insertBooking calls getConn() which reads AsyncLocalStorage; inside db.transaction the context is not stored there, so tx must be used directly
  - Deduction is inline within the same transaction — mirrors deductSession logic but uses tx instead of getConn() to remain in the same transaction context
  - slotlessRequests table added to worktree schema.ts (deviation Rule 3) — worktree was at Phase 9; Phase 13 table was missing
metrics:
  duration: 5m
  completed: 2026-07-23
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 1
status: complete
---

# Phase 13 Plan 01: Slotless Requests Query Layer Summary

**One-liner:** Five typed Drizzle query functions for slotless_requests table — insert, atomic approve (db.transaction + booking + ledger + status update), reject, list, and count since a given date.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create src/session/slotless-requests.ts — five DB query functions | 13b5dd1 | src/session/slotless-requests.ts (created), src/database/schema.ts (modified) |

## What Was Built

`src/session/slotless-requests.ts` exports:

- **`SlotlessRequest` interface** — typed mirror of the `slotless_requests` Drizzle schema columns, including `requestedSessionDate`/`requestedSessionTime` (exact Drizzle field names confirmed from schema.ts).

- **`insertSlotlessRequest`** — inserts with `status='pending'`, `onConflictDoNothing()` on the `idempotencyKey` UNIQUE constraint. Returns the new row or null on replay.

- **`approveSlotlessRequest`** — atomicity-critical (SLOT-03 / T-13-01). Inside `db.transaction`:
  1. `SELECT FOR UPDATE` locks the request row and verifies `status='pending'`
  2. `SELECT FOR UPDATE` re-checks active membership (T-13-02 — prevents lapsed-member slip-through)
  3. Inline `tx.insert(bookings)` with `bookingStatus='confirmed'`, `requestId='slotless-approval:{id}'`
  4. Idempotent replay fallback: if booking already existed, looks it up by requestId
  5. Inline deduction: `tx.insert(membershipLedger)` + `tx.update(memberships sessionsRemaining - 1)` only when `sessionsRemaining !== null && > 0`
  6. `tx.update(slotlessRequests)` sets `status='approved'`, `bookingId=booking.id`

- **`rejectSlotlessRequest`** — UPDATE `status='rejected'` WHERE `status='pending'` (idempotent double-tap guard). Returns updated row or null.

- **`listSlotlessRequestsForClient`** — SELECT all for `(businessId, clientPhone)` ORDER BY `createdAt DESC` via `getConn()`.

- **`countSlotlessRequestsSinceCheckin`** — `COUNT(*)` WHERE `createdAt >= new Date(sinceDate + 'T00:00:00+02:00')` via `getConn()`. Returns `number`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added slotlessRequests table to worktree schema.ts**
- **Found during:** Task 1 TypeScript compilation
- **Issue:** The worktree's `src/database/schema.ts` was at Phase 9 (ending at `membershipExpiryNotifications`). The Phase 13 `slotlessRequests` table definition was absent, causing `TS2305: Module '"../database/schema"' has no exported member 'slotlessRequests'`.
- **Fix:** Appended the `slotlessRequests` table definition to the worktree schema, matching the main repo's Phase 13 definition (same column names, constraints, and FK references).
- **Files modified:** `src/database/schema.ts`
- **Commit:** 13b5dd1 (included in the same commit as the new file)

## Known Stubs

None — all five functions perform real Drizzle queries against the database. No hardcoded empty values, placeholder text, or mock data wired to any return path.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced beyond what the plan's threat model covers (T-13-01, T-13-02, T-13-03 all mitigated in the implementation).

## Self-Check

- [x] `src/session/slotless-requests.ts` exists in worktree
- [x] `npx tsc --noEmit` passes with zero errors (confirmed — empty output)
- [x] Commit 13b5dd1 exists in git log
- [x] All five functions exported (verified via grep)
- [x] `approveSlotlessRequest` wraps all mutations in `db.transaction`

## Self-Check: PASSED
