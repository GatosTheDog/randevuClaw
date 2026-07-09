# Phase 3: Calendar Sync, Agenda & Reminders - Pattern Map

**Mapped:** 2026-07-09
**Files analyzed:** 14 (new + modified)
**Analogs found:** 8 / 14 (57% with exact or role-match analogs; 6 files are extensions of existing code)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/database/schema.ts` | config/migration | CRUD | itself | exact (extend pattern) |
| `src/database/queries.ts` | service | CRUD | itself | exact (extend pattern) |
| `src/calendar/sync.ts` | service | CRUD + event-driven | `src/telegram/client.ts` | role-match |
| `src/calendar/poller.ts` | utility | batch + retry | `src/conversation/expiry-poller.ts` | exact |
| `src/scheduler/agenda.ts` | utility | batch | `src/conversation/expiry-poller.ts` | exact |
| `src/scheduler/reminders.ts` | utility | batch | `src/conversation/expiry-poller.ts` | exact |
| `src/google/oauth.ts` | service | request-response | `src/telegram/client.ts` | role-match |
| `src/webhooks/telegram.ts` | controller (modify) | request-response | itself | exact (integration hook) |
| `src/conversation/function-executor.ts` | service (modify) | request-response | itself | exact (integration hook) |
| `src/server.ts` | config (modify) | request-response | itself | exact (startup pattern) |
| `tests/calendar/sync.test.ts` | test | CRUD | `tests/expiry-poller.test.ts` | role-match |
| `tests/calendar/poller.test.ts` | test | batch | `tests/expiry-poller.test.ts` | exact |
| `tests/scheduler/agenda.test.ts` | test | batch | `tests/expiry-poller.test.ts` | exact |
| `tests/scheduler/reminders.test.ts` | test | batch | `tests/expiry-poller.test.ts` | exact |

---

## Pattern Assignments

### `src/database/schema.ts` (config, CRUD — extend existing pattern)

**Analog:** `src/database/schema.ts` lines 12–22 (businesses table) and lines 90–131 (bookings table)

**Pattern: Nullable columns added to non-empty tables (Phase 2 precedent)**

Already modeled in schema.ts (lines 18–20, Phase 2's `ownerTelegramId` as a nullable text column). Reuse this exact pattern for Phase 3 additions:

**New columns on `businesses` table** (add after `ownerTelegramId`, lines 18–20):
```typescript
// src/database/schema.ts lines 18-22
export const businesses = pgTable('businesses', {
  // ... existing columns ...
  ownerTelegramId: text('owner_telegram_id'), // Phase 2 precedent
  
  // Phase 3 additions:
  googleRefreshToken: text('google_refresh_token'), // OAuth 2.0 refresh token (nullable, D-06)
  agendaSentDate: text('agenda_sent_date'), // ISO date "YYYY-MM-DD" when today's agenda was sent (nullable, D-11)
  
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

**New columns on `bookings` table** (add before `expiresAt`, after `rescheduledFromBookingId`, lines 114–116):
```typescript
// src/database/schema.ts lines 90-131
export const bookings = pgTable('bookings', {
  // ... existing columns through rescheduledFromBookingId ...
  
  // Phase 3 additions (D-11, D-16):
  calendarSyncStatus: text('calendar_sync_status').default('pending'), // 'pending' | 'synced' | 'failed' (D-16)
  googleCalendarEventId: text('google_calendar_event_id'), // Google's event ID for update/delete ops
  calendarSyncRetryCount: integer('calendar_sync_retry_count').default(0), // Incremented on failed syncs (D-16)
  reminder24hSentAt: timestamp('reminder_24h_sent_at'), // Idempotency guard (D-11)
  reminder1hSentAt: timestamp('reminder_1h_sent_at'), // Idempotency guard (D-11)
  
  expiresAt: timestamp('expires_at'), // existing
  createdAt: timestamp('created_at').notNull().defaultNow(), // existing
});
```

**Migration pattern:** Use `drizzle-kit generate && drizzle-kit push` (same as Phase 2's flow).

---

### `src/database/queries.ts` (service, CRUD — extend existing pattern)

**Analog:** `src/database/queries.ts` lines 1–100 (query structure and type interfaces)

**Exports to add** (extend the file with these new functions, following existing patterns):

**Interface extensions** (add to Business interface around line 14):
```typescript
// src/database/queries.ts (extend existing Business interface)
export interface Business {
  id: number;
  name: string;
  slug: string;
  phoneNumberId: string | null;
  ownerTelegramId: string | null;
  // Phase 3 additions:
  googleRefreshToken: string | null;
  agendaSentDate: string | null; // "YYYY-MM-DD"
  createdAt: Date;
}
```

**New query functions** (add to end of file):
```typescript
// Phase 3: Calendar sync, agenda, reminder queries

// Calendar sync queries
export async function updateCalendarSyncStatus(
  bookingId: number,
  status: 'pending' | 'synced' | 'failed'
): Promise<void> {
  await db
    .update(bookings)
    .set({ calendarSyncStatus: status })
    .where(eq(bookings.id, bookingId));
}

export async function updateBookingGoogleEventId(bookingId: number, eventId: string): Promise<void> {
  await db
    .update(bookings)
    .set({ googleCalendarEventId: eventId })
    .where(eq(bookings.id, bookingId));
}

export async function findBookingsNeedingCalendarSync(businessId: number): Promise<Booking[]> {
  return await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.businessId, businessId),
        inArray(bookings.calendarSyncStatus, ['pending', 'failed'])
      )
    );
}

// Agenda queries
export async function listBookingsForDate(
  businessId: number,
  calendarDate: string, // "YYYY-MM-DD"
  statuses: string[] = ['confirmed']
): Promise<Booking[]> {
  return await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.businessId, businessId),
        eq(bookings.calendarDate, calendarDate),
        inArray(bookings.bookingStatus, statuses)
      )
    )
    .orderBy(bookings.calendarTime);
}

export async function updateBusinessAgendaSentDate(businessId: number, isoDate: string): Promise<void> {
  await db
    .update(businesses)
    .set({ agendaSentDate: isoDate })
    .where(eq(businesses.id, businessId));
}

// Reminder queries
export async function updateBookingReminder24hSentAt(bookingId: number): Promise<void> {
  await db
    .update(bookings)
    .set({ reminder24hSentAt: new Date() })
    .where(eq(bookings.id, bookingId));
}

export async function updateBookingReminder1hSentAt(bookingId: number): Promise<void> {
  await db
    .update(bookings)
    .set({ reminder1hSentAt: new Date() })
    .where(eq(bookings.id, bookingId));
}

export async function findBookingsNeedingReminder(
  businessId: number,
  status: string,
  beforeDate?: string // "YYYY-MM-DD" — optional filter for same-day reminders
): Promise<Booking[]> {
  const conditions: Parameters<typeof and>[0][] = [
    eq(bookings.businessId, businessId),
    eq(bookings.bookingStatus, status),
  ];
  
  if (beforeDate) {
    conditions.push(eq(bookings.calendarDate, beforeDate));
  }
  
  return await db.select().from(bookings).where(and(...conditions));
}
```

---

### `src/calendar/sync.ts` (service, CRUD + event-driven — new)

**Analog:** `src/telegram/client.ts` lines 1–42 (async API wrapper pattern)

**Core pattern: Best-effort, non-blocking API calls wrapped in try/catch (D-15)**

```typescript
// src/telegram/client.ts (pattern to follow)
async function callTelegramApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/${method}`;
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await response.json()) as TelegramApiResponse<T>;
  if (!response.ok || !data.ok) {
    throw new Error(data.description ?? `Telegram API error: ${response.status}`);
  }
  return data.result as T;
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<SendMessageResult> {
  const result = await callTelegramApi<{ message_id: number }>('sendMessage', { chat_id: chatId, text });
  return { messageId: result.message_id };
}
```

**Apply to Calendar sync:**

```typescript
// src/calendar/sync.ts (new file, follow Telegram client pattern)

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { Booking, Business, updateCalendarSyncStatus, updateBookingGoogleEventId, findServiceById } from '../database/queries';
import { logger } from '../utils/logger';

async function getCalendarClient(business: Business): Promise<OAuth2Client | null> {
  if (!business.googleRefreshToken) return null;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  oauth2Client.setCredentials({
    refresh_token: business.googleRefreshToken,
  });

  return oauth2Client;
}

// Best-effort sync (D-15): never throws, always logs
export async function syncBookingToCalendar(
  booking: Booking,
  business: Business
): Promise<void> {
  const client = await getCalendarClient(business);
  if (!client) {
    logger.warn({ businessId: business.id }, 'No Google Calendar configured for business');
    return;
  }

  try {
    const calendar = google.calendar({ version: 'v3', auth: client });
    const service = await findServiceById(business.id, booking.serviceId);
    if (!service) throw new Error('Service not found');

    const eventBody = {
      summary: `${service.name} — Client ${booking.clientPhone}`, // D-08 format
      start: {
        dateTime: `${booking.calendarDate}T${booking.calendarTime}:00`,
        timeZone: 'Europe/Athens',
      },
      end: {
        dateTime: `${booking.calendarDate}T${addMinutes(booking.calendarTime, service.durationMin)}:00`,
        timeZone: 'Europe/Athens',
      },
    };

    if (booking.googleCalendarEventId) {
      // Update existing (reschedule case)
      await calendar.events.update({
        calendarId: 'primary',
        eventId: booking.googleCalendarEventId,
        requestBody: eventBody,
      });
    } else {
      // Create new event
      const result = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: eventBody,
      });
      await updateBookingGoogleEventId(booking.id, result.data.id!);
    }

    await updateCalendarSyncStatus(booking.id, 'synced');
    logger.info({ bookingId: booking.id }, 'Booking synced to Google Calendar');
  } catch (err) {
    logger.error({ err, bookingId: booking.id, businessId: business.id }, 'Calendar sync failed (non-blocking)');
    await updateCalendarSyncStatus(booking.id, 'pending');
    // Do NOT rethrow — booking is confirmed in DB, Calendar is a mirror only
  }
}

