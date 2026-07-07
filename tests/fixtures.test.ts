import { generateSlug, seed } from '../src/database/seed';
import { findBusinessBySlug } from '../src/database/queries';
import { db } from '../src/database/db';

jest.mock('../src/database/db', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
  },
}));

interface SelectChain {
  from: jest.Mock;
  where: jest.Mock;
  limit: jest.Mock;
  then: (resolve: (value: unknown) => void) => void;
}

function makeSelectChain(result: unknown[]): SelectChain {
  const chain = {} as SelectChain;
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue(result);
  // Makes the chain itself awaitable when no .where()/.limit() is chained
  // (seed() awaits `db.select(...).from(businesses)` directly).
  chain.then = (resolve) => resolve(result);
  return chain;
}

interface InsertChain {
  values: jest.Mock;
  onConflictDoNothing: jest.Mock;
  returning: jest.Mock;
  then: (resolve: (value: unknown) => void) => void;
}

function makeInsertChain(returningResult: unknown[] = []): InsertChain {
  const chain = {} as InsertChain;
  chain.values = jest.fn().mockReturnValue(chain);
  chain.onConflictDoNothing = jest.fn().mockReturnValue(chain);
  chain.returning = jest.fn().mockResolvedValue(returningResult);
  // Makes the chain itself awaitable when no .returning() is chained
  // (seed() awaits `db.insert(businesses).values(...)` directly).
  chain.then = (resolve) => resolve(undefined);
  return chain;
}

const mockedDb = db as unknown as { select: jest.Mock; insert: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('generateSlug', () => {
  it('returns the base slug when no collision exists', () => {
    expect(generateSlug('Pilates Athens', [])).toBe('pilates-athens');
  });

  it('appends a -2 suffix on collision', () => {
    expect(generateSlug('Pilates Athens', ['pilates-athens'])).toBe('pilates-athens-2');
  });
});

describe('seed()', () => {
  it('is idempotent: re-running does not duplicate inserts (2 inserts total across 2 runs)', async () => {
    // First run: no existing businesses -> both fixtures get inserted.
    mockedDb.select.mockReturnValueOnce(makeSelectChain([]));
    mockedDb.insert.mockReturnValue(makeInsertChain());

    await seed();

    // Second run: both fixtures already exist -> no further inserts.
    mockedDb.select.mockReturnValueOnce(
      makeSelectChain([{ slug: 'pilates-athens' }, { slug: 'hair-salon-athens' }])
    );

    await seed();

    expect(mockedDb.insert).toHaveBeenCalledTimes(2);
  });
});

describe('findBusinessBySlug', () => {
  it('resolves pilates-athens to a business row after seeding', async () => {
    const fakeRow = {
      id: 1,
      name: 'Pilates Athens',
      slug: 'pilates-athens',
      phoneNumberId: null,
      createdAt: new Date(),
    };
    mockedDb.select.mockReturnValueOnce(makeSelectChain([fakeRow]));

    const result = await findBusinessBySlug('pilates-athens');
    expect(result).toEqual(fakeRow);
  });

  it('resolves hair-salon-athens to a business row after seeding', async () => {
    const fakeRow = {
      id: 2,
      name: 'Hair Salon Athens',
      slug: 'hair-salon-athens',
      phoneNumberId: null,
      createdAt: new Date(),
    };
    mockedDb.select.mockReturnValueOnce(makeSelectChain([fakeRow]));

    const result = await findBusinessBySlug('hair-salon-athens');
    expect(result).toEqual(fakeRow);
  });
});
