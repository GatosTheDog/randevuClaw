---
phase: 29-booking-list-clarity
reviewed: 2026-07-28T19:55:30Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/utils/timezone.ts
  - src/utils/greek-messages.ts
  - src/session/manager.ts
  - src/conversation/function-executor.ts
  - src/webhooks/telegram.ts
  - src/telegram/handlers/admin-menu.ts
  - src/telegram/handlers/client-menu.ts
findings:
  critical: 0
  warning: 3
  info: 1
  total: 4
status: issues_found
---

# Phase 29: Code Review Report

**Reviewed:** 2026-07-28T19:55:30Z
**Depth:** standard
**Files Reviewed:** 7 (plus cross-referencing of test files: tests/timezone.test.ts, tests/session-list.test.ts, tests/session-booking-flow.test.ts, tests/telegram-webhook.test.ts, tests/admin-menu.test.ts, tests/webhooks/client-menu.test.ts, tests/client-escalation.test.ts, tests/escalation.test.ts)
**Status:** issues_found

## Summary

Reviewed all 7 source files changed across the 6 plans of Phase 29 (booking-list-clarity), plus the 6 declared test files and 2 additional escalation test files pulled in for cross-referencing the `escl:approve` path. The phase's three headline safety requirements hold up under scrutiny:

- **`excludePastToday` default:** Verified `false` everywhere it matters. All 8 owner-facing call sites (`admin-menu.ts:287,323`, `ai-owner-agent.ts:801,823,857,925,1111`, `ai-onboarding-agent.ts:507`) pass 0–2 args and are untouched by this phase; all 5 client-facing call sites (`function-executor.ts` ×4, `client-menu.ts:118`) explicitly pass `true`. The Athens-timezone boundary math in `hoursUntilSession` (`src/utils/timezone.ts`) is correct — manually traced through the noon-UTC-anchor offset derivation and the DST-transition test case, and the `> 0` (not `>= 0`) strictness is applied consistently at the one call site that matters (`manager.ts:544`).
- **`findSessionInstanceById` / cross-business scoping:** Genuinely query-level scoped — `businessId` is enforced via the `sessionCatalog` join's WHERE clause, not merely passed-through-and-ignored. Verified with a real cross-business unit test (`tests/session-list.test.ts`). The `escl:approve` swap in `telegram.ts` closes a real pre-existing information-read gap (old join had zero `businessId` filter) — but see WR-03 below regarding its test coverage.
- **`showCancelConfirm` ownership guard (client-menu.ts):** Runs before any booking-derived text is composed, and both failure paths ("not found" vs "not yours") return the byte-identical generic message + keyboard, with `findServiceById` never invoked on either failure branch — verified against dedicated tests. This is correctly implemented per its threat model (T-29-05). However, the sibling function `handleCancelExecute` two call-sites away, reachable via the exact same attacker-controlled `callback_data` surface, was NOT given the same treatment — see WR-01 below.

No BLOCKER-level findings. Three WARNINGs and one INFO item below, focused on: an information-disclosure inconsistency the phase fixed in one function but left in its sibling, a claimed-but-nonexistent test coverage gap for a security-relevant refactor, and a minor incomplete constant-consolidation.

## Warnings

### WR-01: `handleCancelExecute`'s early-return messages leak booking-existence/ownership as a distinguishable side-channel — the exact class of bug `showCancelConfirm` was just hardened against

