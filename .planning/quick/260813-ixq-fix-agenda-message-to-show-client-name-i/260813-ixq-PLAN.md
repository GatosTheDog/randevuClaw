---
phase: quick-260813-ixq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/scheduler/agenda.ts
  - src/telegram/handlers/admin-menu.ts
  - tests/calendar-agenda-reminder-queries.test.ts
autonomous: true
requirements: []

must_haves:
  truths:
    - "Each agenda line (both the 08:00 auto-push and the on-demand /agenda menu) displays the client's registered display name resolved via findClientBusinessRelationship, not the raw clientPhone/Telegram id."
    - "When no clientBusinessRelationship row (or no clientName on it) exists for a booking's clientPhone, the agenda line falls back to the raw clientPhone — never blank/undefined."
  artifacts:
    - "src/scheduler/agenda.ts: formatAgendaMessage accepts a third clientNamesByPhone: Map<string, string> parameter and uses it (with phone fallback) when building each line."
    - "src/scheduler/agenda.ts: runAgendaSweep builds a clientNamesByPhone map (one findClientBusinessRelationship lookup per unique booking.clientPhone) before calling formatAgendaMessage."
    - "src/telegram/handlers/admin-menu.ts: showTodaysAgenda builds the same clientNamesByPhone map, mirroring its existing serviceNamesById loop, and passes it to formatAgendaMessage."
    - "tests/calendar-agenda-reminder-queries.test.ts: tests asserting the agenda message contains a resolved client name when a relationship with clientName exists, and falls back to the raw phone when it does not."
  key_links:
    - "runAgendaSweep -> findClientBusinessRelationship(businessId, booking.clientPhone) -> clientNamesByPhone.set(phone, rel?.clientName ?? phone) -> formatAgendaMessage(bookings, serviceNamesById, clientNamesByPhone)"
    - "showTodaysAgenda -> findClientBusinessRelationship(business.id, booking.clientPhone) -> clientNamesByPhone.set(phone, rel?.clientName ?? phone) -> formatAgendaMessage(bookingList, serviceNamesById, clientNamesByPhone)"
---

<objective>
Fix `formatAgendaMessage` (used by both `runAgendaSweep`'s 08:00 auto-push and `admin-menu.ts`'s on-demand `/agenda` command) so each line shows the client's resolved display name instead of the raw `booking.clientPhone` (a Telegram id, not a real phone number, despite the field name). Both call sites already build a `serviceNamesById` map with a per-unique-id DB lookup loop before calling `formatAgendaMessage` — this plan adds a mirrored `clientNamesByPhone` map built the same way via `findClientBusinessRelationship`, and threads it through as a new third parameter.

Purpose: Owners currently see an opaque Telegram id (e.g. `(5512345678)`) next to each agenda entry instead of a name they recognize, unlike other owner-facing surfaces (client deletion menus, expiry notifications, escalations) which already resolve `rel.clientName ?? <fallback>` per the established codebase convention.
Output: `src/scheduler/agenda.ts` and `src/telegram/handlers/admin-menu.ts` updated to resolve and display client names on every agenda line; `tests/calendar-agenda-reminder-queries.test.ts` extended with regression coverage for both the resolved-name case and the no-relationship fallback case.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

Reference for the established display-name fallback convention already used elsewhere in this codebase (do not change these call sites — they are the pattern to match, `rel.clientName ?? rel.senderPhone`):
@src/telegram/handlers/admin-menu.ts

Query definition (do not change its signature or behavior):
@src/database/queries.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Thread a resolved clientNamesByPhone map through formatAgendaMessage in both call sites</name>
  <files>src/scheduler/agenda.ts, src/telegram/handlers/admin-menu.ts</files>
  <action>
    In src/scheduler/agenda.ts:
    1. Add `findClientBusinessRelationship` to the existing named import from '../database/queries' (alongside claimAgendaSlot, findBusinessById, findServiceById, listAllBusinessIds, listBookingsForDate, Booking).
    2. Change `formatAgendaMessage`'s signature (currently `(bookings: Booking[], serviceNamesById: Map<number, string>)`) to add a third required parameter `clientNamesByPhone: Map<string, string>`. In the line-building callback, replace the raw `booking.clientPhone` interpolation with `clientNamesByPhone.get(booking.clientPhone) ?? booking.clientPhone` so an unresolved phone still renders instead of producing `undefined`.
    3. In `runAgendaSweep`, immediately after the existing `serviceNamesById` per-booking lookup loop, add a mirrored loop building `const clientNamesByPhone = new Map<string, string>();` — for each booking, if `!clientNamesByPhone.has(booking.clientPhone)`, call `const rel = await findClientBusinessRelationship(businessId, booking.clientPhone);` then `clientNamesByPhone.set(booking.clientPhone, rel?.clientName ?? booking.clientPhone);`. Keep this inside the same per-business try/catch as the rest of the sweep body — no new error-isolation boundary needed.
    4. Update the `formatAgendaMessage(bookings, serviceNamesById)` call to pass the new map as a third argument: `formatAgendaMessage(bookings, serviceNamesById, clientNamesByPhone)`.

    In src/telegram/handlers/admin-menu.ts:
    1. Add `findClientBusinessRelationship` to the existing destructured import from '../../database/queries' (alongside the already-imported `findClientBusinessRelationshipById` — keep that import as-is, it is used by unrelated handlers for the by-id lookup pattern; this task adds the separate by-businessId+phone lookup function next to it).
    2. In `showTodaysAgenda`, immediately after the existing `serviceNamesById` per-booking lookup loop, add the mirrored `clientNamesByPhone` map-building loop, identical in shape to agenda.ts's Task 1.3 above but calling `findClientBusinessRelationship(business.id, booking.clientPhone)`.
    3. Update the `formatAgendaMessage(bookingList, serviceNamesById)` call inside the existing ternary (the `bookingList.length > 0 ? formatAgendaMessage(...) : '...'` expression) to pass `clientNamesByPhone` as the third argument.

    Do not touch listBookingsForDate's statuses-array call sites (already fixed in a prior quick task) or any formatting/wording outside the client-name substitution.
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>formatAgendaMessage's signature has three parameters everywhere it is declared and called in src/; both runAgendaSweep and showTodaysAgenda build a clientNamesByPhone map via findClientBusinessRelationship before calling it; `npx tsc --noEmit` reports zero errors in src/.</done>
</task>

