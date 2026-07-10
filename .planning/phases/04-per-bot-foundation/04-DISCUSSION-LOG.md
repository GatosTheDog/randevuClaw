# Phase 4: Per-Bot Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-10
**Phase:** 4-Per-Bot Foundation
**Areas discussed:** Telegraf integration boundary, Webhook routing key, Schema additions timing, RLS enforcement scope

---

## Telegraf Integration Boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Webhook adapter only | Telegraf handles webhook parsing/routing only; existing handlers stay unchanged | ✓ |
| Full handler replacement | Telegraf ctx.message + middleware replace all dispatch logic; requires rewriting handlers + tests | |
| You decide | Claude picks based on test-continuity risk | |

**User's choice:** Webhook adapter only

---

| Option | Description | Selected |
|--------|-------------|----------|
| Keep raw wrappers for sending | Outbound calls stay with callTelegramApi / sendTelegramMessage | ✓ |
| Use Telegraf ctx.reply / ctx.telegram | Unified Telegraf API for both in and out | |

**User's choice:** Keep raw wrappers for sending

---

| Option | Description | Selected |
|--------|-------------|----------|
| One Telegraf instance per bot | Map<webhookId, Telegraf>; each bot gets its own instance | ✓ |
| Single shared Telegraf instance | One instance routes all bots by routing key | |

**User's choice:** One Telegraf instance per bot

---

## Webhook Routing Key

| Option | Description | Selected |
|--------|-------------|----------|
| Actual bot token in URL | Route is /webhooks/telegram/:botToken; token in logs | |
| Per-bot UUID routing key | Route is /webhooks/telegram/:webhookId; token never in URL/logs | ✓ |
| Business slug | Route is /webhooks/telegram/:slug; human-readable but guessable | |

**User's choice:** Per-bot UUID routing key

---

| Option | Description | Selected |
|--------|-------------|----------|
| Platform generates HMAC secret | crypto.randomBytes(32) at registration; stored in DB | ✓ |
| Owner provides HMAC secret | Owner supplies their own secret during registration | |

**User's choice:** Platform generates on bot registration

---

| Option | Description | Selected |
|--------|-------------|----------|
| HMAC + timingSafeEqual immediately | Phase 4 adds full verification now; seeds include pre-generated secrets | ✓ |
| Keep string equality for Phase 4, HMAC in Phase 5 | Violates BOT-03 requirement | |

**User's choice:** HMAC + timingSafeEqual immediately

---

## Schema Additions Timing

| Option | Description | Selected |
|--------|-------------|----------|
| Drizzle migration with nullable columns + updated seeds | Migration 0003 adds nullable columns; seeds populated from env vars | ✓ |
| Non-null with defaults | NOT NULL with placeholder defaults; breaks seed data | |

**User's choice:** Drizzle migration with nullable columns + updated seeds

---

| Option | Description | Selected |
|--------|-------------|----------|
| Env vars for test bots | TEST_BOT_1_TOKEN/SECRET/WEBHOOK_ID (and bot 2 equivalents); seeds from env | ✓ |
| Hardcoded fake tokens in seed.ts | Fake token strings; HMAC check would fail | |
| Keep single TELEGRAM_BOT_TOKEN, duplicate for 2nd bot | Doesn't model Phase 5 architecture cleanly | |

**User's choice:** Env vars for test bots

---

| Option | Description | Selected |
|--------|-------------|----------|
| Remove global vars, use DB-driven config only | Clean break; config.ts removes telegramBotToken + telegramWebhookSecret | ✓ |
| Keep global vars as fallback | Backward compat; risk of tests using wrong path | |

**User's choice:** Remove global vars, use DB-driven config only

---

## RLS Enforcement Scope

| Option | Description | Selected |
|--------|-------------|----------|
| SET LOCAL in a transaction wrapper | Per-transaction scope; auto-cleared; no leakage via connection pool | ✓ |
| SET at connection level | Session-level; risk of pool reuse leaking tenant context | |
| Application-only (no RLS) | Violates BOT-05 | |

**User's choice:** SET LOCAL in a transaction wrapper

---

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated app role with RLS policies | randevuclaw_app non-superuser role; current_setting() in policies | ✓ |
| FORCE ROW LEVEL SECURITY on table owner | ALTER TABLE FORCE RLS; non-standard | |

**User's choice:** Dedicated app role with RLS policies

---

| Option | Description | Selected |
|--------|-------------|----------|
| All business-scoped tables | Every table with business_id + businesses itself | ✓ |
| Booking and messages tables only | Incomplete — violates BOT-05 | |

**User's choice:** All business-scoped tables (messages, clientBusinessRelationships, bookings, services, availability, telegramUpdates, calendarSyncQueue, businesses)

---

## Claude's Discretion

- Telegraf version (4.15+ per BOT-04; latest stable)
- Bot registry implementation shape (module-level singleton vs class vs factory)
- Transaction wrapper shape (utility function or thin helper)
- Migration execution order (Neon live + local test DB simultaneously)

## Deferred Ideas

- setWebhook automation → Phase 5 (BOT-01)
- Owner self-serve onboarding → Phase 5 (ONB-01 through ONB-04)
- Fixture/seed removal → Phase 5 (ONB-04)
- WhatsApp pivot + Meta BV todos → v1.2+
