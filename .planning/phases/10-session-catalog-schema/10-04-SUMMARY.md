---
phase: 10-session-catalog-schema
plan: "04"
subsystem: owner-ai-agent
tags: [session-catalog, owner-tools, gemini, function-calling, CLSS-01, CLSS-02, CLSS-03, CLSS-04, CLSS-05]
dependency_graph:
  requires: [10-02, 10-03]
  provides: [owner-session-tool-dispatch]
  affects: [src/onboarding/ai-owner-agent.ts]
tech_stack:
  added: []
  patterns:
    - "OWNER_TOOLS FunctionDeclaration pattern: snake_case name, Greek description, JSON Schema parameters"
    - "withBusinessContext wrap for all session tool mutations"
    - "In-memory filter via listSessions for session lookup (bounded ~200 rows)"
    - "D-11 pattern: sendTelegramMessage not wrapped in try/catch in assign_client_to_session"
key_files:
  created: []
  modified:
    - src/onboarding/ai-owner-agent.ts
decisions:
  - "Used in-memory filter via listSessions for cancel_session and assign_client_to_session (bounded list ~90 days) rather than a separate findSessionByDatetime query — simpler and within acceptable bounds"
  - "createSessionCatalogWithExpansion already calls withBusinessContext internally — no double-wrap needed in the switch case"
  - "cancel_session does NOT call sendTelegramMessage — async notification poller handles client notifications (plan spec)"
  - "assign_client_to_session sendTelegramMessage NOT wrapped in try/catch per D-11 pattern — failures surface to top-level catch and return Greek error to owner"
metrics:
  duration: "6 minutes"
  completed: "2026-07-22T23:02:41Z"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 1
status: complete
---

# Phase 10 Plan 04: Owner AI Agent — Session Catalog Tools Summary

One-liner: Extended owner Gemini agent with 4 session catalog FunctionDeclarations (create_recurring_session, list_sessions, cancel_session, assign_client_to_session) wired to session manager via withBusinessContext, with Greek confirmations and D-11 notification pattern.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add 4 session FunctionDeclarations to OWNER_TOOLS array | 9b55f25 | src/onboarding/ai-owner-agent.ts |
| 2 | Add 4 session switch cases to executeOwnerTool | 9b55f25 | src/onboarding/ai-owner-agent.ts |

Both tasks were implemented atomically in a single commit as they are tightly coupled within the same file and function.

## What Was Built

### OWNER_TOOLS additions (4 new FunctionDeclarations)

After the Phase 8 `set_enforcement_policy` entry, the following tools were added with comment `// Phase 10: Session catalog tools (CLSS-01 through CLSS-05)`:

1. **create_recurring_session** — Greek description, params: service_name/weekdays (array)/start_time/capacity, all required
2. **list_sessions** — Greek description, empty params
3. **cancel_session** — Greek description, params: session_date/session_time, both required
4. **assign_client_to_session** — Greek description, params: client_phone/session_date/session_time, all required

### ToolArgs interface extension

Added Phase 10 session fields after the Phase 8 policy field:
- `weekdays?: string[]`
- `start_time?: string`
- `capacity?: number`
- `session_date?: string`
- `session_time?: string`

Note: `service_name` already existed in ToolArgs (Phase 7 billing tools reuse it).

### executeOwnerTool switch cases (4 new)

**case 'create_recurring_session':**
- Resolves service_name via case-insensitive partial match against svcList (T-10-11 mitigation)
- Validates weekdays.length > 0
- Calls `buildRRuleString(weekdays, start_time)` — filters unrecognized weekday strings (T-10-14)
- Calls `createSessionCatalogWithExpansion(business.id, matchedService.id, rruleString, start_time, capacity)` — already contains withBusinessContext internally
- Returns Greek confirmation with instanceCount

**case 'list_sessions':**
- Calls `listSessions(business.id)` — scoped by businessId guard on sessionCatalog
- Formats each as `${sessionDate} ${sessionTime} — ${bookedCount}/${capacity} θέσεις`
- Truncates at 20 with remaining count footer

**case 'cancel_session':**
- Validates session_date, session_time present
- Finds instanceId via `listSessions` + in-memory filter
- Calls `cancelSession(business.id, instanceId)` — calls withBusinessContext internally
- Returns already-cancelled string if result is false
- Does NOT call sendTelegramMessage (poller handles async notifications per plan spec)

**case 'assign_client_to_session':**
- Validates all three args present
- Finds target session via listSessions + in-memory filter
- Generates idempotencyKey: `owner-assign:${business.id}:${session_date}:${session_time}:${client_phone}`
- Calls `bookSessionInstance(business.id, instanceId, client_phone, serviceId, idempotencyKey)` with capacity race guard
- Handles full/conflict/success states with Greek strings
- On success: calls `sendTelegramMessage(client_phone, ...)` WITHOUT try/catch (D-11 pattern, T-10-13)

### Imports added

```typescript
import { sendTelegramMessage, sendTelegramMessageWithKeyboard } from '../telegram/client';
import { createSessionCatalogWithExpansion, bookSessionInstance, cancelSession, listSessions, buildRRuleString } from '../session/manager';
```

## Deviations from Plan

### Auto-fix: Merge main into worktree branch (Rule 3 - Blocking Issue)

**Found during:** Task 1 verification (npx tsc --noEmit)

**Issue:** The worktree branch `worktree-agent-a01fc528b567040a4` was created from the main branch snapshot before plans 10-01 through 10-03 were committed. As a result, `src/session/manager.ts` (created in plan 10-03) did not exist in the worktree, causing a TypeScript error: `Cannot find module '../session/manager'`.

**Fix:** Ran `git merge main --no-edit`. The fast-forward merge brought in all Phase 10 prerequisite work (session schema, manager.ts, test fixtures, migrations, planning artifacts) without conflicts.

**Files modified:** 29 files added/modified by the merge (all from prior committed plans, no new code)

**Commit:** The merge was a fast-forward, so no merge commit was created.

### TypeScript implicit `any` on arrow function parameters — not applicable

The initial tsc output showed 3 implicit `any` errors on arrow function parameters in the new switch cases. These were resolved by the merge — the tsconfig.json in the worktree was out of date with the main branch's strictness settings. After the merge, all 4 new switch cases compiled cleanly.

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | EXIT 0 — no errors |
| `npm test -- tests/ai-agent.test.ts --testTimeout=10000` | 11/11 tests passed |

## Known Stubs

None. The implementation wires live session manager functions from 10-03.

## Threat Flags

No new network endpoints or trust boundaries introduced beyond what the plan's threat model covers. The 4 tool dispatch cases inherit the owner identity guard from the existing `executeOwnerTool` caller chain (T-10-10 mitigation).

## Self-Check: PASSED

| Item | Status |
|------|--------|
| src/onboarding/ai-owner-agent.ts exists | FOUND |
| commit 9b55f25 exists | FOUND |
| create_recurring_session appears 2x (declaration + case) | FOUND |
| list_sessions appears 2x (declaration + case) | FOUND |
| cancel_session appears 2x (declaration + case) | FOUND |
| assign_client_to_session appears 2x (declaration + case) | FOUND |
