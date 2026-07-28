---
phase: 28-admin-menu-discoverability
fixed_at: 2026-07-28T18:45:00Z
review_path: .planning/phases/28-admin-menu-discoverability/28-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 28: Code Review Fix Report

**Fixed at:** 2026-07-28T18:45:00Z
**Source review:** .planning/phases/28-admin-menu-discoverability/28-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (2 Critical, 3 Warning — Info finding IN-01 explicitly excluded per scope)
- Fixed: 5
- Skipped: 0

## Fixed Issues

### CR-01: `pendingReplies` Map has no business scoping — cross-business relay leak

**Files modified:** `src/telegram/handlers/pending-reply.ts`, `src/webhooks/telegram.ts`, `tests/pending-reply.test.ts`
**Commit:** `892e2ae`
**Applied fix:** Keyed the `pendingReplies` Map by a `` `${businessId}:${ownerTelegramId}` `` composite instead of `ownerTelegramId` alone. `stagePendingReply`, `consumePendingReply`, and `clearPendingReply` all now take `businessId` as their first parameter. Updated all four call sites in `telegram.ts` to pass `business.id` (or `ownerBusiness.id` in the `escl:reply` callback branch, which is the same webhook-scoped, HMAC-verified business). Added two regression tests in `tests/pending-reply.test.ts` proving a reply staged for Business A is invisible to `consumePendingReply`/`clearPendingReply` calls for Business B even with an identical `ownerTelegramId`.

### CR-02: D-03 "/menu or /start clears a pending reply" not reachable for owners on `/start`

**Files modified:** `src/webhooks/telegram.ts`, `tests/telegram-webhook.test.ts`
**Commit:** `85e694c`
**Applied fix:** Extended the existing owner-branch `/menu` pre-emption (`if (messageText.trim() === '/menu')`) to also match `'/start'`, since the dedicated `/start` branch further down `handleFoundBusiness` is structurally unreachable for owners (every path through the owner branch returns first). Owner `/start` now clears the pending reply and shows the admin root menu, identically to `/menu`. Added `Test 28-02b` in `tests/telegram-webhook.test.ts` proving the literal `"/start"` text is no longer relayed to the escalating client and that a subsequent free-text message routes to `aiOwnerAgent` instead.
**Note:** this is a behavior/logic change (a new branch condition, not a pure data-scoping fix). Direct regression coverage was added (Test 28-02b), but per the verification strategy's logic-bug caveat, a human should still confirm in a real Telegram session that owner `/start` now shows the admin menu as expected and doesn't disrupt any other onboarding-adjacent flow.

### WR-01: Inline "back to menu" tap doesn't clear a pending reply

**Files modified:** `src/webhooks/telegram.ts`, `tests/telegram-webhook.test.ts`
**Commit:** `9af18fb`
**Applied fix:** Added `clearPendingReply(business.id, senderTelegramId)` at the top of the `menuAction` callback branch in `handleCallbackQuery` (right after the owner-only guard), mirroring the `/menu` text-command's D-03 behavior. Added `Test 28-02c` proving a `menu:root` inline-keyboard tap now clears a staged pending reply the same way the typed `/menu` command does.

### WR-02: `showClientSelection` nests a second `withBusinessContext` transaction inside the outer callback-query transaction

**Files modified:** `src/database/queries.ts`, `src/telegram/handlers/payment-flow.ts`, `tests/billing-payment-flow.test.ts`
**Commit:** `ded788b`
**Applied fix:** Added an exported `isInBusinessContext()` helper to `database/queries.ts` (checks whether the AsyncLocalStorage-backed transaction store already has an active transaction). `showClientSelection` in `payment-flow.ts` now calls `isInBusinessContext()` before each of its two DB reads and, when already inside an active business context (e.g. called from `telegram.ts`'s `menu:payment` callback branch, itself nested inside the outer `withBusinessContext`-wrapped `handleCallbackQuery` dispatch), calls the query function directly instead of opening a second `withBusinessContext` transaction. The pre-existing AI-agent tool-call path (`ai-owner-agent.ts:735`, deliberately outside any transaction per WR-04) is unaffected — `isInBusinessContext()` is `false` there, so the original `withBusinessContext` wrapping still runs. Added a regression test in `tests/billing-payment-flow.test.ts` asserting `withBusinessContext` is never called when `isInBusinessContext()` returns `true`.

### WR-03: Non-text owner message while a reply is pending silently consumes the pending reply and attempts to relay an empty string

**Files modified:** `src/telegram/handlers/pending-reply.ts`, `src/webhooks/telegram.ts`, `tests/pending-reply.test.ts`, `tests/telegram-webhook.test.ts`
**Commit:** `b8f36e7`
**Applied fix:** Added a non-consuming `hasPendingReply(businessId, ownerTelegramId)` peek function to `pending-reply.ts`. In `telegram.ts`, before the existing `consumePendingReply` call, added a guard: if `messageText` is empty (a photo/sticker/voice message, since `handleFoundBusiness` receives `update.message.text ?? ''`) AND a reply is currently staged, send a specific Greek message explaining that only text is forwarded (D-05) and return WITHOUT consuming the pending reply — so the owner can immediately retry with an actual text message instead of re-tapping `escl:reply` from scratch. Added a unit test for `hasPendingReply` and an integration test (`Test 28-04`) proving a photo message no longer attempts to relay an empty string, sends the specific Greek explanation (not the generic error), and leaves the pending reply intact for a follow-up text message.

## Skipped Issues

None — all five in-scope findings (CR-01, CR-02, WR-01, WR-02, WR-03) were fixed. IN-01 was explicitly out of scope for this pass per the task instructions.

## Verification

- `npx tsc --noEmit`: clean after every commit (5/5 checkpoints).
- Scoped test suites run after every commit via `--testPathPattern` (never the full suite): `pending-reply`, `telegram-webhook`, `billing-payment-flow`, `admin-menu`, `ai-owner-confirmation-policy` — all passing (49 tests in the final `pending-reply|telegram-webhook` run; 47 tests in the `billing-payment-flow|admin-menu|ai-owner-confirmation-policy` run).
- New regression tests added alongside the fixes for CR-01, CR-02, WR-01, WR-02, and WR-03 (11 new test cases total across `tests/pending-reply.test.ts`, `tests/telegram-webhook.test.ts`, and `tests/billing-payment-flow.test.ts`).

---

_Fixed: 2026-07-28T18:45:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
