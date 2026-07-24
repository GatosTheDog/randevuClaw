# Roadmap: RandevuClaw

## Milestones

- ✅ **v1.0 MVP** — Phases 1-3 (shipped 2026-07-09)
- ✅ **v1.1 Per-Bot Infrastructure & Owner Onboarding** — Phases 4-5 (shipped 2026-07-17)
- ✅ **v1.2 Billing & Membership System** — Phases 7-9 (shipped 2026-07-22)
- ✅ **v1.3 Studio Session Scheduling & Slotless Bookings** — Phases 10-15 (shipped 2026-07-23)
- 🚧 **v1.4 Single-Bot UX Overhaul** — Phases 16-20 (active)

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

<details>
<summary>✅ v1.3 Studio Session Scheduling & Slotless Bookings (Phases 10-15) — SHIPPED 2026-07-23</summary>

- [x] **Phase 10: Session Catalog & Schema** - Owner creates, recurs, lists, cancels, and assigns clients to sessions; 3 new tables + 7 business config columns unblock all downstream phases (completed 2026-07-22)
- [x] **Phase 11: Session Booking Flow** - Clients book specific sessions via Greek chat with atomic capacity enforcement and session-credit deduction (completed 2026-07-23)
- [x] **Phase 12: Cancellation Cutoff Policy** - Per-business opt-in cutoff window enforces credit forfeiture with Greek confirmation before cancellations inside the window (completed 2026-07-23)
- [x] **Phase 13: Slotless Booking Requests** - Clients request bookings with no open slot; owner approves or rejects via keyboard; approved requests become real bookings with credit deduction (completed 2026-07-23)
- [ ] **Phase 14: Renewal Notification Extensions** - Last-session threshold nudge and owner-gated mass renewal broadcast extend the existing expiry notification sweep
- [ ] **Phase 15: Onboarding Extensions** - Onboarding flow asks about each optional v1.3 feature with explicit defaults; all settings remain editable post-onboarding via chat

</details>

### v1.4 Single-Bot UX Overhaul (Phases 16-20)

- [x] **Phase 16: Single-Bot Architecture** - Platform bot deleted; business bot routes admin vs client by Telegram ID match; onboarding auto-starts when unfinished admin messages their bot

Plans:

- [x] 16-01-PLAN.md — Remove platform bot code/config + add onboarding_completed schema column with migration backfill
- [x] 16-02-PLAN.md — Extend handleFoundBusiness with onboarding routing; terminal step sets flag
- [x] 16-03-PLAN.md — Integration tests for all four Phase 16 routing paths + full suite green
- [x] **Phase 17: Admin Menu** - `/menu` command shows Settings/Classes/Clients/Today sub-menus; all binary admin decisions use yes/no inline keyboard buttons (completed 2026-07-23)

Plans:

- [x] 17-01-PLAN.md — /menu pre-emption + MenuCallbackResult union + showAdminRootMenu scaffold + formatAgendaMessage export
- [x] 17-02-PLAN.md — Settings sub-menu (read-only display + binary toggles) + Today's Agenda on-demand (AMENU-02, AMENU-05)
- [x] 17-03-PLAN.md — Classes sub-menu: list, cancel with Ναι/Όχι confirmation, create-via-chat redirect (AMENU-03)
- [x] 17-04-PLAN.md — Clients sub-menu: list, balance, renewal nudge + integration tests (AMENU-04)
- [x] **Phase 18: Client Menu** - `/start` welcome menu with Book/My Bookings/Cancel/Balance inline flows; free Greek chat remains available at all times (completed 2026-07-24)

Plans:

- [x] 18-01-PLAN.md — /start pre-emption + ClientMenuCallbackResult union + showClientRootMenu + handleCallbackQuery business threading (CMENU-01, CMENU-05)
- [x] 18-02-PLAN.md — Book a class flow: session list → Ναι/Όχι confirm → bookSessionInstance with enforcement gate (CMENU-02, CMENU-04)
- [x] 18-03-PLAN.md — My Bookings display + Cancel flow with cutoff + credit restore + Balance display (CMENU-03, CMENU-04)
- [x] 18-04-PLAN.md — Integration tests: /start intercept, CMENU-05 free-text, parseCallbackData union, booking/cancel/ownership/cutoff coverage
- [x] **Phase 19: Class Setup in Onboarding & Terminology Fix** - Onboarding class schedule step with recurrence and capacity; σεζόν replaced with μάθημα across all bot messages and copy (completed 2026-07-24)
- [x] **Phase 20: Client Escalation** - Blocked client triggers Greek apology + admin notification with context and inline reply option (completed 2026-07-24)

## Phase Details

### Phase 16: Single-Bot Architecture

