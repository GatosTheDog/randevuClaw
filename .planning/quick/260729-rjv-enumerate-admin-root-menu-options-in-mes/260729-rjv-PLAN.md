---
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/telegram/handlers/admin-menu.ts
  - src/onboarding/ai-onboarding-agent.ts
  - src/webhooks/telegram.ts
  - tests/admin-menu.test.ts
  - tests/onboarding/ai-onboarding-agent.test.ts
  - tests/webhooks/client-menu.test.ts
autonomous: true
requirements: []

must_haves:
  truths:
    - "The admin root menu message text visibly enumerates all 6 button labels in Greek as a numbered list, in the same row-major reading order the inline keyboard renders them — the keyboard itself, its callback_data, and assertCallbackDataSize calls are byte-for-byte unchanged."
    - "Tapping the client's Telegram (menu) button shows 5 real, tappable commands — /start, /book, /mybookings, /cancel, /balance — each with a Greek description; the /book description is booking-mode-aware, matching client-menu.ts's own bookingButtonText conditional exactly."
    - "Sending /book, /mybookings, /cancel, or /balance as a plain text message (not just tapping the menu button) routes a consented client to the same handler function the equivalent cmenu: root-menu button already calls (showBookSessionList, showClientBookings, showCancelBookingList, showClientBalance respectively)."
    - "A client without consent who sends /book, /mybookings, /cancel, or /balance sees only the consent prompt+keyboard — identical to /start's existing behavior — never the target handler's output."
    - "An owner sending /book, /mybookings, /cancel, or /balance is intercepted by the pre-existing owner branch (which always returns earlier) exactly as /start already is — these commands remain structurally unreachable for owners."
    - "Both setMyCommands registration call sites (admin-menu.ts's reassertMenuButtonAndCommands and ai-onboarding-agent.ts's finish_onboarding) register the identical 5-command list, so Telegram's persisted client command menu is consistent regardless of which flow last ran."
  artifacts:
    - "src/telegram/handlers/admin-menu.ts: showAdminRootMenu's message text includes the numbered 6-item list; reassertMenuButtonAndCommands grew a third business: Business parameter and registers 5 commands (start/book/mybookings/cancel/balance) instead of 1."
    - "src/onboarding/ai-onboarding-agent.ts: finish_onboarding's setMyCommands call inside the retry loop registers the same 5-command array."
    - "src/webhooks/telegram.ts: handleFoundBusiness routes /book, /mybookings, /cancel, /balance to showBookSessionList/showClientBookings/showCancelBookingList/showClientBalance (imported from ../telegram/handlers/client-menu), each gated by the same consent check as /start."
    - "tests/admin-menu.test.ts, tests/onboarding/ai-onboarding-agent.test.ts, tests/webhooks/client-menu.test.ts: existing setMyCommands/text assertions updated to the new 5-command shape; new tests cover the 4 new routed commands' happy path, consent gate, and owner non-reachability."
  key_links:
    - "showAdminRootMenu -> sendTelegramMessageWithKeyboard(chatId, menuText, keyboard) — menuText now lists all 6 options; keyboard/callback_data untouched."
    - "reassertMenuButtonAndCommands / finish_onboarding -> setMyCommands(botToken, [5 commands], { type: 'all_private_chats' }) -> Telegram's client-facing (menu) button shows 5 tappable commands."
    - "handleFoundBusiness's new /book|/mybookings|/cancel|/balance branches -> getOrCreateClientRelationship consent gate -> showBookSessionList/showClientBookings/showCancelBookingList/showClientBalance, mirroring the existing /start -> showClientRootMenu wiring exactly."
---

<objective>
Two independent, small Telegram-bot UX fixes for RandevuClaw's admin and client menus (both explicitly confirmed with the user):

**Part A** — `showAdminRootMenu` (src/telegram/handlers/admin-menu.ts) currently sends only a title line alongside its 6-button inline keyboard. Add a numbered-list enumeration of all 6 button labels to the message text, mirroring the numbered-list pattern `showClientRootMenu` (client-menu.ts) already uses for its own 4 buttons.

**Part B** — Today the Telegram native command menu (the (menu) button) registers only `/start` for clients. Expand it to 5 real, routed commands: `/start`, `/book`, `/mybookings`, `/cancel`, `/balance`. Both setMyCommands call sites (admin-menu.ts's `reassertMenuButtonAndCommands` and ai-onboarding-agent.ts's `finish_onboarding`) must register all 5. `src/webhooks/telegram.ts`'s `handleFoundBusiness` must route the 4 new commands to the exact same handler functions their equivalent root-menu buttons already call, gated by the same consent check `/start` already has.

