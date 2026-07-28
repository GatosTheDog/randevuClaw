# Phase 28: Admin Menu Discoverability - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning

<domain>
## Phase Boundary

The owner's highest-frequency and highest-stakes actions are all reachable from `/menu`, and no dead or decorative buttons remain in the admin UI. Requirements: ADMIN-01 (reply-to-client relay), ADMIN-02 (decorative button cleanup), ADMIN-03 (payment recording from menu), ADMIN-04 (hours/services/prices/class-setup menu entry points).

</domain>

<decisions>
## Implementation Decisions

### Reply-to-client relay (ADMIN-01)

- **D-01 (LOCKED):** Implement a real relay, not removal. The escalation "reply" button currently (Phase 20) only prompts the owner and stops — no forwarding happens. This phase closes that gap for real.
- **D-02 (LOCKED):** Pending-reply state lives in an in-memory `Map`, matching the existing `pendingServicePriceChanges`/`pendingRenewalBatches` pattern from Phase 26 — no schema change, acceptable to lose on process restart (owner just re-taps reply).
- **D-03 (LOCKED):** The pending reply is cancelled by any `/menu` or `/start` tap (implicit abandonment via navigation), not a timer. No explicit timeout needed.
- **D-04 (LOCKED):** After the owner's next free-text message is relayed to the escalating client, send the owner a short Greek confirmation (e.g. "Η απάντηση στάλθηκε.") — matches this codebase's convention of confirming every send/mutation back to the owner.
- **D-05 (LOCKED):** Relay forwards text only — no photo/media forwarding. Keeps scope tight; escalation clarifications rarely need media.
- **Key integration point:** The intercept must sit in `handleFoundBusiness` (`src/webhooks/telegram.ts`) BEFORE the existing unconditional `aiOwnerAgent(business, senderTelegramId, messageText, today)` call (around line 124) — if a pending reply exists for this owner, consume it as the relay payload instead of routing to the AI agent.

### Setup entry-point style (ADMIN-04 + ADMIN-02)

