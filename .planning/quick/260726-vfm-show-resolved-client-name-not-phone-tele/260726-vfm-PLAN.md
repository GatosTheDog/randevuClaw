---
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/telegram/handlers/client-menu.ts
  - tests/webhooks/client-menu.test.ts
autonomous: true
requirements: []

must_haves:
  truths:
    - "The owner-facing 'Ακύρωση κράτησης από πελάτη' Telegram notification shows the client's resolved display name (from getClientName) instead of their raw phone/telegram id, when a name is on file."
    - "The owner-facing 'Νέα κράτηση μαθήματος' Telegram notification shows the client's resolved display name instead of their raw phone/telegram id, when a name is on file."
    - "When no client name is on file for either notification, the message falls back to the raw phone/telegram id (never blank), mirroring the escalation flow's `relationship?.clientName ?? clientTelegramId` pattern in src/telegram/escalation.ts."
  artifacts:
    - "src/telegram/handlers/client-menu.ts: handleCancelExecute and handleBookSessionExecute both call getClientName (imported from ../../billing/queries) inside their existing best-effort owner-notification try blocks, and use the result — falling back to the existing raw id/phone value on null — as the 'Πελάτης:' display value."
    - "tests/webhooks/client-menu.test.ts: new assertions in Suite C (book flow) and Suite D (cancel flow) covering the resolved-name case and the fallback-to-raw-id case for both owner notifications."
  key_links:
    - "handleCancelExecute -> getClientName(business.id, booking.clientPhone) -> ownerText 'Πελάτης: ' line (fallback: booking.clientPhone)"
    - "handleBookSessionExecute -> getClientName(business.id, senderTelegramId) -> ownerText 'Πελάτης: ' line (fallback: senderTelegramId)"
---

<objective>
Two existing owner-facing Telegram notifications in `src/telegram/handlers/client-menu.ts` currently print the client's raw phone number / Telegram id instead of a resolved display name: the cancellation notification in `handleCancelExecute` ("Ακύρωση κράτησης από πελάτη") and the new-booking notification in `handleBookSessionExecute` ("Νέα κράτηση μαθήματος"). Wire both call sites to the existing `getClientName(businessId, clientPhone)` helper in `src/billing/queries.ts` (added in Phase 07-04), with a safe fallback to the current raw value when no name is on file — mirroring the established fallback pattern already used in `src/telegram/escalation.ts`'s `sendEscalationToAdmin` (`relationship?.clientName ?? clientTelegramId`).

Purpose: Business owners currently see an anonymous phone number or Telegram id in these two alerts even when the client has a name on file elsewhere in the system (owner-recorded during onboarding/payment flows) — this is a confusing, low-trust experience for a WhatsApp/Telegram-native booking product where the owner should recognize who they're dealing with.

Output: Both notification call sites resolve and display the client's name when available, with zero behavior change (message still sends, still best-effort, still non-blank) when no name is on file. Test coverage added for both the resolved-name and fallback-to-id cases in both flows.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
This is a small, fully-scoped display-value fix — no research or discovery needed. Both target functions and the helper they need already exist and are confirmed via direct source reads (not guessed):

