<!-- GSD:project-start source:PROJECT.md -->

## Project

**RandevuClaw**

A WhatsApp-native appointment booking platform for Greek service businesses (pilates studios, gyms, hair salons, etc.). Clients book, cancel, or ask questions by chatting with a single shared WhatsApp number; an AI agent understands the request, figures out which business they mean, and handles the booking. Business owners run everything — setup, accepting/rejecting bookings, cancellations, daily agenda — through WhatsApp chat too, no separate app or dashboard required for the PoC.

**Core Value:** A client can book or cancel an appointment with a Greek business entirely through a WhatsApp conversation, in Greek, with zero friction — and the owner's calendar updates automatically.

### Constraints

- **Budget**: Near-$0 for PoC — AI (Gemini free tier), DB (Neon free tier), storage (R2 free tier), WhatsApp (Meta Cloud API free tier). Exception: fly.io dropped its free tier in 2024, so hosting costs ~$1.94/mo minimum — accepted as negligible. No other paid services until PoC validates.
- **Tech stack**: Node.js/TypeScript backend, Neon (Postgres) for data, fly.io for hosting, Cloudflare R2 for storage, Google Gemini API for the conversational AI, Google Calendar API for owner calendar sync, WhatsApp Cloud API for messaging.
- **Language**: Bot conversation is Greek-only for the PoC.
- **Compliance**: Personal/booking data of Greek users — GDPR applies; keep in mind during data modeling even though not a v1 feature.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## Recommended Stack

### Messaging Layer: WhatsApp Cloud API

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **WhatsApp/WhatsApp-Nodejs-SDK** | 1.x (latest) | Webhook + message send/receive | Official Meta SDK with TypeScript support; simplest path to webhook integration on fly.io. Single `registerWebhookListener()` call handles message reception. |
| **express** | 4.18+ | HTTP server for webhooks | Industry standard; webhook verification + message routing trivial. Any fly.io Node.js app uses this. |

- **Free Tier Messaging Limit:** Service conversations (customer-initiated) are **unlimited and free** as of Nov 1, 2024. Marketing/utility/authentication conversations bill from the first one. For a PoC booking bot (customer-initiated = booking request), you're in the free tier.
- **24-Hour Window:** When a customer sends a message, you have 24 hours to reply with free-form messages (text, images, media). Every customer reply resets the 24-hour window. Outside the window, you can only send templated messages using Meta-approved templates (which also cost).
- **New Account Messaging Tier:** Unverified/new accounts are capped at 250 conversations per 24-hour rolling window. Meta requires business verification to unlock higher tiers (2K, 10K, 100K, unlimited). Plan this verification as a prerequisite to handling >250 clients/day.
- **Message Templates:** For proactive owner alerts (new booking, cancellation) sent outside the 24-hour window, use Meta's built-in template system. This requires pre-approving templates in the Meta Business dashboard.

### AI/Conversational Layer: Google Gemini API

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **@google/genai** | 2.10.0+ | LLM + function-calling | CRITICAL: NOT @google/generative-ai (deprecated, support ends Aug 2025). The new @google/genai SDK is Google's unified SDK for Gemini 2.0+ with full TypeScript support, streaming, and tool-use. Requires Node.js 20+. |

- **Free Tier Rate Limits (May 2026):** Gemini 2.5 Flash-Lite offers 15 requests/minute (RPM) and 1,000 requests/day (RPD). Pro model was cut from free tier in April 2026. Flash-Lite is sufficient for a PoC (handles 250 clients × 5 messages/day = 1,250 requests/day, slightly over but acceptable). Upgrade to paid tier if approaching limits.
- **Token Limit:** 250,000 tokens-per-minute (TPM), 1 million token context window.
- **Function-Calling Support:** Yes, via the `tools` parameter in GenerateContentRequest. Define booking actions (create_booking, cancel_booking, check_availability) as tool definitions. Gemini will call these; you execute them in your Node backend.
- **No MCP Needed:** While MCP (Model Context Protocol) is increasingly adopted in 2025, it adds abstraction overhead. For this PoC, use Gemini's native function-calling directly—simpler, no extra server process, and sufficient for a single-service-number bot.

### Calendar Sync Layer: Google Calendar API

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **googleapis** | 118.0+ | Calendar event CRUD (create, update, delete) | Official Google client library. Handles OAuth 2.0 flows and calendar.events.insert/update/delete. Well-tested for Node.js. |