**File:** `src/telegram/handlers/client-menu.ts:429-453`
**Issue:** `showCancelConfirm` (lines 381-416) was deliberately given an ownership guard this phase that returns the **identical** generic `'Κράτηση δεν βρέθηκε.'` message for both "booking not found" and "booking belongs to someone else" — explicitly to prevent an attacker from enumerating valid `bookingId`s by comparing response shapes (T-29-05, documented in the function's own doc comment and CONTEXT.md D-09).

`handleCancelExecute` sits directly behind it in the same dispatcher (`cmenu:cancel:yes:<bookingId>`) and is reachable with the identical attacker-controlled `callback_data` — a client can send `cmenu:cancel:yes:<bookingId>` directly without ever going through `showCancelConfirm`'s `cmenu:cancel:confirm:<bookingId>` step first. But `handleCancelExecute`'s own guards send **two different** messages:
```ts
// booking is null:
await sendTelegramMessageWithKeyboard(chatId, 'Κράτηση δεν βρέθηκε.', keyboard);
// booking exists but clientPhone !== senderTelegramId:
await sendTelegramMessageWithKeyboard(chatId, 'Δεν έχετε δικαίωμα ακύρωσης αυτής της κράτησης.', keyboard);
```
This distinguishability lets an attacker probe whether an arbitrary `bookingId` exists at all (route the ID through `cmenu:cancel:yes:<id>` and read which of the two Greek strings comes back) — precisely the side-channel the phase's own threat model for the sibling function calls out as unacceptable. The impact is bounded (only existence + non-ownership status leaks, not booking content, since no booking-derived text is composed on either branch), but it is a real, currently-exploitable gap in a flow this exact phase was actively hardening.
**Fix:** Collapse the two messages into the same generic text/keyboard used by `showCancelConfirm`, e.g.:
```ts
if (!booking || booking.clientPhone !== senderTelegramId) {
  if (booking) logger.warn({ bookingId, senderTelegramId, clientPhone: booking.clientPhone }, 'client cancel ownership mismatch');
  const keyboard: InlineKeyboard = [[{ text: BACK_MENU_LABELS.CLIENT, callback_data: 'cmenu:root' }]];
  await sendTelegramMessageWithKeyboard(chatId, 'Κράτηση δεν βρέθηκε.', keyboard);
  return;
}
```

### WR-02: `escl:approve`'s `findSessionInstanceById` swap (T-29-06 fix) has zero test coverage exercising actual execution

**File:** `src/webhooks/telegram.ts:605-654` (via `29-03-PLAN.md` Task 2); test gap in `tests/telegram-webhook.test.ts`, `tests/client-escalation.test.ts`, `tests/escalation.test.ts`
**Issue:** Plan 29-03's Task 2 acceptance criteria state: *"Existing escl:approve-related tests (reply-relay flow, approve-exception flow) in tests/telegram-webhook.test.ts continue passing unmodified."* No such tests exist. `tests/telegram-webhook.test.ts` contains zero references to `escl:approve`, `findSessionInstanceById`, `sbk:approve`, or `sbk:reject` — only `escl:reply` is exercised end-to-end. `tests/client-escalation.test.ts` and `tests/escalation.test.ts` only test `parseCallbackData`'s pure parsing and `buildEscalationKeyboard`'s button shape; neither drives `handleCallbackQuery` to actually execute the `escl:approve` branch's business logic (`client-escalation.test.ts`'s `jest.mock('../src/session/manager', ...)` only stubs `bookSessionInstance`, omitting `findSessionInstanceById` entirely — harmless only because no test in that file actually reaches that code).

29-03-SUMMARY.md's own verification for this change (D3) cites only `npx tsc --noEmit` and a grep for dead-import removal — never a behavioral assertion. This means the fix for a documented cross-business information-disclosure gap (T-29-06, rated "low" but real) shipped with type-checking as its only safety net, not a regression test. A future refactor could silently reintroduce the unscoped join, or break the `escl:approve` flow entirely, with no test catching it.
**Fix:** Add an integration test to `tests/telegram-webhook.test.ts` (or a new escalation-execution test file) that mocks `../src/session/manager` fully (including `findSessionInstanceById` and `bookSessionInstance`) and drives a full `escl:approve:<instanceId>:<clientTelegramId>` callback through `handleCallbackQuery`, asserting: (1) `findSessionInstanceById` is called with `(ownerBusiness.id, instanceId)`, (2) a cross-business instanceId (mocked to resolve `null`) results in `'Το μάθημα δεν βρέθηκε.'` with no `bookSessionInstance` call, (3) the happy path books successfully.

### WR-03: `showClientBalance`'s inline back-button literal was not migrated onto the shared `BACK_MENU_LABELS.CLIENT` constant

**File:** `src/telegram/handlers/client-menu.ts:539`
**Issue:** D-07 (locked decision) explicitly scopes `greek-messages.ts`'s new `BACK_MENU_LABELS` constant to replace inline back-button literals across this phase's touched functions in `client-menu.ts`. Every other function in this file was migrated (`showBookSessionList`, `showClientBookings`, `showCancelBookingList`, `showCancelConfirm`, `handleBookSessionExecute`, `handleCancelExecute`) — confirmed via grep that zero `'« Αρχικό μενού'` literals remain. `showClientBalance` was missed:
```ts
const backButton = { text: '« Πίσω', callback_data: 'cmenu:root' };
```
This currently happens to hold the exact same string value as `BACK_MENU_LABELS.CLIENT`, so there is no visible behavior bug today — but it reintroduces the drift risk D-07 was written to eliminate: a future wording change to `BACK_MENU_LABELS.CLIENT` would silently miss this call site.
**Fix:**
```ts
import { BACK_MENU_LABELS } from '../../utils/greek-messages'; // already imported in this file
const backButton = { text: BACK_MENU_LABELS.CLIENT, callback_data: 'cmenu:root' };
```

## Info

### IN-01: `handleCancelExecute`'s cutoff-check early return remains a text-only dead end (deliberate, but worth a follow-up note)

**File:** `src/telegram/handlers/client-menu.ts:471-485`
**Issue:** This is explicitly a locked, documented scope decision (CONTEXT.md D-05.2 names exactly 3 guards; 29-06-PLAN.md's Task 3 explicitly says "Leave the 4th (cutoff-check) early return exactly as-is"), so this is not a defect relative to the plan — flagging only because it is a residual UX-06 gap in the same function that got 3 sibling fixes this phase, and the stated rationale ("the message already states the actionable reason") is weaker than the actual fixes applied two lines above and below it.
**Fix (optional, future phase):** Add the same back-menu keyboard to this branch for consistency; no code risk in doing so since it is a pure additive UI change.

---

_Reviewed: 2026-07-28T19:55:30Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
