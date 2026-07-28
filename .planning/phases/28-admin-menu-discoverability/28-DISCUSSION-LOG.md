# Phase 28: Admin Menu Discoverability - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-28
**Phase:** 28-admin-menu-discoverability
**Areas discussed:** Reply-to-client relay (ADMIN-01), Setup entry-point style (ADMIN-04+02), Payment button placement (ADMIN-03), Confirmation carry-over

---

## Reply-to-client relay (ADMIN-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Implement real relay | Wire a pending-reply state so the admin's next message is forwarded to the client | ✓ |
| Remove the button | Drop the 'reply' option, keep only 'approve' | |

**User's choice:** Implement real relay.

Follow-up questions and answers:
- **Pending-reply state storage:** In-memory Map (matches Phase 26's `pendingServicePriceChanges`/`pendingRenewalBatches` precedent) — chosen over DB-backed (deemed overkill for rare, short-lived, single-owner state).
- **Cancellation:** Any `/menu` or `/start` tap (implicit navigation-away abandonment) — chosen over explicit timeout, or both.
- **Post-relay confirmation:** Send owner a short confirmation message — chosen over silent success.
- **Content scope:** Text only — chosen over text + photos.

**Notes:** No pushback from user on any of these follow-ups; all recommended options accepted.

---

## Setup entry-point style (ADMIN-04 + ADMIN-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Contextual chat-prompt buttons | Menu button sends a Greek prompt with one example command | (initial framing, revised) |
| Guided button/keyboard flows | Step-by-step inline-keyboard flows like the payment flow | |

**User's choice:** Initially presented as "contextual chat-prompt buttons" with a single rigid example (e.g. "write: 'set Monday hours 9-17'"). **User pushed back**: "that's annoying when he types \\ it should reveal all the commands maybe? or what else do you suggest?" — correctly flagging that requiring one exact typed phrase is bad UX, and that the underlying agent (`ai-owner-agent.ts`) is actually a free-form Gemini NLU agent (Phase 21 decision), not a rigid command parser.

**Revised proposal:** Each button shows 2-3 example natural-language phrases per category (not one fixed command); the AI agent still parses any phrasing. User confirmed this refined version.

Follow-up questions and answers:
- **Upgrade "Νέο μάθημα (chat)" to the same style?** Yes — closes ADMIN-02's named example with the same fix.
- **Menu placement:** Inside existing Settings submenu — chosen over a new root-menu button, since Settings already shows the relevant config and already has a "γράψε στο chat" placeholder for these exact fields.

**Notes:** This was the one area where the initial framing needed correction based on user feedback — captured in full in CONTEXT.md D-06 to make the correction traceable for downstream agents.

---

## Payment button placement (ADMIN-03)

| Option | Description | Selected |
|--------|-------------|----------|
| New root-menu button | Top-level visibility for the highest-frequency owner action | ✓ |
| Under Clients submenu | Groups with existing client actions, keeps root menu at 5 buttons | |

**User's choice:** New root-menu button.

Follow-up:
- **Label/position:** Claude's first draft label was garbled/typo'd Greek. User flagged it directly: "own row but greek translation is shit, fix it." Corrected to **"Καταχώρηση Πληρωμής"** (standard Greek business term for "Record Payment"), placed as its own row below the existing 5 buttons, above the invite row. User confirmed the corrected label.

**Notes:** Confirms `showClientSelection` (payment-flow.ts) is fully built already and only needs a `/menu` wiring — no new flow logic required.

---

## Confirmation carry-over

| Option | Description | Selected |
|--------|-------------|----------|
| None needed | Existing confirmation (payment) or non-destructive nature (relay, prompts) already covers it | ✓ |
| Add confirmation to reply-relay send | Extra review-before-send step even though outside CONF-01's locked scope | |

**User's choice:** None needed.

**Notes:** Confirms Phase 26's CONF-01 5-action confirmation scope stays locked/unexpanded — none of Phase 28's new actions are being added to that list.

---

## Claude's Discretion

- Exact Greek wording of the 2-3 example phrases per setup category.
- Exact Greek wording of the reply-relay confirmation/decline text.
- Internal shape of the pending-reply `Map` (key/value structure) — follow the `pendingServicePriceChanges` precedent unless a concrete reason to diverge appears.
- Observability/logging for the new pending-reply state, beyond existing pending-state precedent.

## Deferred Ideas

None — discussion stayed within phase scope. All 4 reviewed-but-not-folded todos already carry `resolves_phase` tags pointing elsewhere (Phase 29, 30, or unrelated planning/external-process items).
