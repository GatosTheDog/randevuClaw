// tests/helpers/test-business.ts
// Replaces fixture/seed pattern (D-11): tests call insertTestBusiness() directly
// instead of relying on seed.ts FIXTURES. Each test file creates its own business
// in beforeAll/beforeEach — no shared state. Uses admin db (not appDb) so RLS
// context is not required for test setup writes.

import crypto from 'crypto';
import { db } from '../../src/database/db';
import { businesses, services, businessHours } from '../../src/database/schema';
import type { Business } from '../../src/database/queries';

export interface TestBusinessOptions {
  name?: string;
  slug?: string;
  ownerTelegramId?: string;
  botToken?: string;
  webhookId?: string;
  webhookSecret?: string;
  /** @default true — inserts 7 business_hours rows (Mon-Sat 09:00-18:00, Sun closed) */
  withDefaultHours?: boolean;
  /** @default true — inserts 1 default service (Test Service, 60 min, 2000 cents) */
  withDefaultServices?: boolean;
}

/**
 * Insert a complete test business into the DB and return the Business row.
 *
 * Default setup:
 * - 1 service: "Test Service", 60 min, €20.00 (2000 cents)
 * - 7 business_hours rows: dayOfWeek 0 (Sunday) isClosed=true; days 1-6 open 09:00-18:00
 *
 * Closed days still get a row with isClosed=true and placeholder times "00:00"/"00:00"
 * so that findBusinessHoursForDay always finds a row for every dayOfWeek (0-6),
 * matching the HOURS_FIXTURES pattern from src/database/seed.ts.
 */
export async function insertTestBusiness(
  options: TestBusinessOptions = {}
): Promise<Business> {
  const webhookId = options.webhookId ?? crypto.randomUUID();

  const rows = await db
    .insert(businesses)
    .values({
      name: options.name ?? 'Test Business',
      slug: options.slug ?? `test-${webhookId.slice(0, 8)}`,
      ownerTelegramId: options.ownerTelegramId ?? '999999999',
      botToken: options.botToken ?? `test-token-${webhookId.slice(0, 8)}`,
      webhookId,
      webhookSecret:
        options.webhookSecret ?? crypto.randomBytes(32).toString('hex'),
    })
    .returning();

  const business = rows[0];

  if (options.withDefaultServices !== false) {
    await db.insert(services).values({
      businessId: business.id,
      name: 'Test Service',
      durationMin: 60,
      price: 2000,
    });
  }

  if (options.withDefaultHours !== false) {
    const hourRows = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      businessId: business.id,
      dayOfWeek: day,
      // Closed days (Sunday=0) get placeholder times matching the HOURS_FIXTURES
      // convention so findBusinessHoursForDay always returns a row.
      openTime: day === 0 ? '00:00' : '09:00',
      closeTime: day === 0 ? '00:00' : '18:00',
      isClosed: day === 0,
    }));
    await db.insert(businessHours).values(hourRows);
  }

  return business as Business;
}
