---
phase: 4
slug: per-bot-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-10
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 29.x |
| **Config file** | jest.config.ts |
| **Quick run command** | `npm test -- --testPathPattern=src/` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern=src/`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | BOT-02 | — | Migration 0003 adds nullable columns + RLS policies | integration | `npm test -- --testPathPattern=migration` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | BOT-05 | T-04-01 | RLS blocks cross-tenant row access at DB layer | integration | `npm test -- --testPathPattern=rls` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | BOT-02 | — | Telegraf webhook adapter routes by token lookup | unit | `npm test -- --testPathPattern=webhook` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 2 | BOT-03 | — | Two distinct bots receive messages with no cross-contamination | integration | `npm test -- --testPathPattern=multi-bot` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 2 | BOT-04 | T-04-02 | HMAC verified with constant-time comparison; 401 on invalid secret | unit | `npm test -- --testPathPattern=hmac` | ❌ W0 | ⬜ pending |
| 04-04-01 | 04 | 3 | — | — | All 208 existing tests pass unchanged | regression | `npm test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/migration-0003.test.ts` — stubs for schema migration + RLS policy verification (BOT-02, BOT-05)
- [ ] `src/__tests__/webhook-routing.test.ts` — stubs for per-bot webhook routing (BOT-02, BOT-03)
- [ ] `src/__tests__/hmac-verification.test.ts` — stubs for HMAC constant-time check (BOT-04)
- [ ] `src/__tests__/rls-isolation.test.ts` — stubs for cross-tenant RLS enforcement (BOT-05)
- [ ] `src/__tests__/multi-bot-parallel.test.ts` — stubs for parallel bot routing (BOT-03)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| fly secrets contains TEST_BOT_* env vars | BOT-02 | Secrets not testable in CI | Run `fly secrets list` and confirm TEST_BOT_TOKEN, TEST_BOT_SECRET present |
| Telegraf webhook registration on fly.io | BOT-02 | Requires live Telegram API | Send test message to bot; confirm webhook receives it |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
