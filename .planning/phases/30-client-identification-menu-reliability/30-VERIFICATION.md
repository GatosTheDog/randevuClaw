---
phase: 30-client-identification-menu-reliability
verified: 2026-07-29T04:15:00Z
status: passed
score: 8/8 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 30: Client Identification & Menu Reliability Verification Report

**Phase Goal:** Owners can find clients by name instead of copying raw Telegram IDs, and the persistent Telegram menu button behaves reliably — or its limitations are documented — across clients.
**Verified:** 2026-07-29T04:15:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Owner can look up client membership, assign to session, send renewal reminder, and list slotless requests by name instead of raw Telegram ID (4 tools, incl. the 4th `list_slotless_requests` added during discussion) | ✓ VERIFIED | `src/onboarding/ai-owner-agent.ts` — all 4 `OWNER_TOOLS` schemas (`view_client_membership` L321-334, `assign_client_to_session` L437-458, `list_slotless_requests` L460-473, `send_renewal_reminder` L487-498) accept `client_name`, no `client_phone`. All 4 executor cases (L814-825, L929-973, L975-995, L1003-1024) call `resolveClientByName` first. Proven by `tests/ai-owner-name-matching.test.ts` (13/13 passing) — single-match wiring exercised for all 4 tools. |
| 2 | 2+ name matches → text disambiguation prompt shown, never an ambiguous/wrong match silently applied | ✓ VERIFIED | `formatClientDisambiguation()` (`ai-owner-agent.ts:153-167`) returns a names-only text list; all 4 executor cases branch on `kind === 'ambiguous'` before any downstream call. Test: `view_client_membership (UX-03 name matching) > returns a names-only disambiguation list on 2+ matches, with no membership lookup` passes and asserts `handleViewClientMembership` never called. |
| 3 | Telegram menu-button reliability investigated (real platform research, `30-RESEARCH.md`), code-addressable gap fixed (retry+backoff on `finish_onboarding`, re-assertion on every `/menu` tap), client-side limitation documented | ✓ VERIFIED | `30-RESEARCH.md` documents Telegram Bot API doc research + community GitHub issue citations confirming client-side cache is the root cause, not app code. `ai-onboarding-agent.ts:608-635` implements a 3-attempt exponential-backoff retry loop around the 4 `setMyCommands`/`setChatMenuButton` calls. `admin-menu.ts:61-72,111-123` implements fire-and-forget `reassertMenuButtonAndCommands()` wired into `showAdminRootMenu`, reached by both the `/menu`/`/start` text-command branch (`webhooks/telegram.ts:115,124`) and the `menu:root` callback (`admin-menu.ts:608-610`). Tests pass (`tests/onboarding/ai-onboarding-agent.test.ts`, `tests/admin-menu.test.ts`). |

