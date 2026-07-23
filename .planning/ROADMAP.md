# Roadmap: RandevuClaw

## Milestones

- ✅ **v1.0 MVP** — Phases 1-3 (shipped 2026-07-09)
- ✅ **v1.1 Per-Bot Infrastructure & Owner Onboarding** — Phases 4-5 (shipped 2026-07-17)
- ✅ **v1.2 Billing & Membership System** — Phases 7-9 (shipped 2026-07-22)
- 🚧 **v1.3 Studio Session Scheduling & Slotless Bookings** — Phases 10-15 (active)

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

<details>
<summary>✅ v1.2 Billing & Membership System (Phases 7-9) — SHIPPED 2026-07-22</summary>

- [x] **Phase 7: Billing Configuration & Payment Recording** — Owner defines billing packages and records client payments via chat; the bot creates memberships with rolling expiry windows and an immutable session ledger. (completed 2026-07-21)
- [x] **Phase 8: Enforcement & Session Deduction** — Booking confirmation and cancellation atomically update session balances; the bot enforces per-business membership policies before accepting bookings. (completed 2026-07-21)
- [x] **Phase 9: Expiry Notifications & Client Balance** — The platform sweeps for near-expiry memberships and notifies clients and owners proactively; clients can query their own session balance at any time via chat. (completed 2026-07-22)

See: `.planning/milestones/v1.2-ROADMAP.md`

</details>

### v1.3 Studio Session Scheduling & Slotless Bookings (Phases 10-15)

- [x] **Phase 10: Session Catalog & Schema** - Owner creates, recurs, lists, cancels, and assigns clients to sessions; 3 new tables + 7 business config columns unblock all downstream phases (6 plans) (completed 2026-07-22)
- [x] **Phase 11: Session Booking Flow** - Clients book specific sessions via Greek chat with atomic capacity enforcement and session-credit deduction (completed 2026-07-23)
- [ ] **Phase 12: Cancellation Cutoff Policy** - Per-business opt-in cutoff window enforces credit forfeiture with Greek confirmation before cancellations inside the window
- [ ] **Phase 13: Slotless Booking Requests** - Clients request bookings with no open slot; owner approves or rejects via keyboard; approved requests become real bookings with credit deduction
- [ ] **Phase 14: Renewal Notification Extensions** - Last-session threshold nudge and owner-gated mass renewal broadcast extend the existing expiry notification sweep
- [ ] **Phase 15: Onboarding Extensions** - Onboarding flow asks about each optional v1.3 feature with explicit defaults; all settings remain editable post-onboarding via chat

## Phase Details

### Phase 10: Session Catalog & Schema

**Goal**: Owners can create and manage a fixed-capacity session schedule through chat, and the schema foundation exists for all downstream session, cutoff, slotless, and renewal features
**Depends on**: Phase 9
**Requirements**: CLSS-01, CLSS-02, CLSS-03, CLSS-04, CLSS-05
**Success Criteria** (what must be TRUE):

  1. Owner sends a chat command and a new bookable session (date, time, capacity, service) appears in the database and is listable immediately
  2. Owner creates a recurring weekly session pattern once and the system auto-generates ~90 days of individual instances without further owner action
  3. Owner cancels a single session instance and every client booked into that session receives a Greek notification automatically
  4. Owner assigns a specific named client to a session directly via chat and that client receives a Greek confirmation message
  5. Owner asks to see upcoming sessions and receives a list showing each session's date, time, booked count, and capacity

**Plans**: 6/6 plans complete
Plans:

- [x] 10-01-PLAN.md — Nyquist test stubs (5 session test files) + rrule package install
- [x] 10-02-PLAN.md — Schema migration: 3 new tables + 7 business columns + drizzle-kit push (blocking human checkpoint)
- [x] 10-03-PLAN.md — Session query layer: createSessionCatalogWithExpansion, bookSessionInstance, cancelSession, listSessions
- [x] 10-04-PLAN.md — OWNER_TOOLS: 4 new Gemini tool declarations + executeOwnerTool switch cases
- [x] 10-05-PLAN.md — Session cancellation poller + sessionCancellationNotifications dedup table
- [x] 10-06-PLAN.md — Replace all it.todo stubs with real passing tests (capacity-race, DST, poller dedup)

### Phase 11: Session Booking Flow

**Goal**: Clients can book specific sessions from the catalog via natural-language Greek chat, with capacity enforced atomically and session credits deducted via the existing membership ledger
**Depends on**: Phase 10
**Requirements**: SBOK-01, SBOK-02, SBOK-03, SBOK-04
**Success Criteria** (what must be TRUE):

  1. Client requests a specific session by name or date/time in Greek and the booking succeeds when the session has capacity and the client holds a valid membership
  2. When the last capacity spot is taken by two simultaneous requests, exactly one succeeds and the other receives a "full" rejection — no over-booking possible
  3. Session booking atomically deducts one session credit from the client's membership balance, identical to a standard slot booking
  4. Client attempting to reschedule a session booking to a date past their membership expiry is blocked with a Greek explanation
  5. Client with `allow_multi_booking` enabled for their business can name multiple sessions in a single chat message and all are booked in one exchange

**Plans**: 3/3 plans complete

Plans:

- [x] 11-01-PLAN.md — Extend bookSessionInstance to atomically deduct session credit within same DB transaction (SBOK-02 core fix)
- [x] 11-02-PLAN.md — Client AI tools: book_session, list_sessions_for_client, reschedule_session in BOOKING_TOOLS + function-executor (SBOK-01, SBOK-03, SBOK-04)
- [x] 11-03-PLAN.md — Integration tests: SBOK-01 through SBOK-04 full coverage in session-booking-flow.test.ts

