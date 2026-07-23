import { z } from 'zod';
import {
  findServiceById,
  insertBooking,
  findBookingByRequestId,
  findBookingById,
  findBusinessById,
  updateBookingStatus,
  updateBookingOwnerMessageId,
  listClientBookings,
  Booking,
  Service,
} from '../database/queries';
import { checkAvailability } from '../business/availability';
import { sendTelegramMessage, sendTelegramMessageWithKeyboard } from '../telegram/client';
import { deleteBookingFromCalendar } from '../calendar/sync';
import { logger } from '../utils/logger';
import { getClientActiveMembership, getActiveMembershipForDeduction, deductSession, getClientName, findMembershipByBooking, restoreCredit, linkRescheduledBooking } from '../billing/queries';
import { checkEnforcementAndGetMembership } from '../billing/enforcement';
import { formatExpiryDateGreek, isoDateInAthens } from '../utils/timezone';
import { listSessions, bookSessionInstance } from '../session/manager';

export interface ToolContext {
  business: {
    id: number;
    name: string;
    ownerTelegramId: string | null;
    enforcementPolicy: string;
    /** Phase 11 (CLSS-01): 'open_slots' | 'fixed_sessions' */
    bookingMode: string;
    /** Phase 11 (SBOK-04): multi-booking gate */
    allowMultiBooking: boolean;
  };
  clientPhone: string;
  // Turn-constant identifier, stable across every tool call within the same
  // conversation turn — used for logging/tracing only.
  requestId: string;
  // CR-02: unique per mutating tool call (`${requestId}:${call.id}`), derived
  // by ai-agent.ts. Two distinct book_appointment/reschedule_appointment
  // calls within the SAME turn must never collide on the same idempotency
  // key, or the second call's insertBooking conflict would be silently
  // resolved to the first call's booking row.
  idempotencyKey: string;
}

// D-09: pending bookings created by this executor expire 2 hours after
// creation if the owner never responds.
const PENDING_BOOKING_TTL_MS = 2 * 60 * 60 * 1000;

const ACTIVE_STATUSES = ['pending_owner_approval', 'confirmed'];

const CheckAvailabilityArgsSchema = z.object({
  business_id: z.number().int(),
  service_id: z.number().int(),
  calendar_date: z.string(),
});

const BookAppointmentArgsSchema = z.object({
  business_id: z.number().int(),
  service_id: z.number().int(),
  calendar_date: z.string(),
  calendar_time: z.string(),
});

const CancelAppointmentArgsSchema = z.object({
  business_id: z.number().int(),
  booking_id: z.number().int(),
});

const RescheduleAppointmentArgsSchema = z.object({
  business_id: z.number().int(),
  booking_id: z.number().int(),
  service_id: z.number().int(),
  calendar_date: z.string(),
  calendar_time: z.string(),
});

const CheckMembershipBalanceArgsSchema = z.object({
  business_id: z.number().int(),
});

// Phase 11 session tool schemas (SBOK-01, SBOK-03, SBOK-04)
const ListSessionsArgsSchema = z.object({
  business_id: z.number().int(),
});

const BookSessionArgsSchema = z.object({
  business_id: z.number().int(),
  session_instance_id: z.number().int().optional(),
  session_instance_ids: z.array(z.number().int()).optional(),
});

const RescheduleSessionArgsSchema = z.object({
  business_id: z.number().int(),
  booking_id: z.number().int(),
  new_session_instance_id: z.number().int(),
});

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  // T-02-12: single dispatcher-level cross-tenant check, before any per-tool
  // logic runs, regardless of what Gemini requested (defense-in-depth
  // against prompt injection attempting to target a different business).
  logger.info({ tool: name, args }, 'Executing tool');

  if ('business_id' in args && args.business_id !== context.business.id) {
    logger.warn({ tool: name, argsBusinessId: args.business_id, contextBusinessId: context.business.id }, 'cross_tenant_denied');
    return { error: 'cross_tenant_denied' };
  }

  try {
    switch (name) {
      case 'check_availability':
        return await checkAvailabilityTool(args, context);
      case 'book_appointment':
        return await bookAppointmentTool(args, context);
      case 'cancel_appointment':
        return await cancelAppointmentTool(args, context);
      case 'reschedule_appointment':
        return await rescheduleAppointmentTool(args, context);
      case 'list_client_bookings':
        return await listClientBookingsTool(context);
      case 'check_membership_balance':
        return await checkMembershipBalanceTool(args, context);
      // Phase 11: session booking tools (SBOK-01, SBOK-03, SBOK-04)
      case 'list_sessions_for_client':
        return await listSessionsForClientTool(args, context);
      case 'book_session':
        return await bookSessionTool(args, context);
      case 'reschedule_session':
        return await rescheduleSessionTool(args, context);
      default:
        return { error: `Tool '${name}' not found` };
    }
  } catch (error) {
    logger.error({ err: error, tool: name, args }, 'Tool execution threw unexpectedly');
    return { error: (error as Error).message || 'internal_error' };
  }
}

