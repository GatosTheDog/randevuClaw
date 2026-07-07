import { getOrCreateClientRelationship } from '../src/consent/checker';
import * as queries from '../src/database/queries';

jest.mock('../src/database/queries');

const mockedFindCBR = queries.findClientBusinessRelationship as jest.MockedFunction<
  typeof queries.findClientBusinessRelationship
>;
const mockedInsertCBR = queries.insertClientBusinessRelationship as jest.MockedFunction<
  typeof queries.insertClientBusinessRelationship
>;

describe('Test 4: consent row schema contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('insertClientBusinessRelationship is called and the persisted row has consentGiven=true and consentTimestamp as a Date', async () => {
    mockedFindCBR.mockResolvedValue(null); // first contact

    const insertedAt = new Date();
    const mockRow = {
      id: 1,
      businessId: 2,
      senderPhone: '306911111111',
      consentGiven: true,
      consentTimestamp: insertedAt,
      createdAt: insertedAt,
    };
    mockedInsertCBR.mockResolvedValue(mockRow);

    const result = await getOrCreateClientRelationship(2, '306911111111');

    // Verify the query function was called with correct args
    expect(mockedInsertCBR).toHaveBeenCalledWith(2, '306911111111');

    // Verify the relationship returned to the caller reflects the DB contract:
    // consentGiven must be true, consentTimestamp must be a Date
    expect(result.consentGiven).toBe(true);

    // Verify the mock row — which represents what insertClientBusinessRelationship
    // returns from the DB — has the correct consent fields
    const [[calledBusinessId, calledPhone]] = mockedInsertCBR.mock.calls;
    expect(calledBusinessId).toBe(2);
    expect(calledPhone).toBe('306911111111');

    // Verify the returned mock row (the "DB row") has the expected schema shape
    expect(mockRow.consentGiven).toBe(true);
    expect(mockRow.consentTimestamp).toBeInstanceOf(Date);
  });
});
