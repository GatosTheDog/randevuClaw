// Debug session: .planning/debug/resolved/book-session-deadlock-with-membership.md
//
// Regression test for a fixed self-deadlock:
//
//   bookSessionInstance (src/session/manager.ts) used to unconditionally open
//   a NEW withBusinessContext transaction with no isInBusinessContext() guard
//   (unlike the WR-02-guarded pattern in src/telegram/handlers/payment-flow.ts).
//   When invoked from INSIDE an already-open outer withBusinessContext
//   transaction that had already taken a SELECT ... FOR UPDATE lock on the
//   client's memberships row (mirroring the real production call chain:
//   src/webhooks/telegram.ts:1490 handleTelegramWebhookPost -> handleCallbackQuery
//   -> handleBookSessionExecute -> checkEnforcementAndGetMembership ->
//   getActiveMembershipForDeduction, src/billing/queries.ts, .for('update')),
//   the nested transaction's own deductSession write on that SAME row
//   (src/billing/queries.ts) would block waiting for the outer transaction's
//   lock, while the outer transaction was itself blocked awaiting the nested
//   call's completion. Two different pooled connections from the same Node
//   process blocked on each other -- invisible to Postgres's own deadlock
//   detector (it's not a lock cycle from a single backend's point of view) --
//   so nothing resolved it until the server-side statement_timeout fired
//   (src/database/db.ts: 10s).
//
// BEFORE the fix, the first test below reproduced this live against a real
// Postgres: the attempt failed after ~10019ms/10055ms with "canceling
// statement due to statement timeout" and sessionsRemaining stayed
// unchanged (both transactions rolled back). AFTER the fix
// (isInBusinessContext() guard added to bookSessionInstance, cancelSession,
// cascadeCancelSessionBookings, createSessionCatalogWithExpansion), the same
// scenario now reuses the ambient transaction and completes in milliseconds
// with a correct single deduction — asserted below.
//
// Setup: real local Postgres, same convention as tests/session-booking-flow.test.ts.
// Run with (never run the full suite):
//   SESSION_TEST_DATABASE_URL=postgresql://manolis:password@localhost:5433/randevuclaw_test \
//     npx jest --testPathPattern book-session-deadlock

const TEST_DATABASE_URL =
  process.env.SESSION_TEST_DATABASE_URL ??
  process.env.BILLING_TEST_DATABASE_URL ??
  'postgresql://manolis@localhost:5432/randevuclaw_test';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = TEST_DATABASE_URL;
jest.resetModules();

/* eslint-disable @typescript-eslint/no-var-requires */
const { db, appPool, pool } = require('../src/database/db');
const { eq, and } = require('drizzle-orm');
const { memberships, membershipLedger, services } = require('../src/database/schema');
const { withBusinessContext, isInBusinessContext } = require('../src/database/queries');
const { bookSessionInstance } = require('../src/session/manager');
const { getActiveMembershipForDeduction } = require('../src/billing/queries');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestPackage, insertTestMembership } = require('./helpers/billing-fixtures');
const {
  insertTestSessionCatalog,
  insertTestSessionInstance,
} = require('./helpers/session-fixtures');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(async () => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  // This test deliberately induces blocked/timed-out connections on both
  // appPool (nested withBusinessContext) and the admin pool (fixture
  // helpers). Close them explicitly so a stuck client doesn't hold the
  // process open after this file's tests complete.
  try {
    await appPool.end();
  } catch {
    // already closed / already erroring out — fine to ignore in teardown
  }
  try {
    await pool.end();
  } catch {
    // ignore
  }
});

function uniquePhone(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function addDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function getTestServiceId(businessId: number): Promise<number> {
  const rows = await db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.businessId, businessId))
    .limit(1);
  return rows[0].id as number;
}

