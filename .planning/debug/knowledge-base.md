# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## query-read-timeout-storm — drizzle-orm leaks pg pool client when initial 'begin' statement times out
- **Date:** 2026-07-26
- **Error patterns:** DrizzleQueryError, Query read timeout, begin, rollback, query_timeout, transaction, pool exhaustion, Neon cold start, non-self-resolving storm
- **Root cause:** drizzle-orm's NodePgSession.transaction() (node_modules/drizzle-orm/node-postgres/session.js:180-195) checks out a pool client and runs `await tx.execute(sql\`begin...\`)` BEFORE its own try/finally block; the finally that calls `session.client.release()` never covers that initial begin statement. When begin itself rejects (e.g. client-side query_timeout firing during a Neon compute-suspend cold start), the checked-out client is never released — a permanent leak of one pool slot per occurrence. This compounds within a single burst and across incidents (only a full process restart clears leaked clients), explaining why the "Query read timeout" storm never self-resolved.
- **Fix:** Added `runInTransaction<T>(pool, callback)` helper in src/database/db.ts that checks out the client itself, wraps only that client instance with `drizzle(client, {schema})` (making drizzle's internal `isPool` check false so drizzle skips its own leak-prone release logic), and guarantees `client.release(err)` in its own try/finally regardless of whether begin, the callback, commit, or rollback throws. Swapped all 3 direct `db.transaction()`/`appDb.transaction()` call sites to use it.
- **Files changed:** src/database/db.ts, src/database/queries.ts, src/billing/queries.ts, src/session/slotless-requests.ts, tests/db-transaction-begin-leak.test.ts
---
