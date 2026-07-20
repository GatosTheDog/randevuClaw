# Roadmap: RandevuClaw

## Milestones

- ✅ **v1.0 MVP** — Phases 1-3 (shipped 2026-07-09)
- ✅ **v1.1 Per-Bot Infrastructure & Owner Onboarding** — Phases 4-5 (shipped 2026-07-17)
- 🚧 **v1.2 Billing & Membership System** — Phases 7-9 (planned)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-3) — SHIPPED 2026-07-09</summary>

- [x] Phase 1: Foundation, Webhook & Business Resolution (3/4 plans) — completed 2026-07-07 (01-04 deferred: Meta BV human action)
- [x] Phase 2: AI Booking Conversations & Owner Alerts (9/9 plans) — completed 2026-07-08
- [x] Phase 3: Calendar Sync, Agenda & Reminders (6/6 plans) — completed 2026-07-09

See: `.planning/milestones/v1.0-ROADMAP.md`

</details>

<details>
<summary>✅ v1.1 Per-Bot Infrastructure & Owner Onboarding (Phases 4-5) — SHIPPED 2026-07-17</summary>

- [x] **Phase 4: Per-Bot Foundation** — Telegraf migration, per-bot webhook routing, HMAC secret verification, and PostgreSQL RLS enforce tenant isolation. (completed 2026-07-11)
- [x] **Phase 5: Owner Self-Serve Onboarding** — Owners register their bot and configure their business through a 25-step guided Telegram chat flow; seed fixtures removed. (completed 2026-07-17)

Note: Phase 6 (GDPR Compliance & Rate-Limit Resilience) requirements deferred to v1.3 — COMP-02/03/04/RESIL-01 carry forward.

See: `.planning/milestones/v1.1-ROADMAP.md`

</details>

### 🚧 v1.2 Billing & Membership System (Planned)

- [ ] **Phase 7: Billing Configuration & Payment Recording** — Owner defines billing packages and records client payments via chat; the bot creates memberships with rolling expiry windows and an immutable session ledger.
- [ ] **Phase 8: Enforcement & Session Deduction** — Booking confirmation and cancellation atomically update session balances; the bot enforces per-business membership policies before accepting bookings.
- [ ] **Phase 9: Expiry Notifications & Client Balance** — The platform sweeps for near-expiry memberships and notifies clients and owners proactively; clients can query their own session balance at any time via chat.

## Phase Details

### Phase 4: Per-Bot Foundation

**Goal**: The Telegram layer is migrated to Telegraf and supports per-business webhook routing with tenant isolation enforced at the database layer — every v1.1 feature builds on this.
**Depends on**: Phase 1, Phase 2, Phase 3
**Requirements**: BOT-02, BOT-03, BOT-04, BOT-05
**Success Criteria** (what must be TRUE):

  1. A Telegraf-based webhook at `/webhooks/telegram/:botToken` routes incoming messages to the correct business by token lookup; all 208 existing tests continue to pass unchanged.
  2. Two distinct bot tokens can receive messages simultaneously; each request is matched to its correct business tenant with no cross-contamination of data or conversation state.
  3. Every incoming webhook request is verified against a per-bot HMAC secret using constant-time comparison; requests with invalid or missing secrets are rejected with 401.
  4. Attempting to read another business's rows in a Drizzle transaction (without a business_id filter) fails at the PostgreSQL RLS layer, not only at the application level.

**Plans**: 6/6 plans complete
Plans:

- [x] 04-01-PLAN.md — Schema migration (0003 SQL), schema.ts, db.ts, config.ts
- [x] 04-02-PLAN.md — Telegraf registry, logger redaction, jest.setup.ts test env
- [x] 04-03-PLAN.md — queries.ts AsyncLocalStorage + withBusinessContext, client.ts botTokenStore
- [x] 04-04-PLAN.md — Express webhook handler /:webhookId, HMAC verification, seed.ts bot credentials
- [x] 04-05-PLAN.md — Schema push [BLOCKING], telegram-webhook.test.ts patch, rls-enforcement.test.ts
- [x] 04-06-PLAN.md — [GAP] Fix 10 test failures in 3 suites after CR-03/WR-01 code-review fixes

### Phase 5: Owner Self-Serve Onboarding

