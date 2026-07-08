import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { db } from './db';
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

export interface Business {
  id: number;
  name: string;
  slug: string;
  phoneNumberId: string | null;
  ownerTelegramId: string | null;
  createdAt: Date;
}

export interface ClientBusinessRelationship {
  id: number;
  businessId: number;
  senderPhone: string;
  consentGiven: boolean;
  consentTimestamp: Date;
  createdAt: Date;
}

export async function findBusinessBySlug(slug: string): Promise<Business | null> {
  const rows = await db
    .select()
    .from(businesses)
    .where(eq(businesses.slug, slug))
    .limit(1);

  return rows[0] ?? null;
}

export async function insertOrIgnoreMessage(
  whatsappMessageId: string,
  businessId: number,
  senderPhone: string,
  messageBody: string
): Promise<'inserted' | 'ignored'> {
  const result = await db
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
  await db
    .update(messages)
    .set({ status: 'processed' })
    .where(eq(messages.whatsappMessageId, whatsappMessageId));
}

export async function findClientBusinessRelationship(
  businessId: number,
  senderPhone: string
): Promise<ClientBusinessRelationship | null> {
  const rows = await db
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

export async function insertClientBusinessRelationship(
  businessId: number,
  senderPhone: string
): Promise<ClientBusinessRelationship> {
  // onConflictDoNothing guards the unique_client_business index (schema.ts)
  // against the check-then-insert race in getOrCreateClientRelationship
  // (checker.ts): if a concurrent request already inserted the row, this
  // insert is a no-op (rows[0] undefined) and we re-fetch the winning row
  // instead of throwing an uncaught unique-violation error (CR-01).
  const rows = await db
    .insert(clientBusinessRelationships)
    .values({
      businessId,
      senderPhone,
      consentGiven: true,
      consentTimestamp: new Date(),
    })
    .onConflictDoNothing()
    .returning();

  if (rows[0]) return rows[0];

  const existing = await findClientBusinessRelationship(businessId, senderPhone);
  if (!existing) throw new Error('Failed to read client relationship after conflict');
  return existing;
}

export async function findMessageByWhatsappId(
  whatsappMessageId: string
): Promise<{ id: number } | null> {
  const rows = await db
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
  return db.select().from(services).where(eq(services.businessId, businessId));
}

export async function findServiceById(
  businessId: number,
  serviceId: number
): Promise<Service | null> {
  const rows = await db
    .select()
    .from(services)
    .where(and(eq(services.businessId, businessId), eq(services.id, serviceId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listBusinessHours(businessId: number): Promise<BusinessHours[]> {
  return db.select().from(businessHours).where(eq(businessHours.businessId, businessId));
}

export async function findBusinessHoursForDay(
  businessId: number,
  dayOfWeek: number
): Promise<BusinessHours | null> {
  const rows = await db
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
  return db
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
  const result = await db
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
  const rows = await db
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
  const rows = await db
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
  const rows = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  return rows[0] ?? null;
}

export async function listAllBusinessIds(): Promise<number[]> {
  const rows = await db.select({ id: businesses.id }).from(businesses);
  return rows.map((row) => row.id);
}

export async function updateBookingStatus(bookingId: number, status: string): Promise<void> {
  await db.update(bookings).set({ bookingStatus: status }).where(eq(bookings.id, bookingId));
}

export async function updateBookingOwnerMessageId(
  bookingId: number,
  telegramMessageId: number
): Promise<void> {
  await db
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
  const rows = await db
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
  const rows = await db.insert(conversationTurns).values(values).returning();
  return rows[0];
}

export async function insertOrIgnoreTelegramUpdate(
  updateId: string,
  businessId: number | null,
  senderTelegramId: string,
  updateType: 'message' | 'callback_query'
): Promise<'inserted' | 'ignored'> {
  const result = await db
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
  await db
    .update(telegramUpdates)
    .set({ status: 'processed', businessId })
    .where(eq(telegramUpdates.updateId, updateId));
}
