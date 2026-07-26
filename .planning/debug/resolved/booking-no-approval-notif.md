---
status: resolved
trigger: "Check database for bookings. I tried booking from a client, it said it successfully booked but admin received no notification for approval of the booking and searching for appointments returns nothing"
created: 2026-07-26T00:00:00Z
updated: 2026-07-26T13:45:00Z
---

## Current Focus
<!-- OVERWRITE on each update - always reflects NOW -->

hypothesis: "CONFIRMED and FIXED — handleBookSessionExecute() in src/telegram/handlers/client-menu.ts was missing an owner-notification call after a successful booking. Fix applied, type-checked, and verified with a red/green regression test (see Resolution below). Now awaiting human confirmation that this resolves the real-world symptom end-to-end."
next_action: "None — resolved. Live fly.io logs post-deploy (v23) show 'Νέα κράτηση μαθήματος 2026-07-27 10:00 — πελάτης: 8759542539' delivered to owner chatId 722591104. User confirmed via screenshot. Follow-up cosmetic/feature requests from this same conversation (client name vs telegram id, approve/deny buttons on this notification, delete-lessons admin action, persistent menu button, richer error diagnostics, QR invite generator) are OUT OF SCOPE for this debug session — captured separately for milestone/roadmap triage, not tracked here."

## reasoning_checkpoint

hypothesis: "handleBookSessionExecute() in client-menu.ts never notifies the owner on a successful client booking, because the owner-alert call was omitted when this function was written (unlike its sibling handleCancelExecute in the same file, and unlike the AI-chat bookSessionTool in function-executor.ts, both of which include one)."
confirming_evidence:
  - "Direct DB query of the `bookings` table shows exactly 1 row (id=1, business_id=2, request_id='cmenu:book:8759542539:1' — the 'cmenu:book:' prefix is only ever produced by handleBookSessionExecute's idempotencyKey, confirming this exact code path ran), booking_status='confirmed', session_instance_id=1, and the joined session_instances row (id=1) shows booked_count=1 — i.e. the booking WAS correctly created and persisted end-to-end at the DB layer. This rules out 'booking never persisted' as the cause of 'no notification'."
  - "Read full source of handleBookSessionExecute (client-menu.ts lines 185-247): after bookSessionInstance() succeeds, the only side effects are two sendTelegramMessage() calls to the CLIENT (chatId) — no reference to business.ownerTelegramId or any owner-facing send anywhere in the function."
  - "Read full source of handleCancelExecute (client-menu.ts lines 347-437, same file): its cancellation-success path includes an explicit 'Owner notification — best-effort' block (lines 410-426) guarded by `if (business.ownerTelegramId && business.botToken)`, wrapped in `botTokenStore.run(business.botToken, ...)`, in a try/catch that only logs on failure. This is the established, working pattern for owner-facing notifications from this exact module."
  - "Read bookSessionTool in function-executor.ts (lines 666-676) — the AI-chat equivalent of the same 'client books a fixed session' action — and confirmed it DOES send `'Νέα κράτηση μαθήματος ...'` to `context.business.ownerTelegramId` as a best-effort block immediately after a successful booking. This confirms the intended/expected behavior for ALL session-booking entry points is to alert the owner, and client-menu.ts is the one path where it's missing."
falsification_test: "If handleBookSessionExecute is not the code path that ran (i.e. request_id in the bookings row did not have the 'cmenu:book:' prefix, or a second row existed with a 'confirmed' status and a call to alertOwnerNewBooking/owner sendTelegramMessage visible in that path's source), this hypothesis would be wrong. Confirmed request_id IS 'cmenu:book:8759542539:1' and the exact function was traced to have zero owner-facing sends — hypothesis holds."
fix_rationale: "The fix adds the missing owner-notification call directly at the root cause location (end of handleBookSessionExecute, after the booking is confirmed) rather than working around it elsewhere (e.g. a cron job scanning for un-notified bookings), and mirrors the exact best-effort pattern (try/catch, botTokenStore.run wrapper, ownerTelegramId null-guard) already proven to work in the same file's handleCancelExecute — minimizing risk of introducing a new defect and staying consistent with established conventions in this module."
blind_spots: "(1) Have not confirmed from fly.io production logs whether sendTelegramMessage/Telegram API calls ever throw for this business's bot token — the DB evidence proves the code path never even attempts a send, which is sufficient, but a live end-to-end Telegram delivery has not been re-verified with the fix in place (will do in verification step). (2) The 'searching for appointments returns nothing' half of the symptom is very likely explained separately and correctly: the only admin 'search' features found (Ατζέντα Σήμερα / view_todays_schedule) are hardcoded to calendarDate = today (Athens) only, and this booking's calendar_date is 2026-07-27 (tomorrow relative to created_at 2026-07-26) — so an admin checking 'today's agenda' on the 26th would correctly see nothing, independent of any bug. This is a plausible non-bug explanation for that half of the symptom, not fully proven by direct observation of what the user searched, but it's consistent with all DB evidence and does not contradict the confirmed root cause above. Will note this in the final report rather than 'fixing' a search feature that may already be working as designed."

