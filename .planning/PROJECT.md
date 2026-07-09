# RandevuClaw

## What This Is

A WhatsApp-native appointment booking platform for Greek service businesses (pilates studios, gyms, hair salons, etc.). Clients book, cancel, or ask questions by chatting with a single shared WhatsApp number; an AI agent understands the request, figures out which business they mean, and handles the booking. Business owners run everything — setup, accepting/rejecting bookings, cancellations, daily agenda — through WhatsApp chat too, no separate app or dashboard required for the PoC.

## Core Value

A client can book or cancel an appointment with a Greek business entirely through a WhatsApp conversation, in Greek, with zero friction — and the owner's calendar updates automatically.

## Requirements

### Validated

- [x] Client can book an appointment via WhatsApp chat (natural language, Greek) — Validated in Phase 2 (BOOK-01)
- [x] Client can cancel or reschedule an appointment via WhatsApp chat, anytime before the appointment — Validated in Phase 2 (BOOK-02, BOOK-04)
- [x] Client can ask questions: business hours/location/prices, availability check, general freeform questions — Validated in Phase 2 (BOOK-03, ASK-01, ASK-02)
- [x] Owner receives WhatsApp alert on new booking/cancellation/reschedule and can accept or reject — Validated in Phase 2 (OWNR-02)

### Active

- [ ] Bot resolves which business a client means from a single shared WhatsApp number (e.g. deep link `wa.me/<number>?text=<business-code>`)
- [ ] Owner can onboard/configure their business entirely via WhatsApp chat (services, hours, prices, single shared schedule)
- [ ] Confirmed bookings auto-sync to owner's Google Calendar; cancellations remove/update the event
- [ ] Owner gets a daily WhatsApp agenda message (today's appointments)
- [ ] Client gets a WhatsApp reminder before their appointment

### Out of Scope

- Native mobile/web app for owners or clients — WhatsApp chat is the entire interface for PoC
- Per-business dedicated WhatsApp numbers — Meta Business verification per business is too slow/high-friction for a $0 PoC; revisit post-PoC if a business needs its own branded number
- Multiple staff/rooms per business (e.g. per-instructor calendars) — PoC assumes one shared schedule per business
- Payments/deposits — not requested, adds scope
- Cancellation cutoff windows — client can cancel anytime for now, add a notice-period rule later if no-shows become a problem
- English language support — Greek only for now, revisit if expanding beyond Greece

## Context

- Target market: small Greek service businesses (pilates, gyms, hair salons) — likely underserved by WhatsApp-native booking; existing players (Fresha, Booksy) require app installs.
- User (project owner) already holds: Google Cloud/Gemini API key, Meta for Developers account (for WhatsApp Cloud API), fly.io, Cloudflare R2 bucket, Neon Postgres — these are the intended building blocks, not just candidates.
- MCP (Model Context Protocol) raised by owner as a possible way for the AI agent to call tools (calendar, DB actions) — worth evaluating during architecture research, not yet decided over direct API calls.
- WhatsApp Cloud API requires Meta Business verification before going live; free tier exists but onboarding takes real setup time — plan for this lead time even though the API itself is free.

## Constraints

- **Budget**: Near-$0 for PoC — AI (Gemini free tier), DB (Neon free tier), storage (R2 free tier), WhatsApp (Meta Cloud API free tier). Exception: fly.io dropped its free tier in 2024, so hosting costs ~$1.94/mo minimum — accepted as negligible. No other paid services until PoC validates.
- **Tech stack**: Node.js/TypeScript backend, Neon (Postgres) for data, fly.io for hosting, Cloudflare R2 for storage, Google Gemini API for the conversational AI, Google Calendar API for owner calendar sync, WhatsApp Cloud API for messaging.
- **Language**: Bot conversation is Greek-only for the PoC.
- **Compliance**: Personal/booking data of Greek users — GDPR applies; keep in mind during data modeling even though not a v1 feature.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| WhatsApp as the entire client/owner interface | Zero-install, meets users where they already are, matches Greek small-business habits | — Pending |
| One shared platform WhatsApp number, not one per business | Per-business Meta verification too slow/high-friction for $0 PoC; bot disambiguates business via link/code | — Pending |
| Google Gemini for conversational AI | Owner already has free API key — meets $0 budget constraint | — Pending |
| Google Calendar for owner-side sync | Most common among Greek small businesses (Gmail/Workspace usage), solid API | — Pending |
| Node.js/TypeScript backend on fly.io + Neon + R2 | Owner already has these accounts set up; strong free-tier fit | — Pending |
| Single shared schedule per business (no per-staff calendars) | Simpler PoC scope; most small salons/studios fit this model | — Pending |
| Owner onboarding/config via WhatsApp chat, no web dashboard | Consistent "WhatsApp only" simplicity goal for PoC | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-09 — Phase 2 (AI Booking Conversations & Owner Alerts) complete*
