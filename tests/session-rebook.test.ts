import {
  GREEK_WEEKDAY_NAMES,
  previousMonthRange,
  weeklySlotKey,
  deriveWeeklySlots,
  groupUpcomingByWeeklySlot,
  buildRebookProposal,
  formatWeeklySlotLine,
} from '../src/session/rebook';
import type { SessionInstance } from '../src/session/manager';

function inst(
  instanceId: number,
  sessionDate: string,
  sessionTime: string,
  opts: { bookedCount?: number; capacity?: number; serviceId?: number } = {}
): SessionInstance {
  return {
    instanceId,
    catalogId: 1,
    sessionDate,
    sessionTime,
    bookedCount: opts.bookedCount ?? 0,
    capacity: opts.capacity ?? 10,
    serviceId: opts.serviceId ?? 3,
  };
}

describe('previousMonthRange', () => {
  it('returns the previous calendar month for a mid-month date', () => {
    expect(previousMonthRange('2026-10-08')).toEqual({
      start: '2026-09-01',
      end: '2026-09-30',
      monthLabel: '2026-09',
    });
  });

  it('rolls back over the year boundary', () => {
    const r = previousMonthRange('2026-01-15');
    expect(r.start).toBe('2025-12-01');
    expect(r.end).toBe('2025-12-31');
    expect(r.monthLabel).toBe('2025-12');
  });

  it('handles February in a non-leap year', () => {
    expect(previousMonthRange('2026-03-01').end).toBe('2026-02-28');
  });

  it('handles February in a leap year', () => {
    expect(previousMonthRange('2028-03-05').end).toBe('2028-02-29');
  });

  it('behaves the same on the 1st and on the 31st of a month', () => {
    const a = previousMonthRange('2026-10-01');
    const b = previousMonthRange('2026-10-31');
    const c = previousMonthRange('2026-10-15');
    expect(a).toEqual(c);
    expect(b).toEqual(c);
  });
});

describe('GREEK_WEEKDAY_NAMES / formatWeeklySlotLine', () => {
  it('is indexed 0=Κυριακή..6=Σάββατο', () => {
    expect(GREEK_WEEKDAY_NAMES).toHaveLength(7);
    expect(GREEK_WEEKDAY_NAMES[0]).toBe('Κυριακή');
    expect(GREEK_WEEKDAY_NAMES[1]).toBe('Δευτέρα');
    expect(GREEK_WEEKDAY_NAMES[6]).toBe('Σάββατο');
  });

  it('formats a slot line with an em dash', () => {
    expect(
      formatWeeklySlotLine({ weekday: 1, time: '18:00', serviceId: 3 }, 'Reformer Pilates')
    ).toBe('Δευτέρα 18:00 — Reformer Pilates');
  });
});

describe('weeklySlotKey', () => {
  it('is stable and distinct per (weekday, time, serviceId)', () => {
    const a = weeklySlotKey({ weekday: 1, time: '18:00', serviceId: 3 });
    expect(weeklySlotKey({ weekday: 1, time: '18:00', serviceId: 3 })).toBe(a);
    expect(weeklySlotKey({ weekday: 2, time: '18:00', serviceId: 3 })).not.toBe(a);
    expect(weeklySlotKey({ weekday: 1, time: '19:00', serviceId: 3 })).not.toBe(a);
    expect(weeklySlotKey({ weekday: 1, time: '18:00', serviceId: 4 })).not.toBe(a);
  });
});

describe('deriveWeeklySlots', () => {
  it('returns [] for empty input', () => {
    expect(deriveWeeklySlots([])).toEqual([]);
  });

  it('groups by weekday+time+service and counts occurrences, Monday-first', () => {
    const slots = deriveWeeklySlots([
      { calendarDate: '2026-09-07', calendarTime: '18:00', serviceId: 3 }, // Mon
      { calendarDate: '2026-09-14', calendarTime: '18:00', serviceId: 3 }, // Mon
      { calendarDate: '2026-09-09', calendarTime: '19:00', serviceId: 3 }, // Wed
      { calendarDate: '2026-09-21', calendarTime: '18:00', serviceId: 4 }, // Mon, other svc
    ]);
    expect(slots).toEqual([
      { weekday: 1, time: '18:00', serviceId: 3, previousCount: 2 },
      { weekday: 1, time: '18:00', serviceId: 4, previousCount: 1 },
      { weekday: 3, time: '19:00', serviceId: 3, previousCount: 1 },
    ]);
  });

  it('places Sunday after Saturday', () => {
    const slots = deriveWeeklySlots([
      { calendarDate: '2026-09-06', calendarTime: '10:00', serviceId: 3 }, // Sun
      { calendarDate: '2026-09-05', calendarTime: '10:00', serviceId: 3 }, // Sat
      { calendarDate: '2026-09-07', calendarTime: '10:00', serviceId: 3 }, // Mon
    ]);
    expect(slots.map((s) => s.weekday)).toEqual([1, 6, 0]);
  });
});

