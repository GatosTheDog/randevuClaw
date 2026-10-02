import {
  CALENDAR_REMOVE_NOTE_GREEK,
  CALENDAR_RESCHEDULE_NOTE_GREEK,
  appendCancelCalendarNote,
  buildClientCalendarLink,
  buildClientCalendarMessage,
} from '../src/calendar/client-link';
import { makeBooking, makeBusiness, makeService } from './helpers/calendar-fixtures';

function inputFrom(overrides: Record<string, unknown> = {}) {
  const business = makeBusiness();
  const service = makeService();
  const booking = makeBooking();
  return {
    serviceName: service.name,
    businessName: business.name,
    calendarDate: booking.calendarDate,
    calendarTime: booking.calendarTime,
    durationMin: service.durationMin,
    ...overrides,
  };
}

describe('buildClientCalendarLink', () => {
  it('builds a Google render TEMPLATE url with exactly five params', () => {
    const link = buildClientCalendarLink(inputFrom());
    expect(link.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE&text=')).toBe(true);
    const url = new URL(link);
    expect(url.host).toBe('calendar.google.com');
    expect(url.pathname).toBe('/calendar/render');
    expect([...url.searchParams.keys()].sort()).toEqual(['action', 'ctz', 'dates', 'details', 'text']);
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('dates')).toBe('20260710T100000/20260710T105000');
    expect(url.searchParams.get('ctz')).toBe('Europe/Athens');
    expect(url.searchParams.get('text')).toBe('Reformer Pilates — Pilates Athens');
    expect(url.searchParams.get('details')).toBe('Pilates Athens\nReformer Pilates');
  });

  it('cannot be injected through &, = or # in names and stays printable ASCII', () => {
    const link = buildClientCalendarLink(inputFrom({ serviceName: 'Pilates & Yoga=1#x', businessName: 'Στούντιο\nΑθήνα&add=evil@x.com' }));
    const url = new URL(link);
    expect([...url.searchParams.keys()]).toHaveLength(5);
    expect(url.searchParams.get('text')).toBe('Pilates & Yoga=1#x — Στούντιο Αθήνα&add=evil@x.com');
    expect(url.searchParams.has('add')).toBe(false);
    expect(link.match(/&text=/g)).toHaveLength(1);
    expect(/^[\x21-\x7e]+$/.test(link)).toBe(true);
    expect(url.hash).toBe('');
  });

  it('round-trips Greek text', () => {
    const link = buildClientCalendarLink(inputFrom({ serviceName: 'Μάθημα Πιλάτες', businessName: 'Στούντιο Αθήνα' }));
    expect(new URL(link).searchParams.get('text')).toBe('Μάθημα Πιλάτες — Στούντιο Αθήνα');
  });

  it('rolls the end date over midnight and never adds attendee params', () => {
    const link = buildClientCalendarLink(inputFrom({ calendarTime: '23:30', durationMin: 60 }));
    const url = new URL(link);
    expect(url.searchParams.get('dates')).toBe('20260710T233000/20260711T003000');
    expect(url.searchParams.has('add')).toBe(false);
    expect(url.searchParams.has('src')).toBe(false);
  });

  it('carries no client data (only service, business, date, time)', () => {
    const link = decodeURIComponent(buildClientCalendarLink(inputFrom()));
    expect(link).not.toContain(makeBooking().clientPhone);
  });
});

describe('buildClientCalendarMessage', () => {
  const url = 'https://calendar.google.com/calendar/render?action=TEMPLATE';

  it('starts with a blank line and contains label and url', () => {
    const msg = buildClientCalendarMessage(url, { isReschedule: false });
    expect(msg.startsWith('\n\n')).toBe(true);
    expect(msg).toContain('Προσθήκη στο Google Calendar');
    expect(msg).toContain(url);
    expect(msg).not.toContain(CALENDAR_RESCHEDULE_NOTE_GREEK);
  });

  it('adds the reschedule note for reschedules', () => {
    const msg = buildClientCalendarMessage(url, { isReschedule: true });
    expect(msg).toContain(url);
    expect(msg).toContain(CALENDAR_RESCHEDULE_NOTE_GREEK);
  });
});

describe('appendCancelCalendarNote', () => {
  it('appends the remove note only for confirmed bookings', () => {
    const text = 'Το ραντεβού σας ακυρώθηκε.';
    expect(appendCancelCalendarNote(text, true)).toBe(`${text}\n\n${CALENDAR_REMOVE_NOTE_GREEK}`);
    expect(appendCancelCalendarNote(text, false)).toBe(text);
  });
});
