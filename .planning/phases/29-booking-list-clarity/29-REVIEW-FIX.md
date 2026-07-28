---
phase: 29-booking-list-clarity
fixed_at: 2026-07-28T00:00:00Z
review_path: .planning/phases/29-booking-list-clarity/29-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 29: Code Review Fix Report

**Fixed at:** 2026-07-28T00:00:00Z
**Source review:** .planning/phases/29-booking-list-clarity/29-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (Warning-severity: WR-01, WR-02, WR-03; 0 Critical this iteration; IN-01 excluded per instruction — documented, deliberately-scoped item, not a defect)
- Fixed: 3
- Skipped: 0

## Fixed Issues

### WR-01: `handleCancelExecute`'s early-return messages leak booking-existence/ownership as a distinguishable side-channel

**Files modified:** `src/telegram/handlers/client-menu.ts`, `tests/webhooks/client-menu.test.ts`
**Commit:** `509b51a`
**Applied fix:** Collapsed the two separate early-return branches ("booking not found" and "booking belongs to someone else") in `handleCancelExecute` into a single `if (!booking || booking.clientPhone !== senderTelegramId)` guard that always sends the byte-identical generic message (`'Κράτηση δεν βρέθηκε.'`) with the same back-menu keyboard, matching `showCancelConfirm`'s existing anti-enumeration pattern exactly. The `logger.warn` ownership-mismatch diagnostic is preserved (now conditional on `booking` being non-null) so operational visibility into mismatch attempts is unchanged. Updated the one test in `tests/webhooks/client-menu.test.ts` that asserted the old, now-removed two-message behavior (it previously expected `expect.stringContaining('δικαίωμα')`) to assert the new byte-identical message instead — this test was directly encoding the bug the finding flags, so keeping it unmodified would have made the fix untestable. Verified with `npx tsc --noEmit` (clean) and `npx jest --testPathPattern=client-menu` (64/64 passed).

### WR-02: `escl:approve`'s `findSessionInstanceById` swap (T-29-06 fix) has zero test coverage exercising actual execution

**Files modified:** `tests/telegram-webhook.test.ts`
**Commit:** `003f81a`
**Applied fix:** Added `jest.mock('../src/session/manager')` plus `mockedFindSessionInstanceById` / `mockedBookSessionInstance` mock handles, and a new describe block (`POST /webhooks/telegram/:webhookId — escl:approve flow (T-29-06/WR-02)`) with three tests driving a full `escl:approve:<instanceId>:<clientTelegramId>` callback through `handleCallbackQuery` via the real webhook endpoint (not just `parseCallbackData`'s pure parsing, which was the pre-existing gap): (1) a cross-business/nonexistent `instanceId` (mocked to resolve `null`) results in `'Το μάθημα δεν βρέθηκε.'` sent to the owner with `bookSessionInstance` never called, and asserts `findSessionInstanceById` was called with `(ownerBusiness.id, instanceId)`; (2) the happy path — `findSessionInstanceById` resolves a session, `bookSessionInstance` resolves `{status: 'success'}` — asserts the resolved `serviceId` flows into the `bookSessionInstance` call, the idempotency key matches the source code's exact format, and both the client and owner receive their respective confirmation messages; (3) a `full`-capacity result from `bookSessionInstance` sends the apology message without notifying the client. Verified the new mock doesn't regress any of the file's other 42 pre-existing tests (session/manager wasn't referenced by any of them), confirmed the two adjacent escalation test files (`tests/client-escalation.test.ts`, `tests/escalation.test.ts`) still pass unaffected, and `npx tsc --noEmit` is clean.

### WR-03: `showClientBalance`'s inline back-button literal was not migrated onto the shared `BACK_MENU_LABELS.CLIENT` constant

**Files modified:** `src/telegram/handlers/client-menu.ts`
**Commit:** `7f80b95`
**Applied fix:** Replaced the inline literal `{ text: '« Πίσω', callback_data: 'cmenu:root' }` in `showClientBalance` with `{ text: BACK_MENU_LABELS.CLIENT, callback_data: 'cmenu:root' }`. `BACK_MENU_LABELS` was already imported in this file (used by every sibling function), so no import change was needed. No behavior change today (the literal matched the constant's value exactly) — this closes the drift-risk gap D-07 was written to eliminate. Verified with `npx tsc --noEmit` (clean) and `npx jest --testPathPattern=client-menu` (64/64 passed).

## Skipped Issues

None — all in-scope findings were fixed.

---

_Fixed: 2026-07-28T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
