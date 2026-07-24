# Phase 18: Client Menu — Research

**Researched:** 2026-07-24
**Domain:** Telegram inline keyboards — client-facing structured entry point
**Confidence:** HIGH (all findings verified directly from codebase)

---

## Summary

Phase 18 adds a `/start` structured menu for clients that mirrors the Phase 17 `/menu` pattern
for owners. The pattern is already fully established in the codebase; this phase replicates it
on the client branch of `handleFoundBusiness` rather than the owner branch.

The key architectural decision is **callback namespace isolation**: Phase 17 uses the `menu:`
prefix with a `menuAction` discriminant field on `MenuCallbackResult`. Phase 18 must use a
separate `cmenu:` prefix with a `clientMenuAction` discriminant field — keeping the two result
types disjoint prevents TypeScript narrowing confusion and eliminates any risk of a client
callback accidentally matching the admin dispatch path.

All booking and cancellation operations for the menu flow reuse existing functions (`listSessions`,
`bookSessionInstance`, `listClientBookings`, `updateBookingStatus`, `findMembershipByBooking`,
`restoreCredit`) — no new data access layer needed.

**Primary recommendation:** Create `src/telegram/handlers/client-menu.ts` mirroring
`admin-menu.ts` in structure. Register `ClientMenuCallbackResult` in `parseCallbackData` via
the `clientMenuAction` discriminant. Dispatch in `handleCallbackQuery` before the
`client_cancel` branch. Pre-empt `/start` in `handleFoundBusiness` client branch before calling
`routeConversationMessage`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `/start` text detection | Webhook handler (`telegram.ts`) | — | Pre-empted before AI round-trip, identical to `/menu` owner pattern |
| Client menu rendering | `client-menu.ts` handler module | `telegram/client.ts` API | Keeps menu logic isolated from routing plumbing |
| Callback dispatch | `handleCallbackQuery` in `telegram.ts` | `client-menu.ts` dispatcher | Same two-layer dispatch as Phase 17 |
| Session listing for booking | `session/manager.ts` (`listSessions`) | — | Already handles RLS-scoped session queries |
| Booking creation | `session/manager.ts` (`bookSessionInstance`) | `billing/queries.ts` (deduction) | Atomic booking + credit deduction already implemented |
| Active booking listing for cancel | `database/queries.ts` (`listClientBookings`) | — | Returns only `pending_owner_approval` + `confirmed` rows |
| Cancellation + credit restore | `telegram.ts` (`handleClientCancelCallback`) | `billing/queries.ts` (`restoreCredit`) | Already implemented — client-menu cancel can call the same logic |
| Balance display | `billing/queries.ts` (`getClientActiveMembership`) | — | Read-only, no side effects |

---

## Research Area 1: `/start` Detection in `handleFoundBusiness`

### Current client branch (from `telegram.ts` lines 97–103)

```typescript
// Current:
await routeConversationMessage(business, senderTelegramId, messageText, {
  sendMessage: sendTelegramMessage,
});
await markTelegramUpdateProcessed(updateId, business.id);
```

### Required modification

Insert a `/start` pre-emption before the `routeConversationMessage` call, directly mirroring
the `/menu` pre-emption in the owner branch (lines 76–80):

```typescript
// CMENU-01: /start command — structured keyboard, no Gemini round-trip.
if (messageText.trim() === '/start') {
  await showClientRootMenu(senderTelegramId, business);
  await markTelegramUpdateProcessed(updateId, business.id);
  return;
}

await routeConversationMessage(business, senderTelegramId, messageText, {
  sendMessage: sendTelegramMessage,
});
await markTelegramUpdateProcessed(updateId, business.id);
```

**CMENU-05 preserved:** Only the exact string `/start` (after trim) is intercepted. Every
other client text, including mid-flow messages, falls through to `routeConversationMessage`
unchanged. This is guaranteed by the early-return pattern — there is no state machine
that could block free-text once `/start` is not matched.

---

## Research Area 2: Callback Namespace Design

### Option A: Separate type with `clientMenuAction` discriminant (RECOMMENDED)

```typescript
export type ClientMenuCallbackResult = {
  clientMenuAction: string;
  id?: number;
};
```

Callback data format: `cmenu:<action>[:<numericId>]`
Parse regex: `/^cmenu:([\w:]+?)(?::(\d+))?$/`

