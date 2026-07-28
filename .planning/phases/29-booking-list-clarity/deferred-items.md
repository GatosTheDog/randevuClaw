# Phase 29 — Deferred Items

## SBOK-04 "multi-booking partial success" test — pre-existing catalog-uniqueness bug

**Found during:** Plan 29-02, Task 1 (out of scope per deviation-rules scope boundary)

**File:** `tests/session-booking-flow.test.ts`, describe block `SBOK-04: multi-session booking`, test `multi-booking partial success: one full session does not block booking of other sessions in the array`.

**Issue:** The test's `beforeAll` creates a session catalog for `(businessId, serviceId)` with `capacity: 10`. The test itself then calls `insertTestSessionCatalog(businessId, serviceId, { capacity: 5 })` to create a second "full" catalog — but this collides with the DB's `unique_active_catalog_per_business_service` constraint (only one *active* catalog per business+service pair), causing the insert to fail with a duplicate-key error.

**Verified pre-existing:** Reproduced identically via `git stash` (reverting all Plan 29-02 changes) before touching any Plan 29-02 code — confirms this is not a regression introduced by Plan 29-02.

**Not fixed here:** Out of scope per the executor's scope boundary rule (pre-existing failure, unrelated to Plan 29-02's D-01/D-02 target: the 4 `listSessions()` call sites and the `hoursUntilSessionInAthens` consolidation).

**Suggested fix (for whoever picks this up):** Give the "full" instance its own `serviceId` (via a second `findServiceById`/insert), or mark the original catalog `isActive: false` before inserting the second one, or use a distinct business entirely for this one test case.
