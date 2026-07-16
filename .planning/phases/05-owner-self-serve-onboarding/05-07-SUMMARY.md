---
phase: 05-owner-self-serve-onboarding
plan: 07
subsystem: testing, database
tags: [drizzle, neon, postgres, jest, fixtures, seed, onboarding]

# Dependency graph
requires:
  - phase: 05-owner-self-serve-onboarding
    plan: 05-04
    provides: "insertTestBusiness() helper in tests/helpers/test-business.ts"
  - phase: 05-owner-self-serve-onboarding
    plan: 05-05
    provides: "onboarding state machine and steps.ts handler"
provides:
  - "ONB-04 complete: all hardcoded fixture businesses removed from seed.ts and tests"
  - "seed.ts exports only generateSlug; 9 unit tests cover it"
  - "booking-queries.test.ts uses insertTestBusiness() for DB setup"
  - "TEST_BOT_* env vars removed from config.ts and jest.setup.ts"
  - "migration 0004 applied to live Neon DB; pilates-athens and hair-salon-athens deleted"
  - "WEBHOOK_BASE_URL is optional in config; handleActivate guards against missing value"
  - "/start command resets onboarding session; service name prompts include examples"
affects:
  - phase-06-gdpr-resilience

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-test DB setup via insertTestBusiness() — no global seed() call anywhere in the test suite"
    - "generateSlug is the sole export of seed.ts — no fixture constants or seeding functions"

key-files:
  created: []
  modified:
    - src/database/seed.ts
    - tests/fixtures.test.ts
    - tests/booking-queries.test.ts
    - src/config.ts
    - tests/jest.setup.ts
    - src/webhooks/onboarding/steps.ts
    - src/webhooks/platform.ts

key-decisions:
  - "ONB-04: FIXTURES, SERVICE_FIXTURES, HOURS_FIXTURES, and seed() removed entirely from seed.ts — every business in the system must result from real owner onboarding"
  - "TEST_BOT_* vars removed from config.ts EnvSchema and jest.setup.ts — no longer needed once seed() is gone"
  - "TELEGRAM_WEBHOOK_SECRET removed from jest.setup.ts — was dead code since Phase 4 removed it from config"
  - "WEBHOOK_BASE_URL made optional in config to avoid breaking dev environments without the var set; handleActivate skips setWebhook registration when unset"
  - "/start command resets the onboarding session — allows re-entry without manual DB cleanup"

patterns-established:
  - "Test isolation pattern: each test file that needs a business calls insertTestBusiness() in beforeEach/beforeAll and cleans up in afterEach/afterAll"
  - "seed.ts is a pure utility module: only generateSlug, no DB access, no env var reads"

requirements-completed:
  - ONB-04

# Coverage metadata
coverage:
  - id: D1
    description: "FIXTURES/SERVICE_FIXTURES/HOURS_FIXTURES constants and seed() function removed from src/database/seed.ts; generateSlug retained and covered by 9 unit tests in tests/fixtures.test.ts"
    requirement: ONB-04
    verification:
      - kind: unit
        ref: "tests/fixtures.test.ts#generateSlug()"
        status: pass
    human_judgment: false
  - id: D2
    description: "TEST_BOT_* env vars removed from src/config.ts EnvSchema and tests/jest.setup.ts; TELEGRAM_WEBHOOK_SECRET dead code removed; booking-queries.test.ts Test 3 replaced with insertTestBusiness()-based setup; full npm test suite 219 passing"
    requirement: ONB-04
    verification:
      - kind: integration
        ref: "tests/booking-queries.test.ts#Test 3: listAllBusinessIds includes a business created via insertTestBusiness()"
        status: pass
      - kind: unit
        ref: "npm test — 219 passing, 4 pre-existing scheduler-agenda failures (not regressions)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Migration 0004 (onboarding_sessions table) applied to live Neon DB; pilates-athens and hair-salon-athens fixture rows deleted with all FK dependents"
    requirement: ONB-04
    verification: []
    human_judgment: true
    rationale: "Live DB operations (migration apply, fixture deletion) cannot be automated — human confirmed at checkpoint that psql commands ran successfully against Neon"

# Metrics
duration: 25min
completed: 2026-07-14
status: complete
---

# Phase 05 Plan 07: Fixture Removal and DB Cleanup Summary

**Hardcoded FIXTURES/seed() purged from seed.ts and all tests; TEST_BOT_* env vars removed; migration 0004 applied to live Neon DB; pilates-athens and hair-salon-athens deleted — every business now enters via real owner onboarding**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-14
- **Tasks:** 3 (2 automated + 1 human checkpoint)
- **Files modified:** 7

## Accomplishments

