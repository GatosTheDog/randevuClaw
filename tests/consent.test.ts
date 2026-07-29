import { Business } from '../src/database/queries';
import * as queries from '../src/database/queries';
import * as checker from '../src/consent/checker';

jest.mock('../src/database/queries');

function makeBusiness(overrides: Partial<Business> = {}): Business {
  return {
    id: 1,
    name: 'Pilates Athens',
    slug: 'pilates-athens',
    phoneNumberId: null,
    ownerTelegramId: '999999999',
    googleRefreshToken: null,
    agendaSentDate: null,
    botToken: null,
    webhookId: null,
    webhookSecret: null,
    enforcementPolicy: 'allow',
    bookingMode: 'open_slots',
    allowMultiBooking: false,
    cancellationCutoffEnabled: false,
    cancellationCutoffHours: 24,
    slotlessRequestsEnabled: false,
    lastSessionThresholdEnabled: false,
    lastSessionThresholdCount: 1,
    onboardingCompleted: true,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('buildPolicySummaryGreek unit tests', () => {
  it('all-default flags -> returns empty string', () => {
    const business = makeBusiness();

    expect(checker.buildPolicySummaryGreek(business)).toBe('');
  });

  it('cancellationCutoffEnabled=true, cancellationCutoffHours=6 -> mentions the cutoff hours', () => {
    const business = makeBusiness({ cancellationCutoffEnabled: true, cancellationCutoffHours: 6 });

    const summary = checker.buildPolicySummaryGreek(business);

    expect(summary).not.toBe('');
    expect(summary).toContain('6');
  });

  it('slotlessRequestsEnabled=true -> mentions request-based booking', () => {
    const business = makeBusiness({ slotlessRequestsEnabled: true });

    const summary = checker.buildPolicySummaryGreek(business);

    expect(summary).not.toBe('');
    expect(summary).toContain('αίτημα κράτησης');
  });

  it("enforcementPolicy='block' -> mentions membership is required", () => {
    const business = makeBusiness({ enforcementPolicy: 'block' });

    const summary = checker.buildPolicySummaryGreek(business);

    expect(summary).not.toBe('');
    expect(summary).toContain('συνδρομή');
  });

  it("bookingMode='fixed_sessions' -> mentions fixed/scheduled sessions", () => {
    const business = makeBusiness({ bookingMode: 'fixed_sessions' });

    const summary = checker.buildPolicySummaryGreek(business);

    expect(summary).not.toBe('');
    expect(summary).toContain('προγράμματος');
  });

  it("enforcementPolicy='flag' alone (all other flags default) -> produces no policy text", () => {
    const business = makeBusiness({ enforcementPolicy: 'flag' });

    expect(checker.buildPolicySummaryGreek(business)).toBe('');
  });
});

// Unit tests for getOrCreateClientRelationship
describe('getOrCreateClientRelationship unit tests', () => {
  const mockedFindCBR = queries.findClientBusinessRelationship as jest.MockedFunction<
    typeof queries.findClientBusinessRelationship
  >;
  const mockedInsertCBR = queries.insertClientBusinessRelationship as jest.MockedFunction<
    typeof queries.insertClientBusinessRelationship
  >;

  const mockRow = {
    id: 1, businessId: 1, senderPhone: '306900000000', clientName: null,
    consentGiven: true, consentTimestamp: new Date(), createdAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('Test 1: no existing row → returns isFirstContact=true and calls insertClientBusinessRelationship once', async () => {
    mockedFindCBR.mockResolvedValue(null);
    mockedInsertCBR.mockResolvedValue(mockRow);

    const result = await checker.getOrCreateClientRelationship(1, '306900000000');

    expect(result).toEqual({ isFirstContact: true, consentGiven: true });
    expect(mockedInsertCBR).toHaveBeenCalledTimes(1);
    expect(mockedInsertCBR).toHaveBeenCalledWith(1, '306900000000');
  });

  it('Test 2: existing row → returns isFirstContact=false and does NOT call insertClientBusinessRelationship', async () => {
    mockedFindCBR.mockResolvedValue(mockRow);

    const result = await checker.getOrCreateClientRelationship(1, '306900000000');

    expect(result).toEqual({ isFirstContact: false, consentGiven: true });
    expect(mockedInsertCBR).not.toHaveBeenCalled();
  });
});
