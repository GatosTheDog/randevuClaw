---
phase: quick-260908-dxa
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/conversation/greek-preprocessor.ts
  - tests/greek-preprocessor.test.ts
  - src/onboarding/ai-owner-agent.ts
  - tests/ai-owner-view-schedule-for-date.test.ts
autonomous: true
requirements: []

must_haves:
  truths:
    - "The owner can ask about any date (explicit DD/MM, Greek weekday name, or a relative-day word) via free text, and the AI agent never computes the weekday or date itself — a new deterministic server-side tool resolves it."
    - "When date resolution succeeds, the tool's result to Gemini explicitly states the resolved date's correct Greek weekday name alongside the DD/MM/YYYY date, so Gemini has no room to restate a different weekday when composing its reply."
    - "When no date can be resolved from the owner's free text, the tool reports failure clearly (not silently guessing) so Gemini asks the owner to clarify, e.g. by giving an explicit DD/MM."
    - "view_todays_schedule's existing behavior for 'today' queries, and resolveGreekTemporalExpressions/router.ts's existing behavior for the client-facing booking flow, are both completely unchanged."
  artifacts:
    - "src/conversation/greek-preprocessor.ts: exports resolveOwnerDateQuery(dateQuery: string, referenceDate: Date): string | null — handles explicit DD/MM (and DD-MM) numeric dates with year-rollover, plus reuses the existing weekday-stem/relative-day resolution unchanged as a fallback. Returns null when nothing resolves."
    - "src/onboarding/ai-owner-agent.ts: new view_schedule_for_date entry in OWNER_TOOLS with a raw-text date_query parameter (never an ISO/Gemini-computed date), and a matching case in executeOwnerTool that resolves the date, states its correct Greek weekday name explicitly, and lists that date's bookings via listBookingsForDate."
    - "tests/greek-preprocessor.test.ts: new tests for resolveOwnerDateQuery covering explicit DD/MM (current-year and year-rollover), the DD-MM separator variant, weekday-name reuse, and unparseable/calendar-impossible input returning null."
    - "tests/ai-owner-view-schedule-for-date.test.ts: tests for the new tool's handler covering correct weekday+date stated in the reply, correct booking list, the empty-day message, and graceful clarification when the date can't be resolved."
  key_links:
    - "OWNER_TOOLS['view_schedule_for_date'].date_query (raw owner words) -> executeOwnerTool's new case -> resolveOwnerDateQuery(dateQuery, referenceDate) -> weekdayOfIsoDate(resolvedDate) + GREEK_WEEKDAYS -> listBookingsForDate(business.id, resolvedDate, ['pending_owner_approval','confirmed']) -> Greek reply string (weekday + date stated explicitly) fed back to Gemini as the function result."
---

<objective>
Add a deterministic date-query tool for the owner AI agent so the owner can ask about any date's schedule ("τι έχω στις 7/9;", "τι έχω τη Δευτέρα;") without Gemini ever computing a weekday or date itself. This has two parts: (1) extend `src/conversation/greek-preprocessor.ts` with a new exported function that resolves explicit DD/MM numeric dates (with year-rollover) and reuses the existing, already-correct Greek weekday-stem/relative-day resolution logic unchanged; (2) add a new `view_schedule_for_date` tool to `src/onboarding/ai-owner-agent.ts`'s `OWNER_TOOLS`, whose Gemini-facing parameter is a raw, un-interpreted text field — the server resolves the date and states the correct Greek weekday name explicitly in the tool's result, so Gemini has no room to override or miscompute it.

Purpose: Gemini/LLMs are unreliable at date and weekday arithmetic. `view_todays_schedule` already handles "today" correctly by having the server (not Gemini) compute the Athens calendar date. This plan extends that same principle to "any other date the owner names," closing a gap where the owner currently has no way to ask about a specific future date's schedule without risking Gemini inventing a wrong weekday.

Output: `resolveOwnerDateQuery` (new export in greek-preprocessor.ts), `view_schedule_for_date` (new OWNER_TOOLS entry + executeOwnerTool case in ai-owner-agent.ts), and two test suites proving both pieces behave correctly, including graceful failure on unparseable input.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

