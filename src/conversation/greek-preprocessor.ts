import { stripGreekDiacritics } from '../utils/diacritics';
import { isoDateInAthens, weekdayOfIsoDate, addCalendarDays } from '../utils/timezone';

export interface TemporalResolution {
  resolvedDate: string | null;
  resolvedTime: string | null;
  annotatedText: string;
}

// Order matters: "μεθαυριο" (the day after tomorrow) contains "αυριο"
// (tomorrow) as a substring, so it must be checked first or every
// "μεθαύριο" phrase would incorrectly resolve to +1 day instead of +2.
const RELATIVE_DAY_PATTERNS: Array<{ test: RegExp; offset: (match: RegExpMatchArray) => number }> = [
  { test: /σημερα/, offset: () => 0 },
  { test: /μεθαυριο/, offset: () => 2 },
  { test: /αυριο/, offset: () => 1 },
  { test: /σε\s+(\d+)\s+μερ(?:ες|ας)/, offset: (m) => parseInt(m[1], 10) },
];

// Diacritic-stripped stem prefixes so nominative ("Παρασκευή"), genitive
// ("Παρασκευής"), and uppercase ("ΠΑΡΑΣΚΕΥΉ") forms all match the same stem.
// Target values match weekdayOfIsoDate's Date.getDay() convention.
const WEEKDAY_STEMS: Array<[string, number]> = [
  ['κυριακ', 0],
  ['δευτερ', 1],
  ['τριτ', 2],
  ['τεταρτ', 3],
  ['πεμπτ', 4],
  ['παρασκευ', 5],
  ['σαββατ', 6],
];

// Time is only extracted from one of these three shapes, tried in order:
// 1. Anything following the word "στις" (the common "at <time>" construct).
// 2. A bare number immediately followed by an am/pm marker, anywhere in the
//    text (handles weekday-then-bare-time word order with no "στις").
// 3. A bare number (marker optional) at the very start of the text (handles
//    time-before-weekday word order like "10 το πρωί την Παρασκευή").
// Requiring "στις" or a marker or leading position (rather than matching any
// bare digit anywhere) is what keeps stray numbers like the "3" in
// "σε 3 μέρες" from being misread as a clock time.
const TIME_PATTERNS: RegExp[] = [
  /στις\s+(\d{1,2})(?::(\d{2}))?\s*(π\.?\s?μ\.?|μ\.?\s?μ\.?)?/,
  /(\d{1,2})(?::(\d{2}))?\s*(π\.?\s?μ\.?|μ\.?\s?μ\.?)/,
  /^(\d{1,2})(?::(\d{2}))?\s*(π\.?\s?μ\.?|μ\.?\s?μ\.?)?/,
];

// Matches an explicit DD/MM (or DD-MM) numeric date anywhere in the text —
// this codebase's DD/MM/YYYY convention (see formatExpiryDateGreek). Not
// anchored, so a phrase like "τι έχω στις 7/9" still matches.
const EXPLICIT_NUMERIC_DATE_PATTERN = /\b(\d{1,2})[/-](\d{1,2})\b/;

/**
 * Resolves an explicit numeric DD/MM (or DD-MM) date to an ISO
 * (YYYY-MM-DD) string, rolling over to next year when the day/month has
 * already passed this year relative to `referenceDate`. Returns null when
 * no numeric date is present, or when the day/month combination is not a
 * real calendar date in either the current or the next year.
 */
function resolveExplicitNumericDate(normalizedText: string, referenceDate: Date): string | null {
  const match = normalizedText.match(EXPLICIT_NUMERIC_DATE_PATTERN);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const todayIso = isoDateInAthens(referenceDate);
  const currentYear = parseInt(todayIso.slice(0, 4), 10);

  const buildCandidate = (year: number): string | null => {
    const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const roundTrip = new Date(`${candidate}T12:00:00Z`);
    if (
      roundTrip.getUTCFullYear() !== year ||
      roundTrip.getUTCMonth() + 1 !== month ||
      roundTrip.getUTCDate() !== day
    ) {
      return null;
    }
    return candidate;
  };

  const currentYearCandidate = buildCandidate(currentYear);
  if (currentYearCandidate !== null && currentYearCandidate >= todayIso) {
    return currentYearCandidate;
  }

  return buildCandidate(currentYear + 1);
}