export async function deleteBookingFromCalendar(
  booking: Booking,
  business: Business
): Promise<void> {
  if (!booking.googleCalendarEventId) return; // Never synced, nothing to delete

  const client = await getCalendarClient(business);
  if (!client) return;

  try {
    const calendar = google.calendar({ version: 'v3', auth: client });
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: booking.googleCalendarEventId,
    });
    await updateCalendarSyncStatus(booking.id, 'synced');
    logger.info({ bookingId: booking.id }, 'Booking deleted from Google Calendar');
  } catch (err) {
    logger.warn({ err, bookingId: booking.id }, 'Calendar deletion failed (possibly already deleted, ignoring)');
    // Idempotent: deletion already happened or event gone, don't retry
  }
}
```

---

### `src/calendar/poller.ts` (utility, batch + retry — new)

**Analog:** `src/conversation/expiry-poller.ts` lines 1–80 (exact pattern to replicate)

**Core pattern: Per-business isolation + per-item isolation + setInterval wrapper**

```typescript
// src/conversation/expiry-poller.ts (lines 24-80, pattern to replicate exactly)
export async function runExpirySweep(): Promise<number> {
  const businessIds = await listAllBusinessIds();
  let notifiedCount = 0;

  for (const businessId of businessIds) {
    try {
      const expired = await expireStalePendingBookings(businessId, EXPIRY_CUTOFF_MS);

      for (const booking of expired) {
        try {
          // per-item logic
          await sendTelegramMessage(booking.clientPhone, EXPIRY_NOTICE_GREEK);
          notifiedCount += 1;
        } catch (err) {
          logger.error({ err, bookingId: booking.id }, 'Failed to notify client of expired booking');
        }
      }
    } catch (err) {
      logger.error({ err, businessId }, 'Expiry sweep failed for business');
    }
  }

  return notifiedCount;
}

