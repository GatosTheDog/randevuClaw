---
phase: quick-261008-gqb
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/session/rebook.ts
  - src/database/queries.ts
  - tests/session-rebook.test.ts
  - src/conversation/function-executor.ts
  - tests/session-rebook-tool.test.ts
  - src/conversation/ai-agent.ts
  - tests/ai-agent.test.ts
autonomous: true
requirements: []

must_haves:
  truths:
    - "A client chatting in free text with a fixed_sessions business can ask to repeat last month's classes and the bot lists, deterministically, every weekly slot (Greek weekday name + time + class) the client held as a confirmed booking in the previous calendar month, then explicitly asks in Greek whether to book ALL of them again or keep some and change others -- nothing is booked before the client answers."
    - "Answering 'all the same' results in one book_session multi-booking call using server-supplied session_instance_ids; answering 'keep some, change some' results in one book_session call whose id list is the kept slots' instances plus the instances of the replacement weekly slots -- the AI never computes a weekday or a date itself, because every slot and alternative is returned with a server-computed Greek weekday_name and ready-made instance_ids."
    - "Rebooking never double-books and never overdraws credits: instances the client already holds (pending or confirmed), full instances, and instances beyond the active membership's expiry date are reported as unavailable instead of offered, and a bulk booking stops at the membership's remaining session credits (extra ids come back in insufficient_credit_instance_ids) so the credit counter and ledger stay consistent."
    - "The feature only operates for fixed_sessions businesses that have allowMultiBooking enabled (the owner's existing 'Πολλαπλές κρατήσεις' setting is honored, not bypassed); every other business gets a clear structured error and the system prompt never advertises the capability to them."
    - "The client identity and tenant always come from ToolContext / the dispatcher's cross-tenant check, never from model-supplied arguments, so one client can never read another client's booking history."
  artifacts:
    - "src/session/rebook.ts: pure (no DB, no Telegram) helpers -- previousMonthRange, deriveWeeklySlots, weeklySlotKey, groupUpcomingByWeeklySlot, buildRebookProposal, formatWeeklySlotLine, GREEK_WEEKDAY_NAMES."
    - "src/database/queries.ts: new listClientConfirmedSessionBookingsInRange(businessId, clientPhone, startDate, endDate) -- confirmed, session-instance bookings of one client in an inclusive date range."
    - "src/conversation/function-executor.ts: new list_previous_month_slots tool case + listPreviousMonthSlotsTool; the multi-booking loop of bookSessionTool extracted into a shared bookSessionInstancesInOrder helper that de-duplicates ids, processes them chronologically, and stops at remaining credits."
    - "src/conversation/ai-agent.ts: list_previous_month_slots declared in BOOKING_TOOLS; three new Greek system-prompt rules emitted only when bookingMode is fixed_sessions AND allowMultiBooking is true."
    - "tests/session-rebook.test.ts (pure unit tests), tests/session-rebook-tool.test.ts (integration against local Postgres, same harness as tests/session-booking-flow.test.ts), additions to tests/ai-agent.test.ts."
  key_links:
    - "Client free text -> aiBookingAgent -> Gemini calls list_previous_month_slots -> listPreviousMonthSlotsTool -> listClientConfirmedSessionBookingsInRange + listSessions(30 days, excludePastToday) + listClientBookings + getClientActiveMembership -> rebook.ts pure helpers -> JSON (previous_slots, other_weekly_slots, summary_lines, suggested_question) back to Gemini -> Gemini asks the all-or-customise question -> client answers -> Gemini calls book_session{session_instance_ids} -> bookSessionInstancesInOrder -> bookSessionInstance (unchanged capacity lock + credit deduction + pending_owner_approval) -> per-booking owner Έγκριση/Απόρριψη keyboard (unchanged)."
---

<objective>
Let a returning client rebook "last month's slots" with one short chat exchange. After a membership period the client types something like "θέλω τα ίδια μαθήματα με τον προηγούμενο μήνα" (or just asks to book for the coming month); the bot looks up the classes the client actually held (confirmed bookings) during the previous calendar month, groups them into weekly slots (e.g. "Δευτέρα 18:00 — Reformer Pilates, 4 φορές"), maps each onto the real upcoming session instances, and asks in Greek: book all of them again, or keep some the same and change others? The client's answer drives a single multi-booking call.

Purpose: removes the monthly friction of re-selecting every class one by one, while keeping all existing safeguards (owner approval, capacity lock, membership credit deduction, enforcement policy) exactly as they are.

Output: a pure rebook module + one DB query, one new read-only AI tool (`list_previous_month_slots`) that does all the date/weekday arithmetic server-side, a credit-safe extraction of the existing multi-booking loop (booking itself reuses the existing `book_session` tool -- no second booking code path), the agent tool declaration + Greek prompt rules, and three test files.

