---
phase: 04-per-bot-foundation
reviewed: 2026-07-11T12:00:00Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - migrations/0003_phase4_per_bot.sql
  - src/database/schema.ts
  - src/database/db.ts
  - src/config.ts
  - src/telegram/client.ts
  - src/webhooks/telegram.ts
  - src/utils/logger.ts
  - tests/config.test.ts
  - src/telegram/registry.ts
  - tests/jest.setup.ts
  - src/database/queries.ts
  - tests/ai-agent.test.ts
  - tests/calendar-poller.test.ts
  - tests/calendar-sync.test.ts
  - tests/consent.test.ts
  - tests/conversation-router.test.ts
  - tests/expiry-poller.test.ts
  - tests/function-executor.test.ts
  - tests/idempotency.test.ts
  - tests/scheduler-agenda.test.ts
  - tests/telegram-webhook.test.ts
  - tests/webhook.test.ts
  - src/database/seed.ts
  - tests/fixtures.test.ts
  - tests/rls-enforcement.test.ts
findings:
  critical: 3
  warning: 4
  info: 3
  total: 10
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-07-11
**Depth:** standard
**Files Reviewed:** 25
**Status:** issues_found

## Summary

Phase 04 introduces per-bot multi-tenant infrastructure: each business gets its own Telegram bot token and webhook URL, a `randevuclaw_app` database role enforces RLS, and the webhook handler routes by opaque `webhookId` UUID. The core architecture — `botTokenStore` + `withBusinessContext` + `AsyncLocalStorage` + constant-time HMAC verification — is correctly designed.

Three blockers are present. Two are rooted in the migration (`telegram_updates` permissions gap, hardcoded credential). The third affects every poller-initiated Telegram notification (expired booking alerts, daily agenda): `sendTelegramMessage` is called without a `botTokenStore` context, causing a silent "Not Found" failure on every outbound poller message. All three are invisible in CI because the test suite fully mocks `queries` and `telegramClient` modules and never exercises the `appDb` transaction path end-to-end.

Four warnings follow, including a false confirmation acknowledgment visible to non-owners, a nullable-typed return from `insertConversationTurn`, unhandled Telegram update types producing corrupted DB records, and dead production code left over from the Phase 2/3 webhook design.

---

## Critical Issues

### CR-01: `telegram_updates` table missing from `randevuclaw_app` GRANTs — every Telegram webhook silently fails in production

**File:** `migrations/0003_phase4_per_bot.sql:168-174`

**Issue:** Section 4 of the migration grants SELECT/INSERT/UPDATE/DELETE on seven tables to `randevuclaw_app`, but `telegram_updates` is absent from the GRANT block. Section 2 explains that `telegram_updates` is excluded from RLS policies (intentional), but there is no corresponding reason to also withhold table-level permissions from the app role.

In `src/database/queries.ts`, both `insertOrIgnoreTelegramUpdate` (line 473) and `markTelegramUpdateProcessed` (line 503) use `getConn()`. Inside `withBusinessContext`, `getConn()` returns the live `appDb` transaction, which runs as `randevuclaw_app`. In `src/webhooks/telegram.ts`, `insertOrIgnoreTelegramUpdate` is called at line 253 inside `withBusinessContext(business.id, ...)` at line 243. PostgreSQL raises `ERROR: permission denied for table telegram_updates` on the very first DB call for every incoming Telegram update.

The outer `try/catch` at `telegram.ts:283` catches this exception, logs "Telegram webhook handler failed", and the `finally` block returns 200 to Telegram. Telegram receives 200, marks the update as delivered, and never retries. Every Telegram webhook is silently swallowed with zero business logic executed.

This is invisible in CI because `tests/telegram-webhook.test.ts` mocks `withBusinessContext` to call through synchronously (line 169) and mocks all of `queries` at line 10, so the actual `appDb` transaction is never exercised. The bug only manifests when `DATABASE_APP_URL` is configured — the intended production state for this phase.

**Fix:**
```sql
-- Add after line 174 in migrations/0003_phase4_per_bot.sql
-- telegram_updates: excluded from RLS (nullable businessId), but app role still needs CRUD.
GRANT SELECT, INSERT, UPDATE, DELETE ON telegram_updates TO randevuclaw_app;
```

Also add a case to `tests/rls-enforcement.test.ts` that inserts into `telegram_updates` via `appDb` to prevent future regressions (see IN-03).

---

### CR-02: Hardcoded placeholder credential for `randevuclaw_app` committed to version control