describe('book-session-deadlock-with-membership: self-deadlock falsification test', () => {
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
      name: `Deadlock Test Pkg ${Date.now()}`,
      sessionCount: 10,
    });
    packageId = pkg.id;
  });

  it(
    'regression: nested bookSessionInstance inside an outer transaction ' +
      'already holding a FOR UPDATE lock on the same memberships row reuses ' +
      'the ambient transaction and completes fast with a correct single deduction',
    async () => {
      const clientPhone = uniquePhone('deadlock');
      const membership = await insertTestMembership(businessId, clientPhone, packageId, {
        sessionsRemaining: 3,
      });

      // Sanity check BEFORE starting: fixture data is correct. Deliberately a
      // plain read outside any transaction so a broken fixture fails fast and
      // unambiguously here, rather than being confused with the assertions
      // below.
      const preCheckRows = await db
        .select({ sessionsRemaining: memberships.sessionsRemaining })
        .from(memberships)
        .where(eq(memberships.id, membership.id));
      expect(preCheckRows[0].sessionsRemaining).toBe(3);

      const instance = await insertTestSessionInstance(catalogId, {
        sessionDate: addDays(50),
        idempotencyKey: `deadlock-repro:${catalogId}:${Date.now()}`,
      });

      const startedAt = Date.now();

      // Outer withBusinessContext mirrors telegram.ts:1490's
      // handleTelegramWebhookPost -> handleCallbackQuery wrap.
      const attempt = withBusinessContext(businessId, async () => {
        // Mirrors checkEnforcementAndGetMembership's real behavior inside
        // handleBookSessionExecute: takes SELECT ... FOR UPDATE on the
        // client's memberships row and holds it for the rest of THIS
        // (outer) transaction.
        const activeMembership = await getActiveMembershipForDeduction(businessId, clientPhone);
        // Confirms we really are inside an ambient transaction at this point
        // — the exact condition bookSessionInstance's isInBusinessContext()
        // guard now checks for.
        expect(isInBusinessContext()).toBe(true);

        // Before the fix, bookSessionInstance (src/session/manager.ts)
        // unconditionally opened its OWN nested withBusinessContext -- a
        // SECOND transaction on a DIFFERENT pooled connection -- while this
        // outer transaction was still open and still holding the FOR UPDATE
        // lock taken above, causing a self-deadlock. After the fix, it
        // detects the ambient context and reuses it via getConn() instead.
        return bookSessionInstance(
          businessId,
          instance.id,
          clientPhone,
          serviceId,
          `deadlock-repro:${instance.id}:${clientPhone}`,
          activeMembership
        );
      });

      const result = await attempt;
      const elapsedMs = Date.now() - startedAt;

      // The discriminating signal (matches this test's pre-fix counterpart,
      // which asserted the opposite): a still-broken guard hangs for ~10s
      // (DB_STATEMENT_TIMEOUT_MS in src/database/db.ts) before failing. The
      // fix completes in well under a second.
      expect(result.status).toBe('success');
      expect(elapsedMs).toBeLessThan(2000);

      // sessionsRemaining decremented exactly once (3 -> 2) — proves the
      // deduction ran inside the SAME transaction as the lock-holding read,
      // not a second, contending one.
      const postRows = await db
        .select({ sessionsRemaining: memberships.sessionsRemaining })
        .from(memberships)
        .where(eq(memberships.id, membership.id));
      expect(postRows[0].sessionsRemaining).toBe(2);

      const ledgerRows = await db
        .select()
        .from(membershipLedger)
        .where(
          and(
            eq(membershipLedger.membershipId, membership.id),
            eq(membershipLedger.operationType, 'session_deducted'),
            eq(membershipLedger.bookingId, result.bookingId)
          )
        );
      expect(ledgerRows).toHaveLength(1);
    },
    15000
  );

  it(
    'control: does NOT hang when the client has NO active membership ' +
      '(no FOR UPDATE lock is ever taken, so the nested transaction never contends)',
    async () => {
      const clientPhone = uniquePhone('no-membership-control');
      const instance = await insertTestSessionInstance(catalogId, {
        sessionDate: addDays(51),
        idempotencyKey: `deadlock-control:${catalogId}:${Date.now()}`,
      });

      const startedAt = Date.now();

      const attempt = withBusinessContext(businessId, async () => {
        const activeMembership = await getActiveMembershipForDeduction(businessId, clientPhone);
        expect(activeMembership).toBeNull();
        return bookSessionInstance(
          businessId,
          instance.id,
          clientPhone,
          serviceId,
          `deadlock-control:${instance.id}:${clientPhone}`,
          activeMembership
        );
      });

      const result = await attempt;
      const elapsedMs = Date.now() - startedAt;

      expect(result.status).toBe('success');
      // Confirms the earlier failure is specifically about lock contention on
      // a real membership row, not the mere act of nesting withBusinessContext.
      expect(elapsedMs).toBeLessThan(5000);
    },
    10000
  );
});
