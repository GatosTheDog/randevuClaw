# Phase 28: Admin Menu Discoverability - Research

**Researched:** 2026-07-28
**Domain:** Telegram admin menu UX, callback routing, pending-state management
**Confidence:** HIGH

## Summary

Phase 28 wires four high-frequency owner actions into discoverable `/menu` entry points: reply-to-client relay (ADMIN-01), payment recording (ADMIN-03), and setup guidance for hours/services/prices/class-creation (ADMIN-04). The "Νέο μάθημα (chat)" decorative button (ADMIN-02) is upgraded from a single rigid prompt to multi-example guidance, matching the tone of the setup category buttons.

**Primary recommendation:** This phase is pure wiring and UI text — no new database schema, no new dependencies. Implement in the order: payment button wiring → setup example-phrase buttons → reply-relay intercept + pending-reply state management. The reply-relay state pattern mirrors the existing `pendingServicePriceChanges` in-memory Map from Phase 26 (no schema changes, acceptable to lose on restart).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Payment recording flow | Frontend (Telegram inline keyboard) | Backend (payment-flow.ts handlers) | Menu button triggers `showClientSelection` (UI); handlers mutate DB via `handleConfirmMembership` (business logic) |
| Setup guidance (text prompts) | Frontend (Telegram inline keyboard) | Gemini AI backend | Menu button sends 2-3 example phrases; owner can then freeform-chat to AI agent for parsing |
| Reply-relay interception | Backend (webhook entry point) | Backend (pending state mgmt) | Intercept must sit BEFORE `aiOwnerAgent` call in `handleFoundBusiness`; relay payload sent via existing `sendTelegramMessage` |
| Pending-reply state | Backend (in-memory Map) | — | Ephemeral storage per owner; cleared on navigation or expiry |
| Menu button routing | Backend (callback dispatcher) | — | `handleMenuCallback` switch extends to route new payment + setup actions |

## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01 to D-13)

**Reply-to-client relay (ADMIN-01):**
- D-01: Implement a real relay, not removal — escalation "reply" button currently only prompts, this phase closes that gap.
- D-02: Pending-reply state lives in an in-memory `Map`, matching `pendingServicePriceChanges` pattern from Phase 26 — no schema change.
- D-03: Pending reply cancelled by `/menu` or `/start` tap (implicit abandonment via navigation), not a timer.
- D-04: After relay, send short Greek confirmation (e.g., "Η απάντηση στάλθηκε.") — matches codebase's confirmation convention.
- D-05: Relay forwards text only — no media. Escalation clarifications rarely need photos.

