# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-07-09
**Phases:** 3 | **Plans:** 19 | **Tasks:** 32

### What Was Built

- Node/TypeScript webhook server on fly.io with Neon/Drizzle Postgres, Express, Pino logging, zod env validation — full project scaffold from zero
- WhatsApp Cloud API client + Telegram Bot API client + business-slug resolver enabling a single shared number to route clients to the right business
- Gemini 2.5 Flash-Lite AI booking agent with sequential function-calling: book, cancel, reschedule, check availability, answer questions — all in Greek, double-booking-proof, cross-tenant-safe
- Owner Telegram alert flow: new booking notification → accept/reject callback_query → CAS-guarded state transition; expiry poller cancels stale pending bookings after 2 hours
- Google Calendar OAuth 2.0 flow + sync service: confirmed bookings create events, cancellations delete them, reschedules update — with 10-attempt retry poller
- Daily 8am Athens-time owner agenda + DST-safe 24h/1h client reminders, all via atomic once-per-day/per-booking claim guards

### What Worked

- **Telegram-first pivot (D-01):** Unblocked all Phase 2-3 work when Meta Business Verification stalled. WhatsApp code was already wired; switching test channel was one decision, not a rewrite.
- **In-process pollers:** Keeping all background sweeps as `setInterval` in the same Node process (no cron, no Redis, no Supercronic) kept the stack at near-$0 and eliminated infrastructure complexity for a 1-business PoC.
- **Sequential Gemini calls + DB UNIQUE constraint:** Two-layer double-booking prevention — app-level serialization plus database-level constraint — caught edge cases that one layer alone would miss.
- **Atomic UPDATE...WHERE...RETURNING pattern:** Once established for the CAS guard (owner approval), the same pattern became the template for agenda and reminder claim guards in Phase 3 — no double-send races.
- **Milestone audit before close:** Running `/gsd-audit-milestone` before `/gsd-complete-milestone` surfaced the 6 tech debt items explicitly, enabling a clean `override_closeout` with documented gaps rather than an opaque close.

### What Was Inefficient

- **Meta Business Verification not submitted on day 1:** Per the original ROADMAP note, this should have been kicked off with Phase 1. Delay means the WhatsApp delivery gap persists into v1.1.
- **OAuth credential provisioning deferred:** The calendar sync code is complete but the end-to-end flow can't be demonstrated live without running `npm run setup-calendar`. Should be done immediately rather than deferring to "post-PoC."
- **Plan-level SUMMARY.md one-liners:** Some summaries captured task-level detail ("Task 1 — WhatsApp Cloud API client") rather than plan-level value. Makes MILESTONES.md accomplishments list more granular than useful.

### Patterns Established

- Read-before-claim ordering for all pollers: `list*` → `claim*Slot` (atomic) → `send*Message` — prevents double-send even under concurrent boot
- `resolveConflictOrTaken` shared helper for idempotent-replay vs genuine `slot_taken` disambiguation — reuse if booking conflict semantics expand
- `jest.setSystemTime()` (not `jest.spyOn(Date)`) for time-controlled tests — spyOn caused recursive stack overflow
- All config env vars pulled forward into the plan that first references them (not deferred to a later plan) — avoids `tsc` failure mid-wave

### Key Lessons

1. Submit external approvals (Meta BV, OAuth credentials) on day 1 of the phase that needs them — approval SLAs are measured in weeks, not hours.
2. A Telegram channel as a drop-in test surface for WhatsApp logic is a valid PoC strategy — same code, different SDK call at the boundary.
3. In-process pollers at 5-15 minute intervals are sufficient for a 1-business PoC; introduce Supercronic or a job queue only when the business count or reliability requirements grow.
4. Atomic `UPDATE...WHERE status='pending'...RETURNING` is the right pattern for any idempotent claim operation — establish it once and clone it across all similar sweep/notify flows.

### Cost Observations

- Model mix: ~100% Sonnet 4.6 (budget profile, all phases)
- Notable: budget profile handled full Greek NLP + Gemini integration planning without needing Opus

---

## Milestone: v1.1 — Per-Bot Infrastructure & Owner Onboarding