async function checkAvailabilityTool(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  const parsed = CheckAvailabilityArgsSchema.parse(args);
  const result = await checkAvailability(context.business.id, parsed.service_id, parsed.calendar_date);
  // AvailabilityResult has no index signature; executeTool's contract
  // returns a plain JSON-serializable Record for every tool (it is passed
  // straight through JSON.stringify back to Gemini), so a structural cast is
  // safe here — no behavior change, just widening the static type.
  return result as unknown as Record<string, unknown>;
}

// Shared by bookAppointmentTool and rescheduleAppointmentTool: both create a
// new pending booking row and both need the identical owner-alert shape
// (T-02-14: no duplicate alert on idempotent retry).
async function alertOwnerNewBooking(
  booking: Booking,
  service: Service,
  business: ToolContext['business']
): Promise<void> {
  const text = `Νέο ραντεβού:\nΥπηρεσία: ${service.name}\nΗμερομηνία: ${booking.calendarDate}\nΏρα: ${booking.calendarTime}\nΠελάτης: ${booking.clientPhone}`;

  if (!business.ownerTelegramId) {
    logger.warn(
      { businessId: business.id, bookingId: booking.id },
      'No ownerTelegramId configured; skipping owner booking alert'
    );
    return;
  }

  const sent = await sendTelegramMessageWithKeyboard(business.ownerTelegramId, text, [
    [
      { text: 'Αποδοχή', callback_data: `approve_${booking.id}` },
      { text: 'Απόρριψη', callback_data: `reject_${booking.id}` },
    ],
  ]);
  await updateBookingOwnerMessageId(booking.id, sent.messageId);
}

// T-02-14: disambiguates an insertBooking() conflict (returns null on EITHER
// unique-index violation) into a genuine idempotent retry (same request_id,
// return the cached result, no second alert) vs. a real slot conflict from a
// different request (structured slot_taken error, no alert either way).
async function resolveConflictOrTaken(
  clientPhone: string,
  requestId: string
): Promise<Record<string, unknown>> {
  const existing = await findBookingByRequestId(clientPhone, requestId);
  if (existing) {
    return { success: true, booking_id: existing.id, status: existing.bookingStatus };
  }
  return { success: false, error: 'slot_taken' };
}