**Why:** The `clientMenuAction` field name is unique across all existing result types:
- `BookingCallbackResult` has `action`
- `BillingCallbackResult` has `action` + `firstId`
- `SlotlessCallbackResult` has `action` + `slotlessRequestId`
- `RenewalCallbackResult` has `action` + `businessId`
- `MenuCallbackResult` has `menuAction`
- `ClientMenuCallbackResult` (new) has `clientMenuAction`

TypeScript discriminant narrowing via `'clientMenuAction' in parsed` works cleanly, same
pattern as `'menuAction' in parsed` for Phase 17 (telegram.ts line 276).

### Option B: Reuse `MenuCallbackResult` with `cmenu:` prefix namespace

This would require the admin dispatch path (`handleMenuCallback`) to be aware of the `cmenu:`
prefix and skip/reject it, or the client dispatch path to filter for `cmenu:` strings before
the admin dispatch runs. This creates coupling between admin and client menu routing logic.
Not recommended — the separate type is the established pattern (Phase 17 deliberately used a
unique discriminant field to avoid exactly this ambiguity).

### parseCallbackData union extension

```typescript
export function parseCallbackData(
  data: string | undefined
): BookingCallbackResult | BillingCallbackResult | SlotlessCallbackResult | RenewalCallbackResult | MenuCallbackResult | ClientMenuCallbackResult | null {
```

Add the client menu regex match AFTER the admin menu match (to avoid the `cmenu:` prefix
accidentally matching the admin `menu:` regex — it won't because `cmenu:` doesn't start
with `menu:`, but ordering for readability still matters):

```typescript
// Phase 18: client menu callback pattern — cmenu:<action>[:<numericId>]
const clientMenuMatch = data?.match(/^cmenu:([\w:]+?)(?::(\d+))?$/);
if (clientMenuMatch) {
  return {
    clientMenuAction: clientMenuMatch[1],
    id: clientMenuMatch[2] ? Number(clientMenuMatch[2]) : undefined,
  };
}
```

---

## Research Area 3: `handleCallbackQuery` Dispatch for Client Menu

Insert client menu dispatch AFTER the admin menu branch and BEFORE `client_cancel`. The
client menu does NOT require owner verification — it resolves the client's identity from
`senderTelegramId` directly (no `findBusinessByOwnerTelegramId` needed; the `business`
object is not available in `handleCallbackQuery`, so the handler must accept the
`senderTelegramId` and call `findBusinessByWebhookId` indirectly, OR receive `business`
from a helper).

**Actual available context in `handleCallbackQuery`:** Only `callbackQuery` and
`senderTelegramId` are in scope. The `business` is NOT directly available — it's resolved
upstream in `handleTelegramWebhookPost` via `withBusinessContext` but not passed down.

**Solution:** `handleClientMenuCallback` in `client-menu.ts` receives `senderTelegramId`
and `business` (pass `business` from the webhook handler into `handleCallbackQuery`, or
re-resolve it). Looking at the current signature:

```typescript
async function handleCallbackQuery(
  callbackQuery: TelegramCallbackQuery,
  senderTelegramId: string
): Promise<void>
```

The `business` is in scope in `handleTelegramWebhookPost` where `handleCallbackQuery` is
called (line 632: `await handleCallbackQuery(update.callback_query, senderTelegramId)`).

**Two viable approaches:**

1. **Add `business` as a third parameter** to `handleCallbackQuery` — consistent with how
   admin menu callbacks already need `ownerBusiness` (they look it up inside via
   `findBusinessByOwnerTelegramId`). Client menu similarly needs the business; passing
   it directly avoids a redundant lookup.

2. **Resolve business inside client-menu handler** via a new query scoped by the
   already-verified business context (the `withBusinessContext` outer wrapper means all
   queries within the callback handler are already scoped to the right business).

**Recommendation: pass `business` as third parameter.** The business is already resolved
and available at the call site; passing it avoids an extra DB round-trip and keeps the
handler signature symmetric with how `handleMenuCallback` receives `ownerBusiness`.

Dispatch block in `handleCallbackQuery`:

```typescript
// Phase 18: Client menu callback routing (CMENU-01 through CMENU-04)
// Discriminant: 'clientMenuAction' in result → ClientMenuCallbackResult
// Cross-tenant guard: business is passed from handleTelegramWebhookPost (already HMAC-verified).
// No owner check needed — client menu is accessible to any sender (non-owner).
if ('clientMenuAction' in parsed) {
  const clientResult = parsed as ClientMenuCallbackResult;
  if (callbackQuery.message?.message_id) {
    await editTelegramMessageReplyMarkup(senderTelegramId, callbackQuery.message.message_id, []);
  }
  await handleClientMenuCallback(clientResult, business, senderTelegramId);
  return;
}
```

The business ownership gate for client menu is simply: "you received this update on this
business's webhook, so you're talking to this business." No `findBusinessByOwnerTelegramId`
needed — the client is not an owner.

---

## Research Area 4: Book a Class Flow (CMENU-02)

### Callback data strings and byte counts

```
cmenu:book                       10 bytes  — show session list
cmenu:book:confirm:<instanceId>  ~26 bytes — Ναι/Όχι confirmation
cmenu:book:yes:<instanceId>      ~22 bytes — Ναι tapped
cmenu:book:no                    9 bytes   — Όχι tapped (no id needed)
```

All within 64-byte limit (Telegram hard cap).

### Step-by-step flow

**Step 1 — Root menu "Book a class" tap (`cmenu:book`):**

```typescript
export async function showBookSessionList(chatId: string, business: Business): Promise<void> {
  const sessions = await listSessions(business.id, 14);
  const available = sessions.filter(s => s.bookedCount < s.capacity);
  // cap at 10 for keyboard size
  const capped = available.slice(0, 10);

  if (capped.length === 0) {
    await sendTelegramMessage(chatId, 'Δεν υπάρχουν διαθέσιμα μαθήματα για τις επόμενες 14 ημέρες.');
    return;
  }

  const keyboard: InlineKeyboard = capped.map(s => {
    const cbData = `cmenu:book:confirm:${s.instanceId}`;
    assertCallbackDataSize(cbData);
    return [{ text: `${s.sessionDate} ${s.sessionTime}`, callback_data: cbData }];
  });
  keyboard.push([{ text: '« Πίσω', callback_data: 'cmenu:root' }]);

  await sendTelegramMessageWithKeyboard(chatId, 'Επίλεξε μάθημα:', keyboard);
}
```

**Step 2 — Session tapped (`cmenu:book:confirm:<instanceId>`):**
Show Ναι/Όχι confirmation (CMENU-04):

```typescript
await sendTelegramMessageWithKeyboard(chatId, `Να κρατηθεί αυτό το μάθημα;`, [[
  { text: 'Ναι', callback_data: `cmenu:book:yes:${instanceId}` },
  { text: 'Όχι', callback_data: 'cmenu:root' },
]]);
```

**Step 3 — Ναι tapped (`cmenu:book:yes:<instanceId>`):**

Call `bookSessionInstance` from `session/manager.ts`. This function:
- Handles SELECT FOR UPDATE (capacity race guard)
- Creates the booking with `bookingStatus: 'confirmed'` (no owner approval needed for
  menu-initiated bookings — same behavior as the AI agent's `book_session` tool which
  also produces `confirmed` status directly)
- Atomically deducts 1 session credit if the client has an active finite membership
- Is idempotent via `onConflictDoNothing`

```typescript
const membership = await getActiveMembershipForDeduction(business.id, senderTelegramId);
const idempotencyKey = `cmenu:booking:${senderTelegramId}:${instanceId}:${Date.now()}`;
const result = await bookSessionInstance(
  business.id,
  instanceId,
  senderTelegramId,
  serviceId,  // need to look up from session → catalog → serviceId
  idempotencyKey,
  membership
);
```

**serviceId resolution:** `listSessions` returns `SessionInstance` which includes `serviceId`
from the catalog join. The `showBookSessionList` handler can pass `serviceId` along in the
callback, OR it can be re-fetched from the instanceId at confirm time.

**Decision:** Re-fetch at confirm time. Storing serviceId in callback_data would require
`cmenu:book:yes:<instanceId>:<serviceId>` — adds bytes and puts a trust boundary on
serviceId (it comes from client-controlled callback_data). Instead, query the DB at
confirm time using instanceId to get the catalog row and thus serviceId. This is safe
because instanceId is a primary key — only one valid serviceId can correspond to it.

