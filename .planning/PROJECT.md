# RandevuClaw

## What This Is

A WhatsApp-native appointment booking platform for Greek service businesses (pilates studios, gyms, hair salons, etc.). Clients book, cancel, or ask questions by chatting with a shared number; an AI agent understands the request, figures out which business they mean, and handles the booking. Business owners run everything — accepting/rejecting bookings, cancellations, daily agenda — through chat too, no separate app or dashboard required.

**PoC state (v1.0):** Telegram is the active messaging channel — WhatsApp is shelved pending Meta Business Verification (1-6 week external process). All booking logic, calendar sync, and reminders are implemented and tested via Telegram; the same code wires to WhatsApp once verification clears.

## Core Value

A client can book or cancel an appointment with a Greek business entirely through a chat conversation, in Greek, with zero friction — and the owner's calendar updates automatically.

## Current Milestone: v1.1 Per-Business Bots & Telegram PoC Completion

**Goal:** Pivot from a shared platform bot to per-business Telegram bots, enable owner self-serve onboarding via chat, and close out the Telegram PoC with GDPR compliance and production resilience — no Meta/WhatsApp work.

**Target features:**
- Per-business Telegram bot architecture (each business gets their own `@BotUsername`; platform routes via `/webhooks/telegram/:botToken`)
- Owner self-serve onboarding via chat (bot token → webhook registration → business config: name, hours, services, prices)
- Multi-tenant safety (two+ businesses, zero cross-tenant data leakage)
- Client/owner data deletion on request via chat (GDPR COMP-02)
- Graceful Gemini rate-limit handling under burst load (backoff/queueing)

**Explicitly out of scope for v1.1:** Meta Business Verification, WhatsApp activation (deferred to v1.2+)

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

### Active

- [ ] Bot resolves which business a client means from a single shared number via deep link (PLAT-01) — code complete; blocked on Meta Business Verification
- [ ] Client shown data-consent notice on first contact (COMP-01) — code complete; not yet observed by a real user
- [ ] Owner configures their business entirely via chat (services, hours, prices) — Phase 4 (OWNR-01)
- [ ] Client or owner can request deletion of stored data — Phase 5 (COMP-02)

### Out of Scope

- Native mobile/web app for owners or clients — chat is the entire interface for PoC
- Per-business dedicated WhatsApp numbers — Meta verification per business is too slow/high-friction; revisit post-PoC
- Multiple staff/rooms per business (per-instructor calendars) — PoC assumes one shared schedule
- Payments/deposits — not requested, adds scope
- Cancellation cutoff windows — client can cancel anytime for now; add notice-period rule post-PoC if no-shows are a problem
- English language support — Greek only, revisit if expanding beyond Greece

## Context

- v1.0 shipped 2026-07-09: 3 phases, 19 plans, 32 tasks, 3,263 LOC TypeScript, 208 tests passing (Nyquist-compliant)
- Tech stack: Node.js/TypeScript, Neon/Drizzle (Postgres), Telegram Bot API (active), WhatsApp Cloud API (wired, pending Meta BV), @google/genai (Gemini 2.5 Flash-Lite), Google Calendar API, fly.io
- Telegram-first pivot (Phase 2 D-01): WhatsApp shelved after Meta BV delay emerged. Telegram webhook, client SDK, and owner callback_query flow are the PoC testing surface. WhatsApp client is built and wired; activating it requires Meta BV approval.
- Meta Business Verification not yet submitted — submit immediately; approval takes 1-6 weeks and gates real WhatsApp delivery
- OAuth consent flow (Google Calendar) CLI is ready; tokens to be provisioned before end-to-end calendar sync can be demonstrated live (`npm run setup-calendar -- --business-slug pilates-athens`)
- 208/208 tests pass; TypeScript clean. All v1.0 gaps are operational (external human actions), not code defects.

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
| Owner onboarding/config via chat, no web dashboard | Consistent "chat only" simplicity goal for PoC | — Phase 4 pending |

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
*Last updated: 2026-07-10 — v1.1 milestone started*
