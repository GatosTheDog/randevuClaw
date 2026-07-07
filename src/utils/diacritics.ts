// NFD decomposes precomposed characters (e.g. Ά → Α + ◌́), then the
// Unicode property \p{M} matches all combining marks so they can be stripped.
// Works for both Greek tonos and Latin diacritics without an external library.
export function stripGreekDiacritics(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '');
}
