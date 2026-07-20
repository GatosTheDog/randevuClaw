---
phase: 08-enforcement-session-deduction
plan: "05"
subsystem: billing-enforcement-nlu
tags:
  - billing
  - enforcement
  - nlu
  - zod-validation
  - owner-agent
dependency_graph:
  requires:
    - 08-03  # setBusinessEnforcementPolicy query in billing/queries.ts
  provides:
    - handleSetEnforcementPolicy handler (billing/tools.ts)
    - set_enforcement_policy Gemini NLU tool (ai-owner-agent.ts)
  affects:
    - src/billing/tools.ts
    - src/onboarding/ai-owner-agent.ts
    - tests/billing-enforcement-policy.test.ts
tech_stack:
  added: []
  patterns:
    - Zod .enum() schema validation for NLU tool args (ENFC-01)
    - safeParse → DB call → Greek string return (tools.ts handler pattern)
    - withBusinessContext wrapping of executeOwnerTool case (T-08-12 RLS guard)
key_files:
  created: []
  modified:
    - src/billing/tools.ts
    - src/onboarding/ai-owner-agent.ts
    - tests/billing-enforcement-policy.test.ts
decisions:
  - handleSetEnforcementPolicy returns plain string (not structured result) — no confirmation keyboard needed, policy update is idempotent
  - set_enforcement_policy case uses withBusinessContext to ensure RLS scoping (T-08-12), consistent with list_packages and view_client_membership cases
  - Zod .enum(['allow','block','flag']) matches both DB CHECK constraint and Gemini enum property — dual-layer defense in depth (T-08-11)
metrics:
  duration: 8min
  completed_date: "2026-07-20"
  tasks_completed: 2
  files_changed: 3
status: complete
---

# Phase 08 Plan 05: Enforcement NLU Tool Summary

Adds owner-facing NLU tool to set the enforcement policy via Telegram message. Owners can now send "θέλω να μπλοκάρω απλήρωτους πελάτες" and Gemini will call `set_enforcement_policy` with `{policy: 'block'}`, which validates via Zod and persists via `setBusinessEnforcementPolicy`.

## One-liner

Zod-validated `handleSetEnforcementPolicy` handler in `billing/tools.ts` wired to `set_enforcement_policy` Gemini NLU tool in `ai-owner-agent.ts`, with 3 passing unit tests replacing `it.todo` stubs.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add handleSetEnforcementPolicy to billing/tools.ts | cd51838 | src/billing/tools.ts |
| 2 | Add set_enforcement_policy to ai-owner-agent.ts + fill in tests | 2ac517c | src/onboarding/ai-owner-agent.ts, tests/billing-enforcement-policy.test.ts |

## What Was Built

### src/billing/tools.ts
- Added `setBusinessEnforcementPolicy` to import from `./queries`
- Exported `SetEnforcementPolicySchema`: `z.object({ policy: z.enum(['allow', 'block', 'flag']) })`
- Exported `handleSetEnforcementPolicy(businessId, args)`:
  - Calls `SetEnforcementPolicySchema.safeParse(args)`
  - On parse failure: returns `'Μη έγκυρη πολιτική. Επιτρεπτές τιμές: allow, block, flag.'` — NO DB call (ENFC-01 prohibition)
  - On success: calls `setBusinessEnforcementPolicy(businessId, parsed.data.policy)`, logs info, returns `'Η πολιτική κρατήσεων ορίστηκε σε: ' + policy + '.'`
  - try/catch: returns `'Σφάλμα κατά την ενημέρωση πολιτικής. Δοκιμάστε ξανά.'`

### src/onboarding/ai-owner-agent.ts
- Added `handleSetEnforcementPolicy` to imports from `../billing/tools`
- Added `policy?: string` to `ToolArgs` interface
- Added `set_enforcement_policy` tool to `OWNER_TOOLS` array with `enum: ['allow', 'block', 'flag']` on policy parameter
- Added `case 'set_enforcement_policy'` in `executeOwnerTool` switch, wrapped in `withBusinessContext(business.id, ...)` for RLS tenant isolation (T-08-12)

### tests/billing-enforcement-policy.test.ts
Replaced 3 `it.todo` stubs with real unit tests:
1. `persists the chosen policy to the businesses table` — asserts `setBusinessEnforcementPolicy` called with `(1, 'block')`
2. `returns a Greek confirmation string containing the policy name` — asserts result contains `'πολιτική'` and `'flag'`
3. `returns a Greek error string without DB call when policy value is invalid` — asserts result contains `'Μη έγκυρη'` and `setBusinessEnforcementPolicy` NOT called

## Verification

```
npx tsc --noEmit      → TSC OK
npx jest --testPathPattern="billing-enforcement-policy" --no-coverage
  → 3 passed, 3 total (PASS)
npx jest --no-coverage
  → 37 passed, 1 skipped, 293 total (full suite green)
```

## Deviations from Plan

None — plan executed exactly as written.

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced. All changes are internal handler logic within the existing billing/tools.ts and ai-owner-agent.ts modules. The `set_enforcement_policy` tool is only reachable via `executeOwnerTool`, which is only called from `aiOwnerAgent`, which is only invoked when the sender's Telegram ID matches `business.ownerTelegramId` (T-08-10 mitigation — existing check, no new surface).

## Self-Check: PASSED

- [x] `src/billing/tools.ts` — modified, `SetEnforcementPolicySchema` and `handleSetEnforcementPolicy` exported
- [x] `src/onboarding/ai-owner-agent.ts` — modified, `set_enforcement_policy` in `OWNER_TOOLS` and `executeOwnerTool`
- [x] `tests/billing-enforcement-policy.test.ts` — modified, 3 real tests replacing `it.todo` stubs
- [x] Commit `cd51838` exists (Task 1)
- [x] Commit `2ac517c` exists (Task 2)
