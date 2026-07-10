---
status: done
area: uat
date: 2026-07-10
---

## UAT session 2026-07-10 — bugs found and fixed

Manual Telegram testing revealed two bugs, both fixed in commit b3b59cd:

### Bug 1: Session not persisted between messages
Every message re-ran business slug extraction. Follow-up messages
("νεα κρατηση") had no slug → "business not found" reply.

**Fix:** `findLatestBusinessForClient(senderTelegramId)` fallback in
`src/webhooks/telegram.ts` — looks up existing `client_business_relationships`
row when no slug in message text.

### Bug 2: AI asked client for booking_id on cancel/reschedule
No `list_client_bookings` tool existed. AI correctly said it couldn't
list bookings, then asked for a booking_id the client doesn't know.

**Fix:** Added `list_client_bookings` tool end-to-end:
- `listClientBookings()` query in queries.ts
- Tool handler in function-executor.ts
- Tool definition + system prompt rule in ai-agent.ts

### Still open (for next milestone)
- AI conversation loop goes in circles when client gives vague booking
  intent — may be Gemini Interactions API `previous_interaction_id`
  context chain not synthesizing multi-turn context well enough.
  Needs investigation with server logs.
- Google Calendar OAuth not provisioned — run:
  `npm run setup-calendar -- --business-slug pilates-athens`
- Meta Business Verification not submitted.