**Goal**: Admin and clients reach a single business bot; the platform bot no longer exists; routing is clean and identity requires no passwords
**Depends on**: Phase 15
**Requirements**: ARCH-01, ARCH-02, ARCH-03, ARCH-04, AUTH-01, AUTH-02, AUTH-03
**Success Criteria** (what must be TRUE):

  1. Messaging the platform bot produces no response — it has been deregistered and removed; the business bot is the only entry point
  2. Owner messages their business bot; the bot immediately recognises them as admin without asking for a password or PIN
  3. Owner messages their business bot before onboarding is complete and the onboarding flow starts automatically without any manual trigger
  4. A new client messages the business bot for the first time and is auto-created in the DB; their identity persists across restarts with no re-authentication prompt
  5. Both admin and client can close and reopen Telegram, return days later, and the bot recognises them immediately with no session expiry message

**Plans**: TBD

### Phase 17: Admin Menu

**Goal**: Admin has a structured, keyboard-driven interface for all management tasks accessible from a single `/menu` command
**Depends on**: Phase 16
**Requirements**: AMENU-01, AMENU-02, AMENU-03, AMENU-04, AMENU-05, AMENU-06
**Success Criteria** (what must be TRUE):

  1. Admin types `/menu` and receives an inline keyboard with four buttons: Settings, Classes, Clients, Today's Agenda
  2. Admin taps Settings and can update business hours, services, prices, cancellation cutoff, slotless toggle, booking mode, and threshold — all from the same sub-menu
  3. Admin taps Classes and sees upcoming classes; can create a new recurring class or cancel an existing class or series from the same sub-menu
  4. Admin taps Clients and sees a client list; can select a client to view their membership status, session balance, and trigger a renewal nudge
  5. Admin taps Today's Agenda and sees the same class and booking summary that the daily 8am push sends, available on demand at any time
  6. Every binary decision (approve booking, reject slotless, confirm class creation) presents Ναι/Όχι inline buttons — no ambiguous free-text confirmation required

**Plans**: 4/4 plans complete

- [x] 17-01-PLAN.md — /menu pre-emption + MenuCallbackResult union + showAdminRootMenu scaffold + formatAgendaMessage export
- [x] 17-02-PLAN.md — Settings sub-menu (read-only display + binary toggles) + Today's Agenda on-demand (AMENU-02, AMENU-05)
- [x] 17-03-PLAN.md — Classes sub-menu: list, cancel with Ναι/Όχι confirmation, create-via-chat redirect (AMENU-03)
- [x] 17-04-PLAN.md — Clients sub-menu: list, balance, renewal nudge + integration tests (AMENU-04)

**UI hint**: yes

### Phase 18: Client Menu

**Goal**: Clients have a structured entry point via `/start` with inline flows for booking, cancellations, and balance, while retaining free Greek chat at all times
**Depends on**: Phase 16
**Requirements**: CMENU-01, CMENU-02, CMENU-03, CMENU-04, CMENU-05
**Success Criteria** (what must be TRUE):

  1. Client types `/start` and receives an inline keyboard with four options: Book a class, My bookings, Cancel booking, My balance
  2. Client taps Book a class and sees available classes as inline date → class → slot buttons, completing a booking without typing anything
  3. Client taps Cancel booking and sees their active bookings as inline buttons; selecting one cancels it without requiring free-text input
  4. Any binary confirmation (confirm booking, confirm cancellation) shows Ναι/Όχι inline buttons — no free-text confirmation prompt
  5. Client ignores the menu and types a Greek sentence instead; the AI agent interprets it and routes to the correct flow without error

**Plans**: 3/4 plans executed

- [x] 18-01-PLAN.md — /start pre-emption + ClientMenuCallbackResult union + showClientRootMenu + handleCallbackQuery business threading (CMENU-01, CMENU-05)
- [x] 18-02-PLAN.md — Book a class flow: session list → Ναι/Όχι confirm → bookSessionInstance with enforcement gate (CMENU-02, CMENU-04)
- [ ] 18-03-PLAN.md — My Bookings display + Cancel flow with cutoff + credit restore + Balance display (CMENU-03, CMENU-04)
- [ ] 18-04-PLAN.md — Integration tests: /start intercept, CMENU-05 free-text, parseCallbackData union, booking/cancel/ownership/cutoff coverage

**UI hint**: yes

### Phase 19: Class Setup in Onboarding & Terminology Fix