### Phase 12: Cancellation Cutoff Policy

**Goal**: Businesses with the cutoff feature enabled can enforce a configurable time window before which cancellations restore a credit and after which credits are forfeited, with Greek confirmation required from the client before any forfeiture
**Depends on**: Phase 10
**Requirements**: CANC-01, CANC-02, CANC-03, CANC-04, CANC-05
**Success Criteria** (what must be TRUE):

  1. Owner sets a cancellation cutoff (hours and enabled/disabled state) during or after onboarding, and the setting persists and is reflected in all subsequent cancellations
  2. Client cancels a booking more than the configured cutoff hours before the session and their session credit is restored normally — no warning shown
  3. Client cancels a booking within the cutoff window and receives a Greek warning ("Θα χάσετε 1 session") requiring explicit confirmation before the cancellation proceeds without credit restoration
  4. DST boundary dates (Oct 25 2026, Mar 28 2027) do not cause the cutoff calculation to misfire — cancellations remain correctly categorized on those days
  5. Owner can turn the cutoff off at any time and subsequent cancellations immediately revert to always restoring credits

**Plans**: TBD

### Phase 13: Slotless Booking Requests

**Goal**: Clients of businesses with slotless requests enabled can request an appointment even when no open slot exists; the owner approves or rejects via keyboard; approved requests become real bookings with an auditable history per client
**Depends on**: Phase 10
**Requirements**: SLOT-01, SLOT-02, SLOT-03, SLOT-04, SLOT-05, SLOT-06
**Success Criteria** (what must be TRUE):

  1. Client sends a booking request when `slotless_requests_enabled` is on and no slot is available; the owner immediately receives a Greek notification with the client's name, requested time, and membership status alongside a Ναι/Όχι keyboard
  2. Owner taps Ναι and the request becomes a confirmed booking that deducts one session credit; if the client's membership lapsed between request and approval the approval is blocked with an error message to the owner
  3. Owner taps Όχι and the client receives a Greek rejection message; the request is recorded as rejected
  4. Every request — pending, approved, or rejected — is persisted in the database with its outcome, regardless of the approval decision
  5. Owner asks for a client's slotless request history via chat and receives a count and chronological list of all requests for that client
  6. When a client books their next appointment, the owner sees how many slotless requests that client has made since their last check-in, surfaced automatically in the booking alert

**Plans**: TBD

### Phase 14: Renewal Notification Extensions

**Goal**: Businesses with the last-session threshold feature enabled send clients a session-count-based renewal nudge in addition to the existing date-based expiry reminder; owners can trigger renewal messages to individual clients on demand and must approve any mass broadcast before it sends
**Depends on**: Phase 9
**Requirements**: RENW-01, RENW-02, RENW-03, RENW-04, RENW-05
**Success Criteria** (what must be TRUE):

  1. When a client's remaining sessions drop to or below the configured threshold, the client receives a Greek renewal nudge automatically — distinct from and in addition to the 7-day date-based expiry reminder
  2. The renewal sweep surfaces near-expiry clients to the owner as a named list and waits for explicit owner approval before sending any renewal reminders — no broadcast fires without owner action
  3. Owner approves the sweep list and renewal messages go only to the clients the owner confirmed; unapproved clients receive nothing
  4. Owner types a chat command naming one specific client and that client receives a renewal reminder immediately without any additional approval step
  5. Owner can change the threshold count or disable the feature at any time and the sweep immediately reflects the new setting on its next run

**Plans**: TBD

### Phase 15: Onboarding Extensions

**Goal**: New owners are asked about each optional v1.3 feature with clear defaults and explicit skip options during onboarding; all feature settings remain changeable after onboarding via chat; switching booking mode warns the owner if session bookings already exist
**Depends on**: Phase 10, Phase 12, Phase 13, Phase 14
**Requirements**: CONF-01, CONF-02, CONF-03, CONF-04, CONF-05, CONF-06
**Success Criteria** (what must be TRUE):

  1. New owner completing onboarding is asked whether to enable class-schedule mode, cancellation cutoff, slotless requests, and last-session threshold — each question has an explicit default stated and an explicit skip path
  2. Owner who skips all optional questions during onboarding gets the same defaults as before v1.3 — no feature silently activates
  3. Owner types a post-onboarding config update message and can change cancellation cutoff hours, last-session threshold count, and slotless requests enabled/disabled without repeating the full onboarding flow
  4. Owner attempts to switch booking mode from `open_slots` to `fixed_sessions` (or vice versa) when existing session bookings exist and receives a Greek warning listing the impact before the switch proceeds
  5. Owner switches booking mode with no existing session bookings and the switch completes immediately with a Greek confirmation

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
| 7. Billing Configuration & Payment Recording | v1.2 | 7/7 | Complete | 2026-07-21 |
| 8. Enforcement & Session Deduction | v1.2 | 6/6 | Complete | 2026-07-21 |
| 9. Expiry Notifications & Client Balance | v1.2 | 3/3 | Complete | 2026-07-22 |
| 10. Session Catalog & Schema | v1.3 | 6/6 | Complete   | 2026-07-22 |
| 11. Session Booking Flow | v1.3 | 3/3 | Complete   | 2026-07-23 |
| 12. Cancellation Cutoff Policy | v1.3 | 0/TBD | Not started | - |
| 13. Slotless Booking Requests | v1.3 | 0/TBD | Not started | - |
| 14. Renewal Notification Extensions | v1.3 | 0/TBD | Not started | - |
| 15. Onboarding Extensions | v1.3 | 0/TBD | Not started | - |
