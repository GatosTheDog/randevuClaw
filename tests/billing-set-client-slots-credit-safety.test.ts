// quick-261008-h82: proves the admin slot override composes with the existing
// credit-safe booking path (book_session multi-booking, deduction, restore).
// Integration tests against the real local Postgres; no production code is changed.

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
const { memberships, membershipLedger, bookings, services, businesses } = require('../src/database/schema');
const { executeTool } = require('../src/conversation/function-executor');
const { withBusinessContext } = require('../src/database/queries');
const { restoreCredit } = require('../src/billing/queries');
const { handleSetClientSlots } = require('../src/billing/tools');
const { isoDateInAthens, addCalendarDays } = require('../src/utils/timezone');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestPackage, insertTestMembership } = require('./helpers/billing-fixtures');
const { insertTestSessionCatalog, insertTestSessionInstance } = require('./helpers/session-fixtures');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

let counter = 0;
function uniquePhone(): string {
  counter += 1;
  return `slots-safety-${Date.now()}-${counter}-${Math.random().toString(36).slice(2)}`;
}

function buildToolContext(business: { id: number; name: string }, clientPhone: string) {
  counter += 1;
  return {
    business: {
      id: business.id,
      name: business.name ?? 'Test Business',
      ownerTelegramId: null,
      enforcementPolicy: 'allow',
      bookingMode: 'fixed_sessions',
      allowMultiBooking: true,
    },
    clientPhone,
    requestId: 'slots-req-' + counter,
    idempotencyKey: `slots-idem-${Date.now()}-${counter}`,
  };
}

interface Scenario {
  business: { id: number; name: string };
  clientPhone: string;
  instanceIds: number[]; // chronological: today+2, +3, +4, ...
  membershipId: number;
}

async function setupScenario(
  sessionsRemaining: number | null,
  instanceCount: number,
  opts: { enforcementPolicy?: string } = {}
): Promise<Scenario> {
  const business = await insertTestBusiness();
  await db
    .update(businesses)
    .set({ allowMultiBooking: true, enforcementPolicy: opts.enforcementPolicy ?? 'allow' })
    .where(eq(businesses.id, business.id));
  const svcRows = await db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.businessId, business.id))
    .limit(1);
  const serviceId = svcRows[0].id as number;
  const catalog = await insertTestSessionCatalog(business.id, serviceId, { capacity: 10 });
  const clientPhone = uniquePhone();
  const pkg = await insertTestPackage(business.id, { sessionCount: 8 });
  const membership = await insertTestMembership(business.id, clientPhone, pkg.id, { sessionsRemaining });

  const today = isoDateInAthens(new Date());
  const instanceIds: number[] = [];
  for (let i = 0; i < instanceCount; i += 1) {
    const inst = await insertTestSessionInstance(catalog.id, {
      sessionDate: addCalendarDays(today, 2 + i),
      sessionTime: '18:00',
      idempotencyKey: `slots-safety:${catalog.id}:${i}:${Math.random()}`,
    });
    instanceIds.push(inst.id as number);
  }
  return { business, clientPhone, instanceIds, membershipId: membership.id as number };
}

const override = (s: Scenario, mode: 'set' | 'add', sessions: number): Promise<string> =>
  withBusinessContext(s.business.id, () =>
    handleSetClientSlots(s.business.id, s.clientPhone, 'Μαρία', { mode, sessions })
  );

async function balance(membershipId: number): Promise<number | null> {
  const rows = await db
    .select({ r: memberships.sessionsRemaining })
    .from(memberships)
    .where(eq(memberships.id, membershipId));
  return rows[0].r;
}

async function ledgerRows(membershipId: number, operationType: string) {
  return db
    .select()
    .from(membershipLedger)
    .where(and(eq(membershipLedger.membershipId, membershipId), eq(membershipLedger.operationType, operationType)));
}

