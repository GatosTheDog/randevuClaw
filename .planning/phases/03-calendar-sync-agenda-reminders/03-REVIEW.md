---
phase: 03-calendar-sync-agenda-reminders
reviewed: 2026-07-09T00:00:00Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - migrations/0002_silent_ben_urich.sql
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
  - tests/calendar-agenda-reminder-queries.test.ts
  - tests/calendar-poller.test.ts
  - tests/calendar-sync.test.ts
  - tests/config.test.ts
  - tests/function-executor.test.ts
  - tests/google-oauth.test.ts
  - tests/jest.setup.ts
  - tests/scheduler-agenda.test.ts
  - tests/scheduler-reminders.test.ts
  - tests/setup-google-calendar.test.ts
  - tests/telegram-webhook.test.ts
findings:
  critical: 2
  warning: 3
  info: 0
  total: 5
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-07-09T00:00:00Z
**Depth:** standard
**Files Reviewed:** 25
**Status:** issues_found

## Summary

Phase 03 introduces Google Calendar sync, a daily agenda poller, 24h/1h appointment reminders, and the associated OAuth setup script. The implementation is structurally sound: atomic DB claims for idempotency, per-business/per-booking try/catch isolation, and best-effort semantics for Calendar API calls are all correctly implemented. Two critical defects were found — one produces a factually wrong user-facing message, the other can silently terminate the OAuth setup script before any token is exchanged. Three warnings cover a security defense gap, a missing logger redaction path, and a reliability risk in the agenda poller.

## Critical Issues

### CR-01: 24h reminder message says "αύριο" (tomorrow) for same-day appointments

**File:** `src/scheduler/reminders.ts:145`

**Issue:** The `runReminderSweep` calls `findBookingsNeedingReminder(businessId, [todayIso, tomorrowIso])`, which returns bookings for both today and tomorrow. The 24h reminder fires whenever `minutesUntil <= 24 * 60` — a condition that is satisfied for any same-day appointment that is more than 0 minutes away (e.g., a 22:00 appointment when the sweep runs at 07:00 is 900 minutes away, which is under 1440). When `booking.calendarDate === todayIso`, the reminder text `Υπενθύμιση: έχετε ραντεβού αύριο στις ${booking.calendarTime}` is sent, but "αύριο" (tomorrow) is factually wrong — the appointment is today.

Concrete scenario that triggers the bug:
- Booking: `calendarDate = '2026-07-09'`, `calendarTime = '22:00'`, created on `2026-07-08` (D-14 passes with 24h margin)
- Sweep runs at `2026-07-09 07:00` Athens — `minutesUntil = 900 <= 1440`
- Message sent: "Υπενθύμιση: έχετε ραντεβού **αύριο** στις 22:00."
- Actual appointment: **today** (2026-07-09) at 22:00.

No existing test covers this case; the test suite only exercises the tomorrow scenario.

**Fix:** Compare `booking.calendarDate` to `todayIso` before choosing the day label:

```typescript
const dayLabel = booking.calendarDate === todayIso
  ? 'σήμερα'
  : 'αύριο';
await sendTelegramMessage(
  booking.clientPhone,
  `Υπενθύμιση: έχετε ραντεβού ${dayLabel} στις ${booking.calendarTime}.`
);
```

---

### CR-02: OAuth setup script terminates on any unexpected HTTP request (favicon.ico kills the flow)

**File:** `scripts/setup-google-calendar.ts:52-58`

**Issue:** The local HTTP server started by `setup-google-calendar.ts` processes every incoming request without checking the URL path. When a browser opens the Google OAuth consent URL it often immediately fires additional requests to the callback server (e.g., `GET /favicon.ico`, prefetch requests). For these requests `searchParams.get('state')` returns `null`, so `receivedState !== state` is true, triggering the CSRF rejection path which calls `server.close()` and `process.exit(1)`. The OAuth flow never completes — the browser is displaying Google's consent screen while the local callback server has already been killed.