async function bookAppointmentTool(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  const parsed = BookAppointmentArgsSchema.parse(args);

  const service = await findServiceById(context.business.id, parsed.service_id);
  if (!service) return { success: false, error: 'service_not_found' };

  // Phase 8: enforcement pre-check (D-10 — must precede insertBooking).
  // CR-01: use checkEnforcementAndGetMembership so booking-enforcement tests cover production path.
  const enfResult = await checkEnforcementAndGetMembership(context.business.id, context.clientPhone);
  if (!enfResult.allowed) {
    return {
      success: false,
      error: 'no_membership',
      message: enfResult.message ?? 'Για να κάνετε κράτηση, χρειάζεστε ενεργή συνδρομή. Επικοινωνήστε με ' + context.business.name + ' για ανανέωση.',
    };
  }
  const membership = enfResult.membership;

  const expiresAt = new Date(Date.now() + PENDING_BOOKING_TTL_MS);
  const booking = await insertBooking({
    businessId: context.business.id,
    clientPhone: context.clientPhone,
    serviceId: parsed.service_id,
    calendarDate: parsed.calendar_date,
    calendarTime: parsed.calendar_time,
    requestId: context.idempotencyKey,
    expiresAt,
  });

  if (booking) {
    // Phase 8: flag alert (ENFC-03, D-11) — BEFORE alertOwnerNewBooking.
    // WR-01: wrapped in try/catch — flag alert is a notification, not a gate;
    // a Telegram failure must not orphan a committed booking row.
    if (enfResult.shouldAlert && context.business.ownerTelegramId) {
      const clientName = await getClientName(context.business.id, context.clientPhone);
      const flagText =
        '⚠️ Νέα κράτηση από πελάτη χωρίς ενεργή συνδρομή: ' +
        (clientName ?? context.clientPhone) +
        ', ' +
        service.name +
        ', ' +
        booking.calendarDate +
        ' ' +
        booking.calendarTime +
        '.';
      try {
        await sendTelegramMessage(context.business.ownerTelegramId, flagText);
      } catch (err) {
        logger.error({ err, bookingId: booking.id }, 'Flag alert failed (best-effort); booking committed');
      }
    }

    // Phase 8: session deduction (SESS-01, D-02) — only for finite memberships with remaining sessions (D-06)
    // CR-04: guard against sessionsRemaining === 0 to prevent driving the counter below zero
    if (membership !== null && membership.sessionsRemaining !== null && membership.sessionsRemaining > 0) {
      await deductSession(membership.id, booking.id, 'booking:' + booking.id + ':deduction');
    }

    // CR-03c: same contract as CR-03b — DB mutation committed, so a
    // Telegram alert failure must never surface as a tool error or Gemini
    // will retry the booking in a loop until MAX_TOOL_ROUNDS fires.
    try {
      await alertOwnerNewBooking(booking, service, context.business);
    } catch (err) {
      logger.error({ err, bookingId: booking.id }, 'Booking created but owner alert failed');
    }
    return { success: true, booking_id: booking.id, status: booking.bookingStatus };
  }

  return await resolveConflictOrTaken(context.clientPhone, context.idempotencyKey);
}

async function cancelAppointmentTool(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  const parsed = CancelAppointmentArgsSchema.parse(args);

  const booking = await findBookingById(context.business.id, parsed.booking_id);
  if (!booking) return { success: false, error: 'booking_not_found' };
  // T-02-13: a client (or an LLM hallucinating/guessing a booking_id) can
  // never cancel another client's appointment.
  if (booking.clientPhone !== context.clientPhone) return { success: false, error: 'not_your_booking' };
  if (!ACTIVE_STATUSES.includes(booking.bookingStatus)) {
    return { success: false, error: 'not_cancellable' };
  }

  await updateBookingStatus(booking.id, 'cancelled');

  // Phase 8: credit restore (SESS-02/D-03) — after updateBookingStatus, before notifications
  const membershipId = await findMembershipByBooking(booking.id);
  if (membershipId !== null) {
    await restoreCredit(membershipId, booking.id, 'booking:' + booking.id + ':credit');
  }

  // Best-effort Calendar delete (D-15). ToolContext.business is the narrow
  // { id, name, ownerTelegramId } shape, not the full Business row, so the
  // full row (carrying googleRefreshToken) must be fetched separately here.
  try {
    const fullBusiness = await findBusinessById(context.business.id);
    if (fullBusiness) await deleteBookingFromCalendar(booking, fullBusiness);
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'Calendar deletion failed (best-effort)');
  }

  const service = await findServiceById(context.business.id, booking.serviceId);
  // D-05/D-06: cancellations are auto-processed (no owner veto) but the
  // owner still gets an FYI-only alert — no accept/reject keyboard.
  //
  // CR-03a: the DB mutation above has already committed at this point — a
  // subsequent Telegram send failure must never be reported back as an
  // error, or the client will be told cancellation failed when it actually
  // succeeded.
  try {
    if (context.business.ownerTelegramId) {
      const ownerText = `Ακύρωση ραντεβού από πελάτη:\nΥπηρεσία: ${service?.name ?? 'άγνωστη'}\nΗμερομηνία: ${booking.calendarDate}\nΏρα: ${booking.calendarTime}\nΠελάτης: ${booking.clientPhone}`;
      await sendTelegramMessage(context.business.ownerTelegramId, ownerText);
    }
    await sendTelegramMessage(booking.clientPhone, 'Το ραντεβού σας ακυρώθηκε.');
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'Cancellation succeeded but notification failed');
  }

  return { success: true, booking_id: booking.id };
}

