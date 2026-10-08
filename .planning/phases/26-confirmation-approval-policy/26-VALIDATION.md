---
phase: 26
slug: confirmation-approval-policy
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-10-01
---

# Phase 26 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest + ts-jest (real local Postgres test DB for integration files) |
| **Config file** | `jest.config.js` (setupFiles `tests/jest.setup.ts`) |
| **Quick run command** | `npx jest <changed test file> --maxWorkers=1` |
| **Full suite command** | `npx jest --maxWorkers=1` (single worker on purpose: `tests/admin-menu.test.ts` warns that a parallel full run can overload the machine) |
| **Type check** | `npx tsc --noEmit` |
| **Estimated runtime** | ~60 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run quick command on the touched test file(s)
- **After every plan wave:** Run `npx jest --maxWorkers=1`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Plans: 26-01 (CONF-01 foundation, wave 1), 26-03 (CONF-02 domain core, wave 1), 26-02 (CONF-01 free chat, wave 2), 26-04 (CONF-02 reschedule tool, wave 2), 26-05 (CONF-02 webhook wiring, wave 2).

| Task ID | Plan | Wave | Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|----------|-----------|-------------------|-------------|--------|
| 26-01-T1 | 01 | 1 | CONF-01 | Button-label constants; five confirmation prompts restate action and context with contextual labels; `menu:confirm:*` grammar round-trips through the real shared parser; boundary and precision validators (day 0-6, HH:MM, cents 0..10000000, client id, 64-byte limit) | unit | `npx jest tests/conf-01-confirm-callbacks.test.ts --maxWorkers=1` | created in task (RED first) | ⬜ pending |
| 26-01-T2 | 01 | 1 | CONF-01 | Execute-on-confirm for delete service, update price, close day, update hours, assign client: tenant-scoped, idempotent on re-tap, cross-tenant id never mutated, abort and unknown write nothing | integration (real DB) | `npx jest tests/conf-01-owner-confirm-exec.test.ts --maxWorkers=1` | created in task (RED first) | ⬜ pending |
| 26-01-T3 | 01 | 1 | CONF-01 | Admin-menu cancel-class prompt uses contextual labels and optional description; `confirm:` dispatch behind the unchanged owner-only guard; non-owner tap ignored | unit + webhook | `npx jest tests/admin-menu.test.ts tests/webhooks/owner-confirm-routing.test.ts --maxWorkers=1` | extended / created in task | ⬜ pending |
| 26-02-T1 | 02 | 2 | CONF-01 | Free-chat delete_service, update_service_price, close_day, update_hours never mutate: validate, send one prompt, return empty string, Gemini called once, second call in a round not executed | unit | `npx jest tests/conf-01-free-chat-confirmation.test.ts --maxWorkers=1` | created in task (RED first) | ⬜ pending |
| 26-02-T2 | 02 | 2 | CONF-01 | Free-chat cancel_session and assign_client_to_session converge on the shared prompt and callbacks; no direct cancel or booking; invalid client id and unmatched class send no prompt | unit | `npx jest tests/conf-01-free-chat-confirmation.test.ts tests/ai-owner-cancel-session.test.ts tests/admin-menu.test.ts --maxWorkers=1` | rewritten / extended in task | ⬜ pending |
| 26-03-T1 | 03 | 1 | CONF-02 | `rescheduledFromBookingId` persisted; pending replacement holds capacity and no credit; last-credit creation not refused; reject and expiry net-zero; pending-reschedule lookup | integration (real DB) | `npx jest tests/conf-02-reschedule-credit-semantics.test.ts --maxWorkers=1` | created in task (RED first) | ⬜ pending |
| 26-03-T2 | 03 | 1 | CONF-02 | Approve cascade: original CAS-cancelled, credit restored then replacement charged (net-zero incl. last credit, unlimited, never-charged), original capacity released once, replay no-op, standalone fallback when original gone, foreign-link safety, legacy NULL link untouched, later cancel restores once | integration (real DB) | `npx jest tests/conf-02-reschedule-approve.test.ts tests/conf-02-reschedule-credit-semantics.test.ts tests/session-cascade.test.ts --maxWorkers=1` | created in task (RED first) | ⬜ pending |
| 26-03-T3 | 03 | 1 | CONF-02 | Two-hour expiry of a pending replacement: capacity released, no credit restore, client told the original stays active (generic notice otherwise; lookup failure falls back) | unit | `npx jest tests/conf-02-reschedule-expiry.test.ts tests/expiry-poller.test.ts --maxWorkers=1` | created in task (RED first) | ⬜ pending |
| 26-04-T1 | 04 | 2 | CONF-02 | reschedule_session creates a pending linked replacement (no auto-confirm), original untouched, owner reschedule prompt with old to new date and time, last-credit under block allowed, same-class / chained / duplicate / swallowed-insert guards, replay without second prompt | integration (real DB) | `npx jest tests/conf-02-reschedule-pending.test.ts tests/session-booking-flow.test.ts --maxWorkers=1` | created in task (RED first) | ⬜ pending |
| 26-04-T2 | 04 | 2 | CONF-02 | Shared approve/reject and yes/no labels with unchanged visible text; client-facing tool description mentions approval; legacy auto-confirmed reschedules unaffected and reschedulable; no orphaned capacity holds or double-booked slots after approve and after reject | integration (real DB) | `npx jest tests/conf-02-reschedule-legacy.test.ts tests/webhooks/client-menu.test.ts tests/ai-agent.test.ts tests/function-executor.test.ts --maxWorkers=1` | created in task (RED first) | ⬜ pending |
| 26-05-T1 | 05 | 2 | CONF-02 | `sbk:approve` runs the cascade after the replacement CAS; Greek approve notices; double tap and non-owner and cross-tenant taps change nothing; cascade failure not swallowed | webhook (mocked) | `npx jest tests/webhooks/sbk-reschedule-callback.test.ts --maxWorkers=1` | created in task (RED first) | ⬜ pending |
| 26-05-T2 | 05 | 2 | CONF-02 | `sbk:reject` releases only the replacement, never touches the original, Greek notice says the original stays active (generic when not); lookup failure falls back; legacy approve_/reject_ block unaffected | webhook (mocked) | `npx jest tests/webhooks/sbk-reschedule-callback.test.ts tests/telegram-webhook.test.ts --maxWorkers=1` | extended in task | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Edge-probe coverage (spec-less fallback, `coverage.json`): CONF-01 boundary, precision and idempotency are covered by 26-01-T1/T2 and 26-02-T1/T2; CONF-01 concurrency is a backstop truth (parallel taps rely on the unique request-id index and idempotent SQL); CONF-02 arrived unclassified and is carried as a flagged assumption with manual coverage in 26-03, 26-04 and 26-05.

