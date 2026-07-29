---
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/telegram/handlers/client-menu.ts
  - src/consent/checker.ts
  - src/webhooks/telegram.ts
  - src/conversation/router.ts
  - tests/consent.test.ts
  - tests/conversation-router.test.ts
  - tests/webhooks/client-menu.test.ts
  - .planning/todos/pending/2026-07-29-show-admin-policies-to-new-clients-on-first-contact.md
  - .planning/todos/done/2026-07-29-show-admin-policies-to-new-clients-on-first-contact.md
autonomous: true
requirements: []

must_haves:
  truths:
    - "The client root menu message text visibly enumerates all four options in Greek (booking-mode-aware label, my bookings, cancel booking, session balance) as a numbered list before the client ever taps a button — button behavior/callback_data is unchanged."
    - "A new client's very first message (the merged consent+registration prompt) includes a concise Greek summary of whichever optional business policy flags are actually turned on for that business — cancellation cutoff, slotless booking requests, fixed-session booking mode, and membership-required enforcement."
    - "A business where every optional policy flag is at its default value (open_slots, no cutoff, no slotless requests, allow enforcement) produces zero extra policy text in the first-contact message — no wall of text for a plain-vanilla business."
    - "The consent gate's Ναι/Όχι keyboard and accept/decline routing behavior are unchanged — only the message text grew to include the policy summary."
  artifacts:
    - "src/telegram/handlers/client-menu.ts: showClientRootMenu's message text lists all 4 button labels as a numbered list, sourced from the same label constants/variables used to build the keyboard."
    - "src/consent/checker.ts: new exported buildPolicySummaryGreek(business: Business): string function; CONSENT_PROMPT_GREEK_TEMPLATE now takes a Business object (not just businessName) and appends the summary before the final consent question."
    - "tests/consent.test.ts: new unit tests covering buildPolicySummaryGreek's empty-string default case and each individual policy-flag case."
    - ".planning/todos/done/2026-07-29-show-admin-policies-to-new-clients-on-first-contact.md: todo moved out of pending/ once implemented."
  key_links:
    - "showClientRootMenu -> sendTelegramMessageWithKeyboard(chatId, menuText, keyboard) — menuText now includes all 4 option labels in addition to the keyboard."
    - "getOrCreateClientRelationship consentGiven=false -> CONSENT_PROMPT_GREEK_TEMPLATE(business) -> buildPolicySummaryGreek(business) appended between the consent notice and the Συμφωνείτε; question, in both src/webhooks/telegram.ts and src/conversation/router.ts call sites."
---

<objective>
Two independent, small Telegram-bot UX fixes for RandevuClaw (Greek-language client booking bot):

1. `showClientRootMenu` (src/telegram/handlers/client-menu.ts) currently sends a generic "Τι θέλεις να κάνεις;" greeting alongside a 4-button inline keyboard. The greeting text itself does not describe the options — enumerate all four option labels as text in the same message so the menu is self-descriptive even before a button is tapped.

2. New clients get a consent notice (`CONSENT_NOTICE_GREEK_TEMPLATE`, Phase 27) on first contact with no mention of the business's actual booking policies (cancellation cutoff, slotless requests, fixed-session mode, membership-required enforcement). Per `.planning/todos/pending/2026-07-29-show-admin-policies-to-new-clients-on-first-contact.md`, extend the first-contact message itself (not a follow-up) with a dynamically-built, per-business policy summary that skips any policy left at its default/off value.

Purpose: Reduce client confusion — the root menu becomes readable without tapping, and new clients learn the business's actual rules before they hit them mid-flow (e.g. a surprise cancellation cutoff).

Output: Both messages enriched with no behavior change to keyboards/callbacks; the source todo moved to done/.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
Both changes are pure message-text composition; no schema, DB, or API changes.

