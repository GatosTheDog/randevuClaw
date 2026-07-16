---
id: 260716-oaa
title: AI-powered owner agent — Gemini NLU for all owner commands
status: in_progress
date: 2026-07-16
---

# AI Owner Agent

## Goal
Route ALL owner messages through a Gemini-powered owner agent (not just keyword-matched ones). Owner is recognized on message 1 from their Telegram ID. Gemini does NLU → structured tool call → DB write → Greek reply.

## Problem
- Owner intercept gated on exact keyword match (`isOwnerEditCommand`) → owner's first message goes to client booking AI
- Keyword matching is brittle (accent bug just fixed, but free text still fails)
- Gemini already does heavy lifting for clients; owners need the same

## Tasks

### Task 1 — `src/onboarding/ai-owner-agent.ts` (new file)
Gemini agent for owner management. Pattern mirrors `src/conversation/ai-agent.ts`.

System prompt:
- "Είσαι ο διαχειριστικός βοηθός του ιδιοκτήτη της επιχείρησης [name]."
- Current hours + services injected (same as client agent)
- Today's date
- Owner can: update hours, add/update/delete services, view today's schedule

Tools (executed inline, not via function-executor.ts):
- `update_hours(day_of_week: int, open_time: str, close_time: str)` — upsert business_hours, isClosed=false
- `close_day(day_of_week: int)` — upsert business_hours with isClosed=true
- `add_service(name: str, price_cents: int, duration_min: int)` — insert services
- `update_service_price(service_name: str, new_price_cents: int)` — update services.price
- `delete_service(service_name: str)` — delete services by name
- `view_todays_schedule()` — list today's bookings with client + time + service + status

Returns `{ text: string }` — no interaction ID needed (stateless is fine for management ops).

### Task 2 — `src/webhooks/telegram.ts` (modify)
Change owner intercept from keyword-gated to identity-gated:

```ts
// BEFORE
if (
  business.ownerTelegramId === senderTelegramId &&
  (isOwnerEditCommand(messageText) || hasPendingEditState(business.id))
) {

// AFTER  
if (business.ownerTelegramId === senderTelegramId) {
```

Replace body: call `aiOwnerAgent(business, ownerTelegramId, messageText)` → send reply.
Remove imports: `isOwnerEditCommand`, `hasPendingEditState`, `routeOwnerEdit`.

## Files Changed
- `src/onboarding/ai-owner-agent.ts` (new)
- `src/webhooks/telegram.ts` (modify intercept)

## Out of Scope
- edit-router.ts stays (isOwnerEditCommand export referenced by tests)
- No conversation history for owner (stateless agent, management ops are single-turn)
- No changes to client booking path