## Symptoms
<!-- Written during gathering, then immutable -->

expected: Client books via chat -> bot confirms to client -> booking row exists in DB -> admin/owner receives a Telegram (or WhatsApp) notification to approve/reject the booking -> booking is then findable via the admin's appointment-search feature.
actual: Bot told the client the booking succeeded. Admin received NO approval notification. Searching for appointments (admin-side) returns nothing — implies either the booking was never persisted, or it was persisted but the search query/admin notification path isn't finding/sending it.
errors: Silent — no errors observed by the user in the chat or on their end. Not yet checked: fly.io application logs.
reproduction: Client sends a booking request via chat to the bot; bot replies with a success confirmation. Then: (1) admin checks for a pending-approval notification — none arrives; (2) admin (or someone) searches for appointments — returns empty.
started: Recently broke (per user) — implies this previously worked and something changed. Timeline of exact regression window not yet known.

## Eliminated
<!-- APPEND only - prevents re-investigating after /clear -->

## Evidence
<!-- APPEND only - facts discovered during investigation -->

- timestamp: 2026-07-26T13:10:00Z
  checked: "Neon `bookings` table directly via ad-hoc pg query (DATABASE_URL from .env.local)"
  found: "Exactly 1 row: id=1, business_id=2, client_phone='8759542539', calendar_date='2026-07-27', calendar_time='09:00', booking_status='confirmed', request_id='cmenu:book:8759542539:1', session_instance_id=1, owner_telegram_message_id=null, created_at='2026-07-26T12:47:44.328Z'"
  implication: "The booking WAS persisted correctly (rules out 'never inserted'). request_id prefix 'cmenu:book:' identifies this as having gone through handleBookSessionExecute() in src/telegram/handlers/client-menu.ts (Telegram client-menu flow for fixed_sessions businesses), not the AI-chat book_session tool. owner_telegram_message_id is null, consistent with no owner alert (with approve/reject keyboard) ever being sent for this row — though session bookings are auto-confirmed by design and don't use that keyboard/column anyway."
- timestamp: 2026-07-26T13:12:00Z
  checked: "businesses table for business_id=2 (BodyGlowPilatesTest)"
  found: "owner_telegram_id='722591104' (non-null, well-formed, no typos), booking_mode='fixed_sessions'"
  implication: "Rules out 'ownerTelegramId not configured' as the cause — the alert-skip guard (`if (!business.ownerTelegramId)`) used elsewhere in the codebase would not have applied to this business."
- timestamp: 2026-07-26T13:14:00Z
  checked: "session_instances row id=1 (joined via bookings.session_instance_id) plus session_catalog id=1"
  found: "session_instances id=1: session_date='2026-07-27', session_time='09:00', booked_count=1, is_cancelled=false. Matches booking exactly; booked_count correctly incremented from 0->1."
  implication: "Confirms bookSessionInstance() in src/session/manager.ts executed its full transaction correctly (capacity increment, booking insert) — the DB-layer booking logic is not the bug."
- timestamp: 2026-07-26T13:16:00Z
  checked: "Full read of src/telegram/handlers/client-menu.ts handleBookSessionExecute() (lines 185-247)"
  found: "After a successful bookSessionInstance() call, the function only sends 2 messages to the CLIENT (chatId) — a success confirmation and a 'what else' menu prompt. No reference anywhere in the function to business.ownerTelegramId or any owner-facing send."
  implication: "This is the code path that ran for this exact booking (per request_id prefix) and it structurally cannot notify the owner — root cause candidate confirmed by direct code read."
