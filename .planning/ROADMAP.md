# Roadmap: RandevuClaw

## Milestones

- ✅ **v1.0 MVP** — Phases 1-3 (shipped 2026-07-09)
- ✅ **v1.1 Per-Bot Infrastructure & Owner Onboarding** — Phases 4-5 (shipped 2026-07-17)
- ✅ **v1.2 Billing & Membership System** — Phases 7-9 (shipped 2026-07-22)
- ✅ **v1.3 Studio Session Scheduling & Slotless Bookings** — Phases 10-15 (shipped 2026-07-23)
- ✅ **v1.4 Single-Bot UX Overhaul** — Phases 16-20 (shipped 2026-07-24)
- ✅ **v1.5 AI-Driven Owner Onboarding** — Phase 21 (shipped 2026-07-25)
- ✅ **v1.6 Telegram Bot UX/Ops Improvements** — Phases 22-25 (shipped 2026-07-28)
- 🚧 **v1.7 UX & Trust Polish** — Phases 26-30 (in progress)

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
- [x] **Phase 14: Renewal Notification Extensions** - Last-session threshold nudge and owner-gated mass renewal broadcast extend the existing expiry notification sweep (completed 2026-07-23)
- [x] **Phase 15: Onboarding Extensions** - Onboarding flow asks about each optional v1.3 feature with explicit defaults; all settings remain editable post-onboarding via chat (completed 2026-07-23)

See: `.planning/milestones/v1.3-ROADMAP.md`

</details>

<details>
<summary>✅ v1.4 Single-Bot UX Overhaul (Phases 16-20) — SHIPPED 2026-07-24</summary>

- [x] **Phase 16: Single-Bot Architecture** — Platform bot deleted; business bot routes admin vs client by Telegram ID match; onboarding auto-starts when unfinished admin messages their bot (completed 2026-07-24)
- [x] **Phase 17: Admin Menu** — `/menu` command shows Settings/Classes/Clients/Today sub-menus; all binary admin decisions use yes/no inline keyboard buttons (completed 2026-07-24)
- [x] **Phase 18: Client Menu** — `/start` welcome menu with Book/My Bookings/Cancel/Balance inline flows; free Greek chat remains available at all times (completed 2026-07-24)
- [x] **Phase 19: Class Setup in Onboarding & Terminology Fix** — Onboarding class schedule step with recurrence and capacity; σεζόν replaced with μάθημα across all bot messages and copy (completed 2026-07-24)
- [x] **Phase 20: Client Escalation** — Blocked client triggers Greek apology + admin notification with context and inline reply option (completed 2026-07-24; ESCL-03 reply-relay partial, see Backlog 999.1)

See: `.planning/milestones/v1.4-ROADMAP.md`

</details>

<details>
<summary>✅ v1.5 AI-Driven Owner Onboarding (Phase 21) — SHIPPED 2026-07-25</summary>

- [x] **Phase 21: AI-Driven Owner Onboarding** — Replaced the deterministic step-machine onboarding flow with a Gemini tool-calling agent; owners can now answer multiple onboarding fields in one free-text Greek message, and stateless DB-derived resume replaces session-step tracking. (completed 2026-07-25)

See: `.planning/milestones/v1.5-ROADMAP.md`

</details>

<details>
<summary>✅ v1.6 Telegram Bot UX/Ops Improvements (Phases 22-25) — SHIPPED 2026-07-28</summary>

- [x] **Phase 22: Session Booking Approval Flow** — Session-class bookings go through owner approve/reject instead of auto-confirming, with capacity soft-held during the pending window (completed 2026-07-27)
- [x] **Phase 23: Lesson Deletion & Cascade Cancellation** — Admin can delete a scheduled lesson; any active bookings on it are cancelled with credit/capacity restored and clients notified (completed 2026-07-27)
- [x] **Phase 24: Bot Access & Diagnostics Polish** — Persistent Telegram menu button for one-tap menu access, plus an owner-facing technical follow-up when the bot's generic fallback fires (completed 2026-07-27)
- [x] **Phase 25: Client Invite Generator** — Owner requests an invite and gets one message with a printable QR code and a copyable `t.me/<bot_username>` deep link (completed 2026-07-27, human-verified 2026-07-28)

