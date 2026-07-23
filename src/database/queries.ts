import { AsyncLocalStorage } from 'async_hooks';
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db, appDb } from './db';
import {
  businesses,
  clientBusinessRelationships,
  messages,
  services,
  businessHours,
  bookings,
  conversationTurns,
  telegramUpdates,
} from './schema';

// Thread the current Drizzle transaction through the call stack transparently.
// Within withBusinessContext, queries use the appDb transaction (RLS enforced).
// Outside withBusinessContext (pollers, routing lookups), queries fall back to
// admin db (superuser) which bypasses RLS — this is intentional for cross-tenant ops.
const currentTx = new AsyncLocalStorage<typeof db>();

export function getConn(): typeof db {
  return currentTx.getStore() ?? db;
}

export interface Business {
  id: number;
  name: string;
  slug: string;
  phoneNumberId: string | null;
  ownerTelegramId: string | null;
  googleRefreshToken: string | null;
  agendaSentDate: string | null;
  botToken: string | null;
  webhookId: string | null;
  webhookSecret: string | null;
  /** Phase 8 (D-07): 'allow' | 'block' | 'flag' — controls booking-engine behaviour when client has no active membership. */
  enforcementPolicy: string;
  /** Phase 12 (CANC-01): whether the cancellation cutoff window is active. */
  cancellationCutoffEnabled: boolean;
  /** Phase 12 (CANC-01): hours before session at which credit forfeiture kicks in. */
  cancellationCutoffHours: number;
  createdAt: Date;
}

export interface ClientBusinessRelationship {
  id: number;
  businessId: number;
  senderPhone: string;
  /** Phase 7 (D-04): captured from Telegram from.first_name, upserted on every message. */
  clientName: string | null;
  consentGiven: boolean;
  consentTimestamp: Date;
  createdAt: Date;
}

