import { generateSlug, seed } from '../src/database/seed';
import { findBusinessBySlug } from '../src/database/queries';
import { businesses, services, businessHours } from '../src/database/schema';
import { db } from '../src/database/db';
import { config } from '../src/config';

jest.mock('../src/database/db', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
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
  // (seed() awaits `db.select(...).from(businesses)` directly, and the
  // services/business_hours existing-rows checks await after `.where()`
  // with no `.limit()`).
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

interface UpdateChain {
  set: jest.Mock;
  where: jest.Mock;
  then: (resolve: (value: unknown) => void) => void;
}

function makeUpdateChain(): UpdateChain {
  const chain = {} as UpdateChain;
  chain.set = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.then = (resolve) => resolve(undefined);
  return chain;
}

const mockedDb = db as unknown as { select: jest.Mock; insert: jest.Mock; update: jest.Mock };

// Tracks every db.insert(table) call alongside the chain it returned, so
// tests can inspect exactly what `.values(...)` was called with FOR A
// SPECIFIC TABLE (businesses vs services vs businessHours), since all three
// share the same mocked `db.insert` function.
let insertCalls: Array<{ table: unknown; chain: InsertChain }>;

beforeEach(() => {
  jest.clearAllMocks();
  insertCalls = [];
  mockedDb.insert.mockImplementation((table: unknown) => {
    const chain = makeInsertChain();
    insertCalls.push({ table, chain });
    return chain;
  });
  mockedDb.update.mockImplementation(() => makeUpdateChain());
});

describe('generateSlug', () => {
  it('returns the base slug when no collision exists', () => {
    expect(generateSlug('Pilates Athens', [])).toBe('pilates-athens');
  });

  it('appends a -2 suffix on collision', () => {
    expect(generateSlug('Pilates Athens', ['pilates-athens'])).toBe('pilates-athens-2');
  });
});

const PILATES_BUSINESS = {
  id: 1,
  name: 'Pilates Athens',
  slug: 'pilates-athens',
  phoneNumberId: null,
  ownerTelegramId: null,
  createdAt: new Date(),
};

const HAIR_SALON_BUSINESS = {
  id: 2,
  name: 'Hair Salon Athens',
  slug: 'hair-salon-athens',
  phoneNumberId: null,
  ownerTelegramId: null,
  createdAt: new Date(),
};

/**
 * Mocks a "nothing seeded yet" run: no existing businesses, and (once each
 * fixture business is looked up) no existing services/hours rows either.
 * Matches the fixed, sequential db.select() call order inside seed():
 * 1. initial businesses-slug fetch
 * 2. findBusinessBySlug(pilates-athens)
 * 3. existingServices check for business 1
 * 4. existingHours check for business 1
 * 5. findBusinessBySlug(hair-salon-athens)
 * 6. existingServices check for business 2
 * 7. existingHours check for business 2
 */
function mockFreshSeedRun(): void {
  mockedDb.select.mockReturnValueOnce(makeSelectChain([]));
  mockedDb.select.mockReturnValueOnce(makeSelectChain([PILATES_BUSINESS]));
  mockedDb.select.mockReturnValueOnce(makeSelectChain([]));
  mockedDb.select.mockReturnValueOnce(makeSelectChain([]));
  mockedDb.select.mockReturnValueOnce(makeSelectChain([HAIR_SALON_BUSINESS]));
  mockedDb.select.mockReturnValueOnce(makeSelectChain([]));
  mockedDb.select.mockReturnValueOnce(makeSelectChain([]));
}

/** Mocks a re-run where both businesses, their services, and their hours already exist. */
function mockAlreadySeededRun(): void {
  mockedDb.select.mockReturnValueOnce(
    makeSelectChain([{ slug: 'pilates-athens' }, { slug: 'hair-salon-athens' }])
  );
  mockedDb.select.mockReturnValueOnce(makeSelectChain([PILATES_BUSINESS]));
  mockedDb.select.mockReturnValueOnce(makeSelectChain([{ id: 101 }]));
  mockedDb.select.mockReturnValueOnce(makeSelectChain([{ id: 201 }]));
  mockedDb.select.mockReturnValueOnce(makeSelectChain([HAIR_SALON_BUSINESS]));
  mockedDb.select.mockReturnValueOnce(makeSelectChain([{ id: 102 }]));
  mockedDb.select.mockReturnValueOnce(makeSelectChain([{ id: 202 }]));
}

describe('seed()', () => {
  it('is idempotent: re-running does not duplicate business inserts (2 inserts total across 2 runs)', async () => {
    mockFreshSeedRun();
    await seed();

    mockAlreadySeededRun();
    await seed();

    const businessInserts = insertCalls.filter((c) => c.table === businesses);
    expect(businessInserts).toHaveLength(2);
  });

  it('Test 1: seeds 3 distinct-duration services for each fixture business', async () => {
    mockFreshSeedRun();
    await seed();

    const serviceInsertCalls = insertCalls.filter((c) => c.table === services);
    expect(serviceInsertCalls).toHaveLength(1);

    const insertedRows = serviceInsertCalls[0].chain.values.mock.calls[0][0] as Array<{
      businessId: number;
      durationMin: number;
    }>;

    const pilatesServices = insertedRows.filter((r) => r.businessId === PILATES_BUSINESS.id);
    const hairSalonServices = insertedRows.filter(
      (r) => r.businessId === HAIR_SALON_BUSINESS.id
    );

    expect(pilatesServices).toHaveLength(3);
    expect(new Set(pilatesServices.map((s) => s.durationMin)).size).toBe(3);

    expect(hairSalonServices).toHaveLength(3);
    expect(new Set(hairSalonServices.map((s) => s.durationMin)).size).toBe(3);
  });

  it('Test 2: seeds a full 7-day weekly hours table per business with at least one closed day', async () => {
    mockFreshSeedRun();
    await seed();

    const hoursInsertCalls = insertCalls.filter((c) => c.table === businessHours);
    expect(hoursInsertCalls).toHaveLength(1);

    const insertedRows = hoursInsertCalls[0].chain.values.mock.calls[0][0] as Array<{
      businessId: number;
      dayOfWeek: number;
      isClosed: boolean;
    }>;

    for (const businessId of [PILATES_BUSINESS.id, HAIR_SALON_BUSINESS.id]) {
      const rows = insertedRows.filter((r) => r.businessId === businessId);
      expect(rows).toHaveLength(7);
      expect(new Set(rows.map((r) => r.dayOfWeek))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
      expect(rows.some((r) => r.isClosed)).toBe(true);
    }
  });

  it('Test 3: services/hours are only inserted once — a second seed() run is a no-op', async () => {
    mockFreshSeedRun();
    await seed();

    mockAlreadySeededRun();
    await seed();

    expect(insertCalls.filter((c) => c.table === services)).toHaveLength(1);
    expect(insertCalls.filter((c) => c.table === businessHours)).toHaveLength(1);
  });

  it('Test 4: backfills ownerTelegramId from config for both fixtures, on every run', async () => {
    mockFreshSeedRun();
    await seed();

    mockAlreadySeededRun();
    await seed();

    // Phase 4 (D-09): each seed() run now also runs bot credential backfill
    // (2 ownerTelegramId + 2 bot credentials per fixture) x 2 runs = 8 total.
    // Bot credential calls only fire when TEST_BOT_* env vars are set (jest.setup.ts sets them).
    expect(mockedDb.update).toHaveBeenCalledTimes(8);

    const updateChains = mockedDb.update.mock.results.map(
      (r) => r.value as UpdateChain
    );
    // ownerTelegramId chains come first in the FIXTURES loop (indices 0,1 per run)
    const ownerIdChains = updateChains.filter((chain) => {
      const [firstArg] = chain.set.mock.calls[0] ?? [];
      return firstArg && 'ownerTelegramId' in firstArg;
    });
    expect(ownerIdChains).toHaveLength(4);
    for (const chain of ownerIdChains) {
      expect(chain.set).toHaveBeenCalledWith({ ownerTelegramId: config.ownerTelegramId });
    }
  });
});

describe('findBusinessBySlug', () => {
  it('resolves pilates-athens to a business row after seeding', async () => {
    const fakeRow = {
      id: 1,
      name: 'Pilates Athens',
      slug: 'pilates-athens',
      phoneNumberId: null,
      ownerTelegramId: null,
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
      ownerTelegramId: null,
      createdAt: new Date(),
    };
    mockedDb.select.mockReturnValueOnce(makeSelectChain([fakeRow]));

    const result = await findBusinessBySlug('hair-salon-athens');
    expect(result).toEqual(fakeRow);
  });
});
