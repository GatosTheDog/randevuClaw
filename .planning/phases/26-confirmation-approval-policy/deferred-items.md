# Deferred Items — Phase 26 Plan 01

Out-of-scope discoveries logged per the executor's scope boundary rule (not fixed).

## Pre-existing test bug: `tests/session-booking-flow.test.ts` — SBOK-04 "multi-booking partial success"

- **Test:** `multi-booking partial success: one full session does not block booking of other sessions in the array`
- **Failure:** `insertTestSessionCatalog(businessId, serviceId, { capacity: 5 })` (line ~676) inserts a SECOND active session catalog row for the same `(businessId, serviceId)` pair already used by this describe block's `beforeAll` (line ~586). The DB's `unique_active_catalog_per_business_service` partial unique index (`(business_id, service_id) WHERE is_active = true`) rejects the second insert.
- **Confirmed pre-existing:** Reproduced identically on a clean `git stash` of this plan's changes (baseline, before any Phase 26 edits) — same failure, same error.
- **Scope:** Lives in a different `describe` block (`SBOK-04: multi-session booking`) than the one this plan modifies (`SBOK-03: reschedule expiry gate`). Not touched by any Phase 26 task file (`src/session/manager.ts`, `src/conversation/function-executor.ts`, `src/webhooks/telegram.ts`).
- **Action:** Left unfixed per the executor's scope boundary rule. A future test-suite-health pass (already flagged in `PROJECT.md`'s Context section) should either give `instanceE`'s full-catalog fixture its own dedicated test business/service pair, or reuse the existing `catalogId` with `capacity: 10` and pre-set `bookedCount: 10` instead of creating a second catalog.