function resolveDate(normalizedText: string, referenceDate: Date): string | null {
  const todayIso = isoDateInAthens(referenceDate);

  for (const pattern of RELATIVE_DAY_PATTERNS) {
    const match = normalizedText.match(pattern.test);
    if (match) {
      return addCalendarDays(todayIso, pattern.offset(match));
    }
  }

  for (const [stem, target] of WEEKDAY_STEMS) {
    if (normalizedText.includes(stem)) {
      for (let offset = 0; offset <= 6; offset++) {
        const candidate = addCalendarDays(todayIso, offset);
        if (weekdayOfIsoDate(candidate) === target) {
          return candidate;
        }
      }
    }
  }

  return null;
}

/**
 * Deterministically resolves an owner's raw free-text date phrase (e.g.
 * "7/9", "Δευτέρα", "αύριο") to an ISO (YYYY-MM-DD) date — never trusting
 * Gemini to compute the date/weekday itself. Explicit numeric DD/MM dates
 * take priority (unambiguous); otherwise falls back to the same
 * relative-day-word/Greek-weekday-stem resolution `resolveDate` already
 * uses for the client-facing booking flow. Returns null when nothing
 * resolves, so the caller can ask the owner to clarify.
 */
export function resolveOwnerDateQuery(dateQuery: string, referenceDate: Date): string | null {
  const normalizedText = stripGreekDiacritics(dateQuery).toLowerCase();
  return resolveExplicitNumericDate(normalizedText, referenceDate) ?? resolveDate(normalizedText, referenceDate);
}

function formatHour(hour: number, minutes: string): string {
  return `${String(hour).padStart(2, '0')}:${minutes}`;
}

function resolveHourToTime(hour: number, minutes: string, marker: string | undefined, normalizedText: string): string {
  if (marker) {
    const normalizedMarker = marker.replace(/[.\s]/g, '');
    if (normalizedMarker === 'πμ') {
      // Explicit π.μ./πμ: hour as-is, except 12 π.μ. is midnight.
      return hour === 12 ? '00:00' : formatHour(hour, minutes);
    }
    // Explicit μ.μ./μμ: add 12 unless already in 12h PM form.
    return hour < 12 ? formatHour(hour + 12, minutes) : formatHour(hour, minutes);
  }

  if (normalizedText.includes('πρωι')) {
    return hour === 12 ? '00:00' : formatHour(hour, minutes);
  }
  if (
    normalizedText.includes('απογευμα') ||
    normalizedText.includes('μεσημερι') ||
    normalizedText.includes('βραδυ')
  ) {
    return hour < 12 ? formatHour(hour + 12, minutes) : formatHour(hour, minutes);
  }

  // CR-05 fix: an hour already in unambiguous 24-hour form (13-23) must
  // never have 12 added again by the bare-hour heuristic below — otherwise
  // ordinary phrasing like "στις 20" would produce an invalid time like "32:00".
  if (hour >= 13 && hour <= 23) return formatHour(hour, minutes);

  // Bare-hour heuristic, no marker and no time-of-day context word: noon
  // never resolves to midnight, 8-11 reads as morning, 1-7 reads as evening.
  if (hour === 12) return formatHour(12, minutes);
  if (hour >= 8 && hour <= 11) return formatHour(hour, minutes);
  return formatHour(hour + 12, minutes);
}

function resolveTime(normalizedText: string): string | null {
  for (const pattern of TIME_PATTERNS) {
    const match = normalizedText.match(pattern);
    if (match) {
      const hour = parseInt(match[1], 10);
      const minutes = match[2] ?? '00';
      const marker = match[3];
      return resolveHourToTime(hour, minutes, marker, normalizedText);
    }
  }
  return null;
}

export function resolveGreekTemporalExpressions(
  text: string,
  referenceDate: Date
): TemporalResolution {
  const normalizedText = stripGreekDiacritics(text).toLowerCase();

  const resolvedDate = resolveDate(normalizedText, referenceDate);
  const resolvedTime = resolveTime(normalizedText);

  const annotatedText =
    resolvedDate !== null || resolvedTime !== null
      ? `${text} [ΣΥΣΤΗΜΑ: πιθανή ημερομηνία=${resolvedDate ?? 'άγνωστη'}, πιθανή ώρα=${resolvedTime ?? 'άγνωστη'}]`
      : text;

  return { resolvedDate, resolvedTime, annotatedText };
}
