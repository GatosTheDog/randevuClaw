---
phase: 25
slug: client-invite-generator
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-27
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest (existing) |
| **Config file** | jest.config.js (existing) |
| **Quick run command** | `npx jest --testPathPattern=invite` |
| **Full suite command** | `npx jest --testPathPattern="(invite|telegram-client|admin-menu)"` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run the quick command above
- **After every plan wave:** Run the full suite command above
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 25-01-01 | 01 | 1 | INVITE-01 | T-25-01 | Generated image contains no bot token / secrets | unit | `npx jest --testPathPattern=invite` | ❌ W0 | ⬜ pending |
| 25-01-02 | 01 | 1 | INVITE-01 | — | sendPhoto multipart upload correctness | unit | `npx jest --testPathPattern=telegram-client` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] New test file covering QR+caption image generation and the invite trigger (menu + chat)
- [ ] Extend `tests/telegram-client.test.ts` with `sendPhoto` multipart coverage

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Generated QR actually scans and opens the correct bot chat in a real Telegram client | INVITE-01 | Requires a physical/emulated phone camera + live Telegram app; not automatable in CI | Owner requests an invite, scans the resulting QR with a phone camera, confirms it opens `t.me/<bot_username>` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
