---
phase: 7
slug: billing-configuration-payment-recording
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-17
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest 29.7.0 (ts-jest preset) |
| **Config file** | jest.config.js |
| **Quick run command** | `npm test -- tests/billing-*.test.ts --testTimeout=10000` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- tests/billing-*.test.ts --testTimeout=10000`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green + manual UAT (owner creates package, records payment, checks membership)
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | BILL-01 | T-07-01 | NLU parse echoes values before write | unit | `npm test -- tests/billing-package-creation.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-02 | 01 | 1 | BILL-01 | T-07-01 | Gemini parses Greek pricing correctly | unit | `npm test -- tests/billing-nlu-parsing.test.ts -t "parse 10 sessions"` | ❌ W0 | ⬜ pending |
| 07-01-03 | 01 | 1 | BILL-02 | — | List packages returns only active ones | unit | `npm test -- tests/billing-package-list.test.ts` | ❌ W0 | ⬜ pending |
| 07-01-04 | 01 | 1 | BILL-03 | — | Deactivate leaves existing memberships intact | integration | `npm test -- tests/billing-package-deactivate.test.ts` | ❌ W0 | ⬜ pending |
| 07-02-01 | 02 | 2 | PAY-01 | T-07-04 | Client selection callback validated against owner | unit | `npm test -- tests/billing-payment-flow.test.ts -t "client selection"` | ❌ W0 | ⬜ pending |
| 07-02-02 | 02 | 2 | PAY-01 | T-07-04 | Package selection buttons exclude deactivated packages | unit | `npm test -- tests/billing-payment-flow.test.ts -t "package selection"` | ❌ W0 | ⬜ pending |
| 07-02-03 | 02 | 2 | PAY-02 | T-07-03 | Expiry = purchase_date + valid_days in Athens TZ | unit | `npm test -- tests/billing-membership-creation.test.ts -t "rolling expiry"` | ❌ W0 | ⬜ pending |
| 07-02-04 | 02 | 2 | PAY-02 | T-07-03 | DST boundary: Sept 22 + 30 days = Oct 22 not Oct 23 | unit | `npm test -- tests/billing-dst-arithmetic.test.ts` | ❌ W0 | ⬜ pending |
| 07-02-05 | 02 | 2 | PAY-03 | — | Query membership returns sessions remaining + expiry | unit | `npm test -- tests/billing-view-membership.test.ts` | ❌ W0 | ⬜ pending |
| 07-02-06 | 02 | 2 | PAY-03 | — | Unlimited membership shows "Απεριόριστες" in reply | unit | `npm test -- tests/billing-view-membership.test.ts -t "unlimited"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/billing-package-creation.test.ts` — covers BILL-01 (NLU parse, echo, confirm, insert)
- [ ] `tests/billing-nlu-parsing.test.ts` — covers BILL-01 Greek NLU edge cases
- [ ] `tests/billing-package-list.test.ts` — covers BILL-02 (list_packages tool)
- [ ] `tests/billing-package-deactivate.test.ts` — covers BILL-03 (deactivate, no FK cascade)
- [ ] `tests/billing-payment-flow.test.ts` — covers PAY-01 (client/package selection buttons, callback routing)
- [ ] `tests/billing-membership-creation.test.ts` — covers PAY-02 (rolling expiry, DST safety)
- [ ] `tests/billing-dst-arithmetic.test.ts` — edge case: Sept 22 + 30d = Oct 22 (not Oct 23)
- [ ] `tests/billing-view-membership.test.ts` — covers PAY-03 (query membership, format reply)
- [ ] `tests/helpers/billing-fixtures.ts` — test helpers: insertTestPackage(), insertTestMembership()
- [ ] Schema migration: `drizzle/migrations/0005-billing-schema.sql` (3 tables + 1 column)

*Existing `tests/jest.setup.ts` and `tests/helpers/test-business.ts` patterns provide the baseline. Phase 7 tests follow same patterns.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full owner payment recording flow via Telegram | PAY-01, PAY-02 | Inline keyboard multi-step requires real Telegram session | Send payment command, select client via button, select package via button, confirm, verify membership created |
| Greek language formatting of all replies | BILL-01, BILL-02, BILL-03, PAY-02, PAY-03 | Locale correctness requires human review | Trigger each command; verify Greek text, €X.XX price format, Athens timezone label |
| Owner deactivation hides package from payment UI | BILL-03, PAY-01 | Keyboard rendering requires live Telegram | Deactivate package; trigger payment flow; verify deactivated package absent from buttons |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
