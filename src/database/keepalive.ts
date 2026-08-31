import { pool, appPool } from './db';
import { logger } from '../utils/logger';

// Neon free-tier compute auto-suspends after a period of inactivity, and the
// first connection during a resume window can transiently fail (see
// .planning/debug/resolved/query-read-timeout-storm.md for the mechanics of a
// cold-start connection failure in this exact area). Pinging both pools
// periodically with a trivial query keeps Neon's compute warmer, reducing how
// often a real webhook/poller request is the one that has to pay the
// cold-start cost.

/**
 * Pings both `pool` (admin) and `appPool` (app) with a trivial `SELECT 1`.
 * Each ping is independently try/catch'd — a failure on one pool never skips
 * the other, and this function itself never rejects or throws.
 */
export async function runKeepAlivePing(): Promise<void> {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    logger.warn({ err }, 'Keep-alive ping failed for admin db pool');
  }

  try {
    await appPool.query('SELECT 1');
  } catch (err) {
    logger.warn({ err }, 'Keep-alive ping failed for app db pool');
  }
}

// Plain in-process setInterval, matching the existing poller pattern
// (startExpiryPoller, startMembershipExpiryPoller, etc.) exactly. Returns the
// interval handle so callers (tests, graceful shutdown) can clearInterval it.
export function startKeepAlivePoller(intervalMs: number = 90 * 1000): NodeJS.Timeout {
  return setInterval(() => {
    // Second safety net beyond runKeepAlivePing's own internal try/catches,
    // guarding against a totally unexpected top-level throw.
    runKeepAlivePing().catch((err) => logger.error({ err }, 'Unhandled keep-alive ping error'));
  }, intervalMs);
}
