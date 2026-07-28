---
phase: 28-admin-menu-discoverability
reviewed: 2026-07-28T19:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/telegram/handlers/admin-menu.ts
  - tests/admin-menu.test.ts
  - src/telegram/handlers/pending-reply.ts
  - tests/pending-reply.test.ts
  - src/webhooks/telegram.ts
  - tests/telegram-webhook.test.ts
findings:
  critical: 2
  warning: 3
  info: 1
  total: 6
status: issues_found
---

# Phase 28: Code Review Report

**Reviewed:** 2026-07-28T19:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed the two 28-01/28-02 plans' changes: the `/menu` payment button + Settings example-phrase buttons in `admin-menu.ts`, and the new escalation-reply relay (`pending-reply.ts` + wiring in `telegram.ts`). The payment/example-phrase wiring (plan 28-01) is clean — correct callback ordering, correct argument order into `showClientSelection`, no interpolated/untrusted text in any new message body. The escalation reply-relay (plan 28-02) is where the real problems live: the new `pendingReplies` Map is keyed **only** by `ownerTelegramId`, but this exact codebase already documents (twice, in this same file) that one Telegram account can own multiple businesses — so the new Map has no business-scoping where every other piece of per-owner state in this file (business lookups, `pendingServicePriceChanges`, `pendingRenewalBatches`) is scoped to a specific business. Separately, the D-03 "clear on /menu or /start" requirement is only actually wired for the owner on `/menu` — the `/start` `clearPendingReply` call lives in a code path that is structurally unreachable for owners, so an owner typing `/start` while a reply is pending gets that literal text relayed to the escalating client instead of the pending reply being cancelled.

## Critical Issues

### CR-01: `pendingReplies` Map has no business scoping — cross-business relay leak when one owner Telegram ID governs multiple businesses

**File:** `src/telegram/handlers/pending-reply.ts:22-25`, `src/webhooks/telegram.ts:129-149`, `src/webhooks/telegram.ts:617-625`

**Issue:** `pendingReplies` is `Map<string /* ownerTelegramId */, { clientTelegramId, timer }>` — keyed purely by the owner's Telegram user ID, with no `businessId` in the key or the stored value. This file explicitly documents, twice, that this exact scenario is real and already guarded against elsewhere:

```
// src/webhooks/telegram.ts:548 and :639
// which has no uniqueness guarantee if one Telegram account owns multiple businesses.
```

Every other owner-scoped branch in this file (`menuAction`, `sbkAction`, `otcAction`) deliberately reuses the webhook-scoped `business` param (one business per bot/webhook) instead of re-deriving business from `senderTelegramId`, specifically because a single Telegram account can own more than one business (e.g. a pilot operator running two/three demo businesses on their own account, or in production, one owner who genuinely runs multiple locations). `pendingReplies`, however, has no such guard: it is a bare module-level `Map<string, ...>` keyed only by `ownerTelegramId`.

Concretely: if the same person owns Business A and Business B (two different bots/webhooks, same Telegram account), and taps "Απάντηση πελάτη" on an escalation from Business A (`stagePendingReply(ownerTelegramId, clientA)`), then — before replying — sends any ordinary free-text message to Business B's bot (a completely unrelated conversation, e.g. "πόσα μαθήματα έχω σήμερα"), `handleFoundBusiness` for Business B calls `consumePendingReply(senderTelegramId)`, which returns Business A's stale entry (there is nothing scoping it to Business A). The code then does:

```ts
await botTokenStore.run(business.botToken!, async () => {   // business === Business B here
  await sendTelegramMessage(pendingReply.clientTelegramId, messageText); // clientA, via Business B's bot
});
await sendTelegramMessage(senderTelegramId, 'Η απάντηση στάλθηκε.');
```

Business B's own bot ends up messaging a client who escalated to Business A, forwarding text the owner typed in a totally different business context — and the owner's actual message to Business B (e.g. an agenda query) is silently swallowed (never reaches `aiOwnerAgent`, since this branch returns early). This is a real cross-tenant state leak: content from one business's chat is delivered, via another business's bot identity, to a client of the first business who never interacted with the second.

The precedent this module claims to "mirror" (`pendingServicePriceChanges` in `ai-owner-agent.ts`) does not have this gap — it is keyed by `serviceId` (inherently unique per business) and stores `businessId` in the value explicitly. `pendingReplies` dropped that scoping.

**Fix:** Scope the Map key (or the stored value) to the business, and validate on consume:

