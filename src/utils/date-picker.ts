// Shared helpers for date-first inline-keyboard pickers (client booking flow,
// admin class-cancel flow). Both encode a date as a plain YYYYMMDD integer
// because the cmenu:/menu: callback_data pattern (^prefix:([\w:]+?)(?::(\d+))?$)
// only captures a trailing \d+ group — a "-"-separated ISO string wouldn't match.

import { weekdayOfIsoDate, addCalendarDays } from './timezone';

const GREEK_WEEKDAY_ABBR = ['Κυρ', 'Δευ', 'Τρι', 'Τετ', 'Πεμ', 'Παρ', 'Σαβ'];

export function formatDateButtonLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${GREEK_WEEKDAY_ABBR[weekdayOfIsoDate(isoDate)]} ${day}/${month}/${year}`;
}

export function dateToCallbackId(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

export function callbackIdToDate(id: number): string {
  const s = String(id);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

// Monday-first weekday header for the calendar grid.
const GREEK_WEEKDAY_HEADER = ['Δευ', 'Τρι', 'Τετ', 'Πεμ', 'Παρ', 'Σαβ', 'Κυρ'];

export interface CalendarButton {
  text: string;
  callback_data: string;
}

/**
 * Builds a week-per-row calendar grid (7 buttons per row, Monday first) from the
 * dates that have availability. Days with availability show their day number and
 * a `${pickPrefix}:${YYYYMMDD}` callback; every other cell is an inert "·" sending
 * `noopCallback`. Starts at the Monday of the earliest date and ends at the Sunday
 * of the latest. The 1st of a month shows "D/M" so month changes are visible.
 */
export function buildWeekGridRows(
  availableDates: string[],
  pickPrefix: string,
  noopCallback: string
): CalendarButton[][] {
  if (availableDates.length === 0) return [];
  const sorted = [...availableDates].sort();
  const available = new Set(sorted);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const mondayOffset = (weekdayOfIsoDate(first) + 6) % 7;
  let cursor = addCalendarDays(first, -mondayOffset);

  const rows: CalendarButton[][] = [
    GREEK_WEEKDAY_HEADER.map((text) => ({ text, callback_data: noopCallback })),
  ];
  while (cursor <= last) {
    const row: CalendarButton[] = [];
    for (let i = 0; i < 7; i++) {
      const [, month, day] = cursor.split('-');
      if (available.has(cursor)) {
        const label = day === '01' ? `1/${Number(month)}` : String(Number(day));
        row.push({ text: label, callback_data: `${pickPrefix}:${dateToCallbackId(cursor)}` });
      } else {
        row.push({ text: '·', callback_data: noopCallback });
      }
      cursor = addCalendarDays(cursor, 1);
    }
    rows.push(row);
  }
  return rows;
}
