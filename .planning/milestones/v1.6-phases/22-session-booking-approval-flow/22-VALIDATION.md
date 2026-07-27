---
phase: 22
slug: session-booking-approval-flow
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-27
---

# Phase 22 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest (existing) |
| **Config file** | jest.config.js (existing) |
| **Quick run command** | `npx jest --testPathPattern=tests/webhooks/client-menu.test.ts` |
| **Full suite command** | `npx jest --testPathPattern="(session|booking)"` |
| **Estimated runtime** | ~20 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest --testPathPattern=tests/webhooks/client-menu.test.ts`
- **After every plan wave:** Run `npx jest --testPathPattern="(session|booking)"`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 22-01-01 | 01 | 1 | OWNR-05 | T-22-01 | Non-owner cannot approve/reject | integration | `npx jest --testPathPattern=tests/webhooks/client-menu.test.ts -t sbk` | ❌ W0 | ⬜ pending |
| 22-01-02 | 01 | 1 | OWNR-06 | T-22-02 | Capacity held/released atomically | integration | `npx jest --testPathPattern=tests/session/session-approval.test.ts` | ❌ W0 | ⬜ pending |
| 22-01-03 | 01 | 1 | OWNR-07 | — | Double-tap idempotent (no double reply) | integration | `npx jest --testPathPattern=tests/webhooks/client-menu.test.ts -t sbk` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/session/session-approval.test.ts` — atomic approve/reject with capacity release, double-tap idempotence, expiry edge case
- [ ] `tests/webhooks/client-menu.test.ts` — Suite F: `sbk:approve`/`sbk:reject` callback_data parsing + routing, ownership guard
- [ ] `tests/helpers/session-fixtures.ts` — add a pending-session-booking factory

---

## Manual-Only Verifications

*None — all phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