Purpose: Make both the admin root menu and the client's native command list fully self-describing/discoverable without hidden functionality.

Output: Admin menu text enumerates all 6 options; client Telegram command menu lists and routes 5 real commands.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
Both parts are additive/text changes to existing, already-tested code paths — no schema, DB, or new external API surface.

**Part A context** — `showAdminRootMenu` (src/telegram/handlers/admin-menu.ts, lines ~84-131) builds a 4-row `InlineKeyboard`: row 1 = Ρυθμίσεις / Μαθήματα, row 2 = Πελάτες / Ατζέντα Σήμερα, row 3 = Καταχώρηση Πληρωμής (solo), row 4 = Πρόσκληση Πελάτη (solo). It then calls `sendTelegramMessageWithKeyboard(chatId, \`Πίνακας Ελέγχου — ${business.name}\`, keyboard)`. `tests/admin-menu.test.ts`'s "showAdminRootMenu — keyboard shape" test only asserts on the keyboard argument (`sendCalls[0][2]`), never the text argument, so this text-only change is safe there. `showClientRootMenu` (client-menu.ts, lines 65-98) is the reference pattern: it builds `menuText` as the greeting line, a blank line, then `1. ${bookingButtonText}` / `2. Οι κρατήσεις μου` / `3. Ακύρωση κράτησης` / `4. Υπόλοιπο μαθημάτων`.

**Part B context** — `reassertMenuButtonAndCommands` (admin-menu.ts, lines 68-79) is called once, from inside `showAdminRootMenu` (line ~124), as `reassertMenuButtonAndCommands(business.botToken, chatId)` — `business` is already in scope at that call site. `finish_onboarding` (ai-onboarding-agent.ts, lines ~600-635, inside `executeOnboardingTool`'s switch) has its own independent, near-identical inline block with a bounded retry loop (`MENU_SETUP_MAX_ATTEMPTS = 3`); `business: Business` is already a parameter in scope there too. Both currently call `setMyCommands(token, [{ command: 'start', description: 'Έναρξη κράτησης ραντεβού' }], { type: 'all_private_chats' })` — this is the literal single line that must grow to 5 entries in both places. `client-menu.ts`'s `showClientRootMenu` (line 76-77) is the exact source of the booking-mode conditional to mirror: `business.bookingMode === 'fixed_sessions' ? 'Κράτηση μαθήματος' : 'Κράτηση ραντεβού'`.

`src/webhooks/telegram.ts`'s `handleFoundBusiness` (lines 70-303): the owner branch (`if (business.ownerTelegramId !== null && business.ownerTelegramId === senderTelegramId) { ... }`, starting line 81) always returns before line 207 — every path through it ends in `return`. The `/start` branch (lines 207-239) is the exact structure to mirror for each new command: `withBusinessContext(business.id, async () => { clearPendingReply(...); const { consentGiven } = await getOrCreateClientRelationship(...); if (!consentGiven) { send consent prompt } else { <action> }; await markTelegramUpdateProcessed(...); })` then a `logger.info` exit line, then `return`. `client-menu.ts` already exports `showBookSessionList(chatId, business)`, `showClientBookings(chatId, business)`, `showCancelBookingList(chatId, business, senderTelegramId)`, and `showClientBalance(chatId, business)` — telegram.ts currently imports only `ClientMenuCallbackResult, showClientRootMenu, handleClientMenuCallback` from that module (line 34); the other 4 need adding to that import.

`tests/webhooks/client-menu.test.ts`'s `jest.mock('../../src/telegram/handlers/client-menu', ...)` factory (lines 60-67) already proves the pattern needed here: it overrides only `showClientRootMenu` in the exported object while `handleClientMenuCallback`'s own internal calls to sibling functions in the same source file (e.g. its `case 'book': await showBookSessionList(...)`) still resolve to the real, un-mocked implementations — TypeScript/CommonJS same-module function calls reference the local binding directly, not the `exports` object, so overriding more exports in this same factory (for `showBookSessionList`, `showClientBookings`, `showCancelBookingList`, `showClientBalance`) will only affect external importers like `telegram.ts`'s new branches and this test file's own new assertions — it will NOT break Suite C/D's existing direct `handleClientMenuCallback(...)` tests, which rely on exactly this same mechanism today for `showClientRootMenu`.

@src/telegram/handlers/admin-menu.ts
@src/telegram/handlers/client-menu.ts
@src/onboarding/ai-onboarding-agent.ts
@src/webhooks/telegram.ts
@tests/admin-menu.test.ts
@tests/onboarding/ai-onboarding-agent.test.ts
@tests/webhooks/client-menu.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Enumerate all 6 admin root-menu options in the message text (Part A)</name>
  <files>src/telegram/handlers/admin-menu.ts, tests/admin-menu.test.ts</files>
  <action>
In `showAdminRootMenu` (src/telegram/handlers/admin-menu.ts, ~lines 112-116), replace the single-line template literal `` `Πίνακας Ελέγχου — ${business.name}` `` currently passed directly as `sendTelegramMessageWithKeyboard`'s second argument with a new `menuText` local variable built as a template literal: keep the existing title line, then a blank line, then a numbered list (1 through 6) of the same six button labels already used to build `keyboard`, in the exact row-major reading order the keyboard renders them — 1. Ρυθμίσεις, 2. Μαθήματα, 3. Πελάτες, 4. Ατζέντα Σήμερα, 5. Καταχώρηση Πληρωμής, 6. Πρόσκληση Πελάτη. These six labels are plain literal strings in the existing keyboard construction (not stored in shared variables the way client-menu.ts's `bookingButtonText` is), so write them as literal text in the numbered list too. Pass `menuText` as `sendTelegramMessageWithKeyboard`'s second argument in place of the inline template literal. Do not modify `keyboard`, any `callback_data` string, or any `assertCallbackDataSize` call — this is a text-only addition, mirroring the exact numbered-list shape `showClientRootMenu` (src/telegram/handlers/client-menu.ts, lines 90-95) already uses for its own 4 buttons.

