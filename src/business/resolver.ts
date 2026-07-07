import { stripGreekDiacritics } from '../utils/diacritics';

// Matches hyphenated alphanumeric tokens (e.g. "pilates-athens").
// Requires at least one hyphen so standalone Greek words (no hyphen) are never matched.
const HYPHENATED_SLUG_RE = /\b[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)+\b/;
// Global variant for matchAll — used to collect every candidate rather than
// just the first (WR-02), since a distractor token (phone fragment, date,
// order code) appearing earlier in free-form Greek text would otherwise
// shadow the real business slug.
const HYPHENATED_SLUG_RE_GLOBAL = /\b[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)+\b/g;

export function extractBusinessCode(messageText: string): string | null {
  const match = HYPHENATED_SLUG_RE.exec(messageText);
  return match ? match[0] : null;
}

export function extractAllBusinessCodeCandidates(messageText: string): string[] {
  return [...messageText.matchAll(HYPHENATED_SLUG_RE_GLOBAL)].map((m) => m[0]);
}

export function normalizeBusinessCode(raw: string): string {
  return stripGreekDiacritics(raw)
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .trim();
}

export function extractAndNormalizeBusinessCode(messageText: string): string | null {
  // Normalize dash variants in the full message before extraction so that
  // slugs written with en/em-dash (e.g. "pilates–athens") are matched by
  // the ASCII-hyphen extraction regex.
  const normalizedText = messageText.replace(/[–—]/g, '-');
  const raw = extractBusinessCode(normalizedText);
  return raw ? normalizeBusinessCode(raw) : null;
}

// Returns every normalized hyphenated candidate in the message, in order of
// appearance, so the caller can try each against findBusinessBySlug instead
// of assuming the first candidate is always the real slug (WR-02).
export function extractAndNormalizeAllBusinessCodeCandidates(messageText: string): string[] {
  const normalizedText = messageText.replace(/[–—]/g, '-');
  return extractAllBusinessCodeCandidates(normalizedText).map(normalizeBusinessCode);
}
