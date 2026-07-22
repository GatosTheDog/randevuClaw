# RandevuClaw

## What This Is

A WhatsApp-native appointment booking platform for Greek service businesses (pilates studios, gyms, hair salons, etc.). Clients book, cancel, or ask questions by chatting with a shared number; an AI agent understands the request, figures out which business they mean, and handles the booking. Business owners run everything — accepting/rejecting bookings, cancellations, daily agenda — through chat too, no separate app or dashboard required.

**PoC state (v1.2):** Each business runs its own Telegram bot. Owners register, configure their business, set billing packages, and record client payments entirely through guided Telegram chat. The bot tracks session balances, enforces membership policies on booking, and proactively notifies before memberships expire. WhatsApp is shelved pending Meta Business Verification (1-6 week external process); the same booking and billing logic wires to WhatsApp once verification clears.

## Core Value

A client can book or cancel an appointment with a Greek business entirely through a chat conversation, in Greek, with zero friction — and the owner's calendar updates automatically.

## Requirements

### Validated

- ✓ Client books appointment via natural-language Greek chat — v1.0 (BOOK-01)
- ✓ Client cancels appointment via chat any time before the appointment — v1.0 (BOOK-02)
- ✓ Client checks availability before booking (e.g. "έχετε ελεύθερο Παρασκευή απόγευμα;") — v1.0 (BOOK-03)
- ✓ Client reschedules appointment via chat — v1.0 (BOOK-04)
- ✓ Client asks business hours/location/prices and gets a Greek answer — v1.0 (ASK-01)
- ✓ Client asks general freeform questions, bot answers via Gemini — v1.0 (ASK-02)
- ✓ Owner receives alert on new booking/cancellation/reschedule and can accept or reject — v1.0 (OWNR-02)
- ✓ Owner receives daily agenda message (8am Athens time) — v1.0 (OWNR-03)
- ✓ Confirmed bookings auto-sync to Google Calendar; cancellations remove/update the event — v1.0 (OWNR-04, code complete; OAuth credentials pending)
- ✓ Client receives DST-safe 24h/1h reminder before their appointment — v1.0 (NOTF-01)
- ✓ Each business runs its own Telegram bot; per-bot webhook routing via UUID; HMAC-verified — v1.1 (BOT-02, BOT-03, BOT-04, BOT-05)
- ✓ Owner registers bot token via chat; platform auto-calls setWebhook and activates the bot — v1.1 (BOT-01)
- ✓ Owner completes full business setup (hours, services, prices) through a guided Telegram chat — v1.1 (ONB-01, ONB-02)
- ✓ Owner can resume a dropped setup session and update config post-onboarding — v1.1 (ONB-03)
- ✓ Hardcoded seed fixtures removed; every business is the result of real owner onboarding — v1.1 (ONB-04)
- ✓ Owner configures billing packages for their business via chat — v1.2 Phase 7 (BILL-01, BILL-02, BILL-03)
- ✓ Owner records client payment via chat; bot creates membership with DST-safe rolling expiry — v1.2 Phase 7 (PAY-01, PAY-02, PAY-03)
- ✓ Bot enforces membership validity on booking (block or flag per business policy) — v1.2 Phase 8 (ENFC-01, ENFC-02, ENFC-03)
- ✓ Session credits deducted/restored atomically across cancel edge cases; unlimited memberships handled — v1.2 Phase 8 (SESS-01 through SESS-04)
- ✓ Client and owner notified 7 days before membership expiry; dedup prevents duplicate sends — v1.2 Phase 9 (NOTF-01, NOTF-02, NOTF-03)
- ✓ Client queries own session balance via Greek chat; bot replies with live DB data — v1.2 Phase 9 (NOTF-04)

### Active

- [ ] Bot resolves which business a client means from a single shared number via deep link (PLAT-01) — code complete; blocked on Meta Business Verification
- [ ] Client shown data-consent notice on first contact (COMP-01) — code complete; not yet observed by a real user

