# Roadmap: RandevuClaw

## Milestones

- ✅ **v1.0 MVP** — Phases 1-3 (shipped 2026-07-09)
- ✅ **v1.1 Per-Bot Infrastructure & Owner Onboarding** — Phases 4-5 (shipped 2026-07-17)
- ✅ **v1.2 Billing & Membership System** — Phases 7-9 (shipped 2026-07-22)
- ✅ **v1.3 Studio Session Scheduling & Slotless Bookings** — Phases 10-15 (shipped 2026-07-23)
- ✅ **v1.4 Single-Bot UX Overhaul** — Phases 16-20 (shipped 2026-07-24)
- ✅ **v1.5 AI-Driven Owner Onboarding** — Phase 21 (shipped 2026-07-25)
- ✅ **v1.6 Telegram Bot UX/Ops Improvements** — Phases 22-25 (shipped 2026-07-28)
- ✅ **v1.7 UX & Trust Polish** — Phases 26-30 (shipped 2026-07-29)

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

<details>
<summary>✅ v1.7 UX & Trust Polish (Phases 26-30) — SHIPPED 2026-07-29</summary>

- [x] **Phase 26: Confirmation & Approval Policy** — Uniform Ναι/Όχι confirmation on every destructive owner action, and client reschedules now require owner approval like new bookings (completed 2026-07-28 for plans 26-01/02; ⚠ plans 26-03/04/05, arrived 2026-10-08 via git-sync merge from a coworker's branch, specify a more robust reschedule-approval cascade + a new expiry-notice feature that are NOT yet implemented — see STATE.md Blockers)
- [x] **Phase 27: Client Consent & Registration** — GDPR consent notice shown before any client relationship row is created, with a real opt-in flag distinguishing registered clients (completed 2026-07-28)
- [x] **Phase 28: Admin Menu Discoverability** — Payment recording, setup editing, and escalation reply are all reachable from `/menu`; dead decorative buttons removed (completed 2026-07-28)
- [x] **Phase 29: Booking & List Clarity** — Slots, cancel prompts, and booking lists show accurate, contextual information instead of raw IDs or stale bookable slots (completed 2026-07-28)
- [x] **Phase 30: Client Identification & Menu Reliability** — Owner tools accept client names instead of raw Telegram IDs; persistent menu button reliability investigated and fixed/documented (completed 2026-07-29)

See: `.planning/milestones/v1.7-ROADMAP.md`

</details>

<details>
<summary>✅ Phase 25.1: Google Calendar for Client & Admin Bookings (INSERTED, merged from a parallel branch — git-sync 2026-10-07) — SHIPPED 2026-10-02</summary>

- [x] **Phase 25.1: Google Calendar for Client & Admin Bookings (INSERTED)** - Confirmed bookings create Google Calendar events for both the admin and the client (completed 2026-10-02)

#### Phase 25.1: Google Calendar for Client & Admin Bookings (INSERTED)

**Goal**: Bookings are reflected in Google Calendar for both the admin (owner) and the client.
**Depends on**: Phase 25 (v1.6 shipped); existing owner calendar sync in `src/calendar/` and `src/google/oauth.ts`
**Requirements**: CAL-01, CAL-02, CAL-03, CAL-04, CAL-05, CAL-06, CAL-07, CAL-08, CAL-09 (derived from CONTEXT D-01..D-08; see 25.1-RESEARCH.md)
**Success Criteria** (what must be TRUE):

  1. Owner connects Google Calendar from the owner menu (button → Google consent → callback stores the token) with no CLI; the OAuth state is single-use, expiring and bound to the business.
  2. A confirmed appointment OR class/session booking creates a Google Calendar event for the owner (Greek title with service + client name/@username/id, description with business and service, 30-min popup reminder); cancel/reschedule removes or replaces it.
  3. The client receives a tap-to-add Google Calendar link only after owner confirmation, plus Greek delete-old-event notes on reschedule/cancel; client calendars are never modified.
  4. Without a Google connection, sync is skipped silently, bookings and the client link are unaffected, and the owner gets exactly one nudge to connect.

**Plans**: 6/6 plans executed

Plans:
**Wave 1**

- [x] 25.1-01-PLAN.md — DB foundation: nudge flag, DB-backed OAuth state table, migration 0013 + [BLOCKING] schema push, deadlock/unbounded-sweep fixes at query layer
- [x] 25.1-02-PLAN.md — Pure building blocks: constants, Google error helper, owner event content, client tap-to-add link + Greek notes, typed fixtures

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 25.1-03-PLAN.md — Owner sync hardening (sync/poller), one-time and revoked-token nudges, `processBookingConfirmedForCalendar` entry point
- [x] 25.1-04-PLAN.md — In-bot Google connect: menu button, single-use state, callback route, live consent human-check

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 25.1-05-PLAN.md — Webhook wiring: all approve paths sync + client link, client-cancel note, @username capture

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 25.1-06-PLAN.md — Cancel notes on every cancel message, reschedule_session delete/sync/link, owner assign-to-class

</details>

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
| 25.1. Google Calendar for Client & Admin Bookings (INSERTED) | v1.7 | 6/6 | Complete | 2026-10-02 |
| 26. Confirmation & Approval Policy | v1.7 | 2/5 | In Progress — 26-03/04/05 not yet executed (found 2026-10-08 via git-sync merge) | - |
| 27. Client Consent & Registration | v1.7 | 2/2 | Complete    | 2026-07-28 |
| 28. Admin Menu Discoverability | v1.7 | 2/2 | Complete    | 2026-07-28 |
| 29. Booking & List Clarity | v1.7 | 6/6 | Complete    | 2026-07-28 |
| 30. Client Identification & Menu Reliability | v1.7 | 2/2 | Complete    | 2026-07-29 |

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

### Phase 31: Google Calendar Self-Serve Connect

**Goal:** Owner-facing OAuth flow to connect Google Calendar without a dev manually running `scripts/setup-google-calendar.ts`; scope also covers whether client-side gets an `.ics` invite link (no OAuth) or is deferred entirely.
**Requirements**: D-01 through D-07 (31-CONTEXT.md decisions — no formal REQUIREMENTS.md IDs tracked for this phase)
**Depends on:** Phase 30
**Plans:** 2 plans

Plans:

- [ ] 31-01-PLAN.md — Owner-facing Google Calendar OAuth connect/disconnect: /calendar command, Settings menu button, live /oauth/callback route (D-01, D-02, D-03, D-04, D-06, D-07)
- [ ] 31-02-PLAN.md — Client-side .ics calendar invite sent on booking confirmation (D-05)
