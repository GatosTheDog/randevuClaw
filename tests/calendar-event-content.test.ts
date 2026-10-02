import {
  ATHENS_TIME_ZONE,
  OWNER_REMINDER_MINUTES,
  addMinutesToLocalTime,
  buildOwnerEventDescription,
  buildOwnerEventSummary,
  formatClientLabel,
  sanitizeCalendarText,
  toGoogleTemplateDateTime,
} from '../src/calendar/event-content';

describe('constants', () => {
  it('exposes Athens zone and 30 minute reminder', () => {
    expect(ATHENS_TIME_ZONE).toBe('Europe/Athens');
    expect(OWNER_REMINDER_MINUTES).toBe(30);
  });
});

describe('sanitizeCalendarText', () => {
  it('flattens control characters and collapses whitespace', () => {
    expect(sanitizeCalendarText('  a\r\nb\tc\u0000d e  ', 100)).toBe('a b c d e');
  });

  it('truncates with a trailing ellipsis', () => {
    const out = sanitizeCalendarText('x'.repeat(50), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith('…')).toBe(true);
  });

  it('leaves short text unchanged', () => {
    expect(sanitizeCalendarText('Μαρία', 10)).toBe('Μαρία');
  });
});

describe('formatClientLabel', () => {
  it('uses the name when present', () => {
    expect(formatClientLabel('Μαρία', '123')).toBe('Μαρία');
  });

  it('falls back to Πελάτης <id> when name is missing or blank', () => {
    expect(formatClientLabel(null, '123')).toBe('Πελάτης 123');
    expect(formatClientLabel(undefined, '123')).toBe('Πελάτης 123');
    expect(formatClientLabel('  ', '123')).toBe('Πελάτης 123');
  });

  it('flattens newlines in names', () => {
    expect(formatClientLabel('Μαρία\nΠαπά', '123')).toBe('Μαρία Παπά');
  });
});

describe('owner event content', () => {
  it('builds the summary as service — client', () => {
    expect(buildOwnerEventSummary('Reformer Pilates', 'Μαρία')).toBe('Reformer Pilates — Μαρία');
  });

  it('builds the description as business newline service with no location', () => {
    expect(buildOwnerEventDescription('Pilates Athens', 'Reformer Pilates')).toBe('Pilates Athens\nReformer Pilates');
  });
});

describe('addMinutesToLocalTime', () => {
  it('rolls over midnight', () => {
    expect(addMinutesToLocalTime('2026-07-10', '23:30', 60)).toEqual({ date: '2026-07-11', time: '00:30' });
  });

  it('adds within the same day', () => {
    expect(addMinutesToLocalTime('2026-07-10', '10:00', 50)).toEqual({ date: '2026-07-10', time: '10:50' });
  });
});

describe('toGoogleTemplateDateTime', () => {
  it('formats YYYYMMDDTHHMM00', () => {
    expect(toGoogleTemplateDateTime('2026-07-10', '10:00')).toBe('20260710T100000');
  });
});
