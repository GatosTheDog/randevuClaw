---
phase: 28-admin-menu-discoverability
verified: 2026-07-28T20:15:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 28: Admin Menu Discoverability Verification Report

**Phase Goal:** The owner's highest-frequency and highest-stakes actions are all reachable from `/menu`, and no dead or decorative buttons remain in the admin UI.
**Verified:** 2026-07-28T20:15:00Z
**Status:** passed
**Re-verification:** No — initial verification (post code-review/fix cycle)

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Owner can record a client payment entirely from `/menu`, without dropping into free chat | ✓ VERIFIED | `showAdminRootMenu` (src/telegram/handlers/admin-menu.ts:48-81) has a `Καταχώρηση Πληρωμής` row → `menu:payment` callback_data. `handleMenuCallback`'s `case menuAction === 'payment'` (line 592-594) calls `showClientSelection(business.id, chatId)` directly — the pre-existing full payment flow (client → package → confirm). WR-02 fix confirmed: `showClientSelection` now checks `isInBusinessContext()` (src/telegram/handlers/payment-flow.ts:60-69) to avoid nesting a second DB transaction when called from the menu-callback path. `tests/admin-menu.test.ts` and `tests/billing-payment-flow.test.ts` both pass (87/87 across the 5 scoped suites). |
| 2 | Owner can reach hours, services, prices, and class setup editing from `/menu` entry points | ✓ VERIFIED | `showSettingsMenu` (admin-menu.ts:87-166) has 3 new example-phrase buttons (`menu:settings:hours_examples`, `..:services_examples`, `..:classes_examples`) placed before the back button; `handleMenuCallback` handles all 3 (lines 545-576), each sending 3 distinct Greek example phrases (verified via `•` bullet count in code). Per the locked D-06 decision, actual editing happens via the existing free-form Gemini NLU owner agent — these buttons are the discoverability entry point into that chat flow, which matches the ROADMAP wording ("reach ... editing from /menu entry points"), not a full in-menu edit form. |
| 3 | Tapping "reply to client" either delivers the owner's next message to the escalating client, or the button no longer appears | ✓ VERIFIED | End-to-end relay implemented: `escl:reply` callback calls `stagePendingReply(ownerBusiness.id, senderTelegramId, escl.clientTelegramId)` (telegram.ts:665) before its prompt. `handleFoundBusiness`'s owner branch calls `consumePendingReply(business.id, senderTelegramId)` (line 168) BEFORE the unconditional `aiOwnerAgent` call (line 195) — confirmed by line-order inspection. On consume, relays via `botTokenStore.run(business.botToken!, ...)` + `sendTelegramMessage`, then confirms `'Η απάντηση στάλθηκε.'` to the owner (lines 168-188). Relay failure degrades to a Greek error message without throwing (try/catch, lines 170-181). All of this is exercised and passing in `tests/telegram-webhook.test.ts` (Test 28-01 through 28-04). |
| 4 | The decorative "Νέο μάθημα (chat)" button (and any other no-op button found in the sweep) is removed or wired to a real action | ✓ VERIFIED | `classes:create` case body (admin-menu.ts:604-613) now sends a 3-bullet multi-example message instead of the old single rigid phrase; button label/callback_data (`menu:classes:create` / "Νέο μάθημα (chat)") unchanged per D-08. No other no-op button found in `handleMenuCallback`'s switch — every `case` maps to a real handler; `default` sends an explicit "Άγνωστη ενέργεια μενού." fallback, not a silent no-op. |

**Score:** 4/4 truths verified (0 present-but-behavior-unverified)

### Post-Review Fix Verification (CR-01, CR-02, WR-01, WR-02, WR-03)

The phase went through a code-review + fix cycle (28-REVIEW.md → 28-REVIEW-FIX.md). All 5 in-scope findings were independently re-verified against the current codebase (not just the fix-report narrative):