**bookingStatus:** `bookSessionInstance` inserts with `bookingStatus: 'confirmed'` directly
(see manager.ts line 249). No `pending_owner_approval` → no owner notification needed.
However, should the menu flow mirror the AI flow and notify the owner? Research shows the
AI `book_session` tool (for `fixed_sessions` mode) also produces `confirmed` directly.
Recommendation: same behavior — direct confirm, no owner notification for menu bookings.

**Membership enforcement gate:** `bookSessionInstance` deducts automatically when
`sessionsRemaining !== null`. It does NOT check the enforcement policy (block/flag) —
that lives in `checkEnforcementAndGetMembership` in `billing/enforcement.ts` which is
called by the AI tool. The client menu should also call this first to respect the
business's enforcement policy (deny if `block` and no membership). This is a correctness
requirement to be consistent with the AI path.

---

## Research Area 5: My Bookings / Cancel Flow (CMENU-03)

### Callback data strings

```
cmenu:cancel                       12 bytes  — show bookings list
cmenu:cancel:confirm:<bookingId>   ~27 bytes — Ναι/Όχι confirmation
cmenu:cancel:yes:<bookingId>       ~23 bytes — Ναι tapped
cmenu:cancel:no                    11 bytes  — Όχι tapped
```

All within 64-byte limit.

### Existing function: `listClientBookings`

From `database/queries.ts` line 652:

```typescript
export async function listClientBookings(
  businessId: number,
  clientPhone: string
): Promise<Booking[]>
```

Returns bookings with `bookingStatus IN ('pending_owner_approval', 'confirmed')` ordered by
date/time. Reuse directly — no new query needed.

### Cancellation execution

**Reuse `handleClientCancelCallback` logic.** That function (telegram.ts lines 200–244)
already handles the complete cancel flow:
1. Finds booking by id (unscoped)
2. Verifies `booking.clientPhone === senderTelegramId`
3. Calls `updateBookingStatus(booking.id, 'cancelled')`
4. Calls `restoreCredit` if membership linked
5. Notifies owner
6. Sends confirmation to client

The client-menu cancel handler can either:
- **Call `handleClientCancelCallback` directly** (it's already exported — wait, it's
  `async function handleClientCancelCallback` — NOT exported, it's a module-private
  function in `telegram.ts`)
- **Extract the logic** into a shared util, or duplicate the essential steps

**Recommendation:** Extract the cancel logic into a dedicated function in `client-menu.ts`
or a shared `src/telegram/handlers/booking-cancel.ts`. The logic is ~30 lines and has
clear inputs/outputs. Do NOT re-route through the AI agent for cancellation — the menu
provides a deterministic path that doesn't need Gemini.

The cancellation cutoff check (`cancellationCutoffEnabled`, `cancellationCutoffHours`) from
`business` must be applied in the menu cancel path too, same as the AI cancel tool applies
it via `hoursUntilSessionInAthens`.

---

## Research Area 6: My Balance (CMENU-01 sub)

Uses `getClientActiveMembership(business.id, senderTelegramId)` from `billing/queries.ts`
(line 650). Returns `{ packageName, sessionsRemaining, expiresAt, isUnlimited } | null`.

```typescript
export async function showClientBalance(chatId: string, business: Business): Promise<void> {
  const membership = await getClientActiveMembership(business.id, chatId);

  let messageText: string;
  if (!membership) {
    messageText = 'Δεν υπάρχει ενεργή συνδρομή.';
  } else if (membership.isUnlimited) {
    messageText = `Πακέτο: ${membership.packageName}\nΑπεριόριστες συνεδρίες\nΛήγει: ${membership.expiresAt.toLocaleDateString('el-GR')}`;
  } else {
    messageText = `Πακέτο: ${membership.packageName}\nΥπόλοιπο: ${membership.sessionsRemaining} μαθήματα\nΛήγει: ${membership.expiresAt.toLocaleDateString('el-GR')}`;
  }

  await sendTelegramMessageWithKeyboard(chatId, messageText, [
    [{ text: '« Πίσω', callback_data: 'cmenu:root' }],
  ]);
}
```

Read-only, no state changes, no confirmation flow.

---