```ts
// Key by a composite of businessId + ownerTelegramId (or store businessId in the value
// and check it in consumePendingReply before treating the entry as valid for this call).
export const pendingReplies = new Map<
  string, // `${businessId}:${ownerTelegramId}`
  { clientTelegramId: string; timer: ReturnType<typeof setTimeout> }
>();

export function stagePendingReply(businessId: number, ownerTelegramId: string, clientTelegramId: string): void {
  const key = `${businessId}:${ownerTelegramId}`;
  // ...unchanged overwrite/timer logic keyed on `key` instead of ownerTelegramId
}

export function consumePendingReply(businessId: number, ownerTelegramId: string): { clientTelegramId: string } | null {
  const key = `${businessId}:${ownerTelegramId}`;
  // ...
}
```

And update both call sites in `telegram.ts` (`stagePendingReply(senderTelegramId, escl.clientTelegramId)` and `consumePendingReply(senderTelegramId)`) to pass `business.id` (the webhook-scoped, HMAC-verified business already available at both call sites) alongside `senderTelegramId`.

---

### CR-02: D-03 ("/menu or /start clears a pending reply") is not actually reachable for owners — `/start` leaks the literal command text to the client

**File:** `src/webhooks/telegram.ts:83-168` (owner branch), `:171-201` (`/start` branch with the `clearPendingReply` call)

**Issue:** The phase's own decision D-03 states: *"The pending reply is cancelled by any `/menu` or `/start` tap."* The implementation only wires `clearPendingReply(senderTelegramId)` into the `/menu` pre-emption (line 113, inside the owner branch) and the `/start` pre-emption (line 180). But the `/start` pre-emption block is inside an `if (messageText.trim() === '/start')` check that sits **after** the owner branch's own `if (business.ownerTelegramId !== null && business.ownerTelegramId === senderTelegramId) { ... return; }` block — and that owner branch **always returns** before control ever reaches the `/start` check (every path inside it ends in `return;`: the onboarding branch, the `/menu` branch, the reply-relay branch, and the final `aiOwnerAgent` branch). The 28-02-SUMMARY.md itself acknowledges this:

> "/start's call is currently unreachable for owners (the owner branch always returns earlier) but included per D-03's literal wording and as a guard against future restructuring."

That acknowledgment treats it as a harmless dead-code inclusion, but it is not harmless: it means the owner-side half of D-03 was never implemented. Trace what actually happens if an owner has a reply staged (via `escl:reply`) and then types `/start` (a real, commonly-autocompleted Telegram command — not an obscure input) instead of their intended reply:

1. `business.ownerTelegramId === senderTelegramId` → enters the owner branch.
2. Onboarding already completed → falls through.
3. `messageText.trim() === '/menu'` → false (`/start` ≠ `/menu`) → falls through, `clearPendingReply` is never called.
4. `consumePendingReply(senderTelegramId)` → returns the still-staged entry.
5. The literal string `"/start"` is relayed **verbatim to the escalating client** via `sendTelegramMessage(pendingReply.clientTelegramId, messageText)`.
6. The owner is told `'Η απάντηση στάλθηκε.'` — a false-positive confirmation that their reply was sent, when in fact a stray Telegram command leaked to the client and the owner's real reply was never captured.

**Fix:** Clear the pending reply for the owner on `/start` too (not just `/menu`), inside the owner branch before the reply-relay intercept — e.g. extend the pre-emption check:

```ts
if (messageText.trim() === '/menu' || messageText.trim() === '/start') {
  await withBusinessContext(business.id, async () => {
    clearPendingReply(senderTelegramId);
    await showAdminRootMenu(senderTelegramId, business);
    await markTelegramUpdateProcessed(updateId, business.id);
  });
  return;
}
```
(or add a dedicated owner-side `/start` branch mirroring the `/menu` one). The existing `/start` block further down remains correct for non-owner clients but does nothing to satisfy D-03 for owners as written.

## Warnings

### WR-01: Navigating via an inline "back to menu" tap does not clear a pending reply — only the literal `/menu` text command does

**File:** `src/webhooks/telegram.ts:644-656` (`menuAction` callback branch)

**Issue:** D-03's intent ("navigating away cancels a stale pending reply") is only wired to the `/menu` **text** command inside `handleFoundBusiness`. Telegram does not clear old inline keyboards automatically — any previously-sent menu message (e.g. an earlier `/menu` root keyboard, or a Settings submenu) remains tappable unless this codebase explicitly clears it. If an owner has a reply staged and then taps `« Πίσω στο Μενού` (or any other still-active menu button) on an older message instead of typing `/menu`, that tap routes through `handleCallbackQuery`'s `menuAction` branch, which never calls `clearPendingReply`. The pending reply remains staged, and the owner's next free-text message (which they likely now consider unrelated, since they just "navigated away" via a button) is still relayed to the earlier escalating client.

**Fix:** Call `clearPendingReply(senderTelegramId)` at the top of the `menuAction` branch in `handleCallbackQuery` (mirroring the `/menu` text-command fix), so navigation via button tap is treated the same as navigation via typed command.

