/**
 * Verifies Phase 25.1 schema: nudge column, OAuth state table, RLS on it.
 * Prints one JSON line; exit 0 only when all three are true.
 * Never prints the connection string.
 */
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  try {
    const col = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'businesses'
         AND column_name = 'google_calendar_nudge_sent'`,
    );
    const tbl = await pool.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'google_oauth_states'`,
    );
    const rls = await pool.query(
      `SELECT c.relrowsecurity FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'google_oauth_states'`,
    );

    const result = {
      nudgeColumn: (col.rowCount ?? 0) > 0,
      statesTable: (tbl.rowCount ?? 0) > 0,
      statesRls: rls.rows[0]?.relrowsecurity === true,
    };
    console.log(JSON.stringify(result));
    await pool.end();
    process.exit(result.nudgeColumn && result.statesTable && result.statesRls ? 0 : 1);
  } catch (err) {
    console.error(`Verification failed: ${(err as Error).message}`);
    await pool.end().catch(() => undefined);
    process.exit(1);
  }
}

void main();