## Research Area 7: My Bookings (Display, CMENU-01 sub)

```typescript
export async function showClientBookings(chatId: string, business: Business): Promise<void> {
  const clientBookings = await listClientBookings(business.id, chatId);

  if (clientBookings.length === 0) {
    await sendTelegramMessageWithKeyboard(chatId, 'Δεν έχετε ενεργές κρατήσεις.', [
      [{ text: '« Πίσω', callback_data: 'cmenu:root' }],
    ]);
    return;
  }

  const lines = clientBookings.map(b => `${b.calendarDate} ${b.calendarTime}`);
  const messageText = 'Ενεργές κρατήσεις σας:\n\n' + lines.join('\n');

  await sendTelegramMessageWithKeyboard(chatId, messageText, [
    [{ text: 'Ακύρωση κράτησης', callback_data: 'cmenu:cancel' }],
    [{ text: '« Πίσω', callback_data: 'cmenu:root' }],
  ]);
}
```

---

## Research Area 8: Root Menu (CMENU-01)

Four buttons in 2×2 layout:

```typescript
export async function showClientRootMenu(chatId: string, business: Business): Promise<void> {
  const keyboard: InlineKeyboard = [
    [
      { text: 'Κράτηση μαθήματος', callback_data: 'cmenu:book' },
      { text: 'Οι κρατήσεις μου', callback_data: 'cmenu:bookings' },
    ],
    [
      { text: 'Ακύρωση κράτησης', callback_data: 'cmenu:cancel' },
      { text: 'Υπόλοιπο μαθημάτων', callback_data: 'cmenu:balance' },
    ],
  ];
  await sendTelegramMessageWithKeyboard(chatId, `Καλώς ήρθες! Τι θέλεις να κάνεις;`, keyboard);
}
```

All callback_data strings: `cmenu:book` (9), `cmenu:bookings` (13), `cmenu:cancel` (12),
`cmenu:balance` (13) — all well within 64 bytes.

---

## Callback Data Inventory

| Action | callback_data | Bytes (UTF-8) | Notes |
|--------|--------------|---------------|-------|
| Root menu | `cmenu:root` | 10 | Back button on all sub-views |
| Book — list sessions | `cmenu:book` | 9 | Root menu button |
| Book — confirm session | `cmenu:book:confirm:<id>` | 20 + digits | id up to 10 digits → max 30 |
| Book — Ναι | `cmenu:book:yes:<id>` | 16 + digits | max 26 |
| Book — Όχι | `cmenu:root` | 10 | Reuse root |
| My bookings | `cmenu:bookings` | 13 | Root menu button |
| Cancel — list | `cmenu:cancel` | 12 | Root menu button + from bookings view |
| Cancel — confirm | `cmenu:cancel:confirm:<id>` | 22 + digits | max 32 |
| Cancel — Ναι | `cmenu:cancel:yes:<id>` | 18 + digits | max 28 |
| Cancel — Όχι | `cmenu:root` | 10 | Reuse root |
| My balance | `cmenu:balance` | 13 | Root menu button |

All under 64 bytes including max reasonable numeric IDs. No issue.

---

## Client Menu Dispatcher

The central dispatcher in `client-menu.ts` mirrors `handleMenuCallback` in `admin-menu.ts`:

```typescript
export async function handleClientMenuCallback(
  result: ClientMenuCallbackResult,
  business: Business,
  chatId: string
): Promise<void> {
  const { clientMenuAction } = result;

  switch (true) {
    case clientMenuAction === 'root':
      await showClientRootMenu(chatId, business);
      break;
    case clientMenuAction === 'book':
      await showBookSessionList(chatId, business);
      break;
    case clientMenuAction === 'book:confirm':
      // result.id = instanceId
      await showBookConfirm(chatId, business, result.id!);
      break;
    case clientMenuAction === 'book:yes':
      await handleBookSessionExecute(chatId, business, chatId /* senderTelegramId */, result.id!);
      break;
    case clientMenuAction === 'bookings':
      await showClientBookings(chatId, business);
      break;
    case clientMenuAction === 'cancel':
      await showCancelBookingList(chatId, business, chatId /* senderTelegramId */);
      break;
    case clientMenuAction === 'cancel:confirm':
      await showCancelConfirm(chatId, result.id!);
      break;
    case clientMenuAction === 'cancel:yes':
      await handleCancelExecute(chatId, business, chatId /* senderTelegramId */, result.id!);
      break;
    case clientMenuAction === 'balance':
      await showClientBalance(chatId, business);
      break;
    default:
      await sendTelegramMessage(chatId, 'Άγνωστη ενέργεια.');
  }
}
```