Design choices made by the planner (no CONTEXT.md exists for this quick task, so nothing here overrides a locked user decision):
- "Previous month" = the previous calendar month in Europe/Athens (e.g. on 2026-10-08 it is 2026-09-01..2026-09-30). A "slot" is a (weekday, time, service) triple derived from the client's CONFIRMED session bookings in that range.
- The proposal window is the same ~30-day browse window the client menu already uses (`listSessions(businessId, 30, true)`), further capped at the active membership's expiry date -- mirroring `showBookDateList` in src/telegram/handlers/client-menu.ts.
- Scope is fixed_sessions (class) businesses only; open_slots free-time appointments have no recurring-class semantics and are untouched.
- The owner's existing `allowMultiBooking` setting gates the feature (a monthly rebook is inherently a multi-booking); no new setting, migration or schema change.
- "Change" is expressed through the tool result, not through new mutating tools: the result also lists `other_weekly_slots` (other weekday/time/class combinations that exist in the window, each with ready instance ids and a server-computed Greek weekday name), so the model composes the final id list itself without date arithmetic.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./.claude/CLAUDE.md

**Findings from codebase investigation (all verified by reading the files; do not re-derive):**

**Client conversation path.** Free-text client messages go routeConversationMessage -> `aiBookingAgent` (src/conversation/ai-agent.ts, 540 lines): a Gemini `ai.interactions.create` loop (max 6 tool rounds, stored `previous_interaction_id` keeps multi-turn state, so "ask, wait for the answer, then book" works across messages). Tools are declared in the static `BOOKING_TOOLS` array; `buildSystemInstruction` appends a `sessionRules` block when `business.bookingMode === 'fixed_sessions'` and an extra multi-booking line when `business.allowMultiBooking`. Each call is executed by `executeTool` (src/conversation/function-executor.ts, 872 lines) with a `ToolContext` carrying `business` (id, name, ownerTelegramId, enforcementPolicy, bookingMode, allowMultiBooking, ...), `clientPhone` (the Telegram from.id -- NEVER model-supplied) and a per-call `idempotencyKey`. `executeTool` already denies any `business_id` arg that differs from the context business (cross_tenant_denied).
@src/conversation/ai-agent.ts
@src/conversation/function-executor.ts

**Existing booking primitives to reuse unchanged.** `listSessions(businessId, limitDays, excludePastToday)` and `bookSessionInstance(...)` (src/session/manager.ts) -- `SessionInstance` = {instanceId, catalogId, sessionDate, sessionTime, bookedCount, capacity, serviceId}; `bookSessionInstance` takes the SELECT FOR UPDATE capacity lock, creates the booking as `pending_owner_approval`, and deducts one credit via `deductSession` when handed a finite membership. `deductSession` (src/billing/queries.ts ~line 674) inserts the ledger row first and only decrements the counter `WHERE sessions_remaining > 0` -- so an over-requested bulk booking would write ledger rows beyond the real balance; the bulk helper in Task 2 must prevent that. `checkEnforcementAndGetMembership` (src/billing/enforcement.ts) returns {allowed, membership: ActiveMembershipForDeduction|null}; it must run inside the caller's transaction (it does SELECT FOR UPDATE on the memberships row). `getClientActiveMembership(businessId, clientPhone)` (non-locking) returns {packageName, sessionsRemaining|null, expiresAt, isUnlimited} for an active, unexpired membership. `listClientBookings(businessId, clientPhone)` returns the client's pending_owner_approval + confirmed bookings (Booking has `sessionInstanceId: number | null`). Booking statuses are pending_owner_approval | confirmed | cancelled | rejected | expired -- there is no "completed" status, so "held last month" == status `confirmed`.
@src/session/manager.ts
@src/billing/enforcement.ts

**Existing multi-booking path** (`bookSessionTool`, function-executor.ts lines ~577-658): gated by `context.business.allowMultiBooking` (error `multi_booking_disabled`), single `checkEnforcementAndGetMembership` call, `listSessions(..., 90, true)`, then a sequential for-loop calling `bookSessionInstance(businessId, instanceId, clientPhone, session.serviceId, idempotencyKey + ':' + instanceId, enfResult.membership)` and, per booked instance, sending the owner an Έγκριση/Απόρριψη keyboard (`sbk:approve:<bookingId>` / `sbk:reject:<bookingId>`) and storing the Telegram message id via `updateBookingOwnerMessageId`, all best-effort in try/catch. Returns {success, booked_instance_ids, full_instance_ids, conflict_instance_ids, booked_count}. Existing tests for it: tests/session-booking-flow.test.ts "SBOK-04" (3 tests).

