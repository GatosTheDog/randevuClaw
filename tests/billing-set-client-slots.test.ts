// Quick task 261008-h82: admin override of a client's granted slots.
// Integration tests against the real local Postgres: row locking, ledger audit rows,
// clamping, idempotent replay, tenant isolation and handler validation/messages.

const TEST_DATABASE_URL =
  process.env.BILLING_TEST_DATABASE_URL ??
  'postgresql://manolis@localhost:5432/randevuclaw_test';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = TEST_DATABASE_URL;
jest.resetModules();

/* eslint-disable @typescript-eslint/no-var-requires */
const { db } = require('../src/database/db');
const { eq } = require('drizzle-orm');
const { memberships, membershipLedger } = require('../src/database/schema');
const { withBusinessContext } = require('../src/database/queries');
const { adjustMembershipSessions } = require('../src/billing/queries');
const { handleSetClientSlots } = require('../src/billing/tools');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestPackage, insertTestMembership } = require('./helpers/billing-fixtures');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

let counter = 0;
function uniquePhone(tag: string): string {
  counter += 1;
  return `slots-${tag}-${Date.now()}-${counter}`;
}
function key(): string {
  counter += 1;
  return `test-slots-key-${Date.now()}-${counter}`;
}

async function getBalance(membershipId: number): Promise<number | null> {
  const rows = await db
    .select({ s: memberships.sessionsRemaining })
    .from(memberships)
    .where(eq(memberships.id, membershipId));
  return rows[0].s;
}

async function getLedger(membershipId: number) {
  return db.select().from(membershipLedger).where(eq(membershipLedger.membershipId, membershipId));
}

