---
phase: 03-calendar-sync-agenda-reminders
reviewed: 2026-07-09T13:36:49Z
depth: standard
files_reviewed: 36
files_reviewed_list:
  - migrations/0002_silent_ben_urich.sql
  - migrations/meta/0002_snapshot.json
  - migrations/meta/_journal.json
  - package.json
  - scripts/setup-google-calendar.ts
  - src/calendar/poller.ts
  - src/calendar/sync.ts
  - src/config.ts
  - src/conversation/function-executor.ts
  - src/database/queries.ts
  - src/database/schema.ts
  - src/google/oauth.ts
  - src/scheduler/agenda.ts
  - src/scheduler/reminders.ts
  - src/server.ts
  - src/utils/logger.ts
  - src/webhooks/telegram.ts
  - tests/ai-agent.test.ts
  - tests/calendar-agenda-reminder-queries.test.ts
  - tests/calendar-poller.test.ts
  - tests/calendar-sync.test.ts
  - tests/config.test.ts
  - tests/consent.test.ts
  - tests/conversation-router.test.ts
  - tests/expiry-poller.test.ts
  - tests/function-executor.test.ts
  - tests/google-oauth.test.ts
  - tests/idempotency.test.ts
  - tests/jest.setup.ts
  - tests/scheduler-agenda.test.ts
  - tests/scheduler-reminders.test.ts
  - tests/setup-google-calendar.test.ts
  - tests/telegram-webhook.test.ts
  - tests/webhook.test.ts
findings:
  critical: 1
  warning: 3
  info: 1
  total: 5
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-07-09T13:36:49Z
**Depth:** standard
**Files Reviewed:** 36
**Status:** issues_found

## Summary

Reviewed all Phase 3 source files covering Google Calendar sync, daily agenda dispatch, 24h/1h appointment reminders, and the OAuth setup script. The prior review's two critical issues (same-day "αύριο" label; OAuth server terminating on favicon) are confirmed fixed in the current code. Most of the architectural design is solid: atomic DB claims for idempotency, per-business/per-booking error isolation, and bounded retry logic all work correctly.

One new blocking correctness bug was found: cancelled bookings with no Google Calendar event ID enter an infinite processing loop in the calendar sync poller because `deleteBookingFromCalendar`'s null early-return path never marks the booking as synced. Three warnings carry over or are newly identified: the "never throws" contract is violated in the calendar sync error handlers, the OAuth setup server still binds to all network interfaces, and the agenda slot is silently consumed with no retry path when the Telegram send fails post-claim.

## Critical Issues

### CR-01: Calendar sync poller loops forever on cancelled bookings with no Google Calendar event

**File:** `src/calendar/sync.ts:99`

**Issue:** `deleteBookingFromCalendar` returns `true` immediately when `booking.googleCalendarEventId` is null (line 99), without calling `updateCalendarSyncStatus`. The `runCalendarSyncSweep` caller in `src/calendar/poller.ts` treats `success = true` by calling `continue` (lines 44-47) — also without marking `calendarSyncStatus = 'synced'`. The booking remains indefinitely with `(bookingStatus='cancelled', calendarSyncStatus='pending')`.

`findBookingsNeedingCalendarSync` queries `calendarSyncStatus = 'pending' AND bookingStatus IN ('confirmed', 'cancelled')`. Every subsequent poller sweep re-finds this booking, calls `deleteBookingFromCalendar` again (returns `true` again immediately), counts it as synced, and loops. No retry counter is ever incremented (that path requires `success = false`), so the booking is never promoted to `'failed'`. The loop is infinite.

This occurs in two production paths:
1. A client cancels via `cancelAppointmentTool` before the booking was ever confirmed and synced (i.e., `googleCalendarEventId` was never set, default `calendarSyncStatus = 'pending'`).
2. An owner approves a reschedule in `telegram.ts handleCallbackQuery`, which calls `updateBookingStatus(rescheduledFromBookingId, 'cancelled')` on the original booking — if the original was never synced, same loop applies.

The bug does not affect the Google Calendar API (the null check prevents any API call) and does not produce user-visible errors, but it burns Neon DB query resources on every poller sweep (every 5 minutes) for every such booking indefinitely.

No existing test in `tests/calendar-poller.test.ts` covers the cancelled-booking-with-null-event-id case. Test 2b only mocks `deleteBookingFromCalendar` returning `true` (exercising the success count path) without asserting that `calendarSyncStatus` gets updated.

**Fix:** In `src/calendar/sync.ts`, update the null early-return to mark the booking synced before returning:

```typescript
export async function deleteBookingFromCalendar(booking: Booking, business: Business): Promise<boolean> {
  if (!booking.googleCalendarEventId) {
    // No Calendar event was ever created for this booking — nothing to delete.
    // Mark synced so the poller does not re-process this row on every sweep.
    await updateCalendarSyncStatus(booking.id, 'synced');
    return true;
  }
  ...
}
```

This `updateCalendarSyncStatus` call should also be wrapped in its own try/catch if strict "never throws" semantics are maintained (see WR-01 below).

---

## Warnings

