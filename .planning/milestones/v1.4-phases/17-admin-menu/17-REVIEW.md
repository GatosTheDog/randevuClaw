---
phase: 17-admin-menu
reviewed: 2026-07-24T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/scheduler/agenda.ts
  - src/telegram/handlers/admin-menu.ts
  - src/webhooks/telegram.ts
  - tests/admin-menu.test.ts
findings:
  critical: 1
  warning: 5
  info: 3
  total: 9
status: issues_found
---

# Phase 17: Code Review Report

**Reviewed:** 2026-07-24
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed the admin menu feature (`/menu` command, inline-keyboard sub-menus for Settings/Classes/Clients/Agenda) and its dispatch path in the Telegram webhook handler. The Classes cancel flow's binary Ναι/Όχι confirmation genuinely gates the destructive `cancelSession` call, and `cancelSession`/`listSessions` both scope queries by `businessId` at the SQL level, which is good defense-in-depth. The Clients sub-menu correctly re-verifies `rel.businessId === business.id` after resolving a `clientBusinessRelationshipId` from callback_data before displaying or acting on it.

However, the menu callback dispatcher in `webhooks/telegram.ts` re-derives the acting business via `findBusinessByOwnerTelegramId(senderTelegramId)` instead of using the already-authenticated, webhook-scoped `business` object that was passed into `handleCallbackQuery` — and that lookup has no uniqueness guarantee on `ownerTelegramId`, so it can silently resolve to the wrong tenant when one Telegram account owns more than one business (a case the schema does not prevent). This is a genuine cross-tenant risk for the entire menu feature, not just one action. Additional issues: the on-demand agenda pulls a different booking-status set than the scheduled 8am push despite reusing its formatter (misleading data), a Greek UI mistranslation, a confirmation prompt that doesn't tell the admin what they're about to cancel, and a couple of quality/coverage gaps.

## Critical Issues

### CR-01: Admin menu callback routing can resolve the wrong tenant when one owner Telegram ID maps to multiple businesses

**File:** `src/webhooks/telegram.ts:412-425`
**Issue:**
`handleCallbackQuery` already receives a `business` parameter that was resolved and authenticated by the webhook itself (`findBusinessByWebhookId` + HMAC secret check in `handleTelegramWebhookPost`, `src/webhooks/telegram.ts:706-731`). That `business` is unambiguously the correct tenant for this specific bot/webhook.

Instead of using it, the `menuAction` branch throws it away and re-resolves the tenant from scratch:

```ts
if ('menuAction' in parsed) {
  const menuResult = parsed as MenuCallbackResult;
  const ownerBusiness = await findBusinessByOwnerTelegramId(senderTelegramId);
  ...
  await handleMenuCallback(menuResult, ownerBusiness, senderTelegramId);
```

`findBusinessByOwnerTelegramId` (`src/onboarding/queries.ts:23-32`) is:
```ts
const rows = await db.select().from(businesses)
  .where(eq(businesses.ownerTelegramId, ownerTelegramId)).limit(1);
return rows[0] ?? null;
```
There is no `UNIQUE` constraint on `businesses.owner_telegram_id` in the schema (`src/database/schema.ts:21`), and no `ORDER BY` in the query. If the same person (a very plausible scenario for this product, per the per-business-bot pivot referenced in project memory — one owner running e.g. a pilates studio *and* a gym with the same personal Telegram account) owns two businesses, this query can non-deterministically return a *different* business than the one whose webhook actually received the callback. Every downstream admin-menu action — settings toggles (`handleSettingsToggle`), class cancellation (`handleClassCancelExecute`), client balance lookups and renewal nudges (`showClientBalance`, `handleRenewalNudge`) — then reads and writes the wrong tenant's data, because they all trust `ownerBusiness` as ground truth.

This directly undermines the stated security contract at the top of `admin-menu.ts` ("re-derives businessId from senderTelegramId... never trust an ID in callback_data") — the re-derivation itself is not tenant-safe. Contrast with `handleFoundBusiness`'s `/menu` entry point (`src/webhooks/telegram.ts:78-85`), which correctly reuses the webhook-scoped `business` and just checks `business.ownerTelegramId === senderTelegramId` — no ambiguous re-lookup needed.