See: `.planning/milestones/v1.6-ROADMAP.md`

</details>

### 🚧 v1.7 UX & Trust Polish (Phases 26-30, in progress)

**Milestone Goal:** Close UX/trust gaps surfaced by a full-bot audit — fix broken/inconsistent owner tooling, make high-frequency actions discoverable, close a real compliance hole, and give clients a genuine opt-in path.

- [x] **Phase 26: Confirmation & Approval Policy** - Uniform Ναι/Όχι confirmation on every destructive owner action, and client reschedules now require owner approval like new bookings (completed 2026-07-28)
- [x] **Phase 27: Client Consent & Registration** - GDPR consent notice shown before any client relationship row is created, with a real opt-in flag distinguishing registered clients (completed 2026-07-28)
- [ ] **Phase 28: Admin Menu Discoverability** - Payment recording, setup editing, and escalation reply are all reachable from `/menu`; dead decorative buttons removed
- [ ] **Phase 29: Booking & List Clarity** - Slots, cancel prompts, and booking lists show accurate, contextual information instead of raw IDs or stale bookable slots
- [ ] **Phase 30: Client Identification & Menu Reliability** - Owner tools accept client names instead of raw Telegram IDs; persistent menu button reliability investigated and fixed/documented

#### Phase 26: Confirmation & Approval Policy

**Goal**: Owner destructive actions and client-initiated reschedules follow one consistent, safe confirmation/approval model — nothing mutates without explicit confirmation, whether triggered from the admin menu or free chat, and a rejected reschedule never loses the client's original booking.
**Depends on**: Nothing (first phase, v1.7)
**Requirements**: CONF-01, CONF-02
**Success Criteria** (what must be TRUE):

  1. Every destructive owner action (delete service, update price, close day, cancel class, assign client) shows the same Ναι/Όχι confirmation before mutating data, regardless of whether it was triggered via an admin menu button or a free-chat tool call.
  2. A client-initiated reschedule request is sent to the owner as an approve/reject prompt instead of auto-confirming, reusing the same capacity-hold cascade already used for new session bookings.
  3. If the owner rejects a reschedule, the client's original booking remains intact and the client receives a Greek notification explaining the rejection.
  4. Reschedules already confirmed under the previous auto-confirm behavior continue to behave correctly after the new approval gate ships (no orphaned capacity holds or double-booked slots).

**Plans**: 2/2 plans complete

Plans:
**Wave 1**

- [x] 26-01-PLAN.md — Reverse the Phase 22 auto-confirm decision for session reschedules: bookSessionInstance links to the booking it replaces, and sbk:approve cascade-cancels it (CONF-02)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 26-02-PLAN.md — Uniform confirm-before-mutate policy for the 5 CONF-01 destructive owner actions, reusing the admin-menu cancel_session confirmation where it already exists (CONF-01)

#### Phase 27: Client Consent & Registration

**Goal**: Every client's first contact with the bot goes through a real, observable consent step, and the platform can tell a genuinely opted-in client apart from an incidental first-contact row.
**Depends on**: Nothing
**Requirements**: COMP-01, COMP-02
**Success Criteria** (what must be TRUE):

  1. A client who first messages the bot via `/start` sees the GDPR data-consent notice before any client-business relationship row is created.
  2. A client who first messages via free-form chat continues to see the same consent notice (parity with the `/start` path, no regression).
  3. The client-business relationship record carries an explicit opt-in flag that is only true once the client has seen and accepted the consent notice.
  4. Pre-existing (pre-v1.7) client relationships are backfilled to a safe default so no real client already using the bot gets silently blocked.

**Plans**: 2/2 plans complete

Plans:
**Wave 1**

- [x] 27-01-PLAN.md — Repurpose consentGiven default (true→false), migration 0013, updateClientConsentGiven query (COMP-02)

**Wave 2** *(depends on Wave 1)*

- [x] 27-02-PLAN.md — Wire the hard Ναι/Όχι consent gate into /start and free-chat, plus the consent:yes/no callback handling (COMP-01, COMP-02)

