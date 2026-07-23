# Requirements: v1.3 Studio Session Scheduling & Slotless Bookings

**Milestone:** v1.3
**Status:** Active
**Created:** 2026-07-22
**Depends on:** v1.2 Billing & Membership System (Phases 7–9 complete)

---

## v1 Requirements

### CLSS — Session Catalog & Admin Scheduling

- [x] **CLSS-01**: Owner creates a bookable session (date, time, capacity, service) via chat
- [x] **CLSS-02**: Owner creates recurring sessions (weekly day/time pattern) in one chat action; system auto-generates instances ~90 days forward
- [x] **CLSS-03**: Owner cancels an individual session; every booked client is notified automatically in Greek
- [x] **CLSS-04**: Owner assigns a specific client directly to a session; that client is notified in Greek
- [x] **CLSS-05**: Owner lists upcoming sessions with booked count and capacity via chat

### SBOK — Session Booking Flow

- [x] **SBOK-01**: Client books a specific session by name/date via Greek chat; capacity enforced as hard cap (block when full)
- [x] **SBOK-02**: Session booking atomically deducts 1 session credit via existing membership ledger
- [x] **SBOK-03**: Client reschedule validates against membership expiry window; cannot move past expiry (always enforced, not optional)
- [x] **SBOK-04**: Client can book multiple sessions in a single request when `allow_multi_booking` is enabled for that business

### CANC — Cancellation Cutoff Policy

- [ ] **CANC-01**: Owner sets cancellation cutoff (hours before session) during onboarding; default 8 hours; explicit enable/disable switch (not just a number)
- [ ] **CANC-02**: Owner can change or turn off the cutoff anytime via chat
- [ ] **CANC-03**: When cutoff enabled and client cancels ≥ cutoff hours before session, credit is restored normally
- [ ] **CANC-04**: When cutoff enabled and client cancels < cutoff hours before session, credit is forfeited
- [ ] **CANC-05**: Bot warns client in Greek before any cancellation that would forfeit a credit and requires explicit confirmation before proceeding

### SLOT — Slotless Booking Requests

- [ ] **SLOT-01**: When `slotless_requests_enabled`, client can request a booking with no open slot; request routes to owner for approval
- [ ] **SLOT-02**: Owner receives slotless request notification in Greek with client details (name, membership status); approves or rejects via Ναι/Όχι keyboard
- [ ] **SLOT-03**: Approved slotless request becomes a real booking and deducts 1 session credit; membership validity re-checked inside the approval transaction
- [ ] **SLOT-04**: Every slotless request is recorded per client regardless of outcome (approved, rejected, or pending)
- [ ] **SLOT-05**: Owner can search/list a client's slotless request history and count via chat
- [ ] **SLOT-06**: At a client's next booking, owner is automatically shown that client's slotless-request count since the last check-in

### RENW — Renewal Notification Extensions

- [ ] **RENW-01**: Owner sets a "last-session" reminder threshold (sessions remaining that triggers a nudge) during onboarding; default 1; explicit enable/disable switch
- [ ] **RENW-02**: Owner can change or turn off the threshold anytime via chat
- [ ] **RENW-03**: When threshold enabled, client is notified in Greek when remaining sessions hit the threshold (in addition to existing date-based expiry reminder)
- [ ] **RENW-04**: When sweep finds near-expiry clients (days_to_expiry ≤ 7 OR sessions_remaining ≤ threshold), owner receives a Greek message listing them by name and is asked who to notify (all, some, or none); no renewal reminders sent until owner approves
- [ ] **RENW-05**: Owner can trigger a renewal reminder to one named client on demand via chat (no additional approval step)

### CONF — Business Configuration & Onboarding Extensions

- [ ] **CONF-01**: Onboarding asks whether to enable class-schedule booking mode (`booking_mode: fixed_sessions`), with clear default (`open_slots`) and explicit skip option
- [ ] **CONF-02**: Onboarding asks whether to enable cancellation cutoff and how many hours (default 8); explicit skip/disable option; never silently defaults to cutoff-on
- [ ] **CONF-03**: Onboarding asks whether to enable slotless booking requests; default off; explicit skip option
- [ ] **CONF-04**: Onboarding asks whether to enable last-session threshold nudge and at how many sessions (default 1); explicit skip/disable option
- [ ] **CONF-05**: `booking_mode` is changeable post-onboarding; bot warns owner in Greek if existing session bookings are present before switching
- [ ] **CONF-06**: Cancellation cutoff hours and last-session threshold count are editable via the same "update config" chat entry point as hours/services

