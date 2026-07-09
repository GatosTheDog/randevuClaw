# Roadmap: RandevuClaw

## Milestones

- ✅ **v1.0 MVP** — Phases 1-3 (shipped 2026-07-09)
- 📋 **v1.1** — Phases 4-5 (planned)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1-3) — SHIPPED 2026-07-09</summary>

- [x] Phase 1: Foundation, Webhook & Business Resolution (3/4 plans) — completed 2026-07-07 (01-04 deferred: Meta BV human action)
- [x] Phase 2: AI Booking Conversations & Owner Alerts (9/9 plans) — completed 2026-07-08
- [x] Phase 3: Calendar Sync, Agenda & Reminders (6/6 plans) — completed 2026-07-09

See: `.planning/milestones/v1.0-ROADMAP.md`

</details>

### 📋 v1.1 (Planned)

- [ ] **Phase 4: Owner Self-Serve Onboarding & Multi-Tenancy** — Owners configure their business entirely via chat; multiple businesses coexist safely on one shared number.
- [ ] **Phase 5: Compliance & Production Readiness** — Data-deletion requests, verification/template completion, and load-tested reliability close out the PoC.

## Phase Details

### Phase 4: Owner Self-Serve Onboarding & Multi-Tenancy

**Goal**: A business owner can set up and maintain their entire business profile through a chat conversation with no manual database step, and multiple businesses can safely share the one platform number with zero cross-tenant data leakage.
**Mode**: mvp
**Depends on**: Phase 1, Phase 2
**Requirements**: OWNR-01
**Success Criteria** (what must be TRUE):

  1. A new business owner can complete full setup (business name, hours, services, prices, shared schedule) entirely through a chat conversation, replacing the fixture/seed businesses used to test Phases 1-3.
  2. After onboarding, the business immediately has a working deep link/business code that clients can use to reach it.
  3. With two distinct businesses onboarded, a client using Business A's deep link never sees Business B's hours, services, or bookings, and vice versa (verified via a deliberate cross-tenant query attempt, not just the happy path).
  4. Owner can update previously configured hours, services, or prices via chat after initial onboarding, and changes take effect immediately for new bookings.

**Plans**: TBD

### Phase 5: Compliance & Production Readiness

**Goal**: Clients and owners can exercise their data-deletion rights, Meta verification and message templates are fully live (not sandbox-restricted), and the platform stays responsive under realistic concurrent load — closing the PoC out as production-ready rather than demo-only.
**Mode**: mvp
**Depends on**: Phase 1, Phase 2, Phase 3, Phase 4
**Requirements**: COMP-02
**Success Criteria** (what must be TRUE):

  1. A client or owner can request data deletion via chat (e.g., "διαγράψτε τα δεδομένα μου") and receives confirmation once it's done.
  2. After a deletion request is fulfilled, no booking history or phone number for that client remains queryable anywhere in the system.
  3. Meta Business Verification is fully approved and the platform WhatsApp number is live, not sandbox-restricted — confirmed by the owner.
  4. Under a burst of 15-20 simultaneous client messages, the bot degrades gracefully (backoff/queueing on the Gemini free-tier rate limit) rather than dropping messages or crashing.

**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation, Webhook & Business Resolution | v1.0 | 3/4 | Complete | 2026-07-07 |
| 2. AI Booking Conversations & Owner Alerts | v1.0 | 9/9 | Complete | 2026-07-08 |
| 3. Calendar Sync, Agenda & Reminders | v1.0 | 6/6 | Complete | 2026-07-09 |
| 4. Owner Self-Serve Onboarding & Multi-Tenancy | v1.1 | 0/TBD | Not started | - |
| 5. Compliance & Production Readiness | v1.1 | 0/TBD | Not started | - |
