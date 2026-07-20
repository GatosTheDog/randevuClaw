// covers ENFC-01
// Unit tests for the set_enforcement_policy handler.
// Uses jest.mock — no real DB calls.

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
  // Phase 8 addition — mocked for test assertions
  setBusinessEnforcementPolicy: jest.fn().mockResolvedValue(undefined),
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
// Imports (after jest.mock hoisting)
// ---------------------------------------------------------------------------

import { handleSetEnforcementPolicy } from '../src/billing/tools';
import { setBusinessEnforcementPolicy } from '../src/billing/queries';

const mockedSetBusinessEnforcementPolicy = setBusinessEnforcementPolicy as jest.MockedFunction<
  typeof setBusinessEnforcementPolicy
>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleSetEnforcementPolicy — ENFC-01', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSetBusinessEnforcementPolicy.mockResolvedValue(undefined);
  });

  it('persists the chosen policy to the businesses table', async () => {
    await handleSetEnforcementPolicy(1, { policy: 'block' });
    expect(mockedSetBusinessEnforcementPolicy).toHaveBeenCalledTimes(1);
    expect(mockedSetBusinessEnforcementPolicy).toHaveBeenCalledWith(1, 'block');
  });

  it('returns a Greek confirmation string containing the policy name', async () => {
    const result = await handleSetEnforcementPolicy(1, { policy: 'flag' });
    expect(result).toContain('πολιτική');
    expect(result).toContain('flag');
  });

  it('returns a Greek error string without DB call when policy value is invalid', async () => {
    const result = await handleSetEnforcementPolicy(1, { policy: 'deny' });
    expect(result).toContain('Μη έγκυρη');
    expect(mockedSetBusinessEnforcementPolicy).not.toHaveBeenCalled();
  });
});