**Goal**: A business owner can register their Telegram bot and configure their entire business profile through a guided chat conversation, with no manual database intervention required.
**Depends on**: Phase 4
**Requirements**: BOT-01, ONB-01, ONB-02, ONB-03, ONB-04
**Success Criteria** (what must be TRUE):

  1. An owner submits their bot token via chat; the platform validates it via `getMe()`, calls `setWebhook` automatically, and replies with activation confirmation in Greek.
  2. An owner completes the full guided setup (business name, weekly hours, services with prices and durations) entirely through chat; the resulting business is immediately bookable by clients.
  3. An owner who drops off mid-setup can resume exactly where they left off in a later session without restarting the flow from the beginning.
  4. An owner can update any part of their configuration (hours, services, prices) via chat after initial onboarding; changes take effect immediately for new bookings.
  5. No hardcoded fixture or seed businesses exist in the system; every business record is the result of an owner completing the onboarding flow.

**Plans**: 6/7 plans executed
Plans:
**Wave 1**

- [x] 05-01-PLAN.md — Schema migration 0004, config.ts platform vars, insertTestBusiness() helper

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 05-02-PLAN.md — Telegram API helpers (getMe/setWebhook) + onboarding session query layer

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 05-03-PLAN.md — Onboarding state machine: all step handlers + router dispatcher

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 05-04-PLAN.md — Platform bot webhook handler + server.ts route registration
- [x] 05-05-PLAN.md — ONB-03 owner edit flows + telegram.ts keyword intercept

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 05-06-PLAN.md — Integration tests: BOT-01, ONB-01/02 platform + flow tests
- [ ] 05-07-PLAN.md — ONB-04 fixture removal + DB migration + fly.io secrets (blocking checkpoint)

### Phase 6: GDPR Compliance & Rate-Limit Resilience

**Goal**: Clients and owners can exercise data deletion rights via chat, every deletion is audited and eventually hard-deleted, and the platform absorbs Gemini API rate-limit bursts without dropping messages.
**Depends on**: Phase 5
**Requirements**: COMP-02, COMP-03, COMP-04, RESIL-01
**Success Criteria** (what must be TRUE):

  1. A client or owner sends "διαγράψτε τα δεδομένα μου" (or equivalent phrasing); the system soft-deletes their data and replies with confirmation in Greek.
  2. After a deletion request, the subject's booking history and contact details are no longer returned by any booking query or AI agent response.
  3. A deletion audit log record is created for every deletion request; the record survives independently even after the target data is permanently removed.
  4. A background job permanently removes soft-deleted records 30 days after the deletion request date and runs automatically without manual intervention.
  5. Under a burst of 15+ simultaneous client messages, all Gemini calls are queued via p-queue; no messages are dropped and rate-limit errors are absorbed without crashing.

**Plans**: TBD

### Phase 7: Billing Configuration & Payment Recording

**Goal**: Owner can configure billing packages and record client payments via chat; the bot creates memberships with rolling expiry windows and an immutable session ledger — with no changes to the existing booking flow.
**Depends on**: Phase 5 (owner identity established via onboarding), Phase 4 (per-bot routing)
**Requirements**: BILL-01, BILL-02, BILL-03, PAY-01, PAY-02, PAY-03
**Success Criteria** (what must be TRUE):

  1. Owner creates a billing package via chat (name, price, duration in days, session count or unlimited); the bot confirms and the package is immediately selectable for new client payments.
  2. Owner records a client payment via chat using button-based package selection followed by an explicit Greek confirmation step; the bot creates a membership with the correct expiry date (purchase date + valid days, Europe/Athens timezone).
  3. Owner lists all active packages for their business with a single chat command and receives a formatted Greek reply.
  4. Owner deactivates a package via chat; it no longer appears in new payment flows while all existing memberships with that package remain intact.
  5. Owner queries a specific client's membership via chat and receives a Greek reply showing package name, sessions remaining, and membership expiry date.

**Plans**: 5/5 plans executed
Plans:
**Wave 1**

