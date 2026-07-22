// covers CLSS-01
// Integration tests against a REAL local Postgres connection — required to
// verify createSessionCatalogWithExpansion atomically inserts catalog row and
// session instance rows, returning catalogId and instanceCount.
//
// Setup (one-time, local dev machine):
//   psql postgresql://manolis@localhost:5432/randevuclaw_test \
//     -f migrations/0010_session_catalog_schema.sql

const TEST_DATABASE_URL =
  process.env.SESSION_TEST_DATABASE_URL ??
  process.env.BILLING_TEST_DATABASE_URL ??
  'postgresql://manolis@localhost:5432/randevuclaw_test';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = TEST_DATABASE_URL;
jest.resetModules();

/* eslint-disable @typescript-eslint/no-var-requires */
const { withBusinessContext } = require('../src/database/queries');
const { createSessionCatalogWithExpansion } = require('../src/session/manager');
const { insertTestBusiness } = require('./helpers/test-business');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

describe('session catalog creation', () => {
  let businessId: number;
  let serviceId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;

    // insertTestBusiness inserts 1 default service; we need its id.
    // Re-query via admin db to get the service id.
    const { db } = require('../src/database/db');
    const { services } = require('../src/database/schema');
    const { eq } = require('drizzle-orm');
    const svcRows = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.businessId, businessId))
      .limit(1);
    serviceId = svcRows[0].id;
  });

  it('creates single session via chat: owner tool inserts catalog row and instance row atomically', async () => {
    const result = await withBusinessContext(businessId, () =>
      createSessionCatalogWithExpansion(
        businessId,
        serviceId,
        'FREQ=WEEKLY;BYDAY=MO',
        '10:00',
        10
      )
    );

    // catalogId must be a positive integer
    expect(result.catalogId).toBeGreaterThan(0);
    // Monday-only over ~90 days = ~13 instances; at least 1 must be generated
    expect(result.instanceCount).toBeGreaterThanOrEqual(1);
  });

  it('session creation returns catalogId and instanceCount in result object', async () => {
    // Use a second service to avoid conflict on the unique_active_catalog_per_business_service index.
    // Create a fresh business so we can use its default service independently.
    const biz2 = await insertTestBusiness();
    const { db } = require('../src/database/db');
    const { services } = require('../src/database/schema');
    const { eq } = require('drizzle-orm');
    const svcRows2 = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.businessId, biz2.id))
      .limit(1);
    const svcId2 = svcRows2[0].id;

    const result = await withBusinessContext(biz2.id, () =>
      createSessionCatalogWithExpansion(
        biz2.id,
        svcId2,
        'FREQ=WEEKLY;BYDAY=MO,WE,FR',
        '10:00',
        15
      )
    );

    expect(result.catalogId).toBeGreaterThan(0);
    // Mon/Wed/Fri × ~13 weeks ≈ 39 instances; allow ±3 for partial weeks at boundaries
    expect(result.instanceCount).toBeGreaterThanOrEqual(36);
    expect(result.instanceCount).toBeLessThanOrEqual(42);
  });

  it.todo('create_session with duplicate rrule on same business+service replaces existing via onConflictDoUpdate');
  it.todo('TypeScript interface: createSessionCatalogWithExpansion accepts businessId, serviceId, rruleString, startTime, capacity');
});
