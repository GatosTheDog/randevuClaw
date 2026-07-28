---
phase: 30
slug: client-identification-menu-reliability
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-29
---

# Phase 30 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest + ts-jest, against local `randevuclaw_test` Postgres DB |
| **Config file** | `jest.config.js` (existing) |
| **Quick run command** | `SESSION_TEST_DATABASE_URL=postgresql://manolis:password@localhost:5433/randevuclaw_test npm test -- --testPathPattern=<scoped-file>` |
| **Full suite command** | `npm test` (never run — use scoped `--testPathPattern` per project convention) |
| **Estimated runtime** | Scoped runs ~20-30s |

---

## Sampling Rate

- **After every task commit:** Run scoped `--testPathPattern` for the file(s) that task touched.
- **After every plan wave:** Run `--testPathPattern='ai-owner-agent|menu-button'` (both new test files) plus any existing suite the plan modified.
- **Before `/gsd-verify-work`:** All new + modified scoped suites green; full suite never run per project convention.
- **Max feedback latency:** ~30s per scoped run.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 30-01-* | 01 | 1 | UX-03 | T-30-01 | Name filtering scoped to `withBusinessContext()` — owner cannot resolve another business's client by name | integration | `npm test -- --testPathPattern='ai-owner-agent'` | ❌ W0 | ⬜ pending |
| 30-02-* | 02 | 1 | ADMIN-05 | — | N/A | unit+integration | `npm test -- --testPathPattern='menu-button\|onboarding'` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Exact plan/task numbering is provisional — finalized by the planner; this map is the contract each plan's tasks must satisfy.*

---

## Wave 0 Requirements

- [ ] New test coverage for all 4 converted tools (`view_client_membership`, `assign_client_to_session`, `send_renewal_reminder`, `list_slotless_requests`) in `src/onboarding/ai-owner-agent.ts`: single exact-substring match, case-insensitive match, 2+ match disambiguation (names-only in the returned text, no ID/phone leak), zero-match generic response.
- [ ] Cross-business isolation test: a name that matches a client in Business B never resolves when the tool call is scoped to Business A's `withBusinessContext()`.
- [ ] New/extended test coverage for `finish_onboarding`'s retry logic (D-06.1) — mocked Telegram API failure → retry → eventual success or exhausted-retries swallow.
- [ ] New test coverage for the `/menu`-tap re-assertion (D-06.2) — mocked Telegram API, verify the idempotent calls fire and don't block/delay the `/menu` response.
- [ ] Existing test fixtures/tests that currently pass `client_phone` to any of the 4 converted tools must be updated to pass a name instead (regression check for the param removal).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Telegram client shows the persistent menu button reliably after onboarding and after a `/menu` tap | ADMIN-05 | Client-side rendering/caching behavior lives in the Telegram app itself (confirmed via RESEARCH.md's platform research: server-side state persists indefinitely, but client-side cache refresh timing is not observable from server-side automated tests) | Send `/start`/`/menu` from a real Telegram client after deploy; confirm menu button appears. This is a spot-check, not a blocking gate — the code-side retry/re-assertion hedge (D-06) is what's actually verified by automated tests. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s per scoped run
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
