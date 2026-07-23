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
  // Phase 4 (nullable — D-07): per-bot Telegram bot token, stored DB-side.
  // Never logged; only read by src/webhooks/telegram.ts for routing.
  // Added as nullable to follow the established multi-phase schema convention
  // (table is non-empty; NOT NULL requires a default on existing rows).
  botToken: text('bot_token'),
  // Phase 4 (nullable — D-07): UUID-keyed webhook routing path (e.g.,
  // /webhooks/telegram/:webhookId). The actual bot token never appears in logs
  // or URL paths (STATE.md blocker, D-04). UNIQUE constraint enforces one
  // webhookId per registered bot at the DB level.
  webhookId: text('webhook_id').unique(),
  // Phase 4 (nullable — D-07): HMAC secret for webhook signature verification
  // via constant-time comparison (crypto.timingSafeEqual, D-06).
  webhookSecret: text('webhook_secret'),
  // Phase 8 (D-07): enforcement policy for clients with no active membership.
  // 'allow' = proceed (default); 'block' = reject booking; 'flag' = allow with
  // owner alert. NOT NULL with DEFAULT 'allow' — existing rows are safe after
  // migration (permit-by-default). CHECK constraint in migration enforces valid
  // values at DB level; Zod enforces at app level (Plan 05).
  enforcementPolicy: text('enforcement_policy').notNull().default('allow'),
  // Phase 12 (CANC-01): cancellation cutoff window. When enabled, clients who
  // cancel within cutoffHours of their session forfeit their credit. Default
  // false (opt-in) so existing businesses are unaffected. Migration 0010
  // adds both columns with these same defaults.
  cancellationCutoffEnabled: boolean('cancellation_cutoff_enabled').notNull().default(false),
  cancellationCutoffHours: integer('cancellation_cutoff_hours').notNull().default(8),
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
    // Phase 7 (D-04 — nullable: table is non-empty; captured from Telegram
    // from.first_name on each message and upserted to reflect the latest
    // display name. Used in the payment flow UI to show client display names
    // in inline keyboard buttons).
    clientName: text('client_name'),
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
    openTime2: text('open_time_2'),   // nullable — second range open, e.g. "17:00"
    closeTime2: text('close_time_2'), // nullable — second range close, e.g. "21:00"
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

// --- Phase 5: Owner Self-Serve Onboarding ---

export const onboardingSessions = pgTable(
  'onboarding_sessions',
  {
    id: serial('id').primaryKey(),
    // Phase 5: FK to businesses — NOT NULL because the businesses row is inserted
    // with a placeholder name/slug immediately on bot token validation (before the
    // guided setup begins). See platform.ts and 05-RESEARCH.md Pattern 6.
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id),
    // Text enum — see OnboardingStep type in src/onboarding/router.ts.
    // 'done' = activation complete; sessions at 'done' are excluded from active lookup.
    currentStep: text('current_step').notNull(),
    // JSON blob: partial state for mid-step data (e.g. partial service being collected
    // during svc_name/svc_price steps). null when no partial state is in progress.
    collectedData: text('collected_data'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    // $onUpdate fires on every Drizzle .update() call (application-level hook, not a
    // DB trigger — does not fire on raw SQL updates or migrations). drizzle-orm 0.30.5+.
    updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    // One active session per business (D-05). Used with onConflictDoUpdate on
    // re-registration (owner re-submits their bot token).
    uniqueIndex('unique_onboarding_session_per_business').on(table.businessId),
  ]
);

// --- Phase 7: Billing Configuration & Payment Recording ---

export const billingPackages = pgTable(
  'billing_packages',
  {
    id: serial('id').primaryKey(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id),
    name: text('name').notNull(),
    // Phase 7: price in euro cents (e.g. 8000 = €80.00). Consistent with
    // services.price cents convention.
    priceCents: integer('price_cents').notNull(),
    validDays: integer('valid_days').notNull(),
    // Phase 7 (D-02): null = unlimited sessions; Gemini maps "απεριόριστες"
    // keywords to session_count = null.
    sessionCount: integer('session_count'),
    // Phase 7 (D-03): false = pending confirmation, true = active on owner
    // confirmation. Soft-delete flag — deactivated packages never deleted.
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    // Partial index — WHERE is_active = true allows a new active package to
    // be created with the same name as a deactivated one.
    uniqueIndex('unique_active_package_name')
      .on(table.businessId, table.name)
      .where(sql`is_active = true`),
  ]
);

