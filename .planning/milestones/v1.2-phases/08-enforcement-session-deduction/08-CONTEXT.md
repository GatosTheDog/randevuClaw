# Phase 8: Enforcement & Session Deduction - Context

**Gathered:** 2026-07-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Booking lifecycle integration with the session ledger, plus per-business membership enforcement. This phase delivers:
- Session deduction in `membership_ledger` atomically with booking insert (in `bookAppointmentTool`)
- Session credit restoration on booking cancellation and owner rejection (SESS-02/03)
- Unlimited-session membership support: no count change, only expiry check (SESS-04)
- `enforcement_policy` column added to `businesses` table via schema migration
- Owner sets enforcement policy via NLU (`ai-owner-agent.ts` `set_enforcement_policy` tool)
- Enforcement pre-check in `bookAppointmentTool` before `insertBooking`: block or flag clients with no valid membership
- Owner alert for "flag" policy fires immediately alongside the normal pending-approval notification

**No new schema tables.** Phase 7 already created `membership_ledger`, `memberships`, `billing_packages`. Phase 8 adds only the `enforcement_policy` column to `businesses`.

</domain>

<decisions>
## Implementation Decisions

### Session Deduction Timing (SESS-01)
- **D-01:** Session deduction happens at booking INSERT — same database transaction as `insertBooking()` in `bookAppointmentTool` (function-executor.ts). Matches SESS-01 literally ("same database transaction as the booking insert").
- **D-02:** The `membership_ledger` entry with `event_type = 'session_deducted'` is written inside the same Drizzle transaction as the new booking row. `idempotency_key` = `booking:<bookingId>:deduction` prevents double-deductions on Telegram redelivery.

### Credit Restoration Scope (SESS-02/SESS-03)
- **D-03:** All three cancel paths restore a session credit (if applicable): (a) client taps "Ακύρωση" button → `handleClientCancelCallback`, (b) owner taps "Απόρριψη" → `handleCallbackQuery` reject branch, (c) client says "cancel" via NLU → `cancelAppointmentTool` in function-executor.ts. Owner rejection is treated identically to cancellation.
- **D-04:** At credit-restore time, check `membership.expiresAt < now (Europe/Athens)`. If expired: skip credit restore (SESS-03). If valid: write a `credit_restored` ledger entry atomically with the booking status update.
- **D-05:** `idempotency_key` for credit restore = `booking:<bookingId>:credit`. Prevents double-credits if cancel is retried.

### Unlimited Memberships (SESS-04)
- **D-06:** When `membership.sessionCount IS NULL` (unlimited), skip the deduction ledger entry entirely. Only check `membership.expiresAt` to determine validity. No credit restore needed on cancellation either (nothing was deducted).