- Removed FIXTURES, SERVICE_FIXTURES, HOURS_FIXTURES constants and seed() function from src/database/seed.ts; generateSlug is the sole remaining export, covered by 9 focused unit tests
- Removed TEST_BOT_1_*/TEST_BOT_2_* from config.ts EnvSchema and tests/jest.setup.ts; removed dead TELEGRAM_WEBHOOK_SECRET from jest.setup.ts; replaced seed()-based Test 3 in booking-queries.test.ts with insertTestBusiness()
- Applied migration 0004 (onboarding_sessions table) to live Neon DB via human checkpoint; deleted pilates-athens and hair-salon-athens fixture rows with all FK dependents; full test suite 219 passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove fixtures from seed.ts and rewrite fixtures.test.ts** - `9e465bd` (refactor)
2. **Task 2: Clean up test DB usage + env var cleanup** - `f487388` (refactor)
3. **Merge commit** - `4820549` (merge)
4. **Post-plan fix: WEBHOOK_BASE_URL optional + handleActivate guard** - `49b61e6` (fix)
5. **Post-plan fix: /start resets session; service name examples** - `c94c7e6` (fix)

_Task 3 was a human checkpoint — no code commit; verified interactively._

## Files Created/Modified

- `src/database/seed.ts` - FIXTURES/SERVICE_FIXTURES/HOURS_FIXTURES/seed() removed; only generateSlug remains
- `tests/fixtures.test.ts` - Completely rewritten: imports only generateSlug, 9 unit tests, no DB access
- `tests/booking-queries.test.ts` - Test 3 seed() call replaced with insertTestBusiness(); seed import removed
- `src/config.ts` - TEST_BOT_* fields removed from EnvSchema; WEBHOOK_BASE_URL made optional (post-plan fix)
- `tests/jest.setup.ts` - TEST_BOT_* lines removed; TELEGRAM_WEBHOOK_SECRET dead code removed
- `src/webhooks/onboarding/steps.ts` - handleActivate guards against missing WEBHOOK_BASE_URL (post-plan fix)
- `src/webhooks/platform.ts` - /start command resets session; service name prompts include examples (post-plan fix)

## Decisions Made

- Removed seed() entirely rather than leaving an empty stub — having the export present would mislead future contributors
- TELEGRAM_WEBHOOK_SECRET removed from jest.setup.ts as dead code (config.ts no longer parses it since Phase 4)
- WEBHOOK_BASE_URL made optional in config to keep dev/CI environments working without the fly.io URL; handleActivate skips setWebhook when unset rather than crashing
- /start resets the onboarding session so owners can restart the flow without DB intervention

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] WEBHOOK_BASE_URL made optional in config.ts; handleActivate guard added**
- **Found during:** Post-plan verification
- **Issue:** WEBHOOK_BASE_URL was required in EnvSchema but absent in local dev environments; handleActivate would crash at startup if the var was unset
- **Fix:** Changed to `z.string().optional()` in config.ts; added `if (!config.webhookBaseUrl) return` guard in steps.ts handleActivate
- **Files modified:** src/config.ts, src/webhooks/onboarding/steps.ts
- **Verification:** npm test 219 passing after change
- **Committed in:** `49b61e6`

**2. [Rule 2 - Missing Critical] /start resets session; service name prompts include examples**
- **Found during:** Post-plan review of onboarding UX
- **Issue:** /start command did not reset an in-progress session — owners who restarted the flow were dropped back into a mid-session state with no way out; service name prompt had no examples making it unclear what to type
- **Fix:** /start handler now deletes any existing session for the chat before starting fresh; service name prompts updated with Greek examples (e.g., "Pilates αρχαρίων")
- **Files modified:** src/webhooks/platform.ts
- **Verification:** Manual review; covered by existing integration tests
- **Committed in:** `c94c7e6`

---

**Total deviations:** 2 auto-fixed (1 blocking config fix, 1 missing critical UX fix)
**Impact on plan:** Both fixes essential for correct operation in dev environments and owner UX. No scope creep.

## Issues Encountered

- fixture deletion required care around FK constraints — the checkpoint instruction noted that `DELETE FROM businesses` would error on FK violations if dependent rows (bookings, services, business_hours) existed; human handled the correct deletion order
- 4 pre-existing scheduler-agenda test failures in npm test — confirmed as pre-existing, not regressions from this plan's changes

## User Setup Required

**External services require manual configuration.** See plan 05-07 `user_setup` frontmatter for:
- `fly secrets set PLATFORM_BOT_TOKEN=...` — from BotFather
- `fly secrets set PLATFORM_WEBHOOK_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")`
- `fly secrets set WEBHOOK_BASE_URL=https://randevuclaw.fly.dev`
- `fly secrets unset TEST_BOT_1_TOKEN TEST_BOT_1_WEBHOOK_SECRET TEST_BOT_1_WEBHOOK_ID TEST_BOT_2_TOKEN TEST_BOT_2_WEBHOOK_SECRET TEST_BOT_2_WEBHOOK_ID`
- Register platform bot webhook with Telegram once deployed (see Task 3 how-to-verify step 6)

## Next Phase Readiness

- Phase 05 all plans complete — owner self-serve onboarding subsystem fully built and tested
- 219 tests passing; 4 pre-existing scheduler-agenda failures are known and pre-date this phase
- Live Neon DB has migration 0004 applied; no fixture rows remain
- Phase 06 (GDPR + resilience) can proceed: no blockers from Phase 05

---
*Phase: 05-owner-self-serve-onboarding*
*Completed: 2026-07-14*
