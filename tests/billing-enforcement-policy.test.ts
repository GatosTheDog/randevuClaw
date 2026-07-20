// covers ENFC-01
// Unit tests for the set_enforcement_policy handler.
// Uses jest.mock — no real DB calls. setBusinessEnforcementPolicy and
// handleSetEnforcementPolicy do not yet exist; they ship in Plan 05.

// ---------------------------------------------------------------------------
// Module mocks (hoisted before imports by Jest)
// ---------------------------------------------------------------------------

jest.mock('../src/billing/queries', () => ({
  // existing billing/queries exports mocked as jest.fn()
  getRecentClientsForBusiness: jest.fn(),
  listPackages: jest.fn(),
  getPackageById: jest.fn(),
  createMembership: jest.fn(),
  activatePackage: jest.fn(),
  cancelPendingPackage: jest.fn(),
  // Phase 8 addition — does not exist yet; mocked here for future test body use
  setBusinessEnforcementPolicy: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Tests
// NOTE: handleSetEnforcementPolicy is NOT imported at module level — it does
// not yet exist. Requires will go inside the filled-in test bodies in Plan 05.
// ---------------------------------------------------------------------------

describe('handleSetEnforcementPolicy — ENFC-01', () => {
  it.todo('persists the chosen policy to the businesses table');
  it.todo('returns a Greek confirmation string containing the policy name');
  it.todo('returns a Greek error string without DB call when policy value is invalid');
});