**Score:** 3/3 roadmap-level truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/onboarding/ai-owner-agent.ts: resolveClientByName()` | Name resolution helper, RLS-scoped | ✓ VERIFIED | L130-146; calls `getAllClientsForBusiness` inside `withBusinessContext(businessId, ...)`; Zod-validated input |
| `src/onboarding/ai-owner-agent.ts: formatClientDisambiguation()` | Names-only text disambiguation | ✓ VERIFIED | L153-167; strictly `matches.map(m => m.clientName ...)`, never `senderPhone`; includes WR-01 duplicate-name escape hatch and WR-03 20-item cap |
| `src/onboarding/ai-owner-agent.ts: CLIENT_NOT_FOUND_MSG`, `ClientNameInputSchema` | D-03 constant, V5 Zod schema | ✓ VERIFIED | L106, L112 |
| `ToolArgs.client_name` (replaces `client_phone`) | Shared field for 4 tools | ✓ VERIFIED | L599; no `client_phone` field remains in `ToolArgs` |
| 4 `OWNER_TOOLS` schemas updated | `client_name` param, no "Τηλέφωνο"/"Telegram ID" | ✓ VERIFIED | L321-334, L437-458, L460-473, L487-498 — all use "Όνομα πελάτη (αρκεί μερικό ταίριασμα)" |
| `tests/ai-owner-name-matching.test.ts` | New test file, all 4 tools covered | ✓ VERIFIED | Exists, 13/13 tests pass (re-run) |
| `src/onboarding/ai-onboarding-agent.ts`: retry+backoff loop | D-06.1 | ✓ VERIFIED | L608-635; `MENU_SETUP_MAX_ATTEMPTS=3`, `MENU_SETUP_BASE_BACKOFF_MS=300`; falls through to `activateBusiness`/`onboardingCompleted` write regardless of outcome |
| `src/telegram/handlers/admin-menu.ts`: `reassertMenuButtonAndCommands()` + call site | D-06.2 | ✓ VERIFIED | L61-72 (helper), L111-123 (fire-and-forget `.catch()`-guarded call inside `showAdminRootMenu`) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `OWNER_TOOLS[*].parameters.client_name` | `resolveClientByName(business.id, name)` | `ToolArgs.client_name` read in each of the 4 executor cases | ✓ WIRED | Confirmed by direct code read at all 4 case sites |
| `resolveClientByName` | `getAllClientsForBusiness(businessId)` | `withBusinessContext(businessId, () => ...)` | ✓ WIRED | L138-140; two independent scoping layers (RLS `set_config` + explicit `WHERE businessId = ...` in `billing/queries.ts:293`) |
| `resolveClientByName` 'ambiguous' | `formatClientDisambiguation(matches)` | direct call, returned as Gemini function-result text | ✓ WIRED | All 4 cases branch identically |
| `resolveClientByName` 'single' | downstream tool logic (`handleViewClientMembership`, `bookSessionInstance`-confirmation keyboard, `getClientActiveMembership`, `listSlotlessRequestsForClient`) | `resolved.match.senderPhone` | ✓ WIRED | Confirmed at each of the 4 case sites; test assertions confirm exact downstream call args |
| `finish_onboarding` retry loop | `setMyCommands`/`setChatMenuButton` | unchanged call signatures inside `for` loop | ✓ WIRED | `ai-onboarding-agent.ts:611-623`; `break` on success, fall-through (no return/throw) on exhaustion |
| `showAdminRootMenu` (both `/menu` entry points) | `reassertMenuButtonAndCommands` | fire-and-forget, `.catch()`-guarded, never awaited | ✓ WIRED | Reached from `webhooks/telegram.ts:115,124` ('/menu'/'/start' text) and `admin-menu.ts:608-610` (`menu:root` callback), both funneling through the single `showAdminRootMenu` function |

### Code-Review Fix Verification (WR-01/WR-02/WR-03)

| Finding | Claimed Fix | Verified in Code | Status |
|---------|-------------|-------------------|--------|
| WR-01 (identical-name dead end) | Detect duplicate `clientName`s, point owner to `/menu` → Πελάτες instead of asking for "more specific" name | `formatClientDisambiguation` (L153-167): `hasDuplicateNames = new Set(allNames).size < allNames.length` branches to the escape-hatch message ("...χρησιμοποιήστε τη λίστα πελατών στο μενού (/menu → Πελάτες).") | ✓ VERIFIED (commit `a079d18`) |
| WR-02 (dead `?? clientPhone` leak trap) | Replace with `'(χωρίς όνομα)'` placeholder at all 3 call sites | `ai-owner-agent.ts:947, 988, 1016` all use `resolved.match.clientName ?? '(χωρίς όνομα)'` — no `?? clientPhone` fallback remains anywhere in the file | ✓ VERIFIED (commit `fcfec70`) |
| WR-03 (uncapped disambiguation list) | Cap at 20, append "...και N ακόμα" suffix, matching `list_sessions` convention | `formatClientDisambiguation` (L159-163): `allNames.slice(0, 20)`, suffix `` ...και ${total - 20} ακόμα.`` when `total > 20` | ✓ VERIFIED (commit `4bfa31c`) |

### Security Re-Verification (per verifier task instructions)

- **T-30-01 cross-business isolation is genuine, not nominal.** Two independent enforcement layers confirmed by direct code read: (1) `withBusinessContext(businessId, ...)` (`database/queries.ts:114-160`) opens a real Postgres transaction and runs `SELECT set_config('app.current_business_id', ...)` for RLS; (2) `getAllClientsForBusiness` (`billing/queries.ts:283-297`) has an explicit `.where(eq(clientBusinessRelationships.businessId, businessId))` clause — defense in depth, not "accept-and-ignore." Behaviorally proven by `tests/ai-owner-name-matching.test.ts`'s `T-30-01` test, which mocks `getAllClientsForBusiness` to branch on the `businessId` argument and confirms a same-named client under a different business never resolves under the caller's own `business.id`. Test passes.
- **Disambiguation text never leaks `client_phone`/Telegram ID.** `formatClientDisambiguation` (`ai-owner-agent.ts:153-167`) builds its output strictly from `matches.map(m => m.clientName ?? '(χωρίς όνομα)')` — `senderPhone` is never referenced in the function. Confirmed by direct code read (no `senderPhone`/`clientPhone` token appears in the function body) and by the passing test assertion `expect(resultText).not.toContain('111111111')` / `.not.toContain('222222222')`.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full phase test suite (4 files) | `SESSION_TEST_DATABASE_URL=postgresql://manolis:password@localhost:5433/randevuclaw_test npx jest --testPathPattern="ai-owner-name-matching\|ai-owner-confirmation-policy\|onboarding/ai-onboarding-agent\|admin-menu"` | 4 suites, 86/86 tests passed | ✓ PASS |
| Type-check | `npx tsc --noEmit` | No output (clean) | ✓ PASS |
| Claimed commits exist | `git log --oneline --all \| grep -E "a079d18\|fcfec70\|4bfa31c\|7a516c7\|852e580\|dceda4c\|8adb084"` | All 7 commits found | ✓ PASS |
| No dangling `client_phone` param in tool schemas/args | `grep -n "client_phone" src/onboarding/ai-owner-agent.ts` | Only 1 hit — a code comment explaining the (unrelated, still-internal) `otc:assign:...` callback_data shape, explicitly out-of-scope per the plan | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| UX-03 | 30-01-PLAN.md | Name-based client match w/ disambiguation (4 tools) | ✓ SATISFIED (code) | All 4 tools converted, tested, reviewed, fixed. **Note:** `.planning/REQUIREMENTS.md` still shows `[ ] UX-03` and "Pending" in its Traceability table — this is a documentation-sync gap, not a functional gap (see Anti-Patterns/Notes below). |
| ADMIN-05 | 30-02-PLAN.md | Menu button reliability investigated + fixed/documented | ✓ SATISFIED | REQUIREMENTS.md already marks this `[x]` / "Complete" (commit `3b9f255`). |