**src/conversation/greek-preprocessor.ts (read in full already — 138 lines):** `resolveDate(normalizedText: string, referenceDate: Date): string | null` (unexported, lines 48-70) first checks `RELATIVE_DAY_PATTERNS` (σήμερα/αύριο/μεθαύριο/"σε N μέρες"), then `WEEKDAY_STEMS` (diacritic-stripped stems like 'δευτερ' -> target weekday index, scanning forward up to 6 days from `referenceDate`'s Athens-today to find the next occurrence including today itself). It does NOT currently parse explicit numeric DD/MM dates. `resolveGreekTemporalExpressions` (exported, the only public API today) normalizes text via `stripGreekDiacritics(text).toLowerCase()` before calling `resolveDate` and `resolveTime`. `src/conversation/router.ts` is the only external caller of `resolveGreekTemporalExpressions` — its behavior must not change at all.
@src/conversation/greek-preprocessor.ts

**src/utils/timezone.ts (read in full already):** `isoDateInAthens(date: Date): string` returns Athens-local YYYY-MM-DD. `weekdayOfIsoDate(isoDate: string): number` anchors at `T12:00:00Z` and returns `Date.getDay()` convention (0=Sunday..6=Saturday) — this DST-safe noon-anchor trick means constructing a reference `Date` as `new Date(\`${isoDateString}T12:00:00Z\`)` reproduces that exact Athens calendar date regardless of current DST offset. `addCalendarDays` uses the same anchor trick.
@src/utils/timezone.ts

**src/onboarding/ai-owner-agent.ts (read in full already — 1424 lines):** `GREEK_WEEKDAYS` array (line 47, index-aligned to `weekdayOfIsoDate`'s 0=Sunday convention) is already the canonical Greek weekday-name lookup used throughout this file (e.g. in `update_hours`/`close_day`'s confirmation text). `OWNER_TOOLS` (starts line 173) is a flat array of Gemini function-tool definitions; every existing multi-word parameter uses snake_case (`day_of_week`, `service_name`, `session_date`, `session_time`, etc.) — follow that convention for the new parameter. `view_todays_schedule`'s tool definition (lines 240-248) and its `executeOwnerTool` case (lines 737-753) are the exact structural pattern to mirror: it calls `listBookingsForDate(business.id, today, ['pending_owner_approval', 'confirmed'])`, then for each booking resolves the service name via `findServiceById(business.id, b.serviceId).catch(() => null)` and renders `${statusLabel} ${b.calendarTime} — ${svcName} (${b.clientPhone})` lines (✅ for confirmed, ⏳ otherwise), joined with `\n`. Do not modify `view_todays_schedule`'s tool definition or case at all. `executeOwnerTool`'s top-level try/catch (line 635) already wraps every case, including the new one. `aiOwnerAgent`'s `today: string` parameter (an Athens-calendar ISO date, computed once by the caller via `isoDateInAthens(new Date())` in `src/webhooks/telegram.ts` line 347) is already passed into `executeOwnerTool` — reuse it rather than reading the clock again.
@src/onboarding/ai-owner-agent.ts

**src/database/queries.ts — relevant exports (not embedded in full; read via targeted grep already):** `listBookingsForDate(businessId: number, calendarDate: string, statuses: string[] = ['confirmed']): Promise<Booking[]>` — a plain scoped SELECT, ordered by `calendarTime`. `Booking` has `serviceId: number`, `calendarTime: string`, `clientPhone: string`, `bookingStatus: string` among its fields — the same shape `view_todays_schedule` already consumes.

**Existing test conventions to follow exactly:**
@tests/greek-preprocessor.test.ts
@tests/ai-owner-name-matching.test.ts
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: resolveOwnerDateQuery — explicit DD/MM dates + reused weekday/relative-day resolution</name>
  <files>src/conversation/greek-preprocessor.ts, tests/greek-preprocessor.test.ts</files>
  <behavior>
    Using the file's existing `REFERENCE_DATE = new Date('2026-07-08T10:00:00Z')` fixture (a Wednesday, `weekdayOfIsoDate('2026-07-08') === 3`), add a new describe block to tests/greek-preprocessor.test.ts (append after the existing describes, do not touch them) for `resolveOwnerDateQuery`:
    - "7/9" -> resolves to '2026-09-07' (September 7 has not yet occurred relative to the July 8 reference date this same year, so no rollover).
    - "07/09" -> identical result to "7/9" (zero-padded digits parse identically).
    - "7-9" -> identical result to "7/9" (dash separator variant).
    - "1/1" -> resolves to '2027-01-01' (January 1 has already passed this year relative to the July 8 reference date, so it rolls to next year).
    - "Δευτέρα" -> resolves to '2026-07-13' — identical to resolveDate's own existing weekday-stem output for the same input/reference date, proving the reuse path is wired correctly (do not change resolveDate to get this; call it as-is).
    - "αύριο" -> resolves to '2026-07-09' (the relative-day fallback path still works).
    - "31/2" -> null (February 31 is not a real calendar date in any year; the numeric path finds nothing valid and the weekday/relative-day fallback also finds nothing for this input, so the overall result is null).
    - "ένα τυχαίο μήνυμα χωρίς ημερομηνία" -> null (no numeric date, no weekday stem, no relative-day word).
  </behavior>
  <action>
    In src/conversation/greek-preprocessor.ts, add a new unexported helper `resolveExplicitNumericDate(normalizedText: string, referenceDate: Date): string | null` placed directly above the existing `resolveDate` function. It must: match `normalizedText` against the regex `\b(\d{1,2})[\/\-](\d{1,2})\b` (search anywhere in the string, not anchored, so a phrase like "τι έχω στις 7/9" still matches) to extract day and month digit groups as the first and second capture groups respectively (Greek DD/MM convention, matching this codebase's existing `formatExpiryDateGreek` DD/MM/YYYY order); parse both as integers and return null immediately if month is outside 1-12 or day is outside 1-31 (a coarse guard before any date construction — falling through to null here means the caller tries the weekday/relative-day fallback next). Derive `todayIso` via the already-imported `isoDateInAthens(referenceDate)` and `currentYear` by parsing its first 4 characters as an integer. Add a small local closure that, given a candidate year, builds the zero-padded ISO string `${year}-${MM}-${DD}` and validates it by round-tripping through `new Date(\`${candidate}T12:00:00Z\`)`, comparing its `getUTCFullYear()`, `getUTCMonth() + 1`, and `getUTCDate()` back against the input year/month/day — returning null on any mismatch (this rejects calendar-impossible combinations like day 31 in a 30-day month, with no new date library needed). Try the current-year candidate first: if it is valid and lexicographically `>= todayIso` (ISO date strings of equal length compare correctly this way), return it. Otherwise (invalid OR already in the past this year), return the result of trying `currentYear + 1` — which may itself be null if the day/month combination is calendar-impossible in every year (e.g. day 31 in February); do not try further years beyond that, since the "roll to next year" requirement only applies to a date that legitimately already passed, not to fundamentally invalid input.

    Then add the new exported function `resolveOwnerDateQuery(dateQuery: string, referenceDate: Date): string | null` directly below the existing `resolveDate` function (before `formatHour`). It normalizes `dateQuery` exactly like `resolveGreekTemporalExpressions` already does — `stripGreekDiacritics(dateQuery).toLowerCase()` (both already imported at the top of this file) — then tries `resolveExplicitNumericDate` first (explicit numeric dates are unambiguous and take priority). If that returns null, fall through to calling the existing `resolveDate(normalizedText, referenceDate)` directly (same-module call, no new export of `resolveDate` needed) to reuse its relative-day-word and Greek-weekday-stem resolution verbatim. Return null if neither path resolves anything.

    Do not modify `resolveDate`, `RELATIVE_DAY_PATTERNS`, `WEEKDAY_STEMS`, or `resolveGreekTemporalExpressions` in any way — all new code is additive only, appended in the new locations described above. `src/conversation/router.ts`'s existing call to `resolveGreekTemporalExpressions` must behave byte-for-byte unchanged.
  </action>
  <verify>
    <automated>npx tsc --noEmit && npx jest --testPathPattern=greek-preprocessor --testTimeout=20000</automated>
  </verify>
  <done>resolveOwnerDateQuery is exported from src/conversation/greek-preprocessor.ts, correctly resolves explicit DD/MM and DD-MM numeric dates with year-rollover, reuses the existing weekday-stem/relative-day logic unchanged as its fallback, returns null for unparseable or calendar-impossible input, and every new test plus the pre-existing 23-phrase corpus in tests/greek-preprocessor.test.ts passes.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: view_schedule_for_date owner tool — raw-text date_query, explicit weekday in result</name>
  <files>src/onboarding/ai-owner-agent.ts, tests/ai-owner-view-schedule-for-date.test.ts</files>
  <behavior>
    New test file tests/ai-owner-view-schedule-for-date.test.ts, copying the module-mock scaffold verbatim from tests/ai-owner-name-matching.test.ts (jest.mock for @google/genai, ../src/config, ../src/database/queries — with listBookingsForDate and findServiceById mockable, ../src/telegram/client, ../src/telegram/handlers/payment-flow, ../src/billing/tools, ../src/billing/queries, ../src/session/manager, ../src/session/slotless-requests, ../src/invites/generator). Do NOT mock ../src/conversation/greek-preprocessor or ../src/utils/timezone — the real deterministic date logic from Task 1 must run so this is a true wiring test, not a mocked stub. Drive everything through aiOwnerAgent(business, ownerTelegramId, messageText, today) with today fixed at '2026-07-08' (a Wednesday) exactly like tests/ai-owner-cancel-session.test.ts already does, and a mocked Gemini response whose first call is a function_call step naming 'view_schedule_for_date' with a `date_query` argument.
    - date_query "7/9" -> resolves to 2026-09-07 (a Monday/Δευτέρα). Mock listBookingsForDate to return one booking; assert it was called with (business.id, '2026-09-07', ['pending_owner_approval', 'confirmed']), and the final reply text contains both "Δευτέρα" and "07/09/2026" plus that booking's rendered line.
    - date_query "1/1" -> resolves to 2027-01-01 (a Friday/Παρασκευή, since Jan 1 already passed relative to the July 8 'today' and rolls to next year). Mock listBookingsForDate to return an empty array; assert the reply contains "Παρασκευή", "01/01/2027", and the Greek "no bookings that day" text, with no booking lines.
    - date_query "Δευτέρα" -> resolves to 2026-07-13 (the nearest upcoming Monday from the Wednesday 'today'). Assert the reply contains "Δευτέρα" and "13/07/2026".
    - date_query "ένα τυχαίο μήνυμα χωρίς ημερομηνία" (unparseable) -> assert the reply is a Greek clarification string (not a booking list) and that listBookingsForDate was NOT called at all for this case.
  </behavior>
  <action>
    Add two imports to src/onboarding/ai-owner-agent.ts: `resolveOwnerDateQuery` from '../conversation/greek-preprocessor', and `weekdayOfIsoDate` from '../utils/timezone' (GREEK_WEEKDAYS, listBookingsForDate, and findServiceById are already imported/defined in this file).

    In the OWNER_TOOLS array, add a new tool object immediately after the existing view_todays_schedule entry (before the Phase 7 billing-tools comment block), named 'view_schedule_for_date'. Its Greek description explains it shows the appointment schedule for a specific date the owner names, distinct from view_todays_schedule which stays "today only" and is not touched. Its single required parameter is date_query (string, snake_case per this file's established multi-word-parameter convention — the same raw-text field the design calls dateQuery conceptually). The parameter's description must instruct the model: pass the owner's own words for the date exactly as said (examples: '7/9', 'Δευτέρα', 'αύριο'), and explicitly tell it NOT to convert this to ISO format or compute the date/weekday itself — the server resolves it deterministically.

    Add `date_query?: string;` to the ToolArgs interface, grouped near the other Phase 10 session-catalog fields (session_date, session_time) since it is conceptually adjacent.

    In executeOwnerTool's switch statement, add a new `case 'view_schedule_for_date':` immediately after the existing `case 'view_todays_schedule':` block (that existing block is not modified). Read date_query from args, trimmed to a string; if empty, return the Greek string 'Δεν δόθηκε ημερομηνία.'. Otherwise construct a referenceDate by anchoring the already-available `today` parameter at noon UTC — `new Date(\`${today}T12:00:00Z\`)` — which reproduces the exact same Athens calendar date resolveOwnerDateQuery's own internal isoDateInAthens() call would derive, per utils/timezone.ts's documented noon-anchor convention, with no second real-clock read. Call `resolveOwnerDateQuery(dateQuery, referenceDate)`. If it returns null, return a Greek clarification string telling Gemini the date could not be understood and to ask the owner for an explicit date (e.g. 7/9) or a day name — do not call listBookingsForDate on this branch. Otherwise compute `weekdayName` via `GREEK_WEEKDAYS[weekdayOfIsoDate(resolvedDate)]` and a `displayDate` string in DD/MM/YYYY order (split the resolved ISO string on '-' and reassemble day/month/year — matches this codebase's existing formatExpiryDateGreek DD/MM/YYYY convention). Call `listBookingsForDate(business.id, resolvedDate, ['pending_owner_approval', 'confirmed'])` (identical status filter to view_todays_schedule). Build the reply using the exact same per-booking line shape view_todays_schedule already uses (✅/⏳ status icon based on bookingStatus, calendarTime, service name resolved via findServiceById with a .catch(() => null) fallback to a placeholder, clientPhone), but prefix the whole reply with a line stating `${weekdayName} ${displayDate}` — followed by either the joined booking lines, or (when there are zero bookings) the Greek text 'Δεν υπάρχουν ραντεβού.'. This weekday+date prefix is the load-bearing part of the design constraint: Gemini receives the correct resolved weekday already stated in the tool's own result text and must not recompute or restate a different one when composing its final reply.

    Also add one short bullet to buildOwnerSystemPrompt's Κανόνες: list (the existing array of Greek instruction strings) telling the model: for questions about a date other than today, use view_schedule_for_date with the owner's own words in date_query, and never compute or state a date/weekday itself since the tool result already contains it. This is a one-line addition to the same array that already lists the model's other tool-usage rules; it does not change any existing line, including the one covering view_todays_schedule.
  </action>
  <verify>
    <automated>npx tsc --noEmit && npx jest --testPathPattern=ai-owner-view-schedule-for-date --testTimeout=20000</automated>
  </verify>
  <done>view_schedule_for_date is registered in OWNER_TOOLS with a raw-text date_query parameter (never a Gemini-computed ISO date), executeOwnerTool's new case resolves the date via resolveOwnerDateQuery and explicitly states the correct Greek weekday name in every reply (both the with-bookings and no-bookings paths), an unresolvable date_query returns a clarification message without ever querying the database, view_todays_schedule's own tool definition and case are byte-for-byte unchanged, and all 4 new tests pass.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Telegram owner message -> Gemini function-call arguments -> server-side date resolution -> DB read | The owner's free-text date phrase crosses into a Gemini-parsed `date_query` string argument, then into deterministic server-side parsing (`resolveOwnerDateQuery`) before ever reaching a scoped DB read (`listBookingsForDate`). Same trust boundary already accepted for every other owner-agent tool in this file (owner is authenticated via `ownerTelegramId` match upstream). |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-quick260908dxa-01 | Tampering | `date_query` raw-text tool argument | low | mitigate | `resolveOwnerDateQuery` treats any unparseable, malformed, or calendar-impossible input as `null`, producing a safe Greek clarification reply instead of crashing or silently mis-resolving a wrong date; Gemini's own date/weekday arithmetic is never trusted for the actual resolution, only used as raw input text (the core design constraint of this plan). |
| T-quick260908dxa-02 | Information Disclosure | `view_schedule_for_date`'s booking-list reply | low | accept | `listBookingsForDate` is called scoped to `business.id`, identically to the pre-existing `view_todays_schedule` tool. An owner viewing their own business's bookings for any date is the same already-accepted trust boundary as viewing "today" — no new cross-tenant exposure is introduced. |
| T-quick260908dxa-03 | Denial of Service | `resolveExplicitNumericDate`'s regex over `dateQuery` | low | accept | Input is a single short Gemini function-call argument, not arbitrary-length user text, and the regex (`\b(\d{1,2})[\/\-](\d{1,2})\b`) has no nested-quantifier/catastrophic-backtracking shape — negligible cost regardless of input. |
</threat_model>

<verification>
1. Task 1's jest run confirms `resolveOwnerDateQuery` resolves explicit DD/MM (and DD-MM) numeric dates including year-rollover, and reuses the existing weekday/relative-day resolution unchanged as its fallback, while the pre-existing 23-phrase corpus in tests/greek-preprocessor.test.ts remains green.
2. Task 2's jest run confirms the new `view_schedule_for_date` tool always states the correct resolved date's Greek weekday name explicitly in its result (both when bookings exist and when the day is empty), and gracefully asks for clarification when the date can't be resolved, without ever querying the database in that failure case.
3. Regression check: `npx jest --testPathPattern="ai-owner-" --testTimeout=20000` (covers all five ai-owner-*.test.ts files including the new one) confirms `view_todays_schedule` and every other existing owner-tool case remain unaffected.
4. Manual read-check: `src/conversation/router.ts`'s only call site (`resolveGreekTemporalExpressions`) is untouched, and `resolveDate`/`WEEKDAY_STEMS`/`RELATIVE_DAY_PATTERNS` are byte-for-byte unchanged in `src/conversation/greek-preprocessor.ts`.
Do not run the full `npm test` suite (machine crash risk per project memory) — only the targeted `--testPathPattern` runs above, plus `npx tsc --noEmit`.
</verification>

<success_criteria>
- The owner can ask about an explicit date ("7/9") or a Greek weekday name ("τη Δευτέρα") and receive back a schedule reply whose stated weekday name is always correct, with zero date/weekday arithmetic performed by Gemini itself.
- An unparseable date phrase produces a graceful clarification request instead of a wrong guess or a crash.
- `view_todays_schedule` and `resolveGreekTemporalExpressions`/`router.ts`'s client-facing behavior remain completely unchanged.
- No new npm dependency added — plain date arithmetic using existing `utils/timezone.ts` helpers only.
- All new and pre-existing targeted test suites pass; `npx tsc --noEmit` reports zero new errors.
</success_criteria>

<output>
Create `.planning/quick/260908-dxa-add-a-deterministic-date-query-tool-for-/260908-dxa-SUMMARY.md` when done
</output>
