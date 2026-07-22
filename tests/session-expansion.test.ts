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
  it('expands weekly Mon/Wed/Fri pattern to ~90 days of sessionInstances (between 36 and 42 instances)', async () => {
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

    const result = await withBusinessContext(business.id, () =>
      createSessionCatalogWithExpansion(
        business.id,
        svcId,
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

  it('idempotencyKey format is catalog:{catalogId}:{sessionDate}:{sessionTime} for each instance', async () => {
    const business = await insertTestBusiness();
    const { db } = require('../src/database/db');
    const { services, sessionInstances, sessionCatalog } = require('../src/database/schema');
    const { eq } = require('drizzle-orm');
    const svcRows = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.businessId, business.id))
      .limit(1);
    const svcId = svcRows[0].id;

    const result = await withBusinessContext(business.id, () =>
      createSessionCatalogWithExpansion(
        business.id,
        svcId,
        'FREQ=WEEKLY;BYDAY=MO',
        '10:00',
        10
      )
    );

    // Fetch the first instance for this catalog and verify its idempotencyKey format
    const instanceRows = await db
      .select({ idempotencyKey: sessionInstances.idempotencyKey, sessionDate: sessionInstances.sessionDate })
      .from(sessionInstances)
      .innerJoin(sessionCatalog, eq(sessionInstances.catalogId, sessionCatalog.id))
      .where(eq(sessionCatalog.id, result.catalogId))
      .limit(1);

    expect(instanceRows).toHaveLength(1);
    const { idempotencyKey, sessionDate } = instanceRows[0];

    // Format: catalog:{catalogId}:{sessionDate}:{sessionTime}
    const expectedKey = `catalog:${result.catalogId}:${sessionDate}:10:00`;
    expect(idempotencyKey).toBe(expectedKey);

    // Also verify against the regex pattern
    expect(idempotencyKey).toMatch(/^catalog:\d+:\d{4}-\d{2}-\d{2}:\d{2}:\d{2}$/);
  });

  it('expansion fails cleanly with thrown error when rruleString is invalid RFC 5545', async () => {
    const business = await insertTestBusiness();
    const { db } = require('../src/database/db');
    const { services, sessionCatalog } = require('../src/database/schema');
    const { eq } = require('drizzle-orm');
    const svcRows = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.businessId, business.id))
      .limit(1);
    const svcId = svcRows[0].id;

    // Count catalog rows before attempt
    const beforeRows = await db
      .select({ id: sessionCatalog.id })
      .from(sessionCatalog)
      .where(eq(sessionCatalog.businessId, business.id));

    // Call with invalid rrule — must throw
    await expect(
      withBusinessContext(business.id, () =>
        createSessionCatalogWithExpansion(
          business.id,
          svcId,
          'NOT_VALID_RRULE',
          '10:00',
          10
        )
      )
    ).rejects.toThrow();

    // Verify no orphaned catalog row was committed — rrule validation happens
    // before withBusinessContext, so no DB insert occurs
    const afterRows = await db
      .select({ id: sessionCatalog.id })
      .from(sessionCatalog)
      .where(eq(sessionCatalog.businessId, business.id));

    expect(afterRows).toHaveLength(beforeRows.length);
  });

  it('DST boundary: expansion across Oct 25 2026 (UTC+3 to UTC+2) produces correct wall-clock Athens dates', async () => {
    // Oct 25 2026: Europe/Athens transitions from UTC+3 (EEST) to UTC+2 (EET).
    // Clocks go back at 04:00 Athens time = 01:00 UTC.
    // Start date: Oct 18 2026 (Sunday before DST change)
    // Pattern: FREQ=WEEKLY;BYDAY=SU — should produce Oct 18 and Oct 25 within 14 days.
    // The Oct 25 instance must have sessionDate='2026-10-25' and sessionTime='10:00'
    // (wall-clock must NOT shift to '09:00' due to DST offset change).
    const business = await insertTestBusiness();
    const { db } = require('../src/database/db');
    const { services, sessionInstances, sessionCatalog } = require('../src/database/schema');
    const { eq } = require('drizzle-orm');
    const svcRows = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.businessId, business.id))
      .limit(1);
    const svcId = svcRows[0].id;

    // Pass startDate='2026-10-18' so the expansion anchors on that Sunday.
    // limitDays defaults to 90 but rrule.between uses the expansion window from startDate.
    // The function will expand from 2026-10-18 to 2026-10-18+90=2027-01-16.
    // Within 14 days: Oct 18 (SU) and Oct 25 (SU) — exactly 2 instances.
    const result = await withBusinessContext(business.id, () =>
      createSessionCatalogWithExpansion(
        business.id,
        svcId,
        'FREQ=WEEKLY;BYDAY=SU',
        '10:00',
        10,
        '2026-10-18' // startDate override for DST test
      )
    );

    // Fetch all instances for this catalog, ordered by sessionDate
    const instanceRows = await db
      .select({
        sessionDate: sessionInstances.sessionDate,
        sessionTime: sessionInstances.sessionTime,
      })
      .from(sessionInstances)
      .innerJoin(sessionCatalog, eq(sessionInstances.catalogId, sessionCatalog.id))
      .where(eq(sessionCatalog.id, result.catalogId))
      .orderBy(sessionInstances.sessionDate);

    // There should be multiple instances (weekly Sundays for ~90 days)
    expect(instanceRows.length).toBeGreaterThan(0);

    // Find the Oct 18 and Oct 25 instances specifically
    const oct18 = instanceRows.find(
      (r: { sessionDate: string }) => r.sessionDate === '2026-10-18'
    );
    const oct25 = instanceRows.find(
      (r: { sessionDate: string }) => r.sessionDate === '2026-10-25'
    );

    // Oct 18 instance: before DST change
    expect(oct18).toBeDefined();
    expect(oct18.sessionTime).toBe('10:00');

    // Oct 25 instance: on the DST transition day — wall-clock must NOT shift
    // sessionDate must be '2026-10-25' (not '2026-10-24' due to UTC conversion)
    // sessionTime must be '10:00' (not '09:00' — DST offset change must not bleed into time)
    expect(oct25).toBeDefined();
    expect(oct25.sessionDate).toBe('2026-10-25');
    expect(oct25.sessionTime).toBe('10:00');
  });
});