**Goal**: New owners configure their recurring class schedule during onboarding; all bot copy uses μάθημα instead of σεζόν consistently
**Depends on**: Phase 16
**Requirements**: CLSS-01, CLSS-02, CLSS-03, CLSS-04, CLSS-05, I18N-01, I18N-02, I18N-03
**Success Criteria** (what must be TRUE):

  1. New owner completing onboarding reaches a class schedule step, defines recurring classes (e.g. weekday Pilates 9-10 with 4 slots), and those sessions appear in the DB before onboarding ends
  2. Owner specifies daily, specific-weekday, or monthly recurrence and the system expands the correct set of session instances across the next 90 days
  3. Owner skips class setup during onboarding using an explicit skip option, and no sessions are created — the owner can create them later via the admin menu
  4. Post-onboarding, owner creates a new recurring class series from the admin menu (AMENU-03 flow) and it is fully equivalent to what onboarding would have created
  5. Every bot message, onboarding prompt, and user-visible label uses μάθημα or τάξη — no occurrence of σεζόν remains in any Greek-facing text path

**Plans**: 3/3 plans complete

Plans:

- [x] 19-01-PLAN.md — class_setup_* step handlers in steps.ts + dispatchOnboardingStep wiring in router.ts (CLSS-01, CLSS-02, CLSS-03, CLSS-04)
- [x] 19-02-PLAN.md — Replace σεζόν with μάθημα/μαθήματα in ai-agent.ts, function-executor.ts, ai-owner-agent.ts, session-cancellation.ts (I18N-01, I18N-02, I18N-03, CLSS-05 note)
- [x] 19-03-PLAN.md — Unit tests for class setup step handlers: 14 cases covering skip, happy path, weekday parsing, invalid inputs (CLSS-01–05)

### Phase 20: Client Escalation

**Goal**: When a client is blocked, they receive a graceful Greek message and the admin is immediately notified with enough context to act inline
**Depends on**: Phase 16
**Requirements**: ESCL-01, ESCL-02, ESCL-03
**Success Criteria** (what must be TRUE):

  1. Client attempts to book a full class or book with an expired membership and receives a Greek message ("Επικοινωνούμε με τον διαχειριστή") — no raw error or silence
  2. Admin receives an escalation notification containing the client's name, what they tried to do, and the specific reason it failed (class full / membership expired / slotless disabled)
  3. Admin can tap an inline button on the escalation message to approve an exception or send a reply directly to the client — without leaving the bot chat

**Plans**: 1/2 plans executed

Plans:

- [x] 20-01-PLAN.md — Escalation engine (sendEscalationToAdmin + EscalationReason) + wire into handleBookSessionExecute enforcement and full-capacity blocks (ESCL-01, ESCL-02)
- [x] 20-02-PLAN.md — EscalationCallbackResult type + parseCallbackData escl: arm + approve-exception and reply-prompt handlers in handleCallbackQuery + integration tests (ESCL-03)

**Note:** ESCL-03 is partially satisfied — the "approve exception" button works fully; the "reply to client" button only prompts the admin, no relay wired yet. Deferred to backlog (see below), accepted by user 2026-07-24.

## Backlog

### Phase 999.1: Follow-up — Admin reply relay to escalating client (ESCL-03 completion)

**Goal:** Wire the admin's "Απάντηση πελάτη" reply into an actual message delivered to the escalating client
**Source phase:** 20 (Client Escalation)
**Deferred at:** 2026-07-24 — accepted deferral after phase 20 verification (see `.planning/phases/20-client-escalation/20-VERIFICATION.md`)
**Scope:**
- [ ] Track pending reply target (e.g. `pendingReplyTarget: Map<ownerTelegramId, clientTelegramId>`) when admin taps "Απάντηση πελάτη"
- [ ] Intercept the admin's next free-text message in `handleFoundBusiness` before it reaches `aiOwnerAgent`, forward it to `escl.clientTelegramId` instead
- [ ] Tests for the full reply flow (admin sends message → client receives it)
- Likely depends on/overlaps with CMENU-05 free-text routing work

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
| 10. Session Catalog & Schema | v1.3 | 6/6 | Complete | 2026-07-22 |
| 11. Session Booking Flow | v1.3 | 3/3 | Complete | 2026-07-23 |
| 12. Cancellation Cutoff Policy | v1.3 | 3/3 | Complete | 2026-07-23 |
| 13. Slotless Booking Requests | v1.3 | 3/3 | Complete | 2026-07-23 |
| 14. Renewal Notification Extensions | v1.3 | 3/3 | Complete | 2026-07-23 |
| 15. Onboarding Extensions | v1.3 | 2/2 | Complete | 2026-07-23 |
| 16. Single-Bot Architecture | v1.4 | 3/3 | Complete | 2026-07-23 |
| 17. Admin Menu | v1.4 | 4/4 | Complete   | 2026-07-23 |
| 18. Client Menu | v1.4 | 4/4 | Complete | 2026-07-24 |
| 19. Class Setup in Onboarding & Terminology Fix | v1.4 | 3/3 | Complete   | 2026-07-24 |
| 20. Client Escalation | v1.4 | 2/2 | Complete    | 2026-07-24 |