**Shipped:** 2026-07-17
**Phases:** 2 | **Plans:** 13 | **Tasks:** 25
**Code:** +3,571 / -654 lines | 5,162 total src/ LOC | 7 days

### What Was Built

- Telegraf migration: each business gets its own bot token; UUID-keyed webhook routing at `/webhooks/telegram/:webhookId` with HMAC constant-time verification
- AsyncLocalStorage RLS context threading: `withBusinessContext` injects per-transaction tenant identity into every Drizzle call, enforced at the PostgreSQL layer
- 25-step DB-backed owner onboarding state machine: bot token registration, `getMe`/`setWebhook` automation, business hours (including split-hours), services + prices, all via guided Telegram chat
- Platform bot 3-path routing (new owner / resume / re-registration) with unregister-then-register sequencing
- Owner edit flows post-onboarding (hours, services, prices) + removal of all hardcoded seed fixtures
- AI-powered owner agent (Gemini NLU), inline keyboard buttons, streamlined hours entry (3 quick-task improvements post Phase 5)

### What Worked

- **AsyncLocalStorage for RLS context:** Threading tenant identity through async Drizzle calls without modifying every function signature was the right call. Zero cross-contamination in tests, clean isolation in prod.
- **UUID webhook IDs:** Keeping bot tokens out of URL paths and logs eliminated a whole class of accidental token exposure. The UUID lookup table adds one DB read but is the correct security tradeoff.
- **DB-backed resumable onboarding:** Storing step state in `onboarding_sessions` (not memory) meant an owner's dropout mid-flow is completely invisible to them on resume — no complex session management.
- **Unregister-before-register sequencing (handleActivate):** Pre-emptive `deleteWebhook` before `setWebhook` prevented the "another webhook active" conflict on re-registration; established as a hard invariant.
- **Quick-task UX improvements:** The AI owner agent + keyboard buttons were 3 quick tasks that dramatically improved the onboarding experience without entering the full plan/execute cycle. Good use of the quick-task track.

### What Was Inefficient

- **Phase 4/5 planning docs archived before milestone close:** Commit `8f2f3ec` deleted the SUMMARY.md files, requiring a git-restore step during milestone close. Archive should happen during `milestone.complete`, not manually before.
- **Phase 6 requirement drift:** COMP-02/03/04/RESIL-01 were in the ROADMAP as Phase 6 but had already been moved to v1.3 in REQUIREMENTS.md — the ROADMAP wasn't updated. Led to a planning conflict at close time.
- **Plan count in milestone.complete:** The gsd-tools CLI reported "0 plans" because phase directories were already empty. Archiving phases before running `milestone.complete` breaks the plan-count aggregation.

### Patterns Established

- `botTokenStore.run()` wrapping pattern: every handler that dispatches per-bot logic must enter the AsyncLocalStorage context explicitly — even in tests (Jest auto-mock of `AsyncLocalStorage.run` returns undefined and silently skips the inner body)
- Schema-push via Node.js script (not drizzle-kit push) for `UNIQUE` constraint additions in CI-like environments — drizzle-kit push requires a TTY prompt that isn't available in automated flows
- RLS GRANT CONNECT migrations need dynamic DB name substitution — never hardcode `neondb` when the live Neon DB name may differ from local test DBs
- `res.status(200).send('OK')` before `await botTokenStore.run()` in platform webhook handler — respond before processing to prevent Telegram retries on slow `getMeBotInfo` calls

### Key Lessons

1. Keep ROADMAP.md and REQUIREMENTS.md in sync whenever requirements are deferred — don't let the two documents diverge silently.
2. Run `milestone.complete` CLI before manually archiving phase directories — the CLI needs the SUMMARY.md files in place to generate accurate accomplishment lists and plan counts.
3. `botTokenStore.run` in tests requires an explicit call-through mock, not Jest's auto-mock — the async context doesn't propagate through mocked `AsyncLocalStorage.run`.
4. Schema push for UNIQUE constraints: always check if drizzle-kit requires a TTY before using it in automated scripts; have a Node.js fallback ready.

### Cost Observations

- Model mix: ~100% Sonnet 4.6
- Notable: per-bot RLS + Telegraf migration planned and executed entirely on Sonnet budget profile

---