| Finding | Claimed Fix | Verified in Code | Verified in Tests | Commit |
|---------|-------------|-------------------|--------------------|--------|
| CR-01 (Critical): `pendingReplies` had no business scoping — cross-business relay leak | Map re-keyed by `${businessId}:${ownerTelegramId}` composite; all 4 call sites in telegram.ts updated to pass `business.id`/`ownerBusiness.id` | ✓ Confirmed: `pending-reply.ts:30-32` (`pendingReplyKey`), all exported functions take `businessId` as first param; `telegram.ts` call sites at lines 125, 155, 168, 220, 665, 702 all pass `business.id` or `ownerBusiness.id` | ✓ `tests/pending-reply.test.ts` "CR-01" tests (lines 80, 92) prove Business A's staged entry is invisible to Business B's consume/clear even with identical ownerTelegramId | `892e2ae` (present in git log) |
| CR-02 (Critical): owner `/start` didn't clear pending reply, leaking literal "/start" text to client | Owner branch's `/menu` pre-emption extended to also match `/start` | ✓ Confirmed: telegram.ts:117 `if (messageText.trim() === '/menu' || messageText.trim() === '/start')` | ✓ `tests/telegram-webhook.test.ts` "Test 28-02b (CR-02 regression)" (line 808) | `85e694c` (present in git log) |
| WR-01: inline "back to menu" tap didn't clear pending reply | `clearPendingReply` added to top of `menuAction` callback branch | ✓ Confirmed: telegram.ts:702, inside `if ('menuAction' in parsed)` block, before `handleMenuCallback` dispatch | ✓ "Test 28-02c (WR-01 regression)" (line 837) | `9af18fb` (present in git log) |
| WR-02: `showClientSelection` nested a 2nd transaction inside the outer callback-query transaction | Added `isInBusinessContext()` helper; `showClientSelection` skips nested `withBusinessContext` when already inside one | ✓ Confirmed: `database/queries.ts:38-40` (`isInBusinessContext`), `payment-flow.ts:60-69` (conditional use) | ✓ `tests/billing-payment-flow.test.ts` "WR-02 fix" test (line 184) | `ded788b` (present in git log) |
| WR-03: non-text message while reply pending silently consumed the entry and tried to relay `''` | Added non-consuming `hasPendingReply` peek; guard added before consume, sends explanatory Greek text, leaves entry intact | ✓ Confirmed: `pending-reply.ts:98-100` (`hasPendingReply`), `telegram.ts:155-166` (guard before `consumePendingReply`) | ✓ "Test 28-04 (WR-03 regression)" (line 883) | `b8f36e7` (present in git log) |

