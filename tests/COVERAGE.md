# Test Coverage Map

Maps test files to requirement IDs. Updated at the end of each phase.

---

## Phase 7 — billing-configuration-payment-recording

| Test File | Requirements Covered |
|-----------|----------------------|
| tests/billing-nlu-parsing.test.ts | BILL-01 |
| tests/billing-package-creation.test.ts | BILL-02 |
| tests/billing-package-list.test.ts | BILL-02 |
| tests/billing-package-deactivate.test.ts | BILL-02 |
| tests/billing-view-membership.test.ts | BILL-03 |
| tests/billing-payment-flow.test.ts | PAY-01 |
| tests/billing-membership-creation.test.ts | PAY-02 |
| tests/billing-dst-arithmetic.test.ts | PAY-02 |

---

## Phase 8 — enforcement-session-deduction

| Test File | Requirements Covered |
|-----------|----------------------|
| tests/enforcement-session-deduction.test.ts | SESS-01, SESS-02, SESS-03, SESS-04 |
| tests/booking-enforcement.test.ts | ENFC-02, ENFC-03 |
| tests/enforcement-nlu.test.ts | ENFC-01 |

---

## Phase 26 — confirmation-approval-policy

| Test File | Requirements Covered |
|-----------|----------------------|
| tests/session-assignment.test.ts | CONF-02 |
| tests/session-booking-flow.test.ts | CONF-02 |
| tests/webhooks/client-menu.test.ts | CONF-02 |
| tests/ai-owner-cancel-session.test.ts | CONF-01 |
| tests/ai-owner-confirmation-policy.test.ts | CONF-01 |
| tests/telegram-webhook.test.ts | CONF-01 |
