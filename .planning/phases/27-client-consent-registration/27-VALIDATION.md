---
phase: 27
slug: client-consent-registration
status: verified
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-28
---

# Phase 27 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | jest 29.x (ts-jest) |
| **Config file** | package.json (`jest` via `npm test` → `jest`) |
| **Quick run command** | `npx jest --testPathPattern="consent\|webhooks/client-menu\|conversation-router" --no-coverage` |
| **Full suite command** | `npx jest --testPathPattern="<phase-scoped pattern>" --no-coverage` (bare `npm test` avoided project-wide — full suite is known to be slow/flaky on this machine) |
| **Estimated runtime** | ~20-35s for the phase-scoped pattern above |

---

## Sampling Rate

- **After every task commit:** Ran each task's own `<verify><automated>` command (tsc and/or targeted jest pattern)
- **After every plan wave:** Ran the combined phase-scoped jest pattern (4 suites, 52 tests) — all green
- **Before `/gsd-verify-work`:** Phase-scoped suite green (confirmed); full untargeted suite not run (see Manual-Only note)
- **Max feedback latency:** ~35 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 27-01-T1 | 01 | 1 | COMP-02 | T-27-01(27-01) / T-27-02(27-01) | Schema default flips true→false; migration backfill scoped, idempotent | typecheck | `npx tsc --noEmit` | ✅ | ✅ green |
| 27-01-T2 | 01 | 1 | COMP-02 | — | `insertClientBusinessRelationship` no longer hardcodes `consentGiven:true`; `onConflictDoUpdate` unchanged (Pitfall 3) | unit | `npx jest --testPathPattern="consent" --no-coverage` | ✅ | ✅ green |
| 27-01-T3 | 01 | 1 | COMP-02 | T-27-03(27-01) / T-27-04(27-01) | Migration applied to live Neon DB; `column_default` verified `false`; no secrets logged | integration (live DB) | `node -e "…SELECT column_default…"` (inline, see 27-01-PLAN.md) | ✅ | ✅ green |
| 27-02-T1 | 02 | 2 | COMP-01, COMP-02 | T-27-07(27-02) | `CONSENT_LABELS`/`CONSENT_PROMPT_GREEK_TEMPLATE`/`CONSENT_KEYBOARD` added; `getOrCreateClientRelationship` reflects real inserted row's `consentGiven` | unit | `npx jest --testPathPattern="consent" --no-coverage` | ✅ | ✅ green |
| 27-02-T2 | 02 | 2 | COMP-01, COMP-02 | T-27-04(27-02) / T-27-05(27-02) | `/start` hard-gates on `consentGiven=false`; `consent:yes`/`consent:no` scoped to authenticated `(business.id, senderTelegramId)` | integration | `npx jest --testPathPattern="webhooks/client-menu" --no-coverage` | ✅ | ✅ green |
| 27-02-T3 | 02 | 2 | COMP-01 | T-27-06(27-02) / T-27-08(27-02) | Free-chat hard-gates before `aiBookingAgent`/`insertConversationTurn`; declining is fully recoverable | integration | `npx jest --testPathPattern="conversation-router" --no-coverage` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure (jest + ts-jest, already configured) covers all phase requirements — no new test framework or fixtures needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end `/start` on a real Telegram client seeing the Ναι/Όχι keyboard render correctly | COMP-01 | Telegram inline-keyboard rendering itself isn't exercised by jest mocks — only the `sendTelegramMessageWithKeyboard` call args are asserted | Message the live bot's `/start` from a fresh (or reset) Telegram account; confirm the Ναι/Όχι buttons render and tapping each produces the expected menu/decline-ack |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none — infra already present)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-28