export async function findBusinessBySlug(slug: string): Promise<Business | null> {
  const rows = await getConn()
    .select()
    .from(businesses)
    .where(eq(businesses.slug, slug))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Pre-auth routing lookup. Uses admin db (bypasses businesses SELECT RLS) because
 * businessId is not yet known at this call site. Only called in src/webhooks/telegram.ts
 * before withBusinessContext is entered.
 */
export async function findBusinessByWebhookId(webhookId: string): Promise<Business | null> {
  const rows = await db
    .select()
    .from(businesses)
    .where(eq(businesses.webhookId, webhookId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Opens an appDb transaction, sets SET LOCAL app.current_business_id, and runs callback
 * with the transaction threaded via AsyncLocalStorage (D-10). All query functions that
 * use getConn() inside this context automatically see the RLS-enforced transaction.
 */
export async function withBusinessContext<T>(
  businessId: string | number,
  callback: () => Promise<T>
): Promise<T> {
  return appDb.transaction(async (tx) => {
    // WR-03: use set_config() via parameterized sql template instead of sql.raw() with string
    // interpolation. sql.raw() on the RLS bootstrap path is fragile — if businessId is NaN
    // (e.g. Number() on a non-numeric value), the SET statement silently sets 'NaN' and all
    // queries in the transaction return empty results. set_config() with a parameterized binding
    // avoids this and is immune to injection on the security-critical RLS configuration path.
    await tx.execute(
      sql`SELECT set_config('app.current_business_id', ${String(Number(businessId))}, true)`
    );
    return currentTx.run(tx as unknown as typeof db, callback);
  });
}

export async function insertOrIgnoreMessage(
  whatsappMessageId: string,
  businessId: number,
  senderPhone: string,
  messageBody: string
): Promise<'inserted' | 'ignored'> {
  const result = await getConn()
    .insert(messages)
    .values({
      whatsappMessageId,
      businessId,
      senderPhone,
      messageBody,
      status: 'received',
    })
    .onConflictDoNothing()
    .returning({ id: messages.id });

  return result.length > 0 ? 'inserted' : 'ignored';
}

export async function markMessageProcessed(whatsappMessageId: string): Promise<void> {
  await getConn()
    .update(messages)
    .set({ status: 'processed' })
    .where(eq(messages.whatsappMessageId, whatsappMessageId));
}

export async function findLatestBusinessForClient(
  senderPhone: string
): Promise<Business | null> {
  const rows = await getConn()
    .select({ business: businesses })
    .from(clientBusinessRelationships)
    .innerJoin(businesses, eq(clientBusinessRelationships.businessId, businesses.id))
    .where(eq(clientBusinessRelationships.senderPhone, senderPhone))
    .orderBy(desc(clientBusinessRelationships.createdAt))
    .limit(1);

  return rows[0]?.business ?? null;
}

/**
 * Looks up a client–business relationship row by its primary key (id).
 * Used by payment-flow.ts handlers to resolve clientPhone from a
 * clientBusinessRelationshipId stored in callback_data.
 * Uses getConn() so the query respects any active withBusinessContext (T-07-03).
 */
export async function findClientBusinessRelationshipById(
  id: number
): Promise<ClientBusinessRelationship | null> {
  const rows = await getConn()
    .select()
    .from(clientBusinessRelationships)
    .where(eq(clientBusinessRelationships.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function findClientBusinessRelationship(
  businessId: number,
  senderPhone: string
): Promise<ClientBusinessRelationship | null> {
  const rows = await getConn()
    .select()
    .from(clientBusinessRelationships)
    .where(
      and(
        eq(clientBusinessRelationships.businessId, businessId),
        eq(clientBusinessRelationships.senderPhone, senderPhone)
      )
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Upserts the client–business relationship row.
 *
 * D-04: clientName is upserted (not skipped) on every call so the stored
 * value always reflects the latest Telegram from.first_name. Callers pass
 * undefined when the name is unavailable; onConflictDoUpdate then stores null,
 * which is correct — the field is nullable.
 *
 * The consentTimestamp is refreshed on every upsert to record the most recent
 * contact time. onConflictDoUpdate eliminates the prior check-then-insert
 * race (CR-01) — a single atomic upsert always returns a row.
 */
export async function insertClientBusinessRelationship(
  businessId: number,
  senderPhone: string,
  clientName?: string
): Promise<ClientBusinessRelationship> {
  const rows = await getConn()
    .insert(clientBusinessRelationships)
    .values({
      businessId,
      senderPhone,
      clientName,
      consentGiven: true,
      consentTimestamp: new Date(),
    })
    .onConflictDoUpdate({
      target: [clientBusinessRelationships.businessId, clientBusinessRelationships.senderPhone],
      // D-04: always upsert clientName to reflect the latest Telegram display name
      set: { clientName, consentTimestamp: new Date() },
    })
    .returning();

  return rows[0];
}

export async function findMessageByWhatsappId(
  whatsappMessageId: string
): Promise<{ id: number } | null> {
  const rows = await getConn()
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.whatsappMessageId, whatsappMessageId))
    .limit(1);
  return rows[0] ?? null;
}

// --- Phase 2: AI Booking Conversations & Owner Alerts ---

export interface Service {
  id: number;
  businessId: number;
  name: string;
  durationMin: number;
  price: number | null;
  createdAt: Date;
}

export interface BusinessHours {
  id: number;
  businessId: number;
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  openTime2: string | null;
  closeTime2: string | null;
  isClosed: boolean;
  createdAt: Date;
}

export interface Booking {
  id: number;
  businessId: number;
  clientPhone: string;
  serviceId: number;
  calendarDate: string;
  calendarTime: string;
  bookingStatus: string;
  requestId: string;
  ownerTelegramMessageId: number | null;
  rescheduledFromBookingId: number | null;
  calendarSyncStatus: string;
  googleCalendarEventId: string | null;
  calendarSyncRetryCount: number;
  reminder24hSentAt: Date | null;
  reminder1hSentAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface ConversationTurn {
  id: number;
  businessId: number;
  clientPhone: string;
  interactionId: string | null;
  requestId: string;
  messageText: string;
  responseText: string;
  toolCalls: string | null;
  createdAt: Date;
}

export interface BookingSlot {
  calendarTime: string;
  durationMin: number;
  bookingId: number;
}

export async function listServicesForBusiness(businessId: number): Promise<Service[]> {
  return getConn().select().from(services).where(eq(services.businessId, businessId));
}

export async function findServiceById(
  businessId: number,
  serviceId: number
): Promise<Service | null> {
  const rows = await getConn()
    .select()
    .from(services)
    .where(and(eq(services.businessId, businessId), eq(services.id, serviceId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listBusinessHours(businessId: number): Promise<BusinessHours[]> {
  return getConn().select().from(businessHours).where(eq(businessHours.businessId, businessId));
}

export async function findBusinessHoursForDay(
  businessId: number,
  dayOfWeek: number
): Promise<BusinessHours | null> {
  const rows = await getConn()
    .select()
    .from(businessHours)
    .where(
      and(eq(businessHours.businessId, businessId), eq(businessHours.dayOfWeek, dayOfWeek))
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function findActiveBookingSlotsForDate(
  businessId: number,
  calendarDate: string
): Promise<BookingSlot[]> {
  // JOIN each active booking to ITS OWN service durationMin — never assume the
  // caller's requested duration applies to existing rows (fixes the
  // "assume all bookings are durationMin" bug present in 02-RESEARCH.md's
  // pseudocode).
  return getConn()
    .select({
      calendarTime: bookings.calendarTime,
      durationMin: services.durationMin,
      bookingId: bookings.id,
    })
    .from(bookings)
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .where(
      and(
        eq(bookings.businessId, businessId),
        eq(bookings.calendarDate, calendarDate),
        inArray(bookings.bookingStatus, ['pending_owner_approval', 'confirmed'])
      )
    );
}

export async function insertBooking(values: {
  businessId: number;
  clientPhone: string;
  serviceId: number;
  calendarDate: string;
  calendarTime: string;
  requestId: string;
  expiresAt: Date;
  rescheduledFromBookingId?: number;
}): Promise<Booking | null> {
  // Does NOT try to distinguish which of the two unique indexes
  // (unique_active_slot_per_business vs unique_request_per_client) caused a
  // conflict — that disambiguation (check findBookingByRequestId first, then
  // insert) belongs to Plan 02-04's orchestration layer, not this query layer.
  const result = await getConn()
    .insert(bookings)
    .values({
      businessId: values.businessId,
      clientPhone: values.clientPhone,
      serviceId: values.serviceId,
      calendarDate: values.calendarDate,
      calendarTime: values.calendarTime,
      requestId: values.requestId,
      expiresAt: values.expiresAt,
      rescheduledFromBookingId: values.rescheduledFromBookingId,
    })
    .onConflictDoNothing()
    .returning();

  return result[0] ?? null;
}

export async function findBookingByRequestId(
  clientPhone: string,
  requestId: string
): Promise<Booking | null> {
  const rows = await getConn()
    .select()
    .from(bookings)
    .where(and(eq(bookings.clientPhone, clientPhone), eq(bookings.requestId, requestId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function findBookingById(
  businessId: number,
  bookingId: number
): Promise<Booking | null> {
  const rows = await getConn()
    .select()
    .from(bookings)
    .where(and(eq(bookings.businessId, businessId), eq(bookings.id, bookingId)))
    .limit(1);
  return rows[0] ?? null;
}

// Intentionally unscoped by business (T-02-20 in Plan 02-05's threat model) —
// ONLY for the callback_query owner-identity-verification path in
// src/webhooks/telegram.ts, which immediately re-derives and checks business
// ownership before any mutation. Never call this from any client-facing code
// path.
export async function findBookingByIdUnscoped(bookingId: number): Promise<Booking | null> {
  const rows = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  return rows[0] ?? null;
}

export async function findBusinessById(businessId: number): Promise<Business | null> {
  const rows = await getConn()
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Updates the cancellation cutoff settings for a business.
 * Called from handleSetCancellationCutoff inside withBusinessContext — RLS is
 * already active at call time, so getConn() is correct here.
 */
export async function setCancellationCutoff(
  businessId: number,
  enabled: boolean,
  hours: number
): Promise<void> {
  await getConn()
    .update(businesses)
    .set({ cancellationCutoffEnabled: enabled, cancellationCutoffHours: hours })
    .where(eq(businesses.id, businessId));
}

export async function listAllBusinessIds(): Promise<number[]> {
  const rows = await db.select({ id: businesses.id }).from(businesses);
  return rows.map((row) => row.id);
}

export async function updateBookingStatus(bookingId: number, status: string): Promise<void> {
  await getConn().update(bookings).set({ bookingStatus: status }).where(eq(bookings.id, bookingId));
}

// WR-05 gap closure: the WHERE clause here IS the concurrency guard. Of two
// near-simultaneous callers racing to transition the same booking (a
// double-tap, or Telegram redelivering the same callback_query), only the
// first to reach Postgres finds a row still `pending_owner_approval` and
// gets it back; the second's WHERE clause matches zero rows and this
// returns null, telling the caller "someone else already resolved this" —
// with no read-then-write gap for both to slip through.
export async function updateBookingStatusIfPending(
  bookingId: number,
  newStatus: string
): Promise<Booking | null> {
  const rows = await getConn()
    .update(bookings)
    .set({ bookingStatus: newStatus })
    .where(and(eq(bookings.id, bookingId), eq(bookings.bookingStatus, 'pending_owner_approval')))
    .returning();
  return rows[0] ?? null;
}

export async function updateBookingOwnerMessageId(
  bookingId: number,
  telegramMessageId: number
): Promise<void> {
  await getConn()
    .update(bookings)
    .set({ ownerTelegramMessageId: telegramMessageId })
    .where(eq(bookings.id, bookingId));
}

export async function expireStalePendingBookings(
  businessId: number,
  cutoffMs: number
): Promise<Booking[]> {
  // Cutoff is computed in application code (new Date(Date.now() - cutoffMs)),
  // not a Postgres NOW() - INTERVAL expression, keeping expiry timing entirely
  // in JS for testability (no server-timezone dependency).
  return db
    .update(bookings)
    .set({ bookingStatus: 'expired' })
    .where(
      and(
        eq(bookings.businessId, businessId),
        eq(bookings.bookingStatus, 'pending_owner_approval'),
        lt(bookings.createdAt, new Date(Date.now() - cutoffMs))
      )
    )
    .returning();
}

export async function findLatestConversationTurn(
  businessId: number,
  clientPhone: string
): Promise<ConversationTurn | null> {
  const rows = await getConn()
    .select()
    .from(conversationTurns)
    .where(
      and(
        eq(conversationTurns.businessId, businessId),
        eq(conversationTurns.clientPhone, clientPhone)
      )
    )
    .orderBy(desc(conversationTurns.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function insertConversationTurn(values: {
  businessId: number;
  clientPhone: string;
  interactionId: string | null;
  requestId: string;
  messageText: string;
  responseText: string;
  toolCalls: string | null;
}): Promise<ConversationTurn> {
  const rows = await getConn().insert(conversationTurns).values(values).returning();
  if (!rows[0]) throw new Error('insertConversationTurn: INSERT returned no row — constraint violation or trigger?');
  return rows[0];
}

export async function insertOrIgnoreTelegramUpdate(
  updateId: string,
  businessId: number | null,
  senderTelegramId: string,
  updateType: 'message' | 'callback_query'
): Promise<'inserted' | 'ignored'> {
  const result = await getConn()
    .insert(telegramUpdates)
    .values({
      updateId,
      businessId,
      senderTelegramId,
      updateType,
      status: 'received',
    })
    .onConflictDoNothing()
    .returning({ id: telegramUpdates.id });

  return result.length > 0 ? 'inserted' : 'ignored';
}

export async function findTelegramUpdateById(
  updateId: string
): Promise<{ id: number } | null> {
  const rows = await db
    .select({ id: telegramUpdates.id })
    .from(telegramUpdates)
    .where(eq(telegramUpdates.updateId, updateId))
    .limit(1);
  return rows[0] ?? null;
}

export async function markTelegramUpdateProcessed(
  updateId: string,
  businessId: number
): Promise<void> {
  await getConn()
    .update(telegramUpdates)
    .set({ status: 'processed', businessId })
    .where(eq(telegramUpdates.updateId, updateId));
}

// --- Phase 3: Calendar Sync, Agenda & Reminders ---

export async function updateBusinessGoogleRefreshToken(
  businessId: number,
  refreshToken: string
): Promise<void> {
  await db
    .update(businesses)
    .set({ googleRefreshToken: refreshToken })
    .where(eq(businesses.id, businessId));
}

// Atomic: true iff THIS call transitioned agendaSentDate to todayIso. The
// or(isNull(...), lt(...)) guard IS the concurrency control — a second
// concurrent call for the same business/day finds zero matching rows (its
// own prior call already advanced agendaSentDate to todayIso, which is
// neither null nor < todayIso anymore). Closes RESEARCH.md Pitfall 5.
export async function claimAgendaSlot(businessId: number, todayIso: string): Promise<boolean> {
  const rows = await db
    .update(businesses)
    .set({ agendaSentDate: todayIso })
    .where(
      and(
        eq(businesses.id, businessId),
        or(isNull(businesses.agendaSentDate), lt(businesses.agendaSentDate, todayIso))
      )
    )
    .returning({ id: businesses.id });
  return rows.length > 0;
}

export async function updateCalendarSyncStatus(
  bookingId: number,
  status: 'pending' | 'synced' | 'failed'
): Promise<void> {
  await db
    .update(bookings)
    .set({ calendarSyncStatus: status })
    .where(eq(bookings.id, bookingId));
}

export async function updateBookingGoogleEventId(
  bookingId: number,
  eventId: string
): Promise<void> {
  await db
    .update(bookings)
    .set({ googleCalendarEventId: eventId })
    .where(eq(bookings.id, bookingId));
}

// Returns the NEW count after incrementing (reads the value back rather than
// just firing the UPDATE), so the retry poller can compare it against a
// max-retry threshold without a separate read.
export async function incrementCalendarSyncRetryCount(bookingId: number): Promise<number> {
  const rows = await db
    .update(bookings)
    .set({ calendarSyncRetryCount: sql`${bookings.calendarSyncRetryCount} + 1` })
    .where(eq(bookings.id, bookingId))
    .returning({ calendarSyncRetryCount: bookings.calendarSyncRetryCount });
  return rows[0]?.calendarSyncRetryCount ?? 0;
}

export async function listClientBookings(
  businessId: number,
  clientPhone: string
): Promise<Booking[]> {
  return getConn()
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.businessId, businessId),
        eq(bookings.clientPhone, clientPhone),
        inArray(bookings.bookingStatus, ['pending_owner_approval', 'confirmed'])
      )
    )
    .orderBy(bookings.calendarDate, bookings.calendarTime);
}

export async function findBookingsNeedingCalendarSync(businessId: number): Promise<Booking[]> {
  return db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.businessId, businessId),
        eq(bookings.calendarSyncStatus, 'pending'),
        inArray(bookings.bookingStatus, ['confirmed', 'cancelled'])
      )
    );
}

export async function listBookingsForDate(
  businessId: number,
  calendarDate: string,
  statuses: string[] = ['confirmed']
): Promise<Booking[]> {
  return db
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

export async function findBookingsNeedingReminder(
  businessId: number,
  calendarDates: string[]
): Promise<Booking[]> {
  return db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.businessId, businessId),
        eq(bookings.bookingStatus, 'confirmed'),
        inArray(bookings.calendarDate, calendarDates),
        or(isNull(bookings.reminder24hSentAt), isNull(bookings.reminder1hSentAt))
      )
    );
}

// Atomic: true iff THIS call set reminder24hSentAt (Pitfall 3 — closes the
// sent-state idempotency bypass a status-based query would be vulnerable to).
export async function claimReminder24hSlot(bookingId: number): Promise<boolean> {
  const rows = await db
    .update(bookings)
    .set({ reminder24hSentAt: new Date() })
    .where(and(eq(bookings.id, bookingId), isNull(bookings.reminder24hSentAt)))
    .returning({ id: bookings.id });
  return rows.length > 0;
}

// Atomic: true iff THIS call set reminder1hSentAt. Independent of
// claimReminder24hSlot — claiming one never claims the other.
export async function claimReminder1hSlot(bookingId: number): Promise<boolean> {
  const rows = await db
    .update(bookings)
    .set({ reminder1hSentAt: new Date() })
    .where(and(eq(bookings.id, bookingId), isNull(bookings.reminder1hSentAt)))
    .returning({ id: bookings.id });
  return rows.length > 0;
}