### Out of Scope

- Native mobile/web app for owners or clients — chat is the entire interface for PoC
- Per-business dedicated WhatsApp numbers — Meta verification per business is too slow/high-friction; revisit post-PoC
- Multiple staff/rooms per business (per-instructor calendars) — PoC assumes one shared schedule
- Payments/deposits — not requested, adds scope
- Cancellation cutoff windows — client can cancel anytime for now; add notice-period rule post-PoC if no-shows are a problem
- English language support — Greek only, revisit if expanding beyond Greece

## Context

- v1.0 shipped 2026-07-09: 3 phases, 19 plans, 32 tasks, 3,263 LOC TypeScript, 208 tests
- v1.1 shipped 2026-07-17: 2 phases, 13 plans, 25 tasks, +3,571/-654 lines, 5,162 total src/ LOC
- v1.2 shipped 2026-07-22: 3 phases, 16 plans, 19 tasks, +5,364/-59 lines, 7,364 total src/ LOC, 320 tests
- Tech stack: Node.js/TypeScript, Neon/Drizzle (Postgres + RLS), Telegraf (per-bot Telegram), WhatsApp Cloud API (wired, pending Meta BV), @google/genai (Gemini 2.5 Flash-Lite), Google Calendar API, fly.io
- Billing layer: billingPackages, memberships, membershipLedger, membershipExpiryNotifications tables; SELECT FOR UPDATE atomic deduction; in-process 6-hour expiry sweep
- Per-bot routing: each business has its own bot token; `businesses.webhook_id` (UUID) maps webhook path to tenant; AsyncLocalStorage threads RLS context per request
- Meta Business Verification not yet submitted — submit immediately; gates real WhatsApp delivery (1-6 week approval)
- OAuth consent flow (Google Calendar) CLI ready; tokens needed for live calendar sync demo
- All 320 tests pass; TypeScript clean. Open gaps are operational (external human actions), not code defects.

## Constraints

