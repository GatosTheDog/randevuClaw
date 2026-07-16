---
quick_id: 260716-heo
slug: keyboard-buttons-ux
description: "keyboard buttons UX"
date: "2026-07-16"
status: pending
must_haves:
  truths:
    - "Onboarding yes/no prompts send inline keyboard buttons (Ναι/Όχι) instead of text hints"
    - "Platform webhook routes callback_query updates to dispatchOnboardingStep using callback_data"
    - "Confirmed booking client message includes a 🚫 Ακύρωση κράτησης inline button"
    - "Client cancel callback_query cancels booking, deletes calendar event, notifies owner"
  artifacts:
    - "src/onboarding/steps.ts — handleHoursQueryStep and handleSvcMoreStep use sendTelegramMessageWithKeyboard"
    - "src/webhooks/platform.ts — callback_query routing with answerCallbackQuery"
    - "src/webhooks/telegram.ts — parseCallbackData includes client_cancel; handleCallbackQuery routes client cancels"
---

# Quick Task 260716-heo: keyboard buttons UX

## Goal

Replace typed ναι/όχι input with Telegram inline keyboard buttons in:
1. Onboarding yes/no prompts (hours query + add-another-service)
2. Add a cancel button to client booking confirmations sent after owner approval

## Context

- `sendTelegramMessageWithKeyboard` exists in `src/telegram/client.ts` (already used for owner approve/reject)
- Onboarding dispatcher is in `src/onboarding/router.ts` — dispatches based on session step and message text
- Platform webhook (`src/webhooks/platform.ts`) currently ignores callback_query data (extracts empty messageText)
- Per-business webhook (`src/webhooks/telegram.ts`) already handles approve/reject callback_queries for owners

---

## Task 1: Onboarding yes/no buttons

**Files**: `src/onboarding/steps.ts`, `src/webhooks/platform.ts`

### steps.ts changes

Import `sendTelegramMessageWithKeyboard` alongside existing `sendTelegramMessage`.

In `handleHoursQueryStep`:
- Both the initial prompt AND the unrecognized-input re-ask must use `sendTelegramMessageWithKeyboard`
- Buttons: `[[{ text: 'Ναι', callback_data: 'ναι' }, { text: 'Όχι', callback_data: 'όχι' }]]`
- Existing `includes('ναι')` / `includes('όχι')` checks already handle callback_data values without modification

In `handleSvcMoreStep`:
- Both the success prompt AND the unrecognized-input re-ask must use `sendTelegramMessageWithKeyboard`
- Same buttons as above

### platform.ts changes

The platform bot already extracts callback_query sender ID but uses empty messageText for callbacks.

After extracting `ownerTelegramId`, detect callback_query vs message:
```ts
const isCallback = !!update.callback_query;
const messageText = isCallback
  ? (update.callback_query!.data ?? '')
  : (update.message?.text?.trim() ?? '');
const updateType = isCallback ? 'callback_query' : 'message';
```

Before dispatching (after dedup succeeds), answer the callback spinner:
```ts
if (isCallback) {
  try { await answerCallbackQuery(update.callback_query!.id); } catch {}
}
```

Pass `messageText` (which now contains callback_data like 'ναι'/'όχι') to `dispatchOnboardingStep`.

Fix dedup to use the correct `updateType`.

**Verify**: `handleHoursQueryStep` with text='ναι' (the callback_data value) hits the `isYes` branch → advances step. Same for 'όχι' → `isNo` branch.

**Done when**: Onboarding yes/no steps send buttons; tapping Ναι/Όχι advances the flow without typing.

---

## Task 2: Client cancel button on booking confirmation

**File**: `src/webhooks/telegram.ts`

### parseCallbackData extension

Extend regex to `^(approve|reject|client_cancel)_(\d+)$` and type to include `'client_cancel'`.

### handleCallbackQuery routing

After `answerCallbackQuery` and null check on `parsed`:

```ts
if (parsed.action === 'client_cancel') {
  await handleClientCancelCallback(parsed.bookingId, senderTelegramId);
  return;
}
// ... existing owner approve/reject flow unchanged
```

### handleClientCancelCallback (new function)

```ts
async function handleClientCancelCallback(bookingId: number, senderTelegramId: string) {
  const booking = await findBookingByIdUnscoped(bookingId);
  if (!booking) return;

  // Client ownership: clientPhone stores Telegram user ID as string
  if (booking.clientPhone !== senderTelegramId) {
    logger.warn({ bookingId, senderTelegramId }, 'client_cancel from non-client, ignoring');
    return;
  }

  const CANCELLABLE = ['pending_owner_approval', 'confirmed'];
  if (!CANCELLABLE.includes(booking.bookingStatus)) return;

  await updateBookingStatus(booking.id, 'cancelled');

  const business = await findBusinessById(booking.businessId);
  const service = await findServiceById(booking.businessId, booking.serviceId);

  // Best-effort calendar delete
  try {
    if (business) await deleteBookingFromCalendar(booking, business);
  } catch (err) {
    logger.error({ err, bookingId }, 'Client cancel: calendar delete failed (best-effort)');
  }

  // Notify owner
  try {
    if (business?.ownerTelegramId) {
      const ownerText = `Ακύρωση ραντεβού από πελάτη:\nΥπηρεσία: ${service?.name ?? 'άγνωστη'}\nΗμερομηνία: ${booking.calendarDate}\nΏρα: ${booking.calendarTime}\nΠελάτης: ${booking.clientPhone}`;
      await sendTelegramMessage(business.ownerTelegramId, ownerText);
    }
  } catch (err) {
    logger.error({ err, bookingId }, 'Client cancel: owner notification failed (best-effort)');
  }

  await sendTelegramMessage(senderTelegramId, 'Το ραντεβού σας ακυρώθηκε.');
}
```

### Add cancel button to booking confirmation

In the `approve` branch of `handleCallbackQuery`, change the client confirmation from `sendTelegramMessage` to `sendTelegramMessageWithKeyboard`:

```ts
await sendTelegramMessageWithKeyboard(
  updated.clientPhone,
  `Το ραντεβού σας επιβεβαιώθηκε! ${service?.name ?? ''}, ${updated.calendarDate} στις ${updated.calendarTime}.`,
  [[{ text: '🚫 Ακύρωση κράτησης', callback_data: `client_cancel_${updated.id}` }]]
);
```

**Required imports**: `findServiceById` is already imported; `deleteBookingFromCalendar` is already imported; `updateBookingStatus` is already imported. `findBookingByIdUnscoped` already imported.

**Done when**: Owner tapping Αποδοχή sends client a message with a cancel button; client tapping it cancels the booking.

---

## Commit plan

Single atomic commit after both tasks:
```
feat(ux): add inline keyboard buttons to onboarding and booking confirmation
```