describe('set_client_slots override drives the real booking path', () => {
  it('1. raised above the package: books all three and counter ends at 9', async () => {
    const s = await setupScenario(8, 3);
    await override(s, 'add', 4); // 8 -> 12

    const result = await executeTool(
      'book_session',
      { business_id: s.business.id, session_instance_ids: s.instanceIds },
      buildToolContext(s.business, s.clientPhone)
    );
    expect(result.booked_count).toBe(3);
    expect(result.insufficient_credit_instance_ids).toEqual([]);
    expect(await balance(s.membershipId)).toBe(9);

    const adjustments = await ledgerRows(s.membershipId, 'admin_adjustment');
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].sessionsDeducted).toBe(-4);
    expect(await ledgerRows(s.membershipId, 'session_deducted')).toHaveLength(3);
  });

  it('2. lowered below demand: books the two chronologically first, caps the third', async () => {
    const s = await setupScenario(8, 3);
    await override(s, 'set', 2);

    // Supplied out of order on purpose.
    const ids = [s.instanceIds[2], s.instanceIds[0], s.instanceIds[1]];
    const result = await executeTool(
      'book_session',
      { business_id: s.business.id, session_instance_ids: ids },
      buildToolContext(s.business, s.clientPhone)
    );
    expect(result.booked_count).toBe(2);
    expect(result.booked_instance_ids).toEqual([s.instanceIds[0], s.instanceIds[1]]);
    expect(result.insufficient_credit_instance_ids).toEqual([s.instanceIds[2]]);
    expect(await balance(s.membershipId)).toBe(0);
    expect(await ledgerRows(s.membershipId, 'session_deducted')).toHaveLength(2);
  });

  it('3. restore works relative to the overridden counter and is idempotent', async () => {
    const s = await setupScenario(8, 3);
    await override(s, 'add', 4); // 12
    await executeTool(
      'book_session',
      { business_id: s.business.id, session_instance_ids: s.instanceIds },
      buildToolContext(s.business, s.clientPhone)
    );
    expect(await balance(s.membershipId)).toBe(9);

    const rows = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.businessId, s.business.id), eq(bookings.clientPhone, s.clientPhone)));
    expect(rows).toHaveLength(3);
    const bookingId = rows[0].id as number;
    const restoreKey = `slots-restore-${Date.now()}-${Math.random()}`;

    await withBusinessContext(s.business.id, () => restoreCredit(s.membershipId, bookingId, restoreKey));
    expect(await balance(s.membershipId)).toBe(10);

    await withBusinessContext(s.business.id, () => restoreCredit(s.membershipId, bookingId, restoreKey));
    expect(await balance(s.membershipId)).toBe(10);
  });

  it('4. unlimited converted to a fixed number is enforced as finite', async () => {
    const s = await setupScenario(null, 2);
    await override(s, 'set', 1);

    const result = await executeTool(
      'book_session',
      { business_id: s.business.id, session_instance_ids: s.instanceIds },
      buildToolContext(s.business, s.clientPhone)
    );
    expect(result.booked_count).toBe(1);
    expect(result.booked_instance_ids).toEqual([s.instanceIds[0]]);
    expect(result.insufficient_credit_instance_ids).toEqual([s.instanceIds[1]]);
    expect(await balance(s.membershipId)).toBe(0);
  });

  it('5. raising from zero re-enables booking', async () => {
    // 'block' policy makes the exhausted membership refuse the booking outright.
    const s = await setupScenario(0, 1, { enforcementPolicy: 'block' });

    const refused = await executeTool(
      'book_session',
      { business_id: s.business.id, session_instance_ids: s.instanceIds },
      buildToolContext(s.business, s.clientPhone)
    );
    expect(refused.success).toBe(false);
    expect(refused.error).toBe('no_membership');
    expect(await balance(s.membershipId)).toBe(0);

    await override(s, 'set', 3);

    const accepted = await executeTool(
      'book_session',
      { business_id: s.business.id, session_instance_ids: s.instanceIds },
      buildToolContext(s.business, s.clientPhone)
    );
    expect(accepted.success).toBe(true);
    expect(accepted.booked_count).toBe(1);
    expect(await balance(s.membershipId)).toBe(2);
  });
});