**Task 1 context** — `src/telegram/handlers/client-menu.ts` `showClientRootMenu` (lines 65-95) builds a 2x2 `InlineKeyboard` with these exact labels: `bookingButtonText` (`'Κράτηση μαθήματος'` when `business.bookingMode === 'fixed_sessions'`, else `'Κράτηση ραντεβού'`), `'Οι κρατήσεις μου'`, `'Ακύρωση κράτησης'`, `'Υπόλοιπο μαθημάτων'`. It then calls `sendTelegramMessageWithKeyboard(chatId, 'Καλώς ήρθες! Τι θέλεις να κάνεις;', keyboard)`. Two existing tests (`tests/webhooks/client-menu.test.ts` "showClientRootMenu: booking button label reflects bookingMode (D-03)", lines 410-442) assert on the keyboard structure with `expect.any(String)` for the text param — content changes are safe there. No test in the repo asserts the literal greeting string.

**Task 2 context** — the full current `Business` interface (`src/database/queries.ts` lines 42-72) has these optional policy-shaped flags beyond the todo's illustrative list, with their DB defaults (`src/database/schema.ts`):
- `bookingMode: string` — `'open_slots'` (default) | `'fixed_sessions'`.
- `cancellationCutoffEnabled: boolean` (default `false`) + `cancellationCutoffHours: number` (default `8`) — Phase 12.
- `slotlessRequestsEnabled: boolean` (default `false`) — Phase 13.
- `enforcementPolicy: string` — `'allow'` (default) | `'block'` | `'flag'` — Phase 8. `checkEnforcementAndGetMembership` (src/billing/enforcement.ts) shows `'block'` refuses booking without an active membership while `'flag'` still allows the booking (only alerts the owner) — `'flag'` is transparent to the client and should NOT be surfaced, only `'block'` materially changes what the client can do.
- `allowMultiBooking: boolean` and `lastSessionThresholdEnabled/lastSessionThresholdCount` also exist but are NOT client-facing booking constraints (multi-booking is a permissive capability with no restriction to warn about; the renewal-nudge threshold is a proactive notification the client will see later, not a rule they need upfront) — deliberately excluded from the summary to keep it a wall-of-text-free, genuinely-restrictive-policy list only.

`src/consent/checker.ts` currently exports `CONSENT_NOTICE_GREEK_TEMPLATE(businessName: string)` and `CONSENT_PROMPT_GREEK_TEMPLATE(businessName: string)` (the latter = notice + `\nΣυμφωνείτε να συνεχίσουμε;`). `CONSENT_PROMPT_GREEK_TEMPLATE` has exactly two call sites, both of which already have the full `business: Business` object in scope, not just the name:
- `src/webhooks/telegram.ts` line 226: `CONSENT_PROMPT_GREEK_TEMPLATE(business.name)` inside the `/start` handler's consent-gate branch.
- `src/conversation/router.ts` line 45: `CONSENT_PROMPT_GREEK_TEMPLATE(business.name)` inside `routeConversationMessage`'s hard consent gate.

Both call sites must change to pass `business` (the object) once the signature changes. Two existing tests assert on `CONSENT_PROMPT_GREEK_TEMPLATE(...)`'s exact return value using the REAL (non-mocked) function via `jest.requireActual`/partial-mock, so both recompute identically once updated to pass the object instead of `.name`:
- `tests/conversation-router.test.ts` line 122: `CONSENT_PROMPT_GREEK_TEMPLATE(BUSINESS.name)`.
- `tests/webhooks/client-menu.test.ts` line 1469: `CONSENT_PROMPT_GREEK_TEMPLATE(BASE_BUSINESS.name)`. Note `BASE_BUSINESS` in this file already has `enforcementPolicy: 'block'` and `bookingMode: 'fixed_sessions'` (non-default) — once wired up, this test's own expected value will legitimately include those two policy lines because it recomputes through the same real function.