Note: `chatId` doubles as `senderTelegramId` — the client's Telegram ID is the chat ID for
private chats, same as how `clientPhone` stores the Telegram ID throughout the codebase.

---

## CMENU-05: Free Greek Chat Preservation

The `/start` intercept is a single `if (messageText.trim() === '/start') { return; }` block.
There is no state machine or session state that could block subsequent free-text messages.

**Verified behaviors:**
1. Client sends `/start` → menu shown → `markTelegramUpdateProcessed` → done
2. Client sends any other text (Greek, English, anything) → `routeConversationMessage` → AI
3. Client taps a menu button then sends text → the next `message` update triggers
   `handleFoundBusiness` again with the new text → `routeConversationMessage` → AI
4. There is no persistent "menu mode" — each Telegram update is fully stateless

The multi-step booking flow (list → confirm → Ναι) is purely callback_query-driven. A
text message between steps just triggers the AI agent (which may ask for clarification).
The partially-tapped flow is effectively abandoned when the client types text — this is
acceptable UX for a PoC (buttons remain visible in Telegram history).

---

## New File Structure

```
src/telegram/handlers/
├── admin-menu.ts        (Phase 17 — unchanged)
└── client-menu.ts       (Phase 18 — new)
    exports:
    - ClientMenuCallbackResult (type)
    - showClientRootMenu(chatId, business)
    - handleClientMenuCallback(result, business, chatId)
    // internal helpers:
    - showBookSessionList
    - showBookConfirm
    - handleBookSessionExecute
    - showClientBookings
    - showCancelBookingList
    - showCancelConfirm
    - handleCancelExecute
    - showClientBalance
    - assertCallbackDataSize (copy from admin-menu or extract to shared util)
```

---

## Existing Functions to Reuse

| Operation | Function | File | Notes |
|-----------|----------|------|-------|
| List available sessions | `listSessions(businessId, 14)` | `session/manager.ts` | Filter `bookedCount < capacity` in-process |
| Book a session instance | `bookSessionInstance(businessId, instanceId, clientPhone, serviceId, idempotencyKey, membership)` | `session/manager.ts` | Handles capacity lock, deduction, idempotency |
| Get active membership for deduction | `getActiveMembershipForDeduction(businessId, clientPhone)` | `billing/queries.ts` | Pass result to bookSessionInstance |
| List client's active bookings | `listClientBookings(businessId, clientPhone)` | `database/queries.ts` | Returns pending + confirmed |
| Cancel booking status update | `updateBookingStatus(bookingId, 'cancelled')` | `database/queries.ts` | Plain update, no CAS needed for client self-cancel |
| Find membership by booking | `findMembershipByBooking(bookingId)` | `billing/queries.ts` | Returns null = no credit to restore |
| Restore credit on cancel | `restoreCredit(membershipId, bookingId, idempotencyKey)` | `billing/queries.ts` | Idempotent |
| Get client balance | `getClientActiveMembership(businessId, clientPhone)` | `billing/queries.ts` | Returns null or membership details |
| Find service by id | `findServiceById(businessId, serviceId)` | `database/queries.ts` | For display names |

**Note on `checkEnforcementAndGetMembership`:** The AI booking path calls this from
`billing/enforcement.ts` to respect the `block` policy. The client menu booking path
should also call it for consistency. This adds one function to import but ensures the
business owner's enforcement decision is respected regardless of booking channel.

---

## Recommended Plan Structure

### Plan 18-01: `/start` Pre-emption + Root Menu + `ClientMenuCallbackResult`

**Scope:** Foundation — everything that must exist before flows work.
- Add `ClientMenuCallbackResult` type to `client-menu.ts`
- Implement `showClientRootMenu` (4 buttons, 2×2)
- Add `cmenu:` regex to `parseCallbackData` in `telegram.ts`
- Add `clientMenuAction` discriminant branch in `handleCallbackQuery` (with `business`
  parameter added)
