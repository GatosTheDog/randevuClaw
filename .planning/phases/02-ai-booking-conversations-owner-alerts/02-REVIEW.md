---
phase: 02-ai-booking-conversations-owner-alerts
reviewed: 2026-07-08T00:00:00Z
depth: standard
files_reviewed: 31
files_reviewed_list:
  - migrations/0001_chief_karen_page.sql
  - migrations/meta/0001_snapshot.json
  - src/business/availability.ts
  - src/config.ts
  - src/conversation/ai-agent.ts
  - src/conversation/expiry-poller.ts
  - src/conversation/function-executor.ts
  - src/conversation/greek-preprocessor.ts
  - src/conversation/router.ts
  - src/database/queries.ts
  - src/database/schema.ts
  - src/database/seed.ts
  - src/server.ts
  - src/telegram/client.ts
  - src/utils/logger.ts
  - src/utils/timezone.ts
  - src/webhooks/telegram.ts
  - tests/ai-agent.test.ts
  - tests/availability.test.ts
  - tests/booking-queries.test.ts
  - tests/config.test.ts
  - tests/consent.test.ts
  - tests/conversation-router.test.ts
  - tests/expiry-poller.test.ts
  - tests/fixtures.test.ts
  - tests/function-executor.test.ts
  - tests/greek-preprocessor.test.ts
  - tests/idempotency.test.ts
  - tests/jest.setup.ts
  - tests/telegram-client.test.ts
  - tests/telegram-webhook.test.ts
  - tests/timezone.test.ts
  - tests/webhook.test.ts
findings:
  critical: 6
  warning: 6
  info: 2
  total: 14
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-07-08T00:00:00Z
**Depth:** standard
**Files Reviewed:** 31
**Status:** issues_found

## Summary

Reviewed the Phase 2 AI booking conversation flow: the Gemini-driven agent loop (`ai-agent.ts`), tool dispatch/mutation layer (`function-executor.ts`), Greek temporal preprocessing, availability calculation, the Telegram channel adapter/webhook (including owner-approval callback handling), the expiry-sweep poller, and their supporting queries/schema/tests.

The overall architecture is careful about several known hard problems (idempotent slot booking via partial unique indexes, cross-tenant isolation, owner-approval race guards, DST-safe date math) and each has decent targeted test coverage. However, several concrete correctness bugs survived that targeted coverage — most of them in interaction paths the existing tests don't exercise (multi-tool-call turns, notification failures after a DB mutation already landed, 24-hour time phrasing, and partial-batch failure during the expiry sweep). Six of the findings below are classified Critical because they produce demonstrably wrong data or silently drop information the user/owner needs (a false "cancelled" no-op that the client is told is an error while it actually succeeded; a second booking silently reported under the first booking's ID; permanently un-notified expired bookings after one Telegram send fails mid-batch; invalid calendar times like "26:00" from ordinary Greek phrasing; an unbounded Gemini tool-call loop; and a `''`-vs-`null` interactionId bug that can break the next turn after a rate-limit fallback).

## Critical Issues

### CR-01: Unbounded Gemini tool-call loop can hang a webhook request forever

**File:** `src/conversation/ai-agent.ts:227-288`
**Issue:** `aiBookingAgent`'s `while (true)` loop has no maximum round count. As long as each Gemini response contains at least one `function_call` step, the loop keeps invoking `callGeminiWithRetry` again with the tool results. If the model gets stuck calling tools repeatedly (e.g. repeatedly re-checking availability, or a subtly malformed tool schema causing Gemini to loop), the loop never returns. Since `routeConversationMessage` → `handleFoundBusiness` in `src/webhooks/telegram.ts:53-67` `await`s this call directly inside the HTTP handler (before `res.status(200).send('OK')` at line 221), a stuck loop hangs the whole webhook request. Worse, `insertOrIgnoreTelegramUpdate` already recorded this `update_id` as `'inserted'` before this call started, so if Telegram times out and redelivers the same update, the dedup check at line 193 silently discards the retry — the user's message is never answered, with no logged error and no visible symptom other than "the bot went silent."
**Fix:**
```ts
const MAX_TOOL_ROUNDS = 6; // generous upper bound for a single conversation turn
let round = 0;
while (true) {
  if (++round > MAX_TOOL_ROUNDS) {
    logger.error({ requestId }, 'aiBookingAgent exceeded max tool-call rounds, aborting turn');
    return {
      text: 'Συγγνώμη, κάτι πήγε στραβά. Δοκιμάστε ξανά.',
      interactionId: currentInteractionId ?? previousInteractionId ?? '',
      requestId,
      toolCalls: accumulatedToolCalls,
    };
  }
  // ... existing body
}
```

