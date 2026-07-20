# Phase 8: Enforcement & Session Deduction - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-20
**Phase:** 08-enforcement-session-deduction
**Areas discussed:** Deduction timing, Enforcement policy UX, Credit restoration scope, Enforcement check placement

---

## Deduction Timing

| Option | Description | Selected |
|--------|-------------|----------|
| At booking INSERT | Deduct when client finalizes their request — same transaction as insertBooking. Matches SESS-01 literally. Session balance drops immediately. Owner rejection must also restore the credit. | ✓ |
| At owner APPROVAL only | Deduct only when owner taps Αποδοχή. Session reserved but not deducted until confirmed. | |

**User's choice:** At booking INSERT (Recommended)
**Notes:** Deduction at insert; owner rejection treated identically to cancellation for credit restore purposes.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — rejection = cancellation | Owner rejection triggers credit-restore logic (SESS-02 applies). handleCallbackQuery reject branch gets a ledger credit entry. | ✓ |
| No — rejection does not restore | Owner rejection does not restore session. | |

**User's choice:** Yes — rejection = cancellation

---

## Enforcement Policy UX

| Option | Description | Selected |
|--------|-------------|----------|
| 'allow' (no enforcement) | Backward-compatible default. Owner must explicitly enable block or flag. | ✓ |
| 'flag' (allow + alert) | Immediately activates soft enforcement for all existing businesses. | |
| 'block' | Immediately blocks all clients without membership. | |

**User's choice:** 'allow' (no enforcement) — safest migration default

| Option | Description | Selected |
|--------|-------------|----------|
| NLU via ai-owner-agent.ts | Owner types natural Greek; Gemini calls set_enforcement_policy tool. Consistent with Phase 7. | ✓ |
| Keyword command | Specific trigger phrase like '/policy block'. | |

**User's choice:** NLU via ai-owner-agent.ts

---

## Credit Restoration Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Client cancel (button) | Client taps '🚫 Ακύρωση κράτησης' — handleClientCancelCallback in telegram.ts. | ✓ |
| Owner reject | Owner taps 'Απόρριψη' — session was deducted at insert, so rejection must restore it. | ✓ |
| Client cancel via NLU | Client says 'cancel my appointment' — cancelAppointmentTool in function-executor.ts. | ✓ |

**User's choice:** All three paths restore session credit.

| Option | Description | Selected |
|--------|-------------|----------|
| Check membership.expiresAt at cancellation time | Look up client's membership at cancel time, check if expired. If expired: skip credit restore. | ✓ |
| Record expiry state at booking insert time | Stamp a flag at booking creation. Use that flag later. | |

**User's choice:** Check membership.expiresAt at cancellation time (Recommended)

---

## Enforcement Check Placement

| Option | Description | Selected |
|--------|-------------|----------|
| In bookAppointmentTool (function-executor.ts) | Before insertBooking: check membership + policy. Return refusal or flag alert. | ✓ |
| In insertBooking (database/queries.ts) | Add pre-check inside DB layer. | |
| In webhook handler (webhooks/telegram.ts) | Pre-AI check before message reaches Gemini. | |

**User's choice:** In bookAppointmentTool (function-executor.ts)

| Option | Description | Selected |
|--------|-------------|----------|
| Immediately on booking insert, same flow as owner approval request | Owner gets flag alert + normal pending-approval notification synchronously. | ✓ |
| As separate post-insert async step | Async alert after insert. | |

**User's choice:** Immediately on booking insert, same flow as owner approval request

---

## Claude's Discretion

- Exact CHECK constraint syntax for `enforcement_policy` column (text with constraint vs app-layer validation)
- Precise Greek message wording for block refusal and flag alert (specifics section has suggestions)
- Whether flag alert fires before or after the Αποδοχή/Απόρριψη keyboard (specifics suggest before)

## Deferred Ideas

- Per-service enforcement policies — out of PoC scope
- Owner enforcement audit log — v1.3
- "Warn client" third enforcement tier — v1.3
- Follow-up "buy a membership" flow for blocked clients — future