**Date helpers** (src/utils/timezone.ts): `isoDateInAthens(date)`, `weekdayOfIsoDate(iso)` (0=Sunday..6=Saturday, DST-safe noon-UTC anchor), `addCalendarDays(iso, n)`, `formatExpiryDateGreek(date)` (DD/MM/YYYY), `hoursUntilSession`. Use these; add no date library. The server runs UTC, so never use the host-local timezone for "today".
@src/utils/timezone.ts

**Weekday hallucination precedent:** quick-260908-dxa exists specifically because the LLM computes wrong weekdays from dates. This plan follows the same principle: the server returns `weekday_name` (Greek) next to every date and the prompt forbids the model from deriving weekdays.

**Test conventions to follow exactly.** Integration tests run against a real local Postgres (`postgresql://manolis@localhost:5432/randevuclaw_test`, already running): set `process.env.DATABASE_URL` before `jest.resetModules()` then `require` db/schema/function-executor, build a ToolContext with a local `buildToolContext`, call `executeTool(...)`, create data with tests/helpers (`insertTestBusiness`, `insertTestPackage`/`insertTestMembership`, `insertTestSessionCatalog`/`insertTestSessionInstance`/`insertTestSessionBooking`). Pure unit tests need no DB. `tests/ai-agent.test.ts` mocks `@google/genai` and inspects `mockCreate.mock.calls[0][0].system_instruction` / `.tools`.
@tests/session-booking-flow.test.ts
@tests/helpers/session-fixtures.ts
@tests/helpers/billing-fixtures.ts
@tests/helpers/test-business.ts
@tests/ai-agent.test.ts