**File:** `migrations/0003_phase4_per_bot.sql:26`

**Issue:**
```sql
CREATE ROLE randevuclaw_app WITH LOGIN PASSWORD 'CHANGE_ME_USE_FLY_SECRETS';
```
The literal string `'CHANGE_ME_USE_FLY_SECRETS'` is the initial password for the application database role, committed in version-controlled SQL. Anyone with repository read access — now or in perpetuity — knows this credential. If a developer applies the migration on a fresh Neon database without separately running `ALTER ROLE randevuclaw_app PASSWORD '...'`, the role is left with this publicly-known credential in production. The `IF NOT EXISTS` guard means the mistake is permanent until explicitly corrected; re-running the migration does not fix it.

**Fix:** Remove the `PASSWORD` clause from the `CREATE ROLE` statement and provision the credential exclusively at deployment time, outside version control:
```sql
-- migrations/0003_phase4_per_bot.sql line 26: replace with:
CREATE ROLE randevuclaw_app WITH LOGIN;
```
Then provision the password as a deployment step:
```bash
# Run once after migration, using a value stored only in fly secrets:
psql "$DATABASE_URL" -c "ALTER ROLE randevuclaw_app PASSWORD '$DATABASE_APP_PASSWORD';"
```

---

### CR-03: Background pollers call `sendTelegramMessage` without `botTokenStore` context — all poller-initiated Telegram notifications fail silently in production

**Root cause file:** `src/telegram/client.ts:23`

**Issue:** `callTelegramApi` reads the bot token with a silent empty-string fallback:
```typescript
const botToken = botTokenStore.getStore() ?? '';
const url = `https://api.telegram.org/bot${botToken}/${method}`;
```
When no `botTokenStore.run()` context is active, the URL becomes `https://api.telegram.org/bot/sendMessage`. Telegram returns HTTP 404 with `{"ok":false,"description":"Not Found"}`. The exception propagates into each poller's per-business `try/catch`, which logs a sweep failure with no indication of the true root cause, increments no counter, and continues to the next business.

Evidence that the background pollers do not wrap their Telegram calls in `botTokenStore.run()` is structural: `tests/expiry-poller.test.ts` and `tests/scheduler-agenda.test.ts` both auto-mock `telegramClient` entirely via `jest.mock('../src/telegram/client')`. Under this auto-mock, `botTokenStore.run` becomes a `jest.fn()` that does nothing (does not invoke the callback). If the production poller code wrapped `sendTelegramMessage` inside `botTokenStore.run(business.botToken, callback)`, the mock would suppress the callback and `sendTelegramMessage` would never be called — but the tests assert it IS called. The tests pass only because the production code calls `sendTelegramMessage` directly, outside any `botTokenStore.run()` context.

In production with `DATABASE_APP_URL` set and per-bot tokens live, the following are silently broken:
- All expired-booking client notifications (`expiry-poller.ts` `sendTelegramMessage(booking.clientPhone, ...)`)
- All inline-keyboard button-clearing calls (`editTelegramMessageReplyMarkup`)
- All daily agenda messages to owners (`agenda.ts` `sendTelegramMessage(business.ownerTelegramId, ...)`)

**Fix — two parts:**

Part 1 — fail fast in `src/telegram/client.ts:23` to surface miscalls immediately:
```typescript
const botToken = botTokenStore.getStore();
if (!botToken) {
  throw new Error(
    'callTelegramApi called without botTokenStore context — wrap the call in botTokenStore.run(business.botToken, ...)'
  );
}
const url = `https://api.telegram.org/bot${botToken}/${method}`;
```

Part 2 — in `expiry-poller.ts` and `agenda.ts`, wrap each Telegram send with the business's token retrieved from the `findBusinessById` result already in scope:
```typescript
// Business row is already available; wrap the send block:
if (!business?.botToken) {
  logger.warn({ businessId }, 'No bot token for business, skipping Telegram notification');
  continue;
}
await botTokenStore.run(business.botToken, async () => {
  await sendTelegramMessage(booking.clientPhone, EXPIRY_NOTICE_GREEK);
  if (booking.ownerTelegramMessageId) {
    await editTelegramMessageReplyMarkup(ownerTelegramId, booking.ownerTelegramMessageId, []);
  }
});
```

---

## Warnings

### WR-01: `answerCallbackQuery` sends action-specific text to the caller before ownership is verified

**File:** `src/webhooks/telegram.ts:96-107`

**Issue:**
```typescript
await answerCallbackQuery(
  callbackQuery.id,
  parsed ? (parsed.action === 'approve' ? OWNER_APPROVE_ACK_GREEK : OWNER_REJECT_ACK_GREEK) : undefined
);
```
`OWNER_APPROVE_ACK_GREEK` is "Το ραντεβού επιβεβαιώθηκε." The ownership check happens afterwards (lines 119-127). A non-owner who crafts a callback query with `approve_42` data sees "The appointment was confirmed" in the Telegram spinner popup before the handler has verified they own the booking. The booking itself is safe — `updateBookingStatusIfPending` is never reached — but the visual acknowledgment is false and misleading.

**Fix:** Dismiss the spinner with no text first, then send the action-specific text only after the atomic update confirms the caller won the race:
```typescript
// Dismiss spinner immediately — no text until ownership + CAS both succeed
await answerCallbackQuery(callbackQuery.id);
if (!parsed) { logger.warn(...); return; }