describe('groupUpcomingByWeeklySlot', () => {
  const slot = { weekday: 1, time: '18:00', serviceId: 3 };
  const key = weeklySlotKey(slot);

  it('classifies open, full, already_booked and post-expiry instances', () => {
    const upcoming = [
      inst(1, '2026-10-12', '18:00', { bookedCount: 2 }), // open
      inst(2, '2026-10-19', '18:00', { bookedCount: 10 }), // full
      inst(3, '2026-10-26', '18:00'), // held
      inst(4, '2026-11-02', '18:00'), // after expiry
      inst(5, '2026-10-13', '18:00'), // Tuesday -> other slot
    ];
    const grouped = groupUpcomingByWeeklySlot(upcoming, new Set([3]), '2026-10-31');
    const g = grouped.get(key)!;
    expect(g.instances).toEqual([
      { instanceId: 1, sessionDate: '2026-10-12', sessionTime: '18:00', spotsLeft: 8 },
    ]);
    expect(g.unavailable).toEqual([
      { sessionDate: '2026-10-19', sessionTime: '18:00', reason: 'full' },
      { sessionDate: '2026-10-26', sessionTime: '18:00', reason: 'already_booked' },
      { sessionDate: '2026-11-02', sessionTime: '18:00', reason: 'after_membership_expiry' },
    ]);
    expect(grouped.size).toBe(2);
  });

  it('applies precedence already_booked > after_membership_expiry > full', () => {
    const upcoming = [
      inst(1, '2026-11-02', '18:00', { bookedCount: 10 }), // expired + full
      inst(2, '2026-11-09', '18:00', { bookedCount: 10 }), // held + expired + full
    ];
    const grouped = groupUpcomingByWeeklySlot(upcoming, new Set([2]), '2026-10-31');
    const g = grouped.get(key)!;
    expect(g.unavailable.map((u) => u.reason)).toEqual([
      'after_membership_expiry',
      'already_booked',
    ]);
  });

  it('null expiry date disables the cap', () => {
    const grouped = groupUpcomingByWeeklySlot([inst(1, '2027-01-04', '18:00')], new Set(), null);
    expect(grouped.get(key)!.instances).toHaveLength(1);
  });
});

describe('buildRebookProposal', () => {
  it('maps previous slots to groups and lists only new bookable slots as other', () => {
    const upcoming = [
      inst(1, '2026-10-12', '18:00'), // Mon 18:00 (previous)
      inst(2, '2026-10-14', '19:00'), // Wed 19:00 (other)
      inst(3, '2026-10-15', '20:00', { bookedCount: 10 }), // Thu 20:00 full -> not offered
      inst(4, '2026-10-16', '09:00'), // Fri 09:00 (other)
      inst(5, '2026-10-11', '10:00'), // Sun 10:00 (other)
    ];
    const previous = deriveWeeklySlots([
      { calendarDate: '2026-09-07', calendarTime: '18:00', serviceId: 3 },
      { calendarDate: '2026-09-08', calendarTime: '07:00', serviceId: 3 }, // Tue, no upcoming
    ]);
    const grouped = groupUpcomingByWeeklySlot(upcoming, new Set(), null);
    const proposal = buildRebookProposal(previous, grouped);

    expect(proposal.previous).toHaveLength(2);
    expect(proposal.previous[0].weekday).toBe(1);
    expect(proposal.previous[0].previousCount).toBe(1);
    expect(proposal.previous[0].instances.map((i) => i.instanceId)).toEqual([1]);
    expect(proposal.previous[1].weekday).toBe(2);
    expect(proposal.previous[1].instances).toEqual([]);
    expect(proposal.previous[1].unavailable).toEqual([]);

    expect(proposal.other.map((o) => [o.weekday, o.time])).toEqual([
      [3, '19:00'],
      [5, '09:00'],
      [0, '10:00'],
    ]);
  });
});
