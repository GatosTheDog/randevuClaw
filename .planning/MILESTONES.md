# Milestones

## v1.1 Per-Bot Infrastructure & Owner Onboarding (Shipped: 2026-07-17)

**Phases completed:** 2 phases, 13 plans, 25 tasks  
**Code:** +3,571 / -654 lines TypeScript/SQL across 47 files (5,162 total src/ LOC)  
**Timeline:** 2026-07-10 → 2026-07-17 (7 days)

**Key accomplishments:**

- Telegraf migration + per-bot UUID-keyed webhook routing: each business runs its own Telegram bot with a dedicated `/webhooks/telegram/:webhookId` entry point (BOT-04/BOT-05)
- PostgreSQL RLS enforcement via AsyncLocalStorage context threading: per-request botTokenStore dispatches tenant context into every Drizzle transaction, enforced at the DB layer not just application layer (BOT-03)
- HMAC constant-time webhook verification per bot with `crypto.timingSafeEqual` replacing string equality (BOT-02)
- 25-step DB-backed owner onboarding state machine via Telegram chat: TIME_REGEX validation, incremental business_hours writes, service collection loop (ONB-01/ONB-02)
- Platform bot 3-path routing (new/resume/re-registration) with HMAC-verified webhook handler + automatic `setWebhook`/`deleteWebhook` sequencing (BOT-01)
- Owner edit flows post-onboarding (ONB-03) + fixture seed removal replacing all hardcoded businesses with real onboarded ones (ONB-04)
- AI-powered owner agent (Gemini NLU replacing keyword matching), inline keyboard buttons UX, and streamlined hours entry (3 quick-task improvements)
- 25-test suite (8 integration + 17 unit) with full mock isolation — no real Telegram API or DB in CI

---

## v1.0 MVP (Shipped: 2026-07-09)

**Phases completed:** 3 phases, 19 plans, 32 tasks

**Key accomplishments:**

- Drizzle/Postgres schema live on Neon (businesses, messages, client_business_relationships) with zod-validated config, Pino logging, and two idempotently-seeded fixture businesses
- Task 1 — WhatsApp Cloud API client
- Task 1 — Idempotent message dedup
- Drizzle schema for services/business_hours/bookings/conversation_turns/telegram_updates with a partial unique index preventing double-booking while releasing slots immediately on cancellation, a 16-function typed query layer, and idempotently-seeded Greek fixture data (3 distinct-duration services + full weekly hours per business)
- Telegram Bot API client (4 primitives) + inbound webhook at /webhooks/telegram reusing Phase 1's business resolver and consent checker unchanged, proving the full Telegram round trip before any AI/booking logic exists
- checkAvailability (1-hour slots, per-booking duration correctness, closed-day/stale-sweep handling) and resolveGreekTemporalExpressions (20-phrase validated Greek colloquial date/time corpus), both pure Athens-timezone-correct modules with zero new date-library dependency
- Direct @google/genai sequential function-calling loop (aiBookingAgent) + guardrailed tool executor (executeTool) + channel-agnostic conversation router, wired into the Telegram webhook in place of Plan 02-02's static greeting — the load-bearing vertical slice that makes double-booking-proof, idempotent, cross-tenant-safe Greek booking conversations real
- Owner Telegram callback_query taps now drive real approve/reject/reschedule-cascade state transitions with identity verification and idempotent re-tap handling, plus a plain in-process poller that proactively expires and notifies clients on stale pending bookings — closing Phase 2's booking lifecycle end-to-end.
- Closed 4 CRITICAL gaps in the Gemini booking agent loop and tool executor: bounded MAX_TOOL_ROUNDS loop (CR-01), null-not-empty-string interactionId on rate-limit fallback (CR-06), per-call idempotency keys preventing double-booking merges (CR-02), and notification-failure isolation so cancel/reschedule never falsely report an error after the DB mutation already succeeded (CR-03a/CR-03b).
- Fixed `resolveHourToTime` in greek-preprocessor.ts to short-circuit on already-unambiguous 24-hour input (13-23), closing the code-review finding that let ordinary Greek phrasing like "στις 20" produce invalid clock times like "32:00" flowing into the Gemini-trusted system hint.
- Nested per-booking try/catch inside runExpirySweep's inner loop so one Telegram send failure no longer permanently silences notification for the rest of an already-expired batch
- Replaced the owner-approval callback_query handler's read-then-write race with a single atomic `UPDATE...WHERE bookingStatus='pending_owner_approval'...RETURNING` compare-and-swap, closing WR-05.
- 5 additive Neon columns (Google OAuth token, calendar-sync status/retry, agenda/reminder sent-state) plus a 9-function typed query layer with atomic UPDATE...WHERE...RETURNING claim guards preventing double-send/double-sync races.
- OAuth 2.0 consent flow + best-effort, non-blocking Google Calendar CRUD (googleapis SDK) wired into booking confirm/cancel/reschedule, with a 10-attempt in-process retry poller and a CSRF-guarded one-time fixture-setup CLI.
- Human-action checkpoint deferred — OAuth CLI tooling built and ready; tokens to be provisioned before end-to-end Calendar sync can be demonstrated live
- In-process 10-minute poller sending a Greek daily Telegram agenda to each business owner once per Athens calendar day, guarded by Plan 03-01's atomic `claimAgendaSlot` and DST-safe `isoDateInAthens` date arithmetic.
- DST-safe 24h/1h Telegram reminder sweep with permanent D-14 eligibility gates and noon-UTC-anchor calendar arithmetic, implemented as the 4th in-process Phase 3 poller alongside the expiry, calendar-sync, and agenda sweeps.

---
