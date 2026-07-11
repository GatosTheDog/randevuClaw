---
phase: 04-per-bot-foundation
fixed_at: 2026-07-11T12:30:00Z
review_path: .planning/phases/04-per-bot-foundation/04-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 04: Code Review Fix Report

**Fixed at:** 2026-07-11T12:30:00Z
**Source review:** .planning/phases/04-per-bot-foundation/04-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7 (3 Critical, 4 Warning; Info excluded per fix_scope=critical_warning)
- Fixed: 7
- Skipped: 0

## Fixed Issues

### CR-02: Hardcoded placeholder credential for `randevuclaw_app`

**Files modified:** `migrations/0003_phase4_per_bot.sql`
**Commit:** 8634622
**Applied fix:** Replaced `CREATE ROLE randevuclaw_app WITH LOGIN PASSWORD 'CHANGE_ME_USE_FLY_SECRETS';` with `CREATE ROLE randevuclaw_app WITH LOGIN;`. The password must now be provisioned at deployment time via `ALTER ROLE randevuclaw_app PASSWORD '$DATABASE_APP_PASSWORD';` using a value stored only in fly secrets — never committed to version control.

---

### CR-01: `telegram_updates` missing from `randevuclaw_app` GRANTs

**Files modified:** `migrations/0003_phase4_per_bot.sql`
**Commit:** 72a82f8
**Applied fix:** Added `GRANT SELECT, INSERT, UPDATE, DELETE ON telegram_updates TO randevuclaw_app;` after the existing grant block in Section 4 of the migration. Added an explanatory comment noting that `telegram_updates` is excluded from RLS (nullable businessId) but still needs CRUD access for the app role.

---

### CR-03: Background pollers call `sendTelegramMessage` without `botTokenStore` context

**Files modified:** `src/telegram/client.ts`, `src/conversation/expiry-poller.ts`, `src/scheduler/agenda.ts`
**Commit:** 0084dd9
**Applied fix (3 parts):**

Part 1 (`src/telegram/client.ts`): Changed `botTokenStore.getStore() ?? ''` to a hard throw when no context is active — `'callTelegramApi called without botTokenStore context — wrap the call in botTokenStore.run(business.botToken, ...)'`. Silent empty-string fallback is removed; miscalls now surface immediately.

Part 2 (`src/conversation/expiry-poller.ts`): Added `botTokenStore` to imports. Moved `findBusinessById` call to the top of the per-business loop (before the booking iteration) so `botToken` and `ownerTelegramId` are available for all Telegram calls. Added a guard that skips the whole notification batch if `business.botToken` is absent. Wrapped `sendTelegramMessage` and `editTelegramMessageReplyMarkup` inside `botTokenStore.run(business.botToken, async () => { ... })`.

Part 3 (`src/scheduler/agenda.ts`): Added `botTokenStore` to imports. Added a guard after the existing `!business?.ownerTelegramId` check that skips and logs a warning if `business.botToken` is absent. Wrapped `sendTelegramMessage` in `botTokenStore.run(business.botToken, async () => { ... })` using a local `ownerTelegramId` variable for clarity.

---

### WR-01: `answerCallbackQuery` sends action-specific text before ownership verified

**Files modified:** `src/webhooks/telegram.ts`
**Commit:** 36cdac8
**Applied fix:** Changed `answerCallbackQuery(callbackQuery.id, parsed ? (...ACK_TEXT...) : undefined)` to `answerCallbackQuery(callbackQuery.id)` — no text argument. The spinner is dismissed immediately (preserving the required Telegram UX), but no action-specific confirmation text is shown until ownership and CAS both succeed. Added a comment explaining the WR-01 rationale.

---

### WR-02: `insertConversationTurn` declares non-nullable return but `rows[0]` can be `undefined`

**Files modified:** `src/database/queries.ts`
**Commit:** eb7d41c
**Applied fix:** Added `if (!rows[0]) throw new Error('insertConversationTurn: INSERT returned no row — constraint violation or trigger?');` before `return rows[0];`. TypeScript now correctly treats the return as `ConversationTurn` (non-undefined) and the runtime throws an actionable error rather than returning a silently undefined object.

---

### WR-03: Unhandled Telegram update types corrupt `telegram_updates` dedup log

**Files modified:** `src/webhooks/telegram.ts`
**Commit:** 0ceb2b8
**Applied fix:** Moved `const updateId = String(update.update_id);` to Step 4 (before `botTokenStore.run`) so it is available for the early exit log. Added an early-exit guard immediately after the update parsing:
```typescript
if (!update.message && !update.callback_query) {
  logger.info(
    { updateId, updateType: Object.keys(update).filter((k) => k !== 'update_id') },
    'Unsupported Telegram update type, ignoring'
  );
  res.status(200).send('OK');
  return;
}
```
This runs before `botTokenStore.run` and `withBusinessContext` are entered, so `res.status(200).send('OK')` and `return` operate on the outer `handleTelegramWebhookPost` function as intended. Removed the duplicate `const updateId` from inside the `withBusinessContext` callback (now closes over the outer declaration).

---

### WR-04: Dead function and stale imports in `telegram.ts`

**Files modified:** `src/webhooks/telegram.ts`
**Commit:** 3af56eb
**Applied fix:** Removed the following dead code:
- Import of `extractAndNormalizeAllBusinessCodeCandidates` from `'../business/resolver'`
- `findBusinessBySlug` and `findLatestBusinessForClient` from the `'../database/queries'` import block
- Import of `BUSINESS_NOT_FOUND_REPLY_GREEK` from `'./whatsapp'` (only used in the dead function)
- `handleNotFoundBusiness` function (lines 64-70 in original)
- `OWNER_APPROVE_ACK_GREEK` and `OWNER_REJECT_ACK_GREEK` constants (became dead after WR-01 removed their only usage in `answerCallbackQuery`; removed as part of this dead-code sweep with an explanatory comment left in their place)

---

_Fixed: 2026-07-11T12:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
