---
phase: 28
slug: admin-menu-discoverability
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-28
---

# Phase 28 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest (existing test suite) |
| **Config file** | `jest.config.cjs` |
| **Quick run command** | `npm test -- --testPathPattern=admin-menu` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | Not measured — no E2E tests in this phase, all unit/integration via Jest |

---

## Sampling Rate

- **After every admin-menu task commit:** Run `npm test -- --testPathPattern=admin-menu` (covers ADMIN-02, ADMIN-04)
- **After every relay task commit:** Run `npm test -- --testPathPattern=telegram` (covers ADMIN-01)
- **After every payment task commit:** Run `npm test -- --testPathPattern=payment` (covers ADMIN-03)
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** Well under 30s per targeted `--testPathPattern` run (no E2E/browser tests in this phase)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {N}-01-01 | 01 | 1 | REQ-{XX} | T-{N}-01 / — | {expected secure behavior or "N/A"} | unit | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Filled in by the planner/executor once task IDs exist — see `28-RESEARCH.md` § Validation Architecture for the requirement→test mapping this table will expand.*

---

## Wave 0 Requirements

- [ ] `tests/telegram/handlers/admin-menu.test.ts` — add cases for `menu:payment` (asserts `showClientSelection(business.id, chatId)` called) and the 3 setup example-phrase callbacks (`menu:settings:hours_examples`, `menu:settings:services_examples`, `menu:settings:classes_examples`), plus the upgraded `menu:classes:create` multi-example prompt
- [ ] `tests/webhooks/telegram.test.ts` — add cases for the reply-relay flow: `stagePendingReply` on escalation reply tap, `consumePendingReply` + relay + owner confirmation on next free-text message, `/menu` and `/start` clearing pending reply, 10-minute expiry, per-business bot-token routing
- [ ] `tests/telegram/handlers/payment-flow.test.ts` — confirm existing `showClientSelection` → `showPackageSelection` → `handleConfirmMembership` tests still pass unchanged (Phase 28 only adds the menu entry point, no payment-flow logic changes)

---

## Manual-Only Verifications

*None — all phase behaviors have automated verification (see `28-RESEARCH.md` § Validation Architecture Phase Requirements → Test Map).*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
