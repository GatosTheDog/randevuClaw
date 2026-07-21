// covers PAY-02 DST edge case
// Tests for DST-safe calendar-day arithmetic using Europe/Athens timezone:
// ensures addCalendarDays() does not produce off-by-one errors when the
// rolling expiry window crosses a DST boundary (last Sunday of October).
// CR-02: also covers athensEndOfDay UTC-hour assertions — verifying the
// Intl.DateTimeFormat implementation is server-timezone-independent.

import { addCalendarDays } from '../src/utils/timezone';
import { athensEndOfDay } from '../src/billing/queries';

describe('DST-safe date arithmetic', () => {
  it('Sept 22 + 30 calendar days = Oct 22 (does not cross DST boundary)', () => {
    // Greek DST ends last Sunday of October (2024-10-27).
    // Sept 22 + 30 = Oct 22, which is before the DST transition — no ambiguity.
    expect(addCalendarDays('2024-09-22', 30)).toBe('2024-10-22');
  });

  it('Oct 25 + 7 calendar days = Nov 1 (crosses Greek DST end Oct 27 2024, still correct)', () => {
    // Greek DST ends 2024-10-27 at 04:00 local time (clocks go back to 03:00).
    // Adding 7 calendar days to Oct 25 must produce Nov 1, not Oct 31 or Nov 2.
    expect(addCalendarDays('2024-10-25', 7)).toBe('2024-11-01');
  });

  it('addCalendarDays uses noon-UTC anchor to avoid off-by-one on DST transition nights', () => {
    // The noon-UTC anchor (T12:00:00Z) keeps the instant firmly within the
    // same calendar day regardless of whether Athens is at UTC+2 or UTC+3.
    // Day before DST transition: Oct 26 + 1 day should be Oct 27 (the transition day).
    expect(addCalendarDays('2024-10-26', 1)).toBe('2024-10-27');
    // DST transition day itself: Oct 27 + 1 day should be Oct 28.
    expect(addCalendarDays('2024-10-27', 1)).toBe('2024-10-28');
  });
});

// CR-02: athensEndOfDay UTC-hour assertions.
// These tests pin the expected UTC offset so any future regression (e.g.
// reverting to toLocaleString) is caught regardless of server timezone.
describe('athensEndOfDay UTC hour assertions', () => {
  it('summer date (UTC+3): end-of-day is 20:59:59 UTC', () => {
    // Greece is UTC+3 in summer (EEST). 23:59:59 Athens − 3h = 20:59:59 UTC.
    const result = athensEndOfDay('2024-07-01');
    expect(result.getUTCHours()).toBe(20);
    expect(result.getUTCMinutes()).toBe(59);
    expect(result.getUTCSeconds()).toBe(59);
  });

  it('winter date (UTC+2): end-of-day is 21:59:59 UTC', () => {
    // Greece is UTC+2 in winter (EET). 23:59:59 Athens − 2h = 21:59:59 UTC.
    const result = athensEndOfDay('2024-12-01');
    expect(result.getUTCHours()).toBe(21);
    expect(result.getUTCMinutes()).toBe(59);
    expect(result.getUTCSeconds()).toBe(59);
  });
});
