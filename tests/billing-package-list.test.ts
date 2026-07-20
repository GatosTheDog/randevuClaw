// covers BILL-02
// Integration tests for listing active billing packages via handleListPackages.
// Verifies: only active packages are returned; empty state is handled gracefully.
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
const { withBusinessContext } = require('../src/database/queries');
const { handleListPackages } = require('../src/billing/tools');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestPackage } = require('./helpers/billing-fixtures');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

describe('list active packages', () => {
  let businessId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;
  });

  it('returns formatted Greek list of active packages', async () => {
    await insertTestPackage(businessId, {
      name: `Active Package List ${Date.now()}`,
      priceCents: 8000,
      validDays: 30,
      sessionCount: 10,
      isActive: true,
    });

    const result = await withBusinessContext(businessId, () => handleListPackages(businessId));

    expect(result).toContain('📦 Ενεργά πακέτα:');
    expect(result).toContain('€80.00');
    expect(result).toContain('10 συνεδρίες');
    expect(result).toContain('30 ημέρες');
  });

  it('excludes deactivated packages from list', async () => {
    const uniqueName = `Deactivated Package ${Date.now()}`;
    await insertTestPackage(businessId, {
      name: uniqueName,
      priceCents: 5000,
      validDays: 30,
      sessionCount: 5,
      isActive: false,
    });

    const result = await withBusinessContext(businessId, () => handleListPackages(businessId));

    expect(result).not.toContain(uniqueName);
  });

  it('returns empty Greek message when no active packages', async () => {
    // Use a fresh business with no packages for the empty-state test
    const emptyBusiness = await insertTestBusiness();

    const result = await withBusinessContext(emptyBusiness.id, () =>
      handleListPackages(emptyBusiness.id)
    );

    expect(result).toBe('Δεν υπάρχουν ενεργά πακέτα.');
  });
});