### Enforcement Policy (ENFC-01/02/03)
- **D-07:** Add `enforcement_policy text NOT NULL DEFAULT 'allow'` to `businesses` table via schema migration (migration after Phase 7's last migration). Allowed values: `'allow'` | `'block'` | `'flag'`.
- **D-08:** Default is `'allow'` — backward-compatible. Existing businesses continue working without any membership check until the owner explicitly sets a policy.
- **D-09:** Owner sets policy via NLU: Gemini recognizes intent in `ai-owner-agent.ts` and calls a new `set_enforcement_policy` tool. Consistent with Phase 7 NLU command pattern. Example triggers: "ορίσε πολιτική block", "θέλω να μπλοκάρω απλήρωτους πελάτες", "policy flag".
- **D-10:** Enforcement check lives in `bookAppointmentTool` (function-executor.ts), before calling `insertBooking`. Logic: (1) fetch business's `enforcement_policy`, (2) look up client's active membership for this business, (3) if policy=`block` + no valid membership → return Greek refusal without inserting, (4) if policy=`flag` + no valid membership → proceed with insert, send owner Greek alert alongside normal pending-approval notification.
- **D-11:** "Flag" owner alert fires immediately, same synchronous flow as the normal Αποδοχή/Απόρριψη keyboard message. Alert text identifies the client by `client_name` (from Phase 7 `clientBusinessRelationships.client_name`).

### Idempotency & Race Safety
- **D-12:** All ledger writes use the `idempotency_key` UNIQUE constraint established in Phase 7. No new constraint needed — the schema already prevents double-deduction via `conflict: 'ignore'` or equivalent Drizzle `onConflictDoNothing()`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/ROADMAP.md` §Phase 8 — goal, success criteria, dependencies
- `.planning/REQUIREMENTS.md` §SESS-01..04, ENFC-01..03 — locked requirements for this phase
- `.planning/REQUIREMENTS.md` §Out of Scope — one active membership per client per business; no multiple concurrent memberships

### Schema & Existing Billing Layer (Phase 7)
- `src/database/schema.ts` — `memberships`, `membership_ledger`, `billing_packages`, `businesses` tables; all Drizzle conventions (prices in cents, TIMESTAMP WITH TIME ZONE, nullables with JSDoc)
- `.planning/phases/07-billing-configuration-payment-recording/07-CONTEXT.md` — Phase 7 decisions (D-10: one active membership, D-11: schema migration scope, idempotency pattern)

### Booking Lifecycle Code
- `src/conversation/function-executor.ts` — `bookAppointmentTool` (where enforcement check + session deduction go), `cancelAppointmentTool` (where credit restore goes), `insertBooking` import
- `src/webhooks/telegram.ts` — `handleClientCancelCallback` (credit restore path A), `handleCallbackQuery` reject branch (credit restore path B); Phase 7 billing callback routing already present
- `src/database/queries.ts` — `insertBooking`, `updateBookingStatusIfPending`, `updateBookingStatus`, `findBookingByIdUnscoped`

### Billing Query Layer (Phase 7)
- `src/billing/queries.ts` (Phase 7 artifact) — membership lookup functions, ledger insert functions; Phase 8 extends these
- `src/onboarding/ai-owner-agent.ts` — existing NLU tool pattern; `set_enforcement_policy` tool follows the same shape as Phase 7 billing tools

### Timezone
- `src/utils/timezone.ts` — Europe/Athens expiry comparisons; use for `expiresAt < now` checks in SESS-03

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `membership_ledger` write functions from Phase 7 billing/queries.ts: extend with `session_deducted` and `credit_restored` event types
- `idempotency_key` UNIQUE + `onConflictDoNothing()` pattern: already established in Phase 7 ledger inserts — reuse for deduction and credit entries
- `ai-owner-agent.ts` Gemini tool pattern: `set_enforcement_policy` follows exact same shape as `create_package`, `record_payment` (tool definition + handler function)
- `findClientMembership` or equivalent query from Phase 7: reuse to check validity in `bookAppointmentTool`
- `client_name` from `clientBusinessRelationships`: available for owner flag alert text

### Established Patterns
- Drizzle transaction wrapping: `db.transaction(async (tx) => {...})` — both booking insert and ledger deduction must share `tx`
- `withBusinessContext()` / AsyncLocalStorage RLS: all DB queries inside booking flow already use this; ledger writes must too
- `onConflictDoNothing()` for idempotency: established in Phase 7 ledger insert; same pattern for deduction/credit
- Greek language for all client-facing and owner-facing messages
- Best-effort pattern for non-critical side effects (calendar sync, owner notifications): owner flag alert is critical — do NOT make it best-effort; it should be awaited before responding to client

### Integration Points
- `bookAppointmentTool` in function-executor.ts: add enforcement pre-check + session deduction (same tx as insertBooking)
- `cancelAppointmentTool` in function-executor.ts: add credit-restore logic after booking status update
- `handleClientCancelCallback` in telegram.ts: add credit-restore logic after `updateBookingStatus`
- `handleCallbackQuery` reject branch in telegram.ts: add credit-restore logic (same as cancel)
- `handleCallbackQuery` approve branch in telegram.ts: NO change needed (deduction at insert, not approval)
- Schema migration: add `enforcement_policy text NOT NULL DEFAULT 'allow'` to `businesses` table

</code_context>

<specifics>
## Specific Ideas

- Greek refusal message for "block" policy: "Για να κάνετε κράτηση, χρειάζεστε ενεργή συνδρομή. Επικοινωνήστε με [business name] για ανανέωση."
- Greek flag alert to owner: "⚠️ Νέα κράτηση από πελάτη χωρίς ενεργή συνδρομή: [client_name], [service], [date] [time]."
- `enforcement_policy` column: use a text column with CHECK constraint `IN ('allow', 'block', 'flag')` for safety — or rely on app-layer validation. Planner decides.
- The flag alert should fire BEFORE the Αποδοχή/Απόρριψη keyboard message to the owner, so the owner sees the warning in context.

</specifics>

<deferred>
## Deferred Ideas

- Per-service enforcement policies (block pilates but allow yoga) — out of PoC scope per REQUIREMENTS.md
- Owner UI to view full enforcement history / audit log — v1.3
- "Warn client" mode (a third enforcement tier between flag and block) — possible v1.3 addition
- Auto-notify client about no-membership on attempted booking (ENFC-02 block covers the immediate refusal; a follow-up "here's how to buy a membership" flow is deferred)

</deferred>

---

*Phase: 8-Enforcement & Session Deduction*
*Context gathered: 2026-07-20*
