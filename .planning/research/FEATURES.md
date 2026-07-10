# Feature Landscape: v1.1 Per-Business Bots & Telegram PoC Completion

**Domain:** Multi-tenant SaaS booking platform with per-business Telegram bots (Greek service businesses)
**Researched:** 2026-07-10
**Research Confidence:** HIGH

## Executive Summary

The v1.1 feature set consists of five interrelated capabilities that transform RandevuClaw from a single-business PoC (hardcoded fixtures) to a multi-tenant platform with owner self-serve onboarding. Each feature builds on existing v1.0 foundation (booking logic, calendar sync, reminders). The key distinction is that v1.1 shifts from a shared platform bot to per-business bots, which eliminates the need for business disambiguation and enables each business to own their Telegram presence entirely.

Production multi-bot platforms (e.g., BotMux, BotHippo) handle this via webhook routing by bot token + secret token verification. Chat-based onboarding follows established SaaS patterns: progressive profiling, error recovery via quick-reply buttons, and validation loops. Multi-tenant safety requires PostgreSQL Row-Level Security (RLS) as a database-layer safety net, not just application-level tenant filtering. GDPR compliance mandates audit trails and immutable backup handling. Rate-limit resilience under free-tier Gemini (15 req/min) demands exponential backoff + request queueing, not optimistic retries.

---

## Table-Stakes Features

Features users expect for a functioning multi-tenant platform. Missing = product breaks or data leaks.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Per-business Telegram bot creation & token management** | Each business owner must be able to create their own bot via BotFather and provide the token to the platform. Without this, businesses cannot own their Telegram presence. | Medium | Requires secure token storage (environment/secret manager), webhook routing by token, and secret_token verification per request. BotMux pattern: route `/webhooks/telegram/:botToken`, verify X-Telegram-Bot-Api-Secret-Token header. |
| **Webhook routing by bot token** | Platform must route incoming Telegram messages to the correct business based on which bot received it. Without this, cross-tenant message routing fails and data leaks occur. | Medium | Route via URL parameter (e.g., `/webhooks/telegram/{botToken}`) or header. Verify secret_token (constant-time comparison) before processing. No exception — this is a safety gate. |
| **Tenant identification middleware** | Every API request must be mapped to a tenant (business_id) before touching the database. Application-level filtering alone is insufficient. | Low | Middleware extracts business_id from webhook route (`:botToken` → `business_id` via lookup) and threads it into request context. Used by RLS policies below. |
| **PostgreSQL Row-Level Security (RLS) policies** | Database must enforce tenant isolation at the row level, not application logic. If app code forgets to filter by tenant_id, Postgres blocks it. | High | Drizzle ORM supports RLS policies via `crudPolicy()`. Requires ALTER TABLE ... ENABLE ROW LEVEL SECURITY. Set `app.current_tenant_id` at connection time. High setup cost, infinite payoff. |
| **Business configuration via chat** | Owner must be able to set up their business (name, hours per day, services, prices, durations) entirely via Telegram chat messages, not a web form. | High | Progressive profiling: bot asks "What's your business name?", owner replies, bot validates, bot asks "What are your hours?", etc. Matches v1.0 chat-only design. Must handle re-entry (owner edits name later). |
| **Secure token storage** | Bot tokens must not be hardcoded or logged. Stored in database (encrypted or plaintext) with access restricted to tenant owner. | Low–Medium | Use Node.js crypto to encrypt tokens at rest if paranoia demands, or trust Postgres + Neon row-level security. Store in a `bot_tokens` table with foreign key to business. Add audit log trigger. |
| **Client data deletion on request** | When a client sends "διαγράψτε τα δεδομένα μου" (delete my data), their bookings + phone number must be deleted (or soft-deleted with audit trail). | Medium | Hard delete: remove record entirely. Soft delete: mark with deleted_at timestamp. Add audit log entry. Drizzle schema must support both. GDPR requires this within 30 days. |
| **Owner data deletion on request** | When an owner sends the same deletion request, all their business data must be purged or anonymized. | High | Cascade: delete business → delete all bookings, services, audit logs. Or soft-delete business (deleted_at). Trickier than client deletion because of relationships. Audit trail mandatory. |
| **Audit trail for all tenant-related events** | Platform must log every cross-tenant access attempt, every token lookup, every deletion. Regulators + you need to investigate breaches. | Medium | Add audit table: `tenant_audit_logs(id, tenant_id, user_id, action, timestamp, ip_address, user_agent, result)`. Trigger on sensitive queries (tokens, deletions, business config changes). Query cost is low if indexed. |

