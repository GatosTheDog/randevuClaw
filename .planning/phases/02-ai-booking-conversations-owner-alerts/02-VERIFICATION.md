---
phase: 02-ai-booking-conversations-owner-alerts
verified: 2026-07-08T17:30:00Z
status: gaps_found
score: 3/10 must-haves verified
behavior_unverified: 2
overrides_applied: 0
re_verification: false
gaps:
  - truth: "Two concurrent book_appointment calls for the identical business/date/time slot result in exactly one pending_owner_approval row; the losing call receives a structured slot_taken response"
    status: failed
    reason: "requestId shared across all tool calls in one turn causes multi-booking idempotency mechanism to break. If Gemini calls book_appointment twice in one turn for two different slots, both use the same requestId. The second call's insertBooking() collides on unique_request_per_client, returns null, and resolveConflictOrTaken() finds the first booking and returns it as success — telling the client and model the second booking succeeded when only the first exists. Violates phase goal 'no double-bookings, even under concurrent requests' and the core ROADMAP Success Criterion 5."
    artifacts:
      - path: "src/conversation/ai-agent.ts"
        issue: "Line 218: requestId generated once per aiBookingAgent invocation; line 277: same requestId passed to every executeTool call in that turn and subsequent rounds"
      - path: "src/conversation/function-executor.ts"
        issue: "Lines 155, 221: insertBooking uses context.requestId without per-tool disambiguation; lines 128-137: resolveConflictOrTaken() returns the first booking when any unique constraint collision occurs, no way to distinguish slot_taken from idempotent retry when two different bookings exist"
    missing:
      - "Derive a fresh idempotency key per mutating tool call (e.g., `${requestId}:${call.id}`) instead of reusing the turn-level requestId across multiple book_appointment/reschedule_appointment calls"
      - "Preserve turn-level requestId for read-only and genuine-retry semantics only"

  - truth: "A client's cancellation request immediately transitions their own booking to cancelled with no owner veto, and the owner receives an FYI-only alert with no buttons"
    status: failed
    reason: "DB mutation (updateBookingStatus) succeeds before Telegram notification is attempted. If either sendTelegramMessage call throws (transient network error, rate limit, blocked chat), the exception propagates to executeTool's outer catch (line 79-81), which returns {error: ...} even though the cancellation already committed to the database. Client is told the action failed when it actually succeeded. For cancellation there is no self-healing expiry path, so the inconsistency persists."
    artifacts:
      - path: "src/conversation/function-executor.ts"
        issue: "Lines 182-191: updateBookingStatus succeeds, then await sendTelegramMessage calls with no per-notification try/catch. Any throw propagates to line 79-81 catch, returning error despite successful DB mutation"
    missing:
      - "Wrap each Telegram notification in its own try/catch; always return success based on DB mutation, log notification failures separately"
      - "Match the pattern already being fixed for reschedule approval step in CR-03"

  - truth: "A client's reschedule request creates a NEW pending booking referencing the original via rescheduledFromBookingId and triggers an owner alert, without altering the original booking's status"
    status: failed
    reason: "Same issue as cancellation: insertBooking succeeds at line 215, but alertOwnerNewBooking at line 227 throws and propagates to outer catch at line 79-81. Client is told the reschedule failed when the new pending booking already exists in the database."
    artifacts:
      - path: "src/conversation/function-executor.ts"
        issue: "Lines 215-227: insertBooking succeeds, then await alertOwnerNewBooking with no try/catch. Any throw propagates to outer catch"
    missing:
      - "Wrap alertOwnerNewBooking in its own try/catch; always return success once insertBooking lands"

  - truth: "No unbounded Gemini tool-call loop; aiBookingAgent always returns within a reasonable number of rounds"
    status: failed
    reason: "aiBookingAgent's while(true) loop at line 227 has no maximum round count. If Gemini keeps returning function_call steps (e.g., repeatedly re-checking availability), the loop never exits. Since routeConversationMessage awaits this call directly in the webhook handler before sending HTTP 200 (webhooks/telegram.ts:67), a stuck loop hangs the entire request. Worse, insertOrIgnoreTelegramUpdate already recorded this update_id as processed before the loop started, so Telegram's retry is silently dropped — the user's message is never answered."
    artifacts:
      - path: "src/conversation/ai-agent.ts"
        issue: "Lines 227-288: while(true) with no round counter. Loop only exits if functionCalls.length === 0 (line 263) or exception thrown (lines 243, 251), but neither is guaranteed"
      - path: "src/webhooks/telegram.ts"
        issue: "Lines 53-67: handleFoundBusiness awaits routeConversationMessage directly in HTTP handler before res.status(200).send('OK')"
    missing:
      - "Add MAX_TOOL_ROUNDS constant (~6-8 rounds as generous upper bound); increment counter inside loop; throw or return graceful error if exceeded"
      - "Ensures webhook never hangs and user always gets a response within a bounded time"

  - truth: "Every tool call's business_id argument is validated against the conversation's server-resolved business before any DB mutation, rejected regardless of what Gemini requests"
    status: verified
    evidence: "executeTool dispatcher (function-executor.ts:59-64) checks business_id against context.business.id before any per-tool switch branch. Defense-in-depth guard present and tested."

  - truth: "A client can never cancel or reschedule a booking whose clientPhone does not match their own conversation identity"
    status: verified
    evidence: "cancelAppointmentTool (line 177) and rescheduleAppointmentTool (line 204) both check `booking.clientPhone !== context.clientPhone` before proceeding. Unit tests cover this guard."

  - truth: "Recognized-business Telegram message now produces a real Gemini-driven Greek reply instead of Plan 02-02 static greeting"
    status: verified
    evidence: "Telegram webhook's business-found branch (webhooks/telegram.ts:53-67) calls routeConversationMessage, which invokes aiBookingAgent. A real Gemini conversation flows through instead of static reply. Tested via conversation-router.test.ts and telegram-webhook.test.ts."

  - truth: "Greek colloquial date/time expressions (αύριο, weekday names, στις N π.μ./μ.μ.) resolve to the correct ISO date/24h-time relative to an explicit reference date"
    status: failed
    reason: "The 20-phrase corpus test only exercises common Greek phrases with explicit am/pm markers (π.μ./μ.μ.) or time-of-day context words (πρωί/απόγευμα/μεσημέρι/βράδυ). It does not test ordinary 24-hour phrasing without a marker, which is extremely common in Greek (e.g., 'Παρασκευή στις 20', 'στις 14'). For these inputs, the bare-hour heuristic (greek-preprocessor.ts:98-102) does not check if the hour is already ≥13 (24-hour format) before adding 12. Result: 'στις 14' → hour=14 → formatHour(14+12, '00') = '26:00'; 'στις 20' → hour=20 → formatHour(20+12, '00') = '32:00'. These invalid times are embedded in the system hint sent to Gemini as [ΣΥΣΤΗΜΑ: πιθανή ώρα=26:00], which the model is instructed to trust. A plausible path for invalid calendar_time values to reach book_appointment."
    artifacts:
      - path: "src/conversation/greek-preprocessor.ts"
        issue: "Lines 98-102: bare-hour heuristic never checks if hour >= 13 before adding 12. Missing guard: `if (hour >= 13 && hour <= 23) return formatHour(hour, minutes);` before the 12-hour logic"
      - path: "tests/greek-preprocessor.test.ts"
        issue: "20-phrase corpus does not include any bare 24-hour hour (≥13) without an explicit marker or context word"
    missing:
      - "Add guard for already-unambiguous 24-hour input (13-23) before 12-hour heuristic"
      - "Add test corpus phrases: 'Παρασκευή στις 14', 'Παρασκευή στις 20', 'στις 22', etc. (bare 24h without marker)"

  - truth: "Rate-limit (Gemini 429) responses are retried with exponential backoff; if retries exhausted the client receives a graceful Greek message instead of crash/hang/raw error"
    status: failed
    reason: "When callGeminiWithRetry exhausts retries on 429s, aiBookingAgent returns at line 246: `interactionId: previousInteractionId ?? ''` — using empty string as fallback for 'no interaction'. But the type is `string` (non-nullable), and the schema documents `conversationTurns.interactionId` as 'null if turn errored before Gemini responded'. Empty string is persisted verbatim via insertConversationTurn (router.ts:38). On the client's next message, findLatestConversationTurn reads it back and does `previousTurn?.interactionId ?? null` (router.ts:29), but `??` only substitutes for null/undefined, not '', so '' survives and is forwarded to aiBookingAgent as previousInteractionId=''. Inside aiBookingAgent line 225: `currentInteractionId: string | undefined = previousInteractionId ?? undefined` keeps '' (not nullish), and '' is sent to Gemini API as previous_interaction_id: ''. This is very likely rejected by Gemini on the next real turn for that client — exactly after a 429 burst scenario that the free-tier constraints (15 RPM/1000 RPD per CLAUDE.md) make routine."
    artifacts:
      - path: "src/conversation/ai-agent.ts"
        issue: "Line 246: return uses `previousInteractionId ?? ''` as fallback for rate-limit case. Line 225: currentInteractionId keeps '' as not-nullish. Result: '' is sent to Gemini API on next turn"
      - path: "src/conversation/router.ts"
        issue: "Line 29: `previousTurn?.interactionId ?? null` does not coerce '' to null. Line 38: '' is persisted verbatim"
    missing:
      - "Change AiAgentResult.interactionId type to `string | null` (currently `string`)"
      - "Use `previousInteractionId ?? null` at line 246 instead of `previousInteractionId ?? ''`"
      - "Remove the workaround at router.ts:29 once type is honest"

  - truth: "A booking can never be double-inserted for the same business/date/time while an active booking already holds that slot"
    status: partial
    reason: "Database-level partial unique index (unique_active_slot_per_business WHERE booking_status IN ('pending_owner_approval','confirmed')) correctly prevents double-booking at the DB layer. However, the application layer has multiple race conditions that can bypass or interact dangerously with this guard: (1) CR-02 multi-tool idempotency failure allows two different bookings to be reported as one; (2) WR-05 (concurrent callback_query taps) can cause duplicate transitions; (3) CR-04 (failed notifications mid-sweep) can leave bookings permanently stuck in 'expired' state. The index itself is correctly implemented, but the surrounding layers have gaps."
    artifacts:
      - path: "src/database/schema.ts"
        issue: "Partial unique index is correctly defined but application layer races can bypass safety guarantees"
    missing:
      - "Fix CR-02 (per-tool requestId disambiguation)"
      - "Fix WR-05 (atomic compare-and-swap on owner-approval status transition)"

  - truth: "Pending booking left unanswered past its 2-hour expiresAt is swept to expired within one polling interval, the client receives the Greek 'not confirmed in time' message, and the owner's original alert has its buttons cleared"
    status: failed
    reason: "expireStalePendingBookings at database/queries.ts:329-347 is a single atomic UPDATE ... RETURNING that flips every stale booking to 'expired' in one statement. runExpirySweep (expiry-poller.ts:28-48) then iterates the returned array and, for each booking, awaits sendTelegramMessage with NO per-booking try/catch. If the Telegram send for the first booking throws (network error, rate limit, blocked chat), the for loop aborts; the per-business try/catch logs and moves to the next business — but every other booking from that same batch already has bookingStatus='expired' in the DB. On the next sweep, WHERE bookingStatus='pending_owner_approval' filter will never select them. Those clients are permanently never notified, and their owner-alert buttons are never cleared."
    artifacts:
      - path: "src/conversation/expiry-poller.ts"
        issue: "Lines 38-41: for loop over expired bookings with await sendTelegramMessage, no per-booking try/catch. First failure aborts loop, leaving subsequent bookings permanently stuck"
    missing:
      - "Wrap each notification in its own try/catch so one failure doesn't abort the rest of the batch"
      - "Log per-booking failures separately"

  - truth: "Tapping Αποδοχή on a pending booking's owner alert transitions it to confirmed and sends the client a Greek confirmation naming the exact service/date/time"
    status: present_behavior_unverified
    reason: "Unit tests (telegram-webhook.test.ts) mock the entire callback_query flow and verify the status transition and message construction. However, a real runtime race condition exists (WR-05): no atomic compare-and-swap on the booking-status check. Two near-simultaneous taps on the same button produce two separate webhook invocations. Each can read bookingStatus='pending_owner_approval' before either writes, and both can proceed to notify the client — resulting in duplicate 'confirmed' messages. The code exists and is wired, but the concurrent-tap race is untested and unfixed."
    artifacts:
      - path: "src/webhooks/telegram.ts"
        issue: "Lines 114-166: handleCallbackQuery reads booking status in application code (line 137), checks if pending, then mutates (lines 146/159) — a read-then-write race. Two concurrent taps can both pass the check before either mutation lands"
    missing:
      - "Implement atomic compare-and-swap: UPDATE bookings SET booking_status = $1 WHERE id = $2 AND booking_status = 'pending_owner_approval' RETURNING id; only proceed with notifications if a row was updated"