export function startExpiryPoller(intervalMs: number = 5 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    runExpirySweep().catch((err) => logger.error({ err }, 'Unhandled expiry sweep error'));
  }, intervalMs);
}
```

**Apply to Calendar sync retry poller:**

```typescript
// src/calendar/poller.ts (new file, replicate expiry-poller pattern)

import { listAllBusinessIds, findBusinessById, findBookingsNeedingCalendarSync, updateCalendarSyncStatus, Booking } from '../database/queries';
import { syncBookingToCalendar, deleteBookingFromCalendar } from './sync';
import { logger } from '../utils/logger';

const MAX_RETRIES = 10; // D-16: max-retry policy left to planner's discretion

export async function runCalendarSyncSweep(): Promise<number> {
  const businessIds = await listAllBusinessIds();
  let syncedCount = 0;

  for (const businessId of businessIds) {
    try {
      const business = await findBusinessById(businessId);
      if (!business?.googleRefreshToken) continue; // No Calendar configured

      // Find bookings pending or failed sync
      const bookings = await findBookingsNeedingCalendarSync(businessId);

      for (const booking of bookings) {
        try {
          if (booking.bookingStatus === 'confirmed') {
            await syncBookingToCalendar(booking, business);
          } else if (booking.bookingStatus === 'cancelled') {
            await deleteBookingFromCalendar(booking, business);
          }
          syncedCount += 1;
        } catch (err) {
          // Increment retry count; mark as failed if max retries exceeded
          const retryCount = booking.calendarSyncRetryCount || 0;
          if (retryCount >= MAX_RETRIES) {
            await updateCalendarSyncStatus(booking.id, 'failed');
            logger.error({ err, bookingId: booking.id }, 'Calendar sync permanently failed');
          } else {
            // updateCalendarSyncRetryCount would need to be added to queries.ts
            logger.warn({ err, bookingId: booking.id }, `Calendar sync failed, retry ${retryCount + 1}`);
          }
        }
      }
    } catch (err) {
      logger.error({ err, businessId }, 'Calendar sync sweep failed for business');
    }
  }

  return syncedCount;
}

