---
phase: 04-per-bot-foundation
reviewed: 2026-07-11T00:00:00Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - migrations/0003_phase4_per_bot.sql
  - package.json
  - src/config.ts
  - src/database/db.ts
  - src/database/queries.ts
  - src/database/schema.ts
  - src/database/seed.ts
  - src/telegram/client.ts
  - src/telegram/registry.ts
  - src/utils/logger.ts
  - src/webhooks/telegram.ts
  - tests/ai-agent.test.ts
  - tests/calendar-poller.test.ts
  - tests/calendar-sync.test.ts
  - tests/config.test.ts
  - tests/consent.test.ts
  - tests/conversation-router.test.ts
  - tests/expiry-poller.test.ts
  - tests/fixtures.test.ts
  - tests/function-executor.test.ts
  - tests/idempotency.test.ts
  - tests/jest.setup.ts
  - tests/rls-enforcement.test.ts
  - tests/scheduler-agenda.test.ts
  - tests/telegram-webhook.test.ts
  - tests/webhook.test.ts
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

Phase 04 introduces per-bot multi-tenant infrastructure: each business gets its own Telegram bot token and webhook URL, RLS is tightened with a `randevuclaw_app` database role, and the webhook handler is refactored to route by `webhookId` UUID. The architecture design is sound — `botTokenStore` + `withBusinessContext` + `AsyncLocalStorage` is the right shape for per-request token isolation, and the constant-time HMAC secret check is implemented correctly.

Three blockers are present, all of which are invisible to the test suite because tests mock both `queries` and `telegramClient` in full:

1. The migration is missing a `GRANT` on `telegram_updates` for the new `randevuclaw_app` role, causing a `permission denied` crash on every Telegram webhook in production once `DATABASE_APP_URL` is configured.
2. Both background pollers (`expiry-poller`, `agenda`) call `sendTelegramMessage` without setting `botTokenStore` context, so all owner/client notifications from pollers silently fail in production with a confusing "Not Found" response from Telegram.
3. The migration hardcodes the literal string `'CHANGE_ME_USE_FLY_SECRETS'` as the `randevuclaw_app` password in version-controlled SQL.

---

## Critical Issues

### CR-01: `telegram_updates` table missing from `randevuclaw_app` GRANTs — all Telegram webhook processing fails in production

**File:** `migrations/0003_phase4_per_bot.sql:168-174`

**Issue:** Section 4 of the migration grants SELECT/INSERT/UPDATE/DELETE on seven tables to `randevuclaw_app`, but `telegram_updates` is not among them. The comment in Section 2 explains that `telegram_updates` is excluded from RLS policies (intentional), but there is no corresponding explanation for why it is also absent from the GRANT block — and that absence is a bug, not a design choice.

In `src/database/queries.ts`, both `insertOrIgnoreTelegramUpdate` (line 473) and `markTelegramUpdateProcessed` (line 503) call `getConn()`. Inside `withBusinessContext`, `getConn()` returns the live `appDb` transaction, which runs as `randevuclaw_app`. In `src/webhooks/telegram.ts`, these functions are called on lines 253 and 58 respectively — both inside the `withBusinessContext(business.id, ...)` callback at line 243. PostgreSQL will throw `ERROR: permission denied for table telegram_updates` on the very first business-logic call (`insertOrIgnoreTelegramUpdate`) for every incoming Telegram update.

The outer try/catch at line 283 of `telegram.ts` catches this exception and logs "Telegram webhook handler failed", and the `finally` block returns 200 to Telegram. Telegram receives 200, marks the update as delivered, and never retries. **Every Telegram webhook is silently consumed and discarded.**

This is invisible in CI because `tests/telegram-webhook.test.ts` mocks `withBusinessContext` to call through synchronously (line 169) and mocks all of `queries`, so the actual `appDb` transaction is never exercised. The bug only manifests when `DATABASE_APP_URL` is configured — the intended production state for this phase.

**Fix:**
```sql
-- Add after line 174 in migrations/0003_phase4_per_bot.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON telegram_updates TO randevuclaw_app;
```

Also add a test to `tests/rls-enforcement.test.ts` that exercises `insertOrIgnoreTelegramUpdate` via `appDb` to prevent regression.

---

### CR-02: All background pollers send Telegram messages without `botTokenStore` context — all poller-initiated notifications silently fail

**Root cause file:** `src/telegram/client.ts:23`

**Issue:** `callTelegramApi` reads the bot token with a silent empty-string fallback:
```typescript
const botToken = botTokenStore.getStore() ?? '';
const url = `https://api.telegram.org/bot${botToken}/${method}`;
```
When no context is set, the URL becomes `https://api.telegram.org/bot/sendMessage`. The Telegram API returns `{"ok":false,"description":"Not Found"}` with HTTP 404. The exception is caught by each poller's per-business `try/catch` and logged as `'Expiry sweep failed for business'` / `'Agenda sweep failed for business'` — without any indication of the true cause.