In `tests/admin-menu.test.ts`, add one new test to the existing "showAdminRootMenu — keyboard shape" describe block (after the existing "sends exactly one message with a 4-row keyboard totalling 6 buttons" test) asserting the text argument (`sendCalls[0][1]`) contains all 6 numbered labels — e.g. assert it contains the substrings "1. Ρυθμίσεις", "2. Μαθήματα", "3. Πελάτες", "4. Ατζέντα Σήμερα", "5. Καταχώρηση Πληρωμής", and "6. Πρόσκληση Πελάτη" — while the existing keyboard-shape assertions (`sendCalls[0][2]`) stay untouched and continue passing unmodified.
  </action>
  <verify>
    <automated>test "$(grep -c '6\. Πρόσκληση Πελάτη' src/telegram/handlers/admin-menu.ts)" -eq 1 && npx jest --testPathPattern=tests/admin-menu.test.ts --testTimeout=20000</automated>
  </verify>
  <done>showAdminRootMenu sends one message whose text lists all 6 button labels as a numbered list (1-6) in addition to the unchanged 4-row/6-button inline keyboard; the existing keyboard-shape test still passes unmodified; the new text-enumeration test passes.</done>
</task>

<task type="auto">
  <name>Task 2: Register 5 real client commands at both setMyCommands call sites (Part B, registration)</name>
  <files>src/telegram/handlers/admin-menu.ts, src/onboarding/ai-onboarding-agent.ts, tests/admin-menu.test.ts, tests/onboarding/ai-onboarding-agent.test.ts</files>
  <action>
In `src/telegram/handlers/admin-menu.ts`: change `reassertMenuButtonAndCommands`'s signature from `(botToken: string, chatId: string)` to add a third parameter `business: Business` (`Business` is already imported at the top of this file) — keep the existing two parameters as-is, only append the third. At the top of the function body, compute `const bookingButtonText = business.bookingMode === 'fixed_sessions' ? 'Κράτηση μαθήματος' : 'Κράτηση ραντεβού';` — this mirrors client-menu.ts's `showClientRootMenu` conditional exactly, byte for byte. Change the function's second `setMyCommands` call from a 1-item array (`{ command: 'start', description: 'Έναρξη κράτησης ραντεβού' }`) to a 5-item array, appending in order: `{ command: 'book', description: bookingButtonText }`, `{ command: 'mybookings', description: 'Οι κρατήσεις μου' }`, `{ command: 'cancel', description: 'Ακύρωση κράτησης' }`, `{ command: 'balance', description: 'Υπόλοιπο μαθημάτων' }` — keep the existing `start` entry as the first item, unchanged. Update the function's one call site inside `showAdminRootMenu` (`reassertMenuButtonAndCommands(business.botToken, chatId)`) to pass `business` as the new third argument: `reassertMenuButtonAndCommands(business.botToken, chatId, business)`.

