# Phase 27: Client Consent & Registration - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Every client's first contact with the bot — whether via `/start` or free-form chat — goes through one real, observable, blocking Ναι/Όχι consent+registration step before any menu or AI reply, and `clientBusinessRelationships` gets a genuine opt-in flag (only true once that step is accepted).

Requirements: COMP-01 (consent notice shown before any relationship row is created), COMP-02 (explicit opt-in flag, pre-existing rows backfilled to a safe default).

</domain>

<decisions>
## Implementation Decisions

### Consent + registration prompt (merged, one step)

- **D-01 (LOCKED):** The GDPR consent notice and the "do you want to register" idea (from the folded todo below) are ONE merged Ναι/Όχι step, not two separate prompts. Accepting sets `consentGiven = true` and that same flag IS the registered/opted-in flag — no separate registration question, no second friction prompt.

### Decline handling

- **D-02 (LOCKED):** If the client taps "Όχι", the bot blocks — no booking, no free-chat AI reply, no menu — until they accept. The prompt re-appears on their next message. This is a hard gate, not a soft/skippable one.

### Free-chat parity — becomes a hard gate too

- **D-03 (LOCKED):** Free-chat first contact changes from today's behavior (consent text silently prepended to the AI's first reply, after the row already exists) to the SAME hard Ναι/Όχι button gate as `/start`. The client's actual first message is only answered by the AI after they tap Ναι. This is a real behavior change, not just a copy-paste of the existing soft notice.

### Backfill policy

- **D-04 (LOCKED):** Pre-existing (pre-v1.7) `clientBusinessRelationships` rows are silently grandfathered in — migration backfills them to `consentGiven = true` (or the renamed equivalent). No real client already using the bot gets re-prompted or interrupted. Matches ROADMAP Phase 27 success criteria #4 exactly.

### Claude's Discretion
- Exact Greek wording for the merged consent+registration prompt beyond the existing `CONSENT_NOTICE_GREEK_TEMPLATE` tone (`src/consent/checker.ts:7-8`) — keep it short/direct, matching the project's established Greek copy style.
- Whether the flag is renamed (e.g. `optedIn`/`registered`) or the existing `consentGiven` column is repurposed with default flipped to `false` for new rows — planner's call based on which reads clearer for future code (research recommends repurposing `consentGiven`, see canonical refs).
- Exact callback_data naming for the new client-facing Yes/No keyboard (e.g. `consent:yes`/`consent:no`) — no existing generic YES/NO constant exists yet (Phase 26's `CONFIRM_LABELS` only has DELETE/CONFIRM/APPROVE/REJECT/CANCEL); planner decides whether to add to that file or create a separate one.
- Ordering/wiring detail of where the consent gate check sits relative to the existing unconditional `insertClientBusinessRelationship` upsert call in `telegram.ts` (currently runs on every non-owner message) — must ensure the row's real semantics (opted-in vs not) hold even though a row is created on first contact for FK/tracking purposes.

### Folded Todos

**`2026-07-27-add-client-registration-question-as-first-bot-message.md`** — Original problem: any Telegram user becomes a "client" on first contact with no real opt-in; owner never sees a genuine registered roster. The todo's open questions (wording, skippable-or-mandatory, whether to merge with the existing COMP-01 consent notice) are now resolved: D-01 merges it into the single consent step, D-02 makes it mandatory (blocking), and D-04 covers existing clients. Fully folded — its scope IS this phase's COMP-02 half.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research (v1.7 milestone)
- `.planning/research/ARCHITECTURE.md` §(b) "Registration Flag: Minimal Schema Change" — recommends repurposing `consentGiven` (default flip `true`→`false`, backfill existing rows to `true`); §(c) "Consent Gap Fix" — the exact `handleFoundBusiness` wiring point and behavioral impact analysis. **Note:** §(c)'s proposed code moves the check earlier but describes a NON-blocking pattern (shows prompt, returns, waits) — this discussion's D-02/D-03 extend that to a genuinely hard gate on both paths, consistent with §(c)'s spirit but stricter on decline (§(c) doesn't specify decline handling; D-02 does).
- `.planning/research/PITFALLS.md` Pitfall 3 "GDPR Consent-Notice Timing Race in Multi-Tenant RLS System" — concurrent-thread race on the consent upsert; **already mitigated** in current code via `insertClientBusinessRelationship`'s `onConflictDoUpdate` atomic upsert (see code_context below) — planner should confirm this still holds once the gate logic is added, not re-derive a new locking strategy.
- `.planning/REQUIREMENTS.md` — COMP-01, COMP-02 exact requirement text.
- `.planning/ROADMAP.md` — Phase 27 goal and 4 success criteria.

