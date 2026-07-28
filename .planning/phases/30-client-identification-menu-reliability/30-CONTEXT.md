# Phase 30: Client Identification & Menu Reliability - Context

**Gathered:** 2026-07-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Owners can find clients by name instead of copying raw Telegram IDs, and the persistent Telegram menu button behaves reliably — or its limitations are documented — across clients. Requirements: UX-03 (name-based client match with disambiguation), ADMIN-05 (menu button reliability investigation + fix/document).

</domain>

<decisions>
## Implementation Decisions

### Raw-ID tool scope (UX-03)

- **D-01 (LOCKED):** All 4 client-identifying-by-raw-ID tools in `src/onboarding/ai-owner-agent.ts` get converted, not just the 3 named in ROADMAP.md: `view_client_membership` (schema 245-259, executor 739-745), `assign_client_to_session` (schema 362-383, executor 849-881), `send_renewal_reminder` (schema 412-423, executor 900-911), and the roadmap-unnamed **`list_slotless_requests`** (schema 384-398, executor 883-892) — found during research to have the identical `client_phone`-as-raw-Telegram-ID shape and problem. All 4 share one name-resolution helper, so covering the 4th is near-zero marginal cost.
- **Explicitly out of scope:** `src/telegram/escalation.ts`'s `clientTelegramId` param — not an LLM-facing tool parameter, derived internally from the HMAC-verified webhook sender ID, never typed by the owner. `record_payment` already sidesteps raw-ID input entirely via `showClientSelection`'s button picker (a different, already-solved UX pattern) — not touched by this phase.

### Name-match fallback (UX-03)