```typescript
// Current: processes EVERY request immediately
const requestUrl = new URL(req.url ?? '', `http://localhost:${port}`);
const receivedState = requestUrl.searchParams.get('state');
if (receivedState !== state) {
  // ...
  server.close();
  process.exit(1);  // ← kills the server before the real callback arrives
}
```

**Fix:** Check the URL path before applying the state validation. Silently ignore requests to any path other than the expected callback path:

```typescript
const requestUrl = new URL(req.url ?? '', `http://localhost:${port}`);
const callbackPath = new URL(config.googleRedirectUri).pathname;

// Silently ignore browser-initiated side requests (favicon, prefetch, etc.)
if (requestUrl.pathname !== callbackPath) {
  res.writeHead(204);
  res.end();
  return;
}

const receivedState = requestUrl.searchParams.get('state');
// ... rest of the existing logic
```

---

## Warnings

### WR-01: OAuth callback server binds to all interfaces instead of loopback only

**File:** `scripts/setup-google-calendar.ts:86`

**Issue:** `server.listen(port, callback)` with no host argument binds to `0.0.0.0` / `::` (all network interfaces). During the brief window the server is waiting for the OAuth callback, any machine on the same LAN can reach the endpoint. A CSRF attacker on the same network who can also observe the authorization URL (e.g., in a shared workspace) could replay a differently-initiated OAuth flow. The per-run `crypto.randomBytes(16)` state mitigates the worst case, but binding to all interfaces is unnecessary for a localhost redirect URI.

**Fix:**

```typescript
server.listen(port, '127.0.0.1', () => {
  console.log(`Waiting for the OAuth callback on port ${port}...`);
});
```

---

### WR-02: `googleRefreshToken` is absent from the logger's redact list

**File:** `src/utils/logger.ts:8-18`

**Issue:** The pino redact configuration covers `appSecret`, `databaseUrl`, `whatsappAccessToken`, `geminiApiKey`, `telegramBotToken`, `telegramWebhookSecret`, and `googleClientSecret` — but not `googleRefreshToken`. The `Business` interface (`src/database/queries.ts`) carries this field. A future `logger.info(business)` call (or any log that spreads the business object) would emit the refresh token in plain text to fly.io's log aggregator.

Currently no code path logs a full `Business` object — callers log specific scalar fields. However the defensive redact list is the only thing standing between a careless future log call and a credential leak.

**Fix:** Add refresh token paths to the redact list:

```typescript
redact: {
  paths: [
    // ... existing paths ...
    'googleRefreshToken',
    '*.googleRefreshToken',
    'config.googleRefreshToken',
  ],
  censor: '[REDACTED]',
},
```

---

### WR-03: Agenda slot is consumed before Telegram delivery — a send failure silently drops today's agenda

**File:** `src/scheduler/agenda.ts:45-57`

**Issue:** `claimAgendaSlot` is called and `agendaSentDate` is advanced to `todayIso` before `sendTelegramMessage` is called. If the Telegram send fails (network error, Telegram outage), the catch block at line 60 swallows the error and the sweep moves on. Because `agendaSentDate` was already set to today, no subsequent sweep will retry — the owner's daily agenda is permanently lost for that day.

The comment explains this is an intentional trade-off to prevent duplicate sends. However unlike the reminder slot claims (which use atomic `claimReminder24hSlot` for a durable per-booking guard), the agenda claim is irreversible once taken. A send failure leaves the owner with no agenda and no mechanism to trigger a retry.

**Fix (minimal):** Move `sentCount += 1` and the `logger.info` call inside a try/catch that does NOT catch the send failure silently — or log it as an explicit error distinguishing "send failed after claim" from generic sweep errors, so operators can detect and manually re-trigger:

```typescript
const claimed = await claimAgendaSlot(businessId, todayIso);
if (!claimed) continue;

// ... build message ...

try {
  await sendTelegramMessage(business.ownerTelegramId, message);
  sentCount += 1;
  logger.info({ businessId, date: todayIso, count: bookings.length }, 'Agenda sent');
} catch (err) {
  // Claim was already consumed — no automatic retry today.
  logger.error(
    { err, businessId, date: todayIso },
    'Agenda send failed AFTER slot claimed — owner missed today\'s agenda, no automatic retry'
  );
}
```

---

_Reviewed: 2026-07-09T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