deferred: []
behavior_unverified_items:
  - truth: "Tapping Αποδοχή/Απόρριψη on a pending booking's owner alert transitions status and notifies client"
    test: "Use deployed bot; have two Telegram windows open for the same business; click Αποδοχή in window 1; immediately click Αποδοχή again in window 2 (or have second window simultaneously tap Αποδοχή); verify only ONE confirmation message reaches the client, not two"
    expected: "Only one client confirmation message is received; the second tap is a no-op. Owner sees the button visibly update/disable after first tap"
    why_human: "Race condition between concurrent callback_query webhook invocations is only visible at runtime under timing pressure. Unit tests mock fetch and have perfect sequencing; real Telegram can deliver both callbacks before either DB write lands. Requires live testing with actual concurrent clicks."

  - truth: "A 2-hour pending booking expires and the client is notified while owner alert buttons are cleared"
    test: "Create a pending booking; wait for the expiry-sweep interval to fire (or manually shorten the interval and wait ~5 minutes); verify the client receives a Greek expiry message and the owner's original inline buttons no longer respond to clicks"
    expected: "Client receives 'Το ραντεβού δεν επιβεβαιώθηκε...' message; owner's alert message's keyboard is cleared (buttons no longer appear or fail gracefully when tapped)"
    why_human: "The full 2-hour wait is impractical in a planning session; requires either (a) manually shortened cutoff for testing, or (b) time-travel mocking in Jest. The latter is fragile for an in-process setInterval poller. Per 02-VALIDATION.md's manual-only entry for D-09, this needs human end-of-phase verification."