### WR-02: New payment-button path is the first caller of `showClientSelection` nested inside an already-open `withBusinessContext` transaction

**File:** `src/telegram/handlers/admin-menu.ts:592-594`, `src/webhooks/telegram.ts:1248` (outer `withBusinessContext` wrapping `handleCallbackQuery`), `src/telegram/handlers/payment-flow.ts:46-52` (`showClientSelection`'s own internal `withBusinessContext`)

**Issue:** `handleCallbackQuery` (and therefore `handleMenuCallback` and the new `case menuAction === 'payment':` branch) already runs inside `await withBusinessContext(business.id, () => handleCallbackQuery(...))` (telegram.ts:1248). The new `menu:payment` case calls `showClientSelection(business.id, chatId)`, which itself opens its own `withBusinessContext(businessId, ...)` (and a second one for the `getAllClientsForBusiness` fallback when there are no recent clients). `withBusinessContext` calls `runInTransaction(appPool, ...)`, which does `pool.connect()` — i.e. checks out a **brand new** DB connection every time, independent of any already-open transaction. This means the outer callback-query transaction sits idle while one (or two, sequentially) additional connections are checked out and committed underneath it — the exact "holding a connection open while other DB/network work happens" pattern this codebase's own comments (`webhook-hang-no-reply`, `query-read-timeout-storm`) describe as the root cause of two prior production incidents. Previously, `showClientSelection` was only reachable from the AI-agent tool-call path (`ai-owner-agent.ts:735`), which per this codebase's own WR-04 comment runs deliberately **outside** any transaction — so this nested-transaction shape is new as of this plan's wiring, not a pre-existing pattern being reused.

**Fix:** Either have `showClientSelection` accept an already-open transaction/connection when called from a context that has one (reuse `getConn()` without re-opening `withBusinessContext`), or, more simply, call it from `handleMenuCallback` in a way that doesn't nest transactions — e.g. resolve the client list before entering `withBusinessContext` in the outer caller, or document/accept this explicitly if the DB calls are proven fast enough to never approach Neon's idle-in-transaction timeout under real concurrency.

### WR-03: A non-text owner message (photo/sticker/voice) while a reply is pending silently consumes the pending reply and attempts to relay an empty string

**File:** `src/webhooks/telegram.ts:1258-1260`, `:129-149`

**Issue:** `handleFoundBusiness` is called with `update.message.text ?? ''` (line 1260). If an owner has a reply staged and sends a photo/sticker/voice note instead of typing text (easy to do by mistake, e.g. from a phone), `messageText` is `''`. The reply-relay block still runs: `consumePendingReply` fires (removing the staged entry) and then attempts `sendTelegramMessage(pendingReply.clientTelegramId, '')`. Telegram's `sendMessage` rejects empty `text`, so this throws, is caught, and the owner sees the generic `'Σφάλμα: δεν ήταν δυνατή η αποστολή της απάντησης.'` — but by then the pending reply is already gone, so the owner must re-tap `escl:reply` from scratch, with no message telling them *why* it failed (that media isn't supported, per D-05) versus a genuine send failure.

**Fix:** Before attempting the relay, guard on non-empty `messageText` and, if empty (i.e. a media-only message arrived while a reply is pending), send a specific Greek message explaining that only text replies are forwarded (D-05) rather than a generic error — and consider not consuming the pending reply in that case, so the owner can immediately retry with a text message instead of re-tapping the escalation button.

## Info

### IN-01: The four new `handleMenuCallback` example-phrase message bodies are near-identical copy/paste blocks

**File:** `src/telegram/handlers/admin-menu.ts:545-576` (3 new `settings:*_examples` cases) and `:604-613` (`classes:create`)

**Issue:** Each of the four cases follows the exact same shape (`sendTelegramMessage(chatId, ` header + blank line + 3 bullet lines `)`), differing only in the header text and the three example strings. This is a minor maintainability nit — no functional defect — but a shared lookup table (`Record<string, string>` of action → message) with one dispatched case would reduce duplication and make future example-phrase additions (there are only 4 categories today per D-09) less error-prone to keep in sync.

**Fix (optional):**
```ts
const EXAMPLE_MESSAGES: Record<string, string> = {
  'settings:hours_examples': 'Ώρες Λειτουργίας — παραδείγματα:\n\n• ...\n• ...\n• ...',
  'settings:services_examples': '...',
  'settings:classes_examples': '...',
  'classes:create': 'Δημιουργία Μαθήματος — γράψε κάτι σαν:\n\n• ...\n• ...\n• ...',
};
// then: case menuAction in EXAMPLE_MESSAGES: await sendTelegramMessage(chatId, EXAMPLE_MESSAGES[menuAction]); break;
```

---

_Reviewed: 2026-07-28T19:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
