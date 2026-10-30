---
status: resolved
trigger: "it does not let me press approve or reject and always prints out the the action is not recocnized"
created: 2026-10-30
updated: 2026-10-30
---

## Symptoms
- expected: owner taps Έγκριση/Απόρριψη on a booking approval message and booking is approved/rejected
- actual: tap does nothing useful; bot replies "Η ενέργεια δεν αναγνωρίστηκε." (src/webhooks/telegram.ts:855, reached when parseCallbackData returns null)
- errors: log 'Malformed callback_query data' expected
- timeline: unknown; recent commits added repeat/series booking in client-menu.ts (7bf5baa, f5fa7c1)
- reproduction: client books a session, owner taps Έγκριση/Απόρριψη

## Current Focus
hypothesis: CONFIRMED - unique_active_slot_per_business covered session (class) bookings, so a 2nd client booking a class slot was swallowed by onConflictDoNothing; bookSessionInstance returned {status:'success'} with no bookingId and client-menu built `sbk:approve:undefined`.
test: DB-backed reproduction + regression tests (tests/session-booking-flow.test.ts SBOK-05, tests/client-menu-series.test.ts)
expecting: n/a - fixed
next_action: none (apply migration 0015 to production Neon DB)

## Evidence
- timestamp: 2026-10-30
  checked: all callback_data builders in src (grep) vs parseCallbackData regexes in src/webhooks/telegram.ts:637-750
  found: every literal builder (sbk:, approve_/reject_, slotless, renewal, otc, billing, escl, menu, cmenu, consent) matches its regex when the interpolated id is a number. Only unguarded interpolations of a possibly-undefined id are client-menu.ts:405-406 (bookResult.bookingId, type `bookingId?: number`).
  implication: the only way to produce a non-matching approve/reject callback_data is an undefined/non-numeric bookingId
- timestamp: 2026-10-30
  checked: src/session/manager.ts bookSessionInstance lines 300-330
  found: insert uses .onConflictDoNothing() with no conflict target; on 0 returned rows it assumes idempotent replay and returns {status:'success', bookingId: existingRows[0]?.id} where the lookup is `WHERE request_id = key` (no client scoping) — undefined if the conflict was on unique_active_slot_per_business rather than unique_request_per_client
  implication: slot-index conflicts are reported as success with bookingId undefined
- timestamp: 2026-10-30
  checked: schema + local DB indexes
  found: unique_active_slot_per_business UNIQUE (business_id, calendar_date, calendar_time) WHERE status IN (pending_owner_approval, confirmed) is live in randevuclaw_test; no migration drops it. Session classes legitimately hold many clients at the same date/time.
  implication: second booking of any class slot by another client (while first is pending/confirmed) hits this index
- timestamp: 2026-10-30
  checked: function-executor.ts 615/695/825 sbk keyboards
  found: they guard with `&& result.bookingId`, so they send no keyboard rather than a bad one; client-menu.ts bookOneInstance does not guard
  implication: only the menu path (cmenu:book) emits the malformed callback_data (the AI-chat paths instead tell the client "booked" with booking_id undefined and send the owner nothing)
