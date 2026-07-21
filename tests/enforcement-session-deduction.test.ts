// covers SESS-01, SESS-02, SESS-03, SESS-04
// Integration test stubs — Nyquist Wave 0.
// All tests are it.todo until Wave 2 (billing/enforcement.ts) is implemented.
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

afterAll(() => {
  process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

describe('insertBookingWithSessionDeduction', () => {
  it.todo('SESS-01: inserts booking and deducts 1 session atomically in same transaction');
  it.todo('SESS-01: concurrent bookings on same membership deduct exactly 1 session (race guard)');
  it.todo('SESS-03: unlimited membership (sessionCount=null) booking creates no ledger entry');
  it.todo('SESS-04: unlimited membership booking does not change sessionsRemaining');
});

describe('cancelBookingWithRefund', () => {
  it.todo('SESS-02: cancellation within membership validity restores 1 session credit');
  it.todo('SESS-02: credit restore appends ledger entry with operationType credit_restored');
  it.todo('SESS-02/03: cancellation after membership expiry does not restore credit (sessions forfeited)');
});
