import { isoDateInAthens, weekdayOfIsoDate, addCalendarDays } from '../src/utils/timezone';

describe('isoDateInAthens', () => {
  it('returns the next Athens calendar day when UTC+2 pushes past midnight', () => {
    // Athens is UTC+2 in January, so 22:30 UTC is 00:30 the NEXT day in
    // Athens local time — proves this uses Intl/Athens tz, not naive UTC or
    // the server process's own local timezone.
    expect(isoDateInAthens(new Date('2026-01-15T22:30:00Z'))).toBe('2026-01-16');
  });

  it('formats a mid-day instant as the same calendar date', () => {
    expect(isoDateInAthens(new Date('2026-07-08T10:00:00Z'))).toBe('2026-07-08');
  });
});

describe('weekdayOfIsoDate', () => {
  it('returns 3 (Wednesday) for 2026-07-08', () => {
    expect(weekdayOfIsoDate('2026-07-08')).toBe(3);
  });

  it('returns 0 (Sunday) for 2026-07-12', () => {
    expect(weekdayOfIsoDate('2026-07-12')).toBe(0);
  });
});

describe('addCalendarDays', () => {
  it('adds days within the same month', () => {
    expect(addCalendarDays('2026-07-08', 5)).toBe('2026-07-13');
  });

  it('rolls over to the next month', () => {
    expect(addCalendarDays('2026-07-31', 1)).toBe('2026-08-01');
  });
});