**Known hazards the executor must respect:**
1. `unique_active_slot_per_business` (partial unique index on business_id + calendar_date + calendar_time for pending/confirmed bookings) exists in the test DB: two ACTIVE bookings for the same business at the same date+time collide on direct inserts. Seed different clients' rows on different dates/times, and give each integration test its own fresh `insertTestBusiness()` (also avoids `unique_session_instance` and `unique_active_catalog_per_business_service` collisions).
2. tests/session-booking-flow.test.ts has ONE pre-existing, documented failure ("SBOK-04 ... multi-booking partial success", caused by a duplicate active catalog for the same business+service inside that test; see .planning/STATE.md blockers). It is not caused by this work and must not be "fixed" here; new tests must not reuse that pattern (create a "full" instance by setting bookedCount === capacity in the SAME catalog).
3. `npx tsc --noEmit` has two pre-existing errors in src/invites/generator.ts (missing `qrcode` / `sharp` modules in node_modules). Gate on the files this plan touches, not on a clean tsc exit code.
4. Do not add npm dependencies.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pure rebook module (previous-month range, weekly-slot derivation, upcoming-instance matching) + client booking-history query</name>
  <files>src/session/rebook.ts, src/database/queries.ts, tests/session-rebook.test.ts</files>
  <behavior>
    Write tests/session-rebook.test.ts FIRST (pure unit tests, no database, no mocks; `import` directly from src/session/rebook.ts), watch them fail, then implement. Cases:
    - previousMonthRange('2026-10-08') -> {start:'2026-09-01', end:'2026-09-30', monthLabel:'2026-09'}; previousMonthRange('2026-01-15') -> December of the prior year (start '2025-12-01', end '2025-12-31'); previousMonthRange('2026-03-01') -> end '2026-02-28'; previousMonthRange('2028-03-05') -> end '2028-02-29' (leap year); previousMonthRange on the 1st and on the 31st of a month behaves the same as mid-month.
    - deriveWeeklySlots: rows = Monday 2026-09-07 18:00 svc 3, Monday 2026-09-14 18:00 svc 3, Wednesday 2026-09-09 19:00 svc 3, Monday 2026-09-21 18:00 svc 4 -> three slots; Monday 18:00 svc 3 has previousCount 2; Monday 18:00 svc 4 has previousCount 1 (same weekday+time, different service is a different slot); output order is Monday-first (Mon..Sat, then Sunday), then time, then serviceId; empty input -> []. weekday uses the 0=Sunday convention of weekdayOfIsoDate.
    - weeklySlotKey is stable and distinct per (weekday, time, serviceId).
    - groupUpcomingByWeeklySlot: given a SessionInstance list with open, full (bookedCount >= capacity), client-held (id in heldInstanceIds) and post-expiry (sessionDate > membershipExpiryDate) instances of the same weekly slot -> open ones appear in `instances` with spotsLeft = capacity - bookedCount, in input (chronological) order; the others appear in `unavailable` with reason 'full' | 'already_booked' | 'after_membership_expiry' (precedence: already_booked, then after_membership_expiry, then full); membershipExpiryDate null disables the expiry cap.
    - buildRebookProposal: previous slots map to their group's instances/unavailable (a previous slot with no upcoming instance still appears, with empty arrays); `other` contains only weekly slots NOT among the previous slots and having at least one bookable instance, ordered Monday-first then time then serviceId.
    - formatWeeklySlotLine({weekday:1,time:'18:00',serviceId:3}, 'Reformer Pilates') -> 'Δευτέρα 18:00 — Reformer Pilates'; GREEK_WEEKDAY_NAMES is indexed 0=Κυριακή..6=Σάββατο.
  </behavior>
  <action>
    Create src/session/rebook.ts as a dependency-light module: import only `weekdayOfIsoDate` and `addCalendarDays` from '../utils/timezone' and a TYPE-ONLY `SessionInstance` from './manager' (use `import type` so the DB-backed manager module is never loaded by the unit tests). No database, Telegram, config or clock access anywhere in this file -- callers pass today's ISO date in.

    Export these (names and semantics are the contract Task 2 consumes):
    - `GREEK_WEEKDAY_NAMES`: seven Greek names indexed exactly like weekdayOfIsoDate (0 = Κυριακή ... 6 = Σάββατο).
    - `WeeklySlot` {weekday, time, serviceId}, `PreviousWeeklySlot` (WeeklySlot plus previousCount), `SlotInstanceView` {instanceId, sessionDate, sessionTime, spotsLeft}, `SlotUnavailableView` {sessionDate, sessionTime, reason: 'full' | 'already_booked' | 'after_membership_expiry'}, `UpcomingSlotGroup` (WeeklySlot plus instances and unavailable arrays), `RebookProposal` {previous: previous slots each carrying instances + unavailable, other: UpcomingSlotGroup[]}.
    - `previousMonthRange(todayIso)` -> {start, end, monthLabel 'YYYY-MM'}: first day of the current month from the first 8 characters of todayIso + '01', end = addCalendarDays(thatFirstDay, -1), start = first day of end's month. Do not use host-local Date arithmetic; addCalendarDays already handles month/year rollover and leap years.
    - `weeklySlotKey(slot)` -> a string combining weekday, time and serviceId with a separator that cannot occur in any of them.
    - `deriveWeeklySlots(rows)` for rows of {calendarDate, calendarTime, serviceId}: weekday via weekdayOfIsoDate(calendarDate), group by weeklySlotKey, count occurrences into previousCount, sort Monday-first ((weekday + 6) % 7), then time ascending, then serviceId.
    - `groupUpcomingByWeeklySlot(upcoming, heldInstanceIds, membershipExpiryDate)` -> Map keyed by weeklySlotKey, preserving the input order of `upcoming` inside each group, classifying each instance per the behavior list above.
    - `buildRebookProposal(previousSlots, grouped)` per the behavior list above.
    - `formatWeeklySlotLine(slot, serviceName)` producing "<Greek weekday> <HH:MM> — <service name>" with an em dash.

    In src/database/queries.ts add `listClientConfirmedSessionBookingsInRange(businessId, clientPhone, startDate, endDate): Promise<Booking[]>` next to `listClientBookings`, using `getConn()` (so it respects RLS inside withBusinessContext, like its neighbours). Filter: businessId, clientPhone, bookingStatus = 'confirmed' ONLY, sessionInstanceId IS NOT NULL, calendarDate >= startDate AND <= endDate (inclusive, string comparison is correct for ISO dates), ordered by calendarDate then calendarTime. Imports `gte`, `isNotNull`, `and`, `eq` are already present in that file; add `lte` to the drizzle-orm import list if you use it. This function is exercised by the Task 2 integration tests (scoping, status and range-boundary behavior), so it needs no DB test in this task.
  </action>
  <verify>
    <automated>npx jest tests/session-rebook.test.ts --testTimeout=20000 && (! npx tsc --noEmit 2>&1 | grep -E "src/session/|src/database/queries|tests/session-rebook")</automated>
  </verify>
  <done>src/session/rebook.ts exports the listed pure helpers and every behavior case in tests/session-rebook.test.ts passes (including the month-rollover, leap-year and unavailable-reason-precedence cases); listClientConfirmedSessionBookingsInRange exists in src/database/queries.ts; tsc reports no errors in the touched files.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: list_previous_month_slots tool + credit-safe shared multi-booking helper</name>
  <files>src/conversation/function-executor.ts, tests/session-rebook-tool.test.ts</files>
  <behavior>
    New file tests/session-rebook-tool.test.ts, integration style identical to tests/session-booking-flow.test.ts (DATABASE_URL override + jest.resetModules + require, local buildToolContext with ownerTelegramId null so no Telegram traffic, unique client phone per test, a fresh insertTestBusiness per test via a small scenario-setup helper). The setup helper enables allowMultiBooking on the business row, creates one active catalog (capacity 10), seeds previous-month data computed from `previousMonthRange(isoDateInAthens(new Date()))` so the tests pass on any run date: for the test client, CONFIRMED session bookings on two different previous-month Mondays at 18:00 and one previous-month Wednesday at 19:00 (each with its own past session instance and `insertTestSessionBooking(..., {bookingStatus:'confirmed', calendarDate, calendarTime})`), plus upcoming session instances (tomorrow or later, within 28 days) for the next two Mondays 18:00, the next two Wednesdays 19:00 and one Thursday 20:00. Cases:
    1. list_previous_month_slots returns success with has_previous_slots true and exactly two previous_slots: Monday 18:00 (previous_month_count 2, weekday_name 'Δευτέρα', two upcoming_instances whose instance_ids match the seeded Monday instances in date order) and Wednesday 19:00 (count 1, weekday_name 'Τετάρτη'); other_weekly_slots contains the Thursday 20:00 slot (weekday_name 'Πέμπτη') and does not contain Monday/Wednesday; summary_lines has one Greek line per previous slot starting with the weekday name; suggested_question is a non-empty string; every returned session_date's weekday matches its slot's weekday_name.
    2. History filtering: a CANCELLED and a PENDING previous-month booking (on other dates/times), another client's confirmed previous-month booking (different date/time), a confirmed booking dated the last day of the month BEFORE the previous month, and one dated the 1st of the CURRENT month are all ignored -- the response is identical to case 1; a client with no qualifying history gets success true, has_previous_slots false and a Greek message.
    3. Unavailable handling: an upcoming Monday instance already held by the client (pending booking) shows in that slot's `unavailable` with reason 'already_booked' and is absent from upcoming_instances; a full instance (bookedCount equal to capacity, same catalog) shows 'full'; with a membership whose expiresAt falls between the two upcoming Mondays, the later Monday shows 'after_membership_expiry'.
    4. Gating: allowMultiBooking false in the context -> {success:false, error:'multi_booking_disabled'}; bookingMode 'open_slots' -> {success:false, error:'not_fixed_sessions'}; enforcementPolicy 'block' with no membership -> {success:false, error:'no_membership'}; a business_id different from the context business -> {error:'cross_tenant_denied'} from the dispatcher.
    5. Membership reporting: with a finite membership (sessionsRemaining 2) the result has membership.sessions_remaining 2, max_bookable 2 and exceeds_credits true when the total proposed instances exceed 2; with an unlimited membership (sessionsRemaining null) max_bookable is null and exceeds_credits false.
    6. End to end: feeding the previous_slots' upcoming_instance ids into executeTool('book_session', {business_id, session_instance_ids}) books them all (booked_count equals the id count, bookings exist as pending_owner_approval, membership counter decremented once per booking); calling list_previous_month_slots again afterwards reports those instances as 'already_booked'.
    7. Credit cap: membership sessionsRemaining 2 and a book_session call with 3 instance ids -> booked_count 2, the chronologically LAST id is returned in insufficient_credit_instance_ids, sessionsRemaining ends at 0, and exactly 2 session_deducted ledger rows exist for the membership.
    8. Duplicate ids in session_instance_ids are booked once (booked_count counts distinct ids).
    9. Regression: the existing SBOK-04 cases "multi-booking: books two sessions sequentially, decrements counter twice" and "multi-booking disabled" in tests/session-booking-flow.test.ts still pass unchanged.
  </behavior>
  <action>
    Edit src/conversation/function-executor.ts (it stays the single home of all client tools; rebook.ts is imported by it, never the reverse, to avoid a circular import).

    1. Imports: add `listClientConfirmedSessionBookingsInRange` to the existing '../database/queries' import; import `type SessionInstance` alongside the existing '../session/manager' import; import `type ActiveMembershipForDeduction` from '../billing/queries'; import `previousMonthRange, deriveWeeklySlots, groupUpcomingByWeeklySlot, buildRebookProposal, formatWeeklySlotLine, GREEK_WEEKDAY_NAMES` from '../session/rebook'. `isoDateInAthens`, `formatExpiryDateGreek`, `listSessions`, `listClientBookings`, `getClientActiveMembership`, `findServiceById` are already imported.

    2. Add a zod schema `ListPreviousMonthSlotsArgsSchema` ({business_id: integer}) in the schema block and a `case 'list_previous_month_slots'` in executeTool's switch that calls a new `listPreviousMonthSlotsTool(args, context)`.

    3. Extract the multi-booking loop of `bookSessionTool` into a private helper `bookSessionInstancesInOrder(context, instanceIds, sessions, membership)` returning {booked, full, conflict, insufficientCredit} (arrays of instance ids). Required behavior: (a) de-duplicate the incoming ids first (a repeated id must not be counted twice); (b) ids not present in `sessions` go to `conflict`; (c) the remaining ids are processed in chronological order (sessionDate, then sessionTime) regardless of the order supplied, strictly sequentially (never Promise.all -- capacity race guard T-11-07); (d) when `membership` is non-null with a finite sessionsRemaining, track a local creditsLeft starting at that value: once it is 0, remaining ids go to `insufficientCredit` and are NOT attempted (bulk booking must not create ledger rows beyond the real balance; unlimited/null membership has no cap), and decrement creditsLeft after each `status === 'success'`; (e) each attempt uses `bookSessionInstance(context.business.id, instanceId, context.clientPhone, session.serviceId, context.idempotencyKey + ':' + instanceId, membership)` exactly as today; (f) per booked instance keep the existing best-effort owner notification verbatim (same text shape 'Νέα κράτηση αναμονής <date> <time> — πελάτης: <clientPhone>', same `sbk:approve:` / `sbk:reject:` callback data, `updateBookingOwnerMessageId`), wrapped in try/catch so a Telegram failure never fails the booking. Then make the multi-booking branch of `bookSessionTool` call this helper (keeping the allowMultiBooking gate, the single enforcement check and the `listSessions(..., 90, true)` call where they are) and return the existing keys {success, booked_instance_ids, full_instance_ids, conflict_instance_ids, booked_count} PLUS a new `insufficient_credit_instance_ids`. Leave the single-booking branch untouched.

    4. Implement `listPreviousMonthSlotsTool` (read-only, never mutates, never sends Telegram messages), in this order:
       - Parse args with the new schema.
       - If `context.business.bookingMode !== 'fixed_sessions'` return {success:false, error:'not_fixed_sessions', message: Greek explanation}. If `!context.business.allowMultiBooking` return {success:false, error:'multi_booking_disabled', message: Greek text saying the business does not allow booking several classes at once and the client can book classes one by one}.
       - Read the active membership with the non-locking `getClientActiveMembership(context.business.id, context.clientPhone)`. hasCapacity = membership present and (sessionsRemaining null or > 0). If `!hasCapacity && context.business.enforcementPolicy === 'block'` return {success:false, error:'no_membership', message} using the same Greek wording as bookSessionTool's no-membership message.
       - todayIso = isoDateInAthens(new Date()); range = previousMonthRange(todayIso); fetch `listClientConfirmedSessionBookingsInRange(context.business.id, context.clientPhone, range.start, range.end)` -- the client phone comes ONLY from the ToolContext. If there are none, return {success:true, has_previous_slots:false, previous_month: range.monthLabel, message: Greek "no class bookings found last month, offer list_sessions_for_client instead"}.
       - previousSlots = deriveWeeklySlots(rows); upcoming = listSessions(context.business.id, 30, true); held = Set of non-null sessionInstanceId from `listClientBookings`; membershipExpiryDate = membership ? isoDateInAthens(membership.expiresAt) : null; grouped = groupUpcomingByWeeklySlot(upcoming, held, membershipExpiryDate); proposal = buildRebookProposal(previousSlots, grouped).
       - Resolve service names with `findServiceById(context.business.id, serviceId)` once per distinct serviceId (fallback label '(άγνωστη υπηρεσία)'), exactly like client-menu.ts does.
       - Return {success:true, has_previous_slots:true, previous_month, previous_slots: [...], other_weekly_slots: [...], summary_lines, suggested_question, membership, max_bookable, total_proposed_sessions, exceeds_credits}. Each slot object: weekday (number), weekday_name (GREEK_WEEKDAY_NAMES), time, service_id, service_name, upcoming_instances [{instance_id, session_date, session_time, spots_left}], unavailable [{session_date, session_time, reason}], and previous_month_count for previous slots only. Cap other_weekly_slots at 20 entries to bound the payload. summary_lines: one Greek line per previous slot built from formatWeeklySlotLine plus the previous count ("1 φορά"/"N φορές" τον προηγούμενο μήνα) and the number of bookable upcoming instances. suggested_question: a fixed Greek sentence asking whether to book ALL of these again for the coming period or keep some the same and change others. membership: null, or {package_name, sessions_remaining (number|null), valid_until (formatExpiryDateGreek)}. max_bookable: the finite sessionsRemaining when > 0, otherwise null. total_proposed_sessions: sum of upcoming_instances across previous slots. exceeds_credits: max_bookable !== null && total_proposed_sessions > max_bookable.
       - All user-visible Greek strings live in this function; the AI only paraphrases them.
  </action>
  <verify>
    <automated>npx jest tests/session-rebook-tool.test.ts --testTimeout=30000 && npx jest tests/session-booking-flow.test.ts -t "multi-booking: books two sessions|multi-booking disabled|UX-01" --testTimeout=30000 && (! npx tsc --noEmit 2>&1 | grep -E "src/session/|src/conversation/|src/database/queries|tests/session-rebook")</automated>
  </verify>
  <done>executeTool('list_previous_month_slots') returns the deterministic proposal described above for the calling client only; gating errors fire for non-fixed_sessions, multi-booking-disabled, block-without-membership and cross-tenant cases; book_session's multi path dedupes ids, books chronologically, never exceeds remaining credits (extra ids reported in insufficient_credit_instance_ids), and the pre-existing SBOK-04 and UX-01 cases still pass; all 9 behavior cases in tests/session-rebook-tool.test.ts pass; tsc reports no errors in touched files.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Declare the tool to Gemini and teach the agent the Greek "repeat all or customise" conversation</name>
  <files>src/conversation/ai-agent.ts, tests/ai-agent.test.ts</files>
  <behavior>
    Append to tests/ai-agent.test.ts (inside the existing `describe('aiBookingAgent', ...)`, reusing its mocks, `BUSINESS` fixture and `mockCreate` capture; do not modify existing tests):
    - Every Gemini call's `tools` array includes a declaration named 'list_previous_month_slots' whose parameters require business_id.
    - For a business spread from BUSINESS with bookingMode 'fixed_sessions' and allowMultiBooking true, the system_instruction contains 'list_previous_month_slots', contains the instruction not to call book_session before the client answers (assert on the stable substring 'book_session πριν απαντήσει'), and mentions weekday_name as the only allowed source of weekdays.
    - For bookingMode 'fixed_sessions' with allowMultiBooking false, and for bookingMode 'open_slots' (the default BUSINESS), the system_instruction does NOT contain 'list_previous_month_slots'.
  </behavior>
  <action>
    Edit src/conversation/ai-agent.ts:

    1. Add a new entry to the `BOOKING_TOOLS` array (after reschedule_session) of the same `{type:'function', name, description, parameters}` shape: name `list_previous_month_slots`, a Greek description saying it returns the classes the client held (confirmed) last calendar month grouped as weekly slots, with the matching upcoming session instances and alternatives, and that it must be called BEFORE offering to repeat last month's schedule; parameters: `business_id` (integer, "Το αναγνωριστικό της επιχείρησης"), required ['business_id']. The client phone is never a parameter (same spoofing rule documented above BOOKING_TOOLS).

    2. Extend the `book_session` tool description (text only, schema unchanged) to say the instance ids may also come from list_previous_month_slots, and that when the result contains `insufficient_credit_instance_ids` the agent must tell the client those classes were not booked because the subscription's remaining sessions are not enough.

    3. In `buildSystemInstruction`, inside the existing `business.bookingMode === 'fixed_sessions'` branch and ONLY when `business.allowMultiBooking` is true (extend the existing spread conditional that already adds the multi-booking line), add three Greek rules (use these meanings and keep the quoted tool/field names byte-exact):
       - When the client asks to rebook/repeat last month's classes (e.g. "τα ίδια με τον προηγούμενο μήνα", "ανανέωση προγράμματος") OR wants to book classes for the coming month and has no upcoming bookings, call list_previous_month_slots FIRST.
       - If it returns previous_slots, present the summary_lines and ASK explicitly (using suggested_question) whether to book ALL of them again or keep some the same and change others; do NOT call book_session before the client answers ("book_session πριν απαντήσει" must appear verbatim in this rule).
       - For "all the same": call book_session with session_instance_ids = the instance_id values of every previous slot's upcoming_instances. For changes: keep the upcoming_instances of the slots that stay, add the instance_ids of the replacement slots taken from other_weekly_slots, and NEVER compute a weekday from a date yourself -- use only the weekday_name field. If exceeds_credits is true, tell the client their subscription covers max_bookable classes and ask which to prioritise before booking.
       Existing rules (including the "never say confirmed, only pending owner approval" rule) stay untouched and apply to the final reply.
  </action>
  <verify>
    <automated>npx jest tests/ai-agent.test.ts --testTimeout=20000 && (! npx tsc --noEmit 2>&1 | grep -E "src/conversation/ai-agent|tests/ai-agent")</automated>
  </verify>
  <done>BOOKING_TOOLS declares list_previous_month_slots; the Greek rules appear in the system prompt only for fixed_sessions businesses with allowMultiBooking enabled; all pre-existing ai-agent tests and the new ones pass; tsc reports no errors in the touched files.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Telegram client -> Gemini -> executeTool | Model-chosen tool arguments (business_id, session_instance_ids) are untrusted; the model can be prompt-injected by the client's own text |
