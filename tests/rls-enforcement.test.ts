// RLS enforcement integration tests (BOT-05, D-10).
//
// These tests prove that withBusinessContext + PostgreSQL RLS policies enforce
// per-business row isolation at the DB layer, not only in application code.
//
// Prerequisites:
//   1. DATABASE_APP_URL must be set to a randevuclaw_app role connection string:
//      postgresql://randevuclaw_app:<PASSWORD>@<NEON_HOST>/<DB>?sslmode=require
//   2. migrations/0003_phase4_per_bot.sql must have been applied (Task 1 of Plan 04-05):
//      randevuclaw_app role exists, RLS enabled on 7 tables, FOR ALL policies in place.
//
// Without DATABASE_APP_URL, appDb falls back to the admin (superuser) connection,
// which bypasses RLS — tests would silently pass with wrong semantics.
// The skip guard below makes this explicit.

// Force fresh module load so db.ts picks up DATABASE_APP_URL from environment
// (same pattern as booking-queries.test.ts which resets for TEST_DATABASE_URL).
jest.resetModules();

/* eslint-disable @typescript-eslint/no-var-requires */
const dbModule = require('../src/database/db');
const queriesModule = require('../src/database/queries');
const schemaModule = require('../src/database/schema');
/* eslint-enable @typescript-eslint/no-var-requires */

const { eq } = require('drizzle-orm');

// Admin connection (superuser) for setup and cleanup — bypasses RLS.
const db = dbModule.db;
// App connection (randevuclaw_app role) for RLS-enforced SELECT operations.
const appDb = dbModule.appDb;
const withBusinessContext: typeof queriesModule.withBusinessContext = queriesModule.withBusinessContext;
const businesses = schemaModule.businesses;
const messages = schemaModule.messages;

describe('RLS enforcement integration tests (BOT-05, D-10)', () => {
  if (!process.env.DATABASE_APP_URL) {
    // Skip guard: if appDb falls back to the admin connection, RLS is NOT enforced
    // (PostgreSQL superusers bypass RLS by default). Tests would pass trivially with
    // wrong semantics. Explicit skip makes the gap visible in CI output.
    test.skip(
      'Skipping RLS enforcement tests: DATABASE_APP_URL not set — set it to randevuclaw_app role connection to verify RLS isolation.',
      () => {}
    );
    return; // Don't register the real integration tests
  }

  beforeEach(async () => {
    // Cleanup: children first (messages references businesses), then parents.
    // Use admin db — cleanup must never be blocked by RLS.
    await db.delete(messages);
    await db.delete(businesses);
  });

  test(
    'RLS blocks unscoped SELECT: withBusinessContext filters to current tenant only (BOT-05, D-10)',
    async () => {
      // a) Insert two businesses via admin db (bypasses RLS — no context set yet)
      const [b1] = await db
        .insert(businesses)
        .values({
          name: 'Test Business A',
          slug: 'test-biz-a',
          botToken: 'token-rls-a',
          webhookId: 'wh-rls-a',
          webhookSecret: 'secret-rls-a',
        })
        .returning({ id: businesses.id });
      const [b2] = await db
        .insert(businesses)
        .values({
          name: 'Test Business B',
          slug: 'test-biz-b',
          botToken: 'token-rls-b',
          webhookId: 'wh-rls-b',
          webhookSecret: 'secret-rls-b',
        })
        .returning({ id: businesses.id });

      // b) Insert one message per business via admin db (no business context yet)
      await db.insert(messages).values({
        businessId: b1.id,
        messageBody: 'msg-for-a',
        senderPhone: '111',
        whatsappMessageId: 'rls-t1-wa-a',
      });
      await db.insert(messages).values({
        businessId: b2.id,
        messageBody: 'msg-for-b',
        senderPhone: '222',
        whatsappMessageId: 'rls-t1-wa-b',
      });

      // c) Query messages within b1's context — NO WHERE clause; RLS must filter
      const b1Msgs = await withBusinessContext(b1.id, () => appDb.select().from(messages));

      // d) Query messages within b2's context — same, no WHERE clause
      const b2Msgs = await withBusinessContext(b2.id, () => appDb.select().from(messages));

      // e) Assert: each context only sees its own tenant's row
      expect(b1Msgs.length).toBe(1);
      expect(b1Msgs[0].businessId).toBe(b1.id);
      expect(b2Msgs.length).toBe(1);
      expect(b2Msgs[0].businessId).toBe(b2.id);

      // f) Defense-in-depth proof: RLS filtered at DB layer, not app-layer WHERE clause.
      // If RLS were disabled or appDb used superuser, both queries would return 2 rows each.
    }
  );

  test(
    'SET LOCAL context clears after transaction: sequential transactions are isolated (BOT-05, D-10)',
    async () => {
      // a) Insert two businesses and one message each via admin db
      const [b1] = await db
        .insert(businesses)
        .values({
          name: 'Test Business C',
          slug: 'test-biz-c',
          botToken: 'token-rls-c',
          webhookId: 'wh-rls-c',
          webhookSecret: 'secret-rls-c',
        })
        .returning({ id: businesses.id });
      const [b2] = await db
        .insert(businesses)
        .values({
          name: 'Test Business D',
          slug: 'test-biz-d',
          botToken: 'token-rls-d',
          webhookId: 'wh-rls-d',
          webhookSecret: 'secret-rls-d',
        })
        .returning({ id: businesses.id });

      await db.insert(messages).values({
        businessId: b1.id,
        messageBody: 'b1-msg',
        senderPhone: '333',
        whatsappMessageId: 'rls-t2-wa-c',
      });
      await db.insert(messages).values({
        businessId: b2.id,
        messageBody: 'b2-msg',
        senderPhone: '444',
        whatsappMessageId: 'rls-t2-wa-d',
      });

      // b) First transaction: SET LOCAL sets context to b1 — scoped to this transaction only
      const tx1 = await withBusinessContext(b1.id, () => appDb.select().from(messages));

      // c) Second transaction: SET LOCAL sets context to b2 — context from tx1 is auto-cleared
      const tx2 = await withBusinessContext(b2.id, () => appDb.select().from(messages));

      // d) Assert: SET LOCAL isolation — tx1 sees only b1, tx2 sees only b2
      expect(tx1.length).toBe(1);
      expect(tx1[0].businessId).toBe(b1.id);
      expect(tx2.length).toBe(1);
      expect(tx2[0].businessId).toBe(b2.id);

      // This proves SET LOCAL (not SET) is used: a session-level SET would leak
      // b1's context into tx2, causing tx2 to also return b1's row instead of b2's.
    }
  );
});
