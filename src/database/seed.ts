import { eq } from 'drizzle-orm';
import { businesses, services, businessHours } from './schema';
import { db } from './db';
import { logger } from '../utils/logger';
import { config } from '../config';
import { findBusinessBySlug } from './queries';

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

interface ServiceFixture {
  name: string;
  durationMin: number;
  price: number;
}

// Phase 2 (D-12/D-14): realistic Greek services with distinct durations, per fixture.
const SERVICE_FIXTURES: Record<string, ServiceFixture[]> = {
  'pilates-athens': [
    { name: 'Ομαδικό Pilates', durationMin: 55, price: 1500 },
    { name: 'Ιδιαίτερο Pilates', durationMin: 60, price: 3500 },
    { name: 'Reformer Pilates', durationMin: 50, price: 2500 },
  ],
  'hair-salon-athens': [
    { name: 'Κούρεμα Γυναικείο', durationMin: 45, price: 2500 },
    { name: 'Κούρεμα Ανδρικό', durationMin: 30, price: 1500 },
    { name: 'Βαφή Μαλλιών', durationMin: 90, price: 5500 },
  ],
};

interface HoursFixture {
  dayOfWeek: number; // JS Date.getDay() convention: 0=Sunday..6=Saturday
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

// Phase 2 (D-12/D-14): realistic weekly hours, one closed day minimum, per fixture.
// Closed days still get a row (placeholder 00:00/00:00 times) so
// findBusinessHoursForDay always finds a row for every day.
const HOURS_FIXTURES: Record<string, HoursFixture[]> = {
  'pilates-athens': [
    { dayOfWeek: 0, openTime: '00:00', closeTime: '00:00', isClosed: true }, // Sunday: closed
    { dayOfWeek: 1, openTime: '08:00', closeTime: '21:00', isClosed: false },
    { dayOfWeek: 2, openTime: '08:00', closeTime: '21:00', isClosed: false },
    { dayOfWeek: 3, openTime: '08:00', closeTime: '21:00', isClosed: false },
    { dayOfWeek: 4, openTime: '08:00', closeTime: '21:00', isClosed: false },
    { dayOfWeek: 5, openTime: '08:00', closeTime: '21:00', isClosed: false },
    { dayOfWeek: 6, openTime: '09:00', closeTime: '14:00', isClosed: false },
  ],
  'hair-salon-athens': [
    { dayOfWeek: 0, openTime: '00:00', closeTime: '00:00', isClosed: true }, // Sunday: closed
    { dayOfWeek: 1, openTime: '00:00', closeTime: '00:00', isClosed: true }, // Monday: closed
    { dayOfWeek: 2, openTime: '09:00', closeTime: '19:00', isClosed: false },
    { dayOfWeek: 3, openTime: '09:00', closeTime: '19:00', isClosed: false },
    { dayOfWeek: 4, openTime: '09:00', closeTime: '19:00', isClosed: false },
    { dayOfWeek: 5, openTime: '09:00', closeTime: '19:00', isClosed: false },
    { dayOfWeek: 6, openTime: '09:00', closeTime: '17:00', isClosed: false },
  ],
};

/**
 * Idempotently seed the two Phase 1 fixture businesses, plus (Phase 2) their
 * owner Telegram contact, services, and weekly business hours. Safe to
 * re-run: checks existing rows before inserting, so re-running never
 * duplicates rows.
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

  // Backfill owner Telegram contact for both fixtures, every run — safe to
  // re-run unconditionally since it's an idempotent UPDATE, not an insert.
  for (const fixture of FIXTURES) {
    await db
      .update(businesses)
      .set({ ownerTelegramId: config.ownerTelegramId })
      .where(eq(businesses.slug, fixture.slug));
  }

  // Seed services + business hours per fixture, guarded by an existing-rows
  // check per business. Batch all still-needed rows into a single insert
  // call per table so re-running seed() is a true no-op (0 further insert
  // calls) once every fixture already has rows.
  const serviceRowsToInsert: Array<{
    businessId: number;
    name: string;
    durationMin: number;
    price: number;
  }> = [];
  const hoursRowsToInsert: Array<{
    businessId: number;
    dayOfWeek: number;
    openTime: string;
    closeTime: string;
    isClosed: boolean;
  }> = [];

  for (const fixture of FIXTURES) {
    const business = await findBusinessBySlug(fixture.slug);
    if (!business) {
      logger.warn(
        { slug: fixture.slug },
        'Fixture business not found, skipping services/hours seed'
      );
      continue;
    }

    const existingServices = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.businessId, business.id));

    if (existingServices.length === 0) {
      for (const service of SERVICE_FIXTURES[fixture.slug] ?? []) {
        serviceRowsToInsert.push({ businessId: business.id, ...service });
      }
    }

    const existingHours = await db
      .select({ id: businessHours.id })
      .from(businessHours)
      .where(eq(businessHours.businessId, business.id));

    if (existingHours.length === 0) {
      for (const hours of HOURS_FIXTURES[fixture.slug] ?? []) {
        hoursRowsToInsert.push({ businessId: business.id, ...hours });
      }
    }
  }

  if (serviceRowsToInsert.length > 0) {
    await db.insert(services).values(serviceRowsToInsert);
    logger.info({ count: serviceRowsToInsert.length }, 'Services seeded');
  }

  if (hoursRowsToInsert.length > 0) {
    await db.insert(businessHours).values(hoursRowsToInsert);
    logger.info({ count: hoursRowsToInsert.length }, 'Business hours seeded');
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