All 5 fix commits (`892e2ae`, `85e694c`, `9af18fb`, `ded788b`, `b8f36e7`) plus the 4 original feature commits (`833f354`, `06e7584`, `0b2f579`, `5d889ef`) are present in `git log` — confirmed via `git log --oneline --all | grep`.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/telegram/handlers/admin-menu.ts` | Payment button row + case; 3 example-phrase rows + cases; upgraded `classes:create` | ✓ VERIFIED | All present, wired into `handleMenuCallback` switch, correct case ordering (exact-match cases before `startsWith('settings:')` fallback) |
| `src/telegram/handlers/pending-reply.ts` (new) | `pendingReplies` Map, stage/consume/clear/hasPendingReply, business-scoped key | ✓ VERIFIED | File exists, business-scoped composite key confirmed, `.unref()`'d timer present |
| `src/webhooks/telegram.ts` | `escl:reply` stages; owner branch intercepts before `aiOwnerAgent`; `/menu`+`/start`+`menuAction` all clear | ✓ VERIFIED | All 4 wiring points confirmed present and correctly ordered |
| `src/telegram/handlers/payment-flow.ts` | `isInBusinessContext()`-aware `showClientSelection` | ✓ VERIFIED | WR-02 fix present |
| `src/database/queries.ts` | `isInBusinessContext()` export | ✓ VERIFIED | Present, checks `currentTx.getStore()` |
| `tests/admin-menu.test.ts`, `tests/pending-reply.test.ts`, `tests/telegram-webhook.test.ts`, `tests/billing-payment-flow.test.ts` | Regression coverage for all above | ✓ VERIFIED | All present and passing |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `menu:payment` callback | `showClientSelection` | `handleMenuCallback`'s `case menuAction === 'payment'` | ✓ WIRED | Called with `(business.id, chatId)` — correct arg order |
| `escl:reply` callback | `stagePendingReply` | `escalationAction` branch `else` clause | ✓ WIRED | Staged before prompt sent |
| Owner free-text message | `aiOwnerAgent` (bypass) | `consumePendingReply` intercept | ✓ WIRED | Intercept at line 168, `aiOwnerAgent` call at line 195 — intercept precedes and `return`s |
| `/menu`, `/start`, `menu:root` tap | `clearPendingReply` | Owner-branch pre-emption + `menuAction` callback branch | ✓ WIRED | 3 distinct call sites confirmed (lines 125, 220, 702) |
| Relay send | `botTokenStore.run` + `sendTelegramMessage` | Reply-relay block | ✓ WIRED | Correct bot-token scoping to business |

### Behavioral Spot-Checks / Test Execution

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles clean | `npx tsc --noEmit` | Exit 0, no output | ✓ PASS |
| Scoped test suites (admin-menu, pending-reply, telegram-webhook, billing-payment-flow) | `npx jest --testPathPattern="admin-menu\|pending-reply\|telegram-webhook\|billing-payment-flow" --no-coverage` | 5 suites, 87/87 tests passed | ✓ PASS |
| Claimed commits exist in git history | `git log --oneline --all \| grep <hashes>` | All 9 commits found | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ADMIN-01 | 28-02-PLAN.md | Reply-to-client relay wired or button removed | ✓ SATISFIED | Full relay implemented + business-scoped + navigation-clearing, all regression-tested |
| ADMIN-02 | 28-01-PLAN.md | Decorative buttons removed/wired | ✓ SATISFIED | `classes:create` upgraded; no other no-op button found in dispatcher |
| ADMIN-03 | 28-01-PLAN.md | Payment recording from `/menu` | ✓ SATISFIED | `menu:payment` → `showClientSelection` |
| ADMIN-04 | 28-01-PLAN.md | Menu entry points for hours/services/prices/class setup | ✓ SATISFIED | 3 Settings example-phrase buttons |

**Note:** `.planning/REQUIREMENTS.md` still shows ADMIN-01 through ADMIN-04 as unchecked (`- [ ]`) and their status table still reads "Pending" (lines 15-18, 67-70). This is a documentation-sync gap, not a functional gap — code evidence fully satisfies all four requirements. Flagged for the orchestrator to update REQUIREMENTS.md checkboxes when this phase is marked complete.

### Anti-Patterns Found

None. Grep for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER|not yet implemented|coming soon` across all phase-touched files (`admin-menu.ts`, `pending-reply.ts`, `payment-flow.ts`, `telegram.ts`, `queries.ts`) returned zero matches.

### Human Verification Required

None required to pass this gate. The 28-01-SUMMARY.md's own `human_judgment: true` item (D4: "actual button taps in a live chat") is standard UX-feel verification that doesn't block the goal-backward code-level pass — all functional/logic claims were independently re-derived from source, not accepted from the SUMMARY narrative, and are backed by passing automated tests plus manual code-path tracing (line-order checks for the two critical ordering invariants: intercept-before-aiOwnerAgent, and exact-match-cases-before-startsWith-fallback).

Recommended (non-blocking) human spot-check before wider rollout, carried over from 28-REVIEW-FIX.md's own note on CR-02: confirm in a real Telegram session that owner `/start` shows the admin menu as expected and doesn't disrupt onboarding-adjacent flows — this is a logic-branch change (not pure data-scoping) and the reviewer explicitly flagged it as worth a human look despite passing regression tests.

### Gaps Summary

No blocking gaps. All 4 ROADMAP success criteria verified against actual code (not SUMMARY narrative). All 2 Critical + 3 Warning code-review findings were independently re-confirmed as fixed in the current codebase, each backed by a passing regression test and a real git commit. TypeScript compiles clean; all 4 scoped test suites (87 tests) pass. One minor documentation-sync item noted (REQUIREMENTS.md checkboxes) — informational only, does not affect phase goal achievement.

---

_Verified: 2026-07-28T20:15:00Z_
_Verifier: Claude (gsd-verifier)_
