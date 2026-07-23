---
phase: 12-cancellation-cutoff
plan: "01"
subsystem: cancellation-cutoff
tags:
  - cancellation
  - billing
  - owner-tools
  - gemini
  - rls
dependency_graph:
  requires:
    - 08-01 (enforcement policy — setBusinessEnforcementPolicy handler pattern)
  provides:
    - cancellationCutoffEnabled / cancellationCutoffHours on Business interface
    - setCancellationCutoff DB helper
    - handleSetCancellationCutoff billing tool handler
    - set_cancellation_cutoff Gemini tool declaration + executeOwnerTool dispatch
  affects:
    - 12-02 (cancelAppointmentTool reads cancellationCutoffEnabled/Hours from Business)
tech_stack:
  added:
    - SetCancellationCutoffSchema (Zod: enabled boolean, hours int 1-168)
  patterns:
    - handleSetEnforcementPolicy handler pattern (Zod validate → DB update → Greek reply)
    - withBusinessContext RLS wrapping for owner tool dispatch
key_files:
  created: []
  modified:
    - src/database/schema.ts
    - src/database/queries.ts
    - src/billing/tools.ts
    - src/onboarding/ai-owner-agent.ts
decisions:
  - "Rule 3 auto-fix: schema.ts in worktree lacked cancellationCutoffEnabled / cancellationCutoffHours columns — added alongside queries.ts changes so TypeScript interface and Drizzle schema stay in sync"
  - "Defaults: cancellationCutoffEnabled=false (opt-in, no impact on existing businesses), cancellationCutoffHours=8 (reasonable default)"
  - "setCancellationCutoff uses getConn() — correct because always called inside withBusinessContext from handleSetCancellationCutoff"
metrics:
  duration: "~8 minutes"
  completed: "2026-07-23"
  tasks_completed: 3
  files_modified: 4
status: complete
---

# Phase 12 Plan 01: Set Cancellation Cutoff Owner Tool — Summary

Wired the full set_cancellation_cutoff owner-tool chain: Gemini tool declaration, executeOwnerTool dispatch, Zod-validated billing handler, DB update helper, and Business interface fields — enabling Greek business owners to enable or disable the cancellation cutoff window via a single chat message.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Extend Business interface + add setCancellationCutoff DB helper | a940588 | src/database/schema.ts, src/database/queries.ts |
| 2 | Add handleSetCancellationCutoff in billing/tools.ts | 6c5830e | src/billing/tools.ts |
| 3 | Register set_cancellation_cutoff in OWNER_TOOLS + executeOwnerTool | 7d64f85 | src/onboarding/ai-owner-agent.ts |

## What Was Built

**DB layer (schema.ts + queries.ts):**
- `cancellationCutoffEnabled` (boolean, default false) and `cancellationCutoffHours` (integer, default 8) columns added to the `businesses` Drizzle table definition.
- `Business` interface extended with both fields so all callers receive correct TypeScript types.
- `setCancellationCutoff(businessId, enabled, hours): Promise<void>` exported from `queries.ts` — uses `getConn()` (RLS-safe since always called inside `withBusinessContext`).

**Billing handler (billing/tools.ts):**
- `SetCancellationCutoffSchema`: `enabled: z.boolean()`, `hours: z.number().int().min(1).max(168)`.
- `handleSetCancellationCutoff(businessId, args)`: validates args via Zod, calls `setCancellationCutoff`, logs with pino, returns Greek confirmation string, wraps DB call in try/catch with error logging.

**Owner agent (ai-owner-agent.ts):**
- `handleSetCancellationCutoff` imported from `../billing/tools`.
- `set_cancellation_cutoff` Gemini tool declaration added to `OWNER_TOOLS` after `set_enforcement_policy` section.
- `enabled?: boolean` and `hours?: number` added to `ToolArgs` interface.
- `case 'set_cancellation_cutoff'` dispatches via `withBusinessContext` → `handleSetCancellationCutoff` (T-12-01-02/T-12-01-03 mitigations active).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Schema columns missing from worktree**
- **Found during:** Task 1 — first `npx tsc --noEmit` run
- **Issue:** The worktree branched from main at Phase 8; the `businesses` Drizzle schema did not have `cancellationCutoffEnabled` or `cancellationCutoffHours` columns. TypeScript inferred the select type from the schema, producing `TS2739` errors across `findBusinessBySlug`, `findBusinessByWebhookId`, `findBusinessById`, and onboarding queries.
- **Fix:** Added both columns to `src/database/schema.ts` with `notNull().default(false)` and `notNull().default(8)` — matching the values used in the main repo's migration 0010. Drizzle schema definitions do not run migrations; the actual migration was already applied to Neon in Phase 10.
- **Files modified:** src/database/schema.ts (same commit a940588 as Task 1)

## Threat Mitigations

All three STRIDE mitigations from the plan's threat register are implemented:

| Threat ID | Category | Mitigation | Location |
|-----------|----------|-----------|----------|
| T-12-01-01 | Tampering | SetCancellationCutoffSchema rejects hours outside 1-168 and non-boolean enabled | src/billing/tools.ts |
| T-12-01-02 | Tampering | withBusinessContext sets RLS app.current_business_id before UPDATE | src/onboarding/ai-owner-agent.ts |
| T-12-01-03 | Elevation | WHERE eq(businesses.id, businessId) second ownership guard in setCancellationCutoff | src/database/queries.ts |

## Known Stubs

None. All code paths are fully wired: owner message → Gemini → executeOwnerTool → handleSetCancellationCutoff → setCancellationCutoff → DB row updated.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| src/database/queries.ts exists | FOUND |
| src/database/schema.ts exists | FOUND |
| src/billing/tools.ts exists | FOUND |
| src/onboarding/ai-owner-agent.ts exists | FOUND |
| Commit a940588 exists | FOUND |
| Commit 6c5830e exists | FOUND |
| Commit 7d64f85 exists | FOUND |
| Business.cancellationCutoffEnabled field | FOUND (line 39) |
| setCancellationCutoff exported | FOUND (line 426) |
| handleSetCancellationCutoff exported | FOUND (line 198) |
| set_cancellation_cutoff in OWNER_TOOLS | FOUND (line 229) |
| set_cancellation_cutoff case in switch | FOUND (line 521) |
| npx tsc --noEmit | PASSED (0 errors)
