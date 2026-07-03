# Project Research Summary

**Project:** RandevuClaw (WhatsApp-native appointment booking for Greek service businesses)
**Domain:** Multi-tenant conversational SaaS, appointment scheduling
**Researched:** 2026-07-03
**Confidence:** HIGH

## Executive Summary

RandevuClaw is a **multi-tenant WhatsApp-native appointment booking platform** for small Greek service businesses (salons, gyms, pilates studios). It succeeds by eliminating friction: clients book by typing naturally in WhatsApp (no app install, no forms), owners manage via chat (no dashboard), and Google Calendar stays in sync automatically. The recommended architecture uses **stateless webhook handlers** + **sequential AI function-calling** + **database-level concurrency control** to prevent double-booking while handling multi-tenancy via row-level security.

**Key recommendation:** Build in 5 phases following strict architectural dependencies. Do NOT parallelize database writes in the LLM loop — race conditions cause double-booking. Start Meta Business Verification immediately (1–6 week critical path). Use approved WhatsApp message templates for reminders (24-hour window constraint). Test Greek date parsing extensively before launch; generic NLP fails on colloquial temporal expressions.

**Core risks and mitigations:**
1. **Meta verification delays** → Start day 1, not launch-week; audit all 4 touchpoints (business registration, website, Meta Business Info, authorized admin)
2. **WhatsApp 24-hour window breaks reminders** → Pre-create and test template approval; reminders use templates, not free-form messages
3. **Double-booking via parallel AI calls** → Database UNIQUE constraints + idempotency keys; enforce sequential function execution in AI loop
4. **Gemini free-tier rate limits (15 req/min)** → Load test early; implement backoff + circuit breaker; budget for paid tier before scaling
5. **fly.io no longer has a free tier for new accounts (removed 2024)** → Budget ~$1.94/month minimum for an always-on Machine; this is the one place the "$0 everywhere" goal isn't literally achievable

---

## Key Findings

### Recommended Stack

The stack is **free-tier compatible for PoC, with one small unavoidable cost** (fly.io). All technologies are 2025-2026 current; avoids deprecated SDKs (`@google/generative-ai` is obsolete — use `@google/genai`).

**Core technologies:**
- **WhatsApp Cloud API + Express:** Official Meta SDK; free unlimited service conversations; webhook-native; simplest path to scale
- **Google Gemini 2.5 Flash-Lite:** 15 req/min free tier sufficient for PoC; new `@google/genai` SDK; native function-calling without MCP overhead
- **Neon PostgreSQL + Drizzle ORM:** Serverless, per-query pricing; Drizzle is 7.4 KB (vs Prisma 1.6 MB); built-in Row-Level Security for multi-tenancy
- **Google Calendar API:** Official library; two-way sync support; timezone handling; 500 calls/user/day (ample headroom)
- **fly.io Cron Manager + BullMQ:** fly.io purpose-built for webhook apps; Cron Manager avoids duplicate runs; Redis (Upstash free tier) for job broker
- **Cloudflare R2:** 10 GB free + zero egress; S3-compatible API; owner already has account
- **fly.io Machines:** free trial (2h or 7d) only for new accounts, then ~$1.94/month; auto-scales from 0, no visible cold-start latency

**Free tier ceiling (when you hit limits):**
- WhatsApp: unlimited service conversations (message tier limit at 250+ new conversations/24h pre-verification)
- Gemini API: 1,000 requests/day (scales at ~100 active users)
- Neon: 100 CU-hours/month (~2–3M queries) — ample for 1–2 businesses
- fly.io: 2-hour or 7-day trial, then $1.94/month (negligible, but not $0)

### Expected Features

**Table stakes (users expect these):**
- Book appointment via natural chat
- Cancel/reschedule via chat
- Automated reminders (24h and 1h before, reduces no-shows ~90%)
- Google Calendar sync
- Availability checking
- Service/price/hours inquiry
- Business hours configuration
- Multiple service types
- Owner daily agenda message
- Booking confirmation

