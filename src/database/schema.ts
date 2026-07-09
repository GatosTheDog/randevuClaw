import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const businesses = pgTable('businesses', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  phoneNumberId: text('phone_number_id'),
  // Phase 2 (nullable — Phase 1 already inserted 2 rows, Postgres can't add a
  // NOT NULL column without a default to a non-empty table): Telegram user ID
  // of the business owner, used to route owner-approval alerts (D-08).
  ownerTelegramId: text('owner_telegram_id'),
  // Phase 3 (nullable — table is non-empty, same convention as ownerTelegramId
  // above): the long-lived Google OAuth 2.0 refresh token for this business's
  // owner Google account (D-06). Never logged — see 03-01-PLAN.md threat model
  // T-03-01; only read by src/calendar/sync.ts (Plan 03-02).
  googleRefreshToken: text('google_refresh_token'),
  // Phase 3 (nullable — D-11 idempotency guard): ISO "YYYY-MM-DD" Europe/Athens
  // local date the daily agenda was last sent for this business. null means
  // never sent. Advanced only via the atomic claimAgendaSlot query.
  agendaSentDate: text('agenda_sent_date'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  whatsappMessageId: text('whatsapp_message_id').notNull().unique(), // D-05 dedup key
  businessId: integer('business_id')
    .notNull()
    .references(() => businesses.id),
  senderPhone: text('sender_phone').notNull(),
  messageBody: text('message_body').notNull(),
  status: text('status').notNull().default('received'), // 'received' | 'processed'
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const clientBusinessRelationships = pgTable(
  'client_business_relationships',
  {
    id: serial('id').primaryKey(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id),
    senderPhone: text('sender_phone').notNull(),
    consentGiven: boolean('consent_given').notNull().default(true), // Implied consent (D-10)
    consentTimestamp: timestamp('consent_timestamp').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    // D-09/D-12 composite key: one relationship row per (business, phone) pair
    uniqueIndex('unique_client_business').on(table.businessId, table.senderPhone),
  ]
);

// --- Phase 2: AI Booking Conversations & Owner Alerts ---

export const services = pgTable(
  'services',
  {
    id: serial('id').primaryKey(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id),
    name: text('name').notNull(),
    durationMin: integer('duration_min').notNull(),
    price: integer('price'), // cents, nullable
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('unique_business_service').on(table.businessId, table.name)]
);

export const businessHours = pgTable(
  'business_hours',
  {
    id: serial('id').primaryKey(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id),
    // JS `Date.getDay()` convention: 0=Sunday..6=Saturday (NOT "0=Monday" —
    // corrects a documentation error in 02-RESEARCH.md so this matches what
    // `new Date(calendarDate).getDay()` actually returns in Plan 02-03).
    dayOfWeek: integer('day_of_week').notNull(),
    openTime: text('open_time').notNull(), // "HH:MM" 24h, Europe/Athens local wall-clock
    closeTime: text('close_time').notNull(), // "HH:MM" 24h, Europe/Athens local wall-clock
    isClosed: boolean('is_closed').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('unique_business_day').on(table.businessId, table.dayOfWeek)]
);

export const bookings = pgTable(
  'bookings',
  {
    id: serial('id').primaryKey(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id),
    // Channel-specific client identifier: Telegram's numeric `from.id`
    // stringified for Phase 2, WhatsApp phone number for the shelved adapter.
    // Named `clientPhone` for consistency with RESEARCH.md/PATTERNS.md/AI-SPEC.md's
    // uniform naming across both channel adapters.
    clientPhone: text('client_phone').notNull(),
    serviceId: integer('service_id')
      .notNull()
      .references(() => services.id),
    calendarDate: text('calendar_date').notNull(), // "YYYY-MM-DD" Europe/Athens local
    calendarTime: text('calendar_time').notNull(), // "HH:MM" 24h Europe/Athens local, slot start
    // pending_owner_approval | confirmed | cancelled | rejected | expired
    bookingStatus: text('booking_status').notNull().default('pending_owner_approval'),
    requestId: text('request_id').notNull(), // idempotency key (D-10)
    ownerTelegramMessageId: integer('owner_telegram_message_id'), // nullable, for editing the approval alert
    // Audit-trail only, no FK: a self-referencing FK needs an AnyPgColumn
    // type-annotated forward reference in Drizzle; skipped since this field
    // is not integrity-critical.
    rescheduledFromBookingId: integer('rescheduled_from_booking_id'),
    // Phase 3 (D-16 — mirrors the bookingStatus notNull-with-default
    // convention; safe on a non-empty table since Postgres backfills the
    // default): 'pending' | 'synced' | 'failed'. Drives the calendar-sync
    // poller (Plan 03-02).
    calendarSyncStatus: text('calendar_sync_status').notNull().default('pending'),
    // Nullable: Google's event id, set once a create/update call succeeds;
    // used to target the correct event on a later update/delete.
    googleCalendarEventId: text('google_calendar_event_id'),
    // D-16: incremented by the retry poller (Plan 03-02), compared against a
    // max-retry threshold there.
    calendarSyncRetryCount: integer('calendar_sync_retry_count').notNull().default(0),
    // Nullable — D-11 sent-state idempotency guards. Advanced only via the
    // atomic claimReminder24hSlot/claimReminder1hSlot queries.
    reminder24hSentAt: timestamp('reminder_24h_sent_at'),
    reminder1hSentAt: timestamp('reminder_1h_sent_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at'), // createdAt + 2h at insert time (D-09)
  },
  (table) => [
    // Partial unique index scoped to ACTIVE statuses only (D-10 + D-11):
    // once a booking for a slot is cancelled/rejected/expired, the slot must
    // be immediately re-bookable. A blanket (non-partial) unique index on
    // these 3 columns would permanently block the slot after one
    // cancellation — that would be a correctness bug, not just a
    // performance choice.
    uniqueIndex('unique_active_slot_per_business')
      .on(table.businessId, table.calendarDate, table.calendarTime)
      .where(sql`booking_status IN ('pending_owner_approval', 'confirmed')`),
    // Idempotency-replay guard: must remain globally unique regardless of status.
    uniqueIndex('unique_request_per_client').on(table.clientPhone, table.requestId),
  ]
);

export const conversationTurns = pgTable('conversation_turns', {
  id: serial('id').primaryKey(),
  businessId: integer('business_id')
    .notNull()
    .references(() => businesses.id),
  clientPhone: text('client_phone').notNull(),
  interactionId: text('interaction_id'), // Gemini's interaction.id; null if turn errored before Gemini responded
  requestId: text('request_id').notNull(),
  messageText: text('message_text').notNull(),
  responseText: text('response_text').notNull(),
  toolCalls: text('tool_calls'), // JSON.stringify'd array of {name, args}, for AI-SPEC Section 7 sampling
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const telegramUpdates = pgTable('telegram_updates', {
  id: serial('id').primaryKey(),
  updateId: text('update_id').notNull().unique(), // Telegram's update.update_id (text to avoid integer-range assumptions)
  businessId: integer('business_id').references(() => businesses.id), // nullable: business resolution happens AFTER dedup-insert
  senderTelegramId: text('sender_telegram_id').notNull(),
  updateType: text('update_type').notNull(), // 'message' | 'callback_query'
  status: text('status').notNull().default('received'), // 'received' | 'processed'
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
