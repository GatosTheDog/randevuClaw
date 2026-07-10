import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { config } from '../config';

export const pool = new Pool({ connectionString: config.databaseUrl });

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
export const appPool = new Pool({ connectionString: config.databaseAppUrl ?? config.databaseUrl });

export const appDb = drizzle(appPool, { schema });