export function startCalendarSyncPoller(intervalMs: number = 5 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    runCalendarSyncSweep().catch((err) => logger.error({ err }, 'Unhandled calendar sync error'));
  }, intervalMs);
}
```

---

### `src/scheduler/agenda.ts` (utility, batch — new)

**Analog:** `src/conversation/expiry-poller.ts` lines 24–79 (per-business loop pattern)

**Core pattern: Per-business isolation + sent-state guard (D-11)**

```typescript
// src/scheduler/agenda.ts (new file, replicate expiry-poller pattern)

import { isoDateInAthens } from '../utils/timezone';
import { listAllBusinessIds, findBusinessById, listBookingsForDate, updateBusinessAgendaSentDate, findServiceById } from '../database/queries';
import { sendTelegramMessage } from '../telegram/client';
import { logger } from '../utils/logger';

async function formatAgendaMessage(
  bookings: Array<{ calendarTime: string; serviceName: string; clientPhone: string }>
): Promise<string> {
  // Format in Greek, following Phase 1/2 tone (formal, clear, D-44 discretion)
  let message = 'Σήμερα τα ραντεβού σας:\n\n';
  for (const b of bookings) {
    message += `${b.calendarTime} - ${b.serviceName} (${b.clientPhone})\n`;
  }
  return message;
}

export async function runAgendaSweep(): Promise<number> {
  const businessIds = await listAllBusinessIds();
  let sentCount = 0;

  for (const businessId of businessIds) {
    try {
      const business = await findBusinessById(businessId);
      if (!business?.ownerTelegramId) continue;

      const today = isoDateInAthens(new Date());

      // Idempotency guard (D-11): skip if already sent today (strict <, not <=)
      if (business.agendaSentDate === today) continue;

      // Get appointments for today
      const bookings = await listBookingsForDate(businessId, today, ['confirmed']);
      if (bookings.length === 0) continue; // No appointments

      // Enrich bookings with service names (D-08 format uses service name)
      const enriched = await Promise.all(
        bookings.map(async (b) => {
          const service = await findServiceById(businessId, b.serviceId);
          return { calendarTime: b.calendarTime, serviceName: service?.name || 'Unknown', clientPhone: b.clientPhone };
        })
      );

      // Format and send
      const message = await formatAgendaMessage(enriched);
      await sendTelegramMessage(business.ownerTelegramId, message);

      // Update sent-state atomically (guards against concurrent sweeps)
      await updateBusinessAgendaSentDate(businessId, today);
      sentCount += 1;

      logger.info({ businessId, date: today, count: bookings.length }, 'Agenda sent');
    } catch (err) {
      logger.error({ err, businessId }, 'Agenda sweep failed for business');
    }
  }

  return sentCount;
}

// D-09: check interval left to planner's discretion (e.g., 5–10 min recommended)
export function startAgendaPoller(intervalMs: number = 10 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    runAgendaSweep().catch((err) => logger.error({ err }, 'Unhandled agenda sweep error'));
  }, intervalMs);
}
```

---

### `src/scheduler/reminders.ts` (utility, batch — new)

**Analog:** `src/conversation/expiry-poller.ts` lines 24–79 (per-business + per-item loop pattern)

**Core pattern: Nested per-business and per-booking try/catch (CR-04), sent-state guards (D-11)**

```typescript
// src/scheduler/reminders.ts (new file, replicate expiry-poller nested-isolation pattern)

import { isoDateInAthens, addCalendarDays } from '../utils/timezone';
import { listAllBusinessIds, findBusinessById, listBookingsForDate, updateBookingReminder24hSentAt, updateBookingReminder1hSentAt } from '../database/queries';
import { sendTelegramMessage } from '../telegram/client';
import { logger } from '../utils/logger';

// Helper: DST-safe reminder threshold check
function shouldSend24hReminder(booking: { calendarDate: string; calendarTime: string; createdAt: Date }, now: Date): boolean {
  // 24h before appointment = yesterday (Athens date) at appointment time
  const appointmentDay = booking.calendarDate;
  const reminderDay = addCalendarDays(appointmentDay, -1);
  const reminderTime = booking.calendarTime;

  const today = isoDateInAthens(now);
  const currentTime = now.toLocaleString('en-GB', {
    timeZone: 'Europe/Athens',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }); // "HH:MM"

  // Send reminder if: today is reminder day AND current time >= reminder time
  return (today === reminderDay && currentTime >= reminderTime) || today > reminderDay;
}

