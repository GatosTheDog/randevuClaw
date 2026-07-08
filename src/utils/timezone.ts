// DST-safe Europe/Athens calendar-date arithmetic with zero new date-library
// dependency. Every function here is deliberately independent of the server
// process's own local timezone (a fly.io Machine runs UTC) so "today" always
// means "today in Athens", not "today on the host".

// `en-CA` is the one built-in Intl locale that formats a date as
// "YYYY-MM-DD" directly, so no manual string reassembly is needed.
export function isoDateInAthens(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Athens',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// Anchoring at T12:00:00Z guarantees the instant falls within the same
// Athens calendar day regardless of whether Athens is currently UTC+2 or
// UTC+3 (DST), so no Intl call is required here. Matches JS Date.getDay()
// convention: 0=Sunday..6=Saturday.
export function weekdayOfIsoDate(isoDate: string): number {
  return new Date(`${isoDate}T12:00:00Z`).getUTCDay();
}

// Same noon-UTC-anchor trick avoids any DST-driven off-by-one when adding
// calendar days (including month/year rollover).
export function addCalendarDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