@src/telegram/handlers/client-menu.ts
@src/consent/checker.ts
@src/webhooks/telegram.ts
@src/conversation/router.ts
@tests/consent.test.ts
@.planning/todos/pending/2026-07-29-show-admin-policies-to-new-clients-on-first-contact.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Enumerate all four root-menu options in the greeting text</name>
  <files>src/telegram/handlers/client-menu.ts</files>
  <action>
In `showClientRootMenu` (src/telegram/handlers/client-menu.ts), replace the single literal greeting string `Καλώς ήρθες! Τι θέλεις να κάνεις;` passed to `sendTelegramMessageWithKeyboard` with a multi-line `menuText` local variable built from a template literal: keep the existing greeting line, then a blank line, then a numbered list of the same four option labels already used to build `keyboard` — reuse the `bookingButtonText` variable (do not hardcode a booking label) for item 1, followed by `Οι κρατήσεις μου`, `Ακύρωση κράτησης`, and `Υπόλοιπο μαθημάτων` for items 2-4, in that exact order (matching the keyboard's row-major reading order: row 1 = book/bookings, row 2 = cancel/balance). Pass `menuText` as the second argument to `sendTelegramMessageWithKeyboard`. Do not change `keyboard`, any `callback_data` value, or `assertCallbackDataSize` calls — this is a text-only change.
  </action>
  <verify>
    <automated>test "$(grep -c 'Οι κρατήσεις μου' src/telegram/handlers/client-menu.ts)" -ge 2 && npx jest --testPathPattern=tests/webhooks/client-menu.test.ts</automated>
  </verify>
  <done>showClientRootMenu sends one message whose text lists all 4 option labels (booking-mode-aware label + the other 3) as a numbered list, in addition to the unchanged 2x2 inline keyboard; tests/webhooks/client-menu.test.ts passes with no assertion changes needed.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Build and wire a per-business policy summary into the first-contact consent message</name>
  <files>src/consent/checker.ts, src/webhooks/telegram.ts, src/conversation/router.ts, tests/consent.test.ts, tests/conversation-router.test.ts, tests/webhooks/client-menu.test.ts</files>
  <behavior>
    - buildPolicySummaryGreek(business) returns '' (empty string) when bookingMode='open_slots', cancellationCutoffEnabled=false, slotlessRequestsEnabled=false, enforcementPolicy='allow' (all defaults).
    - buildPolicySummaryGreek(business) returns a non-empty string containing the cutoff hours value when cancellationCutoffEnabled=true and cancellationCutoffHours=6.
    - buildPolicySummaryGreek(business) returns a non-empty string mentioning slotless/request-based booking when slotlessRequestsEnabled=true.
    - buildPolicySummaryGreek(business) returns a non-empty string mentioning membership/subscription is required when enforcementPolicy='block'.
    - buildPolicySummaryGreek(business) returns a non-empty string mentioning scheduled/fixed sessions when bookingMode='fixed_sessions'.
    - buildPolicySummaryGreek(business) does NOT mention any policy when enforcementPolicy='flag' alone (with all other flags default) — 'flag' is transparent to the client and must not appear.
    - CONSENT_PROMPT_GREEK_TEMPLATE(business) returns CONSENT_NOTICE_GREEK_TEMPLATE(business.name) + buildPolicySummaryGreek(business) + the existing "Συμφωνείτε να συνεχίσουμε;" question, in that order.
  </behavior>
  <action>
In `src/consent/checker.ts`: add `Business` to the existing named import from `../database/queries`. Add a new exported function `buildPolicySummaryGreek(business: Business): string` that builds a `string[]` of Greek one-line policy descriptions, pushing a line only when the corresponding flag is non-default: (1) when `business.bookingMode === 'fixed_sessions'`, a line stating bookings happen via a fixed class schedule with set times; (2) when `business.cancellationCutoffEnabled` is true, a line stating cancellation is not allowed within `business.cancellationCutoffHours` hours of the appointment/session (interpolate the actual number); (3) when `business.slotlessRequestsEnabled` is true, a line stating that when no slot is immediately open, the client can send a booking request for the business's approval; (4) when `business.enforcementPolicy === 'block'`, a line stating an active membership/session package is required to book. Do NOT add a line for `enforcementPolicy === 'flag'`, `allowMultiBooking`, or `lastSessionThresholdEnabled` — none of these are client-facing restrictions worth surfacing here (documented rationale: 'flag' is invisible to the client, multi-booking is permissive not restrictive, and the renewal nudge is a later proactive notification, not an upfront rule). If the array is empty, return `''`. Otherwise return a string starting with `\n\n` plus a short Greek header line (e.g. "Ισχύουσες πολιτικές:") followed by each collected line prefixed with a bullet character, newline-joined. Then change `CONSENT_PROMPT_GREEK_TEMPLATE` from `(businessName: string): string => ...` to `(business: Business): string => \`${CONSENT_NOTICE_GREEK_TEMPLATE(business.name)}${buildPolicySummaryGreek(business)}\nΣυμφωνείτε να συνεχίσουμε;\`` — i.e. the policy summary is inserted between the existing notice and the existing yes/no question, appended onto the same first message (not a follow-up send). Leave `CONSENT_NOTICE_GREEK_TEMPLATE` itself untouched (it still takes `businessName: string`).

In `src/webhooks/telegram.ts` (around line 226, inside the `/start` consent-gate branch) and `src/conversation/router.ts` (around line 45, inside `routeConversationMessage`'s hard consent gate): change the call from `CONSENT_PROMPT_GREEK_TEMPLATE(business.name)` to `CONSENT_PROMPT_GREEK_TEMPLATE(business)` in both files — `business` (the full object) is already in scope at both call sites, no new parameter threading needed.

Update the two existing tests whose assertions call `CONSENT_PROMPT_GREEK_TEMPLATE` with `.name` so they keep compiling and recompute against the same real function: in `tests/conversation-router.test.ts` line ~122, change `CONSENT_PROMPT_GREEK_TEMPLATE(BUSINESS.name)` to `CONSENT_PROMPT_GREEK_TEMPLATE(BUSINESS)`; in `tests/webhooks/client-menu.test.ts` line ~1469, change `CONSENT_PROMPT_GREEK_TEMPLATE(BASE_BUSINESS.name)` to `CONSENT_PROMPT_GREEK_TEMPLATE(BASE_BUSINESS)`. Do not change any other assertions in either file — both tests already import the real (non-mocked) `CONSENT_PROMPT_GREEK_TEMPLATE`/`CONSENT_NOTICE_GREEK_TEMPLATE` via their existing partial-mock/`jest.requireActual` setup, so passing the object instead of the string produces a matching, self-consistent expected value on both sides.

In `tests/consent.test.ts`, add a new `describe('buildPolicySummaryGreek unit tests', ...)` block (import `Business` from `../src/database/queries` for a helper business-fixture builder with all-default flags, matching the shape already used elsewhere in this repo, e.g. `tests/conversation-router.test.ts`'s `BUSINESS` constant) with one test per behavior line above: default-flags-returns-empty-string, cutoff-enabled-mentions-hours, slotless-enabled-mentions-request, enforcement-block-mentions-membership, fixed-sessions-mentions-schedule, and flag-alone-produces-no-policy-text.
  </action>
  <verify>
    <automated>npx tsc --noEmit && npx jest --testPathPattern=tests/consent.test.ts && npx jest --testPathPattern=tests/conversation-router.test.ts && npx jest --testPathPattern=tests/webhooks/client-menu.test.ts</automated>
  </verify>
  <done>buildPolicySummaryGreek is exported from src/consent/checker.ts with the described behavior and full unit test coverage in tests/consent.test.ts; CONSENT_PROMPT_GREEK_TEMPLATE now takes a Business object and both real call sites (webhooks/telegram.ts, conversation/router.ts) pass business instead of business.name; all three affected test files pass; npx tsc --noEmit reports zero new errors.</done>
</task>

<task type="auto">
  <name>Task 3: Move the source todo to done/</name>
  <files>.planning/todos/pending/2026-07-29-show-admin-policies-to-new-clients-on-first-contact.md, .planning/todos/done/2026-07-29-show-admin-policies-to-new-clients-on-first-contact.md</files>
  <action>
Create `.planning/todos/done/` if it does not already exist, then move (not copy) `.planning/todos/pending/2026-07-29-show-admin-policies-to-new-clients-on-first-contact.md` to `.planning/todos/done/2026-07-29-show-admin-policies-to-new-clients-on-first-contact.md` unchanged (no content edits) — this todo is now implemented by Task 2 above.
  </action>
  <verify>
    <automated>test -f .planning/todos/done/2026-07-29-show-admin-policies-to-new-clients-on-first-contact.md && test ! -f .planning/todos/pending/2026-07-29-show-admin-policies-to-new-clients-on-first-contact.md</automated>
  </verify>
  <done>The todo file exists only at .planning/todos/done/2026-07-29-show-admin-policies-to-new-clients-on-first-contact.md and no longer at its old pending/ path.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Owner-configured business policy flags (DB, trusted) -> client-facing Telegram message (outbound text) | No new untrusted input crosses a boundary here — `buildPolicySummaryGreek` only reads already-trusted `Business` row columns the owner configured via existing admin flows, and composes outbound text. There is no new inbound parsing or user-controlled interpolation. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-quick-01 | Information Disclosure | buildPolicySummaryGreek(business) in src/consent/checker.ts | low | accept | Telling the client which booking rules apply to them (cutoff hours, membership requirement, etc.) is the explicit intent of this task — these are rules the client will be subject to regardless, and disclosing them upfront is strictly more transparent than the current silent behavior, not a new exposure of sensitive data. |
| T-quick-02 | Tampering | CONSENT_PROMPT_GREEK_TEMPLATE signature change (businessName: string -> business: Business) | low | accept | Both real call sites (src/webhooks/telegram.ts, src/conversation/router.ts) already source `business` from the webhook/HMAC-authenticated, DB-resolved `Business` row before this change — no new trust boundary is introduced by passing the whole object instead of one of its fields. |
</threat_model>

<verification>
Task 1's grep+existing-suite check confirms the root menu text now lists all 4 option labels without touching keyboard/callback structure. Task 2's automated chain (tsc + 3 targeted jest runs) confirms buildPolicySummaryGreek's full behavior matrix, the CONSENT_PROMPT_GREEK_TEMPLATE signature change, and both real call-site updates all compile and pass together. Task 3's file-existence check confirms the todo was moved, not copied or left behind. No manual/human verification needed — this is a Greek-text-composition change with full automated coverage across the existing Jest suite.
</verification>

<success_criteria>
- showClientRootMenu's message text enumerates all 4 client menu options in Greek, in addition to the unchanged inline keyboard.
- A new client's first-contact consent message includes a Greek summary of only the non-default policy flags configured for that business (cancellation cutoff, slotless requests, fixed-session mode, membership-required enforcement) — a plain-vanilla business (all defaults) sees no added text.
- CONSENT_PROMPT_GREEK_TEMPLATE's signature and both real call sites are updated consistently; all previously-passing tests in tests/consent.test.ts, tests/conversation-router.test.ts, and tests/webhooks/client-menu.test.ts still pass, plus new tests cover buildPolicySummaryGreek.
- npx tsc --noEmit passes with zero new errors.
- The source todo file is moved from .planning/todos/pending/ to .planning/todos/done/.
</success_criteria>

<output>
Create `.planning/quick/260729-mlr-show-all-menu-options-in-root-menu-text-/260729-mlr-SUMMARY.md` when done
</output>
