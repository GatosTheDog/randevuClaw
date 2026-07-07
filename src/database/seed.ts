import { businesses } from './schema';
import { db } from './db';
import { logger } from '../utils/logger';

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

interface Fixture {
  name: string;
  slug: string;
}

// Phase 1 fixture businesses (D-14): name + slug only, no hours/services/prices (D-15).
const FIXTURES: Fixture[] = [
  { name: 'Pilates Athens', slug: 'pilates-athens' },
  { name: 'Hair Salon Athens', slug: 'hair-salon-athens' },
];

/**
 * Idempotently seed the two Phase 1 fixture businesses. Safe to re-run:
 * checks existing slugs before inserting, so re-running never duplicates rows.
 */
export async function seed(): Promise<void> {
  const existing = await db.select({ slug: businesses.slug }).from(businesses);
  const existingSlugs = existing.map((row) => row.slug);

  for (const fixture of FIXTURES) {
    if (existingSlugs.includes(fixture.slug)) {
      logger.info({ slug: fixture.slug }, 'Fixture business already exists, skipping');
      continue;
    }

    await db.insert(businesses).values({ name: fixture.name, slug: fixture.slug });
    logger.info({ slug: fixture.slug }, 'Fixture business seeded');
  }
}

// Entrypoint guard: only auto-run when invoked directly (`ts-node src/database/seed.ts`
// / `npm run db:seed`), not when imported by tests (tests/fixtures.test.ts imports
// `generateSlug`/`seed` and calls them explicitly against a mocked db).
if (require.main === module) {
  seed()
    .then(() => {
      logger.info('Seed complete');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err }, 'Seed failed');
      process.exit(1);
    });
}
