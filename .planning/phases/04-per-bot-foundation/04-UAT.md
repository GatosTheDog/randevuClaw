---
status: complete
phase: 04-per-bot-foundation
source: 04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md, 04-04-SUMMARY.md, 04-05-SUMMARY.md
started: 2026-07-11T08:56:40Z
updated: 2026-07-14T12:45:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server. Clear ephemeral state. Start the application from scratch (`npm run build && npm start` or equivalent). Server boots without errors. Any migrations/seed complete. A basic health check or primary query returns live data.
result: pass

### 2. Test Suite Baseline
expected: Running `npm test` produces exactly 205 passing, 1 skipped (rls-enforcement skipped — DATABASE_APP_URL not set), 5 failing (pre-existing scheduler-agenda time-dependent failures). No new failures beyond the known 5.
result: pass
reported: "Tests: 4 failing (pre-existing scheduler-agenda only), 1 skipped, 206 passing — resolved by gap-closure plan 04-06"

### 3. HMAC Bad Secret Returns 401
expected: A Telegram webhook POST to `/:webhookId` with a wrong or missing `x-telegram-bot-api-secret-token` header returns HTTP 401 (not 403 — the old global-secret check returned 403). A request with the correct per-bot HMAC secret returns 200.
result: pass

### 4. Per-Bot Parallel Routing
expected: Two distinct webhookId values registered in the DB resolve to their respective businesses independently. A POST to `/webhookId-1` with bot-1's secret succeeds (200); a POST to `/webhookId-2` with bot-2's secret succeeds (200). Neither request interferes with the other.
result: pass

### 5. Live Neon DB: Schema + RLS
expected: The live Neon DB has 3 new columns on the businesses table (`bot_token`, `webhook_id`, `webhook_secret`). Row Level Security is enabled on 7 tables (businesses, messages, bookings, services, business_hours, client_business_Richards, conversation_turns). The `randevuclaw_app` role exists.
result: pass

### 6. telegraf@4.16.3 + registry.ts exports
expected: telegraf@4.16.3 installed and src/telegram/registry.ts exports getOrCreateBotInstance, getBotInstance, clearBotRegistry with Map singleton
result: pass
source: automated
coverage_id: D1-04-02

### 7. logger.ts credential redaction
expected: logger.ts redacts botToken and webhookSecret at field, wildcard, and config namespace levels
result: pass
source: automated
coverage_id: D2-04-02

### 8. jest.setup.ts TEST_BOT_* defaults
expected: jest.setup.ts provides TEST_BOT_1_TOKEN/WEBHOOK_SECRET/WEBHOOK_ID and TEST_BOT_2_* defaults via ??= operator; TELEGRAM_BOT_TOKEN removed
result: pass
source: automated
coverage_id: D3-04-02

### 9. withBusinessContext + findBusinessByWebhookId exports
expected: withBusinessContext and findBusinessByWebhookId exported from queries.ts; currentTx AsyncLocalStorage threads appDb tx through getConn() calls
result: pass
source: automated
coverage_id: D1-04-03

### 10. botTokenStore per-request dispatch
expected: botTokenStore exported from client.ts; callTelegramApi reads from AsyncLocalStorage; config import removed
result: pass
source: automated
coverage_id: D2-04-03

### 11. Business interface + 11 test files updated
expected: Business interface updated with botToken/webhookId/webhookSecret fields; all 11 affected test files updated
result: pass
source: automated
coverage_id: D3-04-03

## Summary

total: 11
passed: 10
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "npm test produces 205 passing, 1 skipped, 5 failing (pre-existing scheduler-agenda only)"
  status: failed
  reason: "User reported: Test Suites: 5 failed, 1 skipped, 20 passed, 25 of 26 total / Tests: 14 failed, 1 skipped, 184 passed, 199 total"
  severity: major
  test: 2
  root_cause: |
    Three test suites not updated after code-review fixes (04-REVIEW-FIX.md):
    1. telegram-client.test.ts (5 failures): CR-03 changed botTokenStore.getStore() ?? '' to throw when no context active. Tests call sendTelegramMessage/answerCallbackQuery/etc directly without wrapping in botTokenStore.run() — throws before reaching mocked fetch.
    2. expiry-poller.test.ts (3 failures): CR-03 added botTokenStore.run(business.botToken) wrap + guard skips batch if business.botToken absent. Test fixture businesses have botToken: null (set in 04-03 Business interface update) → guard fires, sendTelegramMessage never called.
    3. telegram-webhook.test.ts (2 failures): WR-01 changed answerCallbackQuery(id, text/undefined) to answerCallbackQuery(id) — no second arg. Tests 5 and 9 still assert 2-arg call signature.
  artifacts:
    - path: "tests/telegram-client.test.ts"
      issue: "Tests need botTokenStore.run('test-token', async () => { ... }) wrapping around each call"
    - path: "tests/expiry-poller.test.ts"
      issue: "Business fixture needs non-null botToken (e.g. 'test-bot-token') to pass the botToken guard"
    - path: "tests/telegram-webhook.test.ts"
      issue: "Tests 5 and 9: toHaveBeenCalledWith('cbq-1', ...) should be toHaveBeenCalledWith('cbq-1') — WR-01 removed second arg"
  missing:
    - "Update telegram-client.test.ts: wrap each test body's Telegram API calls in botTokenStore.run('test-token', async () => { ... })"
    - "Update expiry-poller.test.ts: set botToken to a non-null string in Business fixture"
    - "Update telegram-webhook.test.ts Test 5: toHaveBeenCalledWith('cbq-1') (drop expect.any(String))"
    - "Update telegram-webhook.test.ts Test 9: toHaveBeenCalledWith('cbq-1') (drop undefined second arg)"
  debug_session: ""