- Add `/start` pre-emption in `handleFoundBusiness` client branch
- Wire `handleClientMenuCallback` dispatcher (skeleton, throws for unimplemented actions)

**Tests:** Send `/start` → verify 4-button keyboard appears. Tap "Υπόλοιπο" → verify
balance message (works immediately once Plan 18-01 is done). Send free text → verify AI
responds normally (CMENU-05 regression).

### Plan 18-02: Balance + My Bookings (Read-only views)

**Scope:** Read-only display flows — no mutations.
- `showClientBalance` using `getClientActiveMembership`
- `showClientBookings` using `listClientBookings`
- Wire `cmenu:balance` and `cmenu:bookings` in dispatcher
- Add "« Πίσω" button (callback: `cmenu:root`) on both views

**Tests:** Client with membership → balance shows package + sessions remaining. Client
with no membership → "Δεν υπάρχει ενεργή συνδρομή". Client with 2 bookings → both
appear in list.

### Plan 18-03: Book a Class Flow (CMENU-02, CMENU-04)

**Scope:** Full booking flow — select session → Ναι/Όχι → create booking.
- `showBookSessionList`: calls `listSessions(business.id, 14)`, filters available,
  caps at 10 buttons
- `showBookConfirm`: Ναι/Όχι keyboard (CMENU-04)
- `handleBookSessionExecute`: calls `checkEnforcementAndGetMembership`,
  then `bookSessionInstance`, sends confirmation text
- Wire `cmenu:book`, `cmenu:book:confirm`, `cmenu:book:yes` in dispatcher

**Tests:** Business has open session → client taps "Κράτηση" → session list appears.
Client taps session → confirm prompt. Client taps Ναι → booking created, confirmation
sent. Capacity full → appropriate message. Business in `block` mode + no membership →
rejected with policy message.

### Plan 18-04: Cancel Booking Flow (CMENU-03, CMENU-04)

**Scope:** Full cancel flow — select booking → Ναι/Όχι → cancel + credit restore.
- `showCancelBookingList`: calls `listClientBookings`, shows bookings as buttons
- `showCancelConfirm`: Ναι/Όχι keyboard (CMENU-04)
- `handleCancelExecute`: mirrors `handleClientCancelCallback` logic — updates status,
  restores credit, notifies owner
- Apply cancellation cutoff check (`business.cancellationCutoffEnabled`) before allowing
  cancel
- Wire `cmenu:cancel`, `cmenu:cancel:confirm`, `cmenu:cancel:yes` in dispatcher

**Tests:** Client with active booking → cancel list shows booking. Client taps → confirm
prompt. Client taps Ναι → booking cancelled, credit restored (if applicable), owner
notified. Cancellation inside cutoff window → rejected with cutoff message.

---

## Pitfalls to Avoid

### Pitfall 1: Owner tapping client menu buttons

An owner could type `/start` or tap a `cmenu:*` button. The pre-emption check is in the
client branch (else branch of `if (business.ownerTelegramId === senderTelegramId)`), so
an owner's `/start` goes to `aiOwnerAgent` (owner branch intercepts first). However,
`handleCallbackQuery` does NOT know who is an owner — it receives any callback from any
sender. A `cmenu:*` callback from the owner should still work (they'd see their own
balance/bookings) — this is acceptable behavior. No cross-tenant risk because the business
is already resolved from the webhook ID.

### Pitfall 2: `business` parameter in `handleCallbackQuery`

Currently `handleCallbackQuery` does NOT receive the `business` object. Adding it requires
updating the call site in `handleTelegramWebhookPost` (line 632). The `business` is in
scope there (resolved at line 555). This is a one-line change at the call site, but the
parameter must be threaded through. Do this in Plan 18-01.

### Pitfall 3: `bookSessionInstance` requires `business.bookingMode === 'fixed_sessions'`

`bookSessionInstance` is the correct function for `fixed_sessions` businesses. For
`open_slots` businesses, there are no session instances — `listSessions` returns empty.
The client menu booking flow is therefore only meaningful for `fixed_sessions` businesses.
In `showBookSessionList`, if `business.bookingMode !== 'fixed_sessions'`, show a fallback
message: "Για κράτηση, γράψε μου ελεύθερο κείμενο." This preserves CMENU-05.