// ... ownership check ... updateBookingStatusIfPending ...
// After `updated` is confirmed non-null:
// (Note: a second answerCallbackQuery on the same callback_query_id replaces the first popup)
```

---

### WR-02: `insertConversationTurn` declares a non-nullable return type but `rows[0]` can be `undefined`

**File:** `src/database/queries.ts:463-464`

**Issue:**
```typescript
const rows = await getConn().insert(conversationTurns).values(values).returning();
return rows[0];
```
The function signature is `Promise<ConversationTurn>`. `rows[0]` is `ConversationTurn | undefined` at runtime. If the INSERT produces an empty `RETURNING` array — e.g., a future unique constraint is added to `conversation_turns`, a trigger silently discards the row, or a Drizzle version change alters `RETURNING` behavior — `rows[0]` is `undefined` while TypeScript reports `ConversationTurn`. Every caller receives an `undefined` object typed as a concrete struct; dereferences of `.id`, `.interactionId`, etc. are silent crashes.

**Fix:**
```typescript
const rows = await getConn().insert(conversationTurns).values(values).returning();
if (!rows[0]) throw new Error('insertConversationTurn: INSERT returned no row — constraint violation or trigger?');
return rows[0];
```

---

### WR-03: Unhandled Telegram update types produce an empty `senderTelegramId` and a misclassified `updateType` in `telegram_updates`

**File:** `src/webhooks/telegram.ts:244-249`

**Issue:**
```typescript
const senderTelegramId = String(
  update.message?.from.id ?? update.callback_query?.from.id ?? ''
);
const updateType = update.message ? 'message' : 'callback_query';
```
Telegram delivers update types beyond `message` and `callback_query`: `edited_message`, `channel_post`, `inline_query`, `poll`, `my_chat_member`, etc. For any of these, both optional chains resolve to `undefined`, so `senderTelegramId` becomes `''` and `updateType` becomes `'callback_query'` (the else branch of the ternary). The row inserted into `telegram_updates` has a blank sender ID and the wrong type, corrupting the dedup log. If any such update has an `update_id` that collides with a legitimate update (unlikely but possible in edge cases), the dedup logic would suppress processing of the real update.

The schema marks `senderTelegramId` as `notNull()` but permits the empty string, so the INSERT succeeds silently.

**Fix:** Add an early guard before the dedup INSERT to reject or log-and-skip unsupported update types:
```typescript
if (!update.message && !update.callback_query) {
  logger.info({ updateId, updateType: Object.keys(update).filter(k => k !== 'update_id') },
    'Unsupported Telegram update type, ignoring');
  res.status(200).send('OK');
  return;
}
```

---

### WR-04: Dead function and stale imports in `telegram.ts` from the Phase 2/3 business-resolution design

**File:** `src/webhooks/telegram.ts:4-9, 64-70`

**Issue:** Three imports are never used in the Phase 4 webhook handler:
```typescript
import { extractAndNormalizeAllBusinessCodeCandidates } from '../business/resolver'; // line 4
import {
  findBusinessBySlug,          // line 8 — Phase 4 routes by webhookId, not slug
  findLatestBusinessForClient, // line 9 — not called anywhere in this file
  ...
} from '../database/queries';
```

Additionally, `handleNotFoundBusiness` (lines 64-70) is defined but never called. In Phase 4, an unknown `webhookId` returns 404 immediately (line 212); the "business not found" reply is only relevant for WhatsApp, not the per-bot Telegram flow. The dead function, if called by a future developer unfamiliar with the refactor, would attempt to send a message using the current `botTokenStore` context — but only if called from within `botTokenStore.run()`, making its behavior context-dependent and confusing.

**Fix:** Remove the three unused imports and the `handleNotFoundBusiness` function. If a "bot not found" message to the end user is ever desired, that logic belongs inside the handler at the point where the 404 is returned, not in a dead helper.

---

## Info

### IN-01: Stale `TELEGRAM_WEBHOOK_SECRET` env var and misleading comment in `tests/jest.setup.ts`

**File:** `tests/jest.setup.ts:13-16`

**Issue:**
```typescript
// Note: TELEGRAM_WEBHOOK_SECRET intentionally kept until Plan 04-04 refactors
// src/webhooks/telegram.ts to use per-bot DB lookup. The handler currently
// reads process.env.TELEGRAM_WEBHOOK_SECRET as a bridge (D-08 comment in telegram.ts).
process.env.TELEGRAM_WEBHOOK_SECRET ??= 'test-telegram-webhook-secret';
```
Phase 04 is complete. `src/webhooks/telegram.ts` no longer reads `process.env.TELEGRAM_WEBHOOK_SECRET` at any point; per-bot secrets are loaded from the DB via `findBusinessByWebhookId`. The comment describes a transition state that no longer exists. This dead configuration misleads future maintainers into believing a global Telegram webhook secret is still in use somewhere in the codebase.

**Fix:** Remove lines 13-16 from `tests/jest.setup.ts`.

---

### IN-02: `withBusinessContext` uses a double type-erasing cast to thread a `PgTransaction` as `NodePgDatabase`

**File:** `src/database/queries.ts:83`

**Issue:**
```typescript
return currentTx.run(tx as unknown as typeof db, callback);
```
`tx` is a Drizzle `PgTransaction`; `currentTx` is typed as `AsyncLocalStorage<typeof db>` (`NodePgDatabase`). `PgTransaction` and `NodePgDatabase` are not assignable because `PgTransaction` exposes savepoint/rollback APIs absent on `NodePgDatabase`. The `as unknown as` double-cast bypasses TypeScript's structural compatibility check. If a future query function accessed a property that behaves differently on the two types, TypeScript would provide no warning.

**Fix:** Declare a minimal shared interface that both types satisfy and type `currentTx` against it:
```typescript
type QueryRunner = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;
const currentTx = new AsyncLocalStorage<QueryRunner>();
```

---

### IN-03: `rls-enforcement.test.ts` truncates all businesses and messages without a guard against production `DATABASE_URL`

**File:** `tests/rls-enforcement.test.ts:48-53`

**Issue:**
```typescript
beforeEach(async () => {
  await db.delete(messages);
  await db.delete(businesses);
});
```
These are unbounded deletes on `db` (the admin/superuser connection from `DATABASE_URL`). The `DATABASE_APP_URL` skip guard at lines 37-46 prevents the RLS tests from running if the app-role URL is absent, but it does not prevent the destructive `beforeEach` from running if `DATABASE_URL` happens to point at the same Neon project used for production. A developer who sets `DATABASE_APP_URL` to a dedicated test role string but leaves `DATABASE_URL` pointing at the shared project DB would silently truncate all production businesses and messages.

**Fix:** Add an explicit assertion that `DATABASE_URL` contains a test-scoped indicator before proceeding with integration test cleanup:
```typescript
beforeAll(() => {
  if (!process.env.DATABASE_URL?.includes('test') && !process.env.DATABASE_URL?.includes('local')) {
    throw new Error(
      'RLS integration tests require a test-scoped DATABASE_URL (must contain "test" or "local")'
    );
  }
});
```
Alternatively, use a separate `TEST_DATABASE_URL` environment variable for integration tests, decoupled from `DATABASE_URL` entirely.

Additionally, add a test case to this file that verifies `randevuclaw_app` can INSERT into `telegram_updates` (exercising the GRANT gap in CR-01):
```typescript
test('randevuclaw_app can INSERT into telegram_updates (GRANT required, no RLS policy)', async () => {
  await expect(
    appDb.insert(telegramUpdates).values({
      updateId: 'rls-t3-tg-grant-check',
      businessId: null,
      senderTelegramId: '555',
      updateType: 'message',
      status: 'received',
    })
  ).resolves.not.toThrow();
});
```

---

_Reviewed: 2026-07-11_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
