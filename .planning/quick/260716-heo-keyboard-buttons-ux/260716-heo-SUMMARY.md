---
quick_id: 260716-heo
slug: keyboard-buttons-ux
date: "2026-07-16"
status: complete
tags: [ux, telegram, onboarding, booking, inline-keyboard]
key-files:
  modified:
    - src/onboarding/steps.ts
    - src/webhooks/platform.ts
    - src/webhooks/telegram.ts
    - tests/onboarding-flow.test.ts
    - tests/telegram-webhook.test.ts
decisions:
  - "YES_NO_BUTTONS constant defined once in steps.ts and reused across all yes/no prompts"
  - "Platform callback_query spinner answered before dispatchOnboardingStep to prevent UI freeze"
  - "client_cancel routing inserted before owner-check in handleCallbackQuery — clients are not owners"
  - "clientPhone stores Telegram user ID as string — equality check used for client ownership"
metrics:
  duration: ~15min
  tasks: 2
  files: 5
---

# Quick Task 260716-heo: keyboard buttons UX Summary

## One-liner

Replaced typed ναι/όχι onboarding prompts with Telegram inline keyboard Ναι/Όχι buttons and added a 🚫 Ακύρωση κράτησης cancel button to booking confirmation messages.

## What Was Built

### Task 1: Onboarding yes/no buttons

**`src/onboarding/steps.ts`**
- Imported `sendTelegramMessageWithKeyboard` from `../telegram/client`
- Defined `YES_NO_BUTTONS` constant (reused across all yes/no prompts)
- Converted all 5 yes/no prompt sites to use keyboard buttons:
  - `handleNameStep` → hours_0_query initial prompt (Sunday)
  - `handleHoursQueryStep` no-branch → next-day prompt (days 0-5)
  - `handleHoursQueryStep` else-branch → unrecognized re-ask
  - `handleHoursCloseStep` → next-day prompt (days 0-5 after close time)
  - `handleSvcDurationStep` → svc_more initial prompt ("service saved, add another?")
  - `handleSvcMoreStep` else-branch → unrecognized re-ask

**`src/webhooks/platform.ts`**
- Added `answerCallbackQuery` to import
- Added `isCallback` detection before messageText extraction
- `messageText` now pulls `callback_query.data` for callbacks (carries `'ναι'`/`'όχι'`)
- `updateType` now correctly set to `'callback_query'` for dedup
- Answers callback spinner (try/catch) before dispatching to `dispatchOnboardingStep`

### Task 2: Client cancel button on booking confirmation

**`src/webhooks/telegram.ts`**
- Imported `sendTelegramMessageWithKeyboard`
- Extended `parseCallbackData` regex to `/^(approve|reject|client_cancel)_(\d+)$/`; return type extended to include `'client_cancel'`
- Added `handleClientCancelCallback(bookingId, senderTelegramId)`:
  - Validates client ownership via `booking.clientPhone === senderTelegramId`
  - Only cancels if status is `pending_owner_approval` or `confirmed`
  - Calls `updateBookingStatus` → best-effort `deleteBookingFromCalendar` → notifies owner → sends Greek confirmation to client
- Routed `client_cancel` action in `handleCallbackQuery` **before** the owner-check (clients are not owners)
- Changed approve-branch client message from `sendTelegramMessage` to `sendTelegramMessageWithKeyboard` with `[[{ text: '🚫 Ακύρωση κράτησης', callback_data: 'client_cancel_${updated.id}' }]]`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated 6 test assertions broken by keyboard migration**
- **Found during:** post-implementation test run
- **Issue:** `tests/onboarding-flow.test.ts` and `tests/telegram-webhook.test.ts` had 6 assertions checking `mockedSendTelegramMessage.mock.calls` for prompts that now route through `sendTelegramMessageWithKeyboard`
- **Fix:** Added `mockedSendTelegramMessageWithKeyboard` typed mock and `mockResolvedValue` in both test `beforeEach` blocks; updated 6 assertions to assert on the keyboard mock
- **Files modified:** `tests/onboarding-flow.test.ts`, `tests/telegram-webhook.test.ts`
- **Commit:** 0425059 (bundled in same atomic commit)

**Pre-existing failures (out of scope):** `scheduler-agenda.test.ts` had 4 failing tests before this task; confirmed via `git stash` pre-check. Not touched.

## Self-Check

### Files exist

- [x] `src/onboarding/steps.ts` — modified
- [x] `src/webhooks/platform.ts` — modified
- [x] `src/webhooks/telegram.ts` — modified
- [x] `tests/onboarding-flow.test.ts` — modified
- [x] `tests/telegram-webhook.test.ts` — modified

### Commit exists

- [x] 0425059 — feat(ux): add inline keyboard buttons to onboarding and booking confirmation

### Tests pass

- [x] `tests/onboarding-flow.test.ts` — 20/20 pass
- [x] `tests/telegram-webhook.test.ts` — 17/17 pass
- [x] `tests/onboarding-platform.test.ts` — 8/8 pass

## Self-Check: PASSED
