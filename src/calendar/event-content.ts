import { addCalendarDays } from '../utils/timezone';

// Pure helpers shared by the owner Calendar sync and the client tap-to-add link.
// No database, logger or config imports.

export const ATHENS_TIME_ZONE = 'Europe/Athens';

// D-08: popup reminder on the owner's event.
export const OWNER_REMINDER_MINUTES = 30;

// Control characters (C0 range, DEL) and line/paragraph separators.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F\\u2028\\u2029]', 'g');

/**
 * Flattens control characters/newlines to single spaces, collapses whitespace,
 * trims and truncates to maxLength (with a trailing ellipsis).
 */
export function sanitizeCalendarText(value: string, maxLength: number): string {
  const flat = value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (flat.length <= maxLength) return flat;
  return `${flat.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function formatClientLabel(clientName: string | null | undefined, clientId: string): string {
  const name = clientName ? sanitizeCalendarText(clientName, 60) : '';
  if (name) return name;
  return `Πελάτης ${sanitizeCalendarText(clientId, 40)}`;
}

// D-07: `<service name> — <client label>`.
export function buildOwnerEventSummary(serviceName: string, clientLabel: string): string {
  return `${sanitizeCalendarText(serviceName, 80)} — ${clientLabel}`;
}

// D-08: `<business name>\n<service name>`; no location, no attendee/email.
export function buildOwnerEventDescription(businessName: string, serviceName: string): string {
  return `${sanitizeCalendarText(businessName, 80)}\n${sanitizeCalendarText(serviceName, 80)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// Rare midnight-crossing case (a service that runs past 23:59 local time)
// reuses the existing DST-safe addCalendarDays helper rather than
// duplicating date-rollover logic.
export function addMinutesToLocalTime(
  calendarDate: string,
  calendarTime: string,
  minutes: number
): { date: string; time: string } {
  const [hours, mins] = calendarTime.split(':').map(Number);
  const total = hours * 60 + mins + minutes;
  const dayOverflow = Math.floor(total / 1440);
  const remainder = ((total % 1440) + 1440) % 1440;
  const remHours = Math.floor(remainder / 60);
  const remMins = remainder % 60;
  return {
    date: dayOverflow > 0 ? addCalendarDays(calendarDate, dayOverflow) : calendarDate,
    time: `${pad2(remHours)}:${pad2(remMins)}`,
  };
}

// `YYYYMMDDTHHMM00` local date-time for the Google render TEMPLATE `dates` parameter.
export function toGoogleTemplateDateTime(date: string, time: string): string {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
}
