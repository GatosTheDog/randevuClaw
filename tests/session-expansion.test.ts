// covers CLSS-02
// Integration tests for rrule-based expansion of sessionInstances.
// Idempotency key format: catalog:{catalogId}:{sessionDate}:{sessionTime}.

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

describe('recurring session rrule expansion', () => {
  it.todo('expands weekly Mon/Wed/Fri pattern to ~90 days of sessionInstances (between 36 and 42 instances)');

  it('expansion is idempotent on replay: re-running with same rruleString inserts zero new rows (onConflictDoNothing)', async () => {
    const business = await insertTestBusiness();
    const { db } = require('../src/database/db');
    const { services } = require('../src/database/schema');
    const { eq } = require('drizzle-orm');
    const svcRows = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.businessId, business.id))
      .limit(1);
    const svcId = svcRows[0].id;

    // First call — should expand and insert instances
    const first = await withBusinessContext(business.id, () =>
      createSessionCatalogWithExpansion(
        business.id,
        svcId,
        'FREQ=WEEKLY;BYDAY=MO',
        '10:00',
        10
      )
    );
    expect(first.instanceCount).toBeGreaterThan(0);

    // Second call with identical arguments — onConflictDoUpdate updates catalog,
    // but all sessionInstances rows already exist so onConflictDoNothing skips them.
    // instanceCount reflects what rrule.between() generated (same dates), but
    // zero new rows are actually inserted. The second call returns the same
    // instanceCount from rrule expansion; to confirm idempotency we verify the
    // total DB row count has not grown beyond the first call's count.
    const { sessionInstances, sessionCatalog } = require('../src/database/schema');
    const { and } = require('drizzle-orm');

    const beforeRows = await db
      .select({ id: sessionInstances.id })
      .from(sessionInstances)
      .innerJoin(sessionCatalog, eq(sessionInstances.catalogId, sessionCatalog.id))
      .where(and(eq(sessionCatalog.businessId, business.id)));

    const second = await withBusinessContext(business.id, () =>
      createSessionCatalogWithExpansion(
        business.id,
        svcId,
        'FREQ=WEEKLY;BYDAY=MO',
        '10:00',
        10
      )
    );

    const afterRows = await db
      .select({ id: sessionInstances.id })
      .from(sessionInstances)
      .innerJoin(sessionCatalog, eq(sessionInstances.catalogId, sessionCatalog.id))
      .where(and(eq(sessionCatalog.businessId, business.id)));

    // Row count must not have grown — all inserts were no-ops (onConflictDoNothing)
    expect(afterRows).toHaveLength(beforeRows.length);
    // Both calls must return the same catalogId (onConflictDoUpdate same row)
    expect(second.catalogId).toBe(first.catalogId);
  });

  it.todo('idempotencyKey format is catalog:{catalogId}:{sessionDate}:{sessionTime} for each instance');
  it.todo('expansion fails cleanly with thrown error when rruleString is invalid RFC 5545');
  it.todo('DST boundary: expansion across Oct 25 2026 (UTC+3 to UTC+2) produces correct wall-clock Athens dates');
});