**Differentiators (set RandevuClaw apart):**
- **Conversational AI booking** — 45% higher conversion vs. web forms
- **Greek language, naturally** — only chat-native tool working entirely in Greek
- **Shared platform number + AI disambiguation** — one WhatsApp number serves 100s of businesses
- **Owner onboarding via chat** — no dashboard required
- **Owner booking alerts + accept/reject** — high-touch control

**Anti-features (do NOT build for PoC):**
- Per-staff calendars, multiple businesses per account, payment processing, native mobile app, per-business phone numbers, waitlist, complex reporting, English support

**MVP (Phase 1 target):** booking, cancellation, calendar sync, reminders, business hours + services config, availability checking, daily agenda.

### Architecture Approach

Multi-tenant webhook-driven architecture with **stateless message handlers** (idempotent, replay-safe) backed by **persistent state** (Postgres for durability, Redis for hot access). **Critical design: sequential LLM function-calling** (not parallel) + **database constraints for consistency** (UNIQUE on `(business_id, calendar_time)` prevents double-booking at DB level).

**Major components:**
1. **Message Webhook Handler** — Verifies `X-Hub-Signature`, deduplicates by message ID (Redis, TTL 24h), logs all payloads to audit table, returns HTTP 200 immediately
2. **Conversation Router** — Extracts tenant context, loads state from Redis, classifies intent, routes to AI Agent
3. **AI Agent (Gemini Function-Calling Loop)** — Executes functions **sequentially** (never parallel)
4. **Function Execution Layer** — Transactional operations with idempotency keys; database constraints prevent double-booking
5. **Response Handler** — Updates state, sends WhatsApp reply, triggers async jobs
6. **Background Jobs (BullMQ + Redis)** — Scheduled: daily agenda (8am), reminders (24h and 1h before)
7. **Data Layer** — Postgres + Redis with Row-Level Security for tenant isolation

**Key patterns:** idempotent handlers, checkpoint after every interaction, sequential tool execution, database-level constraints, RLS, webhook payload logging.

### Critical Pitfalls

**Top 5:**

1. **Meta Business Verification delays (1–6 weeks)** — Start day 1 of prototyping, not launch-week; audit all 4 touchpoints (business registration, website, Meta Business Info, authorized admin) for exact name/address match
2. **WhatsApp 24-Hour Window breaks reminders** — Create + pre-approve templates ("Appointment Reminder", "Daily Agenda") with Meta (24h+ approval); outside 24h window, only templates work, not free-form messages
3. **LLM double-booking via race conditions** — Enforce sequential execution in AI loop (never parallelize); use idempotency keys; rely on database UNIQUE constraint on `(business_id, calendar_date, calendar_time)`
4. **Gemini free-tier rate limits (15 req/min)** — Load test with 15–20 concurrent messages before shipping; implement exponential backoff + circuit breaker; budget for paid tier before scaling
5. **Multi-tenant context loss** — Extract tenant from deep link/code BEFORE reaching LLM; make tenant filtering automatic at database layer (use RLS); include `business_id` as required parameter in every LLM tool

---

## Implications for Roadmap

**5-phase architecture-driven roadmap:**

### Phase 1: Foundation & Webhook Infrastructure
- **Rationale:** Database schema, message flow, and RLS are prerequisites for everything downstream
- **Delivers:** Postgres schema with RLS, Redis connection, WhatsApp webhook handler (verified + deduplicated), audit log
- **Avoids pitfalls:** Starts Meta verification immediately; webhook logging enables recovery
- **Research flags:** None — patterns well-established

### Phase 2: AI Integration & Booking Logic
- **Rationale:** Once webhooks flow reliably, connect AI agent and implement core booking (create, cancel, availability)
- **Delivers:** Conversation Router, AI Agent loop (sequential Gemini function-calling), Function Execution Layer, booking constraints, owner alerts
- **Features:** Book/cancel/availability/inquiry/services/confirmation
- **Avoids pitfalls:** Sequential execution prevents double-booking; Greek date preprocessing; load testing with concurrency
- **Research flags:** Greek date parsing (build 20+ test corpus), Gemini rate-limit circuit breaker