### Pitfall 4: `assertCallbackDataSize` copy vs. shared

`assertCallbackDataSize` is defined module-private in `admin-menu.ts`. Copy it to
`client-menu.ts` (same pattern — no shared util exists yet). Do NOT import it from
`admin-menu.ts` — it's not exported and adding an export just for this creates unnecessary
coupling.

### Pitfall 5: `handleClientCancelCallback` not exported

The existing cancel logic in `telegram.ts` is a private function. The client-menu cancel
handler must re-implement the same steps rather than calling it. To avoid duplication,
extract a `cancelClientBooking(bookingId, senderTelegramId, business)` function into
`client-menu.ts` (or a shared handler). This extraction also removes the tight coupling
between the callback format (`client_cancel_<id>` button on the owner approval message)
and the menu cancel path.

### Pitfall 6: Idempotency key for `bookSessionInstance`

The idempotency key must be stable for the same (client, session) pair within a single
interaction, but unique across different interactions. Using `Date.now()` is simple but
not replay-safe if Telegram redelivers the same callback_query. A better key:
`cmenu:book:${senderTelegramId}:${instanceId}` — deterministic per (client, session).
This means if the client double-taps "Ναι" for the same session, the second call is
idempotent. The booking `onConflictDoNothing` in `bookSessionInstance` already handles
this correctly.

### Pitfall 7: Spinner acknowledgement timing

The `answerCallbackQuery(callbackQuery.id)` in `handleCallbackQuery` fires BEFORE any DB
work (line 261 of `telegram.ts`). This is correct and must not be moved. The client menu
dispatch happens after this dismissal — the spinner is already gone before the menu is
rendered.

---

## Security Considerations

All client menu actions are scoped to the already-HMAC-verified business (the business is
resolved from the webhook secret before any callback processing). Cross-tenant booking is
impossible because:

1. `bookSessionInstance` receives `business.id` (from the verified webhook, not from
   callback_data)
2. `listSessions` filters by `businessId` on the catalog join
3. `listClientBookings` filters by `businessId` and `clientPhone` together
4. `handleCancelExecute` must verify `booking.clientPhone === senderTelegramId` before
   cancelling (same guard as `handleClientCancelCallback`)

No `instanceId` or `bookingId` in callback_data can reach a foreign business's data
because all queries include the `business.id` ownership guard.

---

## Sources

All findings verified directly from codebase files:

- `src/webhooks/telegram.ts` — handleFoundBusiness, handleCallbackQuery, parseCallbackData, MenuCallbackResult pattern [VERIFIED: codebase]
- `src/telegram/handlers/admin-menu.ts` — MenuCallbackResult type, assertCallbackDataSize, handleMenuCallback dispatcher, showAdminRootMenu pattern [VERIFIED: codebase]
- `src/conversation/router.ts` — routeConversationMessage signature, what it does [VERIFIED: codebase]
- `src/database/queries.ts` — listClientBookings, insertBooking, updateBookingStatus, findMembershipByBooking, Business interface [VERIFIED: codebase]
- `src/session/manager.ts` — listSessions (returns SessionInstance with serviceId), bookSessionInstance signature and behavior [VERIFIED: codebase]
- `src/billing/queries.ts` — getClientActiveMembership, getActiveMembershipForDeduction, restoreCredit [VERIFIED: codebase]
- `src/telegram/client.ts` — InlineKeyboard type, sendTelegramMessageWithKeyboard, editTelegramMessageReplyMarkup [VERIFIED: codebase]
- `src/database/schema.ts` — bookings table, bookingStatus values, sessionInstanceId field [VERIFIED: codebase]

## Metadata

**Confidence breakdown:**
- Callback routing pattern: HIGH — directly verified from Phase 17 implementation
- `/start` pre-emption: HIGH — exact mirror of `/menu` owner pre-emption verified in code
- Booking functions: HIGH — `bookSessionInstance`, `listSessions`, `listClientBookings` signatures verified
- Cancellation flow: HIGH — `handleClientCancelCallback` logic read in full; credit restore verified
- Balance query: HIGH — `getClientActiveMembership` signature and return shape verified
- 64-byte callback_data analysis: HIGH — all strings computed manually

**Research date:** 2026-07-24
**Valid until:** 2026-08-24 (stable domain — no external dependencies)