### Prior locked decisions (Phase 26, v1.7 — pattern to reuse)
- `src/utils/greek-messages.ts` — `CONFIRM_LABELS` constants-file pattern (D-07, Phase 26): button-label strings only, no shared confirmation-keyboard helper, callback_data conventions stay independent per file. Extend this pattern for the new client-facing consent Yes/No labels rather than inventing a new convention.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/database/schema.ts:93-114` — `clientBusinessRelationships` table already has `consentGiven: boolean('consent_given').notNull().default(true)` (comment: "Implied consent (D-10)") and `consentTimestamp`. No new column needed per D-01/research — repurpose this one (flip default, change semantics).
- `src/consent/checker.ts` — `getOrCreateClientRelationship()` and `CONSENT_NOTICE_GREEK_TEMPLATE` already exist; `tests/consent.test.ts` has existing coverage to extend, not replace.
- `src/database/queries.ts:207-229` — `insertClientBusinessRelationship` already uses `.onConflictDoUpdate({ target: [businessId, senderPhone], set: {...} })` — the atomic upsert pattern that neutralizes PITFALLS.md Pitfall 3's race concern. Reuse verbatim; do not write a new check-then-insert path.
- `src/telegram/client.ts:88` — `sendTelegramMessageWithKeyboard` is the generic keyboard-send function already used for every other inline-keyboard flow in the codebase (owner and client menus alike) — reuse for the new consent Yes/No keyboard.
- `src/utils/greek-messages.ts` — `CONFIRM_LABELS` (Phase 26) has DELETE/CONFIRM/APPROVE/REJECT/CANCEL but no generic YES/NO — will need one or two new entries.

### Established Patterns
- Callback-data-per-file convention (Phase 26 D-07, no global helper): `menu:<action>`, `cmenu:<action>`, `sbk:approve/reject:<id>`, `otc:<action>:<id>:<yes|no>`. A new `consent:yes` / `consent:no` (or similar namespaced) pattern fits this convention.
- `showCancelClassConfirm` (`src/telegram/handlers/admin-menu.ts`) is the closest existing Ναι/Όχι confirmation example, though owner-facing — no client-facing Yes/No flow exists yet; this phase introduces the first one.

### Integration Points
- `src/webhooks/telegram.ts:137-147` — the `/start` branch calls `showClientRootMenu` directly with **zero** consent check today. This is where the new hard gate must intercept, before the menu is shown.
- `src/webhooks/telegram.ts:149-154` — the free-chat branch (`routeConversationMessage`) is where the soft/after-the-fact notice currently lives (`src/conversation/router.ts:26,77-78`). Must become a hard gate here too per D-03, intercepting before the AI agent call, not after.
- `src/webhooks/telegram.ts:1178-1186` (approx, per scout) — `insertClientBusinessRelationship` is called unconditionally for every non-owner message today (upserts `clientName`). Planner must decide how the row-creation-for-tracking-purposes coexists with the gate not yet being "accepted" — the row can exist with `consentGiven=false`; the gate blocks on that flag, not on row-existence.
- New callback route needed in `parseCallbackData` / `handleCallbackQuery` for `consent:yes` / `consent:no`.
- New migration `migrations/0013_*.sql` (latest existing is `0012_renewal_nudge_notifications.sql`) for the backfill (D-04) and any column/default changes.

</code_context>

<specifics>
## Specific Ideas

No exact wording specified beyond keeping the tone of the existing `CONSENT_NOTICE_GREEK_TEMPLATE` (`src/consent/checker.ts:7-8`) — short, direct, matches established Greek copy style elsewhere in the bot.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

### Reviewed Todos (not folded)

- `2026-07-07-pivot-to-per-business-whatsapp-numbers-post-poc.md`, `2026-07-09-meta-business-verification-not-submitted.md`, `2026-07-27-fix-same-day-past-time-slots-showing-as-bookable.md`, `2026-07-27-research-telegram-persistent-menu-button-reliability.md` — matched Phase 27 by the keyword tool with low relevance (score 0.6, generic keyword overlap only). Each belongs elsewhere: WhatsApp pivot and Meta BV are unrelated planning/infra items, same-day slots feeds Phase 29 (UX-01), menu button reliability feeds Phase 30 (ADMIN-05). Confirmed not relevant here, no action needed.

</deferred>

---

*Phase: 27-client-consent-registration*
*Context gathered: 2026-07-28*
