---
phase: 02
slug: ai-booking-conversations-owner-alerts
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-08
audited: 2026-07-09
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest + ts-jest |
| **Config file** | `jest.config.js` ✅ exists |
| **Quick run command** | `npm test -- tests/ai-agent.test.ts tests/function-executor.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~20 seconds (full suite: 25 suites, 208 tests) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- tests/function-executor.test.ts tests/ai-agent.test.ts` (~5s)
- **After every plan wave:** Run `npm test` (full suite)
- **Before `/gsd-verify-work`:** Full suite must be green — confirmed 208/208 pass
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| Plan-01 | 02-01 | 1 | BOOK-01 | D-10, D-11 | Partial-unique index enforces slot atomicity; insertBooking idempotent via onConflictDoNothing | integration | `npm test -- tests/booking-queries.test.ts` | ✅ | ✅ green |
| Plan-01 | 02-01 | 1 | BOOK-02 | — | Cancel releases slot (D-11); typed query layer correct | integration | `npm test -- tests/booking-queries.test.ts` | ✅ | ✅ green |
| Plan-03 | 02-03 | 2 | BOOK-03 | — | checkAvailability returns 1-hour slots, excludes occupied, handles closed day | unit | `npm test -- tests/availability.test.ts` | ✅ | ✅ green |
| Plan-05 | 02-05 | 4 | BOOK-04 | — | reschedule_appointment creates new booking, references original, keyboard encodes NEW id | unit | `npm test -- tests/function-executor.test.ts` | ✅ | ✅ green |
| Plan-02 | 02-02 | 2 | ASK-01 | — | Telegram client sends text/keyboard; config validated | unit | `npm test -- tests/telegram-client.test.ts tests/config.test.ts` | ✅ | ✅ green |
| Plan-07 | 02-07 | 1* | ASK-02 | — | Greek temporal corpus (26 phrases) resolves correctly; annotation/robustness cases pass | unit | `npm test -- tests/greek-preprocessor.test.ts` | ✅ | ✅ green |
| Plan-05 | 02-05 | 4 | OWNR-02 | — | Owner callback_query flow: Αποδοχή/Απόρριψη inline keyboard, race-safe, non-owner rejected | unit | `npm test -- tests/telegram-webhook.test.ts` | ✅ | ✅ green |
| Plan-04 | 02-04 | 3 | BOOK-01 | — | aiBookingAgent Gemini loop: sequential tool calls, idempotency keys, MAX_TOOL_ROUNDS guard, 429 retry | unit | `npm test -- tests/ai-agent.test.ts` | ✅ | ✅ green |
| Plan-04 | 02-04 | 3 | BOOK-02 | — | routeConversationMessage dispatches to aiBookingAgent; conversation-router wires Telegram→Gemini | unit | `npm test -- tests/conversation-router.test.ts` | ✅ | ✅ green |
| Plan-06 | 02-06 | 1* | BOOK-01 | — | executeTool cross-tenant guard (business_id mismatch → cross_tenant_denied) | unit | `npm test -- tests/function-executor.test.ts` | ✅ | ✅ green |
| Plan-06 | 02-06 | 1* | BOOK-02 | CR-03a | cancel_appointment succeeds even when post-cancel Telegram notification fails | unit | `npm test -- tests/function-executor.test.ts` | ✅ | ✅ green |
| Plan-06 | 02-06 | 1* | BOOK-04 | CR-03b | reschedule_appointment succeeds even when owner-alert Telegram send fails | unit | `npm test -- tests/function-executor.test.ts` | ✅ | ✅ green |
| Plan-08 | 02-08 | 1* | OWNR-02 | CR-04 | runExpirySweep: one notification failure does not halt batch; startExpiryPoller lifecycle | unit | `npm test -- tests/expiry-poller.test.ts` | ✅ | ✅ green |
| Plan-09 | 02-09 | 1* | OWNR-02 | CR-05 | Owner-approval race: only one callback_query wins the concurrent-update race, duplicate ignored | unit | `npm test -- tests/telegram-webhook.test.ts` | ✅ | ✅ green |
| Plan-01 | 02-01 | 1 | BOOK-01 | — | Duplicate Telegram message idempotency (insertOrIgnoreTelegramUpdate dedup) | unit | `npm test -- tests/idempotency.test.ts` | ✅ | ✅ green |

*Plans 06–09 are gap-closure plans executed as Wave 1 additions after initial execution waves.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/ai-agent.test.ts` — 11 unit tests for Gemini function-calling loop (sequential execution, idempotency keys, MAX_TOOL_ROUNDS, 429 retry) ✅
- [x] `tests/greek-preprocessor.test.ts` — 26 tests for Greek temporal corpus (20 canonical phrases + annotation/robustness cases) ✅
- [x] `tests/availability.test.ts` — 8 unit tests for availability query at 1-hour granularity (open/closed/occupied/unknown-service) ✅
- [x] `tests/function-executor.test.ts` — 15 unit tests covering full CRUD: book/cancel/reschedule/cross-tenant-guard ✅
- [x] `tests/booking-queries.test.ts` — 7 real-Postgres integration tests for slot atomicity, idempotency, D-11 slot release ✅
- [x] `jest.config.js` — ts-jest TypeScript config present ✅

> Note: paths originally drafted as `src/conversation/*.test.ts` and `tests/integration/*.test.ts`; actual implementation placed all tests under `tests/` flat layout. Coverage equivalent.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Owner inline-keyboard tap flow (Αποδοχή / Απόρριψη) | OWNR-02 | Requires live Telegram client to visually confirm button rendering + callback round-trip | Send test booking to fixture business, tap button in real Telegram app, confirm client receives follow-up message |
| 2-hour pending-booking auto-expiry (D-09) | BOOK-01 | Real-time wait or clock manipulation not practical; poller logic tested in unit tests | Create pending booking, fast-forward DB timestamp via SQL, confirm slot releases and client is notified |
| Greek conversational tone/naturalness | ASK-02 | Subjective quality judgment, not a pass/fail assertion | Manually converse with bot in Greek across 5-10 varied phrasings, confirm responses read naturally |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s (full suite: ~20s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 2026-07-09 — automated (all 208 tests green, no gaps found)

---

## Validation Audit 2026-07-09

| Metric | Count |
|--------|-------|
| Test suites | 25 |
| Tests total | 208 |
| Gaps found | 0 |
| Resolved | 0 |
| Escalated to manual-only | 0 (3 pre-existing manual items retained) |
| Requirements covered | 7/7 (BOOK-01, BOOK-02, BOOK-03, BOOK-04, ASK-01, ASK-02, OWNR-02) |