#### Phase 28: Admin Menu Discoverability

**Goal**: The owner's highest-frequency and highest-stakes actions are all reachable from `/menu`, and no dead or decorative buttons remain in the admin UI.
**Depends on**: Phase 26 (menu-triggered mutations reuse the uniform confirmation pattern established there)
**Requirements**: ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04
**Success Criteria** (what must be TRUE):

  1. Owner can record a client payment entirely from `/menu`, without needing to drop into free chat.
  2. Owner can reach hours, services, prices, and class setup editing from `/menu` entry points.
  3. Tapping "reply to client" either delivers the owner's next message to the escalating client, or the button no longer appears in the admin UI.
  4. The decorative "Νέο μάθημα (chat)" button (and any other no-op button found in the same sweep) is removed or wired to a real action.

**Plans**: TBD

#### Phase 29: Booking & List Clarity

**Goal**: What clients and owners see in booking, cancellation, and callback flows accurately reflects bookable reality and shows meaningful context instead of raw IDs or dead ends.
**Depends on**: Phase 26 (contextual cancel-confirm prompts extend the same confirmation pattern)
**Requirements**: UX-01, UX-02, UX-04, UX-05, UX-06
**Success Criteria** (what must be TRUE):

  1. A same-day session whose start time has already passed no longer appears as a bookable slot to clients.
  2. Cancel-confirmation prompts (admin lesson-cancel, client booking-cancel) show the date and service/class name instead of a raw internal ID.
  3. Booking and cancellation lists show the service/class name alongside date/time.
  4. The client's "Κράτηση μαθήματος" booking button is hidden or relabeled (not silently no-op) for businesses using open-slot (non-fixed-class) booking mode.
  5. Tapping a stale or unknown callback button on either the admin or client menu shows a back-to-menu recovery option instead of a dead-end error.

**Plans**: TBD

#### Phase 30: Client Identification & Menu Reliability

**Goal**: Owners can find clients by name instead of copying raw Telegram IDs, and the persistent Telegram menu button behaves reliably — or its limitations are documented — across clients.
**Depends on**: Nothing (independent; sequenced last as the most research-heavy phase, per research recommendation)
**Requirements**: UX-03, ADMIN-05
**Success Criteria** (what must be TRUE):

  1. Chat tools that currently require a raw Telegram numeric ID (view membership, assign client to session, send renewal reminder) instead accept a client name and match against real clients.
  2. When a name matches multiple clients, the owner sees a disambiguation prompt instead of an ambiguous or wrong match being applied.
  3. Telegram persistent-menu-button reliability has been investigated; any code-addressable gap is fixed, and any purely client-side limitation is documented.

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
| 10. Session Catalog & Schema | v1.3 | 6/6 | Complete | 2026-07-22 |
| 11. Session Booking Flow | v1.3 | 3/3 | Complete | 2026-07-23 |
| 12. Cancellation Cutoff Policy | v1.3 | 3/3 | Complete | 2026-07-23 |
| 13. Slotless Booking Requests | v1.3 | 3/3 | Complete | 2026-07-23 |
| 14. Renewal Notification Extensions | v1.3 | 3/3 | Complete | 2026-07-23 |
| 15. Onboarding Extensions | v1.3 | 2/2 | Complete | 2026-07-23 |
| 16. Single-Bot Architecture | v1.4 | 3/3 | Complete | 2026-07-24 |
| 17. Admin Menu | v1.4 | 4/4 | Complete | 2026-07-24 |
| 18. Client Menu | v1.4 | 4/4 | Complete | 2026-07-24 |
| 19. Class Setup in Onboarding & Terminology Fix | v1.4 | 3/3 | Complete | 2026-07-24 |
| 20. Client Escalation | v1.4 | 2/2 | Complete | 2026-07-24 |
| 21. AI-Driven Owner Onboarding | v1.5 | 3/3 | Complete | 2026-07-25 |
| 22. Session Booking Approval Flow | v1.6 | 1/1 | Complete | 2026-07-27 |
| 23. Lesson Deletion & Cascade Cancellation | v1.6 | 1/1 | Complete | 2026-07-27 |
| 24. Bot Access & Diagnostics Polish | v1.6 | 1/1 | Complete | 2026-07-27 |
| 25. Client Invite Generator | v1.6 | 1/1 | Complete | 2026-07-27 |
| 26. Confirmation & Approval Policy | v1.7 | 2/2 | Complete    | 2026-07-28 |
| 27. Client Consent & Registration | v1.7 | 2/2 | Complete    | 2026-07-28 |
| 28. Admin Menu Discoverability | v1.7 | 0/TBD | Not started | - |
| 29. Booking & List Clarity | v1.7 | 0/TBD | Not started | - |
| 30. Client Identification & Menu Reliability | v1.7 | 0/TBD | Not started | - |

