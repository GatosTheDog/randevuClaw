---
phase: 8
slug: enforcement-session-deduction
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-21
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest + Drizzle ORM in-process Postgres (same as Phase 7) |
| **Config file** | jest.config.js (existing from Phase 2+) |
| **Quick run command** | `npm test -- src/billing/__tests__/enforcement.test.ts --testTimeout=10000` |
| **Full suite command** | `npm test -- src/billing/__tests__/enforcement.test.ts src/conversation/__tests__/booking-enforcement.test.ts` |
| **Estimated runtime** | ~15 seconds (quick) / ~60 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- src/billing/__tests__/enforcement.test.ts --testTimeout=10000`
- **After every plan wave:** Run `npm test -- src/billing/__tests__/enforcement.test.ts src/conversation/__tests__/booking-enforcement.test.ts`
- **Before `/gsd-verify-work`:** Full suite must be green + manual UAT of "block" and "flag" policies via Telegram
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-W0-01 | 01 | 0 | SESS-01..04, ENFC-01..03 | T-08-01 / T-08-02 | Test stubs exist before any implementation; schema migration applied | unit stub | `npm test -- src/billing/__tests__/enforcement.test.ts` | ❌ W0 | ⬜ pending |
| 08-W0-02 | 01 | 0 | ENFC-01 | T-08-03 | NLU tool stubs compile without importing unbuilt modules | unit stub | `npm test -- src/onboarding/__tests__/ai-owner-agent.test.ts` | ❌ W0 | ⬜ pending |
| 08-01-01 | Schema | 1 | ENFC-01 | T-08-04 | enforcement_policy column exists on businesses table; drizzle-kit push applied | integration | `npm test -- src/billing/__tests__/enforcement.test.ts -t "schema"` | ❌ W0 | ⬜ pending |
| 08-02-01 | Deduction | 2 | SESS-01 | T-08-01 | Concurrent bookings deduct exactly once from same membership (race prevented) | integration | `npm test -- src/billing/__tests__/enforcement.test.ts -t "concurrent_booking_same_membership_deducts_one"` | ❌ W0 | ⬜ pending |
| 08-02-02 | Deduction | 2 | SESS-03,04 | — | Unlimited memberships: no ledger entry, no counter change on book/cancel | unit | `npm test -- src/billing/__tests__/enforcement.test.ts -t "unlimited_membership"` | ❌ W0 | ⬜ pending |
| 08-03-01 | Cancel | 3 | SESS-02 | T-08-02 | Cancel within validity restores credit; cancel after expiry forfeits credit | integration | `npm test -- src/billing/__tests__/enforcement.test.ts -t "cancel.*refund"` | ❌ W0 | ⬜ pending |
| 08-04-01 | Enforce | 4 | ENFC-02 | T-08-03 | Block policy + no membership → booking refused, no booking inserted | integration | `npm test -- src/conversation/__tests__/booking-enforcement.test.ts -t "block_policy_refuses_unpaid"` | ❌ W0 | ⬜ pending |
| 08-04-02 | Enforce | 4 | ENFC-03 | T-08-03 | Flag policy + no membership → booking inserted, owner alert sent (best-effort) | integration | `npm test -- src/conversation/__tests__/booking-enforcement.test.ts -t "flag_policy_books_and_alerts"` | ❌ W0 | ⬜ pending |
| 08-05-01 | NLU | 5 | ENFC-01 | T-08-04 | set_enforcement_policy NLU tool persists "block"/"flag" to DB; rejects invalid values | integration | `npm test -- src/onboarding/__tests__/ai-owner-agent.test.ts -t "set_enforcement_policy"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/billing/__tests__/enforcement.test.ts` — stubs for SESS-01/02/03/04 (concurrent deduction, expiry-aware refund, unlimited no-op)
- [ ] `src/conversation/__tests__/booking-enforcement.test.ts` — stubs for ENFC-02/03 (block vs flag policies)
- [ ] `src/onboarding/__tests__/ai-owner-agent.test.ts::set_enforcement_policy` — stub for ENFC-01 (policy NLU tool)
- [ ] Schema migration `0005-enforcement-policy.sql` + `drizzle-kit push` [BLOCKING — must run before any code]
- [ ] Integration test fixtures: 2 memberships (1 active + 1 expired), businesses with "block" and "flag" enforcement policies

*All stubs must compile without imports from unbuilt modules (use `it.todo` pattern from Phase 7).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| "Block" policy blocks unpaid client via real Telegram chat | ENFC-02 | Requires live bot session; mocked in unit tests only | Set policy to "block", send booking request from client with no membership, verify Greek refusal message received |
| "Flag" policy allows booking and sends owner alert | ENFC-03 | Requires live Telegram delivery for both client and owner | Set policy to "flag", book as unpaid client, verify booking created AND owner receives Greek alert message |
| Owner changes enforcement policy mid-session via chat | ENFC-01 | Requires live NLU tool invocation | Send "θέλω να αλλάξω πολιτική επιβολής σε block" to owner bot; verify DB updated and subsequent booking uses new policy |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
