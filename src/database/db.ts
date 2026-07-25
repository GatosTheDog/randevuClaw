import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { config } from '../config';
import { logger } from '../utils/logger';

// Debug (webhook-hang-no-reply): pg Pool previously had connectionTimeoutMillis
// (bounds acquiring a connection from the pool) but NO bound on a query that
// already has a connection and simply never returns (e.g. a lock wait, a
// runaway query, or a DB-side stall). That was a never-fully-ruled-out
// blind spot for the "webhook hangs, no reply" investigation: any getConn()
// query inside withBusinessContext() sits in the same awaited chain as the
// Gemini call, so an unbounded query can hang the webhook handler exactly
// like the (now-fixed) unbounded Gemini call did.
// statement_timeout: server-side abort of any single SQL statement running
//   longer than this (ms) — enforced by Postgres itself, so it applies even
//   if the client-side query_timeout somehow doesn't fire.
// query_timeout: client-side (node-postgres) abort of a query awaiting a
//   response longer than this (ms) — belt-and-suspenders with statement_timeout.
// idle_in_transaction_session_timeout: aborts a transaction (e.g. an
//   appDb.transaction() in withBusinessContext) left idle mid-transaction,
//   which would otherwise hold a connection (and potentially locks) forever.
const DB_STATEMENT_TIMEOUT_MS = 10_000;
const DB_QUERY_TIMEOUT_MS = 12_000;
const DB_IDLE_IN_TRANSACTION_TIMEOUT_MS = 15_000;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: 5000,
  statement_timeout: DB_STATEMENT_TIMEOUT_MS,
  query_timeout: DB_QUERY_TIMEOUT_MS,
  idle_in_transaction_session_timeout: DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
});
// pg recommends an 'error' listener on the pool for errors emitted by idle
// clients (e.g. a backend-terminated connection) — without one, an
// unhandled 'error' event can crash the process. Logging here also gives us
// a signal in fly logs if the DB connection itself is the problem.
pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle admin-db pool client');
});

export const db = drizzle(pool, { schema });

/**
 * appPool / appDb — App connection using randevuclaw_app role (D-11).
 *
 * appDb is used by withBusinessContext() in queries.ts for all
 * conversation-handling DB operations. RLS policies (migration 0003) enforce
 * per-business row isolation on this connection.
 *
 * Falls back to databaseUrl if DATABASE_APP_URL is unset, so existing tests
 * that only set DATABASE_URL continue to work without a randevuclaw_app role.
 */
export const appPool = new Pool({
  connectionString: config.databaseAppUrl ?? config.databaseUrl,
  connectionTimeoutMillis: 5000,
  statement_timeout: DB_STATEMENT_TIMEOUT_MS,
  query_timeout: DB_QUERY_TIMEOUT_MS,
  idle_in_transaction_session_timeout: DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
});
appPool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle app-db pool client');
});

export const appDb = drizzle(appPool, { schema });