| executeTool -> database | Reads one client's booking history and the business's session catalog; writes bookings and credit ledger rows via the existing booking path |
| Bot -> business owner chat | Each rebooked class sends the owner an approval keyboard |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-gqb-01 | Information Disclosure | list_previous_month_slots reading booking history | high | mitigate | clientPhone is taken only from ToolContext (never a tool arg); the dispatcher's cross_tenant_denied check runs before the tool; listClientConfirmedSessionBookingsInRange filters by both businessId and clientPhone; the integration test seeds another client's history and asserts it never appears |
| T-gqb-02 | Tampering / Elevation of Privilege | model supplies arbitrary or foreign session_instance_ids to book_session | high | mitigate | Unchanged existing controls: ids are matched against listSessions(businessId) before booking and bookSessionInstance re-checks the catalog->business ownership subquery under SELECT FOR UPDATE; unknown ids land in conflict_instance_ids |
| T-gqb-03 | Tampering | bulk booking drives membership credits below the real balance / ledger drift | medium | mitigate | bookSessionInstancesInOrder stops at remaining credits and reports insufficient_credit_instance_ids; covered by the credit-cap integration test |
| T-gqb-04 | Tampering | duplicate or repeated ids in one call double-book the same class | medium | mitigate | ids de-duplicated before booking; per-instance idempotency key (call key + instance id) preserved; test covers duplicates |
| T-gqb-05 | Denial of Service | one client's monthly rebook floods the owner with many approval messages, and all pending rows share the 2-hour expiry | low | accept | Same per-booking approval behaviour the existing multi-booking path already has, gated by the owner's allowMultiBooking switch; a batch approve/reject UX is a possible later improvement and is not part of this task |
| T-gqb-06 | Repudiation | bulk booking lacks per-class trace | low | accept | Each booking is still a normal bookings row with its own idempotency key and ledger entry; no new audit surface needed |
| T-gqb-07 | Information Disclosure | GDPR: feature reads personal booking history | low | accept | Only the requesting client's own data, from existing tables, returned to that same client's chat; no new storage or retention |
</threat_model>