human_verification: []
---

# Phase 02: AI Booking Conversations & Owner Alerts — Verification Report

**Phase Goal (from ROADMAP.md):**
Clients can carry out a full natural-language WhatsApp/Telegram conversation in Greek to check availability, book, cancel, or reschedule an appointment, and ask questions — with owners alerted in real time and no double-bookings, even under concurrent requests.

**Verified:** 2026-07-08T17:30:00Z
**Status:** GAPS_FOUND
**Score:** 3/10 core truths verified; 2 behavior-unverified (present but race conditions untested); 5 FAILED (blocking phase goal)

---

## Executive Summary

**Phase completion status: NOT ACHIEVED** — Goal-backward verification shows the core phase promise ("no double-bookings, even under concurrent requests" + "owner receives alerts reliably") is violated by 6 critical bugs documented in the prior code review (02-REVIEW.md):

1. **Unbounded AI loop (CR-01)**: Webhook requests can hang forever if Gemini keeps returning tool calls, and the user's message is silently dropped.
2. **Multi-tool idempotency broken (CR-02)**: Two book_appointment calls in one turn both succeed but are misreported as one, violating "no double-bookings."
3. **Cancellation/reschedule report false failures (CR-03)**: DB mutation succeeds but notification failure masks it, leaving clients confused.
4. **Notification batch drops on first failure (CR-04)**: One failed Telegram send during expiry sweep permanently silences all remaining client notifications in that batch.
5. **Invalid 24-hour times (CR-05)**: Ordinary Greek phrases like "στις 20" produce "32:00", breaking availability checks and booking attempts.
6. **Rate-limit recovery broken (CR-06)**: Empty string persists as interaction ID after 429, breaking the next turn.

