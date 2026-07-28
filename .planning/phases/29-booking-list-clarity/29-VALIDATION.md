---
phase: 29
slug: booking-list-clarity
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-28
---

# Phase 29 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest + ts-jest, against local `randevuclaw_test` Postgres DB |
| **Config file** | `jest.config.js` (existing, Phase 3+) |
| **Quick run command** | `npm test -- --testPathPattern=<scoped-file>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 min full suite — never run full suite; use `--testPathPattern` per project convention |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --testPathPattern='<file touched by that task>'`
- **After every plan wave:** Run `npm test -- --testPathPattern='session-list|admin-menu|client-menu|telegram-webhook'` (all files touched this phase)
- **Before `/gsd-verify-work`:** All 5 scoped suites above green; full suite never run per project convention (machine-crash risk) — verifier relies on scoped runs + `tsc --noEmit`.
- **Max feedback latency:** ~30s per scoped run (real-DB integration tests)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 29-01-* | 01 | 1 | UX-05 | — | N/A | integration | `npm test -- --testPathPattern='client-menu'` | ❌ W0 | ⬜ pending |
| 29-02-* | 02 | 1 | UX-02, UX-04 | — | N/A | integration | `npm test -- --testPathPattern='admin-menu\|client-menu'` | ❌ W0 | ⬜ pending |
| 29-03-* | 03 | 2 | UX-01 | — | N/A | integration | `npm test -- --testPathPattern='session-list'` | ❌ W0 | ⬜ pending |
| 29-04-* | 04 | 2 | UX-06 | T-29-01 | Cross-business callback resolution stays scoped (inherits Phase 28's upstream ownership guard — no new leak surface) | unit+integration | `npm test -- --testPathPattern='telegram-webhook\|admin-menu\|client-menu'` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Exact plan/task numbering is provisional — finalized by the planner; this map is the contract each plan's tasks must satisfy, not a prescription of plan boundaries.*

---

## Wave 0 Requirements

- [ ] `tests/session-list.test.ts` — new same-day-boundary suite (3 tests: strict-past excluded, future included, exactly-now boundary documented per whichever `<=`/`<` choice the plan locks)
- [ ] `tests/webhooks/client-menu.test.ts` — UX-02 (cancel-confirm shows service+date) + UX-05 (button relabel, redirect back-button) + UX-06 (cancel-flow early-return keyboards) fixtures/assertions
- [ ] `tests/admin-menu.test.ts` — UX-02 (admin cancel-confirm shows service+date) + UX-04 (list service names) + UX-06 (menu default-case keyboard) fixtures/assertions
- [ ] `tests/telegram-webhook.test.ts` — UX-06 Layer 1 (`parseCallbackData()` → `null` sends back-menu keyboard instead of silent drop) + legacy `approve_/reject_` unknown-booking path

Total: ~8-10 new integration/unit tests, all against the real test DB — no new framework/install needed.

---

## Manual-Only Verifications

*None — all 5 success criteria (UX-01, UX-02, UX-04, UX-05, UX-06) have automated verification per the map above. The Athens-timezone boundary test explicitly encodes whichever discretionary choice (`<=` vs `<`) the plan documents, so it stays automated rather than falling back to manual spot-check.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s per scoped run
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
