# Roadmap: RandevuClaw

## Milestones

- ✅ **v1.0 MVP** — Phases 1-3 (shipped 2026-07-09)
- 📋 **v1.1** — Phases 4-6 (planned)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-3) — SHIPPED 2026-07-09</summary>

- [x] Phase 1: Foundation, Webhook & Business Resolution (3/4 plans) — completed 2026-07-07 (01-04 deferred: Meta BV human action)
- [x] Phase 2: AI Booking Conversations & Owner Alerts (9/9 plans) — completed 2026-07-08
- [x] Phase 3: Calendar Sync, Agenda & Reminders (6/6 plans) — completed 2026-07-09

See: `.planning/milestones/v1.0-ROADMAP.md`

</details>

### 📋 v1.1 (Planned)

- [x] **Phase 4: Per-Bot Foundation** — Telegraf migration, per-token webhook routing, HMAC secret verification, and PostgreSQL RLS establish the infrastructure every v1.1 feature depends on. (completed 2026-07-11)
- [ ] **Phase 5: Owner Self-Serve Onboarding** — Owners register their bot, complete guided business setup, and maintain their config entirely through chat; fixtures are removed.
- [ ] **Phase 6: GDPR Compliance & Rate-Limit Resilience** — Data-deletion rights via chat, 30-day hard-delete job, audit trail, and p-queue Gemini resilience close out the Telegram PoC.

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

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation, Webhook & Business Resolution | v1.0 | 3/4 | Complete | 2026-07-07 |
| 2. AI Booking Conversations & Owner Alerts | v1.0 | 9/9 | Complete | 2026-07-08 |
| 3. Calendar Sync, Agenda & Reminders | v1.0 | 6/6 | Complete | 2026-07-09 |
| 4. Per-Bot Foundation | v1.1 | 6/6 | Complete    | 2026-07-11 |
| 5. Owner Self-Serve Onboarding | v1.1 | 6/7 | In Progress|  |
| 6. GDPR Compliance & Rate-Limit Resilience | v1.1 | 0/TBD | Not started | - |
