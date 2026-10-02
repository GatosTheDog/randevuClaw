import { Booking, Business, Service, findServiceById } from '../database/queries';
import { describeGoogleError } from '../google/errors';
import { logger } from '../utils/logger';
import { syncBookingToCalendar } from './sync';
import { maybeSendGoogleCalendarNudge } from './owner-nudge';
import { buildClientCalendarLink, buildClientCalendarMessage } from './client-link';

// The ONE post-confirmation entry point (D-02): call it right after a booking
// becomes 'confirmed' (legacy approve, session booking, Phase 26 sbk:approve).
// It NEVER throws and refuses any booking that is not confirmed, so no event
// and no client link can come from a pending or rejected booking.
//
// Callers append `clientCalendarMessage` (it begins with a blank line) to the
// confirmation text they already send; standalone senders use `.trim()`.

export interface BookingConfirmedCalendarInput {
  booking: Booking;
  business: Business;
  service?: Service | null;
  isReschedule?: boolean;
}

export interface BookingConfirmedCalendarResult {
  clientCalendarMessage: string;
  ownerSynced: boolean;
}

const EMPTY_RESULT: BookingConfirmedCalendarResult = { clientCalendarMessage: '', ownerSynced: false };

export async function processBookingConfirmedForCalendar(
  input: BookingConfirmedCalendarInput
): Promise<BookingConfirmedCalendarResult> {
  const { booking, business } = input;

  try {
    if (booking.bookingStatus !== 'confirmed') {
      logger.warn(
        { bookingId: booking.id, status: booking.bookingStatus },
        'Calendar processing skipped: booking not confirmed (D-02)'
      );
      return { ...EMPTY_RESULT };
    }

    let service: Service | null = input.service ?? null;
    if (!service) {
      try {
        service = await findServiceById(booking.businessId, booking.serviceId);
      } catch (err) {
        logger.warn(
          { bookingId: booking.id, ...describeGoogleError(err) },
          'Service lookup failed during calendar processing'
        );
      }
    }
    if (!service) {
      logger.warn({ bookingId: booking.id }, 'Calendar processing skipped: service not found');
      return { ...EMPTY_RESULT };
    }

    // Owner side. Always call sync: it skips silently without a token.
    let ownerSynced = false;
    try {
      ownerSynced = await syncBookingToCalendar(booking, business, service);
    } catch (err) {
      logger.error({ bookingId: booking.id, ...describeGoogleError(err) }, 'Owner calendar sync threw');
    }

    // D-06: one-time nudge when the business has no Google connection.
    if (!business.googleRefreshToken) {
      try {
        await maybeSendGoogleCalendarNudge(business);
      } catch (err) {
        logger.warn({ bookingId: booking.id, ...describeGoogleError(err) }, 'Calendar nudge threw');
      }
    }

    // Client side, independent of Google (D-01, CAL-09).
    let clientCalendarMessage = '';
    try {
      const url = buildClientCalendarLink({
        serviceName: service.name,
        businessName: business.name,
        calendarDate: booking.calendarDate,
        calendarTime: booking.calendarTime,
        durationMin: service.durationMin,
      });
      clientCalendarMessage = buildClientCalendarMessage(url, {
        isReschedule: input.isReschedule ?? Boolean(booking.rescheduledFromBookingId),
      });
    } catch (err) {
      logger.warn({ bookingId: booking.id, ...describeGoogleError(err) }, 'Client calendar link failed');
    }

    return { clientCalendarMessage, ownerSynced };
  } catch (err) {
    logger.error({ bookingId: booking.id, ...describeGoogleError(err) }, 'Calendar processing failed (non-blocking)');
    return { ...EMPTY_RESULT };
  }
}
