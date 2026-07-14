// Phase 5 (ONB-04): FIXTURES and seed() removed. Every business is created via
// the onboarding flow (src/webhooks/platform.ts). Tests use
// tests/helpers/test-business.ts insertTestBusiness() for DB setup.

/**
 * Slugify a business name, appending a numeric collision suffix (-2, -3, ...)
 * if the base slug already exists in `existingSlugs` (D-03).
 */
export function generateSlug(name: string, existingSlugs: string[]): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!existingSlugs.includes(base)) {
    return base;
  }

  let suffix = 2;
  let candidate = `${base}-${suffix}`;
  while (existingSlugs.includes(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}
