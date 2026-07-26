// Regression test for db-idle-transaction-crash (.planning/debug/db-idle-transaction-crash.md).
//
// Root cause: pg-pool removes its internal 'error' listener from a client the
// instant it's checked out (pg-pool's _acquireClient), and only re-adds it on
// check-in (_release). drizzle-orm's node-postgres session.transaction()
// checks out a client via pool.connect() and never attaches its own 'error'
// listener. So for the entire time a transaction is open (including while the
// transaction body awaits a slow external call, e.g. Gemini, inside
// withBusinessContext), the checked-out client has ZERO 'error' listeners.
// If Postgres asynchronously terminates that connection (e.g.
// idle_in_transaction_session_timeout), pg's Client._handleErrorEvent does
// `this.emit('error', err)`, which — with no listeners — makes Node's
// EventEmitter throw synchronously, crashing the whole process outside any
// try/catch.
//
// Fix: src/database/db.ts now attaches a listener to every client's 'error'
// event once, on the Pool's 'connect' event (fired once per new physical
// connection). Because pg-pool's checkout/checkin logic only ever
// adds/removes ITS OWN idleListener function reference via removeListener,
// this separately-attached listener is never stripped — it persists across
// every future checkout, whether the client is idle or in use.
//
// This test proves the exact failure mechanism directly: check out a real
// client from the pool, then manually emit 'error' on it (simulating what
// Client._handleErrorEvent does) and assert the process does not crash.
// Requires a real local Postgres test DB (see tests/booking-queries.test.ts
// for one-time setup instructions) — same pattern used by other integration
// tests in this suite.

const TEST_DATABASE_URL =
  process.env.DB_ERROR_TEST_DATABASE_URL ??
  'postgresql://manolis@localhost:5432/randevuclaw_test';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const ORIGINAL_DATABASE_APP_URL = process.env.DATABASE_APP_URL;

process.env.DATABASE_URL = TEST_DATABASE_URL;
delete process.env.DATABASE_APP_URL; // force appPool to fall back to databaseUrl
jest.resetModules();

/* eslint-disable @typescript-eslint/no-var-requires */
const { pool, appPool } = require('../src/database/db');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(async () => {
  await pool.end();
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  process.env.DATABASE_APP_URL = ORIGINAL_DATABASE_APP_URL;
});

describe('checked-out pg Pool client error handling (db-idle-transaction-crash)', () => {
  it('does not throw when a checked-out admin-db (pool) client emits an unexpected error', async () => {
    const client = await pool.connect();
    try {
      // Simulate exactly what pg's Client._handleErrorEvent does when
      // Postgres asynchronously terminates the connection (e.g.
      // idle_in_transaction_session_timeout, code 25P03) while the client is
      // checked out mid-transaction. Before the fix, this line throws
      // synchronously because pg-pool has already stripped its own
      // idleListener at checkout time and nothing else is listening.
      expect(() => {
        client.emit('error', new Error('simulated idle_in_transaction_session_timeout'));
      }).not.toThrow();
    } finally {
      // The client is now in a simulated-broken state; release(true) tells
      // the pool to destroy it rather than returning it to the idle queue.
      client.release(true);
    }
  });

  it('does not throw when a checked-out app-db (appPool) client emits an unexpected error', async () => {
    // appPool is the one withBusinessContext()/appDb.transaction() actually
    // checks out for the whole conversation-handling callback (the exact
    // path that crashed in production).
    const client = await appPool.connect();
    try {
      expect(() => {
        client.emit('error', new Error('simulated idle_in_transaction_session_timeout'));
      }).not.toThrow();
    } finally {
      client.release(true);
    }
    await appPool.end();
  });
});
