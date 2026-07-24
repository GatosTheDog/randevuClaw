---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Billing & Membership System
current_phase: 14
current_phase_name: renewal-notification-extensions
status: Awaiting next milestone
stopped_at: Completed 14-01-PLAN.md
last_updated: "2026-07-24T09:43:25.832Z"
last_activity: 2026-07-23
last_activity_desc: Phase 14 Plan 01 complete (renewal nudge schema + query layer + tool handler)
progress:
  total_phases: 3
  completed_phases: 2
  total_plans: 11
  completed_plans: 10
  percent: 67
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-17 after v1.1 milestone close)

**Core value:** A client can book or cancel an appointment with a Greek business entirely through a chat conversation, in Greek, with zero friction — and the owner's calendar updates automatically.
**Current focus:** Phase 09 — expiry-notifications-client-balance

## Current Position

Phase: 14 — renewal-notification-extensions
Plan: 01 (complete)
Status: In progress
Last activity: 2026-07-23 — Phase 14 Plan 01 complete (renewal nudge schema + query layer + tool handler)

## Performance Metrics

**Velocity:**

- Total plans completed: 26
- Average duration: - min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 02 | 9 | - | - |
| 04 | 6 | - | - |
| 08 | 6 | - | - |
| 07 | 5 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 02 P2 | 15min | 2 tasks | 5 files |
| Phase 02 P3 | 15min | 2 tasks | 6 files |
| Phase 02 P4 | 50min | 3 tasks | 10 files |
| Phase 02 P5 | 20min | 2 tasks | 7 files |
| Phase 03 P1 | 7min | 2 tasks | 10 files |
| Phase 03 P02 | 51min | 3 tasks | 18 files |
| Phase 03 P04 | 3min | 2 tasks | 3 files |
| Phase 03 P05 | 5min | 2 tasks | 3 files |
| Phase 04 P01 | 8 | 2 tasks | 7 files |
| Phase 04 P02 | 73 | 2 tasks | 5 files |
| Phase 04 P03 | 8 | 2 tasks | 13 files |
| Phase 04 P04 | 8 | 2 tasks | 3 files |
| Phase 04 P05 | 14 | 3 tasks | 2 files |
| Phase 04 P06 | 4 | 3 tasks | 3 files |
| Phase 05 P01 | 6min | 3 tasks | 6 files |
| Phase 05 P02 | 8min | 2 tasks | 2 files |
| Phase 05 P03 | 3min | 2 tasks | 2 files |
| Phase 05 P04 | 5 | 2 tasks | 2 files |
| Phase 05 P06 | 15 | 2 tasks | 2 files |
| Phase 05 P07 | 25min | 3 tasks | 7 files |
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 07 P01 | 4 | 2 tasks | 9 files |
| Phase 07 P02 | 5 | 2 tasks | 2 files |
| Phase 07 P03 | 12 | 3 tasks | 8 files |
| Phase 07 P04 | 3 | 2 tasks | 7 files |
| Phase 08 P01 | 3 | 3 tasks | 3 files |
| Phase 08 P02 | 10 | 2 tasks | 16 files |
| Phase 08 P03 | 7 | 3 tasks | 2 files |
| Phase 08 P04 | 5 | 3 tasks | 5 files |
| Phase 08 P05 | 8 | 2 tasks | 3 files |
| Phase 09 P01 | 8 | 2 tasks | 5 files |
| Phase 09 P02 | 18 | 2 tasks | 4 files |
| Phase 09 P03 | 51 | 3 tasks | 3 files |
| Phase 07 P06 | 4 | 2 tasks | 5 files |
| Phase 07 P07 | 2 | 1 tasks | 2 files |
| Phase 18-client-menu P01 | 5 | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Research]: Sequential (not parallel) Gemini function-calling to prevent double-booking races.
- [Research]: DB UNIQUE constraint on (business_id, calendar_date, calendar_time) as the last line of defense against double-booking.
- [Research]: Meta Business Verification must start on day 1 (Phase 1) — 1-6 week approval lead time.
- [Research]: WhatsApp reminder templates must be pre-approved by Meta before Phase 3 reminder logic goes live (24h free-form window constraint).
- [Roadmap]: Phases 1-3 test against fixture/seed businesses; Phase 4 delivers real self-serve owner onboarding via chat and replaces the fixtures.
- [Roadmap]: COMP-01 (consent notice) placed in Phase 1 as part of first-contact webhook handling; COMP-02 (deletion) placed in Phase 5 alongside production-readiness work.
- [Phase 02]: Telegram secret-token check uses direct string equality (Telegram's documented mechanism), not HMAC/timingSafeEqual
- [Phase 02]: sendTelegramMessage's chatId is populated from the sender's Telegram user id (from.id) since this phase only handles private one-on-one bot chats
- [Phase 02]: resolveGreekTemporalExpressions only resolves time-of-day words (πρωί/απόγευμα/μεσημέρι/βράδυ) as AM/PM context modifiers, never as a standalone date/time resolver
- [Phase 02]: checkAvailability trusts findActiveBookingSlotsForDate's status scoping entirely, applying no independent booking-status re-filtering
- [Phase 02]: Adapted AI-SPEC's illustrative Gemini SDK pseudocode field names to the real installed @google/genai@2.10.0 SDK's actual snake_case/nested generation_config shape
- [Phase 02]: resolveConflictOrTaken shared helper disambiguates insertBooking conflicts into idempotent-replay vs genuine slot_taken for both book and reschedule tools
- [Phase 02]: Owner callback_query taps validated via unscoped booking lookup + re-derived business-ownership check before any mutation (T-02-17)
- [Phase 02]: 2-hour pending-booking expiry sweep implemented as a plain in-process setInterval poller, guarded against JEST_WORKER_ID, per the no-cron/no-Redis locked stack
- [Phase 03]: D-06/D-11/D-16 column shapes implemented exactly as specified in 03-CONTEXT.md and 03-01-PLAN.md interfaces contract — Matches downstream Plans 03-02/03-04/03-05 contracts verbatim
- [Phase 03]: Applied migration 0002 to both the live Neon DB and the local randevuclaw_test DB to keep test-infra schema in parity — tests/booking-queries.test.ts runs against a real local Postgres DB separate from the live Neon DB
- [Phase 03]: Config's 3 new Google OAuth env vars pulled forward into Task 1's own commit (Rule 3 blocking fix) since src/google/oauth.ts references them and Task 1's own tsc/test verification requires them
- [Phase 03]: googleapis is the only new direct dependency for Calendar sync; google-auth-library stays transitive via InstanceType<typeof google.auth.OAuth2> typing (T-03-SC)
- [Phase 03]: MAX_CALENDAR_SYNC_RETRIES=10 at the poller's 5-minute interval (~50 min total retry window) before permanent 'failed' abandonment (D-16)
- [Phase 03]: 10-minute default agenda-poller interval (D-09 discretion), matching the frequent-enough/cheap-enough-to-run-continuously rationale
- [Phase 03]: Read-before-claim ordering (listBookingsForDate -> claimAgendaSlot -> sendTelegramMessage) established as the pattern for any future Phase 3 idempotent-send poller
- [Phase ?]: [Phase 03]: 15-minute default poller interval (D-10, locked) for the reminder sweep -- not discretionary unlike the agenda poller's D-09 discretion
- [Phase ?]: [Phase 03]: jest.setSystemTime() chosen over jest.spyOn(global, Date) for reminder sweep tests -- spyOn caused recursive stack overflow
- [Roadmap v1.1]: 3 phases derived from 13 requirements — Phase 4 (infrastructure), Phase 5 (onboarding), Phase 6 (GDPR + resilience)
- [Roadmap v1.1]: BOT-04 (Telegraf migration) placed first in Phase 4 as the foundational prerequisite for all per-bot routing
- [Roadmap v1.1]: BOT-01 placed in Phase 5 (not Phase 4) because setWebhook automation is user-facing onboarding behavior, not infrastructure
- [Roadmap v1.1]: RESIL-01 grouped with GDPR in Phase 6 — both are PoC-completion concerns that do not block the core onboarding path
- [Phase ?]: [Phase 04-01]: telegramBotToken and telegramWebhookSecret removed from config (D-08)
- [Phase ?]: [Phase 04-01]: appDb falls back to databaseUrl when DATABASE_APP_URL unset — keeps dev/test workflows working without randevuclaw_app role (D-11)
- [Phase ?]: [Phase 04-01]: telegram_updates excluded from RLS — nullable business_id makes FOR ALL INSERT policy incompatible with dedup-INSERT flow (D-12)
- [Phase ?]: .planning/phases/04-per-bot-foundation/04-03-SUMMARY.md
- [Phase ?]: [Phase 04-04]: verifyTelegramSecretToken removed; crypto.timingSafeEqual replaces string-equality (D-06/T-04-10)
- [Phase ?]: [Phase 04-04]: bot.handleUpdate() called as Telegraf webhook adapter before explicit dispatch (D-03/BOT-04)
- [Phase ?]: Rule 1 auto-fix
- [Phase ?]: [Phase 04-05]: Test 2 replaced — slug-based not-found path gone in per-bot handler; replaced with unknown webhookId → 404
- [Phase ?]: [Phase 04-05]: botTokenStore.run requires explicit call-through mock — Jest auto-mock of AsyncLocalStorage.run returns undefined; inner handler body skipped
- [Phase ?]: [Phase 04-05]: Schema columns applied to live Neon DB via Node.js script — drizzle-kit push requires TTY for UNIQUE constraint prompt
- [Phase ?]: [Phase 04-05]: RLS migration applied with dynamic DB name substitution — live Neon DB is neondb not randevuclaw as hardcoded in GRANT CONNECT
- [Phase ?]: botTokenStore async context
- [Phase ?]: expiry-poller test fixes
- [Phase 05-02]: callTelegramApiDirect is private (unexported) — getMeBotInfo/registerBotWebhook/unregisterBotWebhook are the public API surface
- [Phase 05-02]: onboarding/queries.ts imports Business from src/database/queries — reuses existing interface rather than duplicating
- [Phase 05-02]: activateBusiness updates only webhookId+webhookSecret — separated from createBusinessForOnboarding to support re-registration without duplicate rows
- [Phase 05-03]: handleActivate always calls unregisterBotWebhook before registerBotWebhook (T-05-09 / STATE.md blocker)
- [Phase 05-03]: Closed days always insert a business_hours row with isClosed:true — never skip (Pitfall 3 in RESEARCH.md)
- [Phase 05-03]: handleSvcMoreStep 'yes' path sets currentService={} to clear stale partial data before next service (Pitfall 6)
- [Phase 05-03]: dispatchOnboardingStep wraps all dispatch in try/catch with Greek error fallback — error isolation prevents HTTP 500 propagation
- [Phase 05-04]: Respond-before-process: res.status(200).send('OK') fires before await botTokenStore.run() so Telegram never retries on slow getMeBotInfo calls
- [Phase 05-04]: platform route registered BEFORE :webhookId router in server.ts — Express shadow prevention (RESEARCH.md Pitfall 1)
- [Phase 05-04]: botToken update on re-registration requires separate db.update — activateBusiness only updates webhookId+webhookSecret per its contract
- [Roadmap v1.2]: 3 phases derived from 17 requirements — Phase 7 (schema + owner billing tools), Phase 8 (booking enforcement + session deduction), Phase 9 (expiry notifications + client balance)
- [Roadmap v1.2]: BILL/PAY grouped in Phase 7 — owner-facing only, zero changes to booking flow; SESS/ENFC in Phase 8 — requires Phase 7 schema; NOTF in Phase 9 — requires Phase 8 membership state machine
- [Roadmap v1.2]: Session deduction must be atomic with booking insert (SELECT FOR UPDATE inside db.transaction()) to prevent concurrent deduction race conditions
- [Roadmap v1.2]: All expiry timestamps stored as TIMESTAMP WITH TIME ZONE; all rolling window calculations use Europe/Athens timezone to prevent DST bugs
- [Roadmap v1.2]: Immutable ledger pattern (membership_ledger append-only) chosen over mutable counter update — idempotency_key UNIQUE constraint prevents duplicate deductions
- [Roadmap v1.2]: date-fns 4.4.0 is the only new dependency for rolling window calculations; no other new packages
- [Roadmap v1.2]: NOTF-03 (dedup) implemented via membership_expiry_notifications table with UNIQUE constraint on (membership_id, notification_type, date) — same proven pattern as v1.0 reminder dedup
- [Phase ?]: it.todo stubs with no imports from unbuilt modules — keeps stubs compilable by ts-jest before any implementation exists
- [Phase ?]: COVERAGE.md editMessageReplyMarkup OPT-OUT — replacing keyboard message on each step avoids stale keyboard state edge cases
- [Phase ?]: [Phase 07-02]: billingPackages partial index WHERE is_active = true — allows reusing a package name after deactivation
- [Phase ?]: [Phase 07-02]: membershipLedger idempotency_key UNIQUE inline + explicit uniqueIndex — DB constraint plus query performance
- [Phase ?]: [Phase 07-02]: memberships partial index WHERE is_active = true enforces D-10 one-active-membership at DB level
- [Phase ?]: [Phase 07-03]: Exported getConn from database/queries.ts — needed by billing/queries.ts for RLS-scoped reads (T-07-03)
- [Phase ?]: [Phase 07-03]: Each billing integration test uses unique clientPhone per test to avoid same-day idempotencyKey collisions
- [Phase ?]: [Phase 07-03]: billing integration tests follow jest.resetModules() + require() pattern from booking-queries.test.ts
- [Phase ?]: [Phase 07-04]: handleCreatePackage inserts isActive:false pending before owner confirmation (D-03)
- [Phase ?]: [Phase 07-04]: callback_data contains only IDs (billing:package:{clientRelId}:{packageId}) — price in button text only (T-07-05)
- [Phase ?]: it.todo stubs with no imports from unbuilt modules — Wave 0 scaffolding keeps ts-jest green before Phase 8 implementations exist
- [Phase ?]: [Phase 08-01]: billing-enforcement-policy.test.ts mocks setBusinessEnforcementPolicy as jest.fn() without top-level import of handleSetEnforcementPolicy — ships in Plan 05
- [Phase ?]: [Phase 08-02]: CHECK constraint (enforcement_policy IN ('allow','block','flag')) added at DB layer — defense in depth alongside Zod app-layer validation planned for Plan 05
- [Phase ?]: [Phase 08-02]: enforcementPolicy: string (not nullable) in Business interface — NOT NULL DEFAULT 'allow' in migration guarantees no null values after column is added
- [Phase ?]: [Phase 08-03]: getConn() used exclusively in all Phase 8 write functions — db.transaction() would break atomicity with withBusinessContext
- [Phase ?]: [Phase 08-03]: restoreCredit checks sessionsRemaining === null BEFORE computing nowAthens — SESS-04 exits early for unlimited memberships regardless of expiry state
- [Phase ?]: [Phase 08-03]: Test bookings use 'cancelled' status to bypass unique_active_slot_per_business partial index — real booking rows inserted for FK integrity
- [Phase ?]: [Phase 08-04]: getClientName added to billing/queries.ts — no equivalent existed in database/queries.ts; clientBusinessRelationships already imported by billing/queries
- [Phase ?]: [Phase 08-04]: Flag alert sendTelegramMessage is NOT in try/catch in bookAppointmentTool — critical alert per D-11; failure must surface immediately
- [Phase ?]: [Phase 08-04]: jest.mock factory used for billing/queries in tests — guarantees invocationCallOrder is available for ENFC-03 ordering assertion
- [Phase ?]: [Phase 08-05]: handleSetEnforcementPolicy returns plain string — no confirmation keyboard needed, policy update is idempotent
- [Phase ?]: [Phase 08-05]: set_enforcement_policy case wrapped in withBusinessContext for RLS tenant isolation (T-08-12)
- [Phase ?]: D-04: UNIQUE INDEX on (membership_id, notification_type, expiry_date) — unconditional dedup, no partial WHERE
- [Phase ?]: D-05: notification_type stores '7_day_client' or '7_day_owner' for per-recipient dedup granularity
- [Phase ?]: D-09: formatExpiryDateGreek uses Intl.DateTimeFormat en-GB / Europe/Athens for DD/MM/YYYY output
- [Phase ?]: findMembershipsExpiringIn7Days uses db (not getConn()) — sweep outside withBusinessContext, businessId WHERE provides isolation
- [Phase ?]: checkMembershipBalanceTool: no client_phone param, always reads context.clientPhone — prevents cross-client balance inspection (T-09-05)
- [Phase ?]: Test date anchor noon UTC (T12:00:00Z) avoids Athens midnight crossing in summer DST (UTC+3) for formatExpiryDateGreek assertions
- [Phase ?]: isRunning guard omitted from membership expiry sweep — 6-hour interval + DB UNIQUE constraint provide sufficient dedup without an application-level mutex
- [Phase ?]: notificationCount increments separately for client and owner sends — allows accurate per-recipient accounting in the sweep return value
- [Phase ?]: [07-06]: getAllClientsForBusiness uses getConn() inside withBusinessContext — RLS-scoped, no booking join
- [Phase ?]: [07-06]: deactivate_package switched to package_name with case-insensitive partial match — eliminates hallucinated-ID problem
- [Phase ?]: [Phase 07-07]: TelegramCallbackQuery.message optional-chain guard — keyboard clear is best-effort; non-owner access already mitigated upstream by findBusinessByOwnerTelegramId
- [Phase ?]: Phase 18-01: Renamed local business var to bookingBusiness in handleCallbackQuery to avoid parameter shadow

### Pending Todos

None yet.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260716-heo | keyboard buttons UX | 2026-07-16 | 0425059 | [260716-heo-keyboard-buttons-ux](./quick/260716-heo-keyboard-buttons-ux/) |
| 260716-hxo | streamline hours onboarding: single time range + split hours | 2026-07-16 | 587f338 | [260716-hxo-streamline-hours-onboarding-single-time-](./quick/260716-hxo-streamline-hours-onboarding-single-time-/) |
| 260716-oaa | AI-powered owner agent: Gemini NLU replaces keyword matching | 2026-07-16 | 14fe0d1 | [260716-oaa-ai-owner-agent](./quick/260716-oaa-ai-owner-agent/) |

### Blockers/Concerns

- [Phase 1]: Meta Business Verification takes 1-6 weeks — submit immediately, don't wait for feature completeness.
- [Phase 2]: Greek date/time parsing needs a validated test corpus (20+ colloquial phrases) before booking is trusted.
- [Phase 2]: Gemini free-tier rate limit is 15 req/min — needs backoff/circuit breaker and load testing before relying on it.
- [Phase 3]: WhatsApp template approval SLA is opaque (Meta review); plan for possible re-submissions before reminders can ship.
- [Phase 4]: Bot token must never appear in logs or URL paths — use UUID-keyed lookup; redact from all structured log output.
- [Phase 4]: Telegraf migration must keep all 208 tests green — run full suite before marking Phase 4 complete.
- [Phase 5]: deleteWebhook must be called before setWebhook on any re-registration to prevent "another webhook is active" conflicts.
- [Phase 6]: GDPR cascade must cover ALL tables holding user data — document full cascade chain before implementing.
- [Phase 9]: findMembershipByBooking returns null for pre-Phase-8 bookings — credit restore correctly no-ops (Pitfall 4 from 08-03).
- [Phase 9]: Expiry sweep isRunning guard required (same pattern as v1.0 reminder poller) to prevent overlapping sweep executions.

## Deferred Items

Items acknowledged and deferred at v1.0 milestone close on 2026-07-09:

| Category | Item | Status |
|----------|------|--------|
| verification | Phase 01: 01-VERIFICATION.md | human_needed (Meta BV external action, code complete) |
| verification | Phase 03: 03-VERIFICATION.md | human_needed (OAuth creds not provisioned, code complete) |
| uat | Phase 01: 01-UAT.md | 2 pending scenarios (live WhatsApp delivery) |
| todo | pivot-to-per-business-whatsapp-numbers-post-poc.md | planning |
| todo | meta-business-verification-not-submitted.md | phase-1 |
| v2 | OWNR2-01: Web dashboard alternative | Deferred to v2 |
| v2 | OWNR2-02: Waitlist for fully-booked slots | Deferred to v2 |
| v2 | BOOK2-01: Cancellation cutoff window | Deferred to v2 |
| v1.3 | COMP-02/03/04: GDPR data deletion | Deferred from v1.1 Phase 6 |
| v1.3 | RESIL-01: Gemini p-queue rate-limit resilience | Deferred from v1.1 Phase 6 |

Items acknowledged and deferred at v1.2 milestone close on 2026-07-22:

| Category | Item | Status |
|----------|------|--------|
| todo | pivot-to-per-business-whatsapp-numbers-post-poc.md | planning (carry-forward from v1.0, pre-v1.2 scope) |
| todo | meta-business-verification-not-submitted.md | phase-1 (carry-forward from v1.0, blocked on external Meta process) |
| operational | Phase 08: live Neon DB migration 0007 enforcement_policy column | human confirmation needed (low risk — Phase 9 ran successfully after) |
| operational | Phase 09: live Neon DB migration 0008 membership_expiry_notifications table | human confirmation needed (Plan 03 Task 2 confirmed during execution) |
| nyquist | Phases 7/8/9: VALIDATION.md files in draft status | NOT-VALIDATED (#2117 rule) — run /gsd-validate-phase 7/8/9 if coverage needed |
| known_deferred: 2 (see above) | | |

## Session Continuity

Last session: 2026-07-24T09:43:25.823Z
Stopped at: Completed 12-03-PLAN.md (cancellation cutoff integration tests)
Resume file: None

**Phase 12 Plan 01 completed:** a940588, 6c5830e, 7d64f85

- Business interface extended with cancellationCutoffEnabled/Hours
- setCancellationCutoff DB helper added to queries.ts
- handleSetCancellationCutoff handler added to billing/tools.ts
- set_cancellation_cutoff registered in OWNER_TOOLS + executeOwnerTool

**Phase 12 Plan 02 completed:** 07142c9

- hoursUntilSessionInAthens DST-safe helper added to function-executor.ts
- ToolContext.business extended with cancellationCutoffEnabled/Hours
- cancelAppointmentTool cutoff check + two-message confirmation flow (CANC-03/04/05)

**Phase 12 Plan 03 completed:** 2506744

- tests/cancellation-cutoff.test.ts: 6 integration tests covering CANC-01 through CANC-05
- tests/helpers/session-fixtures.ts: session catalog/instance test helpers
- src/session/manager.ts: session query layer (worktree Rule 3 fix)
- All 6 tests passing against Neon DB

## Operator Next Steps

- Phase 12 complete (all 3 plans done) — start next phase or new milestone with /gsd-new-milestone
