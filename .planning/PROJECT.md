# RandevuClaw

## What This Is

A WhatsApp-native appointment booking platform for Greek service businesses (pilates studios, gyms, hair salons, etc.). Clients book, cancel, or ask questions by chatting with a shared number; an AI agent understands the request, figures out which business they mean, and handles the booking. Business owners run everything — accepting/rejecting bookings, cancellations, daily agenda — through chat too, no separate app or dashboard required.

**PoC state (v1.1):** Each business runs its own Telegram bot. Owners register and configure their business entirely through a guided Telegram chat — no manual DB intervention. WhatsApp is shelved pending Meta Business Verification (1-6 week external process); the same booking logic wires to WhatsApp once verification clears.

## Core Value

A client can book or cancel an appointment with a Greek business entirely through a chat conversation, in Greek, with zero friction — and the owner's calendar updates automatically.

## Current Milestone: v1.2 Billing & Membership System

**Goal:** Businesses can configure flexible billing models (per-session, tokens, passes, multi-month packages); owners record payments via chat; the bot tracks balances, enforces booking rules, and notifies before credits expire.

**Target features:**
- Package configuration via chat (owner defines name, price, duration in days, session count or unlimited)
- Manual payment recording via chat (owner assigns package to client → membership with expiry created)
- Session deduction on confirmed booking (token-based); credit restored on cancel within validity; forfeited on reschedule outside validity window
- Per-business enforcement policy: "block if no valid membership" or "allow and flag to owner"
- Expiry notifications: both client and owner notified before credits/pass expires
- Client self-service balance query ("πόσα μαθήματα μου έχουν απομείνει;")

**Explicitly out of scope for v1.2:** payment gateway integration, automatic payment collection, refunds/invoicing, GDPR deletion (deferred from v1.1 Phase 6), Gemini rate-limit resilience (deferred from v1.1 Phase 6)

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

### Active

- [ ] Bot resolves which business a client means from a single shared number via deep link (PLAT-01) — code complete; blocked on Meta Business Verification
- [ ] Client shown data-consent notice on first contact (COMP-01) — code complete; not yet observed by a real user
- [ ] Owner configures billing packages for their business via chat — Phase 7 (BILL-01, BILL-02)
- [ ] Owner records client payment via chat; bot creates membership with expiry — Phase 7 (PAY-01, PAY-02)
- [ ] Bot enforces membership validity on booking (block or flag per business policy) — Phase 8 (ENFC-01, ENFC-02, ENFC-03)
- [ ] Session credits deducted/restored correctly across cancel/reschedule edge cases — Phase 8 (SESS-01 through SESS-04)
- [ ] Client and owner both notified before membership expires; client can query balance — Phase 9 (NOTF-BILL-01 through NOTF-BILL-04)

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
- Tech stack: Node.js/TypeScript, Neon/Drizzle (Postgres + RLS), Telegraf (per-bot Telegram), WhatsApp Cloud API (wired, pending Meta BV), @google/genai (Gemini 2.5 Flash-Lite), Google Calendar API, fly.io
- Per-bot routing: each business has its own bot token; `businesses.webhook_id` (UUID) maps webhook path to tenant; AsyncLocalStorage threads RLS context per request
- Meta Business Verification not yet submitted — submit immediately; gates real WhatsApp delivery (1-6 week approval)
- OAuth consent flow (Google Calendar) CLI ready; tokens needed for live calendar sync demo
- All tests pass; TypeScript clean. Open gaps are operational (external human actions), not code defects.

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

---
*Last updated: 2026-07-17 — v1.1 milestone closed, v1.2 next*