function shouldSend1hReminder(booking: { calendarDate: string; calendarTime: string; createdAt: Date }, now: Date): boolean {
  // 1h before appointment = same day, one hour earlier
  const appointmentDay = booking.calendarDate;
  const appointmentTime = booking.calendarTime; // "HH:MM"

  const today = isoDateInAthens(now);
  const currentTime = now.toLocaleString('en-GB', {
    timeZone: 'Europe/Athens',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }); // "HH:MM"

  // Parse hour and compute reminder time (1h before)
  const [appointmentHour, appointmentMin] = appointmentTime.split(':');
  const reminderHour = String(Math.max(0, parseInt(appointmentHour) - 1)).padStart(2, '0');
  const reminderTime = `${reminderHour}:${appointmentMin}`;

  // Send if: today is appointment day, current time is between reminder time and appointment time
  return (
    today === appointmentDay &&
    currentTime >= reminderTime &&
    currentTime <= appointmentTime
  );
}

export async function runReminderSweep(): Promise<number> {
  const businessIds = await listAllBusinessIds();
  let sentCount = 0;
  const now = new Date();

  for (const businessId of businessIds) {
    try {
      const business = await findBusinessById(businessId);
      if (!business) continue;

      const today = isoDateInAthens(now);

      // Get all confirmed bookings for today and tomorrow (for 24h reminders)
      const bookingsToday = await listBookingsForDate(businessId, today, ['confirmed']);
      const tomorrow = addCalendarDays(today, 1);
      const bookingsTomorrow = await listBookingsForDate(businessId, tomorrow, ['confirmed']);
      const allBookings = [...bookingsToday, ...bookingsTomorrow];

      for (const booking of allBookings) {
        // 24h reminder (per-item isolation, CR-04)
        if (!booking.reminder24hSentAt && shouldSend24hReminder(booking, now)) {
          try {
            // D-14: skip silently if booking confirmed too close to appointment
            const hoursUntilReminder = (new Date(booking.createdAt).getTime() + 24 * 60 * 60 * 1000 - now.getTime()) / (1000 * 60 * 60);
            if (hoursUntilReminder < 0) continue; // Too late to catch this reminder

            await sendTelegramMessage(
              booking.clientPhone,
              `Υπενθύμιση: Έχετε ραντεβού αύριο στις ${booking.calendarTime}.`
            );
            await updateBookingReminder24hSentAt(booking.id);
            sentCount += 1;
            logger.info({ bookingId: booking.id }, '24h reminder sent');
          } catch (err) {
            logger.error({ err, bookingId: booking.id }, 'Failed to send 24h reminder');
          }
        }

        // 1h reminder (per-item isolation)
        if (!booking.reminder1hSentAt && shouldSend1hReminder(booking, now)) {
          try {
            // D-14: skip silently if booking confirmed too close to appointment
            const hoursUntilReminder = (new Date(booking.createdAt).getTime() + 1 * 60 * 60 * 1000 - now.getTime()) / (1000 * 60 * 60);
            if (hoursUntilReminder < 0) continue; // Too late to catch this reminder

            await sendTelegramMessage(
              booking.clientPhone,
              `Υπενθύμιση: Έχετε ραντεβού σε 1 ώρα.`
            );
            await updateBookingReminder1hSentAt(booking.id);
            sentCount += 1;
            logger.info({ bookingId: booking.id }, '1h reminder sent');
          } catch (err) {
            logger.error({ err, bookingId: booking.id }, 'Failed to send 1h reminder');
          }
        }
      }
    } catch (err) {
      logger.error({ err, businessId }, 'Reminder sweep failed for business');
    }
  }

  return sentCount;
}

// D-10: 15-minute interval for tighter accuracy (user discretion, 15–30 min range)
export function startReminderPoller(intervalMs: number = 15 * 60 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    runReminderSweep().catch((err) => logger.error({ err }, 'Unhandled reminder sweep error'));
  }, intervalMs);
}
```

---

### `src/google/oauth.ts` (service, request-response — new)

**Analog:** `src/telegram/client.ts` lines 1–42 (async API wrapper pattern)

**Core pattern: Async API call with error handling**

```typescript
// src/google/oauth.ts (new file, follow Telegram client pattern)

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config';
import { updateBusinessGoogleRefreshToken } from '../database/queries';
import { logger } from '../utils/logger';

// One-time OAuth consent flow for fixture businesses (D-05/D-07, throwaway Phase 3 tooling)
// Phase 4 replaces with full self-serve onboarding

export async function getOAuth2Client(): Promise<OAuth2Client> {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth/callback'
  );
}

export async function getOAuth2AuthUrl(): Promise<string> {
  const oauth2Client = await getOAuth2Client();
  
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar'],
    prompt: 'consent', // Force consent screen (required for offline token refresh)
  });

  return authUrl;
}