async function rescheduleAppointmentTool(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  const parsed = RescheduleAppointmentArgsSchema.parse(args);

  const original = await findBookingById(context.business.id, parsed.booking_id);
  if (!original) return { success: false, error: 'booking_not_found' };
  if (original.clientPhone !== context.clientPhone) return { success: false, error: 'not_your_booking' };
  if (!ACTIVE_STATUSES.includes(original.bookingStatus)) {
    return { success: false, error: 'not_reschedulable' };
  }

  const service = await findServiceById(context.business.id, parsed.service_id);
  if (!service) return { success: false, error: 'service_not_found' };

  const expiresAt = new Date(Date.now() + PENDING_BOOKING_TTL_MS);
  // The original booking's status is NEVER touched here — that transition is
  // explicitly Plan 02-05's job, at owner-approval time.
  const newBooking = await insertBooking({
    businessId: context.business.id,
    clientPhone: context.clientPhone,
    serviceId: parsed.service_id,
    calendarDate: parsed.calendar_date,
    calendarTime: parsed.calendar_time,
    requestId: context.idempotencyKey,
    expiresAt,
    rescheduledFromBookingId: original.id,
  });

  if (newBooking) {
    // CR-02: propagate the original booking's membership ledger link to the new
    // booking row so that cancel-restore works correctly after a reschedule.
    // Counter unchanged — only the link is needed for findMembershipByBooking.
    const originalMembershipId = await findMembershipByBooking(original.id);
    if (originalMembershipId !== null) {
      await linkRescheduledBooking(originalMembershipId, newBooking.id);
    }

    // CR-03b: the reschedule's DB mutation above has already committed — an
    // owner-alert send failure must never be reported back as an error, or
    // the client will be told the reschedule failed when it actually
    // succeeded.
    try {
      await alertOwnerNewBooking(newBooking, service, context.business);
    } catch (err) {
      logger.error({ err, bookingId: newBooking.id }, 'Reschedule booking created but owner alert failed');
    }
    return { success: true, booking_id: newBooking.id, status: newBooking.bookingStatus };
  }

  return await resolveConflictOrTaken(context.clientPhone, context.idempotencyKey);
}

async function listClientBookingsTool(
  context: ToolContext
): Promise<Record<string, unknown>> {
  const clientBookings = await listClientBookings(context.business.id, context.clientPhone);
  return {
    bookings: clientBookings.map((b) => ({
      booking_id: b.id,
      service_id: b.serviceId,
      calendar_date: b.calendarDate,
      calendar_time: b.calendarTime,
      status: b.bookingStatus,
    })),
  };
}

// NOTF-04: check_membership_balance — returns client's membership state in Greek.
// clientPhone is always sourced from context (Telegram from.id) — never from
// Gemini args — preventing cross-client balance inspection (T-09-05).
//
// WR-01: uses getClientActiveMembership (plain SELECT, no FOR UPDATE lock) instead of
// getActiveMembershipForDeduction — balance inquiry has no mutation to serialize and must
// not acquire an exclusive row-level lock that would block concurrent booking requests.
async function checkMembershipBalanceTool(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  CheckMembershipBalanceArgsSchema.parse(args);

  const membership = await getClientActiveMembership(context.business.id, context.clientPhone);

  if (membership === null) {
    return {
      success: true,
      message: 'Δεν βρέθηκε ενεργή συνδρομή. Επικοινωνήστε με ' + context.business.name + ' για ανανέωση.',
    };
  }

  if (membership.isUnlimited) {
    return {
      success: true,
      message: 'Η συνδρομή σας είναι απεριόριστων μαθημάτων και λήγει στις ' + formatExpiryDateGreek(membership.expiresAt) + '.',
    };
  }

  return {
    success: true,
    message: 'Έχετε ' + membership.sessionsRemaining + ' μαθήματα απομείνει. Η συνδρομή σας λήγει στις ' + formatExpiryDateGreek(membership.expiresAt) + '.',
  };
}

// ---------------------------------------------------------------------------
// Phase 11: session booking handlers (SBOK-01, SBOK-03, SBOK-04)
// ---------------------------------------------------------------------------

