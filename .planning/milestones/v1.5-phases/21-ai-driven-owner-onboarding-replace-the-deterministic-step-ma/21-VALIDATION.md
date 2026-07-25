---
phase: 21
slug: ai-driven-owner-onboarding-replace-the-deterministic-step-ma
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-24
validated: 2026-07-25
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

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|-------------|--------|
| 21-01 D1 | 01 | 1 | D-02 | buildOnboardingSystemPrompt derives missing-field state from live DB rows, never a stored step index | unit | `npx jest tests/onboarding/ai-onboarding-agent.test.ts -t "buildOnboardingSystemPrompt"` | ✅ | ✅ green |
| 21-01 D2 | 01 | 1 | D-01 | ONBOARDING_TOOLS declares all 10 Gemini function tools | unit | `npx jest tests/onboarding/ai-onboarding-agent.test.ts -t "ONBOARDING_TOOLS"` | ✅ | ✅ green |
| 21-01 D3 | 01 | 1 | D-01 | executeOnboardingTool: all 10 tool cases scoped via withBusinessContext/getConn() (RLS), errors caught and returned as Greek string | unit | `npx jest tests/onboarding/ai-onboarding-agent.test.ts -t "executeOnboardingTool"` | ✅ | ✅ green |
| 21-01 D4 | 01 | 1 | D-01 | finish_onboarding refuses activation until name+hours+service complete; on completion rotates webhook in exact order | unit | `npx jest tests/onboarding/ai-onboarding-agent.test.ts -t "finish_onboarding"` | ✅ | ✅ green |
| 21-01 D5 | 01 | 1 | D-03 | aiOnboardingAgent MAX_TOOL_ROUNDS=5 loop caps and returns graceful Greek fallback; previous_interaction_id threading | unit | `npx jest tests/onboarding/ai-onboarding-agent.test.ts -t "aiOnboardingAgent"` | ✅ | ✅ green |
| 21-02 D1 | 02 | 2 | D-01/D-02 | Owner message while onboardingCompleted=false routes to aiOnboardingAgent, not the deleted step machine | integration | `npx jest tests/webhooks/telegram-webhook.onboarding.test.ts -t "Scenario A"` | ✅ | ✅ green |
| 21-02 D2 | 02 | 2 | D-01/D-02 | callback_query tap routes to aiOnboardingAgent with callback_data as messageText | integration | `npx jest tests/webhooks/telegram-webhook.onboarding.test.ts -t "Scenario B2"` | ✅ | ✅ green |
| 21-02 D3 | 02 | 2 | D-01/D-02 | Empty-string agent reply sends no additional Telegram message (tool already replied) | integration | `npx jest tests/webhooks/telegram-webhook.onboarding.test.ts -t "Scenario B3"` | ✅ | ✅ green |
| 21-02 D4 | 02 | 2 | ARCH-03 guard | onboardingCompleted=true owner still routes to aiOwnerAgent; non-owner clients unaffected | integration | `npx jest tests/webhooks/telegram-webhook.onboarding.test.ts -t "Scenario C"` | ✅ | ✅ green |
| 21-03 D1 | 03 | 3 | D-01/D-02 | steps.ts/router.ts deleted; zero code references remain in src/ or tests/ | static | `grep -rn 'onboarding/router\|onboarding/steps' src/ tests/` | ✅ | ✅ green |
| 21-03 D2 | 03 | 3 | D-01/D-02 | queries.ts no longer exports dead session-lifecycle symbols | static | `grep -rn 'findActiveSessionByOwnerTelegramId\|createOrResetOnboardingSession\|updateOnboardingStep\|OnboardingSession' src/` | ✅ | ✅ green |
| 21-03 D3 | 03 | 3 | ONB-03 preservation | isOwnerEditCommand coverage relocated to dedicated file | unit | `npx jest tests/onboarding/edit-router.test.ts` | ✅ | ✅ green |
| 21-03 D4 | 03 | 3 | D-01/D-02 | Full onboarding-scoped suite compiles and passes with zero references to deleted modules | integration | `npx tsc --noEmit && npm test -- --testPathPattern=onboarding` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Re-audited 2026-07-25: original table (written at plan-phase time, before PLAN.md files existed) used placeholder task IDs and a since-abandoned test file layout (`tests/onboarding.test.ts`, `tests/onboarding-tools.test.ts`). Replaced with the actual coverage IDs from each plan's SUMMARY.md `coverage:` block, cross-checked against the real test files that ship in this phase.*

---

## Wave 0 Requirements

- [x] `tests/onboarding/ai-onboarding-agent.test.ts` — 24 unit tests: system-prompt completeness, all 10 tool cases, finish_onboarding branches, 4 Gemini-loop scenarios
- [x] `tests/webhooks/telegram-webhook.onboarding.test.ts` — 8 integration tests: message path, callback_query path, empty-reply no-send, onboarded/non-owner routing preserved
- [x] `tests/onboarding/edit-router.test.ts` — 3 unit tests: isOwnerEditCommand (ONB-03 preservation)
- [x] Mock Gemini interactions — all 3 suites mock the Gemini client; no live API calls in CI

*Existing test infrastructure (jest, async test helpers) already covers other phases (booking, billing, session) — reused per plan SUMMARY notes.*
*Verified 2026-07-25: `npx jest tests/onboarding/ai-onboarding-agent.test.ts tests/webhooks/telegram-webhook.onboarding.test.ts tests/onboarding/edit-router.test.ts` → 3 suites, 36/36 tests passing.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Telegram round-trip: owner sends the exact repro phrase ("9 το πρωι με 9 το βραδυ και ενα διαλυμα απο 1 μεχρι 5") and business hours are stored correctly | TBD | Requires live Gemini API call + real Telegram bot; not mocked in CI | Send the phrase to the test bot mid-onboarding, confirm businessHours rows match 09:00–13:00 + 17:00–21:00 (or equivalent split), confirm no regex rejection message appears |
| Full 25-step flow start-to-finish via real chat, including class-schedule setup and v1.3 config toggles | TBD | End-to-end conversational flow across multiple turns; brittle to fully mock | Manually onboard a fresh test business via Telegram, verify `onboardingCompleted=true` and routing switches to aiOwnerAgent/admin menu afterward |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-07-25

---

## Validation Audit 2026-07-25

| Metric | Count |
|--------|-------|
| Requirements audited | 4 (D-01, D-02, D-03, ONB-03) |
| Gaps found | 0 |
| Resolved | 0 (all pre-existing coverage, verified green) |
| Escalated | 0 |
| Stale placeholder rows rewritten | 6 → 13 (matched to real plan/SUMMARY coverage IDs) |

Audit found the original VALIDATION.md was written during plan-phase (before PLAN.md files existed) and never updated after execution — placeholder task IDs, `status: draft`, requirement column all "TBD". Re-derived the Per-Task Verification Map from the `coverage:` blocks in `21-01-SUMMARY.md`/`21-02-SUMMARY.md`/`21-03-SUMMARY.md` and confirmed by direct execution: `npx jest tests/onboarding/ai-onboarding-agent.test.ts tests/webhooks/telegram-webhook.onboarding.test.ts tests/onboarding/edit-router.test.ts` → 3 suites, 36/36 passing. No automated-coverage gaps for any of the 4 phase requirements.