- timestamp: 2026-07-26T13:18:00Z
  checked: "Full read of sibling function handleCancelExecute() in the same file (lines 347-437), and bookSessionTool() in src/conversation/function-executor.ts (lines 660-678)"
  found: "handleCancelExecute has an explicit 'Owner notification — best-effort' block (lines 410-426): guarded by `if (business.ownerTelegramId && business.botToken)`, wrapped in `botTokenStore.run(business.botToken, async () => { await sendTelegramMessage(business.ownerTelegramId!, ownerText); })`, wrapped in try/catch that only logs on failure. bookSessionTool (the AI-chat equivalent booking flow) similarly sends a best-effort 'Νέα κράτηση μαθήματος ...' message to context.business.ownerTelegramId immediately after a successful booking."
  implication: "Confirms the intended design is for EVERY successful session-booking/cancellation code path to alert the owner, and that handleBookSessionExecute is the sole path missing it — an omission/asymmetry bug, not a broader architectural gap. Also gives the exact established pattern to replicate for the fix (including the botTokenStore.run wrapper, which cancel's own code path uses even though an outer botTokenStore.run(business.botToken,...) already wraps the whole webhook request in src/webhooks/telegram.ts line 848 — following convention rather than assuming the outer wrapper is sufficient)."
- timestamp: 2026-07-26T13:20:00Z
  checked: "Admin-side 'search for appointments' features: showTodaysAgenda() in src/telegram/handlers/admin-menu.ts and view_todays_schedule case in src/onboarding/ai-owner-agent.ts"
  found: "Both call listBookingsForDate(business.id, today, [...]) where `today = isoDateInAthens(new Date())` — i.e. both are hardcoded to TODAY's date only. No admin feature found that lists upcoming (non-today) bookings by client/date. This booking's calendar_date is 2026-07-27, one day after created_at 2026-07-26."
  implication: "If the admin checked 'Ατζέντα Σήμερα' / asked the owner-agent for today's schedule on 2026-07-26, it would correctly return 'no appointments today' since the booked session is for tomorrow — a plausible non-bug explanation for the second half of the reported symptom, distinct from the owner-notification bug. Not treating this as something to fix without further confirmation of what search the user actually performed."

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: "handleBookSessionExecute() in src/telegram/handlers/client-menu.ts (Telegram client-menu booking flow for fixed_sessions businesses) never sends an owner notification after a successful client booking. All other successful-booking/cancellation code paths in the codebase (handleCancelExecute in the same file, bookSessionTool in function-executor.ts, alertOwnerNewBooking for open_slots bookings) send a best-effort owner alert; this one path omits it. The booking itself is correctly persisted and capacity-tracked — this is purely a missing-notification bug, not a data-loss bug."
fix: "Added a best-effort owner-notification block to handleBookSessionExecute() (src/telegram/handlers/client-menu.ts), inserted right after the booking is confirmed successful and before the client-facing confirmation message. Mirrors the exact pattern already used by the sibling handleCancelExecute() in the same file: guarded by `if (business.ownerTelegramId && business.botToken)`, wrapped in `botTokenStore.run(business.botToken, ...)`, wrapped in try/catch that only logs on failure (never surfaces to the client or blocks the booking). Extended the existing serviceId-lookup DB query (which already joined sessionInstances + sessionCatalog) to also select sessionDate/sessionTime so the owner alert text can include them without an extra round-trip. Added 2 regression tests to tests/webhooks/client-menu.test.ts: (1) confirms owner IS notified with session date/time on successful booking — verified RED (failed) before the fix and GREEN (passed) after; (2) confirms the send is skipped without crashing when business.ownerTelegramId is null."
files_changed:
  - src/telegram/handlers/client-menu.ts
  - tests/webhooks/client-menu.test.ts
verification: "1) npx tsc --noEmit — clean, no type errors. 2) npx jest --testPathPattern tests/webhooks/client-menu.test.ts — all 26 tests pass (24 pre-existing + 2 new), including the pre-existing booking-success test which already exercised this exact code path with a business fixture that has both ownerTelegramId and botToken set. 3) TDD-style red/green check: stashed the src fix only, re-ran the new 'owner IS notified' test — it failed with 'Received: client456 (client confirmation) — owner123 was never called', confirming the test genuinely reproduces the bug; restored the fix, re-ran — passed. 4) npx jest --testPathPattern tests/client-escalation.test.ts — all 17 tests pass (no regression in the related escalation/owner-notification code this touches conceptually). 5) Live DB verification (direct query of business_id=2's bookings/session_instances rows) confirmed the underlying data layer (bookSessionInstance, capacity increment) was never the problem — only the missing notification call was."
