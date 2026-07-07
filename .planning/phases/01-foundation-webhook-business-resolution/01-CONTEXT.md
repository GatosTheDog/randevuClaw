# Phase 1: Foundation, Webhook & Business Resolution - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Messages sent to the shared WhatsApp number reach the bot reliably, get routed to the correct business via deep link/business code, and get logged/deduplicated — the structural backbone every later phase depends on. First contact also shows the required data-consent notice. Covers requirements PLAT-01 (business resolution) and COMP-01 (consent notice). Does NOT cover booking logic, AI conversation, calendar sync, or real owner onboarding (fixtures stand in for real businesses through Phase 3).

</domain>

<decisions>
## Implementation Decisions

### Business Code & Deep-Link Format
- **D-01:** Business code is a human-readable slug (e.g. `pilates-athens`), not a random token or numeric ID.
- **D-02:** Matching normalizes input (lowercase, trim whitespace, strip Greek accents/diacritics) then requires an exact match against a known slug — no fuzzy "did you mean" fallback in Phase 1.
- **D-03:** Slugs are auto-generated from the business name (slugify + numeric suffix on collision). Owner-customization of the slug is a Phase 4 onboarding concern, not Phase 1.
- **D-04:** The bot extracts the slug from anywhere in the client's first message (not just an exact whole-message match), since users may edit the pre-filled deep-link text before sending.

### Dedup/Idempotency Store
- **D-05:** Dedup is Postgres-only — a UNIQUE constraint on WhatsApp message ID in the messages/audit table, using `INSERT ... ON CONFLICT DO NOTHING`. No Redis. This resolves a conflict between the research (which recommended Redis) and the locked stack in CLAUDE.md (Neon Postgres only, no Redis) — Redis is explicitly rejected for Phase 1 to preserve the $0 budget and the locked stack.
- **D-06:** Processed message IDs are retained forever as part of the permanent audit log — no separate TTL/cleanup job.
- **D-07:** On a detected duplicate, the bot is a silent no-op: return HTTP 200 to Meta, log the duplicate, send no reply. Satisfies roadmap SC3 ("exactly one reply, not two").
- **D-08:** A message is marked "processed" (its ID inserted) only *after* the reply is successfully sent, not before. This accepts a rare duplicate-reply risk (if the bot crashes after replying but before marking) in exchange for never silently dropping a message it crashed on mid-processing.

### Consent & First-Contact Flow
- **D-09:** "First message ever" is scoped per (phone number, business) pair, not globally per phone number — each new business relationship shows its own consent notice. Chosen for stronger GDPR defensibility in a multi-tenant platform.
- **D-10:** Consent is inform-and-continue (implied consent) — the bot sends the notice then proceeds with the conversation without waiting for an explicit "yes/OK" reply. No blocking confirmation step.
- **D-11:** Consent copy uses a contract-necessity framing ("we store your phone number and booking history to manage your appointments with this business") rather than a consent-with-opt-out framing. No "reply STOP" opt-out line in the first message.
- **D-12:** Consent is recorded as a flag + timestamp column on the (phone, business_id) client-business relationship record — not a separate append-only consent-events log table.

### Fixture Businesses & Tenant Isolation
- **D-13:** Tenant isolation in Phase 1 is enforced at the application level (`WHERE business_id = ?` via a shared query-builder helper), not Postgres Row-Level Security. RLS is deferred — revisit if Phase 4 multi-tenancy hardening needs it.
- **D-14:** Phase 1 seeds exactly two fixture businesses (e.g. a pilates studio + a hair salon) to prove disambiguation actually works, not just a single-business assumption.
- **D-15:** Fixture businesses have only name + slug/code in Phase 1 — no hours/services/prices yet (those arrive in Phase 2/3/4 as their respective features need them).
- **D-16:** Fixtures are created via a committed Drizzle seed script (`npm run db:seed`), not embedded in migration files — reproducible and re-runnable after a fresh migration.

### Claude's Discretion
- Exact Greek wording of the consent notice and the "which business have you reached" confirmation reply — Claude drafts these to match tone from PROJECT.md, no specific phrasing was mandated by the user beyond the contract-necessity framing (D-11).
- Exact slug-collision suffix scheme (e.g. `-2`, `-3` vs random suffix) — not specified, left to implementation.
- Shape/columns of the audit/messages table beyond the message-ID UNIQUE constraint — left to planner/executor.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project scope & requirements
- `.planning/PROJECT.md` — core value, constraints (budget, stack, language, GDPR), key decisions
- `.planning/REQUIREMENTS.md` — PLAT-01 and COMP-01 full requirement text, out-of-scope list
- `.planning/ROADMAP.md` §"Phase 1: Foundation, Webhook & Business Resolution" — goal and 5 success criteria this phase must satisfy
- `.claude/CLAUDE.md` — locked tech stack (Node/TS, Neon+Drizzle, fly.io, R2, Gemini, Google Calendar, WhatsApp Cloud API); **no Redis** — directly informs D-05

### Research (informs implementation, not requirements)
- `.planning/research/SUMMARY.md` §"Phase 1: Foundation & Webhook Infrastructure" — recommended webhook/schema/RLS approach
- `.planning/research/PITFALLS.md` — Pitfall 1 (Meta verification), Pitfall 5 (multi-tenant context loss), Pitfall 9 (GDPR) all map to Phase 1
- `.planning/research/ARCHITECTURE.md` — stateless webhook handler pattern, message dedup pattern
- `.planning/research/STACK.md` — stack rationale (cross-check against CLAUDE.md's locked version — CLAUDE.md wins on conflicts, e.g. Redis)

</canonical_refs>

<code_context>
## Existing Code Insights

Project is greenfield — no source code exists yet (repo has no code, only `.planning/` artifacts). No reusable assets, established patterns, or integration points to note. Planner/executor start from a clean slate per the stack in CLAUDE.md.

</code_context>

<specifics>
## Specific Ideas

No particular UI/copy references given beyond the framing decisions above (D-11, contract-necessity consent copy). Open to standard approaches for exact Greek phrasing, DB column naming, and file/module structure.

</specifics>

<deferred>
## Deferred Ideas

- Owner-customizable business slugs — belongs in Phase 4 (Owner Self-Serve Onboarding).
- Fuzzy/"did you mean" matching for mistyped business codes — could be added later if fixture testing shows exact-match is too brittle, but out of scope for Phase 1.
- Postgres Row-Level Security for tenant isolation — deferred; app-level filtering (D-13) is the Phase 1 choice, revisit if Phase 4 multi-tenancy needs stronger guarantees.
- Consent opt-out line ("reply STOP") — deferred in favor of contract-necessity framing (D-11); revisit if COMP-02 (deletion, Phase 5) needs a more discoverable entry point.

None — discussion stayed within phase scope otherwise.

</deferred>

---

*Phase: 1-Foundation, Webhook & Business Resolution*
*Context gathered: 2026-07-07*