- **Authentication:** OAuth 2.0 with `https://www.googleapis.com/auth/calendar` scope. Owner must authorize the bot to access their personal Google Calendar (consent screen shown once at setup).
- **Key Workflow:** On confirmed booking, call `calendar.events.insert()` to create the event. On cancellation, call `calendar.events.delete()`. On time/details change, call `calendar.events.update()`.
- **Rate Limit:** Google Calendar API free tier allows up to 500 queries/user/day. For a PoC with 1 business, this is unlimited headroom.

### Database Layer: Neon PostgreSQL + Drizzle ORM

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Neon** | (serverless DB) | PostgreSQL database | Serverless, per-query pricing, free tier: 100 CU-hours/month (doubled Oct 2025), 0.5 GB storage per project, 5 GB aggregate. Optimized for fly.io webhook workloads. No cold starts; instantaneous. |
| **drizzle-orm** | 0.30+ | ORM + query builder | ~7.4 KB minified (Prisma is 1.6 MB—200× larger). Zero dependencies. Built-in Row Level Security (RLS) support for PostgreSQL multi-tenant isolation. ~500 ms cold starts vs Prisma's 1–3 sec. Excellent Neon integration out-of-box. SQL-like control, great TypeScript support. |

- **Multi-Tenant Schema:** Drizzle's `crudPolicy()` helper simplifies RLS policies for Neon:
- **Connection Pooling:** Neon provides PgBouncer pooled connections (up to 10,000 connections). Use Drizzle's connection string with `?sslmode=require` for secure connections.
- **Schema Outline (Drizzle):**
- **Free Tier Headroom:** 100 CU-hours = ~2.4 million queries/month for a typical PoC. If one business averages 200 bookings/month, you're well within limits.
- **Why Not Prisma?** Prisma is heavier (1.6 MB bundle, 1–3 sec cold starts), no built-in RLS, and overkill for a webhook-driven PoC. Drizzle's lean, SQL-forward approach is better for serverless.

### Storage Layer: Cloudflare R2

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **Cloudflare R2** | (object storage) | Store business photos, service images, documents | Free tier: 10 GB storage + 1M Class A (write) + 10M Class B (read) ops/month. Zero egress fees (unlike S3). Owner already has account. Integrates via simple S3-compatible API. |

- **Free Tier Ceiling:** 10 GB is sufficient for a PoC (profile pics, service photos, receipts for 100–200 businesses = ~1–2 GB).
- **Cost Beyond Free Tier:** $0.015/GB/month storage + $0.0000015/Class A op + $0.0000002/Class B op. Egress always free.
- **Use Case:** Store business logos, service images, appointment receipts/confirmations (optional for v1).

# OR use S3-compatible SDK:

### Hosting Layer: fly.io + fly Machines

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| **fly.io** | (PaaS) | Deploy webhook-driven Node.js app | $0 option: use existing account's free trial (2 hours or 7 days) **OR** legacy free tier if already on Hobby plan. After trial: ~$1.94/month for 1 always-on Machine (shared-cpu-1x, 256 MB RAM). fly.toml auto-deployment, built-in monitoring. |
| **Supercronic** | (cron runner) | Daily agenda reminders, appointment reminders | Run as a second fly.io process (scale: 1 to avoid duplicates). fly.toml: `[processes] app = "npm run server" cron = "supercronic /app/crontab"`. Triggers daily at set times (e.g., 8 AM for daily agenda, 30 min before each appointment for reminders). |

- **Free Tier Status (2025-2026):** New sign-ups get a 2-hour trial (or 7 days, whichever ends first). You likely qualify as an existing user; if not, $1.94/month is negligible for a PoC. After trial, apps stop until you add a credit card.
- **Webhook Hosting:** fly.io Machines auto-scale from 0 (if idle >5 min) but restart on incoming request. No cold-start latency visible to the user (fly.io spins up before webhook delivery).
- **Cron Jobs:** Use Supercronic (already mentioned). Define a `crontab` file:
- **Environment Variables:** Store in `fly.secrets` (accessed via fly.toml `[env]`).

