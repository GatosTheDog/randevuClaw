---
phase: quick-260813-jgj
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/telegram/handlers/payment-flow.ts
  - tests/billing-payment-flow.test.ts
autonomous: true
requirements: []

must_haves:
  truths:
    - "The payment client-selection keyboard always includes clients with zero bookings, even when the business has other clients with recent (last-30-days) bookings — not only when the ENTIRE recent-client list is empty."
    - "A client that already appears in the recent-bookings list is never duplicated by the never-booked merge pass."
    - "The existing 'no clients at all' Greek empty-state message still fires only when both the recent list and the all-time list are empty."
  artifacts:
    - "src/telegram/handlers/payment-flow.ts: showClientSelection unconditionally fetches both getRecentClientsForBusiness and getAllClientsForBusiness, then merges/deduplicates by clientBusinessRelationshipId before building the keyboard."
    - "tests/billing-payment-flow.test.ts: a regression test reproducing the exact reported bug (one recent-booking client + one zero-booking client) asserting the zero-booking client's callback_data is present in the resulting keyboard."
  key_links:
    - "showClientSelection -> getRecentClientsForBusiness(businessId, 30) AND getAllClientsForBusiness(businessId) (both always called) -> dedup by clientBusinessRelationshipId -> merged keyboard -> sendTelegramMessageWithKeyboard"
---

<objective>
Fix the payment client-selection list so it always surfaces never-booked clients, not just when the entire business has zero recent bookings. `showClientSelection` in `src/telegram/handlers/payment-flow.ts` currently calls `getAllClientsForBusiness` (the all-time, no-booking-required fallback) only inside the `if (clients.length === 0)` branch — so the moment a business has even one client with a recent booking, every other client who has never booked silently disappears from the "who paid?" keyboard. This plan makes the merge unconditional: always fetch both lists, always include never-booked clients alongside recent-booking clients, deduplicated by `clientBusinessRelationshipId`.

Purpose: An owner recording a payment for a brand-new client (who has consented/registered but not yet booked a session) currently cannot find that client in the payment keyboard at all if any other client has a recent booking — silently blocking a real payment-recording workflow.
Output: `showClientSelection` always merges recent + never-booked clients into one deduplicated keyboard; a regression test locks in the exact reported scenario.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

Query layer — read-only reference, do NOT modify either function's query logic (only the branching/merge logic in payment-flow.ts changes):
@src/billing/queries.ts