describe('adjustMembershipSessions + handleSetClientSlots', () => {
  let businessId: number;
  let packageId: number;

  beforeAll(async () => {
    const business = await insertTestBusiness();
    businessId = business.id;
    const pkg = await insertTestPackage(businessId, { name: `Slots Pkg ${Date.now()}`, sessionCount: 8 });
    packageId = pkg.id;
  });

  async function setup(sessionsRemaining: number | null, extra: Record<string, unknown> = {}) {
    const phone = uniquePhone('c');
    const m = await insertTestMembership(businessId, phone, packageId, {
      sessionsRemaining,
      ...extra,
    });
    return { phone, membershipId: m.id as number };
  }

  const run = (phone: string, mode: 'set' | 'add', sessions: number, k = key()) =>
    withBusinessContext(businessId, () =>
      adjustMembershipSessions(businessId, phone, mode, sessions, k)
    );

  it('1. set 8 -> 12 updates counter and writes one admin_adjustment ledger row (-4)', async () => {
    const { phone, membershipId } = await setup(8);
    const result = await run(phone, 'set', 12);
    expect(result.status).toBe('updated');
    expect(result.previousRemaining).toBe(8);
    expect(result.newRemaining).toBe(12);
    expect(result.clamped).toBe(false);
    expect(await getBalance(membershipId)).toBe(12);
    const ledger = await getLedger(membershipId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].operationType).toBe('admin_adjustment');
    expect(ledger[0].sessionsDeducted).toBe(-4);
    expect(ledger[0].bookingId).toBeNull();
    expect(ledger[0].reason).toContain('8');
    expect(ledger[0].reason).toContain('12');
  });

  it('2. set 8 -> 6 writes ledger +2', async () => {
    const { phone, membershipId } = await setup(8);
    const result = await run(phone, 'set', 6);
    expect(result.newRemaining).toBe(6);
    expect(await getBalance(membershipId)).toBe(6);
    const ledger = await getLedger(membershipId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].sessionsDeducted).toBe(2);
  });

  it('3. add +4 on 5 gives 9; add -2 on 8 gives 6', async () => {
    const a = await setup(5);
    const r1 = await run(a.phone, 'add', 4);
    expect(r1.newRemaining).toBe(9);
    expect(await getBalance(a.membershipId)).toBe(9);
    expect((await getLedger(a.membershipId))[0].sessionsDeducted).toBe(-4);

    const b = await setup(8);
    const r2 = await run(b.phone, 'add', -2);
    expect(r2.newRemaining).toBe(6);
    expect(await getBalance(b.membershipId)).toBe(6);
    expect((await getLedger(b.membershipId))[0].sessionsDeducted).toBe(2);
  });

  it('4. add -5 on 3 is clamped to 0 with ledger +3', async () => {
    const { phone, membershipId } = await setup(3);
    const result = await run(phone, 'add', -5);
    expect(result.status).toBe('updated');
    expect(result.clamped).toBe(true);
    expect(result.newRemaining).toBe(0);
    expect(await getBalance(membershipId)).toBe(0);
    const ledger = await getLedger(membershipId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].sessionsDeducted).toBe(3);
  });

  it('5. same-value set and add 0 are unchanged with no ledger row', async () => {
    const { phone, membershipId } = await setup(8);
    const r1 = await run(phone, 'set', 8);
    expect(r1.status).toBe('unchanged');
    const r2 = await run(phone, 'add', 0);
    expect(r2.status).toBe('unchanged');
    expect(await getBalance(membershipId)).toBe(8);
    expect(await getLedger(membershipId)).toHaveLength(0);
  });

  it('6. unlimited: set converts to fixed number; add is refused', async () => {
    const a = await setup(null);
    const refused = await run(a.phone, 'add', 3);
    expect(refused.status).toBe('unlimited_add_unsupported');
    expect(await getBalance(a.membershipId)).toBeNull();
    expect(await getLedger(a.membershipId)).toHaveLength(0);

    const result = await run(a.phone, 'set', 10);
    expect(result.status).toBe('updated');
    expect(result.previousRemaining).toBeNull();
    expect(result.newRemaining).toBe(10);
    expect(await getBalance(a.membershipId)).toBe(10);
    const ledger = await getLedger(a.membershipId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].sessionsDeducted).toBe(0);
    expect(ledger[0].reason).toContain('unlimited');
  });

  it('7. no eligible membership gives no_active_membership and writes nothing', async () => {
    const none = await run(uniquePhone('none'), 'set', 5);
    expect(none.status).toBe('no_active_membership');

    const expired = await setup(5, { expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) });
    expect((await run(expired.phone, 'set', 9)).status).toBe('no_active_membership');
    expect(await getBalance(expired.membershipId)).toBe(5);
    expect(await getLedger(expired.membershipId)).toHaveLength(0);

    const inactive = await setup(5, { isActive: false });
    expect((await run(inactive.phone, 'set', 9)).status).toBe('no_active_membership');
    expect(await getBalance(inactive.membershipId)).toBe(5);
    expect(await getLedger(inactive.membershipId)).toHaveLength(0);
  });

  it('8. tenant isolation: adjusting through business A never touches business B', async () => {
    const other = await insertTestBusiness();
    const otherPkg = await insertTestPackage(other.id, { name: `Other Pkg ${Date.now()}` });
    const phone = uniquePhone('shared');
    const a = await insertTestMembership(businessId, phone, packageId, { sessionsRemaining: 5 });
    const b = await insertTestMembership(other.id, phone, otherPkg.id, { sessionsRemaining: 7 });

    const result = await run(phone, 'set', 11);
    expect(result.status).toBe('updated');
    expect(await getBalance(a.id)).toBe(11);
    expect(await getBalance(b.id)).toBe(7);
    expect(await getLedger(b.id)).toHaveLength(0);
  });

  it('9. idempotent replay with the same key changes the balance once', async () => {
    const { phone, membershipId } = await setup(5);
    const k = key();
    const first = await run(phone, 'add', 4, k);
    expect(first.status).toBe('updated');
    const second = await run(phone, 'add', 4, k);
    expect(second.status).toBe('unchanged');
    expect(await getBalance(membershipId)).toBe(9);
    expect(await getLedger(membershipId)).toHaveLength(1);
  });

  describe('handler validation', () => {
    const invalid: Array<[string, Record<string, unknown>]> = [
      ['mode multiply', { mode: 'multiply', sessions: 4 }],
      ['mode missing', { sessions: 4 }],
      ['sessions string', { mode: 'set', sessions: '4' }],
      ['sessions 2.5', { mode: 'add', sessions: 2.5 }],
      ['set with negative', { mode: 'set', sessions: -1 }],
      ['sessions 1001', { mode: 'add', sessions: 1001 }],
    ];

    it.each(invalid)('10. rejects %s without touching the DB', async (_label, args) => {
      const { phone, membershipId } = await setup(8);
      const text: string = await withBusinessContext(businessId, () =>
        handleSetClientSlots(businessId, phone, 'Μαρία', args)
      );
      expect(text).toContain('Μη έγκυρα');
      expect(await getBalance(membershipId)).toBe(8);
      expect(await getLedger(membershipId)).toHaveLength(0);
    });
  });

  describe('handler messages', () => {
    const call = (phone: string, args: Record<string, unknown>): Promise<string> =>
      withBusinessContext(businessId, () => handleSetClientSlots(businessId, phone, 'Μαρία', args));

    it('11a. success text has name, before -> after, renewal caveat, no phone', async () => {
      const { phone } = await setup(8);
      const text = await call(phone, { mode: 'add', sessions: 4 });
      expect(text).toContain('Μαρία');
      expect(text).toContain('8 → 12');
      expect(text).toContain('στην επόμενη ανανέωση');
      expect(text).not.toContain(phone);
    });

    it('11b. clamped text notes balance cannot go below 0', async () => {
      const { phone } = await setup(3);
      const text = await call(phone, { mode: 'add', sessions: -5 });
      expect(text).toContain('3 → 0');
      expect(text).toContain('κάτω από το 0');
    });

    it('11c. no membership tells the owner to record a payment first', async () => {
      const phone = uniquePhone('nomem');
      const text = await call(phone, { mode: 'set', sessions: 5 });
      expect(text).toContain('πληρωμή');
      expect(text).not.toContain(phone);
    });

    it('11d. add on unlimited explains that set must be used', async () => {
      const { phone } = await setup(null);
      const text = await call(phone, { mode: 'add', sessions: 2 });
      expect(text).toContain('απεριόριστα');
      expect(text).toContain('ακριβή αριθμό');
    });

    it('11e. unchanged text says no change was made', async () => {
      const { phone } = await setup(8);
      const text = await call(phone, { mode: 'set', sessions: 8 });
      expect(text).toContain('Καμία αλλαγή');
      expect(text).toContain('8');
    });

    it('11f. unlimited-before renders previous value as απεριόριστα', async () => {
      const { phone } = await setup(null);
      const text = await call(phone, { mode: 'set', sessions: 10 });
      expect(text).toContain('απεριόριστα → 10');
    });
  });
});
