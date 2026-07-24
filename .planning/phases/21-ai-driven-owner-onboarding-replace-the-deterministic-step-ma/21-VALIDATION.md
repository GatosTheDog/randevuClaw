---
phase: 21
slug: ai-driven-owner-onboarding-replace-the-deterministic-step-ma
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-24
---

# Phase 21 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7+ (existing test suite) |
| **Config file** | `jest.config.js` (root) |
| **Quick run command** | `npm test -- tests/onboarding.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- tests/onboarding.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 21-01-01 | 01 | 1 | TBD (planner-assigned) | T-21-01 | RLS-enforced tool execution via getConn()/withBusinessContext | integration | `npm test -- tests/onboarding.test.ts -t "happy path"` | ❌ W0 | ⬜ pending |
| 21-01-02 | 01 | 1 | TBD (planner-assigned) | — | Greek clarification loop respects MAX_TOOL_ROUNDS | integration | `npm test -- tests/onboarding.test.ts -t "clarification"` | ❌ W0 | ⬜ pending |
| 21-01-03 | 01 | 1 | TBD (planner-assigned) | — | Max-rounds cap exits gracefully with Greek fallback message | integration | `npm test -- tests/onboarding.test.ts -t "max rounds"` | ❌ W0 | ⬜ pending |
| 21-02-01 | 02 | 1 | TBD (planner-assigned) | T-21-02 | executeOnboardingTool never imports raw `db`, always `getConn()` | unit | `npm test -- tests/onboarding-tools.test.ts` | ❌ W0 | ⬜ pending |
| 21-03-01 | 03 | 2 | TBD (planner-assigned) | — | Message-path webhook routes to aiOnboardingAgent, not dispatchOnboardingStep | integration | `npm test -- tests/webhooks/telegram.test.ts -t "onboarding"` | ❌ W0 | ⬜ pending |
| 21-03-02 | 03 | 2 | TBD (planner-assigned) | — | callback_query onboarding branch routes to aiOnboardingAgent | integration | `npm test -- tests/webhooks/telegram.test.ts -t "onboarding callback"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task IDs above are placeholders — the planner assigns real plan/task IDs; update this map to match once PLAN.md files exist.*

---

## Wave 0 Requirements

- [ ] `tests/onboarding-agent.test.ts` — full integration suite (happy path, clarifications, max rounds, error cases)
- [ ] `tests/onboarding-tools.test.ts` — unit tests for executeOnboardingTool (each tool case, getConn() usage verification)
- [ ] `tests/webhooks/telegram-onboarding.test.ts` — webhook routing for message + callback_query paths
- [ ] System prompt fixtures — example prompts for various onboarding states (new, mid-hours, mid-services)
- [ ] Mock Gemini interactions — pre-recorded responses for deterministic testing (avoid live API calls in CI)

*Existing test infrastructure (jest, async test helpers) already covers other phases (booking, billing, session) — reuse fixtures/patterns where possible.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Telegram round-trip: owner sends the exact repro phrase ("9 το πρωι με 9 το βραδυ και ενα διαλυμα απο 1 μεχρι 5") and business hours are stored correctly | TBD | Requires live Gemini API call + real Telegram bot; not mocked in CI | Send the phrase to the test bot mid-onboarding, confirm businessHours rows match 09:00–13:00 + 17:00–21:00 (or equivalent split), confirm no regex rejection message appears |
| Full 25-step flow start-to-finish via real chat, including class-schedule setup and v1.3 config toggles | TBD | End-to-end conversational flow across multiple turns; brittle to fully mock | Manually onboard a fresh test business via Telegram, verify `onboardingCompleted=true` and routing switches to aiOwnerAgent/admin menu afterward |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
