---
phase: 9
slug: expiry-notifications-client-balance
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-21
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm test -- --reporter=dot` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --reporter=dot`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 0 | NOTF-01 | — | N/A | unit | `npm test -- src/billing/queries.test.ts` | ❌ W0 | ⬜ pending |
| 09-01-02 | 01 | 1 | NOTF-01 | — | No duplicate notifications sent | unit | `npm test -- src/services/membership-expiry-poller.test.ts` | ❌ W0 | ⬜ pending |
| 09-01-03 | 01 | 1 | NOTF-02 | — | UNIQUE constraint prevents double-send | unit | `npm test -- src/services/membership-expiry-poller.test.ts` | ❌ W0 | ⬜ pending |
| 09-02-01 | 02 | 2 | NOTF-03 | — | Tool dispatches correctly for Greek balance query | unit | `npm test -- src/agent/function-executor.test.ts` | ✅ | ⬜ pending |
| 09-02-02 | 02 | 2 | NOTF-04 | — | Greek reply with session count and expiry date | unit | `npm test -- src/agent/function-executor.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/billing/queries.test.ts` — stubs for NOTF-01 (findMembershipsExpiringIn7Days)
- [ ] `src/services/membership-expiry-poller.test.ts` — stubs for NOTF-01, NOTF-02 (poller + dedup)

*Existing infrastructure covers NOTF-03, NOTF-04 (function-executor tests already exist).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Client receives Telegram message 7 days before expiry | NOTF-01 | Requires live Telegram bot + real membership near expiry | Set a membership expiry to `now + 7 days`, trigger poller manually, verify Telegram message received by client |
| Owner receives simultaneous Telegram alert | NOTF-01 | Requires live Telegram bot for owner | Same as above; verify owner bot also receives alert |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