# fly.toml

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **dotenv** | 16.0+ | Environment variable management | Load `.env` in development; fly.secrets in production. |
| **@google-cloud/local-auth** | 2.1+ | OAuth 2.0 device flow for Google Calendar | Optional; simplifies local dev testing of OAuth. In production, use pre-authorized service account or OAuth consent screen. |
| **pino** | 8.0+ | Structured logging | Fly.io integrates well; log to stdout for aggregation. |
| **zod** | 3.22+ | Runtime schema validation | Validate WhatsApp webhook payloads, user input, environment config. |

## Alternatives Considered & Rejected

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| **Messaging** | WhatsApp/WhatsApp-Nodejs-SDK | Twilio WhatsApp | Twilio adds cost ($0.01–0.05/message) + complexity layer. Meta's official SDK is free + direct. |
| **AI Model** | Google Gemini 2.5 Flash-Lite (free tier) | OpenAI GPT-4 free tier | OpenAI has no free tier (API is paid). Gemini free tier meets PoC needs. |
| **AI SDK** | @google/genai | @google/generative-ai | Legacy SDK, support ends Aug 2025. New projects must use @google/genai. |
| **ORM** | Drizzle ORM | Prisma | Prisma is 200× larger, no RLS support, slower cold starts. Drizzle optimized for serverless + multi-tenant. |
| **ORM** | Drizzle ORM | Raw SQL via `pg` library | Raw SQL loses type safety and multi-tenant isolation helpers. Drizzle gives both. |
| **Database** | Neon (serverless) | Traditional managed Postgres (Heroku, DigitalOcean) | Managed options cost $12+/month; Neon free tier sufficient for PoC. Can migrate later. |
| **Calendar Sync** | Google Calendar API | iCal feed export | One-way export doesn't support updates/deletions. API required for booking management. |
| **Storage** | Cloudflare R2 | AWS S3 | R2 zero egress (S3 charges $0.09/GB out); R2 cheaper and already available. |
| **Hosting** | fly.io | Heroku | Heroku sunset free tier in 2022; now ~$5+/month minimum. fly.io free trial or $1.94/month. |
| **Hosting** | fly.io | Vercel (serverless) | Vercel optimized for Next.js frontend; webhook handling works but less intuitive. fly.io is webhook-native. |
| **Cron** | Supercronic (fly.io) | External service (Cron-job.org) | External service adds latency + unreliability. Supercronic runs in-process on fly.io. |
| **Cron** | Supercronic (fly.io) | Temporal.io | Temporal is powerful but overkill + adds infrastructure. Simple Supercronic sufficient for PoC. |
| **Node.js Version** | 20+ (LTS) | Node 18 | @google/genai requires 20+. Use latest LTS (20.x or 22.x). |

## Free-Tier Limits: The Ceiling for This PoC

| Service | Free Tier | PoC Estimate | Headroom |
|---------|-----------|------|----------|
| **WhatsApp** | Unlimited service conversations | 50–200 customers/day × 5 msgs each = 250–1000/day | ✅ Unlimited (message tier limit kicks in at 250+ new conversations/24h) |
| **Gemini API** | 1,000 requests/day (Flash-Lite) | 50 customers × 10 interactions = 500/day | ✅ 2× headroom |
| **Neon** | 100 CU-hours/month | ~2–3M queries/month | ✅ 10× headroom |
| **Neon Storage** | 0.5 GB/project | Bookings DB ~10–50 MB | ✅ 50× headroom |
| **Cloudflare R2** | 10 GB storage | Business photos, receipts ~1–2 GB | ✅ 5× headroom |
| **fly.io** | 2-hour or 7-day trial | PoC development only | ❌ Requires $1.94/month after trial |
| **Google Calendar** | 500 calls/user/day | 1 business × 50 bookings/day = 50 calls | ✅ 10× headroom |

## Installation & Quick Start

# Initialize Node project

# Initialize Drizzle

# Create fly.toml

## Configuration Checklist

- [ ] Meta Developers account: WhatsApp Business app, phone number, access token
- [ ] Google Cloud Console: Gemini API key (free tier), Calendar API key
- [ ] Neon account: Postgres DB, connection string
- [ ] Neon database: Run migrations (Drizzle)
- [ ] Cloudflare account: R2 bucket, API token
- [ ] fly.io account: App created, `fly.toml` configured, secrets set
- [ ] Environment variables: `.env.local` for dev, `fly secrets` for prod

## Testing the Stack

