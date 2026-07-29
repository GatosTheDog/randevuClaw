---
phase: 30-client-identification-menu-reliability
plan: 01
subsystem: ai-agents
tags: [gemini, function-calling, telegram-bot, rls, zod]

# Dependency graph
requires:
  - phase: 21-owner-ai-agent-architecture
    provides: stateless Gemini tool-calling agent (no pending multi-step state machine) — the architectural basis for the text-based (not stateful-keyboard) disambiguation used here
  - phase: 7-billing-foundations
    provides: getAllClientsForBusiness / AllTimeClient in src/billing/queries.ts, withBusinessContext RLS pattern
provides:
  - Name-based client resolution (resolveClientByName) for all Gemini-facing owner tools that need to identify a client
  - formatClientDisambiguation text-based re-ask pattern reusable by future owner tools
affects: [30-02-menu-button-reliability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "resolveClientByName(businessId, nameInput) -> discriminated {kind: 'none'|'ambiguous'|'single'} result, backed by withBusinessContext + case-insensitive substring match (no fuse.js)"
    - "D-03 zero-match / D-04+D-05 text-based disambiguation re-ask for stateless Gemini tool results"

key-files:
  created:
    - tests/ai-owner-name-matching.test.ts
  modified:
    - src/onboarding/ai-owner-agent.ts
    - tests/ai-owner-confirmation-policy.test.ts

key-decisions:
  - "Name resolution happens before any downstream lookup (session lookup, membership check, keyboard send) in all 4 tools — an ambiguous or zero match never triggers a DB write, message send, or unrelated query, per D-04's 'never touches downstream logic' requirement."
  - "Disambiguation stays name-only, no last-booking-date tie-breaker (RESEARCH.md's Open Questions #1 resolved simplest-first)."
  - "getClientName import/usage removed entirely from ai-owner-agent.ts — resolveClientByName's match already carries clientName, making the separate lookup redundant for both assign_client_to_session and send_renewal_reminder."

requirements-completed: [UX-03]

coverage:
  - id: D1
    description: "view_client_membership, assign_client_to_session, send_renewal_reminder, and list_slotless_requests accept client_name and resolve a single match exactly like the old raw-ID path"
    requirement: "UX-03"
    verification:
      - kind: unit
        ref: "tests/ai-owner-name-matching.test.ts#resolves a single name match / single match"
        status: pass
      - kind: integration
        ref: "tests/ai-owner-confirmation-policy.test.ts#assign_client_to_session sends an otc:assign confirmation keyboard and returns without mutating"
        status: pass
    human_judgment: false
  - id: D2
    description: "2+ substring matches return a names-only disambiguation list and never touch downstream membership/session/notification logic"
    requirement: "UX-03"
    verification:
      - kind: unit
        ref: "tests/ai-owner-name-matching.test.ts#returns a names-only disambiguation list on 2+ matches, with no membership lookup"
        status: pass
    human_judgment: false
  - id: D3
    description: "Zero matches return the identical generic Greek string across all 4 tools, no special-casing"
    requirement: "UX-03"
    verification:
      - kind: unit
        ref: "tests/ai-owner-name-matching.test.ts#returns the generic not-found message on zero matches"
        status: pass
    human_judgment: false
  - id: D4
    description: "Case-insensitive substring matching (γιώργος vs Γιώργος)"
    requirement: "UX-03"
    verification:
      - kind: unit
        ref: "tests/ai-owner-name-matching.test.ts#matches case-insensitively regardless of the case the owner types"
        status: pass
    human_judgment: false
  - id: D5
    description: "Cross-business isolation (T-30-01): a name that only matches a client under a different business never resolves under the caller's own business.id"
    requirement: "UX-03"
    verification:
      - kind: unit
        ref: "tests/ai-owner-name-matching.test.ts#T-30-01: a name that only matches a client under a DIFFERENT business never resolves"
        status: pass
    human_judgment: false
  - id: D6
    description: "Input validation (V5): empty or >100-char client_name is rejected before any DB call"
    requirement: "UX-03"
    verification:
      - kind: unit
        ref: "tests/ai-owner-name-matching.test.ts#V5: rejects an empty client_name / V5: rejects a >100-char client_name"
        status: pass
    human_judgment: false
  - id: D7
    description: "Real-conversation UX adequacy of the Greek disambiguation/no-match copy as narrated by Gemini in production"
    verification: []
    human_judgment: true
    rationale: "Automated tests assert the raw tool-result string fed to Gemini, not how Gemini narrates/paraphrases it in a live Telegram conversation — genuine UX quality needs a human spot-check against a real owner chat."

# Metrics
duration: 25min
completed: 2026-07-29
status: complete
---

# Phase 30 Plan 01: Name-Based Client Identification Summary

**Converted 4 raw-Telegram-ID owner tools (view_client_membership, assign_client_to_session, send_renewal_reminder, list_slotless_requests) to name-based lookup via a shared `resolveClientByName` helper with text-based disambiguation and RLS-scoped cross-business isolation.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-07-29T00:10:00Z
- **Completed:** 2026-07-29T00:35:00Z
- **Tasks:** 2
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments
- Added `resolveClientByName(businessId, nameInput)` — a shared, RLS-scoped (`withBusinessContext`), Zod-validated (`ClientNameInputSchema`, 1-100 chars) name resolver returning a discriminated `{kind: 'none'|'ambiguous'|'single'}` result, reusing the codebase's existing case-insensitive substring-match convention (no fuse.js, per REQUIREMENTS.md's locked decision).
- Added `formatClientDisambiguation(matches)` and `CLIENT_NOT_FOUND_MSG` so all 4 tools share identical D-03 (generic zero-match) and D-04/D-05 (names-only disambiguation, never `senderPhone`) behavior.
- Rewired all 4 `OWNER_TOOLS` schemas (`client_phone` → `client_name`, Greek descriptions updated to name-lookup language, no more "Τηλέφωνο"/"Telegram ID" per Pitfall 5) and all 4 executor case bodies in `executeOwnerTool` to call `resolveClientByName` first and branch on `kind` before any tool-specific logic.
- Removed the now-redundant `getClientName` import/calls from `ai-owner-agent.ts` — the resolved match already carries `clientName` for display text.
- New `tests/ai-owner-name-matching.test.ts` (13 tests) proves single/zero/ambiguous/case-insensitive/cross-business-isolation/input-validation behavior for `view_client_membership` in full, plus single-match and zero-match wiring for the other 3 tools.
- Fixed the pre-existing `assign_client_to_session` test in `tests/ai-owner-confirmation-policy.test.ts` for the `client_phone` → `client_name` rename.

