// Phase 31 Plan 02 (D-05): lightweight client-side calendar touchpoint — a
// hand-rolled RFC 5545 .ics invite sent alongside the existing text
// confirmation when a regular (open-slot) booking is approved. This is
// explicitly NOT a second OAuth integration and collects no new
// GDPR-relevant client data: every field below is already sent to the
// client in plaintext chat.

import { Booking, Business, Service } from '../database/queries';
import { addMinutesToLocalTime } from './event-content';
import { sendTelegramDocument } from '../telegram/client';
import { logger } from '../utils/logger';

/**
 * Escapes RFC 5545 TEXT special characters, in order: backslash first (so
 * later replacements never double-escape a backslash they themselves
 * introduce), then semicolon, comma, and newline. Mirrors
 * src/invites/generator.ts's escapeXml multi-step replace shape.
 * T-31-07 mitigation: prevents a crafted business/service name from
 * injecting extra iCalendar properties or corrupting the VEVENT structure.
 */
function escapeIcsText(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/** Formats a JS Date as an RFC 5545 UTC timestamp: YYYYMMDDTHHMMSSZ. */
function toIcsUtcTimestamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/**
 * Converts an Europe/Athens wall-clock calendarDate/calendarTime pair into
 * an RFC 5545 UTC timestamp string. Reuses the exact DST-safe
 * offset-derivation trick already established by
 * src/utils/timezone.ts's hoursUntilSession: anchor at noon UTC on
 * calendarDate to read the Athens wall-clock hour via Intl, derive
 * offsetHours = athensHour - 12, then apply that offset to the naive UTC
 * parse of the wall-clock time. Never hardcodes a fixed UTC+2/UTC+3 offset
 * (31-RESEARCH.md Pitfall 5).
 */
function athensLocalToUtcTimestamp(calendarDate: string, calendarTime: string): string {
  const noonUTC = new Date(`${calendarDate}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Athens',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(noonUTC);
  const athensHour = Number.parseInt(parts.find((p) => p.type === 'hour')!.value, 10);
  const offsetHours = athensHour - 12;
  const utcMs = Date.parse(`${calendarDate}T${calendarTime}:00Z`) - offsetHours * 3_600_000;
  return toIcsUtcTimestamp(new Date(utcMs));
}

/**
 * Builds a single-VEVENT RFC 5545 iCalendar document for a confirmed
 * booking. CRLF line endings throughout (RFC 5545 requires CRLF, not bare
 * "\n"). DTSTART/DTEND are DST-correct UTC timestamps converted from the
 * booking's Europe/Athens wall-clock date/time; the end time is computed via
 * the now-exported addMinutesToLocalTime from src/calendar/sync.ts to avoid
 * a second divergent day-overflow implementation.
 */
export function generateIcsEvent(booking: Booking, business: Business, service: Service): string {
  const uid = `booking-${booking.id}@${business.slug}`;
  const dtStamp = toIcsUtcTimestamp(new Date());
  const dtStart = athensLocalToUtcTimestamp(booking.calendarDate, booking.calendarTime);
  const end = addMinutesToLocalTime(booking.calendarDate, booking.calendarTime, service.durationMin);
  const dtEnd = athensLocalToUtcTimestamp(end.date, end.time);
  const summary = escapeIcsText(`${service.name} — ${business.name}`);
  const description = escapeIcsText(`Κράτηση για ${service.name} στο ${business.name}.`);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RandevuClaw//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Best-effort wrapper (D-15-style, matching syncBookingToCalendar's
 * established non-blocking contract): generates the .ics buffer and sends
 * it via sendTelegramDocument. NEVER throws — a failure here can never
 * block, delay, or break the client's existing booking confirmation message.
 */
export async function sendBookingConfirmationIcs(
  chatId: string,
  booking: Booking,
  business: Business,
  service: Service
): Promise<void> {
  try {
    const icsContent = generateIcsEvent(booking, business, service);
    const buffer = Buffer.from(icsContent, 'utf-8');
    await sendTelegramDocument(chatId, buffer, 'booking.ics');
  } catch (err) {
    logger.error(
      { err, bookingId: booking.id, businessId: business.id },
      'Failed to send .ics calendar invite (non-blocking)'
    );
  }
}