Both pollers confirmed affected:
- `src/conversation/expiry-poller.ts:41` — `sendTelegramMessage(booking.clientPhone, ...)` with no `botTokenStore.run()` wrapper
- `src/scheduler/agenda.ts:89` — `sendTelegramMessage(business.ownerTelegramId, ...)` with no `botTokenStore.run()` wrapper

The test suites mock `telegramClient` entirely (`jest.mock('../src/telegram/client')`) so the empty-token path is never reached in CI.

In the per-bot architecture, each business has a distinct `botToken` on its row. The pollers already retrieve the business object (and thus have access to `business.botToken`). The missing step is wrapping the send with `botTokenStore.run(business.botToken, ...)`.

**Fix — two parts:**

Part 1 — fail fast in `src/telegram/client.ts:23` to make miscalls obvious:
```typescript
const botToken = botTokenStore.getStore();
if (!botToken) {
  throw new Error(
    'Bot token missing: callTelegramApi must be called inside botTokenStore.run()'
  );
}
const url = `https://api.telegram.org/bot${botToken}/${method}`;
```

Part 2 — in `expiry-poller.ts` and `agenda.ts`, wrap Telegram calls with the business's token:
```typescript
// After: const business = await findBusinessById(businessId);
if (!business?.botToken) continue; // skip if no bot configured
await botTokenStore.run(business.botToken, async () => {
  await sendTelegramMessage(booking.clientPhone, EXPIRY_NOTICE_GREEK);
  // ... edit markup ...
});
```

---

### CR-03: Hardcoded placeholder credential for `randevuclaw_app` in version-controlled migration

**File:** `migrations/0003_phase4_per_bot.sql:26`

**Issue:**
```sql
CREATE ROLE randevuclaw_app WITH LOGIN PASSWORD 'CHANGE_ME_USE_FLY_SECRETS';
```
The literal string `'CHANGE_ME_USE_FLY_SECRETS'` is checked into the repository as the initial password for the application database role. Anyone with read access to the repository — now or in the future — knows this password. If a developer applies the migration on a fresh Neon database without separately issuing `ALTER ROLE randevuclaw_app PASSWORD '...'`, the role is left with this widely-known credential in production. The `IF NOT EXISTS` guard means the mistake is permanent until explicitly corrected; re-running the migration does not fix it.

**Fix:** Remove the `PASSWORD` clause from the `CREATE ROLE` statement. Document a mandatory post-migration step in a separate script or README section:
```sql
-- In migrations/0003_phase4_per_bot.sql, replace line 26 with:
CREATE ROLE randevuclaw_app WITH LOGIN;
```
Then provision the password exclusively at deployment time:
```bash
# fly.io deployment — run once after migration:
psql "$DATABASE_URL" -c "ALTER ROLE randevuclaw_app PASSWORD '$DATABASE_APP_PASSWORD';"
# where DATABASE_APP_PASSWORD is stored only in fly secrets
```

---

## Warnings

### WR-01: Dead `TELEGRAM_WEBHOOK_SECRET` env var and stale comment in test setup

**File:** `tests/jest.setup.ts:13-16`

**Issue:**
```typescript
// Note: TELEGRAM_WEBHOOK_SECRET intentionally kept until Plan 04-04 refactors
// src/webhooks/telegram.ts to use per-bot DB lookup. The handler currently
// reads process.env.TELEGRAM_WEBHOOK_SECRET as a bridge (D-08 comment in telegram.ts).
process.env.TELEGRAM_WEBHOOK_SECRET ??= 'test-telegram-webhook-secret';
```
Phase 04 is complete. `src/webhooks/telegram.ts` no longer reads `process.env.TELEGRAM_WEBHOOK_SECRET` at any point. No production code references this variable. The comment describes a transition state that no longer exists. This dead configuration misleads future maintainers into believing a global Telegram secret is still in use.

**Fix:** Remove lines 13-16 entirely.

---

### WR-02: `withBusinessContext` uses `as unknown as typeof db` to erase incompatible types

**File:** `src/database/queries.ts:83`

**Issue:**
```typescript
return currentTx.run(tx as unknown as typeof db, callback);
```
`tx` is a Drizzle `PgTransaction` (returned by `appDb.transaction()`), while `currentTx` is typed as `AsyncLocalStorage<typeof db>` (`NodePgDatabase`). The two are structurally different: `PgTransaction` exposes nested-transaction methods (`savepoint`, `rollback`) that do not exist on `NodePgDatabase`. The `as unknown as` double cast bypasses TypeScript's structural compatibility check. If a query function were to access a property that exists on `NodePgDatabase` but behaves differently on `PgTransaction` (or vice versa), TypeScript would provide no warning.

**Fix:** Declare a shared interface type that both `NodePgDatabase` and `PgTransaction` satisfy, and type `currentTx` against that interface rather than the concrete pool type:
```typescript
// Both NodePgDatabase and PgTransaction implement these methods
type QueryRunner = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;
const currentTx = new AsyncLocalStorage<QueryRunner>();
```

---

### WR-03: `answerCallbackQuery` fires before ownership check, sending false confirmation text to non-owners

**File:** `src/webhooks/telegram.ts:99-107`

**Issue:** For a valid `approve_42` payload, `answerCallbackQuery` is called with `OWNER_APPROVE_ACK_GREEK` ("Το ραντεβού επιβεβαιώθηκε.") before the booking lookup or ownership verification happens. If a non-owner's Telegram client somehow sends this callback — or if `senderTelegramId` is spoofed — the user sees "The appointment was confirmed" in the Telegram spinner, even though the ownership check subsequently blocks all mutations and no booking is confirmed. The booking is safe (the atomic `updateBookingStatusIfPending` is never reached), but the visible acknowledgment text is false.

**Fix:** Answer with no text unconditionally, then show the action-specific text only once ownership is confirmed and the atomic update succeeds:
```typescript
// Dismiss the spinner immediately with no text
await answerCallbackQuery(callbackQuery.id);
if (!parsed) { logger.warn(...); return; }