export const memberships = pgTable(
  'memberships',
  {
    id: serial('id').primaryKey(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id),
    // Telegram from.id stringified — consistent with bookings.clientPhone
    // convention across both WhatsApp and Telegram channel adapters.
    clientPhone: text('client_phone').notNull(),
    packageId: integer('package_id')
      .notNull()
      .references(() => billingPackages.id),
    // Phase 7: ISO "YYYY-MM-DD" stored in Europe/Athens local time.
    purchaseDate: text('purchase_date').notNull(),
    // Phase 7: TIMESTAMP WITH TIME ZONE for DST-safe rolling expiry window;
    // calculated via addCalendarDays utility in src/utils/timezone.ts.
    expiresAt: timestamp('expires_at').notNull(),
    // Phase 7 (D-02): null = unlimited sessions.
    sessionsRemaining: integer('sessions_remaining'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    // D-10: one active membership per (business_id, client_phone) enforced at
    // DB level. Partial index — WHERE is_active = true so expired/deactivated
    // memberships do not block a new membership for the same client.
    uniqueIndex('unique_active_membership')
      .on(table.businessId, table.clientPhone)
      .where(sql`is_active = true`),
  ]
);

export const membershipLedger = pgTable(
  'membership_ledger',
  {
    id: serial('id').primaryKey(),
    membershipId: integer('membership_id')
      .notNull()
      .references(() => memberships.id),
    // Phase 7: 'payment_recorded' | 'session_deducted' | 'credit_restored'
    operationType: text('operation_type').notNull(),
    // Phase 7: positive for deductions, negative for credits (e.g. on cancel);
    // 0 for payment-recorded entries with no session count.
    sessionsDeducted: integer('sessions_deducted').notNull().default(0),
    // Phase 8+: nullable — set when the ledger entry is tied to a specific
    // booking (session deduction on booking confirmation).
    bookingId: integer('booking_id').references(() => bookings.id),
    // Nullable: human-readable audit note (e.g. 'Admin adjustment').
    reason: text('reason'),
    // Phase 7 (D-11): UNIQUE inline constraint prevents duplicate INSERT on
    // webhook replay. Ledger is append-only — no UPDATE ever issued.
    idempotencyKey: text('idempotency_key').notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  }
);

// --- Phase 9: Membership Expiry Notification Dedup ---
// membershipExpiryNotifications: dedup table that prevents double-sending
// 7-day expiry warnings (NOTF-03). One row per (membership, recipient, date).

export const membershipExpiryNotifications = pgTable(
  'membership_expiry_notifications',
  {
    id: serial('id').primaryKey(),
    membershipId: integer('membership_id')
      .notNull()
      .references(() => memberships.id),
    // Phase 9 (D-05): '7_day_client' or '7_day_owner' — per-recipient dedup
    // granularity so client and owner notifications succeed/fail independently.
    notificationType: text('notification_type').notNull(),
    // Phase 9 (NOTF-03): ISO "YYYY-MM-DD" Athens calendar date produced by
    // isoDateInAthens(). Stored as text to match memberships.purchaseDate
    // convention and avoid timezone drift in timestamp comparisons.
    expiryDate: text('expiry_date').notNull(),
    sentAt: timestamp('sent_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    // NOTF-03: UNIQUE on (membership_id, notification_type, expiry_date)
    // enforces at-most-one notification per membership per recipient per expiry
    // event at DB level. No partial WHERE clause — dedup must be absolute
    // (unlike billingPackages partial index that carves out soft-deleted rows).
    uniqueIndex('unique_membership_expiry_notification').on(
      table.membershipId,
      table.notificationType,
      table.expiryDate
    ),
  ]
);
