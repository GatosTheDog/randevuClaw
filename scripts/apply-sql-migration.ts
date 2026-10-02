/**
 * Applies one idempotent SQL migration file from ./migrations using the admin
 * DATABASE_URL (DDL needs table ownership).
 *
 * Usage: npm run db:apply-sql -- migrations/0013_google_calendar_connect.sql
 *
 * Never prints the connection string.
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

// Same load order as drizzle.config.ts; shell variables win (dotenv does not
// override), which lets a developer point this at a local test database.
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

function usage(): never {
  console.error('Usage: npm run db:apply-sql -- migrations/<file>.sql');
  process.exit(1);
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) usage();

  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  const resolved = path.resolve(process.cwd(), arg);
  if (!resolved.startsWith(migrationsDir + path.sep) || !resolved.endsWith('.sql')) {
    usage();
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  let sqlText: string;
  try {
    sqlText = fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    console.error(`Cannot read migration file: ${(err as Error).message}`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(sqlText);
    console.log(`Applied ${path.basename(resolved)}`);
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error(`Migration failed: ${(err as Error).message}`);
    await pool.end().catch(() => undefined);
    process.exit(1);
  }
}

void main();
