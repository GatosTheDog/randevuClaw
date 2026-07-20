---
phase: 8
slug: enforcement-session-deduction
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-20
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest / jest (TypeScript) |
| **Config file** | vitest.config.ts or jest.config.ts |
| **Quick run command** | `npm test -- --testPathPattern=phase-08` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern=phase-08`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | SESS-01 | T-08-01 / — | Session deducted exactly once per booking (idempotency key) | unit | `npm test -- --testPathPattern=session-deduction` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | SESS-02 | — | Credit restored on cancellation within validity window | unit | `npm test -- --testPathPattern=credit-restore` | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 1 | SESS-03 | — | No credit restore on expired membership cancellation | unit | `npm test -- --testPathPattern=credit-restore` | ❌ W0 | ⬜ pending |
| 08-01-04 | 01 | 1 | SESS-04 | — | Unlimited membership: no count change, expiry-only check | unit | `npm test -- --testPathPattern=unlimited-membership` | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 2 | ENFC-01 | T-08-02 / — | enforcement_policy migration applies cleanly | integration | `npm run db:migrate` | ✅ | ⬜ pending |
| 08-02-02 | 02 | 2 | ENFC-01 | — | set_enforcement_policy NLU tool recognized and persisted | unit | `npm test -- --testPathPattern=enforcement-policy` | ❌ W0 | ⬜ pending |
| 08-03-01 | 03 | 3 | ENFC-02 | T-08-03 / — | Block policy: booking rejected with Greek refusal | unit | `npm test -- --testPathPattern=enforcement-check` | ❌ W0 | ⬜ pending |
| 08-03-02 | 03 | 3 | ENFC-03 | — | Flag policy: booking proceeds + owner alert sent | unit | `npm test -- --testPathPattern=enforcement-check` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/phase-08/session-deduction.test.ts` — stubs for SESS-01, SESS-02, SESS-03
- [ ] `src/__tests__/phase-08/unlimited-membership.test.ts` — stubs for SESS-04
- [ ] `src/__tests__/phase-08/enforcement-policy.test.ts` — stubs for ENFC-01
- [ ] `src/__tests__/phase-08/enforcement-check.test.ts` — stubs for ENFC-02, ENFC-03
- [ ] `src/__tests__/phase-08/credit-restore.test.ts` — stubs for SESS-02, SESS-03

*Existing test infrastructure (vitest/jest) assumed from project setup.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Greek refusal message text and formatting | ENFC-02 | Requires live Telegram message inspection | Send booking as client with block policy; verify message text matches spec |
| Owner flag alert fires before Αποδοχή/Απόρριψη keyboard | ENFC-03 | Message ordering in Telegram chat requires manual inspection | Trigger flag-policy booking; verify alert appears above keyboard in owner chat |
| SELECT FOR UPDATE prevents double-deduction under concurrent load | SESS-01 | Requires concurrent webhook simulation | Send 2 simultaneous booking requests for same client; verify only 1 deduction in ledger |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