// SBOK-01: list upcoming non-cancelled session instances for the business.
// T-11-10: capacity counts are not sensitive; returning them helps clients choose.
async function listSessionsForClientTool(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  ListSessionsArgsSchema.parse(args);

  const sessions = await listSessions(context.business.id);

  if (sessions.length === 0) {
    return { sessions: [], message: 'Δεν υπάρχουν επερχόμενες σεζόν αυτή τη στιγμή.' };
  }

  return {
    sessions: sessions.map((s) => ({
      instance_id: s.instanceId,
      session_date: s.sessionDate,
      session_time: s.sessionTime,
      booked_count: s.bookedCount,
      capacity: s.capacity,
      spots_left: s.capacity - s.bookedCount,
      service_id: s.serviceId,
    })),
  };
}

// SBOK-01 + SBOK-04: book one or multiple session instances for the client.
// T-11-06: enforcement check is mandatory before bookSessionInstance — blocked
// clients receive error:no_membership regardless of enforcement policy.
// T-11-07: sequential loop (no Promise.all) to prevent concurrent capacity races.
async function bookSessionTool(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  const parsed = BookSessionArgsSchema.parse(args);

  // Multi-booking path (SBOK-04): session_instance_ids array provided
  if (parsed.session_instance_ids && parsed.session_instance_ids.length > 0) {
    // T-11-07: gate on allowMultiBooking before fetching sessions or running enforcement
    if (!context.business.allowMultiBooking) {
      return {
        success: false,
        error: 'multi_booking_disabled',
        message: 'Η επιχείρηση δεν επιτρέπει πολλαπλές κρατήσεις μαζί.',
      };
    }

    // Single enforcement check before the loop — avoids redundant DB round-trips
    const enfResult = await checkEnforcementAndGetMembership(context.business.id, context.clientPhone);
    if (!enfResult.allowed) {
      return {
        success: false,
        error: 'no_membership',
        message: enfResult.message ?? 'Χρειάζεστε ενεργή συνδρομή για να κλείσετε σεζόν. Επικοινωνήστε με ' + context.business.name + ' για ανανέωση.',
      };
    }

    const sessions = await listSessions(context.business.id);
    const booked: number[] = [];
    const full: number[] = [];
    const conflict: number[] = [];

    // Sequential loop — intentional: parallel booking could cause capacity races (T-11-07)
    for (const instanceId of parsed.session_instance_ids) {
      const session = sessions.find((s) => s.instanceId === instanceId);
      if (!session) {
        conflict.push(instanceId);
        continue;
      }
      const key = context.idempotencyKey + ':' + instanceId;
      const result = await bookSessionInstance(
        context.business.id,
        instanceId,
        context.clientPhone,
        session.serviceId,
        key,
        enfResult.membership
      );
      if (result.status === 'success') booked.push(instanceId);
      else if (result.status === 'full') full.push(instanceId);
      else conflict.push(instanceId);
    }

    return {
      success: booked.length > 0,
      booked_instance_ids: booked,
      full_instance_ids: full,
      conflict_instance_ids: conflict,
      booked_count: booked.length,
    };
  }

  // Single-booking path (SBOK-01)
  if (parsed.session_instance_id === undefined) {
    return {
      success: false,
      error: 'missing_session_instance_id',
      message: 'Δεν δόθηκε αναγνωριστικό σεζόν. Χρησιμοποίησε list_sessions_for_client για να δεις τις διαθέσιμες σεζόν.',
    };
  }

  const enfResult = await checkEnforcementAndGetMembership(context.business.id, context.clientPhone);
  if (!enfResult.allowed) {
    return {
      success: false,
      error: 'no_membership',
      message: enfResult.message ?? 'Χρειάζεστε ενεργή συνδρομή για να κλείσετε σεζόν. Επικοινωνήστε με ' + context.business.name + ' για ανανέωση.',
    };
  }

  const sessions = await listSessions(context.business.id);
  const session = sessions.find((s) => s.instanceId === parsed.session_instance_id);
  if (!session) {
    return { success: false, error: 'session_not_found', message: 'Η σεζόν δεν βρέθηκε ή δεν είναι πλέον διαθέσιμη.' };
  }

  const result = await bookSessionInstance(
    context.business.id,
    parsed.session_instance_id,
    context.clientPhone,
    session.serviceId,
    context.idempotencyKey,
    enfResult.membership
  );

  if (result.status === 'full') {
    return { success: false, error: 'session_full', message: 'Η σεζόν είναι πλήρης. Δεν υπάρχουν διαθέσιμες θέσεις.' };
  }
  if (result.status === 'conflict') {
    return { success: false, error: 'session_not_available', message: 'Η σεζόν δεν είναι διαθέσιμη (ακυρωμένη ή δεν βρέθηκε).' };
  }

  // Best-effort owner alert — session bookings are auto-confirmed; no approve/reject keyboard needed
  try {
    if (context.business.ownerTelegramId) {
      await sendTelegramMessage(
        context.business.ownerTelegramId,
        'Νέα κράτηση σεζόν ' + session.sessionDate + ' ' + session.sessionTime + ' — πελάτης: ' + context.clientPhone
      );
    }
  } catch (err) {
    logger.error({ err }, 'Session booking owner alert failed (best-effort)');
  }

  return { success: true, booking_id: result.bookingId, session_date: session.sessionDate, session_time: session.sessionTime };
}