---

## Future Requirements

| Requirement | Category | Reason Deferred |
|-------------|----------|-----------------|
| Waitlist with auto-promote on cancellation | CLSS | Adds state complexity; defer to v1.4 |
| Per-instructor / per-room scheduling | CLSS | Out of PoC scope |
| Recurrence patterns beyond weekly (bi-weekly, monthly) | CLSS | rrule supports it; no clear PoC need |
| Buffer/advance booking limits | SBOK | Useful, lower priority |
| Session-level pricing overrides | SBOK | Future revenue lever |
| Renewal opt-out per client | RENW | Per-client setting in clientBusinessRelationships; defer |
| `allow_multi_booking` onboarding question | CONF | Feature exists (SBOK-04) but enabled via update config only, not onboarding |

---

## Out of Scope

| Item | Reason |
|------|--------|
| Per-session waitlists / auto-promote | Adds state machine complexity without clear PoC value |
| Per-instructor / per-room scheduling | PoC assumes one shared schedule per business |
| Recurrence patterns beyond weekly | Weekly-only chosen for MVP (user confirmed 2026-07-22) |
| Soft capacity cap (allow overbooking) | Hard cap chosen (user confirmed 2026-07-22) |
| Slotless booking outside membership ledger | Approved slotless consumes session credit via existing ledger (user confirmed 2026-07-22) |
| Mass renewal broadcast without owner approval | Owner must approve before any notification sent (user confirmed 2026-07-22) |
| booking_mode locked at onboarding | Changeable with warning (user confirmed 2026-07-22) |

---

## Locked Decisions (resolved 2026-07-22)

| Question | Decision |
|----------|----------|
| Recurring pattern scope | Weekly-by-weekday only |
| Session capacity semantics | Hard cap — block at capacity |
| Slotless credit handling | Consumes session credit via existing membership ledger |
| Mass broadcast target | Near-expiry only (days_to_expiry ≤ 7 OR sessions_remaining ≤ threshold) |
| Mass broadcast gating | Owner reviews and approves list before any send |
| booking_mode changeability | Changeable post-onboarding; warn if session bookings exist |

---

## Traceability

| Requirement | Phase | Plan |
|-------------|-------|------|
| CLSS-01 | Phase 10 | TBD |
| CLSS-02 | Phase 10 | TBD |
| CLSS-03 | Phase 10 | TBD |
| CLSS-04 | Phase 10 | TBD |
| CLSS-05 | Phase 10 | TBD |
| SBOK-01 | Phase 11 | TBD |
| SBOK-02 | Phase 11 | TBD |
| SBOK-03 | Phase 11 | TBD |
| SBOK-04 | Phase 11 | TBD |
| CANC-01 | Phase 12 | TBD |
| CANC-02 | Phase 12 | TBD |
| CANC-03 | Phase 12 | TBD |
| CANC-04 | Phase 12 | TBD |
| CANC-05 | Phase 12 | TBD |
| SLOT-01 | Phase 13 | TBD |
| SLOT-02 | Phase 13 | TBD |
| SLOT-03 | Phase 13 | TBD |
| SLOT-04 | Phase 13 | TBD |
| SLOT-05 | Phase 13 | TBD |
| SLOT-06 | Phase 13 | TBD |
| RENW-01 | Phase 14 | TBD |
| RENW-02 | Phase 14 | TBD |
| RENW-03 | Phase 14 | TBD |
| RENW-04 | Phase 14 | TBD |
| RENW-05 | Phase 14 | TBD |
| CONF-01 | Phase 15 | TBD |
| CONF-02 | Phase 15 | TBD |
| CONF-03 | Phase 15 | TBD |
| CONF-04 | Phase 15 | TBD |
| CONF-05 | Phase 15 | TBD |
| CONF-06 | Phase 15 | TBD |
