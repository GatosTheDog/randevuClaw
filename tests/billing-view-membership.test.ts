// covers PAY-03
// Integration tests for querying and displaying a client's active membership:
// sessions remaining, expiry date, unlimited flag, and not-found / expired states.
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
const { getClientActiveMembership } = require('../src/billing/queries');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestPackage, insertTestMembership } = require('./helpers/billing-fixtures');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

describe('view client membership', () => {
  let businessId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;
  });

  it('returns package name, sessions remaining, and expiry date for active membership', async () => {
    const pkg = await insertTestPackage(businessId, {
      name: `Monthly 10-Pack ${Date.now()}`,
      sessionCount: 10,
      validDays: 30,
    });
    const clientPhone = `view-test-active-${Date.now()}`;
    await insertTestMembership(businessId, clientPhone, pkg.id, {
      sessionsRemaining: 7,
    });

    const result = await withBusinessContext(businessId, () =>
      getClientActiveMembership(businessId, clientPhone)
    );

    expect(result).not.toBeNull();
    expect(result.sessionsRemaining).toBe(7);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.isUnlimited).toBe(false);
  });

  it('unlimited membership (sessionCount null) has isUnlimited: true and sessionsRemaining null', async () => {
    const pkg = await insertTestPackage(businessId, {
      name: `Unlimited Monthly ${Date.now()}`,
      sessionCount: null, // unlimited
      validDays: 30,
    });
    const clientPhone = `view-test-unlimited-${Date.now()}`;
    await insertTestMembership(businessId, clientPhone, pkg.id, {
      sessionsRemaining: null,
    });

    const result = await withBusinessContext(businessId, () =>
      getClientActiveMembership(businessId, clientPhone)
    );

    expect(result).not.toBeNull();
    expect(result.sessionsRemaining).toBeNull();
    expect(result.isUnlimited).toBe(true);
  });

  it('returns null when no active membership exists for client', async () => {
    const noMembershipClient = `no-membership-${Date.now()}`;

    const result = await withBusinessContext(businessId, () =>
      getClientActiveMembership(businessId, noMembershipClient)
    );

    expect(result).toBeNull();
  });

  it('excludes expired memberships from result (expiresAt in past)', async () => {
    const pkg = await insertTestPackage(businessId, {
      name: `Expired Package ${Date.now()}`,
      sessionCount: 5,
      validDays: 30,
    });
    const clientPhone = `view-test-expired-${Date.now()}`;

    // Insert membership that expired yesterday
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await insertTestMembership(businessId, clientPhone, pkg.id, {
      expiresAt: yesterday,
    });

    const result = await withBusinessContext(businessId, () =>
      getClientActiveMembership(businessId, clientPhone)
    );

    // Expired membership should not be returned
    expect(result).toBeNull();
  });
});