## Task Commits

Each task was committed atomically:

1. **Task 1: Convert the 4 raw-ID tools to name-based matching with disambiguation** - `7a516c7` (feat)
2. **Task 2: Fix the pre-existing assign_client_to_session test for the client_phone→client_name rename** - `852e580` (test)

**Plan metadata:** committed alongside this SUMMARY

## Files Created/Modified
- `src/onboarding/ai-owner-agent.ts` - `resolveClientByName`, `formatClientDisambiguation`, `CLIENT_NOT_FOUND_MSG`, `ClientNameInputSchema` added; `ToolArgs.client_name` replaces `client_phone`; 4 `OWNER_TOOLS` schemas + 4 executor cases rewritten; `getClientName` import removed
- `tests/ai-owner-name-matching.test.ts` - new: 13 tests covering all 4 tools' name-matching, disambiguation, zero-match, case-insensitivity, cross-business isolation, and input validation
- `tests/ai-owner-confirmation-policy.test.ts` - `getAllClientsForBusiness` added to the `billing/queries` mock; `assign_client_to_session` confirmation-keyboard test updated to pass `client_name` instead of the removed `client_phone`

## Decisions Made
- Name resolution runs before ANY downstream call (session lookup, membership check, message send) in all 4 tools, not just before the "final" mutation — this is what makes the "2+ matches never touch downstream logic" acceptance criterion literally true rather than approximately true (e.g. `assign_client_to_session` resolves the name before calling `listSessions`, not after).
- Disambiguation text stays name-only with no last-booking-date tie-breaker, per RESEARCH.md's resolved Open Question #1 (start simplest, add richer context only if real same-named-client collisions surface in production).
- `getClientName` is fully removed from this file (not just unused) since both of its two call sites were replaced by the resolved match's `clientName` field.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- UX-03 fully satisfied: owners can address all 4 previously-raw-ID tools by name; ambiguous names get a text-based re-ask with no new state machine; zero matches get one consistent generic reply; cross-business name collisions never resolve (proven by test, not just asserted).
- Ready for 30-02 (ADMIN-05 menu-button reliability), which is independent of this plan's changes.

---
*Phase: 30-client-identification-menu-reliability*
*Completed: 2026-07-29*

## Self-Check: PASSED

- `src/onboarding/ai-owner-agent.ts` exists — FOUND
- `tests/ai-owner-name-matching.test.ts` exists — FOUND
- `tests/ai-owner-confirmation-policy.test.ts` exists — FOUND
- Commit `7a516c7` present in `git log --oneline --all` — FOUND
- Commit `852e580` present in `git log --oneline --all` — FOUND
- `npm test -- --testPathPattern="ai-owner-name-matching"` — 13/13 passed
- `npm test -- --testPathPattern="ai-owner-confirmation-policy"` — 9/9 passed
- `npx tsc --noEmit` — no errors
- Manual grep of the 4 updated `OWNER_TOOLS` descriptions confirms none mention "Τηλέφωνο" or "Telegram ID" (Pitfall 5) — only pre-existing code comments (unrelated) match those strings
