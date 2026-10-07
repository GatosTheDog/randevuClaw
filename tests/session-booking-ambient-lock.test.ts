// Regression test for book-session-rollback-timeout
// (.planning/debug/book-session-rollback-timeout.md).
//
// Root cause: withBusinessContext() is NOT re-entrant -- every call opens a NEW
// transaction on a NEW pooled connection, even when it is called from inside
// another withBusinessContext(). handleFoundBusiness() wraps the whole client
// conversation turn (routeConversationMessage -> aiBookingAgent -> executeTool ->
// bookSessionTool) in an outer withBusinessContext transaction (T1).
// bookSessionTool first runs checkEnforcementAndGetMembership ->
// getActiveMembershipForDeduction, which is SELECT ... FOR UPDATE on the client's
// memberships row *inside T1*. bookSessionInstance then calls withBusinessContext
// again (T2, separate connection); its deductSession needs that same memberships
// row (membership_ledger FK key-share lock + UPDATE) and blocks on T1's lock,
// while T1 is awaiting T2 in JS. Postgres cannot see that deadlock (the waiter is
// application code), so it only resolves via timeouts: on the Neon -pooler endpoint
// the server-side statement_timeout startup param is ignored, so only the 12s
// client query_timeout fires, and drizzle's ROLLBACK queues behind the still-blocked
// statement and times out again -> "Failed query: rollback / Query read timeout"
// at ~24s.
//
// Fix: bookSessionInstance joins the ambient same-business transaction (as a
// SAVEPOINT) when the caller hands it a membership -- that membership was read
// (and row-locked) under the caller's ambient transaction, so the deduction MUST
// run in that same transaction.
//
// Integration tests against a REAL local Postgres (same setup as
// tests/session-booking-flow.test.ts).

const TEST_DATABASE_URL =
  process.env.SESSION_TEST_DATABASE_URL ??
  process.env.BILLING_TEST_DATABASE_URL ??
  'postgresql://manolis@localhost:5432/randevuclaw_test';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = TEST_DATABASE_URL;
jest.resetModules();

/* eslint-disable @typescript-eslint/no-var-requires */
const { db, pool, appPool } = require('../src/database/db');
const { eq, sql } = require('drizzle-orm');
const {
  memberships,
  membershipLedger,
  sessionInstances,
  bookings,
  services,
} = require('../src/database/schema');
const { bookSessionInstance } = require('../src/session/manager');
const { withBusinessContext, getConn } = require('../src/database/queries');
const { executeTool } = require('../src/conversation/function-executor');
const { insertTestBusiness } = require('./helpers/test-business');
const { insertTestPackage, insertTestMembership } = require('./helpers/billing-fixtures');
const {
  insertTestSessionCatalog,
  insertTestSessionInstance,
} = require('./helpers/session-fixtures');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(async () => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  await Promise.allSettled([pool.end(), appPool.end()]);
});

