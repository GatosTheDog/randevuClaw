---
phase: 02-ai-booking-conversations-owner-alerts
plan: 1
subsystem: database
tags: [drizzle, postgres, neon, zod, pino, jest, telegram]

requires:
  - phase: 01-foundation-webhook-business-resolution
    provides: businesses/messages/client_business_relationships schema, fail-fast Config, typed query layer conventions, idempotent fixture seeding
provides:
  - Drizzle schema for services, business_hours, bookings, conversation_turns, telegram_updates (live-pushable via migrations/0001_chief_karen_page.sql)
  - businesses.owner_telegram_id (nullable, backfilled by seed())
  - Partial unique index unique_active_slot_per_business (D-10/D-11 correctness fix over 02-RESEARCH.md's blanket-index example)
  - Full typed query layer (16 functions, 5 interfaces) for services/hours/bookings/conversation-turns/telegram-dedup
  - GEMINI_API_KEY/TELEGRAM_BOT_TOKEN/TELEGRAM_WEBHOOK_SECRET/OWNER_TELEGRAM_ID added to fail-fast Config + logger redaction
  - Idempotent seed of 3 distinct-duration Greek services + full 7-day hours table per fixture business, plus ownerTelegramId backfill
affects: [02-02, 02-03, 02-04, 02-05]

tech-stack:
  added: []
  patterns:
    - "Partial unique index (uniqueIndex(...).where(sql\`...\`)) as the DB-level double-booking guard, scoped to active statuses only — a blanket index would permanently block a slot after one cancellation"
    - "Idempotent insert via onConflictDoNothing().returning(...) — empty array means 'ignored', extended from Phase 1's messages-table dedup pattern to bookings (2 separate unique indexes) and telegram_updates"
    - "Batched single insert() call per table for fixture seeding, guarded by a per-business existing-rows check, so re-seeding is a true no-op"
    - "Real-Postgres integration tests (tests/booking-queries.test.ts) for correctness properties that cannot be proven against a mocked db (partial-index enforcement, slot release on cancellation)"

key-files:
  created:
    - migrations/0001_chief_karen_page.sql
    - migrations/meta/0001_snapshot.json
    - tests/booking-queries.test.ts
  modified:
    - src/database/schema.ts
    - src/config.ts
    - src/utils/logger.ts
    - src/database/queries.ts
    - src/database/seed.ts
    - tests/jest.setup.ts
    - tests/config.test.ts
    - tests/fixtures.test.ts
    - tests/idempotency.test.ts
    - tests/consent.test.ts
    - tests/webhook.test.ts

key-decisions:
  - "bookings.unique_active_slot_per_business is a PARTIAL unique index (WHERE booking_status IN ('pending_owner_approval','confirmed')), not a blanket one — corrects a correctness bug present in 02-RESEARCH.md's schema example that would have permanently blocked a slot after a single cancellation, violating D-11"
  - "expireStalePendingBookings computes its cutoff in application code (new Date(Date.now() - cutoffMs)) rather than a Postgres NOW() - INTERVAL expression, for testability and no server-timezone dependency"
  - "insertBooking does not disambiguate which of the two unique indexes caused a conflict — that's Plan 02-04's orchestration-layer job, not this query layer's"
  - "Real-Postgres integration tests run against a local test Postgres database (randevuclaw_test) rather than the live Neon DB, since no live DATABASE_URL credential is available inside this sandboxed worktree — same sandbox limitation Phase 1 hit for the live drizzle-kit push itself"

patterns-established:
  - "Pattern: partial unique index for state-scoped exclusivity — 'active' rows are exclusive, terminal-state rows release the constraint immediately"
  - "Pattern: batch-insert-once-per-table fixture seeding guarded by per-business existing-rows checks (extends Phase 1's per-business-slug idempotency check)"

requirements-completed: [BOOK-01, BOOK-02, BOOK-03, BOOK-04, ASK-01, OWNR-02]

coverage:
  - id: D1
    description: "Live Drizzle schema (services, business_hours, bookings, conversation_turns, telegram_updates) with the partial unique_active_slot_per_business index and businesses.owner_telegram_id column"
    requirement: "BOOK-01"
    verification:
      - kind: integration
        ref: "migrations/0001_chief_karen_page.sql applied cleanly to a local Postgres DB (\\d bookings confirms the partial WHERE clause); npx drizzle-kit generate reports 'No schema changes' after the fact"
        status: pass
    human_judgment: true
    rationale: "The live Neon push itself (npx drizzle-kit push against the real DATABASE_URL) could not be executed by the agent — no live DATABASE_URL credential exists inside this sandboxed worktree, identical to the Phase 1 precedent (01-01-SUMMARY.md) where the sandbox refused a relayed live-database write. The user must run `npx drizzle-kit push` themselves once `.env.local` has the real Neon DATABASE_URL, then confirm."
  - id: D2
    description: "Full typed query layer (16 functions, 5 interfaces) for services/hours/bookings/conversation-turns/telegram-dedup, idempotency-correct and duration-accurate"
    requirement: "BOOK-02"
    verification:
      - kind: integration
        ref: "tests/booking-queries.test.ts (7 tests, real Postgres connection)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Both fixture businesses seeded with 3 distinct-duration Greek services and a full 7-day weekly hours table (at least one closed day each), plus ownerTelegramId backfilled from config"
    requirement: "BOOK-03"
    verification:
      - kind: unit
        ref: "tests/fixtures.test.ts (9 tests, mocked db)"
        status: pass
      - kind: integration
        ref: "npx ts-node src/database/seed.ts run twice against local Postgres — verified via psql that both fixtures have 3 services with distinct duration_min and 7 business_hours rows each"
        status: pass
    human_judgment: false
  - id: D4
    description: "Environment config fails fast on GEMINI_API_KEY/TELEGRAM_BOT_TOKEN/TELEGRAM_WEBHOOK_SECRET/OWNER_TELEGRAM_ID, secrets redacted in logger, without breaking any Phase 1 test"
    requirement: "ASK-01"
    verification:
      - kind: unit
        ref: "tests/config.test.ts (3 tests)"
        status: pass
      - kind: unit
        ref: "Phase 1 regression suite (business-resolver, whatsapp-client, webhook, idempotency, consent, consent-schema) — 46/46 total tests pass"
        status: pass
    human_judgment: false
  - id: D5
    description: "Both fixture businesses have a non-null owner_telegram_id after seeding, resolvable for Plan 02-04/02-05's owner approval alert routing"
    requirement: "OWNR-02"
    verification:
      - kind: unit
        ref: "tests/fixtures.test.ts — Test 4: backfills ownerTelegramId from config for both fixtures, on every run"
        status: pass
    human_judgment: false

duration: ~1h
completed: 2026-07-08
status: complete
---

# Phase 2 Plan 1: Booking Data Substrate Summary

**Drizzle schema for services/business_hours/bookings/conversation_turns/telegram_updates with a partial unique index preventing double-booking while releasing slots immediately on cancellation, a 16-function typed query layer, and idempotently-seeded Greek fixture data (3 distinct-duration services + full weekly hours per business)**

## Performance

- **Duration:** ~1h
- **Tasks:** 3/3 completed
- **Files modified:** 14 (3 created, 11 modified)

## Accomplishments
- Live-pushable Drizzle schema for all 5 Phase 2 tables, including the critical `unique_active_slot_per_business` **partial** unique index (corrects a blanket-index bug present in `02-RESEARCH.md`'s example that would have permanently blocked a slot after one cancellation)
- Full typed query layer (16 functions, 5 interfaces) — `insertBooking`, `findActiveBookingSlotsForDate` (per-booking duration via JOIN, not caller-assumed duration), `expireStalePendingBookings`, `insertOrIgnoreTelegramUpdate`, and more — verified against a real Postgres connection, not mocks
- `GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `OWNER_TELEGRAM_ID` added to the fail-fast `Config` and redacted in the logger, with zero Phase 1 test regressions (46/46 tests pass)
- Both fixture businesses (`pilates-athens`, `hair-salon-athens`) idempotently seeded with 3 distinct-duration Greek services each and a realistic 7-day weekly hours table (each with at least one closed day), plus `ownerTelegramId` backfilled from config

## Task Commits

1. **Task 1: Phase 2 schema extension, config, and migration** - `4bdb544` (feat)
2. **Task 2: Typed query layer for services/hours/bookings/conversation/telegram-dedup** - `2809a90` (feat)
3. **Task 3: Seed realistic Greek services and weekly hours for both fixture businesses** - `ad51a38` (feat)

## Files Created/Modified
- `src/database/schema.ts` - Extended `businesses` with `ownerTelegramId`; added `services`, `businessHours`, `bookings` (partial + plain unique indexes), `conversationTurns`, `telegramUpdates`
- `src/config.ts` - Added `geminiApiKey`, `telegramBotToken`, `telegramWebhookSecret`, `ownerTelegramId` to fail-fast `Config`
- `src/utils/logger.ts` - Redact paths extended for the 3 new secrets
- `src/database/queries.ts` - 16 new functions + 5 new interfaces (`Service`, `BusinessHours`, `Booking`, `ConversationTurn`, `BookingSlot`); `Business` interface gained `ownerTelegramId`
- `src/database/seed.ts` - `SERVICE_FIXTURES`, `HOURS_FIXTURES` constants; `seed()` now also backfills `ownerTelegramId` and batches services/hours inserts
- `migrations/0001_chief_karen_page.sql` - Generated migration (5 new tables, 1 new column, partial + plain unique indexes)
- `tests/booking-queries.test.ts` - New: 7 integration tests against a real Postgres connection
- `tests/jest.setup.ts`, `tests/config.test.ts` - Extended with the 4 new required env vars
- `tests/fixtures.test.ts` - Rewritten with a table-aware insert/update mock router; 4 new behavior tests
- `tests/idempotency.test.ts`, `tests/consent.test.ts`, `tests/webhook.test.ts` - `ownerTelegramId: null` added to mocked `Business` objects (Rule 1 fix, see below)

## Decisions Made
- Partial unique index (`WHERE booking_status IN ('pending_owner_approval','confirmed')`) implements both D-10 (active bookings are exclusive) and D-11 (inactive ones release the slot immediately) — a blanket index would satisfy only D-10 and permanently violate D-11
- `expireStalePendingBookings` computes its cutoff in application code, not a Postgres interval expression, for testability
- `insertBooking` deliberately does not disambiguate which of the two unique indexes caused a conflict — that's Plan 02-04's orchestration-layer responsibility

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `Business.ownerTelegramId` interface change broke 3 Phase 1 test files**
- **Found during:** Task 2 (running the full regression suite)
- **Issue:** Adding the required `ownerTelegramId: string | null` field to the `Business` interface (per this plan's own `<interfaces>` spec) broke TypeScript compilation in `tests/idempotency.test.ts`, `tests/consent.test.ts`, and `tests/webhook.test.ts`, which construct mocked `Business` objects without that field
- **Fix:** Added `ownerTelegramId: null` to each mocked `Business` object literal in the 3 affected test files
- **Files modified:** tests/idempotency.test.ts, tests/consent.test.ts, tests/webhook.test.ts
- **Verification:** `npx tsc --noEmit` exits 0; full regression suite passes (46/46 tests)
- **Committed in:** 2809a90 (Task 2 commit)

**2. [Rule 1 - Bug] pilates-athens service durations as literally specified in the plan were not 3 distinct values**
- **Found during:** Task 3 (writing/running `tests/fixtures.test.ts` Test 1, which the plan itself mandates: "pilates-athens has exactly 3 services with distinct durationMin values")
- **Issue:** The plan's literal fixture data specified `Ομαδικό Pilates: 55min`, `Ιδιαίτερο Pilates: 55min`, `Reformer Pilates: 50min` — only 2 distinct duration values, directly conflicting with the plan's own acceptance test
- **Fix:** Changed `Ιδιαίτερο Pilates` (private sessions) from 55min to 60min — realistic (private sessions commonly run longer than group classes) and now all 3 durations are distinct
- **Files modified:** src/database/seed.ts
- **Verification:** tests/fixtures.test.ts Test 1 passes; verified against real local Postgres via `npx ts-node src/database/seed.ts` (durations: `{50,55,60}`)
- **Committed in:** ad51a38 (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs, both directly caused by this plan's own interface/data specifications conflicting with its own test requirements)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered

**The `[BLOCKING]` live schema push (`npx drizzle-kit push`) could not be executed by the agent** — identical to the Phase 1 precedent (see `01-01-SUMMARY.md` "Issues Encountered"). No live `DATABASE_URL` credential exists inside this sandboxed worktree (no `.env`/`.env.local`, no shell env var). `npx drizzle-kit push` failed immediately with `Either connection "url" or "host", "database" are required for PostgreSQL database connection`.

To still verify correctness and satisfy Task 2's real-Postgres integration-test requirement (Phase 1 has no real-DB test precedent to reuse), a local test Postgres database (`randevuclaw_test`, on the machine's existing local `postgres` instance at `localhost:5432`) was created and both migrations (`0000_cloudy_expediter.sql`, `0001_chief_karen_page.sql`) were applied to it directly via `psql`. This confirmed:
- Both migrations apply cleanly with no errors
- All 8 tables exist with the correct columns/indexes (including the partial `WHERE` clause on `unique_active_slot_per_business`)
- `tests/booking-queries.test.ts`'s 7 integration tests pass against this real connection
- `npx ts-node src/database/seed.ts` run twice against this DB produces the expected idempotent result (verified via direct `psql` queries)
- `npx drizzle-kit generate` reports "No schema changes, nothing to migrate" after all changes — confirming `schema.ts` and the committed migration are in sync

**Resolution required:** The user must run `npx drizzle-kit push` themselves against the real Neon `DATABASE_URL` (added to `.env.local`), exactly as they did for Phase 1's Task 2+3 push (see `01-01-SUMMARY.md` Task Commits note). The generated migration SQL (`migrations/0001_chief_karen_page.sql`) is committed and ready to apply.

## User Setup Required

**External services require manual configuration.**
- Run `npx drizzle-kit push` against the real Neon `DATABASE_URL` (in `.env.local`) to apply `migrations/0001_chief_karen_page.sql` to the live database — the sandbox cannot perform this live-database write itself (same boundary as Phase 1).
- After the push succeeds, run `npm run db:seed` (or `npx ts-node src/database/seed.ts`) once against the live DB to populate both fixture businesses with services, business hours, and `ownerTelegramId`.
- This plan's `user_setup` frontmatter also lists three external services whose credentials are needed by Plan 02-02 onward (not required to complete THIS plan, but should be gathered before that work begins):
  - **Google AI Studio**: `GEMINI_API_KEY` (https://aistudio.google.com/apikey)
  - **Telegram (@BotFather)**: `TELEGRAM_BOT_TOKEN`, plus a self-chosen `TELEGRAM_WEBHOOK_SECRET`
  - **Telegram (@userinfobot)**: `OWNER_TELEGRAM_ID` — the developer-controlled Telegram user ID standing in for both fixture businesses' owner during Phase 2 (real owner onboarding is Phase 4 scope)

## Next Phase Readiness
- `src/database/schema.ts` and `src/database/queries.ts` contracts are locked exactly as specified in this plan's `<interfaces>` block — Plans 02-02 through 02-05 can import verbatim without modification
- The partial unique index is the load-bearing correctness guarantee for the entire phase's no-double-booking requirement (Success Criterion 5) — proven via real-Postgres integration tests, not just typechecking
- **Blocker for going live (not for continuing development):** the live Neon push and live seed run are still pending user action (see "User Setup Required" above). Plans 02-02 through 02-05 can proceed against the local test Postgres DB or their own mocked-db test conventions in the interim; only the actual production Neon database needs the manual push before end-to-end/live verification.

---
*Phase: 02-ai-booking-conversations-owner-alerts*
*Completed: 2026-07-08*
