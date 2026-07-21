# Phase 7 — API Coverage Matrix

Phase 7 billing commands extend the existing Gemini NLU tool system in ai-owner-agent.ts (D-07). No new API clients are introduced; all calls go through existing @google/genai and telegraf instances.

---

## Table 1 — Telegram Bot API (billing-relevant surface)

| Capability | Decision | Reason |
|------------|----------|--------|
| sendMessage | INTEGRATE | Billing confirmations and all replies to owner (package creation echo, payment confirmation, membership query result, error replies) |
| sendMessage with reply_markup InlineKeyboardMarkup | INTEGRATE | Client selection buttons (D-05) and package selection buttons (D-06) in the payment recording flow; keyboard rendered after Gemini detects record_payment intent (D-08) |
| answerCallbackQuery | INTEGRATE | Acknowledge button taps immediately before any DB operation to dismiss Telegram spinner; prevents "loading" state from persisting if DB write is slow |
| editMessageReplyMarkup | INTEGRATE | Applied to billing terminal confirmation steps only (billing:pkg_confirm, billing:pkg_cancel, billing:mem_confirm, billing:mem_cancel) — clears the Ναι/Όχι keyboard after owner taps either button so stale buttons do not linger. Intermediate steps (client selection, package selection) continue to send new messages. G-07-2. |

---

## Table 2 — Google Gemini API (billing-relevant surface)

| Capability | Decision | Reason |
|------------|----------|--------|
| generateContent with tools | INTEGRATE | NLU for all 5 billing intents via existing ai-owner-agent.ts loop (D-07); no new Gemini client needed |
| function_declarations for create_package tool | INTEGRATE | Parses name, price_cents, valid_days, session_count from owner Greek message (D-01); Gemini calls this tool when owner sends a package creation message |
| function_declarations for list_packages tool | INTEGRATE | Triggers package list query returning all active billing_packages for the business (BILL-02) |
| function_declarations for deactivate_package tool | INTEGRATE | Triggers soft-delete (sets is_active = false) on the named package without cascading to existing memberships (BILL-03) |
| function_declarations for record_payment tool | INTEGRATE | Detects payment-recording intent and switches the conversation to inline keyboard mode for structured client and package selection (D-08, PAY-01) |
| function_declarations for view_client_membership tool | INTEGRATE | Triggers membership query returning active membership with sessions remaining and expiry date for a named client (PAY-03) |
| streaming | OPT-OUT | Not needed for PoC — synchronous generateContent responses are sufficient; streaming adds complexity without UX benefit in a Telegram chat context |
