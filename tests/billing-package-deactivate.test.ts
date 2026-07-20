// covers BILL-03
// Integration tests for soft-deactivating a billing package via handleDeactivatePackage:
// verifies is_active becomes false; existing memberships referencing the package remain intact.
//
// Setup (one-time, local dev machine):
//   psql postgresql://manolis@localhost:5432/randevuclaw_test \
//     -f migrations/0006_billing_schema.sql

const TEST_DATABASE_URL =
  process.env.BILLING_TEST_DATABASE_URL ??
  'postgresql://manolis@localhost:5432/randevuclaw_test';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = TEST_DATABASE_URL;
jest.resetModules();

/* eslint-disable @typescript-eslint/no-var-requires */
const { db } = require('../src/database/db');
const { eq } = require('drizzle-orm');
const { billingPackages, memberships } = require('../src/database/schema');
const { withBusinessContext: withBizCtx } = require('../src/database/queries');
const { handleDeactivatePackage, handleListPackages } = require('../src/billing/tools');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestPackage, insertTestMembership } = require('./helpers/billing-fixtures');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

describe('deactivate package', () => {
  let businessId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;
  });

  it('sets is_active to false on the target package', async () => {
    const pkg = await insertTestPackage(businessId, {
      name: `Deactivate Test ${Date.now()}`,
      priceCents: 5000,
      validDays: 30,
      sessionCount: 10,
      isActive: true,
    });

    const reply = await handleDeactivatePackage(pkg.id);

    expect(reply).toBe('Το πακέτο απενεργοποιήθηκε. Υπάρχουσες συνδρομές δεν επηρεάζονται.');

    // Verify the row is now inactive in the DB
    const rows = await db.select().from(billingPackages).where(eq(billingPackages.id, pkg.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].isActive).toBe(false);
  });

  it('existing memberships referencing the package remain intact', async () => {
    const pkg = await insertTestPackage(businessId, {
      name: `Package With Membership ${Date.now()}`,
      priceCents: 8000,
      validDays: 30,
      sessionCount: 10,
      isActive: true,
    });
    const clientPhone = `deactivate-test-${Date.now()}`;
    const membership = await insertTestMembership(businessId, clientPhone, pkg.id, {
      sessionsRemaining: 8,
      isActive: true,
    });

    // Deactivate the package
    await handleDeactivatePackage(pkg.id);

    // Package is now inactive
    const pkgRows = await db.select().from(billingPackages).where(eq(billingPackages.id, pkg.id));
    expect(pkgRows[0].isActive).toBe(false);

    // Membership still exists and is still active
    const membershipRows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id));
    expect(membershipRows).toHaveLength(1);
    expect(membershipRows[0].isActive).toBe(true);
    expect(membershipRows[0].sessionsRemaining).toBe(8);
  });

  it('deactivated package excluded from getRecentClients package selection', async () => {
    const uniqueName = `Excluded After Deactivate ${Date.now()}`;
    const pkg = await insertTestPackage(businessId, {
      name: uniqueName,
      priceCents: 3000,
      validDays: 14,
      sessionCount: 5,
      isActive: true,
    });

    // Deactivate the package
    await handleDeactivatePackage(pkg.id);

    // handleListPackages (which powers the package selection) should not include it
    const result = await withBizCtx(businessId, () => handleListPackages(businessId));
    expect(result).not.toContain(uniqueName);
  });
});