All 6 are **BLOCKERS** — they directly contradict core ROADMAP Success Criteria and make the phase unsuitable for production. While artifacts exist and unit tests mostly pass, the application layer has multiple race conditions and error-handling gaps.

---

## Observable Truths: Verification Status

### VERIFIED (3/10)

| # | Truth | Evidence |
|---|-------|----------|
| 1 | Every tool call's business_id is validated against conversation's server-resolved business before any DB mutation | executeTool dispatcher (function-executor.ts:59-64) gates all tools; unit tests verify cross-tenant rejection |
| 2 | Client cannot cancel or reschedule a booking whose clientPhone doesn't match their own conversation identity | Booking ownership checks at function-executor.ts:177 and :204; unit tests cover both paths |
| 3 | Recognized-business Telegram message produces a real Gemini-driven Greek reply instead of static greeting | Telegram webhook (webhooks/telegram.ts:53-67) calls routeConversationMessage → aiBookingAgent; conversation-router.test.ts and telegram-webhook.test.ts verify the wiring |

### FAILED (5/10) — BLOCKERS

| # | Truth | Issue | Impact |
|---|-------|-------|--------|
| 4 | Two concurrent book_appointment calls for same slot result in exactly one pending_owner_approval row | **CR-02**: requestId shared across all tool calls in one turn breaks idempotency. Second booking for different slot collides on unique constraint, but resolveConflictOrTaken() returns first booking as success. Client thinks they have two bookings; only one exists. | **Violates ROADMAP Success Criterion 5: "no double-bookings, even under concurrent requests"** |
| 5 | Client cancellation request transitions to cancelled and owner receives FYI-only alert | **CR-03**: updateBookingStatus succeeds (line 182), then sendTelegramMessage calls without try/catch (lines 187-191). Any Telegram error propagates to outer catch, returning {error:...} to client. DB mutation already landed. Client is told "failed" when action actually succeeded. No self-healing path for cancellations. | **Breaks user-facing reliability; user-facing feedback is incorrect** |
| 6 | Client reschedule creates new pending booking and owner alert | **Same as CR-03**: insertBooking succeeds (line 215), alertOwnerNewBooking throws (line 227), exception bubbles up, client told "failed" when new booking row already exists | **Breaks user-facing reliability** |
| 7 | No unbounded Gemini tool-call loop | **CR-01**: while(true) at line 227 has no MAX_TOOL_ROUNDS check. If model gets stuck calling tools, loop never exits. Webhook request hangs. insertOrIgnoreTelegramUpdate already recorded update_id as processed, so Telegram retry is silently dropped. User's message is never answered. | **Webhook hangs + message silently lost; violates responsiveness guarantee** |
| 8 | Greek colloquial date/time expressions resolve correctly to ISO date/24h-time | **CR-05**: Bare-hour heuristic (greek-preprocessor.ts:98-102) assumes all bare hours are 1-12 and adds 12 without checking if hour is already ≥13. "Παρασκευή στις 20" → hour=20 → 20+12="32:00". Invalid time embedded in system hint. 20-phrase corpus test only covers marked/contexted hours, not ordinary 24-hour phrasing. | **Breaks availability checking and booking for common Greek phrases** |
| 9 | Pending booking past 2 hours expires, client notified, owner alert buttons cleared | **CR-04**: expireStalePendingBookings atomically flips all stale bookings to 'expired' in one UPDATE. runExpirySweep then iterates and sends notifications with NO per-booking try/catch. First failure aborts loop. Subsequent bookings already have status='expired' in DB — next sweep never selects them. Those clients permanently never notified; owner alert buttons never cleared. | **Breaks notification reliability for stale bookings; permanent data loss (notification path)** |