---

## Wave 0 Requirements

Wave 0 is satisfied inside each task: every task is `tdd="true"` and writes its failing test file first, so no separate stub plan is needed. The one shared fixture, `insertTestRescheduleScenario` (and the `rescheduledFromBookingId` / `requestId` options on `insertTestSessionBooking`), is created in 26-03-T1 in `tests/helpers/session-fixtures.ts` and is consumed by 26-03-T2, 26-04-T1 and 26-04-T2.

- [x] CONF-01 tests: `tests/conf-01-confirm-callbacks.test.ts`, `tests/conf-01-owner-confirm-exec.test.ts`, `tests/conf-01-free-chat-confirmation.test.ts`, `tests/webhooks/owner-confirm-routing.test.ts` (plus extended `tests/admin-menu.test.ts`, rewritten `tests/ai-owner-cancel-session.test.ts`)
- [x] CONF-02 tests: `tests/conf-02-reschedule-credit-semantics.test.ts`, `tests/conf-02-reschedule-approve.test.ts`, `tests/conf-02-reschedule-expiry.test.ts`, `tests/conf-02-reschedule-pending.test.ts`, `tests/conf-02-reschedule-legacy.test.ts`, `tests/webhooks/sbk-reschedule-callback.test.ts`
- [x] Fixture helper for a reschedule pair: `tests/helpers/session-fixtures.ts` (26-03-T1)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Greek button labels/prompt wording read naturally in real Telegram chat | CONF-01 / CONF-02 | Copy tone not machine-checkable | Trigger each of the 5 actions via free chat, the cancel-class action via `/menu`; trigger a reschedule as a client; approve once and reject once from the owner chat |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
