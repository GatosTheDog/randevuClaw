# Milestones

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
