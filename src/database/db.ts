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
// pg-pool detaches its idle-error listener on checkout, so a client mid-transaction
// has zero 'error' listeners; attaching here on 'connect' persists for the client's lifetime.
pool.on('connect', (client) => {
  client.on('error', (err: Error) => {
    logger.error({ err }, 'Unexpected error on checked-out admin-db pool client');
  });
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
// Same checked-out-client gap as `pool` above; higher-stakes here since
// withBusinessContext holds an appPool client open across the Gemini call.
appPool.on('connect', (client) => {
  client.on('error', (err: Error) => {
    logger.error({ err }, 'Unexpected error on checked-out app-db pool client');
  });
});

export const appDb = drizzle(appPool, { schema });

// Debug (neon-cold-start-connection-failures, quick task 260831-e0z): a
// production incident hit recurring "Connection terminated due to connection
// timeout: Connection terminated unexpectedly" errors on findBusinessByWebhookId
// and listAllBusinessIds (via the plain `db`/admin pool, called from 4
// pollers), and on runInTransaction's initial `pool.connect()` (via `appPool`,
// inside withBusinessContext). This is consistent with Neon free-tier compute
// auto-suspend: the first connection attempt during a resume window can fail
// transiently before the compute is fully back online.
//
// withConnectionRetry below retries ONLY this narrow transient-error class,
// and ONLY at safe boundaries: a bare pool.connect() call (before any client
// is checked out) and pure, side-effect-free SELECT reads. It intentionally
// never wraps a transaction callback — see runInTransaction below, and the
// query-read-timeout-storm incident this must not reintroduce a variant of.
const TRANSIENT_CONNECTION_ERROR_SUBSTRING = 'Connection terminated';

export function isTransientConnectionError(err: unknown): boolean {
  const visited = new Set<unknown>();
  let current: unknown = err;

  while (current !== null && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const message = (current as { message?: unknown }).message;
    if (typeof message === 'string' && message.includes(TRANSIENT_CONNECTION_ERROR_SUBSTRING)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

export async function withConnectionRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  retryDelaysMs: number[] = [300, 800]
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientConnectionError(err) || attempt === maxRetries) {
        throw err;
      }
      logger.warn({ err, attempt: attempt + 1, maxRetries }, 'Transient DB connection error, retrying');
      const delayMs = retryDelaysMs[attempt] ?? retryDelaysMs[retryDelaysMs.length - 1] ?? 0;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Unreachable: the loop above always either returns or throws.
  throw new Error('withConnectionRetry: exhausted retries without returning or throwing');
}

// Debug (query-read-timeout-storm): drizzle-orm's NodePgSession.transaction()
// (node_modules/drizzle-orm/node-postgres/session.js) checks out a client via
// `pool.connect()`, then runs `await tx.execute(sql`begin...`)` BEFORE its own
// try/finally block — the finally (which calls `session.client.release()`)
// only wraps the transaction callback's commit/rollback, NOT the initial
// begin statement. If 'begin' itself rejects (e.g. the client-side
// query_timeout firing during a Neon compute-suspend cold start), the
// checked-out client is NEVER released back to the pool: a permanent leak of
// one pool slot per occurrence (confirmed via a deterministic reproduction —
// see .planning/debug/resolved/query-read-timeout-storm.md). This compounds
// across a burst of failures and across the app's lifetime, since nothing but
// a full process restart clears a leaked client.
//
// Fix: check out the client ourselves, wrap ONLY that client instance with
// drizzle() (a PoolClient is a supported NodePgClient) instead of the pool,
// and guarantee release in our OWN try/finally around the whole
// transaction() call. Passing a bare client (not a Pool) makes drizzle's
// internal `isPool` check false, so drizzle skips its own checkout/release
// entirely and leaves it to us — closing the leak regardless of whether
// begin, the callback body, commit, or rollback is what fails.
type TransactionCallback<D, T> = D extends { transaction: (cb: (tx: infer TX) => Promise<unknown>) => Promise<unknown> }
  ? (tx: TX) => Promise<T>
  : never;

export async function runInTransaction<T>(
  pool: Pool,
  callback: TransactionCallback<typeof db, T>
): Promise<T> {
  const client = await withConnectionRetry(() => pool.connect());
  const clientDb = drizzle(client, { schema });
  let txError: unknown;
  // Debug (book-session-rollback-timeout): drizzle's transaction() does
  // `catch (error) { await tx.execute(rollback); throw error }`. If the
  // statement that failed was a client-side query_timeout (the server-side
  // statement is still running, e.g. a lock wait), ROLLBACK queues behind it
  // on the same connection, times out too, and ITS rejection replaces the
  // original error — the log then only says "Failed query: rollback / Query
  // read timeout" and the statement that actually stalled is lost. Capture
  // the callback's own error so it can be logged when that masking happens.
  let callbackFailed = false;
  let callbackError: unknown;
  const trackedCallback = async (tx: unknown): Promise<T> => {
    try {
      return await callback(tx as never);
    } catch (err) {
      callbackFailed = true;
      callbackError = err;
      throw err;
    }
  };
  try {
    // clientDb (drizzle(client, {schema})) has the identical schema-derived
    // transaction/tx shape as `db`/`appDb` (drizzle(pool, {schema})) — only
    // the underlying NodePgClient (Client vs Pool) differs, which isn't
    // reflected at the tx-callback type level. The cast below bridges a
    // structural TS-inference artifact (generic T defaulting to `unknown`
    // when extracted via `Parameters<>`), not a real type mismatch.
    return (await clientDb.transaction(trackedCallback as never)) as T;
  } catch (err) {
    txError = err;
    if (callbackFailed && err !== callbackError) {
      logger.error(
        { err: callbackError },
        'runInTransaction: callback failed AND rollback failed; this is the original callback error that the rollback failure masked'
      );
    }
    throw err;
  } finally {
    // Releasing with a truthy error tells pg-pool to discard the connection
    // (it may be left in an unknown protocol state after a timed-out query)
    // rather than returning a possibly-broken client to the idle queue.
    client.release(txError instanceof Error ? txError : undefined);
  }
}
