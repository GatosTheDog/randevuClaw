---
status: complete
phase: 08-enforcement-session-deduction
source: [08-01-SUMMARY.md, 08-02-SUMMARY.md, 08-03-SUMMARY.md, 08-04-SUMMARY.md, 08-05-SUMMARY.md, 08-06-SUMMARY.md]
started: 2026-07-21T00:00:00Z
updated: 2026-07-21T00:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server/service. Clear ephemeral state (temp DBs, caches, lock files). Start the application from scratch. Server boots without errors, any migration completes, and a primary query (health check, homepage load, or basic API call) returns live data.
result: pass

### 2. Full test suite: 317 passing, 0 failed
expected: Run `npx jest --no-coverage` from the repo root. Output shows 317 tests passing, 1 skipped (rls-enforcement without DATABASE_APP_URL), 0 failures. Exit code 0. Includes Phase 8 tests: billing-session-deduction (5), billing-enforcement-policy (3), function-executor Phase 8 block (6), enforcement-session-deduction (7), booking-enforcement (3), enforcement-nlu (4).
result: pass
note: "320 passed (3 more than SUMMARY's 317 — billing-package-deactivate fix); 0 failures, 1 skipped. Green."

### 3. Live Neon DB: enforcement_policy column applied
expected: Run `psql $DATABASE_URL -c "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='businesses' AND column_name='enforcement_policy';"` against the production Neon DB. Returns 1 row with data_type=text and column_default='allow'::text. (If not yet applied, run `psql $DATABASE_URL -f migrations/0007_enforcement_policy.sql` first — this was explicitly deferred in Plan 08-02.)
result: pass

### 4. Block enforcement: booking refused without active membership
expected: With a business set to `enforcement_policy='block'` and a client who has no active membership, attempt to book an appointment. The bot returns a Greek refusal message containing "ενεργή συνδρομή" (active subscription). No booking row is inserted in the DB. (Can verify via unit test: `npx jest tests/function-executor.test.ts --no-coverage -t "block"` → test asserting insertBooking call count = 0 passes.)
result: pass

### 5. Flag enforcement: alert sent before owner booking keyboard
expected: With `enforcement_policy='flag'` and a client without an active membership, submit a booking. The owner receives a Telegram flag-alert message BEFORE the booking-keyboard message (the alert uses invocationCallOrder to confirm ordering). The booking still proceeds. (Verify via: `npx jest tests/function-executor.test.ts --no-coverage -t "flag"` → ordering assertion passes.)
result: pass

### 6. Session deduction on booking; credit restore on cancel
expected: A client with a finite active membership (sessionsRemaining=N) books an appointment → sessionsRemaining becomes N-1 and a `session_deducted` ledger row exists. Cancelling that booking → sessionsRemaining returns to N and a `credit_restored` ledger row exists. Unlimited memberships (sessionsRemaining=null) skip deduction entirely. (Verify via: `npx jest tests/enforcement-session-deduction.test.ts --no-coverage` → 7 passed including SESS-01/02/03/04.)
result: pass

### 7. Owner sets enforcement policy via Telegram chat
expected: Owner sends a message expressing intent to block clients without membership (e.g., "θέλω να μπλοκάρω απλήρωτους πελάτες"). Gemini routes to `set_enforcement_policy({policy: 'block'})`. Bot replies with Greek confirmation containing "πολιτική". DB `businesses.enforcement_policy` updated to 'block'. Invalid value (e.g., "deny") returns "Μη έγκυρη πολιτική" without a DB write. (Can also verify via: `npx jest tests/billing-enforcement-policy.test.ts --no-coverage` → 3 passed.)
result: pass

### 8. Race guard: concurrent bookings with 1 session slot
expected: Run `npx jest tests/enforcement-session-deduction.test.ts --no-coverage -t "race"`. Test proves SELECT FOR UPDATE serializes two concurrent `bookWithDeduction` calls when sessionsRemaining=1: exactly 1 booking succeeds, sessionsRemaining=0, never -1. The second attempt hits "NO_CAPACITY" (hasCapacity check). All 7 tests pass.
result: pass

### 9. Wave 0 scaffolding: billing-session-deduction.test.ts stubs created
expected: billing-session-deduction.test.ts created with 5 it.todo stubs covering SESS-01..04 (Wave 0 scaffolding)
result: pass
source: automated
coverage_id: D1

### 10. Wave 0 scaffolding: billing-enforcement-policy.test.ts stubs created
expected: billing-enforcement-policy.test.ts created with 3 it.todo stubs covering ENFC-01 (Wave 0 scaffolding)
result: pass
source: automated
coverage_id: D2

### 11. Wave 0 scaffolding: function-executor.test.ts Phase 8 describe block
expected: function-executor.test.ts extended with Phase 8 describe block: 6 it.todo stubs for ENFC-02/03 and SESS-01/02/04
result: pass
source: automated
coverage_id: D3

## Summary

total: 11
passed: 11
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none yet]