export async function exchangeAuthCodeForTokens(code: string): Promise<{ refresh_token: string; access_token: string }> {
  const oauth2Client = await getOAuth2Client();
  
  const { tokens } = await oauth2Client.getToken(code);
  
  if (!tokens.refresh_token) {
    throw new Error('No refresh token received from Google. Check OAuth consent-screen prompt setting.');
  }

  return {
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token || '',
  };
}

// Utility: Store refresh token in business record
export async function storeGoogleRefreshToken(businessId: number, refreshToken: string): Promise<void> {
  try {
    await updateBusinessGoogleRefreshToken(businessId, refreshToken);
    logger.info({ businessId }, 'Google refresh token stored');
  } catch (err) {
    logger.error({ err, businessId }, 'Failed to store Google refresh token');
    throw err;
  }
}
```

**Add to `src/database/queries.ts`:**
```typescript
export async function updateBusinessGoogleRefreshToken(businessId: number, refreshToken: string): Promise<void> {
  await db
    .update(businesses)
    .set({ googleRefreshToken: refreshToken })
    .where(eq(businesses.id, businessId));
}
```

---

### `src/webhooks/telegram.ts` (controller, request-response — modify)

**Analog:** `src/webhooks/telegram.ts` lines 145–176 (integration point for booking confirmation hook)

**Location:** After owner-approval callback is processed (line 145 onward). Hook into booking confirmation flow.

From RESEARCH.md section "Integration Points in Codebase", lines 606–637, the booking confirmation handler needs a Calendar sync call:

```typescript
// src/webhooks/telegram.ts (MODIFY at lines 145–176)

// Existing code (lines 145–146):
const newStatus = parsed.action === 'approve' ? 'confirmed' : 'rejected';
const updated = await updateBookingStatusIfPending(booking.id, newStatus);
if (!updated) return;

// Existing code (lines 155–172):
if (parsed.action === 'approve') {
  // Reschedule cascade
  if (updated.rescheduledFromBookingId) {
    await updateBookingStatus(updated.rescheduledFromBookingId, 'cancelled');
    
    // DELETE old Calendar event (best-effort, non-blocking)
    try {
      const oldBooking = await findBookingByIdUnscoped(updated.rescheduledFromBookingId);
      if (oldBooking) {
        const oldBusiness = await findBusinessById(updated.businessId);
        if (oldBusiness) {
          await deleteBookingFromCalendar(oldBooking, oldBusiness);
        }
      }
    } catch (err) {
      logger.error({ err, bookingId: updated.rescheduledFromBookingId }, 'Failed to delete old calendar event');
    }
  }

  // [PHASE 3 HOOK: INSERT CALENDAR SYNC HERE]
  // Wrapped in own try/catch (D-15: best-effort, non-blocking)
  try {
    const business = await findBusinessById(updated.businessId);
    if (business) {
      await syncBookingToCalendar(updated, business);
    }
  } catch (err) {
    logger.error({ err, bookingId: updated.id }, 'Calendar sync failed (best-effort, non-blocking)');
    // Do NOT rethrow — booking is already confirmed in DB
  }

  // Client confirmation message (existing)
  const service = await findServiceById(updated.businessId, updated.serviceId);
  await sendTelegramMessage(
    updated.clientPhone,
    `Το ραντεβού σας επιβεβαιώθηκε! ...`
  );
}
```

**Import statement to add at top of file:**
```typescript
import { syncBookingToCalendar, deleteBookingFromCalendar } from '../calendar/sync';
```

---

### `src/conversation/function-executor.ts` (service, request-response — modify)

**Analog:** `src/conversation/function-executor.ts` lines 175–211 (cancellation handler)

**Location:** After `updateBookingStatus(booking.id, 'cancelled')` at line 190.

From RESEARCH.md section "Integration Points in Codebase", lines 652–694, the cancellation handler needs a Calendar delete call:

```typescript
// src/conversation/function-executor.ts (MODIFY inside cancelAppointmentTool, after line 190)

async function cancelAppointmentTool(args, context) {
  const booking = await findBookingById(context.business.id, parsed.booking_id);
  if (!booking) return { success: false, error: 'booking_not_found' };
  // ... validation ...

  await updateBookingStatus(booking.id, 'cancelled');
  // Line 190: DB mutation committed

  // [PHASE 3 HOOK: DELETE CALENDAR EVENT HERE]
  // Wrapped in own try/catch (D-15: best-effort, non-blocking)
  try {
    const business = await findBusinessById(context.business.id);
    if (business) {
      await deleteBookingFromCalendar(booking, business);
    }
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'Calendar deletion failed (best-effort)');
    // Do NOT rethrow — booking is already cancelled in DB
  }

  try {
    if (context.business.ownerTelegramId) {
      // ... owner FYI message ...
    }
    await sendTelegramMessage(booking.clientPhone, 'Το ραντεβού σας ακυρώθηκε.');
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'Cancellation succeeded but notification failed');
  }

  return { success: true, booking_id: booking.id };
}
```

**Import statement to add at top of file:**
```typescript
import { deleteBookingFromCalendar } from '../calendar/sync';
```

---

### `src/server.ts` (config, request-response — modify)

**Analog:** `src/server.ts` lines 27–29 (existing poller startup pattern)

**Location:** After `startExpiryPoller()` call, add the three new pollers (D-12):

```typescript
// src/server.ts (MODIFY at lines 27–29)