**Fix:** Use the already-authenticated `business` parameter and validate ownership against it instead of re-querying by Telegram ID:
```ts
if ('menuAction' in parsed) {
  const menuResult = parsed as MenuCallbackResult;
  if (business.ownerTelegramId !== senderTelegramId) {
    logger.warn({ senderTelegramId }, 'menu callback from non-owner, ignoring');
    return;
  }
  if (callbackQuery.message?.message_id) {
    await editTelegramMessageReplyMarkup(senderTelegramId, callbackQuery.message.message_id, []);
  }
  await handleMenuCallback(menuResult, business, senderTelegramId);
  return;
}
```
(Note: the same `findBusinessByOwnerTelegramId(senderTelegramId)` pattern also appears in the billing/slotless/renewal/escalation branches of this file; those are pre-existing and out of Phase 17's scope, but share the same latent risk and should be tracked separately.)

## Warnings

### WR-01: On-demand "Today's Agenda" shows a different booking set than the scheduled 8am push, with no visual distinction

**File:** `src/telegram/handlers/admin-menu.ts:212-215`, `src/scheduler/agenda.ts:76`, `src/database/queries.ts:682-686`
**Issue:** `listBookingsForDate` defaults to `statuses = ['confirmed']` when no third argument is passed. The scheduled sweep (`runAgendaSweep`, `agenda.ts:76`) uses that default — confirmed bookings only. `showTodaysAgenda` explicitly overrides it:
```ts
const bookingList = await listBookingsForDate(business.id, today, [
  'confirmed',
  'pending_owner_approval',
]);
```
Both paths then feed the identical `formatAgendaMessage`, which prints each booking as `HH:MM - Service (client)` with no status indicator. An admin opening `/menu → Ατζέντα Σήμερα` will see appointments mixed in that haven't actually been approved yet, displayed identically to confirmed ones — risking the admin treating a not-yet-approved booking as a done deal (e.g. preparing capacity, expecting the client to show up).
**Fix:** Either match the scheduled push's filter (`confirmed` only) for true "reuses the same data" parity, or, if showing pending bookings is intentional, label each line with its status (e.g. `"(εκκρεμεί έγκριση)"` suffix for `pending_owner_approval` rows) so the two states aren't visually indistinguishable.

### WR-02: Greek UI text mistranslation on the multi-booking toggle button

**File:** `src/telegram/handlers/admin-menu.ts:118-123`
**Issue:**
```ts
const multiText = business.allowMultiBooking
  ? 'Απαγόρευση πολλαπλών'
  : 'Επιτροπή πολλαπλών';
```
"Επιτροπή" means "Committee/Commission" in Greek, not "enable/allow" — it's the wrong word entirely (likely a typo for a verb form like "Επιτρέψτε"/"Ενεργοποίηση"). Since this product is Greek-only and the target users are non-technical business owners, a nonsensical label on a settings toggle is a real usability defect, not just cosmetic.
**Fix:**
```ts
const multiText = business.allowMultiBooking
  ? 'Απαγόρευση πολλαπλών'
  : 'Ενεργοποίηση πολλαπλών';
```

### WR-03: `assertCallbackDataSize` only logs — it never prevents the oversized payload from being sent

**File:** `src/telegram/handlers/admin-menu.ts:34-41`
**Issue:**
```ts
function assertCallbackDataSize(data: string): void {
  if (Buffer.byteLength(data, 'utf8') > 64) {
    logger.warn(..., 'callback_data exceeds 64 bytes — Telegram will reject');
  }
}
```
Despite the name and the log message stating Telegram "will reject" the payload, the function takes no corrective action (truncate, drop the button, throw) — every call site proceeds to build and send the keyboard regardless. If a value ever does exceed 64 bytes (e.g., a future change embeds a longer suffix, or `relId`/`instanceId` become larger composite keys), `sendTelegramMessageWithKeyboard` will get a 400 from the Bot API and throw; none of the admin-menu call sites wrap that call in try/catch, so the admin silently gets no response at all (the exception is only caught — and merely logged — by the outermost handler in `handleTelegramWebhookPost`).
**Fix:** Either make the guard authoritative (throw, or fall back to a shorter/omitted button) or drop the "assert" naming/log wording in favor of what it actually does (an audit-only warning), and add a try/catch with a user-facing fallback message at call sites that build keyboards from dynamic IDs.

### WR-04: Class-cancellation confirmation prompt shows only a raw ID, defeating the purpose of the Ναι/Όχι gate

**File:** `src/telegram/handlers/admin-menu.ts:297-311`
**Issue:** `showCancelClassList` renders each class as `"${sessionDate} ${sessionTime}"`, but once a class is selected, `showCancelClassConfirm(chatId, instanceId)` only has the bare `instanceId` (from callback_data) and shows:
```ts
`Να ακυρωθεί το μάθημα #${instanceId};`
```
The admin loses the date/time context between the list and the confirmation step and must trust that the button they tapped a moment ago corresponds to the ID now shown. This is functionally a confirmation gate (WR‑04 doesn't dispute that Ναι/Όχι correctly gate `handleClassCancelExecute`), but it's a weak one from a UX-safety perspective — an admin who taps the wrong row in the class list has no way to notice the mistake at the confirmation step, since the message never re-displays the actual date/time being cancelled.
**Fix:** Look up the session instance (e.g., via `listSessions` or a new `findSessionInstanceById`) inside `showCancelClassConfirm` and interpolate the date/time into the prompt:
```ts
`Να ακυρωθεί το μάθημα ${session.sessionDate} ${session.sessionTime};`
```

### WR-05: Renewal nudge send to the client is unguarded and has no duplicate-tap protection

**File:** `src/telegram/handlers/admin-menu.ts:462-476`
**Issue:** Every other client-facing, best-effort Telegram send in the reviewed/adjacent code (`handleClientCancelCallback`'s owner notification, slotless approve/reject client notifications in `telegram.ts`) is wrapped in `try { ... } catch (err) { logger.error(...) }` so a delivery failure (client blocked the bot, deleted their account, etc.) doesn't abort the surrounding flow. `handleRenewalNudge`'s actual client send is not:
```ts
await botTokenStore.run(business.botToken, async () => {
  await sendTelegramMessage(rel.senderPhone, 'Υπενθύμιση: ...');
});
await sendTelegramMessage(chatId, `Υπενθύμιση στάλθηκε στον ${rel.clientName ?? rel.senderPhone}.`);
```
If the client send throws, the function exits without ever telling the admin whether the nudge succeeded or failed — the exception is only caught (and merely logged) far upstream in `handleTelegramWebhookPost`. Separately, there is no idempotency/dedup key on this send (unlike, e.g., `escl:approve:...` or membership creation elsewhere), so a double-tap on "Αποστολή υπενθύμισης" (e.g. due to Telegram round-trip latency) sends the client two identical reminder messages.
**Fix:** Wrap the client send in try/catch and report failure to the admin explicitly:
```ts
try {
  await botTokenStore.run(business.botToken, async () => {
    await sendTelegramMessage(rel.senderPhone, 'Υπενθύμιση: ...');
  });
  await sendTelegramMessage(chatId, `Υπενθύμιση στάλθηκε στον ${rel.clientName ?? rel.senderPhone}.`);
} catch (err) {
  logger.error({ err, relId }, 'Renewal nudge send failed');
  await sendTelegramMessage(chatId, 'Η υπενθύμιση δεν στάλθηκε (σφάλμα αποστολής).');
}
```

## Info

### IN-01: Test suite doesn't exercise the security-critical or newer code paths it documents

**File:** `tests/admin-menu.test.ts`
**Issue:** The file's own header claims coverage of the menu routing feature, but the actual test bodies only cover `parseCallbackData`'s regex arms, `showAdminRootMenu`'s keyboard shape, and one assertion that the `agenda` action doesn't call `claimAgendaSlot`. None of the following are tested even though they're the security-relevant parts called out in this phase's own inline comments: `handleSettingsToggle`'s DB writes, the cross-tenant `rel.businessId !== business.id` guard in `showClientBalance`/`handleRenewalNudge`, the Ναι/Όχι confirm-then-execute flow for class cancellation, or `handleCallbackQuery` itself (the dispatcher in `webhooks/telegram.ts` that contains CR-01).
**Fix:** Add tests that mock `findClientBusinessRelationshipById` to return a relationship for a *different* `businessId` and assert `showClientBalance`/`handleRenewalNudge` refuse it; add a test exercising `handleCallbackQuery`'s menu branch with a mismatched `business`/`ownerBusiness` to catch regressions like CR-01.

### IN-02: `handleSettingsToggle` duplicates the same three-line pattern eight times

**File:** `src/telegram/handlers/admin-menu.ts:151-203`
**Issue:** Each of the 8 `case` blocks repeats `db.update(businesses).set({...}).where(eq(businesses.id, business.id))` plus a hardcoded confirmation string, differing only in the field name/value/message. All eight are currently correctly paired, but the duplication makes it easy to introduce a copy-paste mismatch (wrong field toggled, or wrong confirmation text) when a ninth setting is added later.
**Fix:** Extract a small lookup table keyed by `action` → `{ field, value, message }` and drive the update generically, e.g.:
```ts
const TOGGLES: Record<string, { field: keyof typeof businesses.$inferInsert; value: boolean; message: string }> = { ... };
```

### IN-03: Test name overstates what it asserts

**File:** `tests/admin-menu.test.ts:150-156`
**Issue:** The test `'agenda action calls listBookingsForDate but NOT claimAgendaSlot'` only asserts `claimAgendaSlot` was *not* called; there is no `expect(queries.listBookingsForDate).toHaveBeenCalled()`, so the first half of the test's name is unverified. Similarly, the `'findBusinessByOwnerTelegramId returning null prevents menu dispatch'` test (lines 188-201) never actually invokes the dispatcher — it only re-checks the parsed discriminant and states in a comment that the null-guard "is tested here," which it isn't.
**Fix:** Either rename the tests to match what they check, or add the missing assertions (`expect(listBookingsForDate).toHaveBeenCalledWith(business.id, ...)`; a real call into `handleCallbackQuery` with a null-returning mock).

---

_Reviewed: 2026-07-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
