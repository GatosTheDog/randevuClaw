---
phase: 23
slug: lesson-deletion-cascade-cancellation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-27
---

# Phase 23 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest (existing) |
| **Config file** | jest.config.js (existing) |
| **Quick run command** | `npx jest --testPathPattern=tests/session-cascade.test.ts` |
| **Full suite command** | `npx jest --testPathPattern="(session-cascade|admin-menu)"` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx jest --testPathPattern=tests/session-cascade.test.ts`
- **After every plan wave:** Run `npx jest --testPathPattern="(session-cascade|admin-menu)"`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 23-01-01 | 01 | 1 | CLSS-07 | T-23-01 | Cross-tenant guard (RLS) | integration | `npx jest --testPathPattern=session-cascade` | ❌ W0 | ⬜ pending |
| 23-01-02 | 01 | 1 | CLSS-07 | — | Idempotent re-cancel is a no-op | integration | `npx jest --testPathPattern=session-cascade` | ❌ W0 | ⬜ pending |
| 23-01-03 | 01 | 1 | CLSS-07 | — | Per-client notification isolation | integration | `npx jest --testPathPattern=session-cascade` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/session-cascade.test.ts` — new file: booking status flip, credit restore, capacity release, client notification, idempotency, per-client isolation

---

## Manual-Only Verifications

*None — all phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
