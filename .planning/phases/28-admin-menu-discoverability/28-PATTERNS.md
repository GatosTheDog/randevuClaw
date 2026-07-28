# Phase 28: Admin Menu Discoverability - Pattern Map

**Mapped:** 2026-07-28
**Files analyzed:** 3 (2 modified, 1 optional new)
**Analogs found:** 3 / 3

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/webhooks/telegram.ts` | webhook handler / middleware | request-response + intercept | `src/webhooks/telegram.ts` (same file, lines 71-135, 576-585) | exact |
| `src/telegram/handlers/admin-menu.ts` | controller / menu handler | request-response | `src/telegram/handlers/admin-menu.ts` (same file, lines 47-153, 516-618) | exact |
| `src/telegram/handlers/pending-reply.ts` (optional) | utility / state manager | in-memory state with timeout | `src/onboarding/ai-owner-agent.ts:60-92` (`pendingServicePriceChanges` pattern) | exact |

---

## Pattern Assignments

### `src/webhooks/telegram.ts` (webhook handler, request-response + intercept)

**Primary Analog:** `src/webhooks/telegram.ts` (self)

#### Import Pattern (lines 1-42)

Shows how to import state management and handlers:

```typescript
import { handleMenuCallback, MenuCallbackResult, showAdminRootMenu } from '../telegram/handlers/admin-menu';
// Line 38: import for in-memory state from membership-expiry
import { pendingRenewalBatches } from '../scheduler/membership-expiry';
// Phase 28 pattern: will also import pending-reply state from admin-menu.ts (or separate file)
// import { pendingReplies, stagePendingReply, consumePendingReply, clearPendingReply } from '../telegram/handlers/admin-menu';
```

#### Owner Free-Text Handling with Intercept (lines 71-135, `handleFoundBusiness`)

**Current structure (lines 71-135):**

```typescript
async function handleFoundBusiness(
  updateId: string,
  business: Business,
  senderTelegramId: string,
  messageText: string
): Promise<void> {
  const startedAt = Date.now();
  logger.info({ updateId, businessId: business.id, senderTelegramId }, 'handleFoundBusiness: entry');
  try {
    // T-16-04: explicit null guard before comparison
    if (business.ownerTelegramId !== null && business.ownerTelegramId === senderTelegramId) {
      if (!business.onboardingCompleted) {
        const today = isoDateInAthens(new Date());
        const reply = await aiOnboardingAgent(business, senderTelegramId, messageText, today);
        if (reply) {
          await sendTelegramMessage(senderTelegramId, reply);
        }
        await withBusinessContext(business.id, () => markTelegramUpdateProcessed(updateId, business.id));
        return;
      }

      // AMENU-01: /menu command — pre-empt aiOwnerAgent
      if (messageText.trim() === '/menu') {
        await withBusinessContext(business.id, async () => {
          // [PHASE 28, D-03]: Clear pending reply on navigation
          // clearPendingReply(senderTelegramId);
          await showAdminRootMenu(senderTelegramId, business);
          await markTelegramUpdateProcessed(updateId, business.id);
        });
        return;
      }

      // [PHASE 28, D-01 INTERCEPT LOCATION]:
      // This is WHERE the reply-relay intercept sits (lines 123-124 below).
      // BEFORE calling aiOwnerAgent unconditionally, check for pending reply:
      const today = isoDateInAthens(new Date());
      
      // [NEW] Intercept pending-reply before aiOwnerAgent call
      // if (pendingReplies.has(senderTelegramId)) {
      //   const pending = consumePendingReply(senderTelegramId);
      //   if (pending) {
      //     // Relay to client; send confirmation to owner
      //   }
      //   return;
      // }

      const reply = await aiOwnerAgent(business, senderTelegramId, messageText, today);  // LINE 124
      if (reply) {
        await sendTelegramMessage(senderTelegramId, reply);
      }
      await withBusinessContext(business.id, () => markTelegramUpdateProcessed(updateId, business.id));
      return;
    }

    // CMENU-01: /start command for clients
    if (messageText.trim() === '/start') {
      await withBusinessContext(business.id, async () => {
        // [PHASE 28, D-03]: Clear pending reply on navigation
        // clearPendingReply(senderTelegramId);
        const { consentGiven } = await getOrCreateClientRelationship(business.id, senderTelegramId);
        // ... rest of /start flow
```

**Phase 28 change strategy:**
- Insert intercept BEFORE line 124 (the unconditional `aiOwnerAgent` call)
- Use `consumePendingReply(senderTelegramId)` to check and consume pending state
- If pending reply exists, relay message to client, send confirmation to owner, return early
- Otherwise proceed with aiOwnerAgent as normal

#### Escalation Callback Handler with Reply Action (lines 576-585)

**Current state (lines 576-585, in the escalation callback block starting line 510):**

```typescript
  if ('escalationAction' in parsed) {
    const escl = parsed as EscalationCallbackResult;
    if (business.ownerTelegramId !== senderTelegramId) {
      logger.warn({ senderTelegramId }, 'escl callback from non-owner, ignoring');
      return;
    }
    const ownerBusiness = business;

    if (escl.escalationAction === 'approve') {
      // ... approval logic (lines 518-574) ...
      await sendTelegramMessage(senderTelegramId, 'Εξαίρεση εγκρίθηκε. Η κράτηση δημιουργήθηκε.');

    } else {
      // Reply action: prompt the admin to type a message to the client.
      // [PHASE 28, D-01/D-02]: Stage the reply, don't just prompt
      await sendTelegramMessage(
        senderTelegramId,
        `Γράψε το μήνυμα που θέλεις να στείλεις στον πελάτη (${escl.clientTelegramId}) και αποστολή.`
      );
      // [NEW] Stage pending reply: stagePendingReply(senderTelegramId, escl.clientTelegramId);
    }

    if (callbackQuery.message?.message_id) {
      await editTelegramMessageReplyMarkup(senderTelegramId, callbackQuery.message.message_id, []);
    }
    return;
  }
```

**Phase 28 change:**
- Replace the `else` branch (lines 577-585) with:
  1. Call `stagePendingReply(senderTelegramId, escl.clientTelegramId)`
  2. Send the existing prompt message (unchanged)
  3. Continue with callback query editing and return

---

### `src/telegram/handlers/admin-menu.ts` (menu handler, request-response)

**Primary Analog:** `src/telegram/handlers/admin-menu.ts` (self)

#### Module Structure and Exports (lines 1-42)

Shows existing patterns for TypeScript + Drizzle + imports:

```typescript
// Phase 17: Admin menu handler module.
//
// This module owns all admin menu rendering and callback dispatch for Phase 17.
// Plans 17-02, 17-03, and 17-04 will add handler functions to this file.
//
// Security contract (T-17-01, T-17-02, T-17-03):
// - All DB lookups inside menu handlers re-derive businessId from senderTelegramId
//   via findBusinessByOwnerTelegramId — never trust an ID in callback_data as a
//   business identifier (cross-tenant guard, mirrors billing/slotless patterns).
// - /menu pre-emption in handleFoundBusiness already validates ownerTelegramId
//   before reaching showAdminRootMenu.

import { eq } from 'drizzle-orm';
import { db } from '../../database/db';
import { Business, findServiceById, listBookingsForDate, findClientBusinessRelationshipById } from '../../database/queries';
import { businesses } from '../../database/schema';
import { formatAgendaMessage } from '../../scheduler/agenda';
import { isoDateInAthens } from '../../utils/timezone';
import { logger } from '../../utils/logger';
import { findBusinessByOwnerTelegramId } from '../../onboarding/queries';
import { listSessions, cancelSession, cascadeCancelSessionBookings } from '../../session/manager';
import { InlineKeyboard, sendTelegramMessage, sendTelegramMessageWithKeyboard, botTokenStore } from '../client';
import { getAllClientsForBusiness, getClientActiveMembership } from '../../billing/queries';
import { sendBusinessInvite } from '../../invites/generator';

// Exported so telegram.ts can use it in the parseCallbackData return union.
// Discriminant field: menuAction — unique across all existing result types
export type MenuCallbackResult = {
  menuAction: string;
  id?: number;
};

// Mirrors the 64-byte callback_data guard from payment-flow.ts (T-17-05).
function assertCallbackDataSize(data: string): void {
  if (Buffer.byteLength(data, 'utf8') > 64) {
    logger.warn(
      { data, bytes: Buffer.byteLength(data, 'utf8') },
      'callback_data exceeds 64 bytes — Telegram will reject'
    );
  }
}
```

#### Root Menu Button Pattern (lines 47-77, `showAdminRootMenu`)

Shows how to structure a menu with multiple buttons:

```typescript
export async function showAdminRootMenu(chatId: string, business: Business): Promise<void> {
  const callbackDataSettings = 'menu:settings';
  const callbackDataClasses = 'menu:classes';
  const callbackDataClients = 'menu:clients';
  const callbackDataAgenda = 'menu:agenda';
  // [PHASE 28, D-11/D-12]: Add payment button callback_data
  const callbackDataPayment = 'menu:payment';
  const callbackDataInvite = 'menu:invite';

  assertCallbackDataSize(callbackDataSettings);
  assertCallbackDataSize(callbackDataClasses);
  assertCallbackDataSize(callbackDataClients);
  assertCallbackDataSize(callbackDataAgenda);
  assertCallbackDataSize(callbackDataPayment);  // [NEW]
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
    // [PHASE 28, D-11/D-12]: Insert payment button row (new row between agenda and invite)
    [{ text: 'Καταχώρηση Πληρωμής', callback_data: callbackDataPayment }],
    [{ text: 'Πρόσκληση Πελάτη', callback_data: callbackDataInvite }],
  ];

  await sendTelegramMessageWithKeyboard(
    chatId,
    `Πίνακας Ελέγχου — ${business.name}`,
    keyboard
  );
}
```

#### Settings Menu Button Pattern (lines 83-153, `showSettingsMenu`)

Shows structure for toggle buttons and back button (where example-phrase buttons go):

```typescript
export async function showSettingsMenu(chatId: string, business: Business): Promise<void> {
  const slotlessStatus = business.slotlessRequestsEnabled ? '✅ Ενεργό' : '❌ Ανενεργό';
  const bookingModeLabel =
    business.bookingMode === 'fixed_sessions' ? 'Συγκεκριμένα μαθήματα' : 'Ελεύθερες ώρες';
  const cutoffStatus = business.cancellationCutoffEnabled
    ? `✅ Ενεργή (${business.cancellationCutoffHours}ω πριν)`
    : '❌ Ανενεργή';
  const multiBookingStatus = business.allowMultiBooking ? '✅ Επιτρέπονται' : '❌ Δεν επιτρέπονται';
  const thresholdStatus = business.lastSessionThresholdEnabled
    ? `✅ Ενεργή (${business.lastSessionThresholdCount} μαθήματα)`
    : '❌ Ανενεργή';

  const messageText = `Ρυθμίσεις — ${business.name}

Ώρες λειτουργίας: (γράψε στο chat για αλλαγή)
Υπηρεσίες & τιμές: (γράψε στο chat για αλλαγή)

Αποδοχή αιτημάτων χωρίς slot: ${slotlessStatus}
Λειτουργία κράτησης: ${bookingModeLabel}
Πολιτική ακύρωσης: ${cutoffStatus}
Πολλαπλές κρατήσεις: ${multiBookingStatus}
Ειδοποίηση τελευταίου μαθήματος: ${thresholdStatus}

Για αλλαγή ωρών, υπηρεσιών ή αριθμητικών τιμών: γράψε μου στο chat.`;

  const slotlessCallbackData = business.slotlessRequestsEnabled
    ? 'menu:settings:slotless_off'
    : 'menu:settings:slotless_on';
  const slotlessText = business.slotlessRequestsEnabled
    ? 'Απενεργοποίηση αιτημάτων slot'
    : 'Ενεργοποίηση αιτημάτων slot';
  // ... more toggle buttons (cutoff, multi, threshold) ...

  const backCallbackData = 'menu:root';

  assertCallbackDataSize(slotlessCallbackData);
  assertCallbackDataSize(cutoffCallbackData);
  assertCallbackDataSize(multiCallbackData);
  assertCallbackDataSize(thresholdCallbackData);
  assertCallbackDataSize(backCallbackData);
  // [PHASE 28, D-09]: Add example-phrase callback_data assertions
  const hoursExamplesData = 'menu:settings:hours_examples';
  const servicesExamplesData = 'menu:settings:services_examples';
  const classesExamplesData = 'menu:settings:classes_examples';
  assertCallbackDataSize(hoursExamplesData);
  assertCallbackDataSize(servicesExamplesData);
  assertCallbackDataSize(classesExamplesData);

  const keyboard: InlineKeyboard = [
    [{ text: slotlessText, callback_data: slotlessCallbackData }],
    [{ text: cutoffText, callback_data: cutoffCallbackData }],
    [{ text: multiText, callback_data: multiCallbackData }],
    [{ text: thresholdText, callback_data: thresholdCallbackData }],
    // [PHASE 28, D-07/D-09]: Insert example-phrase buttons BEFORE back button
    [{ text: '📝 Ώρες Λειτουργίας — Παραδείγματα', callback_data: hoursExamplesData }],
    [{ text: '📝 Υπηρεσίες & Τιμές — Παραδείγματα', callback_data: servicesExamplesData }],
    [{ text: '📝 Νέα Μαθήματα — Παραδείγματα', callback_data: classesExamplesData }],
    [{ text: '« Πίσω στο Μενού', callback_data: backCallbackData }],
  ];

  await sendTelegramMessageWithKeyboard(chatId, messageText, keyboard);
}
```

#### Classes Menu Button Pattern (lines 272-299, `showClassesMenu`)

Shows where "Νέο μάθημα (chat)" button lives and how it routes:

```typescript
export async function showClassesMenu(chatId: string, business: Business): Promise<void> {
  const sessions = await listSessions(business.id, 7);

  let messageText: string;
  if (sessions.length > 0) {
    const lines = sessions.map(
      (s) => `${s.sessionDate} ${s.sessionTime} — ${s.bookedCount}/${s.capacity} θέσεις`
    );
    messageText = 'Επερχόμενα μαθήματα (7 ημέρες):\n\n' + lines.join('\n');
  } else {
    messageText = 'Δεν υπάρχουν προγραμματισμένα μαθήματα για τις επόμενες 7 ημέρες.';
  }

  const cancelListData = 'menu:classes:cancel_list';
  const createData = 'menu:classes:create';
  const backData = 'menu:root';
  assertCallbackDataSize(cancelListData);
  assertCallbackDataSize(createData);
  assertCallbackDataSize(backData);

  const keyboard: InlineKeyboard = [
    [{ text: 'Ακύρωση μαθήματος', callback_data: cancelListData }],
    [{ text: 'Νέο μάθημα (chat)', callback_data: createData }],  // [PHASE 28, D-08]: upgraded handler
    [{ text: '« Πίσω στο Μενού', callback_data: backData }],
  ];

  await sendTelegramMessageWithKeyboard(chatId, messageText, keyboard);
}
```

#### Menu Callback Dispatcher Pattern (lines 516-618, `handleMenuCallback`)

Shows how to extend the switch with new cases:

```typescript
export async function handleMenuCallback(
  result: MenuCallbackResult,
  business: Business,
  chatId: string
): Promise<void> {
  const { menuAction } = result;

  switch (true) {
    case menuAction === 'root':
      await showAdminRootMenu(chatId, business);
      break;

    case menuAction === 'settings':
      await showSettingsMenu(chatId, business);
      break;

    case menuAction.startsWith('settings:'): {
      const toggleAction = menuAction.slice('settings:'.length);
      await handleSettingsToggle(toggleAction, business, chatId);
      break;
    }

    case menuAction === 'agenda':
      await showTodaysAgenda(chatId, business);
      break;

    case menuAction === 'invite':
      await handleInviteGeneration(chatId, business);
      break;

    case menuAction === 'classes':
      await showClassesMenu(chatId, business);
      break;

    case menuAction === 'classes:create':
      // [PHASE 28, D-08]: Upgrade from single rigid prompt to 2-3 example phrases
      await sendTelegramMessage(
        chatId,
        'Για να δημιουργήσεις νέο επαναλαμβανόμενο μάθημα, γράψε μου στο chat ' +
          '(π.χ. "Δημιούργησε Pilates Δευτέρα Τετάρτη 10:00 15 θέσεις").'
      );
      break;

    case menuAction === 'clients':
      await showClientsList(chatId, business);
      break;

    default:
      await sendTelegramMessage(chatId, 'Άγνωστη ενέργεια μενού.');
      break;
  }
}
```

**Phase 28 additions to handleMenuCallback:**

```typescript
    // [PHASE 28, D-10]: Payment button wiring
    case menuAction === 'payment':
      await showClientSelection(business.id, chatId);
      break;

    // [PHASE 28, D-07/D-09]: Setup example-phrase buttons
    case menuAction === 'settings:hours_examples':
      await sendTelegramMessage(chatId, `Ώρες Λειτουργίας — παραδείγματα:

• Δευτέρα έως Παρασκευή 09:00-18:00
• Πρωί 09:00-12:00, Απόγευμα 15:00-19:00
• Μόνο Σάββατο και Κυριακή 10:00-18:00`);
      break;

    case menuAction === 'settings:services_examples':
      await sendTelegramMessage(chatId, `Υπηρεσίες & Τιμές — παραδείγματα:

• Pilates €60 ανά συνεδρία
• Yoga Διάνυσμα €45 / 8 μαθήματα
• Προσωπικό προπόνημα €80 / ώρα`);
      break;

    case menuAction === 'settings:classes_examples':
      await sendTelegramMessage(chatId, `Νέα Μαθήματα — παραδείγματα:

• Pilates Δευτέρα Τετάρτη 10:00-11:00 15 θέσεις
• Yoga κάθε Σάββατο 18:00-19:30 20 θέσεις
• Zumba Τρίτη Πέμπτη 19:00 25 θέσεις`);
      break;

    // [PHASE 28, D-08]: Upgrade "Νέο μάθημα" handler to multi-example style
    case menuAction === 'classes:create':
      await sendTelegramMessage(chatId, `Δημιουργία Μαθήματος — γράψε κάτι σαν:

• Δημιούργησε Pilates Δευτέρα Τετάρτη 10:00 15 θέσεις
• Νέο Yoga μαθήματα κάθε Σάββατο 18:00
• Προσθέσε Zumba Τρίτη Πέμπτη 19:00-20:00 25 θέσεις`);
      break;
```

---

### `src/telegram/handlers/pending-reply.ts` (optional, utility / state manager)

**Analog:** `src/onboarding/ai-owner-agent.ts:60-92` (`pendingServicePriceChanges` pattern)

If extracted to its own file (per RESEARCH.md "optional per recommended structure"), this pattern shows how to implement the in-memory state:

#### Complete Pending-Reply Module Pattern

```typescript
// Phase 28 (ADMIN-01, D-01/D-02/D-03): In-memory pending-reply state management.
//
// Mirrors the pendingServicePriceChanges pattern from Phase 26 (ai-owner-agent.ts:60-92).
// Ephemeral Map with per-entry timeout-based auto-cleanup. No schema changes; acceptable
// to lose on process restart (owner just re-taps reply button per D-02).
//
// State is keyed by ownerTelegramId and holds the clientTelegramId they're replying to.
// Cleared by:
// 1. Consumption (consumePendingReply in the free-text intercept)
// 2. Timeout (10-minute auto-expiry per D-02)
// 3. Navigation (clearPendingReply in /menu or /start tap per D-03)

const PENDING_REPLY_TTL_MS = 10 * 60 * 1000;  // 10 minutes

export const pendingReplies = new Map<
  string, // ownerTelegramId
  { clientTelegramId: string; timer: ReturnType<typeof setTimeout> }
>();

/**
 * Stages a pending reply: owner tapped escalation "reply" button and will type
 * a message to forward to a specific client.
 *
 * Mirrors Phase 26's setPendingServicePriceChange (ai-owner-agent.ts:65-92):
 * - Clears any previous timer for this owner before overwriting
 * - Sets a new 10-minute auto-expiry timer with .unref() for Jest compatibility
 * - Logs at debug level
 *
 * D-02: No database writes; ephemeral in-memory Map only.
 */
export function stagePendingReply(
  ownerTelegramId: string,
  clientTelegramId: string
): void {
  const existing = pendingReplies.get(ownerTelegramId);
  if (existing) clearTimeout(existing.timer);

  const timer = setTimeout(() => {
    pendingReplies.delete(ownerTelegramId);
    logger.debug({ ownerTelegramId }, 'Pending reply expired (10-minute TTL)');
  }, PENDING_REPLY_TTL_MS).unref();

  pendingReplies.set(ownerTelegramId, { clientTelegramId, timer });
  logger.debug({ ownerTelegramId, clientTelegramId }, 'Pending reply staged');
}

/**
 * Consumes a pending reply if it exists for this owner.
 *
 * Called in the free-text intercept (handleFoundBusiness, before aiOwnerAgent).
 * If a pending reply is found:
 * 1. Clears its timer
 * 2. Deletes it from the Map
 * 3. Returns the clientTelegramId so the caller can relay the message
 *
 * D-01: The intercept consumes this and relays the message to the client.
 */
export function consumePendingReply(
  ownerTelegramId: string
): { clientTelegramId: string } | null {
  const pending = pendingReplies.get(ownerTelegramId);
  if (!pending) return null;

  clearTimeout(pending.timer);
  pendingReplies.delete(ownerTelegramId);
  logger.debug({ ownerTelegramId }, 'Pending reply consumed');
  return { clientTelegramId: pending.clientTelegramId };
}

/**
 * Clears a pending reply without consuming it (cancellation via navigation).
 *
 * Called when owner taps /menu or /start (D-03: implicit abandonment).
 * Clears the timer and deletes the entry.
 */
export function clearPendingReply(ownerTelegramId: string): void {
  const pending = pendingReplies.get(ownerTelegramId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingReplies.delete(ownerTelegramId);
    logger.debug({ ownerTelegramId }, 'Pending reply cleared (navigation)');
  }
}
```

**Imports required** (at top of pending-reply.ts):

```typescript
import { logger } from '../../utils/logger';
```

---

## Shared Patterns

### Pattern 1: In-Memory Pending State with Map + Timeout

**Source:** `src/onboarding/ai-owner-agent.ts:60-92` (`pendingServicePriceChanges`)

**Apply to:** Reply-relay state (Phase 28) — mirrors this exactly

**Code excerpt:**

```typescript
const PENDING_PRICE_CHANGE_TTL_MS = 10 * 60 * 1000;
export const pendingServicePriceChanges = new Map<
  number,
  { businessId: number; newPriceCents: number; timer: ReturnType<typeof setTimeout> }
>();

function setPendingServicePriceChange(
  serviceId: number,
  value: { businessId: number; newPriceCents: number }
): void {
  // WR-01: cancel any previously-scheduled deletion timer for this service
  // before overwriting the entry.
  const existing = pendingServicePriceChanges.get(serviceId);
  if (existing) clearTimeout(existing.timer);
  
  // [Rule 3 - Blocking]: .unref() lets Jest exit normally without timer firing early
  const timer = setTimeout(() => pendingServicePriceChanges.delete(serviceId), PENDING_PRICE_CHANGE_TTL_MS).unref();
  pendingServicePriceChanges.set(serviceId, { ...value, timer });
}
```

**Phase 28 analog:** `pendingReplies` Map with `stagePendingReply` / `consumePendingReply` / `clearPendingReply` functions (exact same pattern, different key and value type).

---

### Pattern 2: Menu Callback Discriminant Routing

**Source:** `src/telegram/handlers/admin-menu.ts:516-618` (handleMenuCallback switch) and `src/webhooks/telegram.ts:347-355` (parseCallbackData)

**Apply to:** All new menu actions (payment, setup examples)

**Code excerpt from parseCallbackData:**

```typescript
export function parseCallbackData(
  data: string | undefined
): BookingCallbackResult | BillingCallbackResult | ... | MenuCallbackResult | null {
  
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
```

**Phase 28 new actions extend this pattern:**
- `menu:payment` → routed to `handleMenuCallback`, case `menuAction === 'payment'`
- `menu:settings:hours_examples` → routed to `handleMenuCallback`, case startswith `settings:`
- `menu:settings:services_examples`, `menu:settings:classes_examples`, `menu:classes:create` — same pattern

**All new callback_data strings must call `assertCallbackDataSize(data)` before use.**

---

### Pattern 3: Message Sending with Keyboard

**Source:** `src/telegram/handlers/payment-flow.ts:46-100` (showClientSelection) and `src/telegram/handlers/admin-menu.ts:47-77` (showAdminRootMenu)

**Apply to:** Example-phrase prompts (setup guidance buttons)

**Code excerpt:**

```typescript
// Prepare callback_data
const keyboard: InlineKeyboard = [
  [{ text: 'Button Label', callback_data: 'menu:action' }],
  [{ text: 'Another Button', callback_data: 'menu:other:123' }],
];

// Send with keyboard
await sendTelegramMessageWithKeyboard(
  chatId,
  `Message text here`,
  keyboard
);

// OR send text-only (example phrases)
await sendTelegramMessage(
  chatId,
  `Ώρες Λειτουργίας — παραδείγματα:

• Example 1
• Example 2`
);
```

**Phase 28:** Example-phrase buttons send text-only (no keyboard), matching the "Νέο μάθημα (chat)" pattern at line 554-560 in existing admin-menu.ts.

---

### Pattern 4: 64-Byte Callback Data Guard

**Source:** `src/telegram/handlers/admin-menu.ts:35` (assertCallbackDataSize) and `src/telegram/handlers/payment-flow.ts:66-71`

**Apply to:** All new menu buttons (payment, example phrases)

**Code excerpt:**

```typescript
function assertCallbackDataSize(data: string): void {
  if (Buffer.byteLength(data, 'utf8') > 64) {
    logger.warn(
      { data, bytes: Buffer.byteLength(data, 'utf8') },
      'callback_data exceeds 64 bytes — Telegram will reject'
    );
  }
}

// Usage: before constructing keyboard
const paymentData = 'menu:payment';
assertCallbackDataSize(paymentData);  // <-- call for EVERY new button

const keyboard: InlineKeyboard = [
  [{ text: 'Καταχώρηση Πληρωμής', callback_data: paymentData }],
];
```

**Phase 28:** All new callback_data strings (payment, hours_examples, services_examples, classes_examples) must be guarded.

---

### Pattern 5: Relay Message via Per-Business Bot Token

**Source:** `src/webhooks/telegram.ts:564-573` (escalation approve action) and `src/telegram/client.ts` (botTokenStore)

**Apply to:** Reply-relay implementation (sending relayed message to client)

**Code excerpt from escalation handler:**

```typescript
try {
  await botTokenStore.run(ownerBusiness.botToken!, async () => {
    await sendTelegramMessage(
      escl.clientTelegramId,
      'Η κράτησή σας εγκρίθηκε από τον διαχειριστή! Θα σας δούμε σύντομα.'
    );
  });
} catch (err) {
  logger.error({ err }, 'escl approve: client notification failed (best-effort)');
}
```

**Phase 28 usage in reply-relay intercept (before aiOwnerAgent):**

```typescript
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
```

---

## No Analog Found

All three files (or file groups) have direct analogs in the codebase:

| File | Why Analog Exists |
|------|-------------------|
| `src/webhooks/telegram.ts` | Same file; adding interceptor and escalation handler extension to existing structures |
| `src/telegram/handlers/admin-menu.ts` | Same file; extending showAdminRootMenu, showSettingsMenu, and handleMenuCallback switch with new cases |
| `src/telegram/handlers/pending-reply.ts` (optional) | Phase 26's `pendingServicePriceChanges` in ai-owner-agent.ts is the exact pattern to reuse |

**No external libraries or patterns outside the codebase are needed for Phase 28.**

---

## Metadata

**Analog search scope:**
- `src/webhooks/telegram.ts` (webhook entry points, callback routing, escalation handler)
- `src/telegram/handlers/admin-menu.ts` (menu rendering, callback dispatch)
- `src/telegram/handlers/payment-flow.ts` (keyboard generation, callback_data guards)
- `src/onboarding/ai-owner-agent.ts` (in-memory pending state pattern)
- `src/utils/greek-messages.ts` (Greek message constants)

**Files scanned:** 5
**Pattern extraction date:** 2026-07-28

---

## Summary for Planner

**Key patterns for Phase 28 implementation:**

1. **Reply-relay intercept:** Insert BEFORE `aiOwnerAgent(...)` call at line 124 of telegram.ts. Use `consumePendingReply()` to check and relay if pending reply exists.

2. **Escalation reply action:** Replace the current prompt-only block (lines 577-585) with `stagePendingReply()` call + same prompt message.

3. **Payment button:** Add new row to `showAdminRootMenu` keyboard (after agenda, before invite). Wire to new `case menuAction === 'payment'` in handleMenuCallback, calling `showClientSelection(business.id, chatId)`.

4. **Setup example-phrase buttons:** Add 3 new button rows to `showSettingsMenu` keyboard (before back button). Wire each case in handleMenuCallback to send a multi-line text prompt with 2-3 example phrases per category.

5. **Classes menu upgrade:** Replace single rigid prompt in `menu:classes:create` case with multi-example style (mirrors setup examples).

6. **Pending-reply state:** Implement via `pendingReplies` Map (inline in admin-menu.ts or extracted to pending-reply.ts). Use `stagePendingReply()`, `consumePendingReply()`, `clearPendingReply()` functions mirroring Phase 26's pattern exactly.

7. **Callback_data guards:** Call `assertCallbackDataSize()` for all new buttons: `menu:payment`, `menu:settings:hours_examples`, `menu:settings:services_examples`, `menu:settings:classes_examples`.

8. **Greek confirmations:** Use short, terse Greek (matching Phase 26 style):
   - Relay success: "Η απάντηση στάλθηκε."
   - Relay error: "Σφάλμα: δεν ήταν δυνατή η αποστολή της απάντησης."

---
