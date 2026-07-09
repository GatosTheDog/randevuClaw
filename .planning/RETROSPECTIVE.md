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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 3 | 19 | Initial build — established all core patterns |

### Cumulative Quality

| Milestone | Tests | TypeScript | Notes |
|-----------|-------|------------|-------|
| v1.0 | 208 | Clean | All 3 phases Nyquist-compliant |

### Top Lessons (Verified Across Milestones)

1. External human actions (Meta BV, OAuth) must start on day 1 — they gate delivery, not code.
2. Atomic claim guards prevent double-send/double-sync races — apply universally to any idempotent poller.