// SBOK-03: move an existing session booking to a different instance.
// T-11-08: clientPhone ownership guard (same as cancelAppointmentTool).
// T-11-09: blocks reschedule to a date past membership expiry.
async function rescheduleSessionTool(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<Record<string, unknown>> {
  const parsed = RescheduleSessionArgsSchema.parse(args);

  const original = await findBookingById(context.business.id, parsed.booking_id);
  if (!original) return { success: false, error: 'booking_not_found' };

  // T-11-08: client can only reschedule their own booking
  if (original.clientPhone !== context.clientPhone) return { success: false, error: 'not_your_booking' };
  if (!ACTIVE_STATUSES.includes(original.bookingStatus)) return { success: false, error: 'not_reschedulable' };

  // Must be a session booking (has sessionInstanceId) — not an open-slot booking
  if (original.sessionInstanceId === null || original.sessionInstanceId === undefined) {
    return {
      success: false,
      error: 'not_a_session_booking',
      message: 'Αυτή η κράτηση δεν αφορά σεζόν. Χρησιμοποίησε reschedule_appointment αντί για reschedule_session.',
    };
  }

  const sessions = await listSessions(context.business.id);
  const newSession = sessions.find((s) => s.instanceId === parsed.new_session_instance_id);
  if (!newSession) return { success: false, error: 'session_not_found' };

  // SBOK-03: expiry gate — block reschedule to a session past membership expiry (T-11-09)
  const membership = await getClientActiveMembership(context.business.id, context.clientPhone);
  if (membership !== null) {
    const membershipExpiryDate = isoDateInAthens(membership.expiresAt);
    if (newSession.sessionDate > membershipExpiryDate) {
      return {
        success: false,
        error: 'past_membership_expiry',
        message:
          'Η νέα σεζόν (' +
          newSession.sessionDate +
          ') είναι μετά τη λήξη της συνδρομής σας (' +
          formatExpiryDateGreek(membership.expiresAt) +
          '). Δεν μπορείτε να μετακινήσετε την κράτηση εκτός της ισχύος της συνδρομής σας.',
      };
    }
  }

  // Cancel old booking and restore credit (same pattern as cancelAppointmentTool)
  await updateBookingStatus(original.id, 'cancelled');
  const oldMembershipId = await findMembershipByBooking(original.id);
  if (oldMembershipId !== null) {
    await restoreCredit(oldMembershipId, original.id, 'booking:' + original.id + ':credit');
  }

  // Fetch fresh membership after restore so deductSession sees the updated counter
  const activeMembership = await getActiveMembershipForDeduction(context.business.id, context.clientPhone);
  const newKey = context.idempotencyKey + ':reschedule:' + parsed.new_session_instance_id;

  const result = await bookSessionInstance(
    context.business.id,
    parsed.new_session_instance_id,
    context.clientPhone,
    newSession.serviceId,
    newKey,
    activeMembership
  );

  if (result.status !== 'success') {
    // New session unavailable — log partial failure; old booking is already cancelled
    logger.error(
      { bookingId: original.id, newSessionInstanceId: parsed.new_session_instance_id, status: result.status },
      'reschedule_session: new session unavailable after cancelling old booking'
    );
    return {
      success: false,
      error: 'reschedule_failed_' + result.status,
      message: result.status === 'full' ? 'Η νέα σεζόν είναι πλήρης.' : 'Η νέα σεζόν δεν είναι διαθέσιμη.',
    };
  }

  return {
    success: true,
    booking_id: result.bookingId,
    cancelled_booking_id: original.id,
    new_session_date: newSession.sessionDate,
    new_session_time: newSession.sessionTime,
  };
}