Existing test conventions to follow (mocks, beforeEach, assertion style already established in this file):
@tests/billing-payment-flow.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Always merge never-booked clients into showClientSelection's keyboard</name>
  <files>src/telegram/handlers/payment-flow.ts, tests/billing-payment-flow.test.ts</files>
  <behavior>
    - Existing tests in tests/billing-payment-flow.test.ts's `describe('showClientSelection', ...)` block must keep passing unchanged in their assertions once `getAllClientsForBusiness` is always invoked. Since several of those tests only set up `mockGetRecentClients` and never call `mockGetAllClients.mockResolvedValue(...)`, add `mockGetAllClients.mockResolvedValue([])` to the file's top-level `beforeEach` (alongside the existing `jest.clearAllMocks()`) as a safe default so those tests don't need individual changes. Tests that already set their own `mockGetAllClients.mockResolvedValue(...)` value (the empty-state test and the all-time-fallback test) override this default per Jest's mock-resolution order and are unaffected.
    - The pre-existing 'WR-02 fix' test (asserts `isInBusinessContext` mock-return controls whether `withBusinessContext` is opened) must still pass with `isInBusinessContext()` called exactly once per `showClientSelection` invocation — not once per query.
  </behavior>
  <action>
    In src/telegram/handlers/payment-flow.ts's showClientSelection: replace the current `isInBusinessContext() ? getRecentClientsForBusiness(...) : withBusinessContext(...)` single-query branch with one that resolves BOTH getRecentClientsForBusiness(businessId, 30) and getAllClientsForBusiness(businessId) via a single Promise.all, still gated on one isInBusinessContext() check (call it once, store the boolean, use it to decide between running the Promise.all directly or wrapping it in one withBusinessContext call) — this preserves the existing "reuse ambient transaction, never nest a second one" contract (WR-02) while now always fetching both lists regardless of clients.length.

    After both lists resolve, build a Set of clientBusinessRelationshipId values from the recent-clients list, then filter the all-time list down to entries whose id is NOT in that set — these are the never-booked clients. Delete the old `if (clients.length === 0) { ... return; }` fallback branch entirely (including its own isInBusinessContext()/withBusinessContext() re-fetch and its separate fallbackKeyboard construction) — that whole code path is superseded by the unconditional merge.

    Keep the "no clients at all" empty-state guard, but re-express it as: if the recent list is empty AND the never-booked-filtered list is empty, send the existing Greek message 'Δεν υπάρχουν εγγεγραμμένοι πελάτες.' and return — identical message and early-return behavior as today, just reached via a merged emptiness check instead of the old nested branch.

    Build the keyboard in two label passes, concatenated in order (recent clients first, then never-booked clients appended after), so recent-booking clients keep their existing richer label style: `clientName ?? \`${serviceNameFallback} — ${lastBookingDateFormatted}\`` for the recent-clients pass, and `clientName ?? senderPhone` for the never-booked pass (this exactly matches the label style the deleted fallback branch used for all-time clients). Every button's callback_data stays `billing:client:{clientBusinessRelationshipId}` with the same >64-byte logger.warn guard already present on both existing label passes — carry that guard forward unchanged for both passes. Send the single merged keyboard through the existing sendTelegramMessageWithKeyboard call with the unchanged Greek prompt '👤 Ποιος πελάτης έκανε πληρωμή;' — there is now only one send call on the non-empty path (the old code had two near-duplicate send calls, one per branch; collapse to one).

    Do not modify getRecentClientsForBusiness or getAllClientsForBusiness in src/billing/queries.ts — this is a merge/branching fix in payment-flow.ts only.
  </action>
  <verify>
    <automated>npx jest --testPathPattern billing-payment-flow -i</automated>
  </verify>
  <done>All pre-existing tests in tests/billing-payment-flow.test.ts pass unchanged (aside from the added beforeEach default), showClientSelection calls getAllClientsForBusiness on every invocation (not just when recent clients are empty), and never-booked clients are appended after recent clients with no duplicates by clientBusinessRelationshipId.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add regression test reproducing the exact reported bug</name>
  <files>tests/billing-payment-flow.test.ts</files>
  <behavior>
    - New test in the `describe('showClientSelection', ...)` block: business has one client with a recent booking (clientBusinessRelationshipId 101, from getRecentClientsForBusiness) AND one client with zero bookings (clientBusinessRelationshipId 500, present only in getAllClientsForBusiness's result — also include the recent client's id 101 again in the all-time list, mirroring real DB behavior where getAllClientsForBusiness returns every client regardless of booking history).
    - Assert the never-booked client's callback_data ('billing:client:500') IS present in the resulting keyboard — this is the exact behavior that was broken (client.length > 0 skipped the fallback entirely, so id 500 would never have appeared).
    - Assert the recent client's callback_data ('billing:client:101') appears exactly once (not duplicated by the merge).
    - Assert the never-booked client's label falls back to its senderPhone (no clientName in the fixture), matching the label style used by the existing all-time-fallback test.
  </behavior>
  <action>
    Add a new `it(...)` test inside the `describe('showClientSelection', ...)` block in tests/billing-payment-flow.test.ts, placed after the existing 'WR-02 fix' test. Mock mockGetRecentClients.mockResolvedValue with one RecentClient (clientBusinessRelationshipId 101, clientName 'Μαρία', serviceNameFallback and lastBookingDateFormatted any values). Mock mockGetAllClients.mockResolvedValue with two AllTimeClient entries: one matching id 101 (clientName 'Μαρία', any senderPhone) and one new entry id 500 with clientName null and a distinct senderPhone (e.g. '+306900000099'). Call showClientSelection(BUSINESS_ID, OWNER_TELEGRAM_ID), then read the keyboard from mockSendKeyboard.mock.calls[0][2], flatten it, and assert: exactly one button has callback_data 'billing:client:101' (not two), one button has callback_data 'billing:client:500', and that button's text equals the id-500 fixture's senderPhone. Also assert the keyboard has exactly 2 rows total (no other duplication).
  </action>
  <verify>
    <automated>npx jest --testPathPattern billing-payment-flow -i</automated>
  </verify>
  <done>The new regression test passes against Task 1's fixed showClientSelection, and would fail (never-booked client absent, or duplicate id-101 buttons) against the pre-fix code path.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| n/a | Internal, same-tenant read-path merge fix. No new user input, no new external call, no change to RLS scoping or callback_data format — both queries were already RLS-scoped to businessId before this fix. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-quick260813jgj-01 | Information Disclosure | showClientSelection's merged keyboard | low | accept | getAllClientsForBusiness's query (unchanged by this plan) is already scoped to `businessId` via RLS/getConn(); this fix only changes WHEN never-booked clients are shown (always vs. only-if-empty), never WHOSE data becomes reachable. No cross-tenant exposure is introduced. |
| T-quick260813jgj-02 | Tampering | billing:client:{id} callback_data (never-booked pass) | low | accept | The never-booked pass reuses the identical `billing:client:{clientBusinessRelationshipId}` callback_data format and the existing >64-byte logger.warn guard already applied to the recent-clients pass — no new callback_data shape or unguarded path is introduced. |
</threat_model>

<verification>
1. `npx jest --testPathPattern billing-payment-flow -i` passes with all pre-existing tests green plus the new regression test.
2. Manual read-check: `showClientSelection` in `src/telegram/handlers/payment-flow.ts` calls `getAllClientsForBusiness` unconditionally (no longer gated behind `clients.length === 0`), and the old duplicate fallback branch/second sendTelegramMessageWithKeyboard call is gone.
3. `getRecentClientsForBusiness` and `getAllClientsForBusiness` in `src/billing/queries.ts` are byte-for-byte unchanged.
</verification>

<success_criteria>
- A business with any mix of recent-booking and never-booked clients sees ALL of them in the payment client-selection keyboard, deduplicated by clientBusinessRelationshipId.
- The "no clients at all" empty-state message still fires only when both underlying lists are truly empty.
- No changes to billing/enforcement.ts, createMembership, or any balance/notification logic.
</success_criteria>

<output>
Create `.planning/quick/260813-jgj-fix-payment-client-selection-list-to-alw/260813-jgj-SUMMARY.md` when done
</output>
