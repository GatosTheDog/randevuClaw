# Phase 2: AI Booking Conversations & Owner Alerts - Context

**Gathered:** 2026-07-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Clients carry out a full natural-language conversation (via a messaging channel, see D-01) in Greek to check availability, book, cancel, or reschedule an appointment, and ask questions — with owners alerted in real time and no double-bookings, even under concurrent requests. Covers requirements BOOK-01, BOOK-02, BOOK-03, BOOK-04, ASK-01, ASK-02, OWNR-02. Does NOT cover Google Calendar sync, daily agenda, reminders (Phase 3), or real owner self-serve onboarding (fixtures still stand in for real businesses — Phase 4).

</domain>

<decisions>
## Implementation Decisions

### Messaging Channel Pivot (locked, project-wide — supersedes CLAUDE.md/ROADMAP.md wording)
- **D-01:** Phase 2 is built against **Telegram** (Bot API) first, not WhatsApp. WhatsApp integration from Phase 1 (`src/webhooks/whatsapp.ts`) is complete and stays as-is but is shelved — Meta's Cloud API won't deliver production webhook traffic to an unpublished Business-type app, and the publish gate is blocked on Business Verification (1-6 week clock, still pending). Rather than block product development on that external timeline, build the actual booking-conversation product against Telegram, which has zero-friction bot creation (BotFather, instant token, no review/publish gate).
- **D-02:** Viber was evaluated and ruled out — as of 2026, Viber bots require a commercial relationship with Rakuten (no self-service signup), conflicting with the near-$0 PoC budget.
- **D-03:** Structure the code as channel-agnostic core (business resolution, dedup, consent, and the new Gemini conversation/booking logic) + thin channel adapters. The WhatsApp adapter already exists; add a Telegram adapter alongside it using the same core, so WhatsApp can slot back in later (once verification clears) without reworking booking logic.
- **D-04:** ROADMAP.md's Phase 2 goal text and REQUIREMENTS.md currently say "WhatsApp conversation" — downstream agents (researcher, planner) should treat this as **Telegram** conversation for Phase 2 implementation purposes. The docs themselves are not edited by this discussion (out of scope for `/gsd-discuss-phase`); reconcile at the next `/gsd-transition` or doc update pass.

### Booking Approval Scope
- **D-05:** Owner accept/reject applies to **new bookings and reschedules** (both involve claiming a slot that could conflict with something else) — not to cancellations. Cancellations are client-initiated and auto-processed, with no owner veto, per BOOK-02 ("client can cancel anytime, no cutoff"). This resolves a literal-reading tension in ROADMAP.md SC5 ("owner can accept/reject" on booking/cancellation/reschedule) — cancellations don't get a reject option in Phase 2.
- **D-06:** Auto-processed actions (cancellations) still send the owner an FYI alert — no accept/reject buttons on that message, just a notice that a client cancelled.
- **D-07:** On a new booking request, the client immediately receives a "pending owner confirmation" message (not "booking confirmed"). A second message follows once the owner accepts or rejects.

### Owner Response Mechanism & Timeout
- **D-08:** Owner accepts/rejects via Telegram inline keyboard buttons (e.g. Αποδοχή / Απόρριψη) attached to the alert message — not text commands. One tap, unambiguous which booking it targets (via Telegram callback_query data).
- **D-09:** If the owner doesn't respond, the pending booking auto-expires after **2 hours**. The client is told the slot wasn't confirmed in time.