- [x] 07-01-PLAN.md — Wave 0: Test scaffolding (8 billing test stubs + COVERAGE.md)
- [x] 07-02-PLAN.md — Wave 1: Schema extension (3 new tables + client_name column) + migration SQL + [BLOCKING] drizzle-kit push

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 07-03-PLAN.md — Wave 2: Billing query layer (billing/queries.ts) + client_name upsert + test fixtures

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 07-04-PLAN.md — Wave 3: Billing command handlers (tools.ts) + payment flow keyboard (payment-flow.ts)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 07-05-PLAN.md — Wave 4: NLU integration (ai-owner-agent.ts) + callback routing (telegram.ts)

### Phase 8: Enforcement & Session Deduction

**Goal**: Booking confirmation and cancellation atomically update the session ledger; the bot enforces per-business membership policies before accepting any booking.
**Depends on**: Phase 7
**Requirements**: SESS-01, SESS-02, SESS-03, SESS-04, ENFC-01, ENFC-02, ENFC-03
**Success Criteria** (what must be TRUE):

  1. When a client confirms a booking, the bot deducts exactly 1 session from the client's active membership in the same database transaction as the booking insert — the updated balance is immediately visible when the owner queries that client.
  2. When a client cancels a booking that was created within their membership validity window, 1 session credit is restored atomically; when the membership has expired at the time of cancellation, no credit is restored.
  3. For unlimited-session memberships, bookings and cancellations succeed with no session count change — only the expiry date is checked to determine validity.
  4. Owner sets the business enforcement policy via chat ("block if no membership" or "allow and flag"); the chosen policy takes effect immediately for all subsequent booking attempts.
  5. With "block" policy active, a client without a valid membership receives a Greek refusal message; with "flag" policy, the booking proceeds and the owner receives a Greek alert identifying the unpaid client.

**Plans**: 5 plans
Plans:
**Wave 1**

- [ ] 08-01-PLAN.md — Wave 0: Test scaffolding (14 it.todo stubs across 3 test files)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 08-02-PLAN.md — Schema migration (0007_enforcement_policy.sql) + schema.ts + Business interface + DB apply

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 08-03-PLAN.md — Billing query layer (6 new functions in billing/queries.ts) + integration tests

**Wave 4** *(blocked on Wave 3 completion — plans 04 and 05 run in parallel)*

- [ ] 08-04-PLAN.md — Booking lifecycle integration (bookAppointmentTool + cancelAppointmentTool + telegram.ts cancel paths + unit tests)
- [ ] 08-05-PLAN.md — Enforcement NLU tool (handleSetEnforcementPolicy + set_enforcement_policy in ai-owner-agent.ts + unit tests)

### Phase 9: Expiry Notifications & Client Balance

**Goal**: The platform proactively notifies clients and owners 7 days before a membership expires, and clients can query their own session balance at any time via chat.
**Depends on**: Phase 8
**Requirements**: NOTF-01, NOTF-02, NOTF-03, NOTF-04
**Success Criteria** (what must be TRUE):

  1. Seven days before a membership expires, the client receives a Greek notification with their sessions remaining and expiry date; the business owner simultaneously receives a Greek alert naming the expiring client and their remaining balance.
  2. Expiry notifications are sent at most once per membership per notification trigger regardless of how many times the expiry sweep runs — duplicate notifications never reach clients or owners.
  3. A client sends a Greek balance query (e.g. "πόσα μαθήματα μου έχουν απομείνει;") and receives an accurate Greek reply with sessions remaining and the membership expiry date for their active membership.

**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation, Webhook & Business Resolution | v1.0 | 3/4 | Complete | 2026-07-07 |
| 2. AI Booking Conversations & Owner Alerts | v1.0 | 9/9 | Complete | 2026-07-08 |
| 3. Calendar Sync, Agenda & Reminders | v1.0 | 6/6 | Complete | 2026-07-09 |
| 4. Per-Bot Foundation | v1.1 | 6/6 | Complete | 2026-07-11 |
| 5. Owner Self-Serve Onboarding | v1.1 | 7/7 | Complete | 2026-07-17 |
| 6. GDPR Compliance & Rate-Limit Resilience | v1.3 | 0/TBD | Deferred | - |
| 7. Billing Configuration & Payment Recording | v1.2 | 5/5 | In Progress|  |
| 8. Enforcement & Session Deduction | v1.2 | 0/TBD | Not started | - |
| 9. Expiry Notifications & Client Balance | v1.2 | 0/TBD | Not started | - |