### PARTIAL / RACE CONDITIONS (2/10) — Marked PRESENT_BEHAVIOR_UNVERIFIED

| # | Truth | Status | Why Human Verification Needed |
|---|-------|--------|-------------------------------|
| 10 | Tapping Αποδοχή/Απόρριψη on pending booking transitions status and notifies client | Present (code exists, unit tests pass), but **WR-05 concurrent-tap race untested** | Two simultaneous taps on same button can both pass the read-check before either write lands, causing duplicate client notifications. Requires live Telegram + real timing pressure |
| 11 | 2-hour pending booking expires and client is notified | Present (code exists, unit tests pass), but **full 2-hour wait + Telegram wiring untested at runtime** | A genuine 2-hour wait is impractical in planning session. Requires manually-shortened cutoff and live Telegram verification that expiry message + button-clear both complete |

---

## Artifacts & Key Links

### Database Schema (02-01)

| Artifact | Status | Evidence |
|----------|--------|----------|
| `src/database/schema.ts` — services, businessHours, bookings, conversationTurns, telegramUpdates pgTable definitions; businesses.ownerTelegramId | ✓ VERIFIED | Migrations exist; schema has partial unique index (correct) |
| `src/database/queries.ts` — Full typed query layer (16 functions) | ✓ VERIFIED | Queries for slot checking, booking CRUD, dedup; unit tests pass |
| Partial unique index `unique_active_slot_per_business` WHERE booking_status IN ('pending_owner_approval','confirmed') | ✓ VERIFIED (index correct, but application layer races exist) | Index prevents blanket double-booking at DB level; application layer gaps documented in CR-02, WR-05 |
| Fixture data: 3 distinct-duration services + 7-day hours per business | ✓ VERIFIED | Both fixtures seeded correctly; services.test.ts confirms |
| Environment config (GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, OWNER_TELEGRAM_ID) | ✓ VERIFIED | Fail-fast checks present; logger redaction works |