// ... ownership check + updateBookingStatusIfPending ...
// Only if updated is non-null (won the race):
await answerCallbackQuery(
  callbackQuery.id,
  parsed.action === 'approve' ? OWNER_APPROVE_ACK_GREEK : OWNER_REJECT_ACK_GREEK
);
```
Note: Telegram's `answerCallbackQuery` can be called multiple times on the same `callback_query_id`; the last one with a non-empty text wins.

---

### WR-04: `insertConversationTurn` returns `rows[0]` typed as non-nullable but can be `undefined`

**File:** `src/database/queries.ts:463-464`

**Issue:**
```typescript
const rows = await getConn().insert(conversationTurns).values(values).returning();
return rows[0];
```
The declared return type is `Promise<ConversationTurn>`. `rows[0]` is `ConversationTurn | undefined`. If the INSERT returns an empty array (e.g., a future unique constraint is added to `conversation_turns`, or a bug causes a silent conflict), `rows[0]` is `undefined` at runtime but typed as `ConversationTurn`. Every caller will dereference `undefined` without TypeScript warning.

**Fix:**
```typescript
if (!rows[0]) throw new Error('insertConversationTurn: INSERT returned no row');
return rows[0];
```

---

## Info

### IN-01: `generateSlug` replaces Greek characters with hyphens — `remove-accents` is unused

**File:** `src/database/seed.ts:12-29`

**Issue:** The slug generator applies `/[^a-z0-9]+/g` after `.toLowerCase()`. Greek characters (e.g., "Πιλάτες Αθήνα") survive `.toLowerCase()` as Unicode but are all replaced by hyphens, producing an empty base slug after `/^-+|-+$/g` trims them. The `remove-accents` package is listed in `package.json:29` but is never imported in this file. Phase 4 uses English fixture names, so no failure is observed, but any production business with a Greek name will get a broken slug.

**Fix:**
```typescript
import removeAccents from 'remove-accents';
// In generateSlug:
const base = removeAccents(name)
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');
```

---

### IN-02: `bot.handleUpdate(update as any)` is a no-op with a suppressed type error

**File:** `src/webhooks/telegram.ts:268`

**Issue:**
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
await bot.handleUpdate(update as any);
```
No Telegraf middleware is attached in Phase 4, making this a guaranteed no-op that still makes an async call. The `as any` cast silences a legitimate TypeScript error: the locally-defined `TelegramUpdate` interface is not structurally compatible with Telegraf's internal `Update` type. The comment claims this "validates the update structure," but Telegraf's `handleUpdate` does not reject structurally invalid payloads — it just dispatches middleware. With no middleware, the call does nothing.

**Fix:** Remove the call entirely. If Telegraf's dispatch is genuinely needed for a future middleware, import and use Telegraf's `Update` type to eliminate the `any` cast at that point.

---

### IN-03: `rls-enforcement.test.ts` does not test `telegram_updates` table permissions

**File:** `tests/rls-enforcement.test.ts`

**Issue:** The two integration tests cover RLS isolation for `messages` and `businesses` only. The missing GRANT on `telegram_updates` (CR-01) is not tested. A minimal additional test case that calls `insertOrIgnoreTelegramUpdate` via `appDb` (or attempts a direct INSERT into `telegram_updates` as `randevuclaw_app`) would have caught this regression before ship.

**Fix:** Add a third test case within the `DATABASE_APP_URL` guard:
```typescript
test('randevuclaw_app can INSERT into telegram_updates (no RLS, but grant required)', async () => {
  await expect(
    appDb.insert(telegramUpdates).values({
      updateId: 'rls-t3-tg-1',
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