### CR-02: `requestId` shared across all tool calls in one turn causes a second distinct booking to be silently misreported as the first

**File:** `src/conversation/function-executor.ts:124-165, 196-232`; `src/conversation/ai-agent.ts:218, 277`
**Issue:** `requestId` is generated once per `aiBookingAgent` invocation (`ai-agent.ts:218`, `randomUUID()`) and passed unchanged to every `executeTool` call within that turn, including across multiple sequential `function_call` rounds (`ai-agent.ts:277`). `insertBooking`'s idempotency guard (`unique_request_per_client` on `(clientPhone, requestId)`) is keyed on that same requestId. If Gemini calls `book_appointment` (or `reschedule_appointment`) twice within one turn for two genuinely different slots (e.g. a user asking for two different appointments in one message, or a reschedule followed by a fresh booking), the *second* `insertBooking` call always collides on `unique_request_per_client` regardless of date/time — it has nothing to do with the target slot being taken. `resolveConflictOrTaken` (function-executor.ts:128-137) then looks up `findBookingByRequestId(clientPhone, requestId)`, finds the *first* booking (for a different date/time/service), and returns `{ success: true, booking_id: existing.id, status: existing.bookingStatus }` — telling Gemini (and, downstream, the client) that the second booking succeeded, when in fact only the first booking exists. The client is left believing they have two appointments when they only have one, silently.
**Fix:** Generate a fresh idempotency key per tool call to a mutating booking action, not once per turn — e.g. derive it from `` `${requestId}:${call.id}` `` (Gemini's own per-call id, which is unique within the turn) and pass that instead of the raw turn-level `requestId` into `bookAppointmentTool`/`rescheduleAppointmentTool`'s `insertBooking`/`findBookingByRequestId` calls, while still using the turn-level `requestId` for read-only/idempotent-retry semantics tied to genuinely identical LLM retries of the *same* call.

### CR-03: Cancel/reschedule report a false "error" to the client after the mutation already succeeded

**File:** `src/conversation/function-executor.ts:167-232` (see also the shared outer catch at `54-82`)
**Issue:** In both `cancelAppointmentTool` and `rescheduleAppointmentTool`, the booking-status DB mutation (`updateBookingStatus(booking.id, 'cancelled')` at line 182, or the new `insertBooking` at line 215) happens *before* the Telegram notification sends (owner FYI + client confirmation at lines 187-191, or the owner-alert keyboard at line 227). Neither of those notification calls is wrapped in its own try/catch — if either throws (e.g. transient Telegram API failure, matching the failure mode `alertOwnerNewBooking` at lines 100-122 is already prone to), the exception propagates to `executeTool`'s single outer `catch` (lines 79-81), which returns `{ error: (error as Error).message || 'internal_error' }` to Gemini. At that point the cancellation (or the new pending booking, for reschedule) has *already committed* to the database. The AI/user is told the action failed, when it actually succeeded — for cancellation there is no automatic retry/expiry path to reconcile this (unlike pending bookings, which self-heal via the 2-hour expiry sweep), so the client may be told "something went wrong, try again" while their appointment is permanently cancelled underneath them.
**Fix:** Isolate notification failures from the tool's return value — wrap each Telegram send in its own try/catch, log on failure, and always report the outcome based on whether the state mutation itself succeeded:
```ts
await updateBookingStatus(booking.id, 'cancelled');
try {
  if (context.business.ownerTelegramId) { await sendTelegramMessage(context.business.ownerTelegramId, ownerText); }
  await sendTelegramMessage(booking.clientPhone, 'Το ραντεβού σας ακυρώθηκε.');
} catch (err) {
  logger.error({ err, bookingId: booking.id }, 'Cancellation succeeded but notification failed');
}
return { success: true, booking_id: booking.id };
```

### CR-04: One failed Telegram send mid-sweep permanently drops notification + button-clearing for every remaining booking in that batch

**File:** `src/conversation/expiry-poller.ts:24-55`; `src/database/queries.ts:329-347`
**Issue:** `expireStalePendingBookings` (queries.ts:329-347) is a single atomic `UPDATE ... RETURNING` that flips *every* stale booking for a business to `'expired'` in one statement. `runExpirySweep` (expiry-poller.ts:28-48) then iterates the returned array and, for each booking, `await`s `sendTelegramMessage(booking.clientPhone, ...)` with **no per-booking try/catch**. If the Telegram send for the *first* booking in that array throws (network blip, rate limit, blocked chat, etc.), the `for` loop aborts immediately; the per-business `try/catch` around the whole sweep (lines 29-51) logs the error and moves to the next business — but every *other* booking already returned by that same `expireStalePendingBookings` call is now permanently stuck: their `bookingStatus` is already `'expired'` in the DB, so the next sweep's `WHERE bookingStatus = 'pending_owner_approval'` filter will never select them again. Those clients are never notified their booking was auto-cancelled, and their owner-alert message's inline keyboard is never cleared (a stale "Αποδοχή/Απόρριψη" button remains tappable — harmless since `handleCallbackQuery`'s status re-check will no-op it, but confusing for the owner).
**Fix:** Isolate each booking's notification inside its own try/catch so one failure doesn't skip the rest of the batch:
```ts
for (const booking of expired) {
  try {
    await sendTelegramMessage(booking.clientPhone, EXPIRY_NOTICE_GREEK);
    notifiedCount += 1;
    if (booking.ownerTelegramMessageId) {
      const business = await findBusinessById(businessId);
      if (business?.ownerTelegramId) {
        await editTelegramMessageReplyMarkup(business.ownerTelegramId, booking.ownerTelegramMessageId, []);
      }
    }
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'Failed to notify client of expired booking');
  }
}
```

### CR-05: Greek temporal preprocessor produces invalid clock times (e.g. "26:00") for ordinary 24-hour phrasing without an am/pm marker

**File:** `src/conversation/greek-preprocessor.ts:76-103`
**Issue:** `resolveHourToTime`'s "bare-hour heuristic" (lines 98-102, reached whenever no `π.μ./μ.μ.` marker and no context word like `πρωί/απόγευμα/μεσημέρι/βράδυ` is present) assumes any bare number is a 12-hour-clock value in `1..12` and always adds 12 unless the hour is already in `8..11` or exactly `12`. It never checks whether the parsed hour is already `>= 13` (i.e. already unambiguously 24-hour). For a phrase like `"στις 14"` or `"Παρασκευή στις 20"` — completely ordinary, common Greek 24-hour phrasing with no am/pm marker and no time-of-day word — `resolveHourToTime(14, '00', undefined, text)` returns `formatHour(14 + 12, '00')` = `"26:00"`, and for `"στις 20"` it returns `"32:00"`. These invalid times are embedded directly into the `annotatedText` system hint sent to Gemini (e.g. `[ΣΥΣΤΗΜΑ: ... πιθανή ώρα=26:00]`), which the system prompt instructs the model to trust for grounding — a very plausible path for a bogus `calendar_time` to reach `book_appointment`. None of the 20 corpus tests in `tests/greek-preprocessor.test.ts` exercise an hour `>= 13` without a marker, so this is untested.
**Fix:** Add an explicit 24-hour guard before the 12-hour heuristic:
```ts
// Already unambiguous 24-hour input (13-23) — never add 12 again.
if (hour >= 13 && hour <= 23) return formatHour(hour, minutes);
if (hour === 12) return formatHour(12, minutes);
if (hour >= 8 && hour <= 11) return formatHour(hour, minutes);
return formatHour(hour + 12, minutes);
```

### CR-06: Rate-limit fallback stores `''` instead of `null` for `interactionId`, which then propagates as a malformed `previous_interaction_id` on the next turn

**File:** `src/conversation/ai-agent.ts:243-250`; `src/conversation/router.ts:22,29`
**Issue:** When `callGeminiWithRetry` exhausts retries on 429s, `aiBookingAgent` returns `interactionId: previousInteractionId ?? ''` (line 246) — using the empty string as a stand-in for "no interaction happened," even though the type is `string` (not nullable) and the codebase's own convention (documented on `conversationTurns.interactionId` in `schema.ts:139`, "null if turn errored before Gemini responded") is to represent this with `null`. `routeConversationMessage` persists this value verbatim via `insertConversationTurn` (router.ts:38), and on the client's *next* message, `findLatestConversationTurn` reads it back and does `previousTurn?.interactionId ?? null` (router.ts:29) — but `??` only substitutes for `null`/`undefined`, not `''`, so the empty string survives and is forwarded to `aiBookingAgent` as `previousInteractionId = ''`. Inside `aiBookingAgent`, `currentInteractionId: string | undefined = previousInteractionId ?? undefined` (line 225) again keeps `''` (not nullish), and it is sent to the Gemini API as `previous_interaction_id: ''`. This is very likely to be rejected or mishandled by Gemini's API on the *next* real turn for that client — right after the exact scenario (a 429 burst) that the project's own free-tier constraints (15 RPM / 1,000 RPD per CLAUDE.md) make routine.
**Fix:** Use `null` consistently, and type `AiAgentResult.interactionId` as `string | null`:
```ts
// ai-agent.ts
return {
  text: RATE_LIMIT_REPLY_GREEK,
  interactionId: previousInteractionId ?? null,
  requestId,
  toolCalls: accumulatedToolCalls,
};
```
```ts
// router.ts — no longer needs the `?? null` workaround once the type is honest
interactionId: result.interactionId,
```

## Warnings

### WR-01: `checkAvailability` truncates the opening-hour minute component, offering slots before a non-round opening time

**File:** `src/business/availability.ts:54-65`
**Issue:** `const openHour = Number(hours.openTime.split(':')[0])` discards the minutes portion of `openTime`. The candidate-generation loop then starts at `openHour` regardless of the actual minute offset. `businessHours.openTime` is an unconstrained `"HH:MM"` text column (`schema.ts:82`) — nothing prevents a business from configuring e.g. `"08:30"`. For such a business, the loop would still generate an `"08:00"` candidate slot a full 30 minutes before the business actually opens, and (assuming no conflicting booking) offer and allow booking it. The seeded fixtures only use round hours, so this is untested and unnoticed today, but it is a real correctness gap given the schema allows arbitrary minute values.
**Fix:** Round the opening boundary *up* to the next full hour when there's a nonzero minute remainder (consistent with the "1-hour granularity" design in the surrounding comment), e.g. `const openHour = Math.ceil(timeStringToMinutes(hours.openTime) / 60);`.

### WR-02: `calendar_date`/`calendar_time` tool args have no format validation, and a resulting DB error is passed straight back to the model

**File:** `src/conversation/function-executor.ts:28-52, 79-81`
**Issue:** `CheckAvailabilityArgsSchema`/`BookAppointmentArgsSchema`/`RescheduleAppointmentArgsSchema` validate `business_id`/`service_id`/`booking_id` as integers but accept `calendar_date`/`calendar_time` as bare `z.string()` with no shape check. If the model (or a prompt-injection attempt) supplies a non-`YYYY-MM-DD` value, `weekdayOfIsoDate` (`src/utils/timezone.ts:21-23`) constructs `new Date(`${isoDate}T12:00:00Z`)`, which is `Invalid Date`, and `.getUTCDay()` returns `NaN`. That `NaN` is then used as a query parameter in `findBusinessHoursForDay` (`queries.ts:200-212`), which will very likely throw a raw Postgres error ("invalid input syntax for type integer"). That exception is caught only by `executeTool`'s generic outer `catch` (lines 79-81), which returns `{ error: (error as Error).message || 'internal_error' }` — surfacing a raw database error string directly into the tool-result JSON fed back into the Gemini conversation (and potentially echoed to the end user).
**Fix:** Add a regex refinement to the date/time schema fields, e.g. `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` and `z.string().regex(/^\d{2}:\d{2}$/)`, so malformed input fails validation with a clean, generic `{ error: 'invalid_arguments' }` instead of reaching the database layer at all.

### WR-03: Owner-alert send/store failures surface as a generic tool error even though the booking was already created

**File:** `src/conversation/function-executor.ts:100-122, 159-164, 226-229`
**Issue:** `alertOwnerNewBooking` is called *after* `insertBooking` has already committed the new row (lines 159-160, 226-227), and it is not wrapped in a try/catch by its caller. If `sendTelegramMessageWithKeyboard` or the subsequent `updateBookingOwnerMessageId` throws, the exception propagates out of `bookAppointmentTool`/`rescheduleAppointmentTool` to `executeTool`'s outer catch, which returns a generic `{ error: ... }` even though the booking row now exists and occupies the slot. The client is told the booking failed; the owner was never notified; and the slot is silently held (self-healing only after the 2-hour expiry sweep). Since the client believes nothing was booked, they may try again — and get `slot_taken` for their own already-created booking, which is confusing and looks like a bug from their side.
**Fix:** Wrap the alert step separately and always return success once the DB insert has landed:
```ts
if (booking) {
  try {
    await alertOwnerNewBooking(booking, service, context.business);
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'Booking created but owner alert failed');
  }
  return { success: true, booking_id: booking.id, status: booking.bookingStatus };
}
```

### WR-04: Telegram webhook secret is compared with a non-constant-time `===`

**File:** `src/webhooks/telegram.ts:46-51`
**Issue:** `verifyTelegramSecretToken` compares the incoming `X-Telegram-Bot-Api-Secret-Token` header against `config.telegramWebhookSecret` with plain `===`. The comment argues this is fine because "there is no signature is being derived from a body + key," but that reasoning conflates HMAC-timing-attacks specifically with the general timing side-channel of comparing *any* secret value against attacker-controlled input character-by-character — the latter applies here regardless of whether a signature is involved. Network jitter makes this hard to exploit in practice, but it's a straightforward defense-in-depth fix.
**Fix:** Use `crypto.timingSafeEqual` with an explicit length guard (since it throws on mismatched buffer lengths):
```ts
import { timingSafeEqual } from 'node:crypto';

export function verifyTelegramSecretToken(headerValue: string | undefined, expectedToken: string): boolean {
  if (headerValue === undefined) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expectedToken);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

### WR-05: No atomic compare-and-swap on booking status transition in the owner-approval callback — concurrent duplicate taps can double-notify the client

**File:** `src/webhooks/telegram.ts:96-166`
**Issue:** `handleCallbackQuery` reads the booking (`findBookingByIdUnscoped`, line 114), checks `booking.bookingStatus !== 'pending_owner_approval'` (line 137) in application code, and only then calls `updateBookingStatus` (lines 146/159) — a classic read-then-write race. Two near-simultaneous taps on the same inline button (Telegram sometimes redelivers callback queries, or a fast double-tap before the keyboard visibly updates) produce two separate webhook invocations, each with a distinct `update_id`, so the dedup check at line 186 does not prevent this. Both can read `bookingStatus === 'pending_owner_approval'` before either write lands, and both then proceed to call `sendTelegramMessage` to the client — resulting in a duplicate "confirmed"/"rejected" message and (for a reschedule) a duplicate cascade cancellation call.
**Fix:** Make the transition itself the guard, e.g. add a conditional update helper (`UPDATE bookings SET booking_status = $1 WHERE id = $2 AND booking_status = 'pending_owner_approval' RETURNING id`) and only proceed with notifications/cascade if a row was actually updated.

### WR-06: Hardcoded, unverified Gemini model id with no implemented fallback despite a comment promising one

**File:** `src/conversation/ai-agent.ts:9-12`
**Issue:** `GEMINI_MODEL` is hardcoded to `'gemini-3.5-flash'`, a model name not listed anywhere in this project's own documented stack (`CLAUDE.md` specifies Gemini 2.5 Flash-Lite as the free-tier model for this PoC, and notes Pro was cut from the free tier). The comment says to "fall back to `gemini-2.5-flash-lite` if `gemini-3.5-flash` is unavailable in-region" but no such runtime fallback exists anywhere in `callGeminiWithRetry` or `aiBookingAgent` — `is429` only distinguishes rate-limit errors, so a "model not found"/unsupported-model error from Gemini would throw all the way up, breaking every conversation turn for every business until a human notices and hardcodes a different model string.
**Fix:** Either confirm `gemini-3.5-flash` is genuinely available for this API key/tier and drop the misleading comment, or implement the described fallback (e.g. catch a model-not-found error class distinctly from 429 and retry once against `'gemini-2.5-flash-lite'`).

## Info

### IN-01: Services/business-hours seed inserts lack `onConflictDoNothing`, unlike the businesses insert

**File:** `src/database/seed.ts:174-182`
**Issue:** `seed()`'s businesses insert (line 110) is a plain insert relying on the earlier existing-slug check, but the batched `services`/`businessHours` inserts (lines 174-182) have no `onConflictDoNothing()` guard either, despite both tables having unique constraints (`unique_business_service`, `unique_business_day`). The docstring claims seed() is "safe to re-run," which holds for sequential re-runs (the existing-rows check prevents re-insertion), but a concurrent double-invocation (e.g. two deploy hooks firing at once) would raise an uncaught unique-violation from this insert.
**Fix:** Add `.onConflictDoNothing()` to both batched inserts for defense-in-depth, matching the pattern already used for the businesses/messages/telegramUpdates inserts elsewhere in this codebase.

### IN-02: Unsupported Telegram update types are mislabeled as `'callback_query'` in the audit table

**File:** `src/webhooks/telegram.ts:186-191`
**Issue:** `insertOrIgnoreTelegramUpdate(updateId, null, senderTelegramId, update.message ? 'message' : 'callback_query')` labels every update that isn't a `message` as `'callback_query'`, even if it's actually neither (e.g. `channel_post`, `edited_message`, or any other Telegram update type not modeled by the `TelegramUpdate` interface here). This doesn't cause incorrect behavior (such updates are silently ignored downstream either way) but pollutes the `telegram_updates.update_type` audit column with a false label.
**Fix:** `update.message ? 'message' : update.callback_query ? 'callback_query' : 'other'` (widening the column's documented `'message' | 'callback_query'` comment accordingly), or skip the dedup insert entirely for unrecognized update shapes.

---

_Reviewed: 2026-07-08T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
