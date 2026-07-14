---
phase: 05
slug: owner-self-serve-onboarding
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-14
---

# Phase 05 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 with ts-jest |
| **Config file** | jest.config.js |
| **Quick run command** | `npm test -- --no-coverage` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --no-coverage`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | ONB-02, ONB-04 | T-05-01, T-05-02 | Schema migration idempotent; PLATFORM_BOT_TOKEN never in SQL | build | `npx tsc --noEmit` | ✅ existing | ⬜ pending |
| 05-01-02 | 01 | 1 | ONB-02 | T-05-01 | PLATFORM_BOT_TOKEN sourced from env only; test placeholder in jest.setup.ts | unit | `npm test -- --testPathPattern=config --no-coverage` | ✅ existing | ⬜ pending |
| 05-01-03 | 01 | 1 | ONB-04 | — | Test helper uses admin db; no fixture data written | build | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 05-02-01 | 02 | 2 | BOT-01 | T-05-03 | callTelegramApiDirect logs method name only — bot token never logged | unit | `npm test -- --testPathPattern=telegram-client --no-coverage` | ✅ existing | ⬜ pending |
| 05-02-02 | 02 | 2 | ONB-02 | T-05-05 | onboarding/queries.ts uses admin db only; no appDb import | build | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 05-03-01 | 03 | 3 | ONB-01, ONB-02, BOT-01 | T-05-06, T-05-07, T-05-08, T-05-09 | HH:MM validated by TIME_REGEX; closed days get a business_hours row; unregisterBotWebhook called before registerBotWebhook | build | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 05-03-02 | 03 | 3 | ONB-01, ONB-02 | — | All 25 OnboardingStep values dispatched; error isolation wraps dispatch | build | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 05-04-01 | 04 | 4 | BOT-01, ONB-01, ONB-02 | T-05-10, T-05-11, T-05-12, T-05-13 | HMAC returns 401 on mismatch; bot token not logged; dedup-insert prevents replay | integration | `npm test -- --testPathPattern=telegram-webhook --no-coverage` | ✅ existing (update) | ⬜ pending |
| 05-04-02 | 04 | 4 | BOT-01 | T-05-10 | Platform route registered before :webhookId on top-level Express app | integration | `npm test -- --testPathPattern=telegram-webhook --no-coverage` | ✅ existing | ⬜ pending |
| 05-05-01 | 05 | 4 | ONB-03 | T-05-15, T-05-16 | Non-owner cannot trigger edit router; all four keywords execute real DB writes | build | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 05-05-02 | 05 | 4 | ONB-03 | T-05-15 | Ownership check gates intercept; non-owner edit keywords reach booking agent | integration | `npm test -- --testPathPattern=telegram-webhook --no-coverage` | ✅ existing (update) | ⬜ pending |
| 05-06-01 | 06 | 5 | BOT-01 | T-05-10, T-05-12 | HMAC rejected with 401; invalid token does not create business row | integration | `npm test -- --testPathPattern=onboarding-platform --no-coverage` | ❌ W0 | ⬜ pending |
| 05-06-02 | 06 | 5 | ONB-01, ONB-02, ONB-03 | T-05-06, T-05-08 | Closed days write isClosed:true row; invalid HH:MM does not advance step; isOwnerEditCommand is case-insensitive | unit | `npm test -- --testPathPattern=onboarding-flow --no-coverage` | ❌ W0 | ⬜ pending |
| 05-07-01 | 07 | 5 | ONB-04 | — | No FIXTURES/seed() symbol in seed.ts after cleanup; generateSlug retained and tested | unit | `npm test -- --testPathPattern=fixtures --no-coverage` | ✅ existing (rewrite) | ⬜ pending |
| 05-07-02 | 07 | 5 | ONB-04 | T-05-19 | TEST_BOT_* and TELEGRAM_WEBHOOK_SECRET removed from config + setup; insertTestBusiness replaces seed() | regression | `npm test` | ✅ existing (update) | ⬜ pending |
| 05-07-03 | 07 | 5 | ONB-04 | T-05-18, T-05-19 | Migration applied to live DB; fixture rows deleted; fly.io secrets set; secrets not committed to repo | human-verify | `npm test` (post-human-action) | N/A (checkpoint) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/helpers/test-business.ts` — insertTestBusiness() helper (Plan 01 Task 3); used by onboarding-flow.test.ts and booking-queries.test.ts
- [ ] `tests/onboarding-platform.test.ts` — covers BOT-01 scenarios (HMAC rejection, valid token registration, invalid token rejection, re-registration, dedup)
- [ ] `tests/onboarding-flow.test.ts` — covers ONB-01 (full guided flow), ONB-02 (mid-flow resume), ONB-03 (isOwnerEditCommand case-insensitive, step advancement/validation)
- [ ] `tests/jest.setup.ts` — PLATFORM_BOT_TOKEN, PLATFORM_WEBHOOK_SECRET, WEBHOOK_BASE_URL placeholders added (Plan 01 Task 2)

*The above four items are created or updated in Plans 01 and 06. All other test files (telegram-webhook.test.ts, telegram-client.test.ts, config.test.ts, fixtures.test.ts, booking-queries.test.ts) exist and need targeted updates only.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Migration 0004 applied to live Neon DB | ONB-02 | Cannot execute psql against live Neon DB in CI | Run: psql $DATABASE_URL -f migrations/0004_phase5_onboarding.sql; verify: psql $DATABASE_URL -c "\d onboarding_sessions" shows the table |
| Fixture rows deleted from live Neon DB | ONB-04 | Irreversible live-DB mutation; requires human confirmation | Run: psql $DATABASE_URL -c "DELETE FROM businesses WHERE slug IN ('pilates-athens', 'hair-salon-athens')"; verify: SELECT COUNT(*) FROM businesses returns 0 |
| fly.io secrets set (PLATFORM_BOT_TOKEN, PLATFORM_WEBHOOK_SECRET, WEBHOOK_BASE_URL) | BOT-01 | fly.io CLI auth not available in CI | fly secrets set PLATFORM_BOT_TOKEN=... PLATFORM_WEBHOOK_SECRET=... WEBHOOK_BASE_URL=https://randevuclaw.fly.dev |
| Old TEST_BOT_* secrets removed from fly.io | ONB-04 | fly.io CLI only | fly secrets unset TEST_BOT_1_TOKEN TEST_BOT_1_WEBHOOK_SECRET TEST_BOT_1_WEBHOOK_ID TEST_BOT_2_TOKEN TEST_BOT_2_WEBHOOK_SECRET TEST_BOT_2_WEBHOOK_ID |
| Platform bot webhook registered with Telegram | BOT-01 | Requires live bot token and deployed fly.io URL | curl -X POST https://api.telegram.org/bot{PLATFORM_BOT_TOKEN}/setWebhook -d '{"url":"https://randevuclaw.fly.dev/webhooks/telegram/platform","secret_token":"{PLATFORM_WEBHOOK_SECRET}"}'; expected: {"ok":true} |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify command or Wave 0 dependency noted
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (4 files listed above)
- [x] No watch-mode flags in any verify command
- [x] Feedback latency < 30s for quick run
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
