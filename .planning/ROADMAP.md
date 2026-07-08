# Roadmap: RandevuClaw

## Overview

RandevuClaw goes from zero to a working WhatsApp-native booking platform in five phases, each one an independently demoable slice. Phase 1 lays the webhook/database backbone and proves a client can be routed to the right business (kicking off the slow Meta Business Verification clock on day one). Phase 2 layers in the AI-driven booking conversation itself — book, cancel, reschedule, check availability, ask questions — with owner alerts and double-booking prevention baked in from the start. Phase 3 closes the loop with Google Calendar sync, the owner's daily agenda, and pre-approved WhatsApp reminder templates. Phase 4 replaces the fixture businesses used for testing with real self-serve owner onboarding via chat, validated across multiple tenants sharing one WhatsApp number. Phase 5 finishes the PoC with GDPR data-deletion handling and the reliability work (verification completion, rate-limit resilience) needed before real users arrive.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation, Webhook & Business Resolution** - Webhook infra, deep-link business resolution, and first-contact consent; starts Meta Business Verification.
- [ ] **Phase 2: AI Booking Conversations & Owner Alerts** - Clients book, cancel, reschedule, check availability, and ask questions in natural Greek; owners get real-time alerts.
- [ ] **Phase 3: Calendar Sync, Agenda & Reminders** - Confirmed bookings sync to Google Calendar; owners get a daily agenda; clients get pre-approved-template reminders.
- [ ] **Phase 4: Owner Self-Serve Onboarding & Multi-Tenancy** - Owners configure their business entirely via chat; multiple businesses coexist safely on one shared number.
- [ ] **Phase 5: Compliance & Production Readiness** - Data-deletion requests, verification/template completion, and load-tested reliability close out the PoC.

## Phase Details

### Phase 1: Foundation, Webhook & Business Resolution

**Goal**: Messages sent to the shared WhatsApp number reach the bot reliably, get routed to the correct business via deep link/business code, and get logged/deduplicated — the structural backbone every later phase depends on. First contact also shows the required data-consent notice.
**Mode**: mvp
**Depends on**: Nothing (first phase)
**Requirements**: PLAT-01, COMP-01
**Success Criteria** (what must be TRUE):

  1. Client texting the shared WhatsApp number with a business-specific deep link (`wa.me/<number>?text=<code>`) gets a reply confirming which business they've reached, in Greek.
  2. On a client's very first message ever, the bot sends a data-consent notice (in Greek) explaining what's stored (phone number, booking history) before any other conversation happens.
  3. Sending the identical WhatsApp message twice in quick succession produces exactly one reply and one log entry, not two (idempotent, deduplicated webhook handling).
  4. An unrecognized or invalid business code gets a clear "business not found" reply instead of an error, a crash, or silence.
  5. Meta Business Verification has been submitted (owner can confirm submission status in Meta Business Manager), starting the 1-6 week approval clock before later phases need a fully live number.

**Plans**: 3/4 plans executed
**Wave 1**

- [x] 01-01-PLAN.md
- [ ] 01-04-PLAN.md

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md

### Phase 2: AI Booking Conversations & Owner Alerts

**Goal**: Clients can carry out a full natural-language WhatsApp conversation in Greek to check availability, book, cancel, or reschedule an appointment, and ask questions — with owners alerted in real time and no double-bookings, even under concurrent requests.
**Mode**: mvp
**Depends on**: Phase 1
**Requirements**: BOOK-01, BOOK-02, BOOK-03, BOOK-04, ASK-01, ASK-02, OWNR-02
**Success Criteria** (what must be TRUE):

  1. Client can book an appointment by describing it in natural Greek (e.g., "θέλω ραντεβού την Παρασκευή στις 5") and receives a confirmation reply.
  2. Client can ask "έχετε ελεύθερο Παρασκευή απόγευμα;" (or similar) before booking and gets an accurate availability answer.
  3. Client can cancel or reschedule an existing appointment via chat at any time before it occurs, and receives confirmation either way.
  4. Client can ask about business hours/location/prices or a general freeform question and get a sensible Greek-language answer.
  5. Owner receives a WhatsApp alert on every new booking, cancellation, or reschedule and can accept/reject it; two clients attempting to book the exact same slot at the same time never both succeed — one is told the slot is already taken.

**Plans**: 5 plans
**Wave 1**

- [ ] 02-01-PLAN.md — Phase 2 schema (services/business_hours/bookings/conversation_turns/telegram_updates), typed query layer, Gemini/Telegram config, fixture seed data

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 02-02-PLAN.md — Telegram Bot API client + webhook adapter (secret-token auth, update_id dedup, business resolution, consent reuse)
- [ ] 02-03-PLAN.md — Europe/Athens date utilities, Greek temporal-expression preprocessor, availability engine (1-hour granularity)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 02-04-PLAN.md — Gemini function-calling AI booking agent, tool executor (check/book/cancel/reschedule), conversation router wired into the Telegram webhook

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 02-05-PLAN.md — Owner callback_query approval/rejection handling (with reschedule cascade) + 2-hour pending-booking expiry poller

### Phase 3: Calendar Sync, Agenda & Reminders

**Goal**: Confirmed bookings automatically sync to the owner's Google Calendar, the owner gets a daily WhatsApp agenda, and clients get a reminder before their appointment — using pre-approved message templates so reminders work outside WhatsApp's 24-hour free-form messaging window.
**Mode**: mvp
**Depends on**: Phase 2
**Requirements**: OWNR-04, OWNR-03, NOTF-01
**Success Criteria** (what must be TRUE):

  1. A confirmed booking automatically creates an event on the owner's Google Calendar; cancelling or rescheduling updates or removes that event without any manual action.
  2. Owner receives a WhatsApp message every morning (e.g., 8am Athens time) summarizing that day's appointments.
  3. Client receives a WhatsApp reminder before their appointment (e.g., 24h and/or 1h prior), sent via a Meta-approved message template submitted early in this phase (not built last-minute).
  4. Reminder and agenda messages sent across a DST transition or a late-night booking still land at the correct Athens local time.

**Plans**: TBD

### Phase 4: Owner Self-Serve Onboarding & Multi-Tenancy

**Goal**: A business owner can set up and maintain their entire business profile through a WhatsApp conversation with no manual database step, and multiple businesses can safely share the one platform number with zero cross-tenant data leakage.
**Mode**: mvp
**Depends on**: Phase 1, Phase 2
**Requirements**: OWNR-01
**Success Criteria** (what must be TRUE):

  1. A new business owner can complete full setup (business name, hours, services, prices, shared schedule) entirely through a WhatsApp conversation, replacing the fixture/seed businesses used to test Phases 1-3.
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

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation, Webhook & Business Resolution | 3/4 | In Progress|  |
| 2. AI Booking Conversations & Owner Alerts | 0/5 | Not started | - |
| 3. Calendar Sync, Agenda & Reminders | 0/TBD | Not started | - |
| 4. Owner Self-Serve Onboarding & Multi-Tenancy | 0/TBD | Not started | - |
| 5. Compliance & Production Readiness | 0/TBD | Not started | - |
</content>
</invoke>