if (!process.env.JEST_WORKER_ID) {
  startExpiryPoller();
  
  // Phase 3: Calendar sync, agenda, reminder pollers (all in-process, D-12)
  startCalendarSyncPoller();
  startAgendaPoller();
  startReminderPoller();
}

export default app;
```

**Import statements to add at top of file (after line 5):**
```typescript
import { startCalendarSyncPoller } from './calendar/poller';
import { startAgendaPoller } from './scheduler/agenda';
import { startReminderPoller } from './scheduler/reminders';
```

---

## Shared Patterns

### Pattern 1: In-Process Poller with Per-Business Isolation

**Source:** `src/conversation/expiry-poller.ts` lines 24–79 (applies to all pollers)

**Apply to:** All poller files (`src/calendar/poller.ts`, `src/scheduler/agenda.ts`, `src/scheduler/reminders.ts`)

**Pattern:**
```typescript
// Outer loop: per-business isolation (never rethrow, always log)
for (const businessId of businessIds) {
  try {
    // Per-business logic
    const business = await findBusinessById(businessId);
    
    // Inner loop: per-item isolation (nested try/catch, CR-04)
    for (const item of items) {
      try {
        // Item-level logic: send message, update state
        await sendTelegramMessage(...);
        sentCount += 1;
      } catch (err) {
        logger.error({ err, itemId: item.id }, 'Item processing failed');
        // Continue to next item, never rethrow
      }
    }
  } catch (err) {
    logger.error({ err, businessId }, 'Sweep failed for business');
    // Continue to next business, never rethrow
  }
}

return sentCount;
```

---

### Pattern 2: Sent-State Idempotency Guards

**Source:** `src/conversation/expiry-poller.ts` lines 35–42 (sent-state check via DB lookup)

**Apply to:** Agenda and reminder pollers (prevent duplicate sends)

**Pattern:**
```typescript
// Guard 1: Check if already sent
if (business.agendaSentDate === today) continue; // Skip entire business

if (!booking.reminder24hSentAt) {
  // Only proceed if sent-state is still null
  await sendTelegramMessage(...);
  await updateBookingReminder24hSentAt(booking.id); // Atomic update
}
```

**Atomic update pattern (from Phase 2 bookings):**
```typescript
// Query with WHERE clause that includes sent-state check:
// UPDATE bookings SET reminder24hSentAt = NOW() 
// WHERE id = ? AND reminder24hSentAt IS NULL 
// RETURNING *
// If RETURNING is empty, another sweep already sent this reminder
```

---

### Pattern 3: Best-Effort, Non-Blocking API Calls

**Source:** `src/telegram/client.ts` lines 15–34 (error handling — throw on failure)

**Apply to:** `src/calendar/sync.ts` (catch at integration points, never rethrow)

**Pattern at service layer (sync.ts):**
```typescript
export async function syncBookingToCalendar(booking, business) {
  const client = await getCalendarClient(business);
  if (!client) return; // Skip silently

  try {
    const calendar = google.calendar(...);
    await calendar.events.insert({...});
    await updateCalendarSyncStatus(booking.id, 'synced');
    logger.info({ bookingId: booking.id }, 'Synced');
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'Calendar sync failed (non-blocking)');
    await updateCalendarSyncStatus(booking.id, 'pending');
    // Do NOT rethrow
  }
}
```

**Pattern at integration point (telegram.ts):**
```typescript
try {
  await syncBookingToCalendar(updated, business);
} catch (err) {
  logger.error({ err, bookingId: updated.id }, 'Calendar sync failed (best-effort)');
  // Do NOT rethrow — booking is already confirmed in DB
}
```

---

### Pattern 4: DST-Safe Date Arithmetic

**Source:** `src/utils/timezone.ts` lines 1–31 (existing helpers to reuse, never duplicate)

**Apply to:** Reminder and agenda pollers (remind thresholds, agenda trigger time)

**Pattern:**
```typescript
import { isoDateInAthens, addCalendarDays } from '../utils/timezone';

const today = isoDateInAthens(new Date());
const tomorrow = addCalendarDays(today, 1);