---

## Differentiator Features

Features that set RandevuClaw apart. Not expected, but create competitive advantage when present.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Interactive guided onboarding (carousel of quick-replies)** | Instead of free-text input, bot shows buttons for common options. E.g., "How many hours/day do you operate?" → buttons: "6 hours", "8 hours", "10 hours", "Custom". Reduces typos, feels smoother. | Medium | Telegram InlineKeyboardMarkup. Collect inputs, validate, then confirm in a summary message before saving. Also enables re-editing (owner taps a button to re-enter hours). |
| **Graceful rate-limit recovery** | When Gemini hits 15 req/min free-tier limit, platform queues requests, retries with exponential backoff, and never drops a user message. Clients don't see "error" — their booking still succeeds 30s later. | High | Async task queue (Redis/Bull or in-memory queue for small PoC). Separate orchestration layer: Telegram webhook → queue → Gemini LLM. Backoff: 1s, 2s, 4s, 8s... up to 60s. |
| **Context caching for Gemini system prompt** | Reuse the same system prompt (Greek booking instructions, business hours, services list) for multiple user messages in one conversation. Reduces tokens, improves latency. | Medium | Gemini API `cacheControl: "ephemeral"` on system messages. Requires @google/genai 2.10.0+. Cache hits return results faster + count differently against quota. |
| **Backup data anonymization for GDPR** | When a user requests deletion, flag backups as "marked for destruction" (they'll be overwritten on next rotation). GDPR regulators accept this as compliant. Actual delete can wait for backup cycle. | Medium | GDPR Feb 2026 Coordinated Enforcement Framework confirms: immutable backups don't need immediate physical deletion if marked for overwrite. Reduces operational complexity. |
| **Owner re-onboarding flow** | Owner changes their business hours or adds a new service mid-PoC. Platform allows editing via chat without data loss. I.e., "Change your hours?" → buttons: "Yes", "No" → if yes, re-run the hours input flow. | Low | Store current business config in context. On re-entry, show current values as defaults. Use callback_query with inline buttons to allow quick edits. |
| **Cross-tenant audit report** | Owners can view a log of who accessed their data and when (e.g., "Platform bot queried your bookings at 14:32 UTC"). Builds trust + helps compliance. | Medium–High | Expose in an optional command (e.g., `owner_audit_log()` returns last 7 days). Telegram-based view or link to a private audit CSV. Privacy by design. |

---

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Per-business WhatsApp numbers (v1.1 scope)** | Meta Business Verification per business requires 1-6 weeks approval per account. PoC cannot afford this delay. Later (v1.2+) once verification is streamlined. | Stick with per-business Telegram bots for v1.1. WhatsApp activation deferred until v1.2. |
| **Web dashboard for owner configuration** | Breaks the "chat only" principle established in v1.0. Added complexity, requires frontend hosting, auth, etc. Not MVP. | Keep onboarding 100% in Telegram chat. No web UI for v1.1. |
| **Multi-staff scheduling per business** | Multiple instructors, each with their own calendar. PoC assumes one shared schedule per business. | Document as out-of-scope. Small salons/studios typically have one schedule. Revisit post-PoC if demand. |
| **Soft deletes without hard deletion option** | GDPR right to erasure means complete deletion on request, not just hiding. Soft delete alone does not satisfy Article 17. | Offer hard delete by default; soft delete only for backup retention (with overwrite deadline). Dual-mode: soft-deleted records hidden from UI but still hard-deleted in backups. |
| **Storing bot tokens in plaintext in logs or code** | Tokens are API credentials. Logging them is a security incident. Code visibility (GitHub) makes it worse. | Encrypt tokens at rest (or rely on Postgres RLS). Never log request bodies containing tokens. Audit log token lookups only, not token values. |
| **Assuming application-level tenant filtering is sufficient** | If code forgets to filter by tenant_id on one query, a client can see another business's bookings. RLS at database layer catches this. | Mandatory: PostgreSQL RLS policy on every table. Application filtering is best-effort; database is the safety net. |
| **Ignoring Gemini rate limits in free tier** | 15 req/min is not enough for any real traffic. Ignoring it means crashes and dropped bookings under load. | Queue all requests; implement exponential backoff. Monitor 429 errors. Upgrade to paid Gemini tier if PoC succeeds. |
| **Deleting backups immediately on GDPR request** | Backup deletion is operationally complex and expensive. GDPR allows "marked for destruction" as compliant. | Mark data as deleted in DB, set expiration date on backups. Backups expire on rotation (e.g., 30 days). Audit log the mark, not the delete. |
| **Requiring owners to manually verify webhook URLs** | Owners are not engineers. Manual webhook setup is error-prone and creates support burden. | Platform automatically handles webhook registration: owner provides token → platform calls Telegram setWebhook. Owner sees "Webhook registered ✓" in chat. |
| **Allowing free-text bot token input without validation** | Owner typos the token → webhook never fires → owner thinks platform broke. | Validate token format (42 chars, digits + colon) immediately. Call Telegram getMe with token to confirm it's valid. Fail fast with user-friendly error. |

---

## Feature Dependencies & Sequencing

```
Per-Business Bot Management
├─ Telegram BotFather token input (owner creates bot externally, provides token)
├─ Secure token storage in DB with RLS
├─ Webhook routing by token (routes message to correct business)
├─ Secret token verification (verify X-Telegram-Bot-Api-Secret-Token header)
└─ Tenant ID extraction middleware (maps token → business_id for all requests)

Owner Self-Serve Onboarding
├─ Tenant ID middleware (required: know which business we're onboarding)
├─ Progressive profiling chat flow (ask → validate → confirm → save)
│  ├─ Business name input
│  ├─ Hours per day input (with interactive buttons)
│  ├─ Services + prices + durations input
│  └─ Confirmation & summary
├─ Business config persistence (drizzle schema: `businesses` table with RLS)
└─ Re-entry/editing (owner can re-trigger onboarding to change settings)

Multi-Tenant Safety Layer
├─ Tenant ID middleware (prerequisite)
├─ PostgreSQL RLS policies on all tables
│  ├─ `businesses` — only business owner can read/write
│  ├─ `bookings` — business owner can read/write; client can read own bookings
│  ├─ `services` — business owner can read/write
│  └─ Similar for all other tables
├─ Audit table with RLS (track all cross-tenant access attempts)
└─ Constant-time token comparison (prevent timing-attack token guessing)

GDPR Data Deletion
├─ Tenant ID middleware + RLS (prerequisite)
├─ Chat-based deletion trigger ("διαγράψτε τα δεδομένα μου")
├─ Dual-mode deletion (hard delete for active data; soft delete for backups)
├─ Audit log entry for every deletion request
├─ Cascade delete: client deletion → remove all bookings; owner deletion → remove business + all related data
└─ Backup expiration policy (mark backups for destruction on deletion; overwrite on next rotation)

Gemini Rate-Limit Resilience
├─ Async request queue (in-process or Redis)
├─ Exponential backoff on 429 RESOURCE_EXHAUSTED errors
├─ Context Caching for system prompts (reduce token usage, improve resilience)
├─ Fallback to Gemini Flash-Lite if Pro overloaded (if applicable)
├─ Monitoring/alerting on rate-limit hits
└─ NO silent failures — queue must retry successfully or alert operator
```

**Sequencing Recommendation:**
1. Per-Business Bot Management (enables multi-tenant architecture)
2. Tenant ID Middleware + RLS Setup (foundation for safety)
3. Owner Self-Serve Onboarding (replaces hardcoded fixtures)
4. GDPR Data Deletion (legal requirement, can be added after features work)
5. Gemini Rate-Limit Resilience (polish, but critical before real traffic)

---

## UX Flow Descriptions

### Flow 1: Owner Creates Their Telegram Bot (External, Then Provides Token)

1. Owner (e.g., pilates studio owner) goes to Telegram BotFather (@BotFather)
2. Sends `/newbot` → BotFather asks for bot name → owner replies "PilatesSophia"
3. BotFather asks for username → owner replies "PilatesSophia_bot"
4. BotFather sends back API token (42-char string, e.g., `6391234567:ABCDEfg...`)
5. Owner copies token and sends it to RandevuClaw platform bot (registration/admin bot) with text "Setup my bot" + token pasted
6. Platform validates token format, calls Telegram getMe to confirm validity
7. If valid: Platform registers webhook, stores token securely, creates business record, sends "✓ Bot registered! Start by telling me your business name."
8. If invalid: Platform sends "That token didn't work. Did you copy it correctly? Here's the BotFather link: t.me/BotFather"

### Flow 2: Owner Self-Serve Onboarding (Progressive Profiling)

**Setup Business Name**
- Platform: "What's your business name?" (free-text input)
- Owner: "Sophia's Pilates Studio"
- Platform: "Got it! Sophia's Pilates Studio. Let's continue." (validates non-empty, <100 chars)

**Setup Hours per Day**
- Platform: "How many hours per day do you operate?"
- Platform shows buttons: [6 hours] [8 hours] [10 hours] [Custom hours]
- Owner taps [8 hours]
- Platform: "What time do you open? (e.g., 08:00)"
- Owner: "08:00"
- Platform: "Perfect! You operate 08:00 – 16:00 (8 hours). Is this correct?" [Yes] [Edit]
- Owner taps [Yes]

**Setup Services**
- Platform: "Let's add your services. Send me each service as: Service Name | Duration (min) | Price (EUR)"
- Platform: "Example: Pilates Class | 60 | 20"
- Owner: "Pilates Class | 60 | 20"
- Platform: "Added: Pilates Class (60 min, €20). Add another?" [Yes] [No]
- Owner: "Yes"
- Owner: "Private Session | 45 | 40"
- Platform: "Added: Private Session (45 min, €40). Any more?" [Yes] [No]
- Owner: "No"

**Confirmation & Save**
- Platform shows summary:
  ```
  Business Name: Sophia's Pilates Studio
  Hours: 08:00 – 16:00 (Mon–Sun)
  Services:
    • Pilates Class — 60 min, €20
    • Private Session — 45 min, €40
  
  Is this correct?
  ```
- Buttons: [Yes, Save] [Edit Name] [Edit Hours] [Edit Services]
- Owner taps [Yes, Save]
- Platform: "✓ Setup complete! Your bot is live. Clients can now book with you."

### Flow 3: Client Books Appointment via Business's Telegram Bot

1. Client finds Sophia's bot (@PilatesSophia_bot) on Telegram
2. Client sends: "I'd like to book a pilates class on Friday at 10am" (in Greek or English, Gemini handles both)
3. Platform:
   - Extracts business_id from bot token
   - Applies RLS: only Sophia's services/bookings visible
   - Calls Gemini with function `create_booking(service_id, date, time)`
   - Gemini confirms: "Pilates Class, Friday 10:00–11:00, €20. Confirm?" [Yes] [No]
4. Client: [Yes]
5. Platform creates booking, sends confirmation + Google Calendar event
6. Owner (Sophia) receives alert: "New booking: Pilates Class, Friday 10:00, Client: +30-6xx-xxx-xxxx. Accept?" [✓ Accept] [✗ Reject]
7. If accepted, event confirmed in calendar + client notified

### Flow 4: Client/Owner Requests Data Deletion

**Client-Initiated:**
1. Client sends (in Greek): "διαγράψτε τα δεδομένα μου" (delete my data)
2. Platform detects keyword, asks for confirmation: "This will delete your booking history and phone number. This cannot be undone. Confirm?" [Yes] [Cancel]
3. Client: [Yes]
4. Platform hard-deletes all client bookings + phone record, logs audit entry
5. Platform: "✓ Your data has been deleted."

**Owner-Initiated:**
1. Owner sends: "Διαγράψτε την επιχείρηση" (delete my business)
2. Platform asks: "This will delete your business, all services, all client bookings, and your data. Confirm?" [Yes] [Cancel]
3. Owner: [Yes]
4. Platform cascade-deletes business → services → bookings → owner record, logs audit entries with business_id + timestamps
5. Bot is deactivated (webhook removed)
6. Platform: "✓ Your business and all data have been deleted. The bot is now inactive."

### Flow 5: Gemini Rate-Limit Recovery (Invisible to User)

1. Client sends booking request: "Book me for next Tuesday at 3pm"
2. Platform queues request to async queue (with client_id, business_id, message_id)
3. Platform calls Gemini → gets 429 RESOURCE_EXHAUSTED (hit 15 req/min cap)
4. Queue retries with backoff: wait 1s, retry (fail) → wait 2s, retry (fail) → wait 4s, retry (success after ~7s)
5. Gemini returns booking confirmation
6. Platform sends response to client: "✓ Booked for Tuesday 15:00. Confirmation sent." (user sees no delay, just a 7s wait, which is natural)
7. If queue fails after max retries (5 min window), platform alerts operator and sends client: "Booking delayed — try again in a moment" (user can retry)

**Monitoring (Internal):**
- Operator sees dashboard: "Rate-limit hits: 12 in last hour. Queue depth: 3. Retry success rate: 95%."
- If consistently over limit, operator upgrades Gemini to paid tier

---

## Complexity Ratings

| Feature | Rating | Justification |
|---------|--------|---------------|
| Per-business bot creation & token management | **Medium** | One-time setup per business; validation + token storage straightforward. Webhook routing is the tricky part. |
| Webhook routing by bot token | **Medium** | Route logic is simple (`:botToken` → `business_id` lookup), but must be rock-solid for multi-tenant safety. |
| PostgreSQL RLS setup | **High** | Requires understanding of RLS policies, SET app.current_tenant_id, testing to ensure no loopholes. Easy to miss edge cases. |
| Owner self-serve onboarding | **High** | Multi-step chat flows, validation, re-entry, error recovery, and saving to DB. Lot of state management. |
| Secure token storage | **Low–Medium** | Encrypt or trust Postgres. Audit logging is the bigger effort. |
| Client data deletion | **Medium** | Hard delete is straightforward; soft delete + audit trail adds complexity. |
| Owner data deletion | **High** | Cascade across multiple tables (business → services → bookings → audit logs). Easy to miss a relationship. |
| Audit trail logging | **Medium** | Add table, trigger, index. Query overhead is negligible if indexed. |
| Graceful rate-limit handling | **High** | Async queue, exponential backoff, context caching, fallback logic. Requires careful testing under load. |

---

## MVP Recommendation

**Must-Have (v1.1 Phase 1):**
1. Per-business Telegram bot creation & token management
2. Webhook routing + secret token verification
3. Tenant ID middleware + PostgreSQL RLS
4. Owner self-serve onboarding (business name, hours, services)
5. Audit table + logging of critical operations
6. Client/owner deletion via chat (basic hard delete)

**Should-Have (v1.1 Phase 2):**
7. Interactive guided onboarding (buttons instead of free-text for hours/services)
8. Graceful Gemini rate-limit handling (queue + exponential backoff)
9. Owner re-entry/editing flow (change settings mid-PoC)
10. Backup expiration policy for GDPR compliance

**Nice-to-Have (v1.1 Phase 3+):**
11. Context Caching for Gemini system prompt
12. Cross-tenant audit report for owners
13. Fallback to Gemini Flash-Lite on overload

**Explicitly Out (v1.2+):**
- Per-business WhatsApp numbers (Meta verification required)
- Web dashboard for owners
- Multi-staff scheduling
- English language support

---

## Pitfalls & Mitigation

| Pitfall | Risk | Mitigation |
|---------|------|-----------|
| **Forgetting tenant_id filter on one query** | Data leak: owner A sees owner B's bookings. | Database RLS policy blocks this. Test via direct SQL: `SELECT * FROM bookings` without WHERE clause must fail. |
| **Storing bot tokens in plaintext + logging them** | Security breach if logs are exposed (GitHub, Sentry). | Encrypt tokens; never log token values. Audit log token lookups, not token contents. Code review checklist. |
| **Incomplete GDPR deletion (forgetting audit logs, backups)** | Compliance failure. Regulators find deleted data in backup. | Mark backups for destruction; set expiration date. Audit logs are exempt from Article 17 (allowed to keep indefinitely). Hard delete only production DB. |
| **Rate-limit silent failures** | Bookings dropped under load. User re-sends, double-booking results. | Queue + retry logic. Monitor 429s. Never silently fail. Alert operator. |
| **Webhook routing by username instead of token** | If two businesses have similar bot names, routing fails. | Route by token (unique per bot) only. Token is stable; bot names can collide. |
| **Assuming onboarding will be one-shot** | Owner needs to edit hours after launch. Data is gone. | Store all inputs; allow re-entry. Use callback_query buttons for edits. |
| **Cascading deletes without audit trail** | No way to investigate deletion requests later. Regulators can't verify compliance. | Log audit entry before each cascade. Include business_id, timestamp, requester, reason. |

---

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| **Per-Business Bot Management** | HIGH | BotMux + BotHippo patterns are well-established. Telegram documentation (setWebhook, secret_token) is current. Webhook routing by token is industry-standard. |
| **Owner Onboarding UX** | HIGH | SaaS chat-based onboarding is mature (WhatsApp Flows, Telegram keyboards). Research found clear best practices: progressive profiling, quick-reply buttons, error recovery loops. |
| **Multi-Tenant Safety** | HIGH | PostgreSQL RLS is mature (PostgreSQL 9.5+, used in production SaaS). Drizzle ORM has built-in support. Node.js middleware patterns are standard. Feb 2026 EDPB guidance on RLS compliance confirmed. |
| **GDPR Data Deletion** | HIGH | GDPR Article 17 is clear. Feb 2026 Coordinated Enforcement Framework clarifies backup handling: soft deletion + marked-for-destruction is compliant. Industry consensus on hard delete + audit trail. |
| **Gemini Rate-Limit Resilience** | HIGH | Exponential backoff is industry-standard. Gemini API documentation (May 2026) confirms 15 req/min free tier. Context Caching is documented in @google/genai. Google Cloud best practices confirmed. |
| **Telegram Webhook Security** | HIGH | Telegram official documentation current. secret_token feature is recommended since Telegram Bot API v6.1 (2021+). BotMux + Telebot reference implementations available. |

---

## Sources

### Multi-Bot & Webhook Routing
- [BotMux Documentation — Web-based command center for managing Telegram bots](https://docs.botmux.dev/docs/en)
- [GitHub — skrashevich/botmux: Multi-bot dashboard, reverse proxy, inter-bot routing](https://github.com/skrashevich/botmux)
- [Telegram Bot Manager & Automation Platform | BotHippo](https://bothippo.com/)

### SaaS Onboarding via Chat
- [WhatsApp for SaaS: Onboarding, Activation & Churn Reduction — aisensy](https://m.aisensy.com/blog/whatsapp-for-saas-companies/)
- [Chat UX Best Practices: From Onboarding to Re-Engagement — GetStream.io](https://getstream.io/blog/chat-ux/)
- [SaaS Chat & Messaging UX: Examples & Patterns (2026) — SaaSUI Design](https://www.saasui.design/blog/saas-chat-messaging-ux-patterns)

### Multi-Tenant Data Isolation & RLS
- [Multi-Tenant API in Node.js + PostgreSQL RLS (2026) — 1xAPI Blog](https://1xapi.com/blog/multi-tenant-api-nodejs-postgresql-row-level-security-2026)
- [Multi-Tenant SaaS Data Isolation: Row-Level Security, Tenant Scoping, and Plan Enforcement with Prisma — DEV Community](https://dev.to/whoffagents/multi-tenant-saas-data-isolation-row-level-security-tenant-scoping-and-plan-enforcement-with-1gd4)
- [Multi-Tenant Security in SaaS: Data Isolation Patterns That Actually Work — DEV Community](https://dev.to/oluwatosinolamilekan/multi-tenant-security-in-saas-data-isolation-patterns-that-actually-work-fk)
- [Postgres Row-Level Security for Multi-Tenant Apps (2026) — Nerd Level Tech](https://nerdleveltech.com/postgres-row-level-security-multi-tenant-nodejs-tutorial)

### GDPR Data Deletion & Compliance
- [Best Practices for GDPR-Compliant Data Deletion — reform.app](https://www.reform.app/blog/best-practices-gdpr-compliant-data-deletion)
- [GDPR Deletion Requests & Backups: How to Stay Compliant — ProBackup](https://www.probackup.io/blog/gdpr-and-backups-how-to-handle-deletion-requests)
- [GDPR Implementation: Building Data Deletion and Export APIs That Actually Work — Sohail x Codes, Medium](https://medium.com/@sohail_saifii/gdpr-implementation-building-data-deletion-and-export-apis-that-actually-work-833b34eb09f6)
- [GDPR Article 17: Data Erasure (Right to be Forgotten) Requests — WatchDog Security](https://watchdogsecurity.io/gdpr/data-erasure-request-handling)

### API Rate Limiting & Graceful Degradation
- [Gemini API Rate Limits Explained 2026: Check Current Quotas Without Hard-Coding Tables — YingTu](https://yingtu.ai/en/blog/gemini-api-rate-limits-explained)
- [Graceful Degradation Strategies for AI Agents Hitting Rate Limits in Production — Brandon Lincoln Hendricks](https://brandonlincolnhendricks.com/research/graceful-degradation-ai-agent-rate-limits)
- [Gemini API Inference Architecture: System Design for Production Traffic [2026] — Markaicode](https://markaicode.com/architecture/inference-architecture-with-gemini-api/)
- [Rate limits | Gemini API | Google AI for Developers](https://ai.google.dev/gemini-api/docs/rate-limits)

### Telegram Webhook & Bot Security
- [Marvin's Marvellous Guide to All Things Webhook — Telegram Core](https://core.telegram.org/bots/webhooks)
- [Telegram bot webhook setup: complete guide for developers — Teleclaw](https://teleclaw.bot/blog/telegram-bot-webhook-setup)
- [Secret Token in Telegram API: Secure Webhook Verification — Nguyen Thanh Luan](https://nguyenthanhluan.com/en/glossary/secret_token-for-setwebhook-en/)
- [Telegram Token: Get, Manage, and Secure Your Bot API Key — CodeWords](https://www.codewords.ai/blog/telegram-token)