- timestamp: 2026-10-30
  checked: REPRODUCTION against local randevuclaw_test Postgres (scratch test): business with capacity-5 session instance; client A then client B call bookSessionInstance on the same instance with distinct idempotency keys
  found: result = {a:{status:'success',bookingId:4558}, b:{status:'success'}} ; bookings table has exactly 1 row for the business. B gets "success" with NO bookingId and NO booking row.
  implication: CONFIRMED mechanism. handleBookSessionExecute/bookOneInstance then emits `sbk:approve:undefined` to the owner -> parseCallbackData null -> "Η ενέργεια δεν αναγνωρίστηκε." Also client B is told "request sent" for a booking that was never created, and a class can effectively hold only ONE active booking (todo #3 from rebook follow-ups is real).
- timestamp: 2026-10-30
  checked: baseline vs after test runs (full suite, local randevuclaw_test)
  found: baseline 10 failing tests / 12 failing suites (suite count flips to 23 on a cold ts-jest cache because of unrelated TS2451 redeclare errors in tests). After fix: no new failures attributable to the change. tests/session-cancel.test.ts 'poller dedup' fails with a 5s timeout identically with the fix stashed (poller scans accumulated test data; flaky, which poller test fails varies run to run). SBOK-04 'multi-booking partial success' still fails: cause is a fixture bug (second active session_catalog for the same service violates unique_active_catalog_per_business_service), NOT the slot index.
  implication: the todo's guess that SBOK-04 failure relates to the slot index is wrong; pre-existing unrelated failures remain untouched

## Eliminated
- hypothesis: sbk:approve:<id> / sbk:reject:<id> built in client-menu.ts:405 and function-executor.ts fail regex ^sbk:(approve|reject):(\d+)$ — they match when bookingId is a number
- hypothesis: callback_data > 64 bytes — sbk:approve:<serial int> is ~20 bytes; assertCallbackDataSize only warns anyway
- hypothesis: routing/dedup/bot token path before parseCallbackData mangles data — handleCallbackQuery passes update.callback_query.data verbatim

## Resolution
root_cause: unique_active_slot_per_business (business_id, calendar_date, calendar_time) WHERE status IN (pending_owner_approval, confirmed) applied to fixed-session class bookings too, although a class holds many clients at the same date/time. A 2nd client's INSERT hit it and was silently swallowed by bookSessionInstance's argument-less onConflictDoNothing(); the "idempotent replay" fallback looked up request_id (unscoped by client), found nothing, and returned {status:'success', bookingId: undefined}. client-menu.ts bookOneInstance (unlike function-executor.ts) had no bookingId guard and sent the owner `sbk:approve:undefined`/`sbk:reject:undefined`, which parseCallbackData rejects -> "Η ενέργεια δεν αναγνωρίστηκε.".
fix: (1) migration 0015 + schema.ts: unique_active_slot_per_business now only applies to non-session bookings (session_instance_id IS NULL, open_slots semantics unchanged); new unique_active_client_per_session_instance (session_instance_id, client_phone) keeps one client from holding two seats in one class. (2) bookSessionInstance: replay lookup scoped to (client_phone, request_id); a zero-row insert with no replay now returns {status:'conflict'} (+ reason:'already_booked' when the client already holds an active seat) instead of success-without-id. (3) client-menu.ts bookOneInstance: refuses to continue without a numeric bookingId (fails closed, no keyboard, no false "request sent"); new 'already_booked' client message. function-executor.ts bookSessionTool: specific already_booked reply.
verification: new tests - tests/session-booking-flow.test.ts SBOK-05 (6 DB-backed tests: 2 clients/same class get distinct ids + bookedCount 2, callback_data matches parser regex, replay idempotent, key-scope, same-client duplicate -> conflict/already_booked with no capacity consumed, open-slot index still exclusive) and tests/client-menu-series.test.ts (3 tests: parseable owner keyboard, success-without-id sends no keyboard and no false confirmation, already-booked message). Fail without the src fix, pass with it. tsc --noEmit clean. Full suite: no new failures vs baseline (remaining failures pre-existing/flaky, see Evidence).
files_changed: [migrations/0015_session_bookings_slot_index.sql, src/database/schema.ts, src/session/manager.ts, src/telegram/handlers/client-menu.ts, src/conversation/function-executor.ts, tests/session-booking-flow.test.ts, tests/client-menu-series.test.ts]
deploy_note: migration 0015 was applied to the LOCAL randevuclaw_test DB only. Production (Neon) must run `npm run db:apply-sql -- migrations/0015_session_bookings_slot_index.sql` (idempotent, safe to re-run). Until then production still allows one active booking per class, but the code now fails closed (client gets "not available") instead of a broken approval button.
follow_up: bookSessionInstance replay path returns {success, id} for an existing booking with the same idempotency key even if that booking is cancelled/rejected/expired (deterministic keys like cmenu:book:<tg>:<instance> make re-booking a class after cancel a phantom success pointing at the dead booking). Not touched here.
