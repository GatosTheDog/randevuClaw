// Pure helpers for the "rebook last month's slots" client flow (quick-261008-gqb).
//
// No database, Telegram, config or clock access lives here: callers pass
// today's ISO date in. All weekday arithmetic is done on the server so the
// LLM never has to derive a weekday from a date (see quick-260908-dxa).
import { weekdayOfIsoDate, addCalendarDays } from '../utils/timezone';
import type { SessionInstance } from './manager';

// Indexed exactly like weekdayOfIsoDate: 0 = Sunday .. 6 = Saturday.
export const GREEK_WEEKDAY_NAMES = [
  'Κυριακή',
  'Δευτέρα',
  'Τρίτη',
  'Τετάρτη',
  'Πέμπτη',
  'Παρασκευή',
  'Σάββατο',
] as const;

export interface WeeklySlot {
  weekday: number;
  time: string;
  serviceId: number;
}

export interface PreviousWeeklySlot extends WeeklySlot {
  previousCount: number;
}

export interface SlotInstanceView {
  instanceId: number;
  sessionDate: string;
  sessionTime: string;
  spotsLeft: number;
}

export type SlotUnavailableReason = 'full' | 'already_booked' | 'after_membership_expiry';

export interface SlotUnavailableView {
  sessionDate: string;
  sessionTime: string;
  reason: SlotUnavailableReason;
}

export interface UpcomingSlotGroup extends WeeklySlot {
  instances: SlotInstanceView[];
  unavailable: SlotUnavailableView[];
}

export interface PreviousSlotGroup extends UpcomingSlotGroup {
  previousCount: number;
}

export interface RebookProposal {
  previous: PreviousSlotGroup[];
  other: UpcomingSlotGroup[];
}

export function previousMonthRange(todayIso: string): {
  start: string;
  end: string;
  monthLabel: string;
} {
  const firstOfCurrent = `${todayIso.slice(0, 8)}01`;
  const end = addCalendarDays(firstOfCurrent, -1);
  const start = `${end.slice(0, 8)}01`;
  return { start, end, monthLabel: end.slice(0, 7) };
}

export function weeklySlotKey(slot: WeeklySlot): string {
  return `${slot.weekday}|${slot.time}|${slot.serviceId}`;
}

// Monday-first ordering: Mon..Sat, then Sunday.
function mondayFirst(weekday: number): number {
  return (weekday + 6) % 7;
}

function compareSlots(a: WeeklySlot, b: WeeklySlot): number {
  return (
    mondayFirst(a.weekday) - mondayFirst(b.weekday) ||
    (a.time < b.time ? -1 : a.time > b.time ? 1 : 0) ||
    a.serviceId - b.serviceId
  );
}

export function deriveWeeklySlots(
  rows: ReadonlyArray<{ calendarDate: string; calendarTime: string; serviceId: number }>
): PreviousWeeklySlot[] {
  const map = new Map<string, PreviousWeeklySlot>();
  for (const row of rows) {
    const slot: WeeklySlot = {
      weekday: weekdayOfIsoDate(row.calendarDate),
      time: row.calendarTime,
      serviceId: row.serviceId,
    };
    const key = weeklySlotKey(slot);
    const existing = map.get(key);
    if (existing) {
      existing.previousCount += 1;
    } else {
      map.set(key, { ...slot, previousCount: 1 });
    }
  }
  return Array.from(map.values()).sort(compareSlots);
}

export function groupUpcomingByWeeklySlot(
  upcoming: ReadonlyArray<SessionInstance>,
  heldInstanceIds: ReadonlySet<number>,
  membershipExpiryDate: string | null
): Map<string, UpcomingSlotGroup> {
  const groups = new Map<string, UpcomingSlotGroup>();
  for (const inst of upcoming) {
    const slot: WeeklySlot = {
      weekday: weekdayOfIsoDate(inst.sessionDate),
      time: inst.sessionTime,
      serviceId: inst.serviceId,
    };
    const key = weeklySlotKey(slot);
    let group = groups.get(key);
    if (!group) {
      group = { ...slot, instances: [], unavailable: [] };
      groups.set(key, group);
    }
    let reason: SlotUnavailableReason | null = null;
    if (heldInstanceIds.has(inst.instanceId)) {
      reason = 'already_booked';
    } else if (membershipExpiryDate !== null && inst.sessionDate > membershipExpiryDate) {
      reason = 'after_membership_expiry';
    } else if (inst.bookedCount >= inst.capacity) {
      reason = 'full';
    }
    if (reason) {
      group.unavailable.push({
        sessionDate: inst.sessionDate,
        sessionTime: inst.sessionTime,
        reason,
      });
    } else {
      group.instances.push({
        instanceId: inst.instanceId,
        sessionDate: inst.sessionDate,
        sessionTime: inst.sessionTime,
        spotsLeft: inst.capacity - inst.bookedCount,
      });
    }
  }
  return groups;
}

export function buildRebookProposal(
  previousSlots: ReadonlyArray<PreviousWeeklySlot>,
  grouped: ReadonlyMap<string, UpcomingSlotGroup>
): RebookProposal {
  const previousKeys = new Set<string>();
  const previous: PreviousSlotGroup[] = previousSlots.map((p) => {
    const key = weeklySlotKey(p);
    previousKeys.add(key);
    const g = grouped.get(key);
    return {
      weekday: p.weekday,
      time: p.time,
      serviceId: p.serviceId,
      previousCount: p.previousCount,
      instances: g ? g.instances : [],
      unavailable: g ? g.unavailable : [],
    };
  });
  const other = Array.from(grouped.entries())
    .filter(([key, g]) => !previousKeys.has(key) && g.instances.length > 0)
    .map(([, g]) => g)
    .sort(compareSlots);
  return { previous, other };
}

export function formatWeeklySlotLine(slot: WeeklySlot, serviceName: string): string {
  return `${GREEK_WEEKDAY_NAMES[slot.weekday]} ${slot.time} — ${serviceName}`;
}
