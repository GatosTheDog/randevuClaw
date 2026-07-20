// covers SESS-01, SESS-02, SESS-03, SESS-04
// Integration tests against a REAL local Postgres connection — required to
// verify atomic transaction behavior, idempotency key uniqueness enforcement,
// and session deduction/credit-restore semantics for the membership_ledger table.
//
// Setup (one-time, local dev machine):
//   psql postgresql://manolis@localhost:5432/randevuclaw_test \
//     -f migrations/0006_billing_schema.sql
//   (GRANT errors for randevuclaw_app role are expected and harmless.)

const TEST_DATABASE_URL =
  process.env.BILLING_TEST_DATABASE_URL ??
  'postgresql://manolis@localhost:5432/randevuclaw_test';

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL = TEST_DATABASE_URL;
jest.resetModules();

/* eslint-disable @typescript-eslint/no-var-requires */
const { db } = require('../src/database/db');
const { eq } = require('drizzle-orm');
const { membershipLedger, memberships } = require('../src/database/schema');
const { withBusinessContext } = require('../src/database/queries');
/* eslint-enable @typescript-eslint/no-var-requires */

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

describe('session deduction — SESS-01', () => {
  it.todo('deducts 1 session atomically on booking insert');
  it.todo('deduction is idempotent on replay (same idempotency_key)');
});

describe('credit restore — SESS-02/SESS-03', () => {
  it.todo('restores credit on cancel within validity window (SESS-02)');
  it.todo('no credit restore when membership expired at cancel time (SESS-03)');
});

describe('unlimited membership — SESS-04', () => {
  it.todo('unlimited membership: no deduction row, no counter change');
});