- **D-02 (LOCKED):** Name-only — raw Telegram ID/phone input is removed from these 4 tools' parameters in favor of a name param. This is a deliberate choice against the safer "accept both" alternative (which was recommended and explicitly declined): a client who has never messaged the bot yet (no `clientName` on file — see D-04 below on why this happens) becomes unreachable by these 4 tools until they send at least one message.
- **D-03 (LOCKED):** Zero-match case (name doesn't match any client — either a typo or a real client with no name on file) gets a generic "no client found" response, same shape regardless of *why* it didn't match. No special-cased hint about the first-message gate — keeps the fix mechanical, consistent with this codebase's existing terse error style.

### Disambiguation mechanics (UX-03)

- **D-04 (LOCKED):** Text-based, not a new stateful inline-keyboard flow. When a name substring-matches 2+ clients, the tool returns the match list as plain text (names only — see D-05) in the tool result; the already-stateless Gemini agent (Phase 21 architecture decision — no pending multi-step state machine) narrates the ambiguity in Greek and asks the owner to be more specific; the owner's next free-text reply triggers Gemini to re-call the same tool with a narrower name. This reuses zero new state — no new callback_data namespace, no "resume this tool call after a button tap" mechanism (which does not exist anywhere in this codebase today and would be new architecture).
- **D-05 (LOCKED):** The disambiguation text shows client **names only** — never the raw Telegram ID/phone. The ID/phone stays purely internal (DB lookup + the eventual exact resolution once the owner's follow-up narrows the match to exactly one client). May include other name-adjacent context (e.g. last-booking-date) for tie-breaking between same-named clients, at Claude's discretion.
- **Context clients CAN collide by design:** `clientName` is populated from Telegram's `from.first_name` only (never `last_name`), upserted on every client message (`src/webhooks/telegram.ts:1339-1353`). Two clients both named "Γιώργος" is expected, not an edge case — D-04's re-ask flow is the primary mechanism for resolving this, not a rare fallback.

### Menu-button resilience (ADMIN-05)

- **D-06 (LOCKED):** Add defensive resilience now, independent of whatever the deep Telegram-platform research (client-side caching/scope semantics — the genuinely research-heavy part of this phase) finds:
  1. **Retry on failure** — the 4 `setMyCommands`/`setChatMenuButton` calls inside `finish_onboarding` (`src/onboarding/ai-onboarding-agent.ts:600-616`) currently share one try/catch that silently swallows any failure with just a `logger.error`. Add retry (a small number of attempts, exponential-ish backoff or similar — exact shape is Claude's discretion) instead of a single silent attempt.
  2. **Re-assert on next `/menu` tap** — these Bot API calls are idempotent (safe to repeat with the same arguments), so re-running them whenever the owner taps `/menu` is a cheap, safe hedge against the "one-shot call fired once in the business's entire lifetime, never repeated" gap found during research — this call currently only ever fires once, at `finish_onboarding` time, and `finish_onboarding` itself can structurally never run twice for the same business (`webhooks/telegram.ts:82`'s `onboardingCompleted` gate routes every subsequent owner message away from the onboarding agent, permanently).
- **Research still owns the deeper question:** whether Telegram's *client-side* menu-button cache reliably refreshes without any app-side action at all (e.g. does it need the chat reopened, per-client-version differences, whether `BotCommandScopeChat` vs default scope differs) is exactly what the phase-researcher investigates next — D-06 closes the known "no retry, no re-assertion" code gap regardless of that research's outcome, it does not preempt or substitute for it.

### Claude's Discretion
- Exact retry count/backoff shape for D-06.1.
- Exact wiring point for D-06.2's re-assertion (e.g. inside the existing `/menu` text-command branch vs. the `menu:root` callback branch, or both) — should not block/delay the `/menu` response noticeably; best-effort, same swallow-on-failure-after-retry posture as the original call.
- Whether disambiguation context (D-05) includes last-booking-date or stays name-only when two names are identical.
- Exact Greek wording for the disambiguation re-ask and the generic no-match message.
- Whether to consolidate the `assertCallbackDataSize` helper (found duplicated across 3 files: `admin-menu.ts:37`, `client-menu.ts:52`, `escalation.ts:33`) — unrelated to this phase's actual scope, not required, may be touched opportunistically only if genuinely free (Claude's call, not a locked requirement).

### Folded Todos

**`2026-07-27-research-telegram-persistent-menu-button-reliability.md`** — Already tagged `resolves_phase: 30`. Its exact open questions (does `setChatMenuButton` need periodic re-setting; does `all_private_chats` scope reach new client chats immediately; per-chat vs default scope reliability differences; alternative mechanisms) are the deep-research half of ADMIN-05 that D-06 explicitly does not preempt. Fully folded — its scope IS ADMIN-05's research component.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` — UX-03, ADMIN-05 exact requirement text (lines 19, 25); the "Out of Scope" table's explicit rejection of fuse.js/fuzzy-matching for UX-03 (line 54) — case-insensitive substring match is the locked approach, not open for reconsideration.
- `.planning/ROADMAP.md` — Phase 30 goal, 3 success criteria; explicitly the last phase in v1.7, sequenced last "as the most research-heavy phase, per research recommendation."

### Folded todo (technical diagnosis)
- `.planning/todos/pending/2026-07-27-research-telegram-persistent-menu-button-reliability.md` — the exact open questions D-06's research half must answer.

### Prior locked decisions (Phase 21 — still binding)
- Owner agent is a stateless Gemini tool-calling agent, no pending multi-step state machine — the architectural basis for D-04's text-based (not stateful-keyboard) disambiguation choice.

### Prior locked decisions (Phase 24, v1.6 — the code this phase investigates)
- `.planning/milestones/v1.6-phases/24-bot-access-diagnostics-polish/24-RESEARCH.md` — original decision to fire `setChatMenuButton`/`setMyCommands` during onboarding "for simplicity"; considered client-vs-owner scope timing but never addressed re-registration/caching reliability (confirmed gap, per this phase's research pass).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `list.find(x => x.name.toLowerCase().includes(needle.toLowerCase()))` (`src/onboarding/ai-owner-agent.ts:621,644,723,775`) — the exact case-insensitive substring-match predicate to reuse for client-name matching (per REQUIREMENTS.md's locked "no fuse.js" decision). Note: this existing usage has zero multi-match detection (`.find()` silently takes the first hit) — UX-03's disambiguation is new logic on top of the reused predicate, not a reused disambiguation flow.
- `getAllClientsForBusiness(businessId)` (`src/billing/queries.ts:283-297`) — returns all `{clientBusinessRelationshipId, clientName, senderPhone}` for a business; the base to filter-by-name from in TS (no existing SQL-level `ILIKE`/by-name query exists anywhere in the codebase).
- `setChatMenuButton`/`setMyCommands` (`src/telegram/client.ts:275-295`) — idempotent Bot API wrappers already exist; D-06's fix is call-site/retry logic, not new API-wrapper code.

### Established Patterns
- `client_phone` is *always* a stringified Telegram numeric ID in this codebase's convention, never an actual phone number (schema comment `src/database/schema.ts:168-171`; re-stated `ai-owner-agent.ts:1105-1107`) — the 4 tools' current misleading "Τηλέφωνο ή Telegram ID" description text should be corrected to a name-only description once D-02 lands.
- `showClientSelection` (`payment-flow.ts:47-110`) / `showClientsList` (`admin-menu.ts:415-447`) — existing always-full-roster client-picker keyboards; explicitly NOT the pattern D-04 follows (those are unfiltered button pickers, D-04 is filtered text-based re-ask) but useful prior art for Greek copy tone if disambiguation text needs it.

### Integration Points
- `src/onboarding/ai-owner-agent.ts` — all 4 tool schemas (drop `client_phone` param, add name param) + all 4 executor cases (replace exact-match query with filter-by-name + branch on match count) + the misleading tool-description Greek text.
- `src/onboarding/ai-onboarding-agent.ts:600-616` (`finish_onboarding`) — add retry to the existing shared try/catch (D-06.1).
- Wherever the owner's `/menu` text command and `menu:root` callback are currently handled (`src/webhooks/telegram.ts` and/or `src/telegram/handlers/admin-menu.ts`) — add the re-assertion call (D-06.2), exact site is Claude's discretion.

</code_context>

<specifics>
## Specific Ideas

No exact copy specified beyond keeping the existing terse Greek error/confirmation style — see Claude's Discretion above for the specific wording gaps left open.

</specifics>

<deferred>
## Deferred Ideas

- Consolidating the `assertCallbackDataSize` helper duplicated across 3 files (`admin-menu.ts`, `client-menu.ts`, `escalation.ts`) — found during research, unrelated to this phase's actual UX-03/ADMIN-05 scope. Not folded in; may be touched opportunistically only if genuinely free.

### Reviewed Todos (not folded)

- `2026-07-07-pivot-to-per-business-whatsapp-numbers-post-poc.md`, `2026-07-09-meta-business-verification-not-submitted.md` — unrelated planning/infra items, matched only on generic keywords ("business", "phase", "foundation", "webhook"). Not relevant.

</deferred>

---

*Phase: 30-client-identification-menu-reliability*
*Context gathered: 2026-07-29*