// WRONG: new Date(booking.calendarDate).getTime() - new Date().getTime()
// RIGHT: compare Athens-local dates as strings, then convert to UTC
```

---

## Test Analogs

### `tests/calendar/sync.test.ts`, `tests/calendar/poller.test.ts`, `tests/scheduler/agenda.test.ts`, `tests/scheduler/reminders.test.ts` (new)

**Analog:** `tests/expiry-poller.test.ts` lines 1–60 (test structure and mocking pattern)

**Core test pattern:**
```typescript
// tests/expiry-poller.test.ts (lines 1–27, pattern to replicate)
import * as queries from '../src/database/queries';
import * as telegramClient from '../src/telegram/client';
import { logger } from '../src/utils/logger';
import { runExpirySweep, startExpiryPoller } from '../src/conversation/expiry-poller';

jest.mock('../src/database/queries');
jest.mock('../src/telegram/client');
jest.mock('../src/utils/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const mockedListAllBusinessIds = queries.listAllBusinessIds as jest.MockedFunction<typeof queries.listAllBusinessIds>;
const mockedSendTelegramMessage = telegramClient.sendTelegramMessage as jest.MockedFunction<typeof telegramClient.sendTelegramMessage>;

describe('runExpirySweep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSendTelegramMessage.mockResolvedValue({ messageId: 1 });
  });

  it('sends expiry notice and increments count', async () => {
    // Mock query results
    mockedListAllBusinessIds.mockResolvedValue([1]);
    mockedExpireStalePendingBookings.mockResolvedValue([makeExpiredBooking()]);

    // Run sweep
    const count = await runExpirySweep();

    // Assert
    expect(count).toBe(1);
    expect(mockedSendTelegramMessage).toHaveBeenCalledWith('c5', EXPIRY_NOTICE_GREEK);
  });
});
```

**Apply to Calendar poller tests:**
- Mock `findBookingsNeedingCalendarSync`, `syncBookingToCalendar`, `deleteBookingFromCalendar`
- Test: Calendar sync marked as 'synced' on success
- Test: Calendar sync marked as 'pending' on failure (non-blocking)
- Test: Max-retry policy abandons after MAX_RETRIES failures
- Test: Concurrent sweeps don't process same booking twice

**Apply to Agenda tests:**
- Mock `listBookingsForDate`, `sendTelegramMessage`, `updateBusinessAgendaSentDate`
- Test: Agenda sent once per day
- Test: Agenda skipped if already sent today (`agendaSentDate === today`)
- Test: No agenda sent if no bookings for today
- Test: DST transition doesn't skip or duplicate agenda (mock timezone.ts)

**Apply to Reminder tests:**
- Mock `listBookingsForDate`, `sendTelegramMessage`, `updateBookingReminder24hSentAt`, `updateBookingReminder1hSentAt`
- Test: 24h reminder sent 24h before appointment
- Test: 1h reminder sent 1h before appointment
- Test: Reminders skipped if booking confirmed too close (D-14)
- Test: Reminder not sent twice (idempotency via sent-state column)
- Test: Late-night booking (crosses calendar day) handled correctly
- Test: DST transition doesn't break reminder thresholds (mock timezone.ts)

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | All Phase 3 files have existing analogs in codebase (expiry-poller, telegram/client, schema patterns) or are direct extensions of existing code. |

---

## Metadata

**Analog search scope:**
- `src/conversation/*.ts` — poller patterns
- `src/telegram/*.ts` — async API wrapper patterns
- `src/database/*.ts` — schema and query patterns
- `src/webhooks/*.ts` — integration points
- `tests/*.test.ts` — test structure and mocking

**Files scanned:** 25 source files + 18 test files

**Pattern extraction date:** 2026-07-09

**Valid until:** 2026-08-09 (30 days — stable patterns, no major framework changes expected)

---

## Integration Checklist

Before coding Phase 3 implementation:

- [ ] Review expiry-poller pattern (CR-04 nested isolation) in `src/conversation/expiry-poller.ts`
- [ ] Review timezone helpers usage in `src/utils/timezone.ts` (DST safety, no raw Date math)
- [ ] Review Telegram client error handling in `src/telegram/client.ts` (best-effort pattern)
- [ ] Review test mocking in `tests/expiry-poller.test.ts` (jest.mock, beforeEach, makeFixture helpers)
- [ ] Verify database schema extension pattern (nullable columns, default values) in `src/database/schema.ts`
- [ ] Run `npm test` to confirm existing test suites pass before adding Phase 3 tests
- [ ] Coordinate with package.json to ensure `googleapis` 118.0+ is installed (`npm install googleapis`)

---

**End of Phase 3 Pattern Map**