- `getClientName(businessId: number, clientPhone: string): Promise<string | null>` is already exported from `src/billing/queries.ts` (lines 465-477). It queries `clientBusinessRelationships` by `businessId` + `senderPhone` and returns `clientName` or `null` if no relationship/name is on file. It was added in Phase 07-04 specifically to identify clients by name rather than phone number in owner-facing alerts (see its own docstring) — this task extends that same intent to two more call sites that were missed.
- `src/telegram/handlers/client-menu.ts` currently imports `getClientActiveMembership, findMembershipByBooking, restoreCredit` from `../../billing/queries` (not `getClientName` — it needs to be added to that import).
- `handleCancelExecute` (lines 374-464) builds its best-effort owner notification inside `try { if (business.ownerTelegramId && business.botToken) { const ownerText = 'Ακύρωση κράτησης από πελάτη:\n...\nΠελάτης: ' + booking.clientPhone; ... } } catch (err) { ... }` — the raw `booking.clientPhone` is the value to replace.
- `handleBookSessionExecute` (lines 185-274) builds its analogous best-effort owner notification inside `try { if (business.ownerTelegramId && business.botToken) { const ownerText = 'Νέα κράτηση μαθήματος:\n...\nΠελάτης: ' + senderTelegramId; ... } } catch (err) { ... }` — the raw `senderTelegramId` is the value to replace.
- The established fallback pattern (from `src/telegram/escalation.ts`'s `sendEscalationToAdmin`, lines 116-118): resolve the relationship/name lookup, then use `resolvedName ?? rawIdentifier` so the message is never blank even when no name is recorded. `getClientName` already returns exactly `string | null`, so the equivalent expression here is `(await getClientName(business.id, <phone-or-id>)) ?? <phone-or-id>` — no intermediate relationship object needed.
- `tests/webhooks/client-menu.test.ts` already `jest.mock('../../src/billing/queries')`s the whole module and has typed mock references for `findMembershipByBooking` and `restoreCredit` from that module (Suite D `beforeEach`). `getClientName` needs the same typed-mock treatment, plus a default `mockResolvedValue(null)` in both Suite C and Suite D `beforeEach` blocks so existing assertions (which don't currently exercise a resolved name) keep passing unchanged.

@src/telegram/handlers/client-menu.ts
@src/billing/queries.ts
@src/telegram/escalation.ts
@tests/webhooks/client-menu.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Resolve client display name in both owner notifications</name>
  <files>src/telegram/handlers/client-menu.ts</files>
  <behavior>
    - handleCancelExecute: when getClientName(business.id, booking.clientPhone) resolves a non-null string, the owner notification's "Πελάτης: " line contains that string, not the raw phone/id.
    - handleCancelExecute: when getClientName resolves null, the owner notification's "Πελάτης: " line contains the raw booking.clientPhone value unchanged (current behavior preserved).
    - handleBookSessionExecute: when getClientName(business.id, senderTelegramId) resolves a non-null string, the owner notification's "Πελάτης: " line contains that string, not the raw id.
    - handleBookSessionExecute: when getClientName resolves null, the owner notification's "Πελάτης: " line contains the raw senderTelegramId value unchanged (current behavior preserved).
  </behavior>
  <action>
Add `getClientName` to the existing named import from `../../billing/queries` at the top of the file (alongside `getClientActiveMembership`, `findMembershipByBooking`, `restoreCredit`).

In `handleCancelExecute`, inside the existing best-effort try block guarded by `if (business.ownerTelegramId && business.botToken)`, before the `ownerText` assignment, resolve the client's display name by awaiting `getClientName(business.id, booking.clientPhone)` into a local variable. Change the "Πελάτης: " concatenation at the end of `ownerText` from the raw `booking.clientPhone` to that resolved variable falling back to `booking.clientPhone` via nullish coalescing when the lookup returns null — the same fallback shape as `sendEscalationToAdmin`'s `relationship?.clientName ?? clientTelegramId` in src/telegram/escalation.ts, just sourced directly from getClientName's string-or-null return.

In `handleBookSessionExecute`, inside its analogous best-effort try block guarded by `if (business.ownerTelegramId && business.botToken)`, before the `ownerText` assignment, resolve the client's display name by awaiting `getClientName(business.id, senderTelegramId)` into a local variable. Change the "Πελάτης: " concatenation at the end of that `ownerText` from the raw `senderTelegramId` to that resolved variable falling back to `senderTelegramId` via nullish coalescing when the lookup returns null.

Do not change anything else in either function: no changes to message ordering, the enforcement/booking/cancellation control flow, the calendar-delete or credit-restore logic, or the catch-block error logging. This is a display-value substitution confined to the two owner-notification try blocks. Both getClientName calls must stay inside their respective `if (business.ownerTelegramId && business.botToken)` guards so no extra DB lookup happens when there is no owner/bot token to notify.
  </action>
  <verify>
    <automated>test "$(grep -c 'await getClientName(' src/telegram/handlers/client-menu.ts)" -eq 2 && npm run build</automated>
  </verify>
  <done>Both handleCancelExecute and handleBookSessionExecute await getClientName inline before building their respective ownerText, using (resolvedName ?? rawValue) as the displayed identifier on the "Πελάτης: " line; no other logic in the file changed; `npm run build` passes with zero new TypeScript errors.</done>
</task>

<task type="auto">
  <name>Task 2: Add test coverage for resolved-name and fallback-to-id cases</name>
  <files>tests/webhooks/client-menu.test.ts</files>
  <action>
Add a typed mock reference for `getClientName` from `billingQueries` (the module is already fully `jest.mock`'d at the top of the file), following the exact pattern used for `mockedFindMembershipByBooking` and `mockedRestoreCredit` immediately above it.

In Suite C's `beforeEach` (book flow), add a default `mockedGetClientName.mockResolvedValue(null)` alongside the other default mock setups, so the existing book-flow tests (which assert on booking success/owner-notified/date-content, not on client identity text) keep passing unchanged with the new fallback-to-raw-id behavior.

In Suite D's `beforeEach` (cancel flow), add the same default `mockedGetClientName.mockResolvedValue(null)` for the same reason.

Add two new tests to Suite C, both driving `handleClientMenuCallback` with `clientMenuAction: 'book:yes'` exactly like the existing "owner IS notified" test (same db.select mock returning `{ serviceId: 3, sessionDate: '2026-07-27', sessionTime: '09:00' }`, same senderTelegramId, same instanceId):
  - One where `mockedGetClientName.mockResolvedValue('Μαρία Κ.')` and the test asserts `mockedSendTelegramMessage` was called with `OWNER_TELEGRAM_ID` and text containing `'Μαρία Κ.'`.
  - One where `mockedGetClientName.mockResolvedValue(null)` and the test asserts `mockedSendTelegramMessage` was called with `OWNER_TELEGRAM_ID` and text containing the raw `senderTelegramId` value (i.e. `CLIENT_TELEGRAM_ID`).

Add two new tests to Suite D, both driving `handleClientMenuCallback` with `clientMenuAction: 'cancel:yes'` exactly like the existing "happy path" test (same BASE_BOOKING, same bookingId, same senderTelegramId):
  - One where `mockedGetClientName.mockResolvedValue('Γιώργος Π.')` and the test asserts `mockedSendTelegramMessage` was called with `OWNER_TELEGRAM_ID` and text containing `'Γιώργος Π.'`.
  - One where `mockedGetClientName.mockResolvedValue(null)` and the test asserts `mockedSendTelegramMessage` was called with `OWNER_TELEGRAM_ID` and text containing the raw client id value (`CLIENT_TELEGRAM_ID`, matching `BASE_BOOKING.clientPhone`).

Do not modify any of the existing 24 tests' assertions — only add the typed mock reference, the two new beforeEach default lines, and the four new test cases.
  </action>
  <verify>
    <automated>npx jest --testPathPattern=tests/webhooks/client-menu.test.ts</automated>
  </verify>
  <done>tests/webhooks/client-menu.test.ts contains 4 new passing tests (2 in Suite C, 2 in Suite D) covering the resolved-name and fallback-to-raw-id cases for both the book and cancel owner notifications; the full file passes (28/28: 24 existing + 4 new) with no changes to existing test assertions.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Telegram client chat -> owner Telegram chat (via botTokenStore-scoped send) | The client-supplied identifier (phone/Telegram id) is looked up against `clientBusinessRelationships` and the resolved name is relayed to the business owner's chat — both sides are already-authenticated Telegram users within this business's bot scope; no new untrusted input crosses a boundary here. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-quick-01 | Information Disclosure | getClientName lookup in handleCancelExecute / handleBookSessionExecute | low | accept | Displaying a stored client name to the business owner is not a new class of exposure — the owner already sees the client's raw phone/Telegram id (equal or greater sensitivity) in the same message today, and `clientName` in `clientBusinessRelationships` is data the owner themselves recorded for that client relationship. |
| T-quick-02 | Denial of Service | getClientName DB call inside both best-effort owner-notification try blocks | low | accept | Both calls are placed inside the pre-existing `try { ... } catch (err) { logger.error(...) }` best-effort blocks (already in place for the owner notification send) — a DB error from getClientName is caught and logged exactly like a send failure today, and never blocks the client-facing confirmation/cancellation message that is sent afterward outside the try block. |
</threat_model>

<verification>
Task 1's automated grep+build check confirms both call sites invoke `getClientName` and the file still compiles. Task 2's automated Jest run confirms all 28 tests in `tests/webhooks/client-menu.test.ts` pass, including the 4 new tests exercising resolved-name and fallback-to-id behavior for both notifications. No manual/human verification needed — this is a backend-only Telegram message text change with full automated coverage.
</verification>

<success_criteria>
- `handleCancelExecute`'s "Ακύρωση κράτησης από πελάτη" owner notification shows the resolved client name when one is on file, and the raw phone/id when it is not.
- `handleBookSessionExecute`'s "Νέα κράτηση μαθήματος" owner notification shows the resolved client name when one is on file, and the raw Telegram id when it is not.
- No other message content, control flow, or error-handling behavior in either function changed.
- `npm run build` passes with zero new TypeScript errors.
- `tests/webhooks/client-menu.test.ts` passes 28/28 (24 existing + 4 new), with the 4 new tests explicitly covering resolved-name and fallback-to-id cases for both notifications.
</success_criteria>

<output>
Create `.planning/quick/260726-vfm-show-resolved-client-name-not-phone-tele/260726-vfm-SUMMARY.md` when done
</output>
