# Roadmap: RandevuClaw

## Milestones

- ✅ **v1.0 MVP** — Phases 1-3 (shipped 2026-07-09)
- ✅ **v1.1 Per-Bot Infrastructure & Owner Onboarding** — Phases 4-5 (shipped 2026-07-17)
- ✅ **v1.2 Billing & Membership System** — Phases 7-9 (shipped 2026-07-22)
- ✅ **v1.3 Studio Session Scheduling & Slotless Bookings** — Phases 10-15 (shipped 2026-07-23)
- ✅ **v1.4 Single-Bot UX Overhaul** — Phases 16-20 (shipped 2026-07-24)
- ✅ **v1.5 AI-Driven Owner Onboarding** — Phase 21 (shipped 2026-07-25)
- 🚧 **v1.6 Telegram Bot UX/Ops Improvements** — Phases 22-25 (in progress)

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

### 🚧 v1.6 Telegram Bot UX/Ops Improvements (In Progress)

**Milestone Goal:** Give owners real approval control over session bookings plus admin power tools (delete lessons, always-on menu, better error diagnostics), and give owners an easy way to invite new clients to the bot.

- [ ] **Phase 22: Session Booking Approval Flow** - Session-class bookings go through owner approve/reject instead of auto-confirming, with capacity soft-held during the pending window
- [ ] **Phase 23: Lesson Deletion & Cascade Cancellation** - Admin can delete a scheduled lesson; any active bookings on it are cancelled with credit/capacity restored and clients notified
- [ ] **Phase 24: Bot Access & Diagnostics Polish** - Persistent Telegram menu button for one-tap menu access, plus an owner-facing technical follow-up when the bot's generic fallback fires
- [ ] **Phase 25: Client Invite Generator** - Owner requests an invite and gets one message with a printable QR code and a copyable `t.me/<bot_username>` deep link

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
| 22. Session Booking Approval Flow | v1.6 | 0/TBD | Not started | - |
| 23. Lesson Deletion & Cascade Cancellation | v1.6 | 0/TBD | Not started | - |
| 24. Bot Access & Diagnostics Polish | v1.6 | 0/TBD | Not started | - |
| 25. Client Invite Generator | v1.6 | 0/TBD | Not started | - |

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

## Phase Details

### Phase 22: Session Booking Approval Flow
**Goal**: Owner gets real approve/reject control over session-class bookings instead of silent auto-confirmation, mirroring the existing open-slots/slotless approval pattern (Phase 13), with capacity correctly soft-held while approval is pending and released on rejection/expiry.
**Depends on**: Nothing new — extends the existing session booking flow (`bookSessionInstance` in `src/session/manager.ts`, `handleBookSessionExecute` in `src/telegram/handlers/client-menu.ts`) and the approve/reject keyboard pattern already used for slotless requests
**Requirements**: OWNR-05, OWNR-06, OWNR-07
**Success Criteria** (what must be TRUE):
  1. When a client books a `fixed_sessions` class (via free chat or the client menu), the bot creates the booking as pending — not confirmed — and the client sees a Greek "request sent, awaiting confirmation" message.
  2. The pending booking counts against the class's capacity (soft hold) so a second client cannot fill the same slot while approval is outstanding.
  3. The owner's chat receives an inline approve/reject keyboard identifying the client and session/class details for every new pending session booking.
  4. If the owner rejects (or the request expires), the held capacity is released back to the class and the client receives a Greek rejection message.
  5. If the owner approves, the client receives the Greek confirmation message and the booking becomes confirmed.
**Plans**: TBD

### Phase 23: Lesson Deletion & Cascade Cancellation
**Goal**: Admin can remove a scheduled lesson entirely, and any clients already booked into it are cleanly unwound — credit/capacity restored, clients notified in Greek.
**Depends on**: Nothing new — extends the existing session catalog/instance layer (`src/session/manager.ts`, Phase 10) and the admin Classes sub-menu (Phase 17)
**Requirements**: CLSS-06, CLSS-07
**Success Criteria** (what must be TRUE):
  1. Admin can delete/cancel a specific scheduled lesson (session instance) from the admin menu or free-form chat.
  2. Deleting a lesson with zero active bookings removes/cancels the instance with no other side effects.
  3. Deleting a lesson that has active client bookings cancels each of those bookings and restores each affected client's session credit (or capacity, for unlimited memberships) atomically.
  4. Each affected client receives a Greek notification that their booking for that lesson was cancelled by the business.
**Plans**: TBD

### Phase 24: Bot Access & Diagnostics Polish
**Goal**: Admin and clients get one-tap access to their own menu without retyping a command, and the owner gets actionable technical visibility whenever the bot's generic Greek fallback fires for a client — without changing what the client sees.
**Depends on**: Nothing new — small, independent additions: Telegram Bot API `setChatMenuButton`/command registration (extends Phase 17/18 menus), and a follow-up send at the existing generic-fallback call sites across `src/conversation/ai-agent.ts`, `src/onboarding/ai-owner-agent.ts`, `src/onboarding/ai-onboarding-agent.ts`, and `src/webhooks/telegram.ts`
**Requirements**: BOT-06, DIAG-01
**Success Criteria** (what must be TRUE):
  1. Admin sees a persistent Telegram menu button that opens the admin `/menu` directly, without typing the command.
  2. Client sees a persistent Telegram menu button that opens the client `/start` menu directly, without typing the command.
  3. When the bot sends the generic Greek fallback error message to a client, the owner's own chat receives a best-effort follow-up message identifying what step/tool failed and the error type, while the client-facing message stays unchanged (clean Greek only).
**Plans**: TBD

### Phase 25: Client Invite Generator
**Goal**: Owner can generate a single, ready-to-share invite for their business's bot — a printable QR code plus a copyable deep link — so bringing on a new client needs no manual setup.
**Depends on**: Nothing new — self-contained capability; introduces a QR-code generation library (e.g. `qrcode` npm package) as a new dependency
**Requirements**: INVITE-01
**Success Criteria** (what must be TRUE):
  1. Owner can request an invite (via admin menu or free chat) and receives one message containing a QR image composed with the business name and a Greek call-to-action caption, ready to print standalone.
  2. The same message includes the raw `t.me/<bot_username>` deep link as copyable plain text.
  3. The owner can either print/post the QR image or forward/paste the link text into any other channel (Telegram forward, SMS, WhatsApp, Instagram, email).
**Plans**: TBD