**Setup entry-point style (ADMIN-04 + ADMIN-02):**
- D-06 (corrects earlier framing error): Setup buttons do NOT require exact command syntax — `src/onboarding/ai-owner-agent.ts` is Gemini NLU that already parses free-form Greek.
- D-07: Each of 4 setup buttons sends **2-3 example natural-language phrases** (not one rigid command, not claiming ANY phrasing works) — examples exist to make the range of what's askable discoverable.
- D-08: "Νέο μάθημα (chat)" button upgraded to same multi-example style (closes ADMIN-02's named example + ADMIN-04 with one fix).
- D-09: All 4 example-phrase buttons live inside existing Settings submenu (`showSettingsMenu`), not as new root-menu buttons — Settings already displays hours/services/prices config, natural home.

**Payment button placement (ADMIN-03):**
- D-10: `showClientSelection` (full payment recording flow: client → package → confirm) already exists, fully built, currently only reachable via AI chat. ADMIN-03 work is wiring only: add menu callback that calls `showClientSelection(business.id, chatId)` directly.
- D-11: New root-menu button (not nested under Clients submenu) — record-payment is highest-frequency owner action, warranting top-level visibility.
- D-12: Label text **"Καταχώρηση Πληρωμής"** — placed as new row below 5 existing root-menu buttons (Ρυθμίσεις/Μαθήματα/Πελάτες/Ατζέντα Σήμερα/settings-row), above invite row.

**Confirmation carry-over:**
- D-13: None of Phase 28's new menu actions need Phase 26's Ναι/Όχι confirmation pattern — payment reuses `showClientSelection`'s own existing confirmation step; reply-relay and example prompts are non-destructive/reversible.

### Claude's Discretion

- Exact Greek wording of 2-3 example phrases per setup category (follow existing tone, match "natural" standard from D-07).
- Greek wording of reply-relay confirmation and any decline/cancel-acknowledgment text.
- Internal shape of pending-reply `Map` (key structure, value fields) — follow `pendingServicePriceChanges` precedent unless concrete reason to diverge.
- Relay state logging/observability requirements.

## Standard Stack

### Core Libraries (Telegram Bot Interaction)

| Library | Current Version | Purpose | Why Standard |
|---------|-----------------|---------|--------------|
| **telegram-types** (inline) | Node.js native | Callback query parsing, inline keyboard data structures | Part of existing webhook parsing; no external package required |
| **existing sendTelegramMessage** | Production (src/telegram/client.ts) | Message/keyboard sending via Telegram Bot API | Already in use; handles per-business bot token routing |
| **existing handleMenuCallback** | Production (src/telegram/handlers/admin-menu.ts) | Central dispatcher for menu button callbacks | Established routing pattern; extends here for new actions |

### Established Patterns (Reuse Only)

| Pattern | Location | Purpose | Status |
|---------|----------|---------|--------|
| **In-memory pending-state Map** | `src/onboarding/ai-owner-agent.ts:60-92` (`pendingServicePriceChanges`) | Ephemeral owner action staging; auto-expires with `setTimeout(...).unref()` | **VERIFIED & REUSED** for pending-reply state (D-02) |
| **Menu callback parsing** | `src/webhooks/telegram.ts:347-355` (`menu:` pattern) | Extract action + optional ID from callback_data | **VERIFIED** — extend switch case in `handleMenuCallback` |
| **64-byte callback_data guard** | `src/telegram/handlers/admin-menu.ts:35` (`assertCallbackDataSize`) | Telegram API limit enforcement | **VERIFIED** — apply to all new menu buttons |
| **Payment flow (full stack)** | `src/telegram/handlers/payment-flow.ts:46-100+` (`showClientSelection` → `showPackageSelection` → `handleConfirmMembership`) | Complete client-selection → package → membership recording | **VERIFIED EXISTING** — already fully built; ADMIN-03 is wiring only |
| **Escalation callback parsing** | `src/webhooks/telegram.ts:325-345` (`escl:` pattern) | Discriminant for owner decision buttons | **VERIFIED** — reply-relay intercept sits in same conditional block |
| **Greek button labels** | `src/utils/greek-messages.ts` (CONFIRM_LABELS) | Phase 26 centralized button-label constants | **VERIFIED & EXTENDED** — may add setup-guidance example phrases here |

### No New External Dependencies

This phase introduces **zero new npm packages** — all functionality reuses existing Telegram SDK, message sending, and callback routing infrastructure.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ADMIN-01 | The admin's "reply to client" escalation button either relays the owner's next message to the escalating client, or is removed if not being wired | Relay implementation via in-memory pending-reply Map (D-01/D-02); intercept before aiOwnerAgent call (line 124 in telegram.ts); confirmation message reuses existing pattern |
| ADMIN-02 | Decorative inline-keyboard buttons that perform no action (e.g. "Νέο μάθημα (chat)") are removed or wired to a real action | "Νέο μάθημα (chat)" at line 294 upgraded from single rigid prompt to 2-3 example phrases (D-08); no other no-op buttons found in Phase 27 sweep |
| ADMIN-03 | Admin can record a client payment from the `/menu` (currently chat-only, despite being highest-frequency owner action) | `showClientSelection` exists at payment-flow.ts:46 and fully implements the flow; ADMIN-03 is pure wiring: add root-menu button + callback handler calling showClientSelection directly |
| ADMIN-04 | Admin has menu entry points for hours/services/prices/class setup (currently chat-only, despite being high-stakes setup data) | 4 setup buttons (hours/services/prices/classes) send 2-3 example phrases each, live inside showSettingsMenu (D-07/D-09); examples guide discovery without dictating exact syntax (D-06 corrects earlier framing) |

## Integration Points (Verified Against Current Code)

### 1. Reply-Relay Intercept: `src/webhooks/telegram.ts`

**Location:** Line 71-135 (`handleFoundBusiness`, owner branch)

**Current state:**
```typescript
// Line 123-124: aiOwnerAgent call (unconditional, no intercept)
const today = isoDateInAthens(new Date());
const reply = await aiOwnerAgent(business, senderTelegramId, messageText, today);
```

**Phase 28 change:** Insert intercept BEFORE line 124 to check pending-reply Map:
```typescript
// Intercept: if this owner has a pending reply staged, consume it and relay
if (pendingReplies.has(senderTelegramId)) {
  const pending = pendingReplies.get(senderTelegramId);
  // Forward messageText to pending.clientTelegramId
  // Send confirmation back to owner
  // Clear the pending entry
  // Return early
}
// Otherwise proceed with aiOwnerAgent as normal
```

**CONTEXT.md verification:** ✅ D-01 says "intercept must sit in `handleFoundBusiness` BEFORE the existing unconditional `aiOwnerAgent(...)`" — exact match at line 124.

### 2. Reply Escalation Button Callback: `src/webhooks/telegram.ts` lines 503-591

**Current state (lines 577-585):**
```typescript
} else {
  // Reply action: prompt the admin to type a message to the client.
  // This plan delivers only the reply prompt — future wiring can intercept the next admin message.
  await sendTelegramMessage(
    senderTelegramId,
    `Γράψε το μήνυμα που θέλεις να στείλεις στον πελάτη (${escl.clientTelegramId}) και αποστολή.`
  );
}
```

**Phase 28 change:** Stage the reply into pending-reply Map instead of just prompting:
```typescript
} else if (escl.escalationAction === 'reply') {
  pendingReplies.set(senderTelegramId, {
    clientTelegramId: escl.clientTelegramId,
    timer: setTimeout(...).unref()
  });
  await sendTelegramMessage(
    senderTelegramId,
    `Γράψε το μήνυμα που θέλεις να στείλεις στον πελάτη (${escl.clientTelegramId}) και αποστολή.`
  );
}
```

**CONTEXT.md verification:** ✅ D-04 says current branch (line 574-583) is where the reply prompt lives; D-01/D-02 say to wire the actual relay here.

### 3. Payment Button: `src/telegram/handlers/admin-menu.ts`

**Current `showAdminRootMenu` (line 47-77):**
- Currently displays 2x2 root buttons + 1 invite row (5 buttons total)
- Lines 61-69 define the keyboard

**Phase 28 change:** Insert new "Καταχώρηση Πληρωμής" row:
```typescript
const keyboard: InlineKeyboard = [
  [
    { text: 'Ρυθμίσεις', callback_data: 'menu:settings' },
    { text: 'Μαθήματα', callback_data: 'menu:classes' },
  ],
  [
    { text: 'Πελάτες', callback_data: 'menu:clients' },
    { text: 'Ατζέντα Σήμερα', callback_data: 'menu:agenda' },
  ],
  [{ text: 'Καταχώρηση Πληρωμής', callback_data: 'menu:payment' }],  // NEW
  [{ text: 'Πρόσκληση Πελάτη', callback_data: 'menu:invite' }],
];
```

**Handler in `handleMenuCallback` (lines 516-618):** Add case:
```typescript
case menuAction === 'payment':
  await showClientSelection(business.id, chatId);
  break;
```

**CONTEXT.md verification:** ✅ D-11/D-12 specify root-menu button placement and label.

### 4. Setup Example-Phrase Buttons: `src/telegram/handlers/admin-menu.ts` lines 83-152 (`showSettingsMenu`)

**Current state:**
- Shows settings with "γράψε στο chat για αλλαγή" placeholder for hours/services/prices
- No example-phrase buttons yet

**Phase 28 change:** Add 4 new buttons at end of Settings menu keyboard:
```typescript
const keyboard: InlineKeyboard = [
  [{ text: slotlessText, callback_data: slotlessCallbackData }],
  [{ text: cutoffText, callback_data: cutoffCallbackData }],
  [{ text: multiText, callback_data: multiCallbackData }],
  [{ text: thresholdText, callback_data: thresholdCallbackData }],
  [{ text: '📝 Ώρες Λειτουργίας — Παραδείγματα', callback_data: 'menu:settings:hours_examples' }],      // NEW
  [{ text: '📝 Υπηρεσίες & Τιμές — Παραδείγματα', callback_data: 'menu:settings:services_examples' }], // NEW
  [{ text: '📝 Νέα Μαθήματα — Παραδείγματα', callback_data: 'menu:settings:classes_examples' }],      // NEW
  [{ text: '« Πίσω στο Μενού', callback_data: 'menu:root' }],
];
```

**Handler in `handleMenuCallback`:** Add cases for each:
```typescript
case menuAction === 'settings:hours_examples':
  await sendTelegramMessage(chatId, `Ώρες Λειτουργίας — γράψε κάτι σαν:
• "Δευτέρα έως Παρασκευή 9:00-17:00"
• "Πρωί 9-12, Απόγευμα 16-19"
• "Παρασκευή 14:00 έως 21:00"`);
  // Then show settings menu again so they can edit
  break;
```

**"Νέο μάθημα (chat)" button (line 294):** Currently sends single rigid prompt at line 554-560. Upgrade to:
```typescript
case menuAction === 'classes:create':
  await sendTelegramMessage(chatId, `Δημιουργία Μαθήματος — γράψε κάτι σαν:
• "Δημιούργησε Pilates Δευτέρα Τετάρτη 10:00 15 θέσεις"
• "Νέο Yoga μαθήματα κάθε Σάββατο στις 18:00"
• "Προσθέσε μάθημα Zumba Τρίτη Πέμπτη 19:00"`);
  break;
```

**CONTEXT.md verification:** ✅ D-07/D-08 specify 2-3 example phrases per category.

### 5. Pending-Reply State Management

**New export in `src/telegram/handlers/admin-menu.ts` or new file:**

```typescript
// Mirrors pendingServicePriceChanges pattern from Phase 26
const PENDING_REPLY_TTL_MS = 10 * 60 * 1000; // 10 minutes

export const pendingReplies = new Map<
  string, // ownerTelegramId (string)
  { clientTelegramId: string; timer: ReturnType<typeof setTimeout> }
>();

export function stagePendingReply(
  ownerTelegramId: string,
  clientTelegramId: string
): void {
  const existing = pendingReplies.get(ownerTelegramId);
  if (existing) clearTimeout(existing.timer);
  
  const timer = setTimeout(
    () => pendingReplies.delete(ownerTelegramId),
    PENDING_REPLY_TTL_MS
  ).unref();
  
  pendingReplies.set(ownerTelegramId, { clientTelegramId, timer });
}

export function consumePendingReply(ownerTelegramId: string): {
  clientTelegramId: string;
} | null {
  const pending = pendingReplies.get(ownerTelegramId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingReplies.delete(ownerTelegramId);
    return { clientTelegramId: pending.clientTelegramId };
  }
  return null;
}

export function clearPendingReply(ownerTelegramId: string): void {
  const pending = pendingReplies.get(ownerTelegramId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingReplies.delete(ownerTelegramId);
  }
}
```

**Call sites:**
1. In escalation callback handler (line 576-585): Call `stagePendingReply(senderTelegramId, escl.clientTelegramId)` instead of just prompting.
2. In `handleFoundBusiness` owner branch (line 120-124): Call `consumePendingReply(senderTelegramId)` before aiOwnerAgent; if found, relay + confirm instead of calling aiOwnerAgent.
3. In `/menu` pre-emption (line 107-117): Call `clearPendingReply(senderTelegramId)` to cancel on navigation (D-03).
4. In `/start` pre-emption (line 139-161): Call `clearPendingReply(senderTelegramId)` to cancel on navigation (D-03).

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                  Telegram Webhook Entry                          │
│                  (handleCallbackQuery)                           │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │ parseCallbackData │ (extract action + ID)
                    └────────┬─────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
   ┌─────────┐      ┌──────────────┐    ┌─────────────┐
   │ Escalation   │ Menu Callback    │ Client Menu Callback
   │ (escl:...)   │ (menu:...)       │ (cmenu:...)
   └─────────┘      └──────────────┘    └─────────────┘
        │                    │
        ▼                    ▼
   [NEW] Reply:      handleMenuCallback (switch)
   - stagePendingReply │    │    │
   - Prompt owner      │    ▼    ▼
                   Payment    Setup Examples
                   │          │
                   ▼          ▼
              showClientSelection  sendTelegramMessage
              (→ showPackageSelection  (prompts with 2-3
               → handleConfirmMembership) example phrases)
                    │
                    ▼
              [DB: insert membership]
              [send confirmation to owner]
```

**Entry point:** Owner free-text message arrives in `handleFoundBusiness` (line 71-135).

**Data flow for reply-relay:**
1. Owner taps "reply" button (escalation callback) → `stagePendingReply(ownerTelegramId, clientTelegramId)`
2. Prompt sent: "Write message and send"
3. Owner types free-text message → `handleFoundBusiness` detects pending reply via `consumePendingReply(ownerTelegramId)`
4. Message relayed to client via `botTokenStore.run(business.botToken, ...sendTelegramMessage(clientTelegramId, message))`
5. Confirmation sent to owner: "Η απάντηση στάλθηκε."

**Data flow for payment button:**
1. Owner taps "Καταχώρηση Πληρωμής" button → `menu:payment` callback
2. `handleMenuCallback` routes to `showClientSelection(business.id, chatId)`
3. Client-list keyboard displayed
4. Owner selects client → `menu:clients:payment:{relId}` callback [NEW - may need routing]
5. Package-list keyboard displayed
6. Owner confirms membership → `handleConfirmMembership` mutates DB + sends confirmations

### Recommended Project Structure

No new files required. Extend existing:
- `src/telegram/handlers/admin-menu.ts` — add payment + setup-examples buttons, handlers
- `src/webhooks/telegram.ts` — add reply-relay intercept before aiOwnerAgent call; wire escalation reply action to stagePendingReply

Optional: extract pending-reply Map to separate `src/telegram/handlers/pending-reply.ts` (mirrors existing payment-flow.ts separation) to keep admin-menu.ts under 650 lines.

### Pattern 1: In-Memory Pending-State Map with Auto-Expiry

**What:** Ephemeral owner action staging using a `Map<string, value>` with timeout-based cleanup. No database writes, no persistence across restart.

**When to use:**
- Temporary state that must be available within the same webhook execution context
- User navigation cancels the pending state automatically (per D-03, `/menu` or `/start` tap clears pending reply)
- Timeout is a "best effort" fallback (if owner abandons the app, entry self-expires in 10 minutes)
- State is specific to one owner (keyed by `ownerTelegramId` or `senderTelegramId`)

**Example:**
```typescript
// From Phase 26 (pendingServicePriceChanges pattern)
const PENDING_PRICE_CHANGE_TTL_MS = 10 * 60 * 1000;
export const pendingServicePriceChanges = new Map<
  number,
  { businessId: number; newPriceCents: number; timer: ReturnType<typeof setTimeout> }
>();

export function stagePendingPriceChange(
  serviceId: number,
  businessId: number,
  newPriceCents: number
): void {
  const existing = pendingServicePriceChanges.get(serviceId);
  if (existing) clearTimeout(existing.timer);
  
  const timer = setTimeout(
    () => pendingServicePriceChanges.delete(serviceId),
    PENDING_PRICE_CHANGE_TTL_MS
  ).unref();
  
  pendingServicePriceChanges.set(serviceId, { businessId, newPriceCents, timer });
}

// Consumer in confirmation callback:
const pending = pendingServicePriceChanges.get(params.id);
if (!pending) {
  await sendTelegramMessage(ownerTelegramId, 'Η αλλαγή έληξε. Δοκιμάστε ξανά.');
  return;
}
pendingServicePriceChanges.delete(params.id);
// Apply the price change...
```

**Analogous use in Phase 28:** Stage pending reply in the escalation callback, consume in the free-text intercept.

### Pattern 2: Callback Data Routing via Discriminant

**What:** Parse callback_data string into a discriminated union type; route to different handler functions based on discriminant field.

**When to use:**
- Multiple classes of buttons in the same callback receiver (`handleCallbackQuery`)
- Each class has its own validation logic and handler function
- Discriminant field must be unique across ALL classes (prevents accidental mis-routing)

**Example:**
```typescript
// From telegram.ts:283-285
export function parseCallbackData(
  data: string | undefined
): BookingCallbackResult | BillingCallbackResult | ... | MenuCallbackResult | ... | null {
  
  // Menu pattern: menu:<action>[:<numericId>]
  const menuMatch = data?.match(/^menu:([\w:]+?)(?::(\d+))?$/);
  if (menuMatch) {
    return {
      menuAction: menuMatch[1],  // Discriminant: 'menuAction' (unique field)
      id: menuMatch[2] ? Number(menuMatch[2]) : undefined,
    } as MenuCallbackResult;
  }
  
  // ... other patterns (escalation, client menu, etc.)
}

// Then in handleCallbackQuery (line 603-614):
if ('menuAction' in parsed) {
  const menuResult = parsed as MenuCallbackResult;
  if (business.ownerTelegramId !== senderTelegramId) {
    logger.warn({ senderTelegramId }, 'menu callback from non-owner, ignoring');
    return;
  }
  await handleMenuCallback(menuResult, business, senderTelegramId);
  return;
}
```

**Analogous use in Phase 28:** No new discriminant needed — extend the existing `menu:` pattern with new actions (`menu:payment`, `menu:settings:*_examples`).

### Pattern 3: Navigation-Based Implicit Cancellation

**What:** When user taps a navigation button (`/menu`, `/start`), implicitly cancel any pending state that requires follow-up.

**When to use:**
- Pending state is staging for an imminent action (e.g., pending reply awaiting next message)
- User navigation (menu tap) signals they are abandoning that flow
- No explicit "cancel" button needed; the navigation itself is the cancel signal

**Example:**
```typescript
// Phase 28: /menu tap clears pending reply (D-03)
if (messageText.trim() === '/menu') {
  await withBusinessContext(business.id, async () => {
    clearPendingReply(senderTelegramId);  // Implicit cancellation
    await showAdminRootMenu(senderTelegramId, business);
    await markTelegramUpdateProcessed(updateId, business.id);
  });
  return;
}

// Similarly, /start tap clears pending reply (D-03)
if (messageText.trim() === '/start') {
  await withBusinessContext(business.id, async () => {
    clearPendingReply(senderTelegramId);  // Implicit cancellation
    const { consentGiven } = await getOrCreateClientRelationship(business.id, senderTelegramId);
    // ... rest of /start flow
  });
  return;
}
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Menu button callback routing | Custom switch statement outside `handleMenuCallback` | Extend existing `handleMenuCallback` switch (line 523-617 in admin-menu.ts) | Central dispatch prevents duplicate route logic; discriminant guard already established |
| Relay message forwarding | Custom function to send message to client's personal bot | Use existing `botTokenStore.run(business.botToken, ...sendTelegramMessage(...))` pattern | Already handles per-business bot token routing; mirrors Phase 20/25 escalation patterns |
| Button text styling (emoji, formatting) | Custom Unicode concatenation | Use native Telegram formatting (bold, italic, code) or emoji in button text constant | Keep consistent with existing buttons in showSettingsMenu (emoji used in Phase 25 invite button) |
| Callback data size validation | Custom byte-counting logic | Use existing `assertCallbackDataSize` function (line 35 in admin-menu.ts) | Telegram's 64-byte limit is non-negotiable; guard is proven pattern from Phase 17 |
| Pending state expiry | Custom interval poller (like Phase 3's agenda sync) | Use `setTimeout(...).unref()` with timer stored in Map value (Phase 26 pattern) | Per-item timeout is simpler than global poller; no cross-worker synchronization needed (Map is per-process) |
| Greek text for buttons | Ad-hoc inline strings | Store in `src/utils/greek-messages.ts` (CONFIRM_LABELS pattern from Phase 26) | Centralized constants prevent future drift; allows reuse across multiple handler files |

**Key insight:** Relay logic can reuse existing `sendTelegramMessage` infrastructure — no custom HTTP client needed. The hard part is state management (knowing which owner has a pending reply and for whom), not the actual send.

## Common Pitfalls

### Pitfall 1: Forgetting to Call `assertCallbackDataSize` on New Buttons

**What goes wrong:** New menu buttons have callback_data strings that are silently oversized (>64 bytes). Telegram API silently rejects the button registration, and the owner has a phantom button that does nothing when tapped.

**Why it happens:** Each new button (payment, setup examples) requires a separate callback_data string. If you aren't vigilant about measuring each one, you can construct accidentally long strings — e.g., `menu:settings:class_creation_examples_with_detailed_instructions:123` instead of shorter `menu:settings:classes_examples`.

**How to avoid:** 
```typescript
const paymentData = 'menu:payment';
assertCallbackDataSize(paymentData);  // <-- Do this for every new button

const keyboard: InlineKeyboard = [
  [{ text: 'Καταχώρηση Πληρωμής', callback_data: paymentData }],
  // ...
];
```

**Warning signs:** 
- Button tap produces no response (no error in logs, just silence)
- Button appears in the UI but is grayed out or unresponsive
- Telegram API test tool flags the button as rejected

### Pitfall 2: Pending-Reply Cleared but Message Already Sent

**What goes wrong:** Owner taps "reply", gets prompted, types a message, but between message arrival and the intercept (line 124 in telegram.ts), the pending entry is manually deleted or has expired. The message gets routed to aiOwnerAgent instead of relayed to the client.

**Why it happens:** 
- Timeout expired (10 minutes passed between prompt and owner's reply)
- Owner tapped `/menu` or `/start` in the middle of typing (clearing the pending entry), then continued typing the message (message arrives after clear)

**How to avoid:** 
- Use a reasonable TTL (10 minutes matches Phase 26's `pendingServicePriceChanges`; long enough for a typical owner interaction, short enough to auto-cleanup abandoned flows)
- D-03 explicitly says implicit cancellation via `/menu`/`/start` is acceptable behavior — no complaint if owner accidentally navigates away
- Log the relay failure if it happens (message routed to AI instead of relay): `logger.warn({ ownerTelegramId }, 'Pending reply expired before consumption')` inside the intercept

**Warning signs:**
- Owner says "I tapped reply, typed a message, but it went to the AI agent instead of the client"
- Timestamp check: message arrival time >> "reply" button tap time (>10 min gap)

### Pitfall 3: Relay State Lost on Process Restart

**What goes wrong:** Owner taps "reply", bot restarts (deploy, crash), message arrives after restart. No pending entry found; message goes to aiOwnerAgent instead.

**Why it happens:** In-memory Map is not persisted (D-02 explicitly accepts this). Every restart clears all pending entries.

**How to avoid:** 
- This is acceptable per D-02 ("acceptable to lose on process restart, owner just re-taps reply")
- Document this behavior in code comment so future readers know it's intentional
- Owner's recourse is simple: tap "reply" button again

**Warning signs:**
- Rare (usually only visible during active development with frequent restarts)
- Disappears in production with stable uptime

### Pitfall 4: Payment Button Routes to Wrong Handler

**What goes wrong:** New `menu:payment` callback is added to the switch, but the handler calls `showClientSelection(business.id, senderTelegramId)` instead of `showClientSelection(business.id, chatId)`. The function receives a Telegram user ID instead of a chat ID, and message send fails.

**Why it happens:** Parameters are easy to confuse — `senderTelegramId` (owner's Telegram ID), `chatId` (same value but named differently), and `business.id` (numeric). Easy to pass them in the wrong order.

**How to avoid:**
```typescript
// In handleMenuCallback callback:
case menuAction === 'payment':
  // chatId is the owner's chat ID (same as senderTelegramId in this context)
  // business.id is required by showClientSelection
  await showClientSelection(business.id, chatId);
  break;
```

Verify the function signature: `showClientSelection(businessId: number, ownerTelegramId: string)`. Match parameter names in your switch case.

**Warning signs:**
- Message send fails when owner taps payment button: `Failed to send message to [...]. API error: [...]`
- No keyboard appears; only an error message

### Pitfall 5: Setup Example-Phrase Text Too Short (Unhelpful)

**What goes wrong:** Setup buttons send a single line of text (e.g., "Γράψε κάτι σαν: Pilates Monday 10:00"). Owner finds this example too narrow and still doesn't know what phrasing works.

**Why it happens:** D-07 says "2-3 example natural-language phrases" to "make the range of what's askable discoverable." If you only provide 1 example, the range is unclear.

**How to avoid:**
Always include at least 2 distinct examples per category:

```typescript
case menuAction === 'settings:hours_examples':
  await sendTelegramMessage(chatId, `Ώρες Λειτουργίας — γράψε κάτι σαν:

• "Δευτέρα έως Παρασκευή 9:00-17:00"
• "Πρωί 9:00-12:00, Απόγευμα 16:00-20:00"
• "Μόνο Σάββατο και Κυριακή 10:00-18:00"`);
  break;
```

Show:
- Different phrasing styles (ranges vs. specific days)
- Variations in time format (24-hour, natural language "πρωί")
- Edge cases (single day, split hours, different schedules per day)

**Warning signs:**
- Owner says "I don't understand what format to use"
- Owner reverts to chat and asks "How do I change hours?" despite the menu button

### Pitfall 6: Not Clearing Old Keyboard on Menu Navigation

**What goes wrong:** Owner taps a menu button, new keyboard is shown, but the old keyboard from the previous message is still attached. Owner accidentally taps a button from the old keyboard instead of the new menu.

**Why it happens:** Telegram doesn't auto-clear old keyboards when a new message is sent. You must explicitly call `editTelegramMessageReplyMarkup(..., [])` to clear before sending a new keyboard.

**How to avoid:**
This is already handled in the existing code (`src/webhooks/telegram.ts:609-611`). When you add new menu callbacks, ensure you DON'T add a keyboard-clearing step that breaks existing behavior.

**Code example (already in place):**
```typescript
// In handleCallbackQuery, BEFORE routing to handler (line 609-611):
if (callbackQuery.message?.message_id) {
  await editTelegramMessageReplyMarkup(senderTelegramId, callbackQuery.message.message_id, []);
}
await handleMenuCallback(menuResult, business, senderTelegramId);
```

**Warning signs:**
- Owner taps a button expecting one action, a different old action triggers instead
- Particularly visible with payment/setup-examples buttons (new, likely to be misclicked against older buttons)

## Code Examples

All examples use real code patterns from the RandevuClaw codebase. Source: verified against running code.

### Example 1: Extending the Menu Callback Switch

**Source:** `src/telegram/handlers/admin-menu.ts:516-618` (handleMenuCallback)

```typescript
export async function handleMenuCallback(
  result: MenuCallbackResult,
  business: Business,
  chatId: string
): Promise<void> {
  const { menuAction } = result;

  switch (true) {
    // Existing cases...
    case menuAction === 'classes':
      await showClassesMenu(chatId, business);
      break;

    // NEW: Payment button (Phase 28, D-10)
    case menuAction === 'payment':
      await showClientSelection(business.id, chatId);
      break;

    // NEW: Setup example-phrase buttons (Phase 28, D-07)
    case menuAction === 'settings:hours_examples':
      await sendTelegramMessage(chatId, `Ώρες Λειτουργίας — παραδείγματα:

• Δευτέρα έως Παρασκευή 09:00-18:00
• Πρωί 09:00-12:00, Απόγευμα 15:00-19:00`);
      break;

    case menuAction === 'settings:services_examples':
      await sendTelegramMessage(chatId, `Υπηρεσίες & Τιμές — παραδείγματα:

• Pilates €60 / 12 μαθήματα
• Yoga Διάνυσμα €45 ανά συνεδρία`);
      break;

    case menuAction === 'settings:classes_examples':
      await sendTelegramMessage(chatId, `Νέα Μαθήματα — παραδείγματα:

• Pilates Δευτέρα Τετάρτη 10:00-11:00 15 θέσεις
• Yoga Σάββατο 18:00 20 θέσεις`);
      break;

    // Upgraded "Νέο μάθημα (chat)" (Phase 28, D-08)
    case menuAction === 'classes:create':
      await sendTelegramMessage(chatId, `Δημιουργία Μαθήματος — γράψε κάτι σαν:

• Δημιούργησε Pilates Δευτέρα Τετάρτη 10:00 15 θέσεις
• Νέο Yoga μαθήματα κάθε Σάββατο 18:00
• Προσθέσε Zumba Τρίτη Πέμπτη 19:00-20:00`);
      break;

    // ... rest of existing cases ...
  }
}
```

### Example 2: Staging and Consuming Pending Reply

**Pattern from Phase 26 (`pendingServicePriceChanges`), applied to Phase 28's reply-relay:**

```typescript
// In a new file or at the top of admin-menu.ts:
const PENDING_REPLY_TTL_MS = 10 * 60 * 1000;

export const pendingReplies = new Map<
  string,
  { clientTelegramId: string; timer: ReturnType<typeof setTimeout> }
>();

export function stagePendingReply(
  ownerTelegramId: string,
  clientTelegramId: string
): void {
  const existing = pendingReplies.get(ownerTelegramId);
  if (existing) clearTimeout(existing.timer);

  const timer = setTimeout(() => {
    pendingReplies.delete(ownerTelegramId);
    logger.debug({ ownerTelegramId }, 'Pending reply expired');
  }, PENDING_REPLY_TTL_MS).unref();

  pendingReplies.set(ownerTelegramId, { clientTelegramId, timer });
  logger.debug({ ownerTelegramId, clientTelegramId }, 'Pending reply staged');
}

// Usage in escalation callback (telegram.ts line 576-585):
} else if (escl.escalationAction === 'reply') {
  stagePendingReply(senderTelegramId, escl.clientTelegramId);
  await sendTelegramMessage(
    senderTelegramId,
    `Γράψε το μήνυμα που θέλεις να στείλεις στον πελάτη (${escl.clientTelegramId}) και αποστολή.`
  );
}

// Usage in reply-relay intercept (telegram.ts line 123-124, BEFORE aiOwnerAgent):
const today = isoDateInAthens(new Date());

// [NEW] Check for pending reply (D-01)
const pending = pendingReplies.get(senderTelegramId);
if (pending) {
  clearTimeout(pending.timer);
  pendingReplies.delete(senderTelegramId);
  
  // Relay the message to the escalating client
  try {
    await botTokenStore.run(business.botToken!, async () => {
      await sendTelegramMessage(pending.clientTelegramId, messageText);
    });
    await sendTelegramMessage(senderTelegramId, 'Η απάντηση στάλθηκε.');
  } catch (err) {
    logger.error({ err, clientTelegramId: pending.clientTelegramId }, 'Failed to relay message');
    await sendTelegramMessage(senderTelegramId, 'Σφάλμα: δεν ήταν δυνατή η αποστολή της απάντησης.');
  }
  
  await withBusinessContext(business.id, () => markTelegramUpdateProcessed(updateId, business.id));
  logger.info({ updateId, businessId: business.id }, 'handleFoundBusiness: exit (reply-relay branch)');
  return;
}

// Otherwise proceed with aiOwnerAgent (original behavior)
const reply = await aiOwnerAgent(business, senderTelegramId, messageText, today);
```

### Example 3: Adding Payment Button to Root Menu

**Source pattern:** `src/telegram/handlers/admin-menu.ts:47-77` (showAdminRootMenu)

```typescript
export async function showAdminRootMenu(chatId: string, business: Business): Promise<void> {
  const callbackDataSettings = 'menu:settings';
  const callbackDataClasses = 'menu:classes';
  const callbackDataClients = 'menu:clients';
  const callbackDataAgenda = 'menu:agenda';
  const callbackDataPayment = 'menu:payment';        // NEW
  const callbackDataInvite = 'menu:invite';

  // Assert all callback_data sizes are within 64 bytes
  assertCallbackDataSize(callbackDataSettings);
  assertCallbackDataSize(callbackDataClasses);
  assertCallbackDataSize(callbackDataClients);
  assertCallbackDataSize(callbackDataAgenda);
  assertCallbackDataSize(callbackDataPayment);     // NEW
  assertCallbackDataSize(callbackDataInvite);

  const keyboard: InlineKeyboard = [
    [
      { text: 'Ρυθμίσεις', callback_data: callbackDataSettings },
      { text: 'Μαθήματα', callback_data: callbackDataClasses },
    ],
    [
      { text: 'Πελάτες', callback_data: callbackDataClients },
      { text: 'Ατζέντα Σήμερα', callback_data: callbackDataAgenda },
    ],
    [{ text: 'Καταχώρηση Πληρωμής', callback_data: callbackDataPayment }], // NEW (D-12)
    [{ text: 'Πρόσκληση Πελάτη', callback_data: callbackDataInvite }],
  ];

  await sendTelegramMessageWithKeyboard(
    chatId,
    `Πίνακας Ελέγχου — ${business.name}`,
    keyboard
  );
}
```

## State of the Art

| Pattern | Status | Notes |
|---------|--------|-------|
| **Menu button routing via discriminant** | Established (Phase 17) | Callback_data format `menu:<action>[:<id>]` is proven; extends cleanly with new actions |
| **In-memory pending state with Map + timeout** | Established (Phase 26) | `pendingServicePriceChanges` pattern is production-validated; reply-relay reuses it exactly |
| **Per-business bot token routing** | Established (Phase 4+) | `botTokenStore.run(business.botToken, async () => ...)` is standard for per-tenant operations |
| **Implicit cancellation via navigation** | Established (Phase 26) | `/menu` and `/start` taps already clear specific pending state; extend pattern for reply-relay |
| **Greek message constants** | Established (Phase 26) | `src/utils/greek-messages.ts` centralizes button labels; extend if adding new constant labels |

## Assumptions Log

| # | Claim | Section | Confidence | Risk if Wrong |
|---|-------|---------|-----------|--------------|
| A1 | `showClientSelection` is fully implemented and works correctly today (Phase 7, not Phase 28) | Integration Points #3 | HIGH | Task could fail to compile or runtime-error if function doesn't exist or has wrong signature — verify immediately |
| A2 | Telegram's 64-byte callback_data limit is a hard constraint (not advisory) | Common Pitfalls #1 | HIGH | Buttons oversized in this limit would silently fail; Phase 17 already respects this, so low risk |
| A3 | `botTokenStore.run(token, ...)` is thread-safe and correct for per-business routing | Architecture Patterns | HIGH | Relay messages could go to wrong bot/business if routing is broken — already in production use for other features |
| A4 | The `escl:reply:<clientTelegramId>` callback format (from Phase 20) can be extended with clientTelegramId as a bare integer | Integration Points #2 | HIGH | Relay logic depends on parsing this correctly; Phase 20 code shows it's already parsed correctly at line 342 |
| A5 | Phase 26's `pendingServicePriceChanges` expiry pattern (10-minute TTL + `.unref()`) is the right pattern to reuse for reply-relay state | Architecture Patterns | HIGH | Using a different timeout or global poller could introduce race conditions or cross-process coordination issues — Phase 26 is proven |

## Open Questions

1. **Relay state observability:** Should pending-reply state be logged/monitored (e.g., Prometheus counter of active relays, or just debug-level logs)?
   - **What we know:** Phase 26's `pendingServicePriceChanges` uses debug-level logging only; no metrics.
   - **What's unclear:** Whether relay is high-value enough to warrant production-grade observability.
   - **Recommendation:** Start with debug-level logging (matches Phase 26); add metrics if relay becomes a high-usage feature.

2. **Relay retry on failure:** If `sendTelegramMessage(clientTelegramId, messageText)` fails (network error, invalid client ID), should the message be queued for retry, or is immediate failure acceptable?
   - **What we know:** Current code has no retry pattern for individual message sends (errors are logged and reported to owner).
   - **What's unclear:** Whether relay failures are rare enough to not need retry.
   - **Recommendation:** Start with no retry (matches existing error handling); if relay messages are disappearing in practice, add a retry loop.

3. **Setup examples placement:** Should setup example-phrase buttons be in Settings submenu (D-09) or elevated to root-menu level for higher discoverability?
   - **What we know:** D-09 (locked) says Settings submenu; this is the stable decision.
   - **What's unclear:** Whether owners will find these buttons buried one level deep.
   - **Recommendation:** Follow D-09; if UX feedback suggests low discovery after deployment, re-discuss in a future phase.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Telegram Bot API (outbound) | All messaging (relay, confirmations, example prompts) | ✓ | Current (Telegram Cloud) | None — messaging is critical path |
| Per-business bot tokens (in `businesses.botToken` DB column) | Relay routing via `botTokenStore.run()` | ✓ | Already in use (Phase 4+) | None — multi-tenant routing depends on it |

**No external dependencies missing.** Phase 28 uses only existing Telegram infrastructure and Node.js builtins (`setTimeout`, `Map`, `clearTimeout`).

## Validation Architecture

**Validation enabled:** Yes (workflow.nyquist_validation not explicitly set to false in .planning/config.json — treating as enabled per default).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest (existing test suite) |
| Config file | `jest.config.cjs` |
| Quick run command | `npm test -- --testPathPattern=admin-menu` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ADMIN-01 | Owner taps escalation "reply" button; message is staged and awaits next owner message; next free-text message relays to client | integration | `npm test -- --testPathPattern=telegram` (existing escalation tests) | ✅ tests/webhooks/telegram.test.ts |
| ADMIN-02 | "Νέο μάθημα (chat)" button sends 2-3 example phrases instead of single prompt | unit | `npm test -- --testPathPattern=admin-menu` (existing class-creation tests) | ✅ tests/telegram/handlers/admin-menu.test.ts |
| ADMIN-03 | Owner taps "Καταχώρηση Πληρωμής" button; payment flow (client selection → package → confirm) proceeds | integration | `npm test -- --testPathPattern=payment` (existing payment tests) | ✅ tests/telegram/handlers/payment-flow.test.ts |
| ADMIN-04 | Owner taps setup example-phrase buttons; 2-3 example phrases displayed for each category | unit | `npm test -- --testPathPattern=admin-menu` (new tests) | ❌ Wave 0 — add test cases |

### Sampling Rate

- **Per task commit:** Run quick suite (`npm test -- --testPathPattern=admin-menu`; covers ADMIN-02, ADMIN-04)
- **Per task commit (relay):** Run webhook tests (`npm test -- --testPathPattern=telegram`; covers ADMIN-01)
- **Per task commit (payment):** Run payment tests (`npm test -- --testPathPattern=payment`; covers ADMIN-03)
- **Per wave merge:** Full suite `npm test` — all 4 requirements covered

### Wave 0 Gaps

- [ ] `tests/telegram/handlers/admin-menu.test.ts` — add test cases for new `menu:payment` callback, and setup example-phrase cases (`menu:settings:*_examples`)
  - Test that `menu:payment` calls `showClientSelection(business.id, chatId)`
  - Test that `menu:settings:hours_examples` sends a message with at least 2 example phrases
  - Test that `menu:settings:services_examples` sends example phrases for service/price format
  - Test that `menu:settings:classes_examples` sends example phrases for class creation
  - Test that `menu:classes:create` (upgraded from original) sends multi-example prompt (not single rigid example)

- [ ] `tests/webhooks/telegram.test.ts` — add test cases for reply-relay flow
  - Test that escalation `reply` action calls `stagePendingReply`
  - Test that free-text message from owner with pending reply calls `consumePendingReply` and relays to client
  - Test that `/menu` tap clears pending reply
  - Test that `/start` tap clears pending reply
  - Test that pending reply expires after 10 minutes
  - Test that relay message is sent via correct bot token (per-business routing)
  - Test that owner receives confirmation message after relay

- [ ] `tests/telegram/handlers/payment-flow.test.ts` — verify existing tests still pass with new menu routing
  - Existing tests should already cover `showClientSelection` → `showPackageSelection` → `handleConfirmMembership` flow
  - No new tests needed if Phase 28 only adds the menu entry point (no changes to payment-flow logic)

**Note:** All tests must use `npm run test-setup` before running to ensure test database is seeded. See CLAUDE.md for full test harness documentation.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Telegram bot token validates webhook sender (HMAC check, upstream in bot framework) |
| V3 Session Management | No | No user sessions; bot is stateless (Telegram manages session state) |
| V4 Access Control | Yes | Owner-only guard: `business.ownerTelegramId === senderTelegramId` before any menu action |
| V5 Input Validation | Yes | Callback_data discriminant parsing (Phase 17 pattern); no user-controlled text mutations |
| V6 Cryptography | No | Telegram API handles HTTPS; HMAC verification is webhook-level, not app-level |
| V7 Error Handling | Yes | Relay failures log cleanly; no exception text exposed to owner (terse Greek error message) |

### Known Threat Patterns for This Phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| **Cross-owner escalation access** | Tampering / Information Disclosure | Owner-only guard: check `escl.clientTelegramId` doesn't expose another owner's pending clients; per D-02, pending-reply key is `ownerTelegramId` (scoped to staging owner), not global |
| **Relay message spoofing** | Tampering | Message text comes directly from owner's free-text input (not API response); only risk is owner accidentally sends wrong message (user error, not code defect) |
| **Callback_data forgery** | Tampering | Callback_data is Telegram-signed; if HMAC validation (upstream) passes, data is authentic |
| **Payment flow re-entry via stale callback** | Replay | Existing `handleConfirmMembership` idempotency key prevents duplicate charges; Phase 28 doesn't change payment logic, only entry point |

**No new threats introduced by Phase 28.** Relay state is ephemeral (cleared on navigation, expires on timeout) and scoped to a single owner. Payment flow uses existing idempotency patterns.

## Sources

### Primary (HIGH confidence)

- **RandevuClaw codebase (verified at HEAD):**
  - `src/webhooks/telegram.ts:71-135` (handleFoundBusiness, aiOwnerAgent call location)
  - `src/webhooks/telegram.ts:255-260` (EscalationCallbackResult type)
  - `src/webhooks/telegram.ts:325-345` (escalation callback parsing)
  - `src/webhooks/telegram.ts:503-591` (escalation callback handler, line 574-585 reply prompt)
  - `src/telegram/handlers/admin-menu.ts:47-77` (showAdminRootMenu)
  - `src/telegram/handlers/admin-menu.ts:83-152` (showSettingsMenu)
  - `src/telegram/handlers/admin-menu.ts:272-299` (showClassesMenu, "Νέο μάθημα (chat)" button line 294)
  - `src/telegram/handlers/admin-menu.ts:516-618` (handleMenuCallback switch)
  - `src/telegram/handlers/payment-flow.ts:46-100` (showClientSelection)
  - `src/onboarding/ai-owner-agent.ts:60-92` (pendingServicePriceChanges Map pattern)
  - `src/utils/greek-messages.ts` (CONFIRM_LABELS constants)
  - `src/webhooks/telegram.ts:347-355` (menu callback pattern parsing)

- **Phase 26 Context (canonical reference for confirmation pattern):**
  - `.planning/phases/26-confirmation-approval-policy/26-CONTEXT.md` (D-07 greek-messages.ts pattern, D-05 contextual button labels)

- **REQUIREMENTS.md (v1.7):**
  - ADMIN-01 through ADMIN-04 requirement text

## Metadata

**Confidence breakdown:**

| Area | Level | Reasoning |
|------|-------|-----------|
| Integration points (code locations) | HIGH | All 5 integration points verified against current codebase HEAD; CONTEXT.md claims match exactly (reply intercept at line 124, showAdminRootMenu at line 47, "Νέο μάθημα" button at line 294, etc.) |
| Architecture patterns (Map + timeout, callback routing) | HIGH | Both patterns already in production use (Phase 26 for Map, Phase 17 for routing); no changes to established behavior |
| Pending-reply state design | MEDIUM-HIGH | Pattern reuses proven Phase 26 infrastructure; unclear if 10-minute TTL is "right" for relay use case, but no evidence it's wrong |
| Greek text examples | MEDIUM | Examples follow existing tone/patterns; exact wording deferred to Claude's discretion (D-07), not locked |
| Relay message forwarding success rate | MEDIUM | Assumes `botTokenStore.run()` and `sendTelegramMessage()` work correctly (they are production-proven for other features); unclear how often relay *should* fail in practice |

**Research date:** 2026-07-28
**Valid until:** 2026-08-11 (estimated 2 weeks for stable wiring work; if major Telegram API changes surface, revisit earlier)
