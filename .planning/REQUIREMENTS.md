# Requirements: RandevuClaw v1.1

**Milestone:** v1.1 — Per-Business Bots & Telegram PoC Completion  
**Goal:** Pivot from shared platform bot to per-business Telegram bots; enable owner self-serve onboarding via chat; close Telegram PoC with GDPR compliance and production resilience.  
**Status:** Active  
**Last updated:** 2026-07-10

---

## v1.1 Requirements

### Bot Infrastructure

- [x] **BOT-01**: Owner can register a Telegram bot by submitting their bot token via chat; platform automatically calls Telegram's `setWebhook` API to activate it
- [x] **BOT-02**: All Telegram webhooks route via `/webhooks/telegram/:botToken`; each incoming request is matched to the correct business by token lookup
- [x] **BOT-03**: Each registered bot token has a unique HMAC webhook secret; all incoming webhook requests are verified with constant-time comparison
- [x] **BOT-04**: Telegram client layer is migrated from `node-telegram-bot-api` to Telegraf 4.15+; all existing booking and owner flows continue working unchanged
- [x] **BOT-05**: PostgreSQL RLS policies enforce per-business DB isolation; cross-tenant row access is impossible even if application code omits a `WHERE business_id` clause

### Owner Onboarding

- [x] **ONB-01**: Owner completes a guided chat conversation to configure their business: name, weekly hours per day, and each service (name, price, duration in minutes)
- [x] **ONB-02**: Onboarding state is persisted to the database; an owner who drops off mid-flow can resume exactly where they left off without restarting
- [ ] **ONB-03**: Owner can edit their business configuration after initial setup via chat: update hours, add/remove services, change prices
- [x] **ONB-04**: All hardcoded fixture/seed businesses are removed; every business in the system is the result of an owner completing the onboarding flow

### GDPR & Compliance

- [ ] **COMP-02** *(continues from v1.0 Active)*: Client or owner sends a data-deletion request via chat (e.g., "διαγράψτε τα δεδομένα μου") and receives confirmation once completed
- [ ] **COMP-03**: Soft-deleted data is permanently hard-deleted by a background job 30 days after the deletion request
- [ ] **COMP-04**: A deletion audit log records every deletion request and its completion; the log is retained independently of the deleted data

### Rate-Limit Resilience

- [ ] **RESIL-01**: All Gemini API calls are processed through an in-process p-queue with concurrency limits; no messages are dropped under burst load within the free-tier rate limit

---

## Future Requirements (Deferred)

| ID | Requirement | Deferred To |
|----|-------------|-------------|
| PLAT-01 | Deep-link business resolution on shared WhatsApp number | v1.2+ (blocked on Meta BV) |
| COMP-01 | Client shown data-consent notice on first contact | v1.2+ (code complete; needs live WhatsApp to be observed) |
| OWNR2-01 | Web dashboard as alternative to chat for owner management | v2.0 |
| OWNR2-02 | Waitlist for fully-booked slots | v2.0 |
| BOOK2-01 | Cancellation cutoff window (notice-period rule) | v2.0 |

---

## Out of Scope (v1.1)

| Item | Reason |
|------|--------|
| Meta Business Verification | External 1–6 week process; defer until Telegram PoC is perfected |
| WhatsApp activation | Depends on Meta BV; deferred to v1.2+ |
| Per-business WhatsApp numbers | Requires Meta BV per business; post-PoC |
| Platform operator admin dashboard | Not needed for PoC; owners self-configure via chat |
| Business owner web dashboard | Breaks "chat-only" PoC principle |
| Multi-staff / per-instructor calendars | Single shared schedule sufficient for PoC |
| Payments / deposits | Out of scope per original constraints |
| English language support | Greek-only for PoC |
| Queue persistence (Postgres-backed p-queue) | In-process queue sufficient for PoC; revisit if crashes occur |

---

## Traceability

| REQ-ID | Phase | Plan |
|--------|-------|------|
| BOT-01 | Phase 5 | — |
| BOT-02 | Phase 4 | — |
| BOT-03 | Phase 4 | — |
| BOT-04 | Phase 4 | — |
| BOT-05 | Phase 4 | — |
| ONB-01 | Phase 5 | — |
| ONB-02 | Phase 5 | — |
| ONB-03 | Phase 5 | — |
| ONB-04 | Phase 5 | — |
| COMP-02 | Phase 6 | — |
| COMP-03 | Phase 6 | — |
| COMP-04 | Phase 6 | — |
| RESIL-01 | Phase 6 | — |