No orphaned requirements found — both phase-declared requirement IDs (UX-03, ADMIN-05) match `.planning/ROADMAP.md`'s Phase 30 entry exactly.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `.planning/REQUIREMENTS.md` | L25, L76 | UX-03 checkbox unchecked / Traceability row says "Pending" despite Phase 30 Plan 01 being fully implemented, tested, reviewed, and fixed | ℹ️ Info | Documentation-only; the 30-01 completion commit (`f868685`) never touched `REQUIREMENTS.md` (confirmed via `git show f868685 -- .planning/REQUIREMENTS.md` — empty diff), while the 30-02 completion commit (`3b9f255`) did update ADMIN-05's row. Recommend a follow-up commit marking `UX-03` `[x]`/"Complete" before this milestone is archived. |
| `src/onboarding/ai-owner-agent.ts` | — | No debt markers (TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER) found in any of the 4 phase-touched files | — | Clean |

No BLOCKER-level anti-patterns found. No stub implementations, no orphaned artifacts, no unwired key links.

### Human Verification Required

None required to close this phase. One item is explicitly documented as an accepted, non-blocking manual spot-check per the phase's own `30-VALIDATION.md`/threat model (T-30-06): after deploy, send `/start`/`/menu` from a real Telegram client and confirm the menu button appears — this is a genuine platform-level, client-side-cache limitation (confirmed via `30-RESEARCH.md`'s Telegram Bot API documentation research) that no server-side test can exercise, and the phase's own design explicitly treats it as accepted/documented rather than gating completion on it.

### Gaps Summary

No functional gaps found. All 3 roadmap success criteria are verified true in the codebase: (1) all 4 raw-ID tools now accept and resolve client names with RLS-scoped matching; (2) 2+ matches produce a text disambiguation prompt (with a further WR-01 fix for the identical-name edge case) instead of an ambiguous/wrong match; (3) menu-button reliability was genuinely researched (Telegram Bot API docs + community reports cited in `30-RESEARCH.md`), the code-addressable gap was fixed (retry+backoff on `finish_onboarding`, re-assertion on every `/menu` tap via both entry points), and the remaining client-side caching limitation is documented rather than silently left unaddressed.

All 3 code-review Warnings (WR-01, WR-02, WR-03) found during the phase's own review cycle were independently re-verified as genuinely fixed in the current codebase (not just claimed in `30-REVIEW-FIX.md`) — the exact code changes described are present, and the full scoped test suite (86 tests across 4 files) re-run clean.

One documentation-sync item was found: `.planning/REQUIREMENTS.md`'s UX-03 checkbox/traceability row was never updated to reflect Plan 30-01's completion (only ADMIN-05's row was updated, in a separate commit for Plan 30-02). This has zero functional impact — the underlying UX-03 implementation is fully verified — but should be corrected via a follow-up commit so the project's own tracking document is accurate.

---

_Verified: 2026-07-29T04:15:00Z_
_Verifier: Claude (gsd-verifier)_
