import { stripGreekDiacritics } from '../utils/diacritics';

// Matches the first hyphenated alphanumeric token (e.g. "pilates-athens").
// Requires at least one hyphen so standalone Greek words (no hyphen) are never matched.
const HYPHENATED_SLUG_RE = /\b[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)+\b/;

export function extractBusinessCode(messageText: string): string | null {
  const match = HYPHENATED_SLUG_RE.exec(messageText);
  return match ? match[0] : null;
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
