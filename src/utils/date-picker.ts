// Shared helpers for date-first inline-keyboard pickers (client booking flow,
// admin class-cancel flow). Both encode a date as a plain YYYYMMDD integer
// because the cmenu:/menu: callback_data pattern (^prefix:([\w:]+?)(?::(\d+))?$)
// only captures a trailing \d+ group — a "-"-separated ISO string wouldn't match.

import { weekdayOfIsoDate } from './timezone';

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
