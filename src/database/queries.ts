import { AsyncLocalStorage } from 'async_hooks';
import { and, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { db, appPool, runInTransaction, withConnectionRetry } from './db';
import { logger } from '../utils/logger';
import {
  businesses,
  clientBusinessRelationships,
  services,
  businessHours,
  bookings,
  conversationTurns,
  conversationMemory,
  telegramUpdates,
  slotlessRequests,
  googleOauthStates,
} from './schema';

// Thread the current Drizzle transaction through the call stack transparently.
// Within withBusinessContext, queries use the appDb transaction (RLS enforced).
// Outside withBusinessContext (pollers, routing lookups), queries fall back to
// admin db (superuser) which bypasses RLS — this is intentional for cross-tenant ops.
const currentTx = new AsyncLocalStorage<typeof db>();

export function getConn(): typeof db {
  return currentTx.getStore() ?? db;
}

/**
 * WR-02: true when called from inside an already-open withBusinessContext
 * transaction. Lets a helper that may be invoked either standalone (e.g. the
 * AI-agent tool-call path, deliberately outside any transaction — WR-04) or
 * nested inside an already-open dispatch transaction (e.g. telegram.ts's
 * outer withBusinessContext wrapping handleCallbackQuery) decide whether
 * opening its own withBusinessContext would check out a second, unnecessary
 * DB connection (runInTransaction always calls pool.connect() regardless of
 * any already-open transaction) while the outer one sits idle-in-transaction
 * — the same "holding a connection open while other work happens" pattern
 * documented elsewhere in this file as the root cause of prior incidents
 * (webhook-hang-no-reply, query-read-timeout-storm).
 */
export function isInBusinessContext(): boolean {
  return currentTx.getStore() !== undefined;
}

/**
 * Runs `fn` such that a failure inside it can never poison the caller's
 * surrounding transaction.
 *
 * Inside withBusinessContext a failed statement puts the whole Postgres
 * transaction into the aborted state (every later statement errors with
 * "current transaction is aborted"), so best-effort side work — here, the
 * conversation-memory reads/writes — runs inside a SAVEPOINT (drizzle's nested
 * `transaction()`), which is rolled back on error while the outer transaction
 * stays healthy. Outside withBusinessContext (admin connection, autocommit)
 * there is nothing to protect, so `fn` runs directly (avoiding a second
 * pool.connect(), see runInTransaction in db.ts).
 */
export async function runIsolated<T>(fn: (conn: typeof db) => Promise<T>): Promise<T> {
  if (isInBusinessContext()) {
    return getConn().transaction(async (sp) => fn(sp as unknown as typeof db));
  }
  return fn(getConn());
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
  /** Phase 10 (CLSS-01): 'open_slots' | 'fixed_sessions' — determines which booking tools Gemini uses. */
  bookingMode: string;
  /** Phase 11 (SBOK-04): when true, clients may book multiple session instances in a single book_session call. */
  allowMultiBooking: boolean;
  /** Phase 12 (CANC-01): whether the cancellation cutoff window is active. */
  cancellationCutoffEnabled: boolean;
  /** Phase 12 (CANC-01): hours before session at which credit forfeiture kicks in. */
  cancellationCutoffHours: number;
  /** Phase 13 (SLOT-01): when true, clients can submit slotless booking requests instead of receiving a 'no slots available' error. */
  slotlessRequestsEnabled: boolean;
  /** Phase 14 (RENW-01): when true, low-session-count renewal nudges are sent to clients. */
  lastSessionThresholdEnabled: boolean;
  /** Phase 14 (RENW-01): sessions remaining count that triggers the renewal nudge. */
  lastSessionThresholdCount: number;
  /** Phase 16 (ARCH-01): when false, admin messages are routed to the onboarding state machine; true once owner completes setup. */
  onboardingCompleted: boolean;
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
  const rows = await withConnectionRetry(() =>
    db.select().from(businesses).where(eq(businesses.webhookId, webhookId)).limit(1)
  );
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
  // Debug (webhook-hang-no-reply): this opens a real DB transaction
  // (appDb.transaction, now via runInTransaction) and every getConn() query
  // inside `callback` runs through it. The pg Pool previously had no
  // statement_timeout/query_timeout (see db.ts) — an unbounded query or a
  // held lock here would hang the webhook handler exactly like the unbounded
  // Gemini call did. Logging entry/exit with elapsed time so a future
  // occurrence can show whether the hang is here (DB) or downstream
  // (Gemini/Telegram API).
  //
  // Debug (query-read-timeout-storm): uses runInTransaction(appPool, ...)
  // instead of appDb.transaction(...) directly — drizzle-orm's own
  // transaction() leaks the checked-out client if the initial 'begin'
  // statement itself rejects (e.g. a client-side query_timeout during a
  // Neon cold start), since its release-on-finally doesn't cover that first
  // statement. runInTransaction checks out the client itself and guarantees
  // release in all cases. See src/database/db.ts and the resolved debug
  // session for the full root-cause writeup.
  const startedAt = Date.now();
  logger.info({ businessId }, 'withBusinessContext: entry (opening transaction)');
  try {
    const result = await runInTransaction(appPool, async (tx) => {
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
    logger.info(
      { businessId, elapsedMs: Date.now() - startedAt },
      'withBusinessContext: exit (transaction committed)'
    );
    return result;
  } catch (err) {
    logger.error(
      { err, businessId, elapsedMs: Date.now() - startedAt },
      'withBusinessContext: transaction failed/rolled back'
    );
    throw err;
  }
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
 *
 * Phase 27 (COMP-01/COMP-02, D-01): a brand-new row starts unconsented.
 * `consentGiven: false` is set explicitly on INSERT (not left to the
 * column's DB default from migration 0013) — code review CR-01: relying
 * purely on the DB default would silently reopen the gate if app code ever
 * deploys ahead of the migration (rolling deploy, delayed/failed migration
 * step, unmigrated preview env), with no error or log signal. The
 * onConflictDoUpdate SET clause still excludes consentGiven (unchanged), so
 * a racing/repeat first-contact upsert can never reset an already-accepted
 * consent back to false (PITFALLS.md Pitfall 3).
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
      consentGiven: false,
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

/**
 * Phase 27 (COMP-01/COMP-02, D-01): records the client's decision on the
 * hard consent gate. Called by Plan 27-02's `consent:yes`/`consent:no`
 * callback handler. Scoped UPDATE on the matching (businessId, senderPhone)
 * row; refreshes consentTimestamp to the actual acceptance/decline moment
 * (distinct from the first-contact insert timestamp).
 */
export async function updateClientConsentGiven(
  businessId: number,
  senderPhone: string,
  consentGiven: boolean
): Promise<void> {
  await getConn()
    .update(clientBusinessRelationships)
    .set({ consentGiven, consentTimestamp: new Date() })
    .where(
      and(
        eq(clientBusinessRelationships.businessId, businessId),
        eq(clientBusinessRelationships.senderPhone, senderPhone)
      )
    );
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
  /** Phase 10 (CLSS-01): set when the booking is for a fixed session instance; null for open-slot bookings. */
  sessionInstanceId: number | null;
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

/**
 * Phase 23 (CLSS-07): returns all active (confirmed / pending_owner_approval)
 * bookings tied to a given session instance, scoped to businessId. Used by
 * cascadeCancelSessionBookings to find every booking that must be flipped to
 * 'cancelled' when the owner deletes/cancels the underlying lesson.
 *
 * Deliberately does NOT join clientBusinessRelationships (T-23-01): a booking
 * created via assign_client_to_session can exist with no prior relationship
 * row, and an INNER JOIN would silently exclude it from cascade-cancellation,
 * leaking an un-refunded, un-released booking. businessId is part of the
 * WHERE clause (not re-derived), so an instance belonging to another business
 * can never leak bookings here.
 */
export async function findActiveBookingsForSessionInstance(
  businessId: number,
  sessionInstanceId: number
): Promise<Booking[]> {
  return getConn()
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.businessId, businessId),
        eq(bookings.sessionInstanceId, sessionInstanceId),
        inArray(bookings.bookingStatus, ['confirmed', 'pending_owner_approval'])
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

/**
 * Phase 15 (CONF-05): owner booking mode switch. Uses admin db (not getConn) —
 * booking mode is an owner config update, not a client-scoped RLS operation.
 */
export async function setBookingMode(businessId: number, mode: string): Promise<void> {
  await db
    .update(businesses)
    .set({ bookingMode: mode })
    .where(eq(businesses.id, businessId));
}

export async function listAllBusinessIds(): Promise<number[]> {
  const rows = await withConnectionRetry(() => db.select({ id: businesses.id }).from(businesses));
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

// ---------------------------------------------------------------------------
// Unified conversation memory (debug: bot-loses-conversation-memory)
// ---------------------------------------------------------------------------

export type ConversationAgentRole = 'client' | 'owner' | 'onboarding';

export interface ConversationMemoryRow {
  id: number;
  businessId: number;
  agentRole: string;
  participantId: string;
  interactionId: string | null;
  summary: string | null;
  contextTokens: number;
  chainTurns: number;
  /** JSON array of {u, a, at}; parsed/bounded by src/conversation/memory.ts. */
  recentExchanges: string | null;
  lastActiveAt: Date;
  createdAt: Date;
}

export interface ConversationMemoryValues {
  interactionId: string | null;
  summary: string | null;
  contextTokens: number;
  chainTurns: number;
  recentExchanges: string | null;
  lastActiveAt: Date;
}

// `conn` defaults to getConn() (RLS-scoped transaction inside
// withBusinessContext, admin connection outside it). Every query is filtered by
// the explicit (businessId, agentRole, participantId) key so the admin-connection
// path (owner/onboarding agents run outside any transaction) stays tenant-scoped.
export async function findConversationMemory(
  businessId: number,
  agentRole: ConversationAgentRole,
  participantId: string,
  conn: typeof db = getConn()
): Promise<ConversationMemoryRow | null> {
  const rows = await conn
    .select()
    .from(conversationMemory)
    .where(
      and(
        eq(conversationMemory.businessId, businessId),
        eq(conversationMemory.agentRole, agentRole),
        eq(conversationMemory.participantId, participantId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertConversationMemory(
  businessId: number,
  agentRole: ConversationAgentRole,
  participantId: string,
  values: ConversationMemoryValues,
  conn: typeof db = getConn()
): Promise<void> {
  await conn
    .insert(conversationMemory)
    .values({ businessId, agentRole, participantId, ...values })
    .onConflictDoUpdate({
      target: [conversationMemory.businessId, conversationMemory.agentRole, conversationMemory.participantId],
      set: values,
    });
}

/** Erases a participant's memory (all roles when agentRole is omitted). */
export async function deleteConversationMemory(
  businessId: number,
  participantId: string,
  agentRole?: ConversationAgentRole,
  conn: typeof db = getConn()
): Promise<void> {
  await conn
    .delete(conversationMemory)
    .where(
      and(
        eq(conversationMemory.businessId, businessId),
        eq(conversationMemory.participantId, participantId),
        agentRole ? eq(conversationMemory.agentRole, agentRole) : undefined
      )
    );
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
  refreshToken: string | null
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

// Phase 25.1 (T-25.1-07): the three calendar status writes below use getConn()
// instead of the admin db. Inside a webhook callback the booking row is already
// locked by the open withBusinessContext transaction; a write through the
// separate admin pool would wait on that lock (self-deadlock until
// statement_timeout). getConn() joins the transaction and falls back to the
// admin pool outside it (pollers).
export async function updateCalendarSyncStatus(
  bookingId: number,
  status: 'pending' | 'synced' | 'failed'
): Promise<void> {
  await getConn()
    .update(bookings)
    .set({ calendarSyncStatus: status })
    .where(eq(bookings.id, bookingId));
}

export async function updateBookingGoogleEventId(
  bookingId: number,
  eventId: string
): Promise<void> {
  await getConn()
    .update(bookings)
    .set({ googleCalendarEventId: eventId })
    .where(eq(bookings.id, bookingId));
}

// Returns the NEW count after incrementing (reads the value back rather than
// just firing the UPDATE), so the retry poller can compare it against a
// max-retry threshold without a separate read.
export async function incrementCalendarSyncRetryCount(bookingId: number): Promise<number> {
  const rows = await getConn()
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

export const CALENDAR_SYNC_BATCH_LIMIT = 50;

// Phase 25.1 (D-05/D-16, T-25.1-12): bounded sweep. Past confirmed bookings are
// never back-filled and cancelled rows that never got a Google event need no
// delete, so the first live connection cannot flood Google Calendar (Phase 3
// D-16 quota reasoning, T-03-06).
export async function findBookingsNeedingCalendarSync(
  businessId: number,
  todayIso: string,
  limit: number = CALENDAR_SYNC_BATCH_LIMIT
): Promise<Booking[]> {
  return db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.businessId, businessId),
        eq(bookings.calendarSyncStatus, 'pending'),
        or(
          and(eq(bookings.bookingStatus, 'confirmed'), gte(bookings.calendarDate, todayIso)),
          and(
            eq(bookings.bookingStatus, 'cancelled'),
            isNotNull(bookings.googleCalendarEventId)
          )
        )
      )
    )
    .orderBy(bookings.calendarDate, bookings.id)
    .limit(limit);
}

// Phase 25.1 (D-06): atomic one-time nudge claim. true iff THIS call flipped
// google_calendar_nudge_sent false -> true, so exactly one caller wins.
export async function claimGoogleCalendarNudge(businessId: number): Promise<boolean> {
  const rows = await db
    .update(businesses)
    .set({ googleCalendarNudgeSent: true })
    .where(and(eq(businesses.id, businessId), eq(businesses.googleCalendarNudgeSent, false)))
    .returning({ id: businesses.id });
  return rows.length > 0;
}

// Releases the claim when the nudge message could not be delivered.
export async function releaseGoogleCalendarNudgeClaim(businessId: number): Promise<void> {
  await db
    .update(businesses)
    .set({ googleCalendarNudgeSent: false })
    .where(eq(businesses.id, businessId));
}

// true iff a token was actually cleared.
export async function clearBusinessGoogleRefreshToken(businessId: number): Promise<boolean> {
  const rows = await db
    .update(businesses)
    .set({ googleRefreshToken: null })
    .where(and(eq(businesses.id, businessId), isNotNull(businesses.googleRefreshToken)))
    .returning({ id: businesses.id });
  return rows.length > 0;
}

// Phase 25.1 (D-04): OAuth state store. Admin pool only (RLS, no app GRANT).
export async function insertGoogleOauthState(
  stateHash: string,
  businessId: number,
  expiresAt: Date
): Promise<void> {
  await db.insert(googleOauthStates).values({ stateHash, businessId, expiresAt });
}

// One atomic DELETE ... RETURNING: a state works at most once and only before
// expiry. The businessId comes from the row written server-side at creation.
export async function consumeGoogleOauthState(stateHash: string): Promise<number | null> {
  const rows = await db
    .delete(googleOauthStates)
    .where(
      and(eq(googleOauthStates.stateHash, stateHash), gt(googleOauthStates.expiresAt, new Date()))
    )
    .returning({ businessId: googleOauthStates.businessId });
  return rows[0]?.businessId ?? null;
}

export async function deleteExpiredGoogleOauthStates(): Promise<number> {
  const rows = await db
    .delete(googleOauthStates)
    .where(lt(googleOauthStates.expiresAt, new Date()))
    .returning({ stateHash: googleOauthStates.stateHash });
  return rows.length;
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

// ---------------------------------------------------------------------------
// Quick task 260729-n05: GDPR-style full-erase — booking/conversation cascade
// ---------------------------------------------------------------------------

/**
 * Deletes every booking-related row tied to (businessId, clientPhone):
 * slotlessRequests, then bookings, then conversationTurns, in that order —
 * slotlessRequests.bookingId references bookings.id, so it must go first.
 *
 * MUST run AFTER deleteClientBillingData (billing/queries.ts) in the caller —
 * membershipLedger.bookingId also references bookings.id, so the ledger rows
 * must already be gone before bookings are deleted here.
 *
 * Uses getConn() deliberately (not a new transaction) — the caller
 * (handleDeleteFullExecute in admin-menu.ts) already runs inside the outer
 * withBusinessContext transaction opened by handleCallbackQuery in telegram.ts.
 */
export async function deleteClientBookingData(businessId: number, clientPhone: string): Promise<void> {
  const conn = getConn();

  await conn
    .delete(slotlessRequests)
    .where(and(eq(slotlessRequests.businessId, businessId), eq(slotlessRequests.clientPhone, clientPhone)));

  await conn
    .delete(bookings)
    .where(and(eq(bookings.businessId, businessId), eq(bookings.clientPhone, clientPhone)));

  await conn
    .delete(conversationTurns)
    .where(and(eq(conversationTurns.businessId, businessId), eq(conversationTurns.clientPhone, clientPhone)));

  // Conversation memory (summary + verbatim transcript) is personal data too —
  // erase it with the rest. Isolated in a savepoint so an environment where
  // migration 0014 has not been applied yet cannot abort the erase transaction.
  try {
    await runIsolated((c) => deleteConversationMemory(businessId, clientPhone, 'client', c));
  } catch (err) {
    logger.warn({ err, businessId }, 'deleteClientBookingData: conversation_memory erase skipped');
  }
}

/**
 * Deletes a single clientBusinessRelationships row, scoped to businessId as an
 * ownership guard — defense-in-depth even though the caller already checks
 * ownership before invoking this (T-quick-02). Returns true iff a row was
 * deleted; false when relId does not exist or belongs to a different business.
 */
export async function deleteClientBusinessRelationship(
  relId: number,
  businessId: number
): Promise<boolean> {
  const rows = await getConn()
    .delete(clientBusinessRelationships)
    .where(and(eq(clientBusinessRelationships.id, relId), eq(clientBusinessRelationships.businessId, businessId)))
    .returning({ id: clientBusinessRelationships.id });
  return rows.length > 0;
}
