# Requirements: RandevuClaw v1.7

**Defined:** 2026-07-28
**Core Value:** A client can book or cancel an appointment with a Greek business entirely through a chat conversation, in Greek, with zero friction — and the owner's calendar updates automatically.

## v1 Requirements

### Confirmation & Approval Policy (CONF)

- [x] **CONF-01**: Destructive owner actions (delete service, update price, close day, cancel class, assign client) have a uniform Ναι/Όχι confirmation across both the admin menu and free-chat tool paths — no action mutates immediately without confirmation, and the same action confirms consistently regardless of entry path
- [x] **CONF-02**: Client-initiated reschedules require owner approval before confirming, reusing the same approve/reject capacity-hold cascade already used for new session bookings (reverses the v1.6 Phase 22 auto-confirm decision); the client's original booking is not lost if the new slot is rejected

### Admin Discoverability (ADMIN)

- [ ] **ADMIN-01**: The admin's "reply to client" escalation button either relays the owner's next message to the escalating client, or is removed if not being wired this milestone
- [ ] **ADMIN-02**: Decorative inline-keyboard buttons that perform no action (e.g. "Νέο μάθημα (chat)") are removed or wired to a real action
- [ ] **ADMIN-03**: Admin can record a client payment from the `/menu` (currently chat-only, despite being the highest-frequency owner action)
- [ ] **ADMIN-04**: Admin has menu entry points for hours/services/prices/class setup (currently chat-only, despite being high-stakes setup data)
- [ ] **ADMIN-05**: Telegram persistent menu button reliability is investigated (client-side caching, scope semantics, re-registration needs) and any code-addressable gap is fixed or documented as a client-side limitation

### Booking & List Clarity (UX)

- [ ] **UX-01**: Same-day session slots whose start time has already passed no longer show as bookable
- [ ] **UX-02**: Cancel-confirmation prompts (admin lesson-cancel, client booking-cancel) show the date and service/class name, not a raw internal ID
- [ ] **UX-03**: Chat tools that currently require a raw Telegram numeric ID to identify a client (view membership, assign client to session, send renewal reminder) accept a name-based match instead, with disambiguation shown when multiple clients match
- [ ] **UX-04**: Booking and cancellation lists show the service/class name alongside date/time, not date/time alone
- [ ] **UX-05**: The client "Κράτηση μαθήματος" booking button is hidden or relabeled for businesses using open-slot (non-fixed-class) booking mode, instead of silently no-op'ing
- [ ] **UX-06**: An unknown/stale callback tap on either the admin or client menu shows a back-to-menu recovery option instead of a dead-end error

### Compliance & Client Registration (COMP)

- [x] **COMP-01**: Clients who first contact the bot via `/start` (not free-form chat) see the GDPR data-consent notice before any client-business relationship row is created — closing the gap where `/start`-first clients never see it
- [x] **COMP-02**: A genuine client opt-in/registration flag exists on the client-business relationship, distinguishing consenting registered clients from incidental first-contact rows

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Compliance

- **COMP-03**: GDPR data export/deletion flow (carried forward from v1.1, still not scheduled — COMP-02/03/04 from earlier milestones)
- **COMP-04**: Granular per-purpose consent (booking vs. promotional reminders vs. expiry alerts)

### Admin Tools

- **ADMIN-06**: Client roster pagination/search (currently caps at 20 with no way to see more)
- **ADMIN-07**: Proactive "pending slotless requests" view (currently only visible via the arrival-time push notification)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Multi-staff/role-based admin menus | Single-owner-per-business assumption baked into v1.0; revisit at v2.0 if scaling beyond solo operators |
| Fuzzy string-matching library (fuse.js) | Existing case-insensitive substring match (already used for service names since v1.4) is sufficient for UX-03; add only if real false-negatives surface in use |
| GDPR data export/deletion cascade (COMP-02/03/04 from earlier milestones) | Still deferred — v1.7 fixes consent *timing*, not the separate deletion-flow gap; tracked in v2 Requirements above |
| Consolidating two divergent "today's schedule" implementations (menu vs. chat) | Cosmetic/maintenance smell from the UX audit, not user-facing; low priority |
| Raw exception text sent to owner on errors made more owner-friendly | Fine for a solo-dev-operated PoC; revisit before scaling past developer-operated pilots |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONF-01 | Phase 26 | Complete |
| CONF-02 | Phase 26 | Complete |
| COMP-01 | Phase 27 | Complete |
| COMP-02 | Phase 27 | Complete |
| ADMIN-01 | Phase 28 | Pending |
| ADMIN-02 | Phase 28 | Pending |
| ADMIN-03 | Phase 28 | Pending |
| ADMIN-04 | Phase 28 | Pending |
| UX-01 | Phase 29 | Pending |
| UX-02 | Phase 29 | Pending |
| UX-04 | Phase 29 | Pending |
| UX-05 | Phase 29 | Pending |
| UX-06 | Phase 29 | Pending |
| UX-03 | Phase 30 | Pending |
| ADMIN-05 | Phase 30 | Pending |

**Coverage:**

- v1 requirements: 15 total
- Mapped to phases: 15/15 ✓
- Unmapped: 0

---
*Requirements defined: 2026-07-28*
*Last updated: 2026-07-28 after v1.7 roadmap creation (Phases 26-30)*
