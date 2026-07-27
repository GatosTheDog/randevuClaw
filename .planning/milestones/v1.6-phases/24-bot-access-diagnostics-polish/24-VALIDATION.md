---
phase: 24
slug: bot-access-diagnostics-polish
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-27
---

# Phase 24 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest (existing) |
| **Config file** | jest.config.js (existing) |
| **Quick run command** | `npx jest --testPathPattern="(telegram-client|ai-agent|webhooks/telegram)"` |
| **Full suite command** | `npx jest --testPathPattern="(telegram-client|ai-agent|webhooks/telegram|onboarding)"` |
| **Estimated runtime** | ~20 seconds |

---

## Sampling Rate

- **After every task commit:** Run the quick command above
- **After every plan wave:** Run the full suite command above
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 25 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 24-01-01 | 01 | 1 | BOT-06 | — | Menu button/commands set via existing Telegram API pattern, no new secrets exposed | unit | `npx jest --testPathPattern=telegram-client` | ❌ W0 | ⬜ pending |
| 24-01-02 | 01 | 1 | DIAG-01 | T-24-01 | Owner diagnostic never leaks to client message | unit | `npx jest --testPathPattern="(ai-agent|webhooks/telegram)"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Extend `tests/telegram-client.test.ts` with setChatMenuButton/setMyCommands coverage
- [ ] Extend `tests/ai-agent.test.ts` and the webhook-level test file with owner-diagnostic-on-fallback coverage

---

## Manual-Only Verifications

*None — all phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 25s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