### Phase 3: Calendar Sync & Reminders
- **Rationale:** Once bookings work, sync to Google Calendar and implement reminders (~90% no-show reduction)
- **Delivers:** Google Calendar API (timezone = Europe/Athens), daily agenda job, appointment reminders (24h + 1h), template approval, dead-letter queue
- **Features:** Calendar sync, reminders, daily agenda
- **Avoids pitfalls:** Pre-approve templates before implementing reminder jobs; timezone-aware; fly.io Cron Manager (not custom cron)
- **Research flags:** WhatsApp template approval SLA (1–2 day), DST edge cases

### Phase 4: Business Onboarding & Multi-Tenancy
- **Rationale:** Test full multi-tenant flows (one business per link, AI disambiguates)
- **Delivers:** Onboarding flow (via chat), business code + deep link generation, multi-tenant isolation validation
- **Features:** Business hours config (chat), services (chat)
- **Avoids pitfalls:** Tenant filtering automatic at ORM; RLS unit tests; manual cross-tenant query audit

### Phase 5: Polish, Testing & Production Readiness
- **Rationale:** All features done; polish UX, comprehensive testing, operational readiness
- **Delivers:** Error handling + DLQ, monitoring + alerts, rate-limit monitoring, load testing (15+ concurrency), documentation, GDPR compliance
- **Validates:** Meta verified, templates approved, concurrency safe, rate limits handled, Greek dates parsed, multi-tenant isolated, calendar synced, cron reliable, GDPR compliant, logging in place

**Phase Ordering Rationale:**
- Phase 1 → all others (foundation required)
- Phase 2 before Phase 3 (core feature before async jobs)
- Phase 3 before Phase 4 (features before multi-tenancy complexity)
- Phase 4 before Phase 5 (end-to-end validation before production)

### Research Flags for Roadmapper

**Phases needing deeper research:**
- **Phase 2:** Greek date parsing (build test corpus, validate handling of colloquial expressions)
- **Phase 3:** WhatsApp template approval SLA (Meta review opaque; plan for re-submissions)
- **Phase 5:** GDPR compliance model (verify lawful basis selection)

**Standard patterns (skip research-phase):**
- **Phase 1:** Idempotent webhook handlers (well-documented)
- **Phase 2:** Sequential LLM function-calling (well-documented failure mode + mitigation)
- **Phase 4:** PostgreSQL RLS + multi-tenancy (well-established patterns)

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| **Stack** | HIGH | All recommendations backed by official 2025-2026 docs (Meta, Google, Neon, fly.io). Deprecated SDK confirmed end-of-life. |
| **Features** | HIGH | Table stakes from Fresha/Booksy/Calendly; differentiators validated by conversational-AI conversion data. Greek specifics sourced from business culture + employment law research. |
| **Architecture** | HIGH for patterns, MEDIUM for implementation | Webhook-driven SaaS patterns well-established. Sequential LLM function-calling documented. Database constraints proven. Implementation validation needed: concurrency under load, calendar sync DST edge cases, Gemini function-call ordering. |
| **Pitfalls** | HIGH | Meta verification delays, WhatsApp 24-hour window, Gemini rate limits, timezone bugs all documented with recovery strategies. Greek date parsing is domain-specific risk but solution is straightforward. |

**Overall:** **HIGH** — Project design is sound, stack proven, risks well-understood and mitigable.

### Gaps to Address

1. **Greek NLP library maturity:** assumed Gemini + light preprocessing handles Greek temporal expressions → validate during Phase 2 planning
2. **Meta template approval SLA:** 24–48h estimated, actual varies → confirm during Phase 3
3. **Gemini function-call ordering:** verify with load testing during Phase 2
4. **Google Calendar overlap queries:** verify API supports efficient overlap detection during Phase 3 spike
5. **GDPR lawful basis:** implement consent flow as the safe default during Phase 1/5

---

## Sources

**Primary (official 2025-2026 docs):** Meta Developers (WhatsApp Cloud API), Google AI (Gemini API/free tier), Google Workspace (Calendar API), Neon docs (free tier), Drizzle docs, fly.io docs.

**Secondary:** Drizzle vs Prisma comparisons, conversational-AI conversion studies, no-show reduction via reminders research, Fresha/Booksy competitive landscape, Greek business culture/working-hours research.

**Tertiary:** MCP adoption patterns (mature but evaluated as unnecessary overhead for this PoC).
