import {
  findServiceById,
  findBusinessHoursForDay,
  findActiveBookingSlotsForDate,
  expireStalePendingBookings,
} from '../database/queries';
import { weekdayOfIsoDate, isoDateInAthens } from '../utils/timezone';
import { logger } from '../utils/logger';

export interface AvailabilityResult {
  availableSlots: string[];
  closed: boolean;
  error?: 'service_not_found';
}

// D-09/D-11: sweep stale pending bookings (older than this cutoff) before
// reading active bookings, so an abandoned pending_owner_approval booking
// never wrongly occupies a slot forever.
const STALE_PENDING_CUTOFF_MS = 2 * 60 * 60 * 1000; // 2 hours

function timeStringToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export async function checkAvailability(
  businessId: number,
  serviceId: number,
  calendarDate: string,
  referenceNow: Date = new Date()
): Promise<AvailabilityResult> {
  // Best-effort cleanup — a failure here must never block the availability
  // read itself.
  try {
    await expireStalePendingBookings(businessId, STALE_PENDING_CUTOFF_MS);
  } catch (err) {
    logger.error(
      { err, businessId },
      'Failed to expire stale pending bookings before availability check'
    );
  }

  const service = await findServiceById(businessId, serviceId);
  if (!service) {
    logger.warn({ businessId, serviceId }, 'check_availability: service_not_found');
    return { availableSlots: [], closed: false, error: 'service_not_found' };
  }

  const dayOfWeek = weekdayOfIsoDate(calendarDate);
  const hours = await findBusinessHoursForDay(businessId, dayOfWeek);
  if (!hours || hours.isClosed) {
    return { availableSlots: [], closed: true };
  }

  const openHour = Number(hours.openTime.split(':')[0]);
  const closeHour = Number(hours.closeTime.split(':')[0]);
  const closeTimeInMinutes = timeStringToMinutes(hours.closeTime);

  // D-13: 1-hour granularity. A candidate "HH:00" slot is only valid if the
  // service's own duration fits before closing.
  const candidates: string[] = [];
  for (let hour = openHour; hour <= closeHour; hour++) {
    if (hour * 60 + service.durationMin <= closeTimeInMinutes) {
      candidates.push(`${String(hour).padStart(2, '0')}:00`);
    }
  }

  // T-02-09: each existing active booking's occupied interval is derived
  // from ITS OWN service duration (booked.durationMin, returned by the
  // findActiveBookingSlotsForDate join), never from the currently-requested
  // service's duration.
  const bookedSlots = await findActiveBookingSlotsForDate(businessId, calendarDate);

  let availableSlots = candidates.filter((slot) => {
    const candidateStart = timeStringToMinutes(slot);
    const candidateEnd = candidateStart + service.durationMin;
    return !bookedSlots.some((booked) => {
      const bookedStart = timeStringToMinutes(booked.calendarTime);
      const bookedEnd = bookedStart + booked.durationMin;
      return !(candidateEnd <= bookedStart || candidateStart >= bookedEnd);
    });
  });

  // Never offer a slot that has already passed today (Athens wall-clock).
  if (calendarDate === isoDateInAthens(referenceNow)) {
    const nowAthens = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Athens',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(referenceNow);
    const nowMinutes = timeStringToMinutes(nowAthens);
    availableSlots = availableSlots.filter((slot) => timeStringToMinutes(slot) > nowMinutes);
  }

  return { availableSlots, closed: false };
}