### Slot Holding & Double-Booking Prevention
- **D-10:** A booking request immediately locks its slot on entering `pending_owner_approval` state (DB row inserted, covered by the existing UNIQUE-constraint-style approach from Phase 1's dedup pattern). A second client requesting the same slot while one request is pending is told the slot is already requested — not left to the owner to sort out after the fact.
- **D-11:** When a pending booking auto-expires (D-09) or the owner rejects it, the slot hold is released immediately — no buffer/grace period before it's offered to the next client.

### Availability Data Model
- **D-12:** Build the **full data model now**, not a placeholder: per-service durations and per-day business hours (both fixture businesses get a real weekly hours table and multiple services with distinct durations), rather than one fixed hours block + one generic service. User explicitly chose this over the simpler recommended default — Phase 4's onboarding flow will write to this same schema rather than needing a later migration.
- **D-13:** `check_availability` reasons about open slots in **1-hour granularity**.
- **D-14:** Exact service names/durations and weekly hours to seed for the two Phase 1 fixture businesses (pilates studio, hair salon) are left to the planner/executor — pick plausible Greek small-business values (varying service durations, typical weekly hours, e.g. closed one day).

### Claude's Discretion
- Exact Greek wording for all new Telegram messages (pending-confirmation notice, owner alert text, expiry notice, confirmation/rejection replies) — no specific phrasing mandated beyond the tone already established in Phase 1 CONTEXT.md.
- Exact schema/table design for the availability model (D-12) — services table, business_hours table, columns — left to planner.
- Telegram adapter internal structure (webhook handler shape, callback_query routing) — left to planner, should mirror the existing WhatsApp adapter's conventions where reasonable per D-03.
- Idempotency key format for Gemini function calls — left to planner/executor per research (ARCHITECTURE.md).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project scope & requirements
- `.planning/PROJECT.md` — core value, constraints (budget, stack, language, GDPR), key decisions
- `.planning/REQUIREMENTS.md` — BOOK-01..04, ASK-01/02, OWNR-02 full requirement text (note: still says "WhatsApp" — read as "Telegram" per D-01/D-04)
- `.planning/ROADMAP.md` §"Phase 2: AI Booking Conversations & Owner Alerts" — goal and 5 success criteria this phase must satisfy (note: goal text says "WhatsApp conversation" — read as "Telegram" per D-01/D-04)
- `.claude/CLAUDE.md` — locked tech stack; Gemini `@google/genai` (not yet installed — dependency to add this phase); **no Redis** — conversation state must be Postgres-only, same constraint that drove Phase 1's D-05

### Messaging channel pivot (new, this phase)
- No existing ADR/doc for the Telegram pivot yet — this CONTEXT.md (D-01 through D-04) is the canonical record until PROJECT.md/ROADMAP.md/REQUIREMENTS.md are updated at the next transition.

### Research (informs implementation, not requirements)
- `.planning/research/SUMMARY.md` §"Phase 2: AI Integration & Booking Logic" — sequential Gemini function-calling, Greek date parsing flag, rate-limit circuit breaker
- `.planning/research/ARCHITECTURE.md` — sequential AI function-call pattern (no parallel calls), function execution layer with transactional boundaries, idempotency keys; note the doc's Redis/BullMQ recommendations conflict with the locked no-Redis stack — Postgres-only per Phase 1 precedent
- `.planning/research/PITFALLS.md` — Pitfall 3 (double-booking/race conditions, directly informs D-10), Pitfall 4 (Gemini free-tier rate limits), Pitfall 5 (multi-tenant context loss), Pitfall 6 (Greek date/time parsing)

### Prior phase context
- `.planning/phases/01-foundation-webhook-business-resolution/01-CONTEXT.md` — D-05 (Postgres-only dedup, no Redis), D-13 (app-level tenant isolation), D-15 (fixtures currently have no hours/services — this phase adds them per D-12)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/business/resolver.ts` — business-code extraction/normalization; the channel-agnostic core can reuse this for identifying which business a Telegram message is for, if Telegram messages also carry a business code (or the equivalent bot-command/deep-link mechanism for Telegram).
- `src/database/queries.ts`, `src/database/schema.ts` — existing `businesses`, `messages`, `client_business_relationships` tables and dedup query patterns (`insertOrIgnoreMessage`, `markMessageProcessed`) — new `bookings`, `services`, `business_hours` tables should follow the same Drizzle conventions.
- `src/consent/checker.ts` — first-contact consent flow; Telegram adapter needs the same per-(phone/telegram-id, business) first-contact check.
- `src/utils/logger.ts`, `src/utils/validation.ts` — reusable as-is for the new Telegram webhook handler.

### Established Patterns
- Webhook handler pattern in `src/webhooks/whatsapp.ts`: signature verification → payload validation → iterate entries/changes/messages → dedup insert → process → reply → mark-processed-after-send (D-08 from Phase 1). The new Telegram webhook handler should follow the same shape, swapping WhatsApp-specific signature verification for Telegram's webhook secret token check.
- "Always return 200, never let Meta/Telegram retry a message we already handled" invariant — same applies to Telegram's webhook delivery semantics.

### Integration Points
- New Telegram adapter sits alongside `src/webhooks/whatsapp.ts`, both calling into the same channel-agnostic core (business resolution, dedup, consent, and the new Gemini conversation engine) per D-03.
- Gemini function-calling loop is new code this phase — no existing AI integration to build on. `@google/genai` is not yet a dependency (see `package.json`).
- No `bookings`, `services`, or `business_hours` tables exist yet — Phase 2 planner must design and migrate these.

</code_context>

<specifics>
## Specific Ideas

No particular UI/copy references given beyond the framing decisions above. Owner response uses Telegram inline keyboard buttons specifically (D-08) — not text commands, not WhatsApp interactive buttons (channel changed to Telegram, D-01). Open to standard approaches for exact Greek phrasing, DB schema, and file/module structure.

</specifics>

<deferred>
## Deferred Ideas

- Per-business dedicated messaging accounts/numbers post-PoC — belongs to the same post-PoC channel-strategy discussion as the WhatsApp-to-Telegram pivot, not this phase.
- Bringing WhatsApp back online once Meta Business Verification clears — future phase/milestone work; the channel adapter split (D-03) is designed to make this a drop-in, not a rewrite.
- Cancellation cutoff windows (BOOK2-01, v2 requirement) — explicitly out of scope; cancellations stay unrestricted per D-05/BOOK-02.

### Reviewed Todos (not folded)
- **Pivot to per-business WhatsApp numbers post-PoC** (`.planning/todos/pending/2026-07-07-pivot-to-per-business-whatsapp-numbers-post-poc.md`) — reviewed, not folded. Concerns Phase 1's routing/business-identity model post-PoC, not Phase 2's booking-conversation logic. Remains relevant context for whenever WhatsApp is reintroduced (see Deferred above).

</deferred>

---

*Phase: 2-AI Booking Conversations & Owner Alerts*
*Context gathered: 2026-07-08*
