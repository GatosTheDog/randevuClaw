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

// formatExpiryDateGreek: formats a Date as DD/MM/YYYY in the Europe/Athens
// timezone. Uses 'en-GB' locale which naturally produces DD/MM/YYYY output —
// no manual string reassembly needed. Consumed by checkMembershipBalanceTool
// (Plan 02) and the membership-expiry sweep (Plan 03) for human-readable
// Greek messages (e.g. "Λήγει: 14/08/2026").
export function formatExpiryDateGreek(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Athens',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

// Phase 29 (D-02): canonical hoursUntilSession export. This consolidates two
// byte-for-byte-identical inline copies — src/telegram/handlers/client-menu.ts's
// local `hoursUntilSession` and src/conversation/function-executor.ts's local
// `hoursUntilSessionInAthens` — into a single shared implementation. The
// algorithm itself is unchanged (relocated verbatim, not rewritten): anchor at
// noon UTC on sessionDate to read the Athens hour at that instant (via Intl),
// derive the current UTC offset from that, then compute the session's UTC
// timestamp and diff against "now" in hours. Wave 2 plans of Phase 29 delete
// the two inline copies and import this instead.
//
// Returns a positive number when the session is still in the future, negative
// when it has already started/passed. Callers needing a strict "has not yet
// started" check should use `> 0` (see listSessions' excludePastToday below).
export function hoursUntilSession(sessionDate: string, sessionTime: string): number {
  const noonUTC = new Date(`${sessionDate}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Athens',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(noonUTC);
  const athensHour = Number.parseInt(parts.find((p) => p.type === 'hour')!.value, 10);
  const offsetHours = athensHour - 12;
  const [hh, mm] = sessionTime.split(':').map(Number);
  const sessionUTCMs =
    Date.parse(
      `${sessionDate}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`
    ) -
    offsetHours * 3_600_000;
  return (sessionUTCMs - Date.now()) / 3_600_000;
}
