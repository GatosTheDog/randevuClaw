# Requirements: v1.4 Single-Bot UX Overhaul

**Milestone:** v1.4
**Status:** Active
**Created:** 2026-07-23
**Depends on:** v1.3 Studio Session Scheduling & Slotless Bookings (Phases 10–15 complete)

---

## v1 Requirements

### ARCH — Single-Bot Architecture

- [ ] **ARCH-01**: Platform bot is deleted; business bot is the only bot per business and handles all traffic (admin + client)
- [x] **ARCH-02**: Business bot detects admin by matching sender Telegram ID to `businesses.owner_telegram_id`; no password required
- [x] **ARCH-03**: If admin messages their business bot and onboarding is not complete, bot starts the onboarding flow automatically
- [ ] **ARCH-04**: Client is identified solely by Telegram user ID; no password or PIN required; identity persists across sessions by Telegram account

### AUTH — Identity & Session Persistence

- [x] **AUTH-01**: Admin recognition is implicit (Telegram ID match); bot never asks admin for a password or PIN
- [x] **AUTH-02**: Client recognition is implicit (Telegram ID); clients are auto-created in the DB on first contact
- [x] **AUTH-03**: Both admin and client sessions persist indefinitely by Telegram identity; no re-authentication required

### AMENU — Admin Menu

- [ ] **AMENU-01**: Admin can access a persistent menu via `/menu` command showing top-level options: Settings, Classes, Clients, Today's Agenda
- [ ] **AMENU-02**: From Settings, admin can update business hours, services, prices, and all per-business toggles (cutoff, slotless, booking mode, threshold)
- [x] **AMENU-03**: From Classes, admin can view upcoming classes, create a new recurring class, and cancel a class or series
- [x] **AMENU-04**: From Clients, admin can view client list, view individual membership and session balance, and send renewal nudge
- [ ] **AMENU-05**: From Today's Agenda, admin sees today's classes and bookings inline (same info as daily agenda push, on-demand)
- [x] **AMENU-06**: All binary admin decisions (approve booking, reject slotless request, confirm class creation) show yes/no inline keyboard buttons

### CMENU — Client Menu

- [x] **CMENU-01**: Client sees a welcome menu on `/start` with options: Book a class, My bookings, Cancel booking, My balance
- [ ] **CMENU-02**: Client booking flow shows available classes as inline buttons (date → class → slot selection)
- [ ] **CMENU-03**: Client cancellation flow shows active bookings as inline buttons to cancel
- [ ] **CMENU-04**: All binary client decisions (confirm booking, confirm cancellation) show yes/no inline keyboard buttons
- [ ] **CMENU-05**: Client can type freely in Greek at any point; AI agent interprets and routes to the right flow

### CLSS — Class Schedule Setup in Onboarding

- [x] **CLSS-01**: Onboarding includes a class schedule step where admin defines recurring classes (e.g., "Pilates Reformer weekdays 9-10, 10-11, 17-18 with 4 slots each")
- [x] **CLSS-02**: Admin can specify recurrence as: daily, specific weekdays (Mon/Wed/Fri etc.), or monthly
- [x] **CLSS-03**: Each class slot has a configurable capacity (number of clients that can book)
- [x] **CLSS-04**: Admin can skip class setup during onboarding and set up classes later via the admin menu
- [x] **CLSS-05**: Post-onboarding, admin can create new recurring class series from the admin menu

### I18N — Greek Terminology

- [x] **I18N-01**: All bot messages replace "σεζόν" with "μάθημα" (class/lesson) in every Greek-facing text
- [x] **I18N-02**: DB enum/label values for session-related concepts updated where user-facing (display strings, not column names)
- [x] **I18N-03**: Onboarding copy uses "μάθημα" / "τάξη" consistently; no mixed terminology

### ESCL — Client Escalation to Admin

- [ ] **ESCL-01**: When a client request fails (class full, membership expired, slotless requests disabled), bot responds in Greek: "Επικοινωνούμε με τον διαχειριστή" and sends a notification to the admin
- [ ] **ESCL-02**: Admin escalation message includes: client name, what they tried to do, and the reason it failed
- [ ] **ESCL-03**: Admin can reply to the escalation inline (e.g., approve an exception, send a message to the client)

---

## Future Requirements (Deferred)

- Multi-staff calendars per business — PoC scope is one shared schedule
- Client-facing web booking page — chat-only for PoC
- WhatsApp migration — blocked on Meta Business Verification
- GDPR deletion flows (COMP-02/03/04) — deferred from v1.1

---

## Out of Scope

- Password or PIN authentication for admin or client — Telegram identity is sufficient for PoC
- Client self-registration outside Telegram — Telegram account IS the identity
- Multiple bots per business (e.g., one for admin, one for clients) — single bot per business

---

## Traceability

| REQ-ID | Phase | Plan | Status |
|--------|-------|------|--------|
| ARCH-01 | Phase 16 | TBD | Pending |
| ARCH-02 | Phase 16 | 16-02 | Complete |
| ARCH-03 | Phase 16 | 16-02 | Complete |
| ARCH-04 | Phase 16 | TBD | Pending |
| AUTH-01 | Phase 16 | 16-02 | Complete |
| AUTH-02 | Phase 16 | 16-02 | Complete |
| AUTH-03 | Phase 16 | 16-02 | Complete |
| AMENU-01 | Phase 17 | TBD | Pending |
| AMENU-02 | Phase 17 | TBD | Pending |
| AMENU-03 | Phase 17 | TBD | Pending |
| AMENU-04 | Phase 17 | TBD | Pending |
| AMENU-05 | Phase 17 | TBD | Pending |
| AMENU-06 | Phase 17 | TBD | Pending |
| CMENU-01 | Phase 18 | TBD | Pending |
| CMENU-02 | Phase 18 | TBD | Pending |
| CMENU-03 | Phase 18 | TBD | Pending |
| CMENU-04 | Phase 18 | TBD | Pending |
| CMENU-05 | Phase 18 | TBD | Pending |
| CLSS-01 | Phase 19 | TBD | Pending |
| CLSS-02 | Phase 19 | TBD | Pending |
| CLSS-03 | Phase 19 | TBD | Pending |
| CLSS-04 | Phase 19 | TBD | Pending |
| CLSS-05 | Phase 19 | TBD | Pending |
| I18N-01 | Phase 19 | TBD | Pending |
| I18N-02 | Phase 19 | TBD | Pending |
| I18N-03 | Phase 19 | TBD | Pending |
| ESCL-01 | Phase 20 | TBD | Pending |
| ESCL-02 | Phase 20 | TBD | Pending |
| ESCL-03 | Phase 20 | TBD | Pending |