### WR-01: "NEVER throws" contract violated when the fallback `updateCalendarSyncStatus` call throws

**File:** `src/calendar/sync.ts:88-92` and `src/calendar/sync.ts:109-113`

**Issue:** Both `syncBookingToCalendar` and `deleteBookingFromCalendar` carry explicit "NEVER throws" contracts (comments at lines 51-54 and 95-97 respectively). Their `catch` blocks each call `await updateCalendarSyncStatus(booking.id, 'pending')` as a DB fallback. If that DB call itself throws (e.g. a transient Neon connection failure), the exception escapes the `catch` block and propagates to the caller. The per-booking `try/catch` in `poller.ts` (line 62-64) catches it there, so the sweep does not crash. But `telegram.ts handleCallbackQuery` (lines 180-183) wraps `syncBookingToCalendar` in its own try/catch citing the "best-effort / never throws" contract — that caller is relying on the stated contract. If it throws, the client confirmation message at line 185 is still sent (the outer booking-level try/catch is separate), so the user impact is minimal. Still, documented contracts should be honored.

**Fix:** Wrap the fallback DB calls in their own inner try/catch within the `catch` block:

```typescript
// In syncBookingToCalendar catch block:
} catch (err) {
  logger.error({ err, bookingId: booking.id, businessId: business.id }, 'Calendar sync failed (non-blocking)');
  try {
    await updateCalendarSyncStatus(booking.id, 'pending');
  } catch (dbErr) {
    logger.error({ dbErr, bookingId: booking.id }, 'Failed to reset calendarSyncStatus after sync failure');
  }
  return false;
}
```

Apply the same pattern in `deleteBookingFromCalendar`'s catch block (lines 109-113).

---

### WR-02: OAuth setup server binds to all network interfaces instead of loopback

**File:** `scripts/setup-google-calendar.ts:98`

**Issue:** `server.listen(port, callback)` with no host argument binds to `0.0.0.0` (all interfaces). During the window between opening the browser consent URL and receiving the OAuth callback, any machine on the same LAN can reach the endpoint. An adversary who can observe the printed auth URL and also reach the port could send a crafted request with a matching `state` parameter if they somehow obtain it. The per-run `crypto.randomBytes(16)` state provides strong protection, but binding to all interfaces is unnecessary for a localhost OAuth redirect URI.

**Fix:**

```typescript
server.listen(port, '127.0.0.1', () => {
  console.log(`Waiting for the OAuth callback on port ${port}...`);
});
```

---

### WR-03: Agenda slot consumed before Telegram delivery — a send failure silently drops the day's agenda

**File:** `src/scheduler/agenda.ts:77-93`

**Issue:** `claimAgendaSlot` is called at line 77 and advances `agendaSentDate` to `todayIso` before `sendTelegramMessage` is called at line 89. If the Telegram send fails (network error, Telegram downtime), the exception bubbles up to the per-business `catch (err)` at line 92, which logs only `'Agenda sweep failed for business'`. Because `agendaSentDate` is already set to today, no subsequent sweep will retry — the owner's daily agenda is permanently lost for that day without any error signal that specifically identifies "claim consumed, send failed, owner missed agenda."

The design comment in the code intentionally uses claim-before-send to prevent duplicate sends. The trade-off is accepted, but the observable signal on failure is inadequate: the generic error message makes it impossible for an operator to distinguish "sweep crashed before the claim" from "claim succeeded but Telegram send failed."

**Fix:** Isolate the send into its own try/catch with a distinct, actionable error message:

```typescript
const claimed = await claimAgendaSlot(businessId, todayIso);
if (!claimed) continue;

// ... build serviceNamesById and message ...

try {
  await sendTelegramMessage(business.ownerTelegramId, message);
  sentCount += 1;
  logger.info({ businessId, date: todayIso, count: bookings.length }, 'Agenda sent');
} catch (sendErr) {
  // Slot already consumed — no automatic retry today. Operator must re-trigger manually if needed.
  logger.error(
    { sendErr, businessId, date: todayIso },
    'Agenda slot claimed but Telegram send FAILED — owner missed today\'s agenda (no auto-retry)'
  );
}
```

---

## Info

### IN-01: OAuth CSRF state comparison uses plain `!==` rather than a timing-safe comparison

**File:** `scripts/setup-google-calendar.ts:64`

**Issue:** The 32-character hex CSRF state token is compared using `receivedState !== state` (plain string equality). String comparison in JavaScript is not constant-time and in theory allows timing-side-channel recovery of the expected state. In practice the attack surface is negligible — the HTTP server binds to localhost (currently `0.0.0.0`, see WR-02), the attacker needs LAN access plus sub-millisecond timing resolution, and the state is only valid for the duration of a single CLI invocation. Risk is near-zero for a developer CLI tool.

For consistency with `src/webhooks/whatsapp.ts` which uses `crypto.timingSafeEqual` for its HMAC comparison, the same approach could be applied here. Raised as info only; fixing WR-02 (loopback binding) eliminates the network exposure that makes the theoretical attack even conceivable.

---

_Reviewed: 2026-07-09T13:36:49Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
