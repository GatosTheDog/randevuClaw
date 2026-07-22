// covers CLSS-02
// Nyquist stub: owner creates recurring sessions (weekly day/time pattern) in one chat
// action; system auto-generates instances ~90 days forward via rrule RFC 5545 expansion.
// Idempotency key format: catalog:{catalogId}:{sessionDate}:{sessionTime}.
// Stubs filled in when src/session/manager.ts rrule expansion is built (Wave 1).

describe('recurring session rrule expansion', () => {
  it.todo('expands weekly Mon/Wed/Fri pattern to ~90 days of sessionInstances (between 36 and 42 instances)');
  it.todo('expansion is idempotent on replay: re-running with same rruleString inserts zero new rows (onConflictDoNothing)');
  it.todo('idempotencyKey format is catalog:{catalogId}:{sessionDate}:{sessionTime} for each instance');
  it.todo('expansion fails cleanly with thrown error when rruleString is invalid RFC 5545');
  it.todo('DST boundary: expansion across Oct 25 2026 (UTC+3 to UTC+2) produces correct wall-clock Athens dates');
});