## Milestone: v1.2 — Billing & Membership System

**Shipped:** 2026-07-22
**Phases:** 3 (07, 08, 09) | **Plans:** 16 | **Tests:** 320 (112 new)

### What Was Built

- Owner creates billing packages, records payments, and manages memberships entirely via Telegram chat
- Session ledger with SELECT FOR UPDATE atomic deduction and idempotency-key UNIQUE replay protection
- Per-business enforcement policies (block/flag) enforced before every booking; flag alert delivered before owner keyboard
- 6-hour in-process expiry sweep with per-recipient UNIQUE dedup; clients query own balance via chat

### What Worked

- Wave 0 scaffolding (it.todo stubs) kept ts-jest green across all phases before implementations existed — pattern proven across 3 phases
- Extracting enforcement.ts from bookAppointmentTool made ENFC-02/03 unit-testable in isolation without booking context wiring
- DST-safe date arithmetic (isoDateInAthens + addCalendarDays) validated by dedicated test file — no off-by-one surprises at October boundary
- Gap closure plans (07-06, 07-07) after UAT surfaced real UX issues (hallucinated IDs, stale keyboards) — UAT → gap → re-verify cycle proved valuable

### What Was Inefficient

- Phase 08 re-verification needed: previous verification written before Plan 06 (Nyquist compliance) completed — verification timing should trail plan execution, not run concurrently
- No phase-level SUMMARY.md files generated (only plan-level) — 3-source audit cross-reference degraded to 2 sources; investigate why gsd-verifier didn't generate them
- Live Neon DB migration confirmations (0007, 0008) required human action each phase — consider a migration-apply task as explicit Wave 0 step in plans that add tables

### Patterns Established

- `getConn()` exclusively for billing writes (not `db.transaction()`) — db.transaction opens a separate connection that breaks withBusinessContext atomicity
- `sendTelegramMessage` flag alert NOT in try/catch — D-11 critical-path pattern; failure must surface
- clientPhone always from context (never Gemini args) for balance queries — cross-client inspection guard
- UNIQUE INDEX on (membership_id, notification_type, expiry_date) — proven dedup pattern for any notification sweep

### Key Lessons

1. SELECT FOR UPDATE serializes concurrent DB writes; onConflictDoNothing handles the idempotency race — compose both for bulletproof atomic operations.
2. Extract business logic into testable units (enforcement.ts) before wiring into booking context — enables isolated unit tests without complex mocking.
3. UAT after code review (not before) catches real UX issues that code review misses — always complete code review first, then UAT, then re-verify.

### Cost Observations

- Sessions: 3 phases, 145 commits since v1.1
- Model: Claude Sonnet 4.6 throughout
- Notable: billing system shipped with zero production incidents in local test DB; live Neon migration the only manual action required

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 3 | 19 | Initial build — established all core patterns |
| v1.1 | 2 | 13 | Per-bot routing + DB-backed onboarding state machine |
| v1.2 | 3 | 16 | Billing layer + enforcement + proactive notifications; Wave 0 scaffolding mature |

### Cumulative Quality

| Milestone | Tests | TypeScript | Notes |
|-----------|-------|------------|-------|
| v1.0 | 208 | Clean | All 3 phases Nyquist-compliant |
| v1.1 | 28 test files | Clean | Full mock isolation; no real Telegram API or DB in CI |
| v1.2 | 320 (42 suites) | Clean | SELECT FOR UPDATE + UNIQUE dedup pattern established |

### Top Lessons (Verified Across Milestones)

1. External human actions (Meta BV, OAuth) must start on day 1 — they gate delivery, not code.
2. Atomic claim guards prevent double-send/double-sync races — apply universally to any idempotent poller.
3. Keep ROADMAP.md and REQUIREMENTS.md in sync when deferring requirements — silent divergence creates planning confusion at milestone close.
4. Run `milestone.complete` CLI before archiving phase docs manually — the CLI needs SUMMARY.md files in place for accurate stats.
5. Wave 0 it.todo scaffolding pays off across 3+ phases — invest in stubs early, implement late, keep ts-jest green throughout.
6. UAT → gap plan → re-verify cycle catches real UX regressions that static code review cannot surface.