<task type="auto">
  <name>Task 2: Add regression tests for resolved-name display and phone fallback</name>
  <files>tests/calendar-agenda-reminder-queries.test.ts</files>
  <action>
    In tests/calendar-agenda-reminder-queries.test.ts, extend the existing `describe('runAgendaSweep status filter regression (agenda.ts)', ...)` block's `jest.isolateModules` + `jest.doMock` pattern (the one already covering Test 8) with two new tests using the same isolated-module setup style (fresh `jest.doMock('../src/database/queries', ...)` including a `findClientBusinessRelationship: jest.fn()` alongside the existing mocked exports, plus the existing `sendTelegramMessage`/`botTokenStore` mocks from '../src/telegram/client'):

    Test A ("shows resolved client name when a clientBusinessRelationship with clientName exists"): mock `findClientBusinessRelationship` to resolve `{ id: 1, businessId: 1, senderPhone: 'c1', clientName: 'Μαρία Παπαδοπούλου', consentGiven: true, consentTimestamp: new Date(), createdAt: new Date() }` for the booking's clientPhone `'c1'`. After `await isolatedRunAgendaSweep()`, assert the message string passed to the mocked `sendTelegramMessage` (its second argument) contains `'Μαρία Παπαδοπούλου'` and does NOT contain the raw phone `'c1'` as a standalone client-identifying token (region-scope this negative check to the parenthesized client-name segment of the line, not the whole message, since other fields are not phone-shaped in this fixture).

    Test B ("falls back to the raw phone when no clientBusinessRelationship exists"): mock `findClientBusinessRelationship` to resolve `null` for the same booking. After `await isolatedRunAgendaSweep()`, assert the message string passed to `sendTelegramMessage` contains the raw phone `'c1'`.

    Reuse the existing booking/business/service fixture shapes and the 08:00-threshold-satisfying `jest.setSystemTime` anchor already established in that describe block's `beforeEach`.
  </action>
  <verify>
    <automated>npx jest --testPathPattern calendar-agenda-reminder-queries -i</automated>
  </verify>
  <done>Both new tests pass: the resolved-name test proves the agenda message shows the client's name instead of their raw phone/id, and the fallback test proves the message still shows the raw phone when no relationship exists. All pre-existing tests in this file remain green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| n/a | Internal display-formatting change only — reads a field (clientName) the owner already has query access to via existing client-list/deletion/expiry-notification surfaces; no new recipient, no new external input, no new data class exposed across a tenant boundary. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-quick260813ixq-01 | Information Disclosure | formatAgendaMessage's clientNamesByPhone substitution | low | accept | Only surfaces a client's own registered name (already visible to the owner elsewhere, e.g. client-list/deletion menus) on the owner's own business agenda; findClientBusinessRelationship is already scoped by businessId, preserving existing tenant isolation. |
</threat_model>

<verification>
1. `npx tsc --noEmit` passes with zero errors.
2. `npx jest --testPathPattern calendar-agenda-reminder-queries -i` passes, including the two new tests.
3. Manual read-check: both `runAgendaSweep` and `showTodaysAgenda` build a `clientNamesByPhone` map immediately after their existing `serviceNamesById` loop, using the identical `rel?.clientName ?? clientPhone` fallback pattern already established elsewhere in the codebase (e.g. `rel.clientName ?? rel.senderPhone` in admin-menu.ts).
</verification>

<success_criteria>
- Agenda messages from both the 08:00 auto-push and the on-demand /agenda command show a resolved client display name instead of a raw phone/Telegram id.
- Bookings with no matching clientBusinessRelationship (or no clientName set) still render the raw phone — no blank/undefined entries.
- No other formatting, wording, or the previously-fixed statuses-array behavior was altered.
</success_criteria>

<output>
Create `.planning/quick/260813-ixq-fix-agenda-message-to-show-client-name-i/260813-ixq-SUMMARY.md` when done
</output>
