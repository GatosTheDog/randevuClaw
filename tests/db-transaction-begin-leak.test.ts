// Regression test for query-read-timeout-storm
// (.planning/debug/resolved/query-read-timeout-storm.md).
//
// Root cause: drizzle-orm's NodePgSession.transaction() (node-postgres driver,
// node_modules/drizzle-orm/node-postgres/session.js) checks out a pool client
// via `pool.connect()`, then runs `await tx.execute(sql`begin...`)` BEFORE its
// own try/finally block — the finally (which calls `session.client.release()`)
// only wraps the transaction callback's commit/rollback, NOT the initial begin
// statement. If 'begin' itself rejects (e.g. the client-side query_timeout
// firing during a Neon compute-suspend cold start), the checked-out client is
// NEVER released back to the pool: a permanent leak of one pool slot per
// occurrence, since the client is neither idle (no eviction timer starts) nor
// released (can't be reused). This explains why the "Query read timeout"
// storm compounded and never self-resolved: pool capacity shrank with every
// begin-timeout failure.
//
// Fix: src/database/db.ts now exports runInTransaction(pool, callback), which
// checks out the client itself, wraps ONLY that client instance with
// drizzle(client, {schema}) (a PoolClient is a supported NodePgClient) instead
// of the pool, and guarantees release via its OWN try/finally regardless of
// what drizzle's internal transaction() does or when it throws.
//
// This test proves the exact failure mechanism directly (no flaky real-timing
// dependency — a FakePool subclassing the real `pg.Pool` so drizzle-orm's own
// `instanceof Pool` check recognizes it, whose checked-out client's query()
// deterministically rejects on the literal 'begin' statement text) and proves
// the fix closes it, then separately verifies the happy path and an
// in-callback-error path against a REAL local Postgres connection.

import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { runInTransaction } from '../src/database/db';
import { logger } from '../src/utils/logger';

const TEST_DATABASE_URL =
  process.env.DB_ERROR_TEST_DATABASE_URL ?? 'postgresql://manolis@localhost:5432/randevuclaw_test';

class FakeClient {
  released = false;
  releasedWithErr: unknown;
  async query(config: string | { text: string }) {
    const text = typeof config === 'string' ? config : config.text;
    if (text && text.toLowerCase().startsWith('begin')) {
      throw new Error('Query read timeout');
    }
    return { rows: [], rowCount: 0 };
  }
  release(err?: unknown) {
    this.released = true;
    this.releasedWithErr = err;
  }
}

class FakePool extends Pool {
  lastClient: FakeClient | undefined;
  async connect(): Promise<PoolClient> {
    this.lastClient = new FakeClient();
    return this.lastClient as unknown as PoolClient;
  }
}

// book-session-rollback-timeout: begin succeeds, the callback fails (in prod: a
// statement stalled on a lock until the client-side query_timeout fired), and
// drizzle's ROLLBACK then queues behind that statement and times out too.
class RollbackTimeoutClient extends FakeClient {
  async query(config: string | { text: string }) {
    const text = typeof config === 'string' ? config : config.text;
    if (text && text.toLowerCase().startsWith('rollback')) {
      throw new Error('Query read timeout');
    }
    return { rows: [], rowCount: 0 };
  }
}

class RollbackTimeoutPool extends Pool {
  lastClient: FakeClient | undefined;
  async connect(): Promise<PoolClient> {
    this.lastClient = new RollbackTimeoutClient();
    return this.lastClient as unknown as PoolClient;
  }
}

describe('drizzle-orm begin-timeout client leak (query-read-timeout-storm)', () => {
  it('DOCUMENTS the underlying library bug: drizzle(pool).transaction() never releases the client when begin itself rejects', async () => {
    const fakePool = new FakePool({});
    const db = drizzle(fakePool as unknown as Pool);

    let error: unknown;
    try {
      await db.transaction(async (tx) => {
        await tx.execute('select 1');
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(fakePool.lastClient?.released).toBe(false);
  });

  it('FIX: runInTransaction releases the client even when the initial begin statement rejects', async () => {
    const fakePool = new FakePool({});

    let error: unknown;
    try {
      await runInTransaction(fakePool, async (tx) => {
        await (tx as { execute: (q: string) => Promise<unknown> }).execute('select 1');
        return null;
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    expect(fakePool.lastClient?.released).toBe(true);
    // Released with a truthy error, so pg-pool discards the (possibly
    // protocol-broken) connection instead of returning it to the idle queue.
    expect(fakePool.lastClient?.releasedWithErr).toBeDefined();
  });

  it('happy path: runInTransaction against a real local Postgres connection commits and releases cleanly', async () => {
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      const result = await runInTransaction(pool, async (tx) => {
        const rows = await tx.execute('select 1 as one');
        return rows;
      });
      expect(result).toBeDefined();
      expect(pool.idleCount).toBe(pool.totalCount);
    } finally {
      await pool.end();
    }
  });

  it('in-callback error path: runInTransaction against a real local Postgres connection rolls back and releases cleanly (no leak, no hang)', async () => {
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      let error: unknown;
      try {
        await runInTransaction(pool, async (tx) => {
          await tx.execute('select 1');
          throw new Error('simulated business logic error');
        });
      } catch (err) {
        error = err;
      }
      expect((error as Error)?.message).toBe('simulated business logic error');
      // pg-pool discards a client released with an error rather than
      // returning it to idle, so total/idle count should settle back to a
      // clean, non-leaked state (0, since the only client was destroyed).
      expect(pool.totalCount).toBe(pool.idleCount);
    } finally {
      await pool.end();
    }
  });
});

describe('runInTransaction preserves the original error when rollback also fails (book-session-rollback-timeout)', () => {
  it('logs the callback error that a failing ROLLBACK would otherwise mask, and still releases the client', async () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined as never);
    try {
      const fakePool = new RollbackTimeoutPool({});
      const original = new Error('original stalled statement');

      let thrown: unknown;
      try {
        await runInTransaction(fakePool, async () => {
          throw original;
        });
      } catch (err) {
        thrown = err;
      }

      // Caller still sees the rollback failure (behaviour unchanged) ...
      expect(thrown).toBeDefined();
      expect(thrown).not.toBe(original);
      expect(String((thrown as Error).message)).toContain('rollback');
      // ... but the masked original error is now in the logs.
      expect(errorSpy).toHaveBeenCalledWith(
        { err: original },
        expect.stringContaining('masked')
      );
      expect(fakePool.lastClient?.released).toBe(true);
      expect(fakePool.lastClient?.releasedWithErr).toBeDefined();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not emit the masking log when rollback succeeds and the original error propagates', async () => {
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined as never);
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    try {
      let thrown: unknown;
      try {
        await runInTransaction(pool, async (tx) => {
          await tx.execute('select 1');
          throw new Error('plain business error');
        });
      } catch (err) {
        thrown = err;
      }
      expect((thrown as Error).message).toBe('plain business error');
      expect(errorSpy).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('masked'));
    } finally {
      errorSpy.mockRestore();
      await pool.end();
    }
  });
});