## Backlog

### Phase 999.1: Follow-up — Admin reply relay to escalating client (ESCL-03 completion)

**Goal:** Wire the admin's "Απάντηση πελάτη" reply into an actual message delivered to the escalating client
**Source phase:** 20 (Client Escalation)
**Deferred at:** 2026-07-24 — accepted deferral after phase 20 verification (see `.planning/milestones/v1.4-phases/20-client-escalation/20-VERIFICATION.md`)
**Scope:**

- [ ] Track pending reply target (e.g. `pendingReplyTarget: Map<ownerTelegramId, clientTelegramId>`) when admin taps "Απάντηση πελάτη"
- [ ] Intercept the admin's next free-text message in `handleFoundBusiness` before it reaches `aiOwnerAgent`, forward it to `escl.clientTelegramId` instead
- [ ] Tests for the full reply flow (admin sends message → client receives it)
- Likely depends on/overlaps with CMENU-05 free-text routing work

### Phase 999.2: Follow-up — findBusinessByOwnerTelegramId ambiguous-owner risk in billing/slotless/renewal callbacks

**Goal:** Same cross-tenant risk fixed in the menuAction/escalationAction callback handlers (v1.4 close, 17-REVIEW.md CR-01) still exists in three older callback blocks in `src/webhooks/telegram.ts`
**Source:** Discovered during v1.4 milestone-close verification sweep, 2026-07-24 (not part of v1.4 scope — these blocks predate it)
**Scope:**

- [ ] Billing callback routing (Phase 7, `'firstId' in parsed` block) — re-derives business via `findBusinessByOwnerTelegramId(senderTelegramId)`
- [ ] Slotless request callback routing (Phase 13, `'slotlessRequestId' in parsed` block) — same pattern
- [ ] Renewal callback routing (Phase 14, `'businessId' in parsed` block) — same pattern (partially mitigated by its own `ownerBusiness.id !== renewalResult.businessId` check, but still resolves the wrong owner's business first if one Telegram account owns multiple businesses)
- Root cause: `findBusinessByOwnerTelegramId` has no unique constraint on `owner_telegram_id` and no `ORDER BY`, so with multiple businesses under one Telegram account it can return the wrong one
- Fix pattern: thread the webhook-scoped `business` param (already HMAC-verified) through instead of re-deriving, same as the v1.4 fix

### Phase 999.3: Follow-up — no self-serve entry point to create a new business (v1.4 architectural gap)

**Goal:** Build a real "add a new business" flow now that the platform bot is gone
**Source:** Discovered 2026-07-24 during post-v1.4 local testing (DB was truncated for a clean test, revealing zero code path creates a `businesses` row)
**Scope:**

- [ ] Phase 16 deleted `src/webhooks/platform.ts`, the only caller of `createBusinessForOnboarding` — nothing replaced its role as the entry point for a brand-new business
- [ ] `npm run create-business -- --bot-token <token> --owner-telegram-id <id>` (added 2026-07-24, commit 3eff213) is a manual CLI stopgap the platform operator runs per new business — not self-serve, not chat-driven
- [ ] Decide the real v1.4+ story: does a new business owner talk to *some* bot to register their own bot token (bringing back a minimal platform-bot-like intake), or does the platform operator always bootstrap manually for a single-operator PoC?
- Low urgency while there's one operator onboarding a handful of pilot businesses by hand; blocking if this needs to scale to self-serve signups
- Low urgency: requires a single Telegram account to own multiple businesses, an edge case not yet supported by onboarding
