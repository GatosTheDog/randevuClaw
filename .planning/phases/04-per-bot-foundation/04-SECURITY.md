---
phase: 4
slug: per-bot-foundation
status: verified
threats_open: 0
asvs_level: 1
created: 2026-07-14
---

# Phase 04 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| config→app | Environment variables into config.ts; TELEGRAM_BOT_TOKEN removed, bot tokens now per-business in DB | Bot tokens (HIGH sensitivity) |
| log output→operator | Pino serializes business rows; redaction prevents token leakage | Bot token, webhook secret |
| withBusinessContext→appDb | SET LOCAL scopes RLS context to transaction; appDb = randevuclaw_app role | business_id context var |
| getConn() fallback | Outside withBusinessContext, returns admin db (intended for pollers/pre-auth only) | Cross-tenant admin access |
| Telegram→Express | Incoming POST /:webhookId from internet; webhookId is attacker-controlled until HMAC passes | Webhook payload |
| Express→appDb | After HMAC, withBusinessContext sets RLS tenant | Business-scoped queries |
| botTokenStore→callTelegramApi | Bot token flows through AsyncLocalStorage to Telegram API URL; never logged | Bot token (TLS only) |
| Test DB→RLS policies | rls-enforcement.test.ts uses appDb (randevuclaw_app); RLS must be active for tests to have meaning | Tenant isolation |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-04-01 | Information Disclosure | businesses.bot_token column | high | mitigate | logger.ts redacts botToken at field, wildcard, and config namespace levels; column never logged | ✅ closed |
| T-04-02 | Tampering | RLS bypass via superuser connection | medium | mitigate | db (superuser) for pre-auth/migrations only; appDb (randevuclaw_app) for conversation handling; separation in db.ts (appPool/appDb exports) | ✅ closed |
| T-04-03 | Information Disclosure | DATABASE_APP_URL password exposure | medium | mitigate | .env.local in .gitignore; fly secrets for prod; migration SQL has CHANGE_ME placeholder | ✅ closed |
| T-04-04 | Information Disclosure | bot token in log output | high | mitigate | logger.ts redact: ['botToken', 'webhookSecret', '*.botToken', '*.webhookSecret', 'config.botToken', 'config.webhookSecret'] — 6 paths | ✅ closed |
| T-04-05 | Tampering | shared Telegraf instance across bots | high | mitigate | Map<string, Telegraf> registry enforces one instance per webhookId; clearBotRegistry() for test teardown | ✅ closed |
| T-04-06 | Information Disclosure | RLS context leakage via SET (not SET LOCAL) | critical | mitigate | withBusinessContext uses SET LOCAL (transaction-scoped); rls-enforcement.test.ts Test 2 verifies isolation across sequential transactions | ✅ closed |
| T-04-07 | Elevation of Privilege | findBookingByIdUnscoped bypass | medium | accept | Intentionally unscoped for callback_query ownership check (T-02-20 rationale); subsequent ownership verification via findBusinessById uses RLS-enforced getConn() | ✅ closed (accepted) |
| T-04-08 | Information Disclosure | botToken in callTelegramApi URL | high | mitigate | Token in TLS URL only; all logger calls in telegram.ts use {webhookId, updateId, senderTelegramId, updateType, err} — no botToken field; pino redaction as defense-in-depth | ✅ closed |
| T-04-09 | Spoofing | POST /webhooks/telegram/:webhookId | high | mitigate | findBusinessByWebhookId (404 on unknown) + crypto.timingSafeEqual HMAC check (401 on invalid) before any update processing | ✅ closed |
| T-04-10 | Tampering | HMAC verification — timing attack | high | mitigate | crypto.timingSafeEqual() exclusively — string equality (===) forbidden; confirmed at telegram.ts:215 | ✅ closed |
| T-04-11 | Information Disclosure | Bot token in logs or URL | high | mitigate | URL uses webhookId (UUID); all 8 logger calls in telegram.ts use structured fields excluding botToken/webhookSecret | ✅ closed |
| T-04-12 | Elevation of Privilege | Cross-tenant DB if withBusinessContext skipped | critical | mitigate | withBusinessContext called 4× in telegram.ts wrapping handleFoundBusiness + handleCallbackQuery; RLS at DB layer as backstop | ✅ closed |
| T-04-13 | Spoofing | UUID enumeration for webhookId | low | accept | UUID v4 keyspace 2^122; each UUID still requires matching HMAC secret | ✅ closed (accepted) |
| T-04-14 | Information Disclosure | RLS context leakage (SET LOCAL) | critical | mitigate | Same as T-04-06; 2 SET LOCAL occurrences in queries.ts; verified by rls-enforcement tests | ✅ closed |
| T-04-15 | Information Disclosure | RLS test silently passing with superuser | medium | mitigate | Skip guard at rls-enforcement.test.ts:37 checks DATABASE_APP_URL; explicit test.skip message when absent | ✅ closed |
| T-04-16 | Tampering | Schema push to wrong database | medium | mitigate | drizzle-kit reads DATABASE_URL from environment; idempotent column additions; manual verify step in plan | ✅ closed |
| T-04-06-01 | Tampering | test/fixture data | low | accept | Test-only changes; no production data paths touched | ✅ closed (accepted) |

---

## Accepted Risks Log

| Threat ID | Accepted By | Rationale | Residual Risk |
|-----------|-------------|-----------|---------------|
| T-04-07 | Plan 04-03 design | findBookingByIdUnscoped intentionally unscoped for ownership pre-check; T-02-20 documented rationale; subsequent ops use RLS | low |
| T-04-13 | Plan 04-04 design | UUID v4 keyspace + HMAC requirement makes enumeration infeasible | low |
| T-04-SC variants | Per-plan review | No new npm packages in plans 01/03/04/05/06; telegraf@4.16.3 audited (200K+/week, official, actively maintained) | low |
| T-04-06-01 | Plan 04-06 design | Test/fixture-only changes; no production data paths touched | low |

---

## Security Audit 2026-07-14

| Metric | Count |
|--------|-------|
| Threats in register | 17 |
| CRITICAL threats | 3 (T-04-06, T-04-12, T-04-14) |
| HIGH threats | 7 |
| MEDIUM threats | 5 |
| LOW threats | 2 |
| Closed (mitigated) | 13 |
| Closed (accepted) | 4 |
| Open | 0 |
| ASVS level | 1 (L1 grep depth) |
| register_authored_at_plan_time | true |
| Block threshold | high |

**Result: threats_open: 0 — no blocking threats remain.**
