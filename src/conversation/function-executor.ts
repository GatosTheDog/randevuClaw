import { z } from 'zod';
import {
  findServiceById,
  insertBooking,
  findBookingByRequestId,
  findBookingById,
  findBusinessById,
  updateBookingStatus,
  updateBookingOwnerMessageId,
  Booking,
  Service,
} from '../database/queries';
import { checkAvailability } from '../business/availability';
import { sendTelegramMessage, sendTelegramMessageWithKeyboard } from '../telegram/client';
import { deleteBookingFromCalendar } from '../calendar/sync';
import { logger } from '../utils/logger';

export interface ToolContext {
  business: { id: number; name: string; ownerTelegramId: string | null };
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
