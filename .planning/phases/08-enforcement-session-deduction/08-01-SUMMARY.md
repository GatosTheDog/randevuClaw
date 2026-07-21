---
phase: 08-enforcement-session-deduction
plan: "01"
subsystem: billing
tags:
  - nyquist-stubs
  - tdd-wave-0
  - session-deduction
  - enforcement-policy
dependency_graph:
  requires:
    - 07-04-SUMMARY.md
  provides:
    - tests/enforcement-session-deduction.test.ts
    - tests/booking-enforcement.test.ts
    - tests/enforcement-nlu.test.ts
    - tests/COVERAGE.md
  affects:
    - billing/enforcement.ts (Wave 2 — not yet created)
tech_stack:
  added: []
  patterns:
    - it.todo stub pattern (Nyquist Wave 0)
    - jest.resetModules() + require() DB URL override pattern
key_files:
  created:
    - tests/enforcement-session-deduction.test.ts
    - tests/booking-enforcement.test.ts
    - tests/enforcement-nlu.test.ts
    - tests/COVERAGE.md
  modified: []
decisions:
  - it.todo stubs with no imports from unbuilt modules — keeps stubs compilable by ts-jest before any implementation exists
  - enforcement-nlu.test.ts uses jest.resetModules() instead of top-level import to avoid ts-jest resolving @google/genai through ai-owner-agent.ts in the worktree context (no node_modules symlink)
  - COVERAGE.md created fresh (did not previously exist) with Phase 7 + Phase 8 entries
metrics:
  duration: 6 minutes
  completed: "2026-07-21T07:15:33Z"
status: complete
---

# Phase 08 Plan 01: Nyquist Stubs (Wave 0) Summary

Phase 8 Wave 0 — created all Nyquist test stub files before any implementation begins.
14 `it.todo` stubs across 3 files covering SESS-01/02/03/04 and ENFC-01/02/03.

## What Was Built

Three test stub files created + COVERAGE.md initialized:

| File | Stubs | Requirements |
|------|-------|--------------|
| tests/enforcement-session-deduction.test.ts | 7 | SESS-01, SESS-02, SESS-03, SESS-04 |
| tests/booking-enforcement.test.ts | 3 | ENFC-02, ENFC-03 |
| tests/enforcement-nlu.test.ts | 4 | ENFC-01 |
| tests/COVERAGE.md | — | Phase 7 + Phase 8 entries |

**Total: 14 it.todo stubs**

## Test Stub Details

### tests/enforcement-session-deduction.test.ts

Uses `jest.resetModules()` + `process.env.DATABASE_URL` override pattern (matching billing-membership-creation.test.ts). No imports from unbuilt modules.

```
describe('insertBookingWithSessionDeduction')
  ✓ SESS-01: inserts booking and deducts 1 session atomically in same transaction [todo]
  ✓ SESS-01: concurrent bookings on same membership deduct exactly 1 session (race guard) [todo]
  ✓ SESS-03: unlimited membership (sessionCount=null) booking creates no ledger entry [todo]
  ✓ SESS-04: unlimited membership booking does not change sessionsRemaining [todo]

describe('cancelBookingWithRefund')
  ✓ SESS-02: cancellation within membership validity restores 1 session credit [todo]
  ✓ SESS-02: credit restore appends ledger entry with operationType credit_restored [todo]
  ✓ SESS-02/03: cancellation after membership expiry does not restore credit (sessions forfeited) [todo]
```

### tests/booking-enforcement.test.ts

Pure it.todo file, no DB setup required.

```
describe('booking enforcement policy integration')
  ✓ ENFC-02: block policy + no membership refuses booking and sends Greek refusal to client [todo]
  ✓ ENFC-03: flag policy + no membership allows booking and sends Greek alert to owner [todo]
  ✓ ENFC-02: block policy + active membership allows booking to proceed normally [todo]
```

### tests/enforcement-nlu.test.ts

Uses `jest.resetModules()` instead of top-level import to avoid ts-jest resolving `@google/genai` through `ai-owner-agent.ts` in the worktree context (worktree has no `node_modules` symlink; module resolution falls back to main repo at runtime but ts-jest type-checks at compile time).

```
describe('set_enforcement_policy NLU tool')
  ✓ ENFC-01: set_enforcement_policy tool exists in OWNER_TOOLS [todo]
  ✓ ENFC-01: tool rejects values other than block or flag [todo]
  ✓ ENFC-01: setting policy to block persists to businesses.enforcement_policy in DB [todo]
  ✓ ENFC-01: setting policy to flag persists to businesses.enforcement_policy in DB [todo]
```

## Verification Result

```
PASS tests/enforcement-session-deduction.test.ts
PASS tests/booking-enforcement.test.ts
PASS tests/enforcement-nlu.test.ts

Test Suites: 3 passed, 3 total
Tests:       14 todo, 14 total
Time:        5.889 s
```

All 3 files exit 0. All 14 stubs shown as todo (pending). No failures.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] enforcement-nlu.test.ts: ts-jest @google/genai resolution failure**
- **Found during:** Task 2 (first test run)
- **Issue:** Direct top-level `import { OWNER_TOOLS } from '../src/onboarding/ai-owner-agent'` caused ts-jest to typecheck the full import chain, reaching `@google/genai` which is not resolvable as a TypeScript module in the worktree context (no `node_modules` symlink — runtime Node resolution falls back to main repo, but compile-time ts-jest does not).
- **Fix:** Replaced top-level import with `jest.resetModules()` and a comment explaining why. The import will be restored when Wave 4 implements the actual tests (at which point the worktree will have been merged and the full `node_modules` will be available).
- **Files modified:** `tests/enforcement-nlu.test.ts`
- **Commit:** 2d513dd (included in the same task commit)

**2. [Rule 2 - Missing artifact] COVERAGE.md did not exist**
- **Found during:** Task 3
- **Issue:** The plan instructs to append a Phase 8 section to COVERAGE.md, but the file did not previously exist.
- **Fix:** Created COVERAGE.md fresh with both Phase 7 (documenting existing billing test files) and Phase 8 sections, as specified by the plan's fallback instruction.
- **Files modified:** `tests/COVERAGE.md`

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Tasks 1-3 (all stubs + COVERAGE.md) | 2d513dd | tests/enforcement-session-deduction.test.ts, tests/booking-enforcement.test.ts, tests/enforcement-nlu.test.ts, tests/COVERAGE.md |

## Self-Check: PASSED

- tests/enforcement-session-deduction.test.ts: EXISTS (created in 2d513dd)
- tests/booking-enforcement.test.ts: EXISTS (created in 2d513dd)
- tests/enforcement-nlu.test.ts: EXISTS (created in 2d513dd)
- tests/COVERAGE.md: EXISTS (created in 2d513dd)
- Commit 2d513dd: FOUND in git log
- npm test: 3 PASS, 14 todo, 0 failures
