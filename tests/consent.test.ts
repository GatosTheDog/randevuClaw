import * as queries from '../src/database/queries';
import * as checker from '../src/consent/checker';

jest.mock('../src/database/queries');

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
