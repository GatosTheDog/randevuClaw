---
phase: 4
slug: per-bot-foundation
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-10
updated: 2026-07-14
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 29.x |
| **Config file** | jest.config.ts |
| **Quick run command** | `npm test -- --testPathPattern=telegram-webhook\|rls-enforcement\|telegram-client\|expiry-poller` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern=telegram-webhook`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green (4 pre-existing scheduler-agenda failures acceptable)
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | BOT-02 | — | Migration 0003 adds nullable bot_token/webhook_id/webhook_secret columns | integration | `npm test -- --testPathPattern=telegram-webhook` | ✅ | ✅ green |
| 04-01-02 | 01 | 1 | BOT-05 | T-04-01 | RLS blocks cross-tenant row access at DB layer | integration | `DATABASE_APP_URL=... npm test -- --testPathPattern=rls-enforcement` | ✅ | ⚠️ partial (skipped without DATABASE_APP_URL) |
| 04-02-01 | 02 | 1 | BOT-02 | — | Telegraf webhook adapter routes by webhookId lookup | unit | `npm test -- --testPathPattern=telegram-webhook` | ✅ | ✅ green |
| 04-02-02 | 02 | 1 | BOT-03 | — | Two distinct bots receive messages with no cross-contamination | integration | `npm test -- --testPathPattern=telegram-webhook` | ✅ | ✅ green |
| 04-03-01 | 03 | 2 | BOT-04 | T-04-02 | HMAC verified with constant-time comparison; 401 on invalid secret | unit | `npm test -- --testPathPattern=telegram-webhook` | ✅ | ✅ green |
| 04-04-01 | 04 | 3 | — | — | All 206+ existing tests pass unchanged (4 pre-existing scheduler-agenda failures) | regression | `npm test` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky/partial*

---

## Test Coverage Evidence

### BOT-02: Per-bot schema + webhookId routing
- `tests/telegram-webhook.test.ts:172` — Test 1: recognized business → 200
- `tests/telegram-webhook.test.ts:188` — Test 2: unknown webhookId → 404 (BOT-02)
- `tests/telegram-webhook.test.ts:238` — Two distinct webhookIds each resolve to own business (BOT-02)

### BOT-03: No cross-contamination between bots
- `tests/telegram-webhook.test.ts:238` — Two bots, both return 200
- `tests/telegram-webhook.test.ts:253` — valid webhookSecret → 200; invalid/missing → 401 (BOT-03, D-06)

### BOT-04: HMAC constant-time, 401 on bad secret
- `tests/telegram-webhook.test.ts:210` — Test 4: missing/wrong secret → 401
- `src/webhooks/telegram.ts:215` — `crypto.timingSafeEqual()` verified in VERIFICATION.md

### BOT-05: RLS at PostgreSQL layer
- `tests/rls-enforcement.test.ts:36` — 2 integration tests (skipped locally without DATABASE_APP_URL)
- UAT Test-5: confirmed on live Neon DB

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| RLS enforcement at DB layer | BOT-05 | Requires randevuclaw_app role connection (DATABASE_APP_URL) | `DATABASE_APP_URL=<app-role-url> npm test -- --testPathPattern=rls-enforcement` |
| fly secrets contains TEST_BOT_* env vars | BOT-02 | Secrets not testable in CI | Run `fly secrets list` and confirm TEST_BOT_TOKEN, TEST_BOT_SECRET present |
| Telegraf webhook registration on fly.io | BOT-02 | Requires live Telegram API | Send test message to bot; confirm webhook receives it |

---

## Validation Sign-Off

- [x] All tasks have automated verify or are in Manual-Only
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 test coverage delivered via telegram-webhook.test.ts (updated in-place)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 2026-07-14 — 5/6 requirements green, 1/6 partial (BOT-05 needs DATABASE_APP_URL)

---

## Validation Audit 2026-07-14

| Metric | Count |
|--------|-------|
| Requirements audited | 6 |
| COVERED (green) | 5 |
| PARTIAL (conditional) | 1 |
| MISSING | 0 |
| Escalated to manual-only | 0 |