### Telegram Channel Adapter (02-02)

| Artifact | Status | Evidence |
|----------|--------|----------|
| `src/telegram/client.ts` — Outbound Bot API primitives (sendMessage, sendMessageWithKeyboard, answerCallbackQuery, editMessageReplyMarkup) | ✓ VERIFIED | telegram-client.test.ts verifies all 4 primitives; mocked fetch, correct JSON shapes |
| `src/webhooks/telegram.ts` — Webhook handler (secret-token auth, dedup, business resolution, consent, callback_query stub) | ⚠️ ORPHANED (wired but incomplete): callback_query branch implemented in Plan 02-05 but has **WR-05 race condition**; message branch wired to AI but has **CR-01 unbounded loop exposure** | telegram-webhook.test.ts passes, but real concurrency scenarios untested |

### Business Logic (02-03)

| Artifact | Status | Evidence |
|----------|--------|----------|
| `src/business/availability.ts` — checkAvailability with 1-hour granularity, per-booking duration, closed-day handling | ✓ VERIFIED (logic correct) | availability.test.ts covers slot computation, closed days, stale-sweep resilience; but **used downstream by AI which produces invalid times (CR-05)** |
| `src/utils/timezone.ts` — DST-safe Europe/Athens date utilities | ✓ VERIFIED | timezone.test.ts covers DST rollover, weekday math, month addition |
| `src/conversation/greek-preprocessor.ts` — Temporal-expression resolution | ⚠️ PARTIAL FAILURE | 20-phrase corpus test passes, but **missing guard for bare 24-hour input (CR-05)** — "στις 20" produces "32:00"; untested and broken for ordinary Greek |

### AI Booking Agent (02-04)

| Artifact | Status | Evidence |
|----------|--------|----------|
| `src/conversation/ai-agent.ts` — Gemini sequential function-calling loop, system prompt, retry logic | ⚠️ PARTIAL FAILURE | ai-agent.test.ts verifies retry + rate-limit handling, but **CR-01 unbounded while(true) loop has no MAX_TOOL_ROUNDS guard**; **CR-06 rate-limit fallback uses '' instead of null** |
| `src/conversation/function-executor.ts` — Tool executor with guardrails (cross-tenant, booking-ownership, idempotent-retry) | ⚠️ PARTIAL FAILURE | function-executor.test.ts verifies guardrails, but **CR-02 multi-tool idempotency broken**; **CR-03 notification failures mask DB successes** |
| `src/conversation/router.ts` — Channel-agnostic conversation core (consent, preprocessing, turn persistence) | ⚠️ PARTIAL FAILURE | conversation-router.test.ts verifies plumbing, but **CR-06 '' vs null bug propagates through router.ts:29** |

### Owner Approval & Expiry (02-05)

| Artifact | Status | Evidence |
|----------|--------|----------|
| `src/webhooks/telegram.ts` callback_query branch — Validation, ownership check, approve/reject/reschedule-cascade, button-clear, client notification | ⚠️ PARTIAL FAILURE (RACE CONDITION) | telegram-webhook.test.ts verifies happy path, but **WR-05 concurrent-tap race untested**: two simultaneous button taps can cause duplicate client notifications |
| `src/conversation/expiry-poller.ts` — 2-hour pending-booking expiry sweep and client notification | ⚠️ PARTIAL FAILURE | expiry-poller.test.ts verifies unit logic, but **CR-04 batch-notification abort untested**: one failed Telegram send aborts loop, subsequent bookings permanently un-notified |

