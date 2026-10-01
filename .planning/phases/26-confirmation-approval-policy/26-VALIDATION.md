---
phase: 26
slug: confirmation-approval-policy
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-01
---

# Phase 26 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest + ts-jest (real local Postgres test DB) |
| **Config file** | `jest.config.js` (setupFiles `tests/jest.setup.ts`) |
| **Quick run command** | `npx jest <changed test file> --maxWorkers=1` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~60 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run quick command on the touched test file(s)
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Filled by planner / checker once PLAN.md task IDs exist.

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| CONF-01 | delete_service / update_service_price / close_day / cancel_session (free-chat) / assign_client_to_session do NOT mutate until confirm callback; menu and free-chat paths share one confirm model | integration | `npx jest tests/conf-01-*.test.ts` | ❌ W0 | ⬜ pending |
| CONF-01 | Gemini tool returns confirmation-requested result without mutating; model does not loop-recall | unit | `npx jest tests/conf-01-*.test.ts` | ❌ W0 | ⬜ pending |
| CONF-02 | Reschedule creates `pending_owner_approval` booking with `rescheduledFromBookingId`; old booking untouched (still confirmed) | integration | `npx jest tests/conf-02-reschedule-pending.test.ts` | ❌ W0 | ⬜ pending |
| CONF-02 | Approve: old booking CAS-cancelled, old credit restored, old instance capacity released, new confirmed; second tap = no-op | integration | `npx jest tests/conf-02-reschedule-approve.test.ts` | ❌ W0 | ⬜ pending |
| CONF-02 | Reject / 2h expiry: new released + credit net-zero, old booking intact, Greek client notice | integration | `npx jest tests/conf-02-reschedule-reject.test.ts` | ❌ W0 | ⬜ pending |
| CONF-02 | Credit net-zero on approve/reject/expiry AND last-credit reschedule under `enforcement_policy='block'` is not wrongly blocked (see RESEARCH CORRECTION) | integration | `npx jest tests/conf-02-reschedule-credit-semantics.test.ts` | ❌ W0 | ⬜ pending |
| CONF-02 | Pre-existing (auto-confirmed, NULL rescheduledFromBookingId) reschedules unaffected; no orphaned holds | integration | `npx jest tests/conf-02-reschedule-legacy.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/conf-01-*.test.ts` — stubs for CONF-01 (5 actions, both entry points)
- [ ] `tests/conf-02-reschedule-*.test.ts` — stubs for CONF-02 (pending, approve, reject/expiry, credit, double-tap, legacy)
- [ ] Fixture helper to insert a pending reschedule booking pair (extend `tests/helpers/session-fixtures.ts`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Greek button labels/prompt wording read naturally in real Telegram chat | CONF-01 / CONF-02 | Copy tone not machine-checkable | Trigger each of the 5 actions via menu and free chat; trigger a reschedule; approve and reject |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
