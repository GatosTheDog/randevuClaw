import {
  ATHENS_TIME_ZONE,
  addMinutesToLocalTime,
  sanitizeCalendarText,
  toGoogleTemplateDateTime,
} from './event-content';

export interface ClientCalendarLinkInput {
  serviceName: string;
  businessName: string;
  calendarDate: string;
  calendarTime: string;
  durationMin: number;
}

const RENDER_BASE = 'https://calendar.google.com/calendar/render?';

// Data minimisation: only data the client already knows (service, business,
// date, time) is placed in the link. No client name/id, no other client's
// data, no owner account. No attendee/email ("add") parameter exists by
// design (D-01): the client adds the event to their own calendar themselves.
// Every value goes through sanitizeCalendarText + encodeURIComponent (not
// URLSearchParams) so the output is deterministic and `&`, `=`, `#` or
// newlines in a name cannot add or alter query parameters.
export function buildClientCalendarLink(input: ClientCalendarLinkInput): string {
  const service = sanitizeCalendarText(input.serviceName, 80);
  const business = sanitizeCalendarText(input.businessName, 80);
  const start = toGoogleTemplateDateTime(input.calendarDate, input.calendarTime);
  const end = addMinutesToLocalTime(input.calendarDate, input.calendarTime, input.durationMin);
  const endStamp = toGoogleTemplateDateTime(end.date, end.time);

  const params = [
    'action=TEMPLATE',
    `text=${encodeURIComponent(`${service} — ${business}`)}`,
    `dates=${start}/${endStamp}`,
    `details=${encodeURIComponent(`${business}\n${service}`)}`,
    `ctz=${encodeURIComponent(ATHENS_TIME_ZONE)}`,
  ];
  return `${RENDER_BASE}${params.join('&')}`;
}

// D-03: client calendars are never modified by the bot.
export const CALENDAR_REMOVE_NOTE_GREEK =
  'Αν είχατε προσθέσει το ραντεβού στο Google Calendar σας, παρακαλούμε διαγράψτε το χειροκίνητα.';
export const CALENDAR_RESCHEDULE_NOTE_GREEK =
  'Αν είχατε προσθέσει στο ημερολόγιό σας το προηγούμενο ραντεβού, παρακαλούμε διαγράψτε το χειροκίνητα.';

// Appended to an existing confirmation message (plain text; the URL is delivered verbatim).
export function buildClientCalendarMessage(url: string, options: { isReschedule: boolean }): string {
  let message = `\n\n📅 Προσθήκη στο Google Calendar σας (πατήστε τον σύνδεσμο):\n${url}`;
  if (options.isReschedule) {
    message += `\n\n${CALENDAR_RESCHEDULE_NOTE_GREEK}`;
  }
  return message;
}

// A link is only ever sent after confirmation (D-02), so the removal note is
// appended only when the cancelled booking had been confirmed.
export function appendCancelCalendarNote(text: string, wasConfirmed: boolean): string {
  return wasConfirmed ? `${text}\n\n${CALENDAR_REMOVE_NOTE_GREEK}` : text;
}