---

## Requirements Coverage

Phase 2 requirements: BOOK-01, BOOK-02, BOOK-03, BOOK-04, ASK-01, ASK-02, OWNR-02

| Requirement | Phase 2 Claim | Verification Status | Evidence | Gaps |
|-------------|--------------|---------------------|----------|------|
| BOOK-01: Client books via natural Greek chat | Complete | ⚠️ PARTIAL | aiBookingAgent wired to Telegram webhook; unit tests pass; but **CR-02 multi-tool idempotency broken** violates atomicity of booking; **CR-05 invalid times break booking for 24-hour phrasing** | Fix CR-02, CR-05 |
| BOOK-02: Client cancels via chat | Complete | ⚠️ PARTIAL | cancelAppointmentTool exists and is wired; but **CR-03 notification failure masks success** leaves user confused | Fix CR-03 |
| BOOK-03: Client checks availability before booking | Complete | ⚠️ PARTIAL | checkAvailability exists with correct slot logic; but **CR-05 invalid times from preprocessor** break the use case for ordinary Greek phrases | Fix CR-05 |
| BOOK-04: Client reschedules via chat | Complete | ⚠️ PARTIAL | rescheduleAppointmentTool exists; but **CR-03 notification failure masks success**; also **CR-02 affects idempotency** | Fix CR-03, CR-02 |
| ASK-01: Client asks about hours/location/prices and gets answer | Complete | ✓ VERIFIED | AI system prompt includes business details; Gemini function-calling loop allows general questions; tests pass | None |
| ASK-02: Client asks general freeform questions, bot answers best-effort | Complete | ⚠️ PARTIAL | Gemini conversation is wired; but **CR-01 unbounded loop** can hang if model gets stuck | Fix CR-01 |
| OWNR-02: Owner receives alert and can accept/reject | Complete | ⚠️ PARTIAL | Owner alerts sent with keyboard buttons; callback_query handler processes approvals; but **WR-05 concurrent-tap race** allows duplicate notifications; **CR-04 batch notification abort** can permanently lose alerts for expiry sweep | Fix WR-05, CR-04 |

---

## Code Review Findings (Priority)

Per 02-REVIEW.md, 6 CRITICAL + 6 WARNING findings. All 6 CRITICAL findings directly violate phase goal and are documented as gaps above:

- **CR-01**: Unbounded tool-call loop → gaps_found
- **CR-02**: Multi-tool idempotency broken → gaps_found
- **CR-03**: Notification failure masks success → gaps_found
- **CR-04**: Batch notification abort → gaps_found
- **CR-05**: Invalid 24-hour times → gaps_found
- **CR-06**: Rate-limit '' vs null bug → gaps_found

Additionally, **WR-05** (concurrent callback_query race) is a correctness bug that makes the owner-approval surface vulnerable to duplicate notifications and is documented in behavior_unverified.

---

## Summary: Why Phase Goal Is Not Achieved

The phase goal explicitly states: **"with owners alerted in real time and no double-bookings, even under concurrent requests."**

**Double-booking guarantee VIOLATED:**
- CR-02: Two book_appointment calls in one turn both succeed but are misreported as one, violating atomicity.
- WR-05: Concurrent callback_query taps can both proceed past the status check.

**Real-time alerting guarantee VIOLATED:**
- CR-03: Notification failures mask successful bookings, confusing both user and owner.
- CR-04: One failed Telegram send during expiry sweep permanently silences remaining alerts in batch.
- CR-01: Unbounded loop can hang webhook, message never answered or alerted.

**Reliability under concurrent requests VIOLATED:**
- CR-02, WR-05: Multiple race conditions when concurrent operations interleave.
- CR-04: Batch failure cascades to subsequent bookings.

The core ROADMAP Success Criterion 5 cannot be verified: **"two clients attempting to book the exact same slot at the same time never both succeed — one is told the slot is already taken."**

---

## Deferred Items

No deferred items. All identified gaps are action items for Phase 2 closure or a follow-up remediation phase.

---

_Verified: 2026-07-08T17:30:00Z_
_Verifier: Claude (gsd-verifier)_
_Verification Mode: Goal-Backward (phase-completion check; code review findings integrated)_