In `src/onboarding/ai-onboarding-agent.ts`'s `finish_onboarding` case (inside `executeOnboardingTool`'s switch, ~lines 608-635): immediately after the `MENU_SETUP_BASE_BACKOFF_MS` constant declaration and before the `for` retry loop, compute `const bookingButtonText = business.bookingMode === 'fixed_sessions' ? 'Κράτηση μαθήματος' : 'Κράτηση ραντεβού';` once (it does not change across retry attempts). Inside the loop, change the same-shaped `setMyCommands(business.botToken!, [{ command: 'start', ... }], { type: 'all_private_chats' })` call to the identical 5-item array used in admin-menu.ts above (start/book/mybookings/cancel/balance, same descriptions, `book`'s description using the local `bookingButtonText`). Leave the retry/backoff/catch logic entirely untouched — only the array literal inside the second `setMyCommands` call changes.

Update `tests/admin-menu.test.ts`'s "showAdminRootMenu — menu button re-assertion (D-06.2)" describe block: in the "re-asserts using the caller's own business botToken and chatId" test, change the expected `setMyCommands` call's second argument from the 1-item `start`-only array to the 5-item array (mockBusiness.bookingMode is `'open_slots'` in this file's fixture, so `book`'s expected description is `'Κράτηση ραντεβού'`). Add one new test in the same describe block asserting the booking-mode-aware branch: spread `mockBusiness` with `bookingMode: 'fixed_sessions'` override, call `showAdminRootMenu`, flush the fire-and-forget chain (`await new Promise((resolve) => setImmediate(resolve));`), and assert `setMyCommands` was called with `book`'s description equal to `'Κράτηση μαθήματος'` in an otherwise-identical 5-item array.

Update `tests/onboarding/ai-onboarding-agent.test.ts`'s "BOT-06: registers owner + client commands and menu buttons..." test (~lines 483-513): change the expected `mockedSetMyCommands` call's second argument from the 1-item `start`-only array to the same 5-item array (this file's `makeBusiness` default `bookingMode` is `'open_slots'`, so `book`'s expected description is `'Κράτηση ραντεβού'`). Do not change any other test in this describe block (the rejecting/retry/exhausted-retry tests only assert call counts, which are unaffected since the number of `setMyCommands`/`setChatMenuButton` calls per attempt is unchanged — only the array contents inside one of those calls changed).
  </action>
  <verify>
    <automated>npx tsc --noEmit && npx jest --testPathPattern=tests/admin-menu.test.ts --testTimeout=20000 && npx jest --testPathPattern=tests/onboarding/ai-onboarding-agent.test.ts --testTimeout=20000</automated>
  </verify>
  <done>reassertMenuButtonAndCommands (admin-menu.ts) and finish_onboarding (ai-onboarding-agent.ts) both register the identical 5-command array (start/book/mybookings/cancel/balance) via setMyCommands with type all_private_chats; book's description is booking-mode-aware in both places; all updated and new tests pass; npx tsc --noEmit reports zero new errors.</done>
</task>

<task type="auto">
  <name>Task 3: Route /book, /mybookings, /cancel, /balance as real client commands in the webhook handler (Part B, routing)</name>
  <files>src/webhooks/telegram.ts, tests/webhooks/client-menu.test.ts</files>
  <action>
In `src/webhooks/telegram.ts`: add `showBookSessionList`, `showClientBookings`, `showCancelBookingList`, `showClientBalance` to the existing named import from `'../telegram/handlers/client-menu'` (currently `ClientMenuCallbackResult, showClientRootMenu, handleClientMenuCallback`).

Add a new private async helper function, `dispatchClientCommand`, placed directly above `handleFoundBusiness` (do not modify `handleFoundBusiness`'s existing `/start` branch itself — leave it byte-for-byte unchanged). The helper takes `(commandLabel: string, updateId: string, business: Business, senderTelegramId: string, startedAt: number, runAction: () => Promise<void>)` and reproduces the `/start` branch's exact structure: wrap in `withBusinessContext(business.id, async () => { ... })`; inside, call `clearPendingReply(business.id, senderTelegramId)`, then `const { consentGiven } = await getOrCreateClientRelationship(business.id, senderTelegramId)`; if `!consentGiven`, call `sendTelegramMessageWithKeyboard(senderTelegramId, CONSENT_PROMPT_GREEK_TEMPLATE(business), CONSENT_KEYBOARD)`; else call `await runAction()`; then `await markTelegramUpdateProcessed(updateId, business.id)`. After the `withBusinessContext` call resolves, call `logger.info({ updateId, businessId: business.id, elapsedMs: Date.now() - startedAt }, \`handleFoundBusiness: exit (${commandLabel} branch)\`)`. This helper is purely additive — it must not be called from the existing `/start` branch.

Immediately after the existing `/start` branch's closing `return;` (after line ~239, still inside `handleFoundBusiness`'s `try` block, before the fallthrough client-conversation `withBusinessContext` call), add 4 new `if` blocks, one per new command, each checking `messageText.trim() === '/book'` (etc.) and, when true, calling `await dispatchClientCommand('/book', updateId, business, senderTelegramId, startedAt, () => showBookSessionList(senderTelegramId, business))` followed by `return;`. Repeat for `/mybookings` → `showClientBookings(senderTelegramId, business)`, `/cancel` → `showCancelBookingList(senderTelegramId, business, senderTelegramId)` (senderTelegramId passed as both the business-context sender and the cancel-list's own senderTelegramId parameter, matching the existing `chatId === senderTelegramId for private Telegram chats` convention used elsewhere in this file and in client-menu.ts), and `/balance` → `showClientBalance(senderTelegramId, business)`. Because these 4 new blocks are placed structurally after the owner branch's unconditional `return` (line ~205) — exactly like the existing `/start` block already is — they remain unreachable for any sender matching `business.ownerTelegramId`; no owner-side change is needed or should be made.

In `tests/webhooks/client-menu.test.ts`: extend the `jest.mock('../../src/telegram/handlers/client-menu', ...)` factory (lines 60-67) to also override `showBookSessionList`, `showClientBookings`, `showCancelBookingList`, and `showClientBalance` as `jest.fn().mockResolvedValue(undefined)`, alongside the existing `showClientRootMenu` override (keep the existing comment noting `handleClientMenuCallback` uses the real implementation). Add 4 new typed mock consts near the existing `mockedShowClientRootMenu` declaration: `mockedShowBookSessionList`, `mockedShowClientBookings`, `mockedShowCancelBookingList`, `mockedShowClientBalance`, each cast from the corresponding `clientMenuModule` export as `jest.MockedFunction` of that same export's type (mirroring the existing `mockedShowClientRootMenu` declaration's exact pattern). In `setupCommonMocks()`, add `.mockResolvedValue(undefined)` calls for all 4 new mocks alongside the existing `mockedShowClientRootMenu.mockResolvedValue(undefined);` line.

In "Suite B: /start intercept and CMENU-05 free-text routing", add 4 new tests (after the existing 4, before the describe block's closing brace) mirroring "client sends /start → showClientRootMenu called, routeConversationMessage NOT called" exactly, one per new command: client sends `/book` → `mockedShowBookSessionList` called once with `(String(CLIENT_TELEGRAM_ID), expect.objectContaining({ id: 1 }))`, `routeConversationMessage` not called; client sends `/mybookings` → `mockedShowClientBookings` called the same way; client sends `/cancel` → `mockedShowCancelBookingList` called with `(String(CLIENT_TELEGRAM_ID), expect.objectContaining({ id: 1 }), String(CLIENT_TELEGRAM_ID))`; client sends `/balance` → `mockedShowClientBalance` called the same two-arg way. Also add one test mirroring "owner sends /start → showClientRootMenu NOT called" for `/book` only (representative of the structural owner-guard shared by all 4): owner sends `/book` → `mockedShowBookSessionList` not called.

In "Suite G: client consent gate", add one new test mirroring "/start with consentGiven=false → consent prompt+keyboard sent, showClientRootMenu NOT called" for `/book` only (representative of the shared consent-gate logic in the new helper): set `mockedGetOrCreateClientRelationship` to resolve `{ isFirstContact: true, consentGiven: false }`, send `/book`, assert `mockedSendTelegramMessageWithKeyboard` was called with `(String(CLIENT_TELEGRAM_ID), CONSENT_PROMPT_GREEK_TEMPLATE(BASE_BUSINESS), CONSENT_KEYBOARD)` and `mockedShowBookSessionList` was NOT called.
  </action>
  <verify>
    <automated>npx tsc --noEmit && npx jest --testPathPattern=tests/webhooks/client-menu.test.ts --testTimeout=20000</automated>
  </verify>
  <done>handleFoundBusiness routes /book, /mybookings, /cancel, /balance to their matching client-menu handler functions when consent is given, shows the consent prompt when it is not, and remains structurally unreachable for owners — all mirroring /start's existing behavior exactly; all new and existing tests in tests/webhooks/client-menu.test.ts pass; npx tsc --noEmit reports zero new errors.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Telegram user-sent messageText (untrusted) -> command routing in handleFoundBusiness | The 4 new command strings are matched by exact-equality against attacker-controlled text, identical to the existing /start check; no new parsing, ID, or user-supplied argument is introduced. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-quick-01 | Elevation of Privilege | src/webhooks/telegram.ts handleFoundBusiness new /book, /mybookings, /cancel, /balance branches | low | accept | Each new branch sits structurally after the owner branch's unconditional return (identical position to the existing, already-audited /start branch) and dispatches to the same consent-gated handler functions already reachable via the cmenu: callback buttons (showBookSessionList, showClientBookings, showCancelBookingList, showClientBalance) — no new code path, privilege level, or trust boundary is introduced; this only adds a second (text-command) entry point to functionality that was already reachable and already gated. |
| T-quick-02 | Tampering | src/telegram/handlers/admin-menu.ts reassertMenuButtonAndCommands + src/onboarding/ai-onboarding-agent.ts finish_onboarding (two independent literal copies of the same 5-command array) | low | mitigate | Both 5-command arrays are asserted byte-for-byte in tests/admin-menu.test.ts and tests/onboarding/ai-onboarding-agent.test.ts; any future edit to one copy that is not mirrored in the other fails its respective test before merge, keeping Telegram's persisted client command menu consistent regardless of which registration call site last ran. |
| T-quick-03 | Information Disclosure | src/telegram/handlers/admin-menu.ts showAdminRootMenu message text | low | accept | The numbered list only echoes button labels already visible on the inline keyboard sent in the same message — no new information is exposed to the owner viewing their own admin menu. |
</threat_model>

<verification>
Task 1's grep+jest check confirms the admin root menu text now lists all 6 options without touching keyboard/callback structure. Task 2's tsc+jest chain confirms both setMyCommands call sites register the identical, booking-mode-aware 5-command array. Task 3's tsc+jest chain confirms the 4 new routed commands dispatch to the correct handlers under consent, are gated identically to /start when consent is absent, and remain structurally unreachable for owners. No manual/human verification needed — this is a Telegram bot-command and Greek-text change with full automated coverage across the existing Jest suite; do not run the full `npm test` suite (machine crash risk per project memory) — only the three targeted `--testPathPattern` runs above.
</verification>

<success_criteria>
- showAdminRootMenu's message text enumerates all 6 admin menu options in Greek as a numbered list, in addition to the unchanged 4-row/6-button inline keyboard.
- Both reassertMenuButtonAndCommands and finish_onboarding register the identical 5-command list (start/book/mybookings/cancel/balance) via setMyCommands, with book's description booking-mode-aware in both places.
- src/webhooks/telegram.ts routes /book, /mybookings, /cancel, /balance to showBookSessionList/showClientBookings/showCancelBookingList/showClientBalance respectively when consent is given, shows the consent prompt otherwise, and remains unreachable for owners — mirroring /start exactly.
- All previously-passing tests in tests/admin-menu.test.ts, tests/onboarding/ai-onboarding-agent.test.ts, and tests/webhooks/client-menu.test.ts still pass, plus new tests cover the enumerated text, the 5-command registration (both booking modes), and the 4 new routed commands (happy path, consent gate, owner non-reachability).
- npx tsc --noEmit passes with zero new errors.
</success_criteria>

<output>
Create `.planning/quick/260729-rjv-enumerate-admin-root-menu-options-in-mes/260729-rjv-SUMMARY.md` when done
</output>
