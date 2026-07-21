# Phase 9 — API Coverage Matrix

Phase 9 adds a 6-hour membership expiry sweep (NOTF-01/02/03) and a client-facing `check_membership_balance` Gemini tool (NOTF-04). All Telegram sends go through the existing `sendTelegramMessage` helper and `botTokenStore.run()` context; all Gemini tool definitions extend the existing BOOKING_TOOLS array in ai-agent.ts. No new API clients are introduced.

---

## Table 1 — Telegram Bot API (expiry-notification surface)

| Capability | Decision | Reason |
|:-----------|:--------:|--------|
| sendMessage to client (clientPhone) | INTEGRATE | Client 7-day expiry notification — Greek message with sessions remaining or unlimited, sent once per membership+expiry+type via UNIQUE dedup (NOTF-01) |
| sendMessage to owner (ownerTelegramId) | INTEGRATE | Owner 7-day expiry alert with client name and expiry date — sent once per membership+expiry+type via UNIQUE dedup (NOTF-02) |
| botTokenStore.run() per-business token context | INTEGRATE | All sweep Telegram sends wrapped in botTokenStore.run() so each business's bot token is active; mirrors expiry-poller.ts pattern (D-06) |
| sendMessage with reply_markup | OPT-OUT | Expiry notifications are plain text only — no buttons or keyboards needed for passive informational alerts |
| answerCallbackQuery | OPT-OUT | No callback buttons in expiry notifications; not applicable to the sweep |
| editMessageReplyMarkup | OPT-OUT | No message editing in the expiry sweep flow |

---

## Table 2 — Google Gemini API (client-agent surface)

|:-----------|:--------:|--------|
| function_declarations for check_membership_balance tool | INTEGRATE | Client-facing tool in BOOKING_TOOLS (ai-agent.ts); handler in function-executor.ts covers three Greek D-08 message scenarios (NOTF-04) |
| generateContent with tools (client agent) | INTEGRATE | Existing ai-agent.ts loop unchanged; check_membership_balance appended to BOOKING_TOOLS array it already uses |
| streaming | OPT-OUT | Not needed for PoC — same rationale as Phase 7; synchronous generateContent is sufficient |
| function_declarations on owner agent | OPT-OUT | check_membership_balance is client-facing only; owner balance queries use view_client_membership (Phase 7, not duplicated here) |
