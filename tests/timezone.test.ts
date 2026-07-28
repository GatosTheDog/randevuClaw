import { isoDateInAthens, weekdayOfIsoDate, addCalendarDays, hoursUntilSession } from '../src/utils/timezone';

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

// Phase 29 (D-02): hoursUntilSession is the canonical consolidated export —
// see the doc comment on the function itself for the two inline copies this
// replaces (client-menu.ts, function-executor.ts).
describe('hoursUntilSession', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns a large positive number for a far-future session', () => {
    expect(hoursUntilSession('2099-01-01', '10:00')).toBeGreaterThan(100_000);
  });

  it('returns a large negative number for a far-past session', () => {
    expect(hoursUntilSession('2000-01-01', '10:00')).toBeLessThan(-100_000);
  });

  it('returns a small positive number for a same-day session 5 minutes in the future (Athens)', () => {
    // 2026-07-09T10:00:00Z = 13:00 Athens (UTC+3, summer DST)
    jest.useFakeTimers().setSystemTime(new Date('2026-07-09T10:00:00Z'));
    const hours = hoursUntilSession('2026-07-09', '13:05');
    expect(hours).toBeGreaterThan(0);
    expect(hours).toBeLessThan(0.2);
  });

  it('returns a small negative number for a same-day session 5 minutes in the past (Athens)', () => {
    // 2026-07-09T10:00:00Z = 13:00 Athens (UTC+3, summer DST)
    jest.useFakeTimers().setSystemTime(new Date('2026-07-09T10:00:00Z'));
    const hours = hoursUntilSession('2026-07-09', '12:55');
    expect(hours).toBeLessThan(0);
    expect(hours).toBeGreaterThan(-0.2);
  });

  it('returns exactly 0 (not negative) when the session time equals the current Athens minute', () => {
    // 2026-07-09T10:00:00Z = 13:00 Athens (UTC+3, summer DST). The strict `> 0`
    // boundary choice used by listSessions' excludePastToday lives at the call
    // site, not here — this test just proves the raw helper returns 0 exactly.
    jest.useFakeTimers().setSystemTime(new Date('2026-07-09T10:00:00Z'));
    const hours = hoursUntilSession('2026-07-09', '13:00');
    expect(hours).toBe(0);
  });

  it('stays DST-safe across the Europe/Athens spring-forward transition (2026-03-29)', () => {
    // Greece switches from EET (UTC+2) to EEST (UTC+3) on the last Sunday of
    // March. "Now" is 2026-03-28T10:00 Athens (still EET); the session is the
    // next day at 10:00 Athens (already EEST) — only 23 real elapsed hours
    // pass, not 24, because the clock skips an hour during the transition.
    jest.useFakeTimers().setSystemTime(new Date('2026-03-28T08:00:00Z')); // 10:00 EET
    const hours = hoursUntilSession('2026-03-29', '10:00');
    expect(hours).toBeGreaterThan(22);
    expect(hours).toBeLessThan(24);
  });
});