- **D-06 (LOCKED — corrects an initial framing error):** Menu buttons for hours/services/prices/class-creation do NOT require exact command syntax. `src/onboarding/ai-owner-agent.ts` is a Gemini NLU tool-calling agent (Phase 21 decision) that already parses free-form Greek phrasing (multi-field, split-range hours) — the owner can phrase things any way they like. An earlier draft of this decision implied the owner must type one exact command; the user correctly flagged that as annoying/wrong, and the decision below reflects the corrected understanding.
- **D-07 (LOCKED):** Each of the 4 setup buttons (hours, services, prices, class-creation) sends a short Greek message listing **2-3 example natural-language phrases** for that category — not one rigid command, and not a false claim that ANY phrasing works (the examples exist specifically to make the range of what's askable discoverable). The AI agent still handles whatever phrasing the owner actually types.
- **D-08 (LOCKED):** The existing "Νέο μάθημα (chat)" button (ADMIN-02's named example — currently sends one single rigid example phrase) gets upgraded to the same multi-example-phrase style. This closes ADMIN-02's named example and ADMIN-04 with one consistent fix. The phase-27/pre-existing sweep found no other no-op/decorative buttons.
- **D-09 (LOCKED):** All 4 example-phrase buttons live inside the existing Settings submenu (`showSettingsMenu` in `src/telegram/handlers/admin-menu.ts`), not as new root-menu buttons. The Settings menu already displays hours/services/prices config and already contains the literal placeholder text "γράψε στο chat για αλλαγή" for these exact fields — natural home, no new root-level clutter.

### Payment button placement (ADMIN-03)

- **D-10 (LOCKED):** `showClientSelection` (`src/telegram/handlers/payment-flow.ts`) — the full button-driven payment recording flow (client → package → confirm) — already exists and is fully built, currently reachable only via the AI chat agent (`src/onboarding/ai-owner-agent.ts:735`). This phase's ADMIN-03 work is wiring, not building: add a `/menu` callback that calls `showClientSelection(business.id, chatId)` directly.
- **D-11 (LOCKED):** New root-menu button (not nested under Clients submenu) — record-payment is named as the owner's highest-frequency action in REQUIREMENTS.md, warranting top-level visibility.
- **D-12 (LOCKED):** Label text is **"Καταχώρηση Πληρωμής"** (an earlier drafted label had a Greek-phrasing error the user flagged and this corrects). Placed as its own row below the existing 5 root-menu buttons (Ρυθμίσεις/Μαθήματα/Πελάτες/Ατζέντα Σήμερα/settings-row, then this new row), above the existing "Πρόσκληση Πελάτη" invite row.

### Confirmation carry-over

- **D-13 (LOCKED):** None of Phase 28's new menu actions need Phase 26's Ναι/Όχι confirmation pattern before mutating. Record-payment reuses `showClientSelection`'s own existing confirmation step (`handleConfirmMembership`) unchanged; the reply-relay send and the example-phrase prompts are non-destructive/reversible. CONF-01's 5-action scope (delete_service, update_service_price, close_day, cancel_session, assign_client_to_session) was locked in Phase 26 and is not being expanded here.

### Claude's Discretion
- Exact Greek wording of the 2-3 example phrases per setup category (hours/services/prices/class-creation) — beyond "natural, matches existing tone" no specific copy was dictated.
- Exact Greek wording of the reply-relay confirmation message and any decline/cancel-acknowledgment text.
- Internal shape of the pending-reply `Map` (key structure, value fields) — follow the `pendingServicePriceChanges` precedent's shape unless a concrete reason to diverge appears during implementation.
- Whether the relay-pending state needs any logging/observability beyond what other pending-state patterns already have.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` — ADMIN-01 through ADMIN-04 exact requirement text (lines 15-18).
- `.planning/ROADMAP.md` — Phase 28 goal, success criteria, and its declared dependency on Phase 26.

### Prior locked decisions (Phase 26 — still binding)
- `.planning/phases/26-confirmation-approval-policy/26-CONTEXT.md` — D-04/D-05/D-06/D-07: CONF-01's exact 5-action confirmation scope (not expanded here per D-13), contextual button-label convention, `src/utils/greek-messages.ts` constants-file pattern.
- `pendingServicePriceChanges` pattern (Phase 26-02) — the in-process `Map` precedent D-02 reuses for pending-reply state.

### Prior locked decisions (Phase 21 — still binding)
- Owner onboarding/chat agent is a stateless Gemini tool-calling agent parsing free-form Greek (multi-field, split-range hours) — the technical basis for D-06/D-07's corrected understanding.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `showClientSelection` / `showPackageSelection` / `showMembershipConfirmation` / `handleConfirmMembership` (`src/telegram/handlers/payment-flow.ts`) — the complete payment-recording flow already exists; ADMIN-03 is pure wiring (D-10).
- `showAdminRootMenu` (`src/telegram/handlers/admin-menu.ts:47`) — the 2x2+1 root keyboard to extend with the new payment row (D-11/D-12).
- `showSettingsMenu` (`src/telegram/handlers/admin-menu.ts:83`) — already renders hours/services/prices config text with the "γράψε στο chat" placeholder; the natural home for the 4 new example-phrase buttons (D-09).
- `showCancelClassList`/`showCancelClassConfirm` (`src/telegram/handlers/admin-menu.ts`) — closest existing "Νέο μάθημα"-adjacent class-menu code, for context on where a class-creation example-phrase button would sit in `showClassesMenu`.

### Established Patterns
- `MenuCallbackResult` discriminant (`menuAction: string`) in `admin-menu.ts` — new menu actions (payment, setup-example-phrase buttons) should extend `handleMenuCallback`'s switch, following the existing `case menuAction === '...'` style.
- `EscalationCallbackResult` discriminant (`escalationAction: 'approve' | 'reply'`) in `telegram.ts` — the reply-relay logic replaces the current `else` branch (the "reply action: prompt the admin" comment block, `src/webhooks/telegram.ts` ~line 574-583).
- Owner free-text routing: `handleFoundBusiness`'s owner branch calls `aiOwnerAgent(business, senderTelegramId, messageText, today)` unconditionally today (`src/webhooks/telegram.ts:124`) — D-01's intercept must sit before this call.
- `assertCallbackDataSize` (`admin-menu.ts:35`) — 64-byte callback_data guard already applied to every existing menu button; new buttons must call it too.

### Integration Points
- `src/webhooks/telegram.ts` — reply-relay intercept (before `aiOwnerAgent` call) + `EscalationCallbackResult`'s reply branch replacement.
- `src/telegram/handlers/admin-menu.ts` — new root-menu payment button + row; `showSettingsMenu` extended with 4 example-phrase buttons; `handleMenuCallback` switch extended for both.

</code_context>

<specifics>
## Specific Ideas

- Reply-relay confirmation message should be short (matches this codebase's terse Greek confirmation style, e.g. Phase 26's toggle confirmations in `handleSettingsToggle`).
- Example-phrase prompts should show 2-3 phrasings per category, illustrating the RANGE of what's askable (not a single rigid example) — direct response to the user flagging the original single-command framing as annoying.
- Payment button label: **Καταχώρηση Πληρωμής** (corrected from an earlier garbled draft the user flagged).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

### Reviewed Todos (not folded)

- `2026-07-27-research-telegram-persistent-menu-button-reliability.md`, `2026-07-27-fix-same-day-past-time-slots-showing-as-bookable.md` — matched Phase 28 by the keyword tool at low relevance; each already carries its own `resolves_phase` tag pointing to Phase 30 and Phase 29 respectively. Confirmed not relevant here.
- `2026-07-07-pivot-to-per-business-whatsapp-numbers-post-poc.md`, `2026-07-09-meta-business-verification-not-submitted.md` — unrelated planning/external-process todos matched only on generic keywords ("requirements", "phase"). Not relevant.

</deferred>

---

*Phase: 28-admin-menu-discoverability*
*Context gathered: 2026-07-28*
