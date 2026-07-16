---
id: 260716-oaa
status: complete
date: 2026-07-16
commit: 14fe0d1
---

# Summary

Replaced keyword-gated owner routing with a Gemini-powered AI owner agent.

## What changed

- `src/onboarding/ai-owner-agent.ts` (new): Gemini agent for owner management. Tools: `update_hours`, `close_day`, `add_service`, `update_service_price`, `delete_service`, `view_todays_schedule`. System prompt includes current hours + services so Gemini knows the business state. Stateless (no conversation history — management ops are single-turn).

- `src/webhooks/telegram.ts`: Owner intercept changed from keyword-gated (`isOwnerEditCommand || hasPendingEditState`) to identity-gated (`ownerTelegramId === senderTelegramId`). Owner recognized on first message regardless of what they say.

- `src/onboarding/edit-router.ts`: `isOwnerEditCommand` kept (exported, referenced by tests) but `routeOwnerEdit` no longer called from telegram.ts. Also added accent-stripping via `remove-accents` so keyword detection works without tonos.

## Test fixes (pre-existing regressions)

- `tests/ai-agent.test.ts`: `HOURS` fixture missing `openTime2`/`closeTime2` (split-hours schema from 0005 migration)
- `tests/scheduler-agenda.test.ts`: `makeBusiness()` had `botToken: null` → agenda sweep skipped businesses; `botTokenStore.run` not mocked as call-through → `sendTelegramMessage` never executed

## Result

235/235 tests pass. Owner can now message the bot naturally in any phrasing ("αλλαξε τη δευτερα 9-5", "προσθες pilates 30 λεπτα 20 ευρω") and Gemini handles it.
