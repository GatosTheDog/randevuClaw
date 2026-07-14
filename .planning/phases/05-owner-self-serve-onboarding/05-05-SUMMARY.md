---
phase: 05-owner-self-serve-onboarding
plan: "05"
subsystem: onboarding/edit-router
status: complete
tags:
  - owner-edit
  - keyword-intercept
  - ONB-03
dependency_graph:
  requires:
    - 05-03 (Business interface, listServicesForBusiness, schema tables)
    - 04-04 (botTokenStore, per-bot webhook handler, withBusinessContext)
  provides:
    - src/onboarding/edit-router.ts (OWNER_EDIT_KEYWORDS, isOwnerEditCommand, routeOwnerEdit, hasPendingEditState)
    - Owner edit intercept in handleFoundBusiness (telegram.ts)
  affects:
    - src/webhooks/telegram.ts (handleFoundBusiness routing path)
tech_stack:
  added: []
  patterns:
    - Keyword intercept short-circuits Gemini agent for Greek edit commands
    - Two-turn stateful delete flow via module-level Map keyed by business.id
    - onConflictDoUpdate upsert for business_hours rows (unique on businessId+dayOfWeek)
key_files:
  created:
    - src/onboarding/edit-router.ts
  modified:
    - src/webhooks/telegram.ts
decisions:
  - Used module-level Map (not DB) for pending delete state — in-memory is sufficient for single-process PoC; the Map is keyed by business.id and cleared on every owner reply (valid or invalid), so it cannot grow unboundedly per session
  - Preserved original messageText casing for service names (νέα υπηρεσία branch) while performing keyword matching on the lowercase-normalized copy
  - Placed the pending delete check in Step 0 before keyword matching to ensure the second turn of διαγραφή υπηρεσίας is routed correctly even when the reply contains no edit keyword
metrics:
  duration: "273s"
  completed: "2026-07-14"
  tasks_completed: 2
  tasks_total: 2
  files_created: 1
  files_modified: 1
---

# Phase 05 Plan 05: Owner Edit Router Summary

Owner post-setup configuration editing via Greek keyword commands intercepted before the Gemini booking agent.

## What Was Built

Two-file implementation for ONB-03 (owner self-serve config editing via own Telegram bot):

**`src/onboarding/edit-router.ts`** — New module with four exported symbols:

- `OWNER_EDIT_KEYWORDS` — readonly string array of four Greek edit commands
- `isOwnerEditCommand(text)` — case-insensitive check via `trim().toLowerCase() + .some(kw => normalized.includes(kw))`
- `hasPendingEditState(businessId)` — returns true when a two-turn deletion is awaiting the owner's confirmation number
- `routeOwnerEdit(business, ownerTelegramId, messageText)` — dispatches to the appropriate handler based on keyword detection (or pending state)

**Four keyword handlers (all write to DB):**

| Keyword | Inline data format | DB operation |
|---------|-------------------|--------------|
| αλλαγή ωραρίου | `[day],[HH:MM],[HH:MM]` | `db.insert(businessHours).onConflictDoUpdate` on (businessId, dayOfWeek) |
| νέα υπηρεσία | `[name],[price],[durationMin]` | `db.insert(services)` |
| αλλαγή τιμής | `[index],[newPrice]` | `db.update(services).set({ price })` |
| διαγραφή υπηρεσίας | two-turn: first sends list, second receives index | `db.delete(services)` |

**`src/webhooks/telegram.ts`** — One import added, one if-block added to `handleFoundBusiness`:

The ownership check (`ownerTelegramId === senderTelegramId`) fires BEFORE the keyword check — non-owner senders with edit keywords route to the booking agent as normal (T-05-15 mitigation).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Owner edit router | 3a73a6f | src/onboarding/edit-router.ts (created, 261 lines) |
| 2 | Owner edit intercept in telegram.ts | 4f4e5ce | src/webhooks/telegram.ts (modified, +15 lines) |

## Verification

- `npx tsc --noEmit` — exits 0
- `npm test -- --testPathPattern=telegram-webhook` — 20/20 tests pass, no modifications needed
- `grep -c "db.insert\|db.update\|db.delete" src/onboarding/edit-router.ts` — returns 4
- `grep "onConflictDoUpdate" src/onboarding/edit-router.ts` — 1 match (business_hours upsert)
- `grep "ownerTelegramId.*senderTelegramId" src/webhooks/telegram.ts` — match in intercept block

## Threat Mitigations Applied

| Threat ID | Category | Mitigation |
|-----------|----------|------------|
| T-05-15 | Elevation of Privilege | `business.ownerTelegramId === senderTelegramId` check gates the intercept before keyword matching; non-owners route to booking agent |
| T-05-16 | Tampering | Price validated as `parseInt > 0`; service name validated as non-empty and `<= 100 chars`; time strings validated against `TIME_REGEX` |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all four keyword handlers write to DB when inline data is provided. Keyword-only messages return format instructions (correct per D-06).

## Self-Check: PASSED

- [x] `src/onboarding/edit-router.ts` exists at the correct path
- [x] `src/webhooks/telegram.ts` contains the intercept block
- [x] Task 1 commit 3a73a6f present in git log
- [x] Task 2 commit 4f4e5ce present in git log
- [x] TypeScript compiles clean
- [x] 20 telegram-webhook tests pass
