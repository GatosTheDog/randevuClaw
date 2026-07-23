// covers SBOK-01, SBOK-02, SBOK-03, SBOK-04
// Integration tests against a REAL local Postgres connection.
// Requires migrations 0006 (billing), 0007 (enforcement), 0010 (session catalog) to be applied.
//
// Setup (one-time, local dev machine):
//   psql postgresql://manolis@localhost:5432/randevuclaw_test \
//     -f migrations/0010_session_catalog_schema.sql

const TEST_DATABASE_URL =
  process.env.SESSION_TEST_DATABASE_URL ??
  process.env.BILLING_TEST_DATABASE_URL ??
  'postgresql://manolis@localhost:5432/randevuclaw_test';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = TEST_DATABASE_URL;
jest.resetModules();

/* eslint-disable @typescript-eslint/no-var-requires */
const { db } = require('../src/database/db');
const { eq, and } = require('drizzle-orm');
const {
  memberships,
  membershipLedger,
  sessionInstances,
  sessionCatalog,
  bookings,
  services,
  businesses,
} = require('../src/database/schema');
const { bookSessionInstance } = require('../src/session/manager');
const { executeTool } = require('../src/conversation/function-executor');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestPackage, insertTestMembership } = require('./helpers/billing-fixtures');
const {
  insertTestSessionCatalog,
  insertTestSessionInstance,
} = require('./helpers/session-fixtures');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniquePhone(): string {
  return `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function addDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildToolContext(
  business: {
    id: number;
    name: string;
    enforcementPolicy?: string;
    bookingMode?: string;
    allowMultiBooking?: boolean;
  },
  clientPhone: string,
  idempotencyKey: string = 'test-idem-' + Date.now()
) {
  return {
    business: {
      id: business.id,
      name: business.name ?? 'Test Business',
      ownerTelegramId: null,
      enforcementPolicy: business.enforcementPolicy ?? 'allow',
      bookingMode: business.bookingMode ?? 'fixed_sessions',
      allowMultiBooking: business.allowMultiBooking ?? false,
    },
    clientPhone,
    requestId: 'test-req-' + Date.now(),
    idempotencyKey,
  };
}

async function getTestServiceId(businessId: number): Promise<number> {
  const rows = await db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.businessId, businessId))
    .limit(1);
  return rows[0].id as number;
}

// ---------------------------------------------------------------------------
// SBOK-01: client session booking capacity enforcement
// ---------------------------------------------------------------------------

describe('SBOK-01: client session booking capacity enforcement', () => {
  let businessId: number;
  let serviceId: number;
  let catalogId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;
    serviceId = await getTestServiceId(businessId);
    const catalog = await insertTestSessionCatalog(businessId, serviceId, { capacity: 5 });
    catalogId = catalog.id;
  });

  it('client books session: bookSessionInstance returns success when capacity available', async () => {
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: addDays(10),
      bookedCount: 0,
      idempotencyKey: `sbok01-avail:${catalogId}:${Date.now()}`,
    });

    const pkg = await insertTestPackage(businessId, {
      name: `SBOK-01 pkg ${Date.now()}`,
      sessionCount: 3,
    });
    const clientPhone = uniquePhone();
    const membership = await insertTestMembership(businessId, clientPhone, pkg.id, {
      sessionsRemaining: 3,
    });

    const result = await bookSessionInstance(
      businessId,
      instance.id,
      clientPhone,
      serviceId,
      `sbok01-avail:${instance.id}:${clientPhone}`,
      {
        id: membership.id,
        sessionsRemaining: membership.sessionsRemaining,
        expiresAt: membership.expiresAt,
      }
    );

    expect(result.status).toBe('success');
    expect(result.bookingId).toBeGreaterThan(0);
  });

  it('booking blocked when session is full (bookedCount === capacity) (SBOK-01 hard cap)', async () => {
    // capacity=5, bookedCount=5 → session is full
    const fullInstance = await insertTestSessionInstance(catalogId, {
      sessionDate: addDays(11),
      bookedCount: 5,
      idempotencyKey: `sbok01-full:${catalogId}:${Date.now()}`,
    });

    const clientPhone = uniquePhone();
    const result = await bookSessionInstance(
      businessId,
      fullInstance.id,
      clientPhone,
      serviceId,
      `sbok01-full:${fullInstance.id}:${clientPhone}`,
      null
    );

    expect(result.status).toBe('full');
  });
});

// ---------------------------------------------------------------------------
// SBOK-02: atomic session credit deduction on booking
// ---------------------------------------------------------------------------

describe('SBOK-02: atomic session credit deduction on booking', () => {
  let businessId: number;
  let serviceId: number;
  let catalogId: number;
  let packageId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;
    serviceId = await getTestServiceId(businessId);
    const catalog = await insertTestSessionCatalog(businessId, serviceId, { capacity: 10 });
    catalogId = catalog.id;
    const pkg = await insertTestPackage(businessId, {
      name: `SBOK-02 pkg ${Date.now()}`,
      sessionCount: 10,
    });
    packageId = pkg.id;
  });

  it('bookSessionInstance deducts 1 credit atomically: sessionsRemaining decrements and ledger row inserted', async () => {
    const clientPhone = uniquePhone();
    const membership = await insertTestMembership(businessId, clientPhone, packageId, {
      sessionsRemaining: 3,
    });
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: addDays(12),
      idempotencyKey: `sbok02-deduct:${catalogId}:${Date.now()}`,
    });

    const activeMembership = {
      id: membership.id,
      sessionsRemaining: membership.sessionsRemaining,
      expiresAt: membership.expiresAt,
    };

    const result = await bookSessionInstance(
      businessId,
      instance.id,
      clientPhone,
      serviceId,
      `sbok02-deduct:${instance.id}:${clientPhone}`,
      activeMembership
    );

    expect(result.status).toBe('success');
    const bookingId = result.bookingId!;

    // Assert sessionsRemaining decremented from 3 to 2
    const membershipRows = await db
      .select({ sessionsRemaining: memberships.sessionsRemaining })
      .from(memberships)
      .where(eq(memberships.id, membership.id));
    expect(membershipRows[0].sessionsRemaining).toBe(2);

    // Assert session_deducted ledger row inserted with sessionsDeducted=1
    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(
        and(
          eq(membershipLedger.membershipId, membership.id),
          eq(membershipLedger.operationType, 'session_deducted'),
          eq(membershipLedger.bookingId, bookingId)
        )
      );
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].sessionsDeducted).toBe(1);
  });

  it('unlimited membership (sessionsRemaining=null): booking succeeds, no ledger row inserted, no counter change', async () => {
    const clientPhone = uniquePhone();
    const membership = await insertTestMembership(businessId, clientPhone, packageId, {
      sessionsRemaining: null,
    });
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: addDays(13),
      idempotencyKey: `sbok02-unlimited:${catalogId}:${Date.now()}`,
    });

    const activeMembership = {
      id: membership.id,
      sessionsRemaining: null as null,
      expiresAt: membership.expiresAt,
    };

    const result = await bookSessionInstance(
      businessId,
      instance.id,
      clientPhone,
      serviceId,
      `sbok02-unlimited:${instance.id}:${clientPhone}`,
      activeMembership
    );

    expect(result.status).toBe('success');
    const bookingId = result.bookingId!;

    // sessionsRemaining stays null (no decrement)
    const membershipRows = await db
      .select({ sessionsRemaining: memberships.sessionsRemaining })
      .from(memberships)
      .where(eq(memberships.id, membership.id));
    expect(membershipRows[0].sessionsRemaining).toBeNull();

    // No ledger row for this booking
    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(eq(membershipLedger.bookingId, bookingId));
    expect(ledgerRows).toHaveLength(0);
  });

  it('no membership (activeMembership=null): booking still succeeds when enforcement policy=allow, no deduction', async () => {
    const clientPhone = uniquePhone();
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: addDays(14),
      idempotencyKey: `sbok02-nomem:${catalogId}:${Date.now()}`,
    });

    const result = await bookSessionInstance(
      businessId,
      instance.id,
      clientPhone,
      serviceId,
      `sbok02-nomem:${instance.id}:${clientPhone}`,
      null
    );

    expect(result.status).toBe('success');
    const bookingId = result.bookingId!;

    // No ledger row for this booking
    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(eq(membershipLedger.bookingId, bookingId));
    expect(ledgerRows).toHaveLength(0);
  });

  it('deduction is idempotent: replaying bookSessionInstance with same idempotencyKey does not double-deduct', async () => {
    const clientPhone = uniquePhone();
    const membership = await insertTestMembership(businessId, clientPhone, packageId, {
      sessionsRemaining: 5,
    });
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: addDays(15),
      idempotencyKey: `sbok02-idem:${catalogId}:${Date.now()}`,
    });

    const idempotencyKey = `sbok02-idem:${instance.id}:${clientPhone}`;
    const activeMembership = {
      id: membership.id,
      sessionsRemaining: membership.sessionsRemaining,
      expiresAt: membership.expiresAt,
    };

    // First call — deducts
    const result1 = await bookSessionInstance(
      businessId,
      instance.id,
      clientPhone,
      serviceId,
      idempotencyKey,
      activeMembership
    );
    expect(result1.status).toBe('success');
    const bookingId = result1.bookingId!;

    // Second call with same idempotencyKey — idempotent replay
    const result2 = await bookSessionInstance(
      businessId,
      instance.id,
      clientPhone,
      serviceId,
      idempotencyKey,
      activeMembership
    );
    expect(result2.status).toBe('success');
    expect(result2.bookingId).toBe(bookingId); // same booking returned

    // sessionsRemaining decremented exactly once: 5 to 4 (not 3)
    const membershipRows = await db
      .select({ sessionsRemaining: memberships.sessionsRemaining })
      .from(memberships)
      .where(eq(memberships.id, membership.id));
    expect(membershipRows[0].sessionsRemaining).toBe(4);

    // Exactly 1 session_deducted ledger row for this bookingId
    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(
        and(
          eq(membershipLedger.membershipId, membership.id),
          eq(membershipLedger.operationType, 'session_deducted'),
          eq(membershipLedger.bookingId, bookingId)
        )
      );
    expect(ledgerRows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// SBOK-03: reschedule expiry gate
// ---------------------------------------------------------------------------

describe('SBOK-03: reschedule expiry gate', () => {
  let businessId: number;
  let serviceId: number;
  let catalogId: number;
  let packageId: number;
  let membershipExpiresAt: Date;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;
    serviceId = await getTestServiceId(businessId);
    const catalog = await insertTestSessionCatalog(businessId, serviceId, { capacity: 10 });
    catalogId = catalog.id;
    const pkg = await insertTestPackage(businessId, {
      name: `SBOK-03 pkg ${Date.now()}`,
      sessionCount: 10,
    });
    packageId = pkg.id;

    // Membership expires 10 days from now
    membershipExpiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  });

  it('rescheduleSessionTool blocks reschedule to session past membership expiry (SBOK-03)', async () => {
    const clientPhone = uniquePhone();
    const membership = await insertTestMembership(businessId, clientPhone, packageId, {
      sessionsRemaining: 5,
      expiresAt: membershipExpiresAt,
    });

    // instanceA: today + 5 days (within expiry of +10 days)
    const instanceA = await insertTestSessionInstance(catalogId, {
      sessionDate: addDays(5),
      idempotencyKey: `sbok03-block-instA:${catalogId}:${Date.now()}`,
    });

    // instanceB: today + 20 days (PAST membership expiry of +10 days)
    // Also within listSessions 90-day window so rescheduleSessionTool can find it
    const instanceB = await insertTestSessionInstance(catalogId, {
      sessionDate: addDays(20),
      idempotencyKey: `sbok03-block-instB:${catalogId}:${Date.now()}`,
    });

    const activeMembership = {
      id: membership.id,
      sessionsRemaining: membership.sessionsRemaining,
      expiresAt: membership.expiresAt,
    };

    // Book instanceA first so we have a real booking row with sessionInstanceId set
    const bookResult = await bookSessionInstance(
      businessId,
      instanceA.id,
      clientPhone,
      serviceId,
      `sbok03-block-book:${instanceA.id}:${clientPhone}`,
      activeMembership
    );
    expect(bookResult.status).toBe('success');
    const bookingId = bookResult.bookingId!;

    // Attempt reschedule to instanceB (past expiry) via executeTool
    const context = buildToolContext(
      {
        id: businessId,
        name: 'Test Business',
        enforcementPolicy: 'allow',
        bookingMode: 'fixed_sessions',
        allowMultiBooking: false,
      },
      clientPhone,
      `sbok03-block-reschedule:${bookingId}:${Date.now()}`
    );

    const result = await executeTool(
      'reschedule_session',
      { business_id: businessId, booking_id: bookingId, new_session_instance_id: instanceB.id },
      context
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('past_membership_expiry');
  });

  it('rescheduleSessionTool allows reschedule to session within membership expiry (SBOK-03)', async () => {
    const clientPhone2 = uniquePhone();
    const membership = await insertTestMembership(businessId, clientPhone2, packageId, {
      sessionsRemaining: 5,
      expiresAt: membershipExpiresAt,
    });

    // instanceC: today + 5 days (within expiry)
    const instanceC = await insertTestSessionInstance(catalogId, {
      sessionDate: addDays(5),
      idempotencyKey: `sbok03-allow-instC:${catalogId}:${Date.now()}`,
    });

    // instanceD: today + 8 days (still within expiry of +10 days)
    const instanceD = await insertTestSessionInstance(catalogId, {
      sessionDate: addDays(8),
      idempotencyKey: `sbok03-allow-instD:${catalogId}:${Date.now()}`,
    });

    const activeMembership = {
      id: membership.id,
      sessionsRemaining: membership.sessionsRemaining,
      expiresAt: membership.expiresAt,
    };

    // Book instanceC first
    const bookResult = await bookSessionInstance(
      businessId,
      instanceC.id,
      clientPhone2,
      serviceId,
      `sbok03-allow-book:${instanceC.id}:${clientPhone2}`,
      activeMembership
    );
    expect(bookResult.status).toBe('success');
    const bookingId = bookResult.bookingId!;

    // Reschedule to instanceD (within expiry)
    const context = buildToolContext(
      {
        id: businessId,
        name: 'Test Business',
        enforcementPolicy: 'allow',
        bookingMode: 'fixed_sessions',
        allowMultiBooking: false,
      },
      clientPhone2,
      `sbok03-allow-reschedule:${bookingId}:${Date.now()}`
    );

    const result = await executeTool(
      'reschedule_session',
      { business_id: businessId, booking_id: bookingId, new_session_instance_id: instanceD.id },
      context
    );

    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SBOK-04: multi-session booking
// ---------------------------------------------------------------------------

describe('SBOK-04: multi-session booking', () => {
  let businessId: number;
  let businessRow: {
    id: number;
    name: string;
    allowMultiBooking: boolean;
    enforcementPolicy: string;
    bookingMode: string;
  };
  let serviceId: number;
  let catalogId: number;
  let packageId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;
    serviceId = await getTestServiceId(businessId);

    // Enable allowMultiBooking on the test business row
    await db
      .update(businesses)
      .set({ allowMultiBooking: true })
      .where(eq(businesses.id, businessId));

    businessRow = {
      id: businessId,
      name: 'Test Business',
      allowMultiBooking: true,
      enforcementPolicy: 'allow',
      bookingMode: 'fixed_sessions',
    };

    const catalog = await insertTestSessionCatalog(businessId, serviceId, { capacity: 10 });
    catalogId = catalog.id;
    const pkg = await insertTestPackage(businessId, {
      name: `SBOK-04 pkg ${Date.now()}`,
      sessionCount: 10,
    });
    packageId = pkg.id;
  });

  it('multi-booking: books two sessions sequentially, decrements counter twice', async () => {
    const clientPhone = uniquePhone();
    const membership = await insertTestMembership(businessId, clientPhone, packageId, {
      sessionsRemaining: 5,
    });

    // Insert 2 instances with future dates within listSessions 90-day window
    const instanceA = await insertTestSessionInstance(catalogId, {
      sessionDate: addDays(30),
      idempotencyKey: `sbok04-multi-instA:${catalogId}:${Date.now()}`,
    });
    const instanceB = await insertTestSessionInstance(catalogId, {
      sessionDate: addDays(31),
      idempotencyKey: `sbok04-multi-instB:${catalogId}:${Date.now()}`,
    });

    const context = buildToolContext(
      businessRow,
      clientPhone,
      `sbok04-multi:${Date.now()}`
    );

    const result = await executeTool(
      'book_session',
      { business_id: businessId, session_instance_ids: [instanceA.id, instanceB.id] },
      context
    );

    expect(result.success).toBe(true);
    expect(result.booked_count).toBe(2);

    // sessionsRemaining should go from 5 to 3 (decremented twice)
    const membershipRows = await db
      .select({ sessionsRemaining: memberships.sessionsRemaining })
      .from(memberships)
      .where(eq(memberships.id, membership.id));
    expect(membershipRows[0].sessionsRemaining).toBe(3);
  });

  it('multi-booking disabled: returns error when allowMultiBooking=false on business', async () => {
    const clientPhone = uniquePhone();

    const instanceC = await insertTestSessionInstance(catalogId, {
      sessionDate: addDays(32),
      idempotencyKey: `sbok04-disabled-instC:${catalogId}:${Date.now()}`,
    });
    const instanceD = await insertTestSessionInstance(catalogId, {
      sessionDate: addDays(33),
      idempotencyKey: `sbok04-disabled-instD:${catalogId}:${Date.now()}`,
    });

    // Build context with allowMultiBooking=false (overrides the DB-level true)
    const context = buildToolContext(
      {
        id: businessId,
        name: 'Test Business',
        enforcementPolicy: 'allow',
        bookingMode: 'fixed_sessions',
        allowMultiBooking: false,
      },
      clientPhone,
      `sbok04-disabled:${Date.now()}`
    );

    const result = await executeTool(
      'book_session',
      { business_id: businessId, session_instance_ids: [instanceC.id, instanceD.id] },
      context
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('multi_booking_disabled');
  });

  it('multi-booking partial success: one full session does not block booking of other sessions in the array', async () => {
    const clientPhone = uniquePhone();
    await insertTestMembership(businessId, clientPhone, packageId, {
      sessionsRemaining: 5,
    });

    // instanceE: full — use a separate catalog with capacity=5 and bookedCount=5
    const fullCatalog = await insertTestSessionCatalog(businessId, serviceId, { capacity: 5 });
    const instanceE = await insertTestSessionInstance(fullCatalog.id, {
      sessionDate: addDays(34),
      bookedCount: 5,
      idempotencyKey: `sbok04-partial-instE:${fullCatalog.id}:${Date.now()}`,
    });

    // instanceF: available (uses the shared catalogId with capacity=10)
    const instanceF = await insertTestSessionInstance(catalogId, {
      sessionDate: addDays(35),
      idempotencyKey: `sbok04-partial-instF:${catalogId}:${Date.now()}`,
    });

    const context = buildToolContext(
      businessRow,
      clientPhone,
      `sbok04-partial:${Date.now()}`
    );

    const result = await executeTool(
      'book_session',
      { business_id: businessId, session_instance_ids: [instanceE.id, instanceF.id] },
      context
    );

    // instanceF booked successfully; instanceE is full
    expect(Array.isArray(result.booked_instance_ids)).toBe(true);
    expect((result.booked_instance_ids as number[]).includes(instanceF.id)).toBe(true);
    expect(Array.isArray(result.full_instance_ids)).toBe(true);
    expect((result.full_instance_ids as number[]).includes(instanceE.id)).toBe(true);
    expect(result.booked_count).toBe(1);
    // success is true because at least 1 was booked
    expect(result.success).toBe(true);
  });
});