- **Budget**: Near-$0 for PoC — AI (Gemini free tier), DB (Neon free tier), WhatsApp (Meta Cloud API free tier). fly.io costs ~$1.94/mo — accepted as negligible.
- **Tech stack**: Node.js/TypeScript backend, Neon (Postgres) for data, fly.io for hosting, Cloudflare R2 for storage, Google Gemini API for AI, Google Calendar API for owner sync, WhatsApp Cloud API for messaging (Telegram during PoC).
- **Language**: Bot conversation is Greek-only for the PoC.
- **Compliance**: GDPR applies; data model keeps phone number + booking history only. Full deletion flow deferred to Phase 5.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| WhatsApp as the entire client/owner interface | Zero-install, meets users where they already are, matches Greek small-business habits | ✓ Good — Telegram bridges the gap during Meta BV wait |
| One shared platform number, not one per business | Per-business Meta verification too slow/high-friction for $0 PoC; bot disambiguates via link/code | ✓ Good |
| Google Gemini for conversational AI (@google/genai, not deprecated @google/generative-ai) | Owner already has free API key; new SDK is required (legacy support ends Aug 2025) | ✓ Good |
| Google Calendar for owner-side sync | Most common among Greek small businesses; solid API | ✓ Good |
| Node.js/TypeScript + fly.io + Neon + R2 | Owner already has these accounts; strong free-tier fit | ✓ Good |
| Single shared schedule per business (no per-staff calendars) | Simpler PoC scope; most small salons/studios fit this model | ✓ Good |
| Sequential (not parallel) Gemini function-calling | Prevents double-booking races from concurrent AI tool rounds | ✓ Good |
| DB UNIQUE constraint on (business_id, calendar_date, calendar_time) | Last line of defense against double-booking even if app-level guard fails | ✓ Good |
| Telegram-first pivot (D-01, Phase 2) | Meta Business Verification takes 1-6 weeks; Telegram has no approval gate | ✓ Good — unblocked PoC testing |
| In-process setInterval pollers (no cron, no Redis) | Keeps stack near-$0; no extra infrastructure for 1-business PoC | ✓ Good |
| MAX_CALENDAR_SYNC_RETRIES=10 at 5-min intervals (~50 min window) | Sufficient retry window before permanent abandonment; avoids infinite retry | ✓ Good |
| owner-approval callback_query via atomic UPDATE...WHERE...RETURNING CAS | Eliminates read-then-write race on concurrent owner taps | ✓ Good |
| Owner onboarding/config via chat, no web dashboard | Consistent "chat only" simplicity goal for PoC | ✓ Good — v1.1 shipped |
| Telegraf over raw Telegram Bot API | Type-safe middleware layer; easier webhook-to-bot dispatch | ✓ Good — clean per-bot routing |
| AsyncLocalStorage for RLS context (not request locals or function params) | Thread-safe context propagation across async Drizzle calls without modifying every function signature | ✓ Good — zero cross-contamination in tests |
| UUID webhook IDs (not bot token in URL) | Bot token must never appear in logs or URL paths; UUID-keyed lookup is opaque | ✓ Good — BOT-04 security requirement met |
| 25-step Telegram onboarding state machine (DB-backed, resumable) | No session storage needed; owner can drop off and resume; chat is the only interface | ✓ Good — ONB-03 resume confirmed |
| getConn() exclusively for Phase 8 writes (not db.transaction()) | db.transaction() opens a separate connection breaking atomicity with withBusinessContext | ✓ Good — no cross-tenant leaks in billing writes |
| Flag alert (sendTelegramMessage) NOT wrapped in try/catch in bookAppointmentTool | D-11: alert is critical; failure must surface immediately, not be silently swallowed | ✓ Good — ENFC-03 ordering test confirms pre-keyboard delivery |
| SELECT FOR UPDATE via Drizzle .for('update') for getActiveMembershipForDeduction | Serializes concurrent deductions at DB level; prevents sessionsRemaining going negative | ✓ Good — race guard test proves exactly-1-success with sessionsRemaining=1 |
| src/billing/enforcement.ts extracted from bookAppointmentTool | Enables unit testing of checkEnforcementAndGetMembership without wiring full booking context | ✓ Good — booking-enforcement.test.ts 3 isolated unit tests |

## Evolution

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

| getConn() exclusively for Phase 8 billing writes (not db.transaction()) | db.transaction() opens a separate connection breaking atomicity with withBusinessContext | ✓ Good — no cross-tenant leaks in billing writes |
| Flag alert (sendTelegramMessage) NOT wrapped in try/catch in bookAppointmentTool | D-11: alert is critical; failure must surface immediately, not be silently swallowed | ✓ Good — ENFC-03 ordering test confirms pre-keyboard delivery |
| SELECT FOR UPDATE via Drizzle .for('update') for getActiveMembershipForDeduction | Serializes concurrent deductions at DB level; prevents sessionsRemaining going negative | ✓ Good — race guard test proves exactly-1-success with sessionsRemaining=1 |
| src/billing/enforcement.ts extracted from bookAppointmentTool | Enables unit testing of checkEnforcementAndGetMembership without wiring full booking context | ✓ Good — booking-enforcement.test.ts 3 isolated unit tests |
| Membership dedup via membershipLedger.idempotencyKey UNIQUE + onConflictDoNothing | Replay-safe: duplicate webhook or test re-run never creates double deductions | ✓ Good |
| UNIQUE INDEX on (membership_id, notification_type, expiry_date) for expiry notifications | Per-recipient dedup granularity; sweep can run multiple times safely | ✓ Good — NOTF-03 test confirms no second send |
| checkMembershipBalanceTool reads clientPhone from context, not Gemini args | Prevents cross-client balance inspection — Gemini cannot be prompted to check another client | ✓ Good — T-09-05 guard confirmed in tests |

---
*Last updated: 2026-07-22 — v1.2 Billing & Membership System shipped*
