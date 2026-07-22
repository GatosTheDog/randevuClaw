# Phase 7: Billing Configuration & Payment Recording - Context

**Gathered:** 2026-07-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Owner-facing billing setup and payment recording via Telegram chat. No changes to the existing booking flow. This phase delivers:
- `billing_packages` table: owner creates/lists/deactivates packages (name, price, valid_days, session_count)
- `memberships` table: created when owner records a payment; rolling expiry window
- `membership_ledger` table: immutable append-only ledger (idempotency_key UNIQUE)
- `client_name` column on `client_business_relationships`: captured from Telegram `from.first_name` on first contact
- Owner NLU commands wired into the existing `ai-owner-agent.ts` Gemini tool system
- Phase 8 (enforcement) and Phase 9 (notifications) depend on this schema — no booking logic changes here

**This is NOT payment processing.** No money flows through the system. The owner records that a payment was received externally (cash, bank transfer) and the bot creates the membership record.

</domain>

<decisions>
## Implementation Decisions

### Package Creation UX
- **D-01:** Owner creates packages via NLU — Gemini parses a natural-language Greek message (e.g. "Πακέτο 10 μαθήματα €80 ισχύς 30 μέρες") and calls a `create_package` tool. Single-message flow, consistent with existing `ai-owner-agent.ts` pattern.
- **D-02:** "Unlimited sessions" signaled via NLU keywords — Gemini recognizes "απεριόριστες", "απεριόριστο", "χωρίς όριο", "unlimited" → maps to `session_count = null`. No separate keyboard step.
- **D-03:** Always show a Greek confirmation step after Gemini parses the 4 fields (name, price, valid_days, session_count). Bot echoes parsed values and waits for Ναι/Όχι before writing to DB. Catches misparses before they hit the DB.

### Client Lookup in Payment Recording
- **D-04:** Client identification uses Telegram display name captured on first contact. Add nullable `client_name text` column to `client_business_relationships`; populate from Telegram `from.first_name` on each incoming message (upsert).
- **D-05:** Payment flow shows recent clients as inline keyboard buttons. Show last 30 days of unique clients who have bookings with this business. Each button label: client display name (from `client_name`). If `client_name` is null for an old record, fall back to service + date of most recent booking.
- **D-06:** Payment recording flow order: **client first, then package**. Owner selects who paid → then selects which package they bought → bot shows Greek confirmation → membership created.

### Billing Command Routing
- **D-07:** Billing commands extend the existing `ai-owner-agent.ts` Gemini tool system. New tools added: `create_package`, `list_packages`, `deactivate_package`, `record_payment`, `view_client_membership`. One NLU agent handles all owner post-onboarding commands. No new router file.
- **D-08:** After Gemini detects a payment-recording intent, the bot switches to inline keyboard mode for client selection (D-05) and package selection — not NLU. Structured button UI for the selection steps; NLU only for intent detection.

### Clarifications
- **D-09:** No payment processing. Bot records that a payment occurred (owner-driven manual logging). No Stripe, no Viva Wallet, no invoice generation.
- **D-10:** One active membership per client per business (PoC constraint from REQUIREMENTS.md Out of Scope). Enforced at DB level.
- **D-11:** Schema migration in Phase 7 adds all tables needed for v1.2: `billing_packages`, `memberships`, `membership_ledger`, and `client_name` column. Phase 8 and 9 add enforcement logic/notifications but no new schema tables.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/ROADMAP.md` §Phase 7 — goal, success criteria, dependencies
- `.planning/REQUIREMENTS.md` §BILL-01..03, PAY-01..03 — locked requirements for this phase
- `.planning/REQUIREMENTS.md` §Out of Scope — confirms no payment gateway, no multiple memberships per client

### Existing Schema & Code Patterns
- `src/database/schema.ts` — ALL existing tables; new tables must follow established Drizzle conventions (prices in cents as integer, timestamps as TIMESTAMP WITH TIME ZONE, nullables with comment annotations)
- `src/onboarding/ai-owner-agent.ts` — existing Gemini NLU tool pattern; billing tools extend this file
- `src/onboarding/router.ts` + `src/onboarding/steps.ts` — DB-backed state machine; reference for guided flows if needed

### Roadmap Architecture Decisions (from STATE.md)
- Immutable ledger pattern: `membership_ledger` is append-only; `idempotency_key` UNIQUE constraint prevents duplicate deductions
- TIMESTAMP WITH TIME ZONE for all expiry timestamps; rolling window math in Europe/Athens timezone using `date-fns 4.4.0`
- `date-fns 4.4.0` is the only new dependency for rolling window calculations

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ai-owner-agent.ts` Gemini tool system: add `create_package`, `list_packages`, `deactivate_package`, `record_payment`, `view_client_membership` as new tool definitions following exact same schema shape as existing `update_hours`, `add_service` tools
- `src/database/queries.ts`: follow existing query function signature conventions (typed return, Drizzle select/insert patterns)
- `src/utils/timezone.ts`: use for Europe/Athens rolling window calculations (expiry = purchase_date + valid_days in Athens local time)
- Inline keyboard pattern: already used in onboarding (confirm/cancel buttons); use same Telegraf `bot.action()` + `ctx.answerCbQuery()` pattern for client/package selection in payment flow

### Established Patterns
- Prices as integer cents (e.g. `price: integer('price')`) — established in `services.price`
- Nullable columns with inline JSDoc explaining phase + reason — established in `businesses.botToken`, `bookings.googleCalendarEventId`, etc.
- `uniqueIndex()` for dedup guards — use `idempotency_key` UNIQUE on `membership_ledger`
- `withBusinessContext()` / AsyncLocalStorage RLS threading — all DB queries must run inside this context

### Integration Points
- Schema migration: next migration after `0004` (Phase 5 schema). Add 3 new tables + 1 column on existing table
- `src/webhooks/telegram.ts` routing: owner messages currently route to `ai-owner-agent.ts` after onboarding is 'done'. Billing commands are handled there — no routing changes needed
- `clientBusinessRelationships` upsert: when client sends first message to a business, update `client_name` from Telegram `from.first_name` alongside existing consent upsert

</code_context>

<specifics>
## Specific Ideas

- Confirmed: no payment gateway, no money processing — Phase 7 is purely admin logging
- Owner says "record payment" or "πληρωμή" → bot responds with inline keyboard (client buttons, last 30 days), then package buttons, then Greek confirmation before creating membership
- Greek confirmation message for package creation should echo all 4 fields: "📦 Πακέτο 'Μηνιαία': 10 συνεδρίες, €80, ισχύει 30 μέρες. Δημιουργώ;"
- `client_name` should be upserted (not skipped if null) — always reflect the latest Telegram display name in case the client updates their profile

</specifics>

<deferred>
## Deferred Ideas

- Payment gateway integration (Viva Wallet, Stripe) — v2.0 per REQUIREMENTS.md
- Multiple simultaneous active memberships per client — post-PoC
- Refunds, proration, partial credit — v1.3 per REQUIREMENTS.md
- Credit rollover on renewal — v1.3
- Punch cards with no expiry — v1.3
- ENFC-01 enforcement_policy column on businesses: Phase 8 will add this; Phase 7 schema migration should NOT include it to keep migration atomic to Phase 7 scope

</deferred>

---

*Phase: 7-Billing Configuration & Payment Recording*
*Context gathered: 2026-07-17*