- **WhatsApp Webhook:** Use Meta's webhook testing tool or send a test message to your business number
- **Gemini API:** Simple HTTP client to test function-calling with a booking request
- **Neon + Drizzle:** Run a query via `npm run db:studio` (Drizzle Studio)
- **Google Calendar:** Authorize once, create a test event, verify in your calendar
- **fly.io Deployment:** `fly deploy` and watch logs with `fly logs`

## Sources

### WhatsApp Cloud API

- [WhatsApp/WhatsApp-Nodejs-SDK (Meta Official)](https://github.com/WhatsApp/WhatsApp-Nodejs-SDK)
- [WhatsApp Business Platform Pricing 2026](https://blueticks.co/blog/whatsapp-business-api-pricing-2026)
- [24-Hour Conversation Window Guide](https://www.saysimple.com/blog/whatsapp-business-api-what-is-a-customer-care-window)

### Google Gemini API

- [Rate limits | Gemini API](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini API Free Tier 2026 Guide](https://www.aifreeapi.com/en/posts/gemini-api-free-tier-complete-guide)
- [@google/genai vs @google/generative-ai Migration](https://discuss.ai.google.dev/t/confused-about-google-generative-ai-google-genai-and-all-hosted-repos/79022)

### Google Calendar API

- [Node.js Quickstart | Google Calendar](https://developers.google.com/workspace/calendar/api/quickstart/nodejs)
- [googleapis Documentation](https://googleapis.dev/nodejs/googleapis/latest/calendar/classes/Calendar.html)

### ORMs

- [Drizzle ORM vs Prisma (2026 Comparison)](https://www.bytebase.com/blog/drizzle-vs-prisma/)
- [Prisma vs Drizzle for Startups](https://www.buildmvpfast.com/blog/prisma-vs-drizzle-orm-startup-comparison-2026)

### Databases

- [Neon Free Tier Limits 2025-2026](https://neon.com/docs/introduction/plans)
- [Neon Pricing Breakdown](https://checkthat.ai/brands/neon/pricing)

### Cloud Services

- [Fly.io Free Tier 2026](https://www.saaspricepulse.com/blog/flyio-free-tier-2026)
- [Fly.io Task Scheduling Guide](https://fly.io/docs/blueprints/task-scheduling/)
- [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)

### MCP & AI Architecture

- [Model Context Protocol (MCP) in 2025](https://blog.modelcontextprotocol.io/posts/2025-11-25-first-mcp-anniversary/)
- [MCP for AI Agents: Orchestration Review](https://arxiv.org/pdf/2508.02979)

## Confidence Assessment

| Area | Confidence | Reasoning |
|------|------------|-----------|
| **WhatsApp SDK** | HIGH | Official Meta SDK, well-maintained, TypeScript support verified. |
| **Gemini API** | HIGH | Google docs current (May 2026). @google/genai is official recommended SDK; @google/generative-ai deprecation confirmed. |
| **Google Calendar API** | HIGH | Official Google library, stable, widely used. |
| **Drizzle ORM** | HIGH | Active maintenance, Neon integration documented, multi-tenant RLS support proven in production SaaS apps. |
| **Neon Free Tier Limits** | HIGH | Neon docs updated Oct 2025; free tier limits confirmed (100 CU-hours, doubled from 50). |
| **fly.io Free Tier** | HIGH | Free trial confirmed (2-hour or 7-day); legacy free tier removed in 2024. Current status verified across multiple sources. |
| **Cloudflare R2** | HIGH | R2 free tier stable; pricing and limits published. |
| **MCP Recommendation (Skip)** | MEDIUM | MCP is mature (adopted by OpenAI, Google, Microsoft in 2025), but for a single-service PoC, direct function-calling with Gemini is simpler. MCP adds abstraction if you later need multi-LLM or complex orchestration. |

## Phase-Specific Notes

- **Phase 1 (Infrastructure & Setup):** Priorities are WhatsApp webhook registration, Neon DB init, Gemini API key, fly.io deployment. Drizzle migrations must run before any booking logic.
- **Phase 2 (AI Agent & Booking Logic):** Gemini function-calling to create/cancel bookings. Test locally first; mock WhatsApp messages. No MCP; direct function definitions in Gemini request.
- **Phase 3 (Calendar Sync & Reminders):** Google Calendar API integration + Supercronic for reminders. Test cron locally with a fake time-advance or scheduled job simulator.
- **Later Phases:** If scaling beyond 1–2 businesses, evaluate paid Gemini tier or upgrade WhatsApp to verification + higher conversation limits.

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