function uniquePhone(): string {
  return `ambient-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

describe('bookSessionInstance under an ambient withBusinessContext (finite membership)', () => {
  let business: { id: number; name: string };
  let serviceId: number;
  let catalogId: number;
  let packageId: number;

  beforeAll(async () => {
    business = await insertTestBusiness();
    serviceId = await getTestServiceId(business.id);
    const catalog = await insertTestSessionCatalog(business.id, serviceId, { capacity: 10 });
    catalogId = catalog.id;
    const pkg = await insertTestPackage(business.id, {
      name: `ambient-lock pkg ${Date.now()}`,
      sessionCount: 5,
    });
    packageId = pkg.id;
  });

  it('book_session tool inside the outer conversation transaction books + deducts without self-deadlock', async () => {
    const clientPhone = uniquePhone();
    const membership = await insertTestMembership(business.id, clientPhone, packageId, {
      sessionsRemaining: 5,
    });
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: addDays(20),
      idempotencyKey: `ambient-tool:${catalogId}:${Date.now()}`,
    });

    const context = {
      business: {
        id: business.id,
        name: business.name ?? 'Test Business',
        ownerTelegramId: null,
        enforcementPolicy: 'allow',
        bookingMode: 'fixed_sessions',
        allowMultiBooking: false,
        cancellationCutoffEnabled: false,
        cancellationCutoffHours: 0,
        slotlessRequestsEnabled: false,
      },
      clientPhone,
      requestId: 'ambient-req-' + Date.now(),
      idempotencyKey: 'ambient-idem-' + Date.now() + '-' + Math.random().toString(36).slice(2),
    };

    // Exactly the shape handleFoundBusiness produces: the AI tool executes
    // inside an outer withBusinessContext transaction.
    const startedAt = Date.now();
    const result = await withBusinessContext(business.id, () =>
      executeTool(
        'book_session',
        { business_id: business.id, session_instance_id: instance.id },
        context
      )
    );
    const elapsedMs = Date.now() - startedAt;

    expect(result).toMatchObject({ success: true });
    // Pre-fix this blocked until the 10s statement_timeout (local) / 12s
    // query_timeout (Neon pooler) fired. A healthy local round trip is ~100ms.
    expect(elapsedMs).toBeLessThan(5000);

    // Everything committed together with the outer transaction.
    const membershipRows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id));
    expect(membershipRows[0].sessionsRemaining).toBe(4);

    const ledgerRows = await db
      .select()
      .from(membershipLedger)
      .where(eq(membershipLedger.membershipId, membership.id));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].sessionsDeducted).toBe(1);

    const bookingRows = await db
      .select()
      .from(bookings)
      .where(eq(bookings.sessionInstanceId, instance.id));
    expect(bookingRows).toHaveLength(1);
    expect(bookingRows[0].clientPhone).toBe(clientPhone);

    const instanceRows = await db
      .select()
      .from(sessionInstances)
      .where(eq(sessionInstances.id, instance.id));
    expect(instanceRows[0].bookedCount).toBe(1);
  }, 40_000);

  it('a failure inside the joined booking rolls back only its savepoint; the outer transaction stays usable', async () => {
    const clientPhone = uniquePhone();
    const membership = await insertTestMembership(business.id, clientPhone, packageId, {
      sessionsRemaining: 5,
    });
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: addDays(21),
      idempotencyKey: `ambient-savepoint:${catalogId}:${Date.now()}`,
    });
    const activeMembership = {
      id: membership.id,
      sessionsRemaining: membership.sessionsRemaining,
      expiresAt: membership.expiresAt,
    };

    let innerError: unknown;
    let outerStillUsable = false;
    await withBusinessContext(business.id, async () => {
      try {
        // Nonexistent serviceId -> FK violation on the bookings insert, thrown
        // from inside the joined (savepoint) booking transaction.
        await bookSessionInstance(
          business.id,
          instance.id,
          clientPhone,
          2_000_000_000,
          `ambient-savepoint:${instance.id}:${clientPhone}`,
          activeMembership
        );
      } catch (err) {
        innerError = err;
      }
      // If the failure had poisoned the outer transaction (no savepoint),
      // this statement would fail with "current transaction is aborted".
      const rows = await getConn().execute(sql`SELECT 1 AS one`);
      outerStillUsable = rows.rows[0].one === 1;
    });

    expect(innerError).toBeDefined();
    expect(outerStillUsable).toBe(true);

    // Nothing from the failed booking attempt leaked.
    const instanceRows = await db
      .select()
      .from(sessionInstances)
      .where(eq(sessionInstances.id, instance.id));
    expect(instanceRows[0].bookedCount).toBe(0);
    const membershipRows = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, membership.id));
    expect(membershipRows[0].sessionsRemaining).toBe(5);
  }, 40_000);

  it('joins the ambient transaction (same backend pid) only for the same business', async () => {
    const clientPhone = uniquePhone();
    const membership = await insertTestMembership(business.id, clientPhone, packageId, {
      sessionsRemaining: 5,
    });
    const instance = await insertTestSessionInstance(catalogId, {
      sessionDate: addDays(22),
      idempotencyKey: `ambient-pid:${catalogId}:${Date.now()}`,
    });

    const pidProbe = async () => {
      const r = await getConn().execute(sql`SELECT pg_backend_pid() AS pid`);
      return r.rows[0].pid as number;
    };

    // Same business: the booking runs on the ambient connection.
    const { withAmbientBusinessContext } = require('../src/database/queries');
    const [outerPid, innerSamePid] = await withBusinessContext(business.id, async () => {
      const outer = await pidProbe();
      const inner = await withAmbientBusinessContext(business.id, pidProbe);
      return [outer, inner];
    });
    expect(innerSamePid).toBe(outerPid);

    // Different business: must NOT reuse the ambient (RLS-scoped) transaction.
    const [outerPid2, innerOtherPid] = await withBusinessContext(business.id, async () => {
      const outer = await pidProbe();
      const inner = await withAmbientBusinessContext(business.id + 1_000_000, pidProbe);
      return [outer, inner];
    });
    expect(innerOtherPid).not.toBe(outerPid2);

    // No ambient context at all: behaves exactly like withBusinessContext.
    const standalone = await withAmbientBusinessContext(business.id, pidProbe);
    expect(typeof standalone).toBe('number');

    // Sanity: the instance/membership fixtures were untouched by the probes.
    expect(membership.sessionsRemaining).toBe(5);
    expect(instance.bookedCount).toBe(0);
  }, 40_000);
});
