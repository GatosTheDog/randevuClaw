---
phase: 02
slug: ai-booking-conversations-owner-alerts
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-08
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest + ts-jest (existing Phase 1 setup) |
| **Config file** | `jest.config.js` (verify exists; set up in Wave 0 if not) |
| **Quick run command** | `npm test -- src/conversation/ --testPathPattern="ai-agent"` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds (quick), ~2 minutes (full, TBD once suite exists) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- src/conversation/ai-agent.test.ts` (AI agent function tests)
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd-verify-work`:** Full suite must be green, including concurrency integration test
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

*Task IDs are assigned during planning — this table is completed by the planner/executor once PLAN.md tasks exist. Requirement-to-test-type mapping below is locked from research and should not change during planning.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | BOOK-01 | — | Client books appointment via Telegram chat | integration | `npm test -- booking.integration.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | BOOK-02 | — | Client cancels via chat, auto-processed, no owner veto | integration | `npm test -- cancellation.integration.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | BOOK-03 | — | Client checks availability ("έχετε ελεύθερο;") | unit | `npm test -- src/conversation/availability.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | BOOK-04 | — | Client reschedules via chat | integration | `npm test -- reschedule.integration.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ASK-01 | — | Client asks hours/location/prices → bot answers | integration | `npm test -- faq.integration.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ASK-02 | — | Client asks freeform question → Gemini responds in Greek | integration | `npm test -- freeform.integration.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | OWNR-02 | — | Owner receives alert + approves/rejects via Telegram inline keyboard | integration | `npm test -- owner-approval.integration.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/conversation/ai-agent.test.ts` — unit tests for Gemini function-calling loop (sequential execution, idempotency keys)
- [ ] `src/conversation/greek-preprocessor.test.ts` — unit tests for Greek date/time parsing (20+ test cases per Pitfall 6)
- [ ] `src/database/availability.test.ts` — unit tests for availability query at 1-hour granularity
- [ ] `tests/integration/booking.integration.test.ts` — end-to-end Telegram webhook → Gemini → booking
- [ ] `tests/integration/concurrency.integration.test.ts` — dual concurrent bookings to same slot (expect exactly one success, per D-10)
- [ ] `jest.config.js` — configure ts-jest for TypeScript if not already present from Phase 1

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Owner inline-keyboard tap flow (Αποδοχή / Απόρριψη) | OWNR-02 | Requires live Telegram client to visually confirm button rendering + callback round-trip | Send test booking to fixture business, tap button in real Telegram app, confirm client receives follow-up message |
| 2-hour pending-booking auto-expiry (D-09) | BOOK-01 | Real-time wait or clock manipulation not practical in unit tests | Create pending booking, fast-forward DB trigger/timestamp, confirm slot releases and client is notified |
| Greek conversational tone/naturalness | ASK-02 | Subjective quality judgment, not a pass/fail assertion | Manually converse with bot in Greek across 5-10 varied phrasings, confirm responses read naturally |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
