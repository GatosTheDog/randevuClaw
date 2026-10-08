---
created: 2026-10-08T00:00:00.000Z
title: Verify unique_active_slot_per_business vs session-instance bookings
area: database
files:
  - src/database/schema.ts
  - src/session/
  - tests/session-booking-flow.test.ts
---

## Problem

Found by the quick-261008-gqb planner, NOT verified. `unique_active_slot_per_business` is a unique index on (business, date, time) for active bookings, and it exists in the local test DB. Combined with `bookSessionInstance`'s bare `onConflictDoNothing`, a second client booking the same class instance at the same time could be silently swallowed (no error, no booking). The live Neon DB has not been checked.

Related: `tests/session-booking-flow.test.ts` "SBOK-04 multi-booking partial success" already fails at baseline (inserts a duplicate active catalog). It may share the root cause or be separate.

## Solution

1. Check the index on live Neon.
2. Reproduce: two clients, same class instance, same time.
3. If real, scope the index to non-session bookings (or drop it for session instances) and surface a real error instead of swallowing the conflict.
4. Fix or rewrite the SBOK-04 test.