<verification>
Run after all three tasks:
1. `npx jest tests/session-rebook.test.ts tests/session-rebook-tool.test.ts tests/ai-agent.test.ts --testTimeout=30000` -- all pass.
2. `npx jest tests/session-booking-flow.test.ts tests/book-session-deadlock.test.ts tests/session-booking-ambient-lock.test.ts tests/function-executor-calendar.test.ts tests/webhooks/client-menu.test.ts --testTimeout=30000` -- the only acceptable failure is the single pre-existing "SBOK-04 ... multi-booking partial success" test documented in .planning/STATE.md; compare against a `git stash` baseline if in doubt.
3. `npx tsc --noEmit 2>&1 | grep -E "src/session/|src/conversation/|src/database/queries|tests/session-rebook|tests/ai-agent"` -- prints nothing (the unrelated pre-existing qrcode/sharp errors in src/invites/generator.ts are expected).
4. Manual smoke (optional, needs a real bot): on a fixed_sessions business with allowMultiBooking on and a client who has confirmed classes last month, send "θέλω τα ίδια μαθήματα με τον προηγούμενο μήνα" and confirm the bot lists the weekly slots, asks the all-or-customise question, and books nothing until answered.
</verification>

<success_criteria>
- A client with confirmed class bookings last month is shown their weekly slots (server-computed Greek weekday names, times, classes) and asked in Greek whether to rebook all or keep some and change others; no booking happens before they answer.
- "All the same" and "keep some, change some" both complete through the existing book_session multi-booking path, creating pending_owner_approval bookings with the usual owner approval keyboards.
- No double bookings, no full/past/over-expiry offers, no credit overdraw; other clients' history is never exposed; non-fixed_sessions or multi-booking-disabled businesses are unaffected and never see the new prompt rules.
- All new tests pass and no previously-passing test regresses.
</success_criteria>

<output>
Create `.planning/quick/261008-gqb-rebook-previous-month-slots-flow-for-cli/261008-gqb-SUMMARY.md` when done
</output>
