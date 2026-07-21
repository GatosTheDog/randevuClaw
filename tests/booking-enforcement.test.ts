// covers ENFC-02, ENFC-03
// Unit tests for checkEnforcementAndGetMembership — the enforcement pre-check
// layer in src/billing/enforcement.ts. Uses jest.mock to avoid real DB calls.
// Tests verify the discriminated EnforcementResult shape for each policy+membership
// combination.

// ---------------------------------------------------------------------------
// Module mocks (hoisted before imports by Jest)
// ---------------------------------------------------------------------------

jest.mock('../src/billing/queries', () => ({
  getActiveMembershipForDeduction: jest.fn(),
  getBusinessEnforcementPolicy: jest.fn(),
  // Other exports referenced transitively — mocked to avoid real DB connections
  getRecentClientsForBusiness: jest.fn(),
  deductSession: jest.fn(),
  restoreCredit: jest.fn(),
  findMembershipByBooking: jest.fn(),
  getClientName: jest.fn(),
  getClientActiveMembership: jest.fn(),
  setBusinessEnforcementPolicy: jest.fn(),
  getActiveMembershipForClient: jest.fn(),
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

import { checkEnforcementAndGetMembership } from '../src/billing/enforcement';
import {
  getActiveMembershipForDeduction,
  getBusinessEnforcementPolicy,
} from '../src/billing/queries';
import type { ActiveMembershipForDeduction } from '../src/billing/queries';

const mockedGetActiveMembership = getActiveMembershipForDeduction as jest.MockedFunction<
  typeof getActiveMembershipForDeduction
>;
const mockedGetPolicy = getBusinessEnforcementPolicy as jest.MockedFunction<
  typeof getBusinessEnforcementPolicy
>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('booking enforcement policy integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('ENFC-02: block policy + no membership refuses booking and sends Greek refusal to client', async () => {
    mockedGetActiveMembership.mockResolvedValue(null);
    mockedGetPolicy.mockResolvedValue('block');

    const result = await checkEnforcementAndGetMembership(1, 'clientPhone');

    expect(result.allowed).toBe(false);
    // Greek refusal word — confirmed in bookAppointmentTool message (ENFC-02)
    expect(result.message).toContain('συνδρομή');
    expect(result.shouldAlert).toBe(false);
  });

  it('ENFC-03: flag policy + no membership allows booking and sends Greek alert to owner', async () => {
    mockedGetActiveMembership.mockResolvedValue(null);
    mockedGetPolicy.mockResolvedValue('flag');

    const result = await checkEnforcementAndGetMembership(1, 'clientPhone');

    expect(result.allowed).toBe(true);
    expect(result.shouldAlert).toBe(true);
    expect(result.membership).toBeNull();
  });

  it('ENFC-02: block policy + active membership allows booking to proceed normally', async () => {
    const fakeMembership: ActiveMembershipForDeduction = {
      id: 1,
      sessionsRemaining: 5,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
    mockedGetActiveMembership.mockResolvedValue(fakeMembership);
    mockedGetPolicy.mockResolvedValue('block');

    const result = await checkEnforcementAndGetMembership(1, 'clientPhone');

    // When client has a valid membership, block policy has no effect
    expect(result.allowed).toBe(true);
    expect(result.membership).not.toBeNull();
    expect(result.shouldAlert).toBe(false);
  });
});
