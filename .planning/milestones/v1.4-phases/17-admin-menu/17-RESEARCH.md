# Phase 17: Admin Menu - Research

**Researched:** 2026-07-24
**Domain:** Telegram Inline Keyboard State Machine, Owner Admin UX
**Confidence:** HIGH

---

## Summary

Phase 17 introduces a `/menu` command that replaces the entirely free-text owner agent interface with a structured, keyboard-driven admin panel. The owner types `/menu` and gets a four-button root menu (Settings, Classes, Clients, Today's Agenda). Each branch drills down into sub-menus or triggers an existing capability.

The key architectural question is where `/menu` detection belongs and how multi-step keyboard flows are managed across callback rounds. After reading the full codebase, the answers are clear: `/menu` is detected in `handleFoundBusiness` as a **pre-emption check before `aiOwnerAgent`**, and state is managed **statelessly** using the 64-byte `callback_data` field exclusively. A separate `src/telegram/handlers/admin-menu.ts` module houses the new handler tree, keeping `telegram.ts` as a thin router.

The existing pattern from `payment-flow.ts` is the canonical template: a stateless multi-step keyboard flow where each button embeds all context needed to handle the tap in its `callback_data` value, and `parseCallbackData` is extended with a new discriminant union arm for `menu:*` patterns.

**Primary recommendation:** Add a `menu:` prefix namespace to `parseCallbackData`, detect `/menu` in `handleFoundBusiness` before delegating to `aiOwnerAgent`, and implement all sub-menus in `src/telegram/handlers/admin-menu.ts` following the `payment-flow.ts` pattern.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| /menu command detection | Webhook handler (telegram.ts) | — | All routing decisions start in handleFoundBusiness; this is a special-case pre-emption |
| Admin menu rendering | Admin menu handler module | telegram/client.ts | New module owns menu logic; client.ts provides sendTelegramMessageWithKeyboard |
| Callback routing (menu:*) | telegram.ts handleCallbackQuery | admin-menu.ts | handleCallbackQuery parses and dispatches; admin-menu.ts executes |
| Settings mutations | admin-menu.ts → ai-owner-agent tools | database/queries.ts | Reuse executeOwnerTool logic where possible; invoke DB layer directly for simple reads |
| Classes sub-menu | admin-menu.ts → session/manager.ts | database/queries.ts | listSessions, cancelSession already exist; create_recurring needs conversational input |
| Clients sub-menu | admin-menu.ts → billing/queries.ts | database/queries.ts | getAllClientsForBusiness, getClientActiveMembership already exist |
| Today's Agenda (on-demand) | admin-menu.ts → scheduler/agenda.ts | — | formatAgendaMessage is already extracted; call it without claimAgendaSlot |
| Binary decisions (Ναι/Όχι) | admin-menu.ts | telegram.ts callback routing | Extend parseCallbackData with menu:confirm:* / menu:cancel:* |

---

## Standard Stack

All tools already installed. No new packages needed for this phase.

### Core (existing — verified in codebase)

| Library | Purpose | Source |
|---------|---------|--------|
| `express` | HTTP router for webhook | Already in use [VERIFIED: codebase grep] |
| Telegram Bot API (native fetch) | sendMessage, editMessageReplyMarkup, answerCallbackQuery | `src/telegram/client.ts` [VERIFIED: codebase] |
| `drizzle-orm` | DB queries (clientBusinessRelationships, memberships, sessionInstances) | Already in use [VERIFIED: codebase] |
| `@google/genai` | Gemini — used only for natural language input paths (create recurring class) | Already in use [VERIFIED: codebase] |

### No New Packages Required

Phase 17 is entirely additive UI logic on top of existing infrastructure. The Telegram client already has `sendTelegramMessageWithKeyboard` and `editTelegramMessageReplyMarkup`. No npm installs needed. [VERIFIED: codebase]

## Package Legitimacy Audit

No new packages proposed. Section not applicable.

---

## Architecture Patterns

### System Architecture Diagram

```
Owner sends "/menu"
        │
        ▼
handleFoundBusiness() [telegram.ts]
        │
        ├─ isOwner? No → client path (unchanged)
        │
        ├─ onboardingCompleted? No → onboarding state machine (unchanged)
        │
        ├─ messageText === "/menu"? Yes → showAdminMenu() [admin-menu.ts]
        │
        └─ else → aiOwnerAgent() [existing]

Owner taps inline button
        │
        ▼
handleCallbackQuery() [telegram.ts]
        │
        ▼
parseCallbackData()
        │
        ├─ "menu:root" → showAdminMenu()
        ├─ "menu:settings" → showSettingsMenu()
        ├─ "menu:settings:hours" → showHoursInfo()
        ├─ "menu:settings:services" → showServicesInfo()
        ├─ "menu:settings:cancellation" → showCancellationInfo()
        ├─ "menu:settings:slotless" → showSlotlessInfo()
        ├─ "menu:settings:mode" → showBookingModeInfo()
        ├─ "menu:settings:threshold" → showThresholdInfo()
        ├─ "menu:classes" → showClassesMenu()
        ├─ "menu:classes:list" → showUpcomingClasses()
        ├─ "menu:classes:cancel:<instanceId>" → showCancelClassConfirm()
        ├─ "menu:clients" → showClientsMenu()
        ├─ "menu:clients:list" → showClientsList()
        ├─ "menu:clients:balance:<relId>" → showClientBalance()
        ├─ "menu:clients:nudge:<relId>" → confirmRenewalNudge()
        ├─ "menu:agenda" → showTodaysAgenda()
        └─ existing patterns (billing:*, slotless:*, renewal:*, approve_*, reject_*) unchanged
```

### Recommended Project Structure

```
src/
├── webhooks/
│   └── telegram.ts          # add /menu detection; extend parseCallbackData
├── telegram/
│   ├── client.ts            # unchanged
│   └── handlers/
│       ├── payment-flow.ts  # unchanged
│       └── admin-menu.ts    # NEW: all menu rendering + callback handlers
├── scheduler/
│   └── agenda.ts            # export formatAgendaMessage (currently unexported)
└── session/
    └── manager.ts           # unchanged — listSessions, cancelSession reused
```

### Pattern 1: /menu Command Detection (Pre-emption in handleFoundBusiness)

**What:** Check for the exact string `/menu` before delegating to `aiOwnerAgent`. This keeps `aiOwnerAgent` purely for natural-language requests and avoids its Gemini round-trip cost for a structured command.

**When to use:** Every owner message that is exactly `/menu` (trimmed, case-insensitive is fine since `/menu` is lower-case by convention).

**Example:**
```typescript
// In handleFoundBusiness, inside the onboardingCompleted=true owner branch:
// Source: follows existing pattern from billing D-08 (record_payment pre-emption)
if (messageText.trim() === '/menu') {
  await showAdminRootMenu(senderTelegramId);
  await markTelegramUpdateProcessed(updateId, business.id);
  return;
}
// ... existing aiOwnerAgent delegation unchanged
```

### Pattern 2: Stateless Callback Data with menu: Namespace

**What:** All admin menu navigation encodes full context in `callback_data`. No DB session table needed. Context is the action itself (e.g., `menu:clients:balance:42` where 42 is the `clientBusinessRelationshipId`).

**When to use:** All menu sub-steps. The 64-byte limit constrains IDs to numeric values only (never names or text).

**64-byte budget analysis:**
- `menu:classes:cancel:9999999` = 27 bytes — comfortable headroom
- `menu:clients:balance:9999999` = 30 bytes — comfortable headroom
- `menu:clients:nudge:9999999` = 28 bytes — comfortable headroom
- `menu:settings:<setting_name>` — all setting names fit within 64 bytes

**Example:**
```typescript
// In parseCallbackData — new union arm:
// Source: follows existing billingMatch / slotlessMatch pattern in telegram.ts
export type MenuCallbackResult = {
  action: MenuAction;
  id?: number; // optional numeric ID (instanceId, relId)
};

const menuMatch = data?.match(/^menu:([\w:]+?)(?::(\d+))?$/);
if (menuMatch) {
  return {
    action: menuMatch[1] as MenuAction,
    id: menuMatch[2] ? Number(menuMatch[2]) : undefined,
  };
}
```

**Security note:** All DB lookups inside menu handlers must re-derive `businessId` from `senderTelegramId` via `findBusinessByOwnerTelegramId` — never trust an ID embedded in `callback_data` as a business identifier (cross-tenant guard, mirrors existing billing and slotless patterns).

### Pattern 3: Settings Sub-Menu — Read-Only Display + Defer to aiOwnerAgent for Mutations

**What:** Settings sub-menu shows the current value of each setting but does NOT implement inline editing for free-text fields (hours, service names, prices). Instead it shows a "Reply in chat to change" instruction that routes the owner's follow-up text to `aiOwnerAgent` as usual. Binary settings (slotless toggle, booking mode) get Ναι/Όχι buttons.

**Rationale:** Inline editing of text fields requires a conversation state (what field is being edited?). The 64-byte `callback_data` limit cannot embed arbitrary text values. The aiOwnerAgent already handles all settings mutations fluently. The menu provides discoverability; the chat provides mutation. This avoids a DB session state table entirely.

**Binary toggle example (slotless):**
```typescript
// callback_data: "menu:settings:slotless:enable" or "menu:settings:slotless:disable"
// These are short enough; no numeric ID needed.
```

### Pattern 4: Today's Agenda On-Demand (AMENU-05)

**What:** Call `formatAgendaMessage` from `scheduler/agenda.ts` directly — skip `claimAgendaSlot`. The daily push uses `claimAgendaSlot` to enforce at-most-once-per-day. The on-demand version is triggered by explicit owner action, so no slot-claiming is needed.

**Implementation:**
```typescript
// Export formatAgendaMessage from scheduler/agenda.ts (currently unexported)
// Call listBookingsForDate + fetchServiceNames + formatAgendaMessage in admin-menu.ts
```

### Anti-Patterns to Avoid

- **DB session state for menu navigation:** A `owner_menu_state` table adds migration complexity and race conditions. Stateless callback_data is sufficient given the 64-byte headroom.
- **Embedding text in callback_data:** Never put service names, prices, or Greek text into `callback_data`. IDs only.
- **Calling claimAgendaSlot for on-demand agenda:** This would consume the daily slot and block the 8am push. Always skip slot-claiming for on-demand calls.
- **Routing /menu through aiOwnerAgent:** Wastes a Gemini API call (rate-limited at 1000/day) for a structured command that needs no NLU.
- **Implementing settings mutations via inline keyboard:** Inline editing of text values (hours, prices) requires multi-turn state that the 64-byte limit cannot support. Route to aiOwnerAgent instead.
- **Adding a new discriminant field name that collides with existing:** `MenuCallbackResult` must use a discriminant field name not in `{bookingId, firstId, slotlessRequestId, businessId}` to keep TypeScript union narrowing working in `handleCallbackQuery`. Use `menuAction`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Client list | custom DB query | `getAllClientsForBusiness` (billing/queries.ts) | Already written, RLS-enforced |
| Client membership balance | custom join | `getClientActiveMembership` (billing/queries.ts) | Already handles expired/unlimited/null |
| Session list | custom query | `listSessions` (session/manager.ts) | Already returns bookedCount/capacity with ownership guard |
| Today's agenda | custom query | `listBookingsForDate` + `formatAgendaMessage` (scheduler/agenda.ts) | Already formatted in Greek; just export formatAgendaMessage |
| Renewal nudge send | custom code | `send_renewal_reminder` tool in aiOwnerAgent or replicate the pattern | Already sends correct Greek message |
| Cancel a session | custom update | `cancelSession` (session/manager.ts) | Handles isCancelled flag + returns boolean |
| 64-byte callback_data enforcement | runtime check | Buffer.byteLength check in keyboard builders | Already done in payment-flow.ts — replicate the pattern |

---

## AMENU-by-AMENU Implementation Notes

### AMENU-01: Root Menu

Detect `/menu` in `handleFoundBusiness` before `aiOwnerAgent`. Show 4 buttons in 2×2 layout:

```
[ ⚙️ Ρυθμίσεις  ] [ 📅 Μαθήματα ]
[ 👥 Πελάτες    ] [ 📋 Ατζέντα   ]
```

Callback data: `menu:settings`, `menu:classes`, `menu:clients`, `menu:agenda`.

Add a "Back to menu" button (`menu:root`) at the bottom of every sub-menu screen so the owner can navigate without re-typing `/menu`.

### AMENU-02: Settings Sub-Menu

Show current values in message text. Provide:
- Info-only rows for text fields (hours, services, prices) with instruction to type in chat
- Binary toggle buttons for slotless toggle, booking mode, cancellation cutoff on/off

Current values come from:
- `business.slotlessRequestsEnabled`, `business.bookingMode`, `business.cancellationCutoffEnabled`, `business.cancellationCutoffHours`, `business.lastSessionThresholdEnabled`, `business.lastSessionThresholdCount` — all on the `Business` interface already available in `handleFoundBusiness`

For binary toggles via keyboard (e.g. slotless enable/disable), handle in `handleCallbackQuery` → new `MenuCallbackResult` arm → call the appropriate DB update directly (same as what aiOwnerAgent's tool does). Use the pattern from `handleSetEnforcementPolicy` / `handleSetCancellationCutoff` in `billing/tools.ts`.

### AMENU-03: Classes Sub-Menu

**List upcoming classes:** Call `listSessions(business.id)` from `session/manager.ts`. Show first 10 sessions as message text (not buttons). Add a "Cancel a class" button.

**Cancel class:** Show upcoming sessions as clickable buttons, each with `callback_data: menu:classes:cancel:<instanceId>`. On tap, show Ναι/Όχι confirmation (`menu:classes:cancel_confirm:<instanceId>` / `menu:classes:cancel_abort:<instanceId>`). On Ναι, call `cancelSession(business.id, instanceId)`.

**Create recurring class:** This requires multi-turn input (service name, days, time, capacity). Do NOT implement inline — instead reply: "Για να δημιουργήσεις νέα επαναλαμβανόμενη τάξη, γράψε μου στο chat (π.χ. 'Δημιούργησε Pilates Δευτέρα Τετάρτη 10:00 15 θέσεις')." This routes through aiOwnerAgent as usual.

**Why:** The `create_recurring_session` Gemini tool already handles this conversationally. Replicating it inline would require a 4-step wizard with DB state. Not worth the complexity for PoC.

### AMENU-04: Clients Sub-Menu

**Client list:** Call `getAllClientsForBusiness(business.id)` (billing/queries.ts). Show as inline keyboard — each client button has `callback_data: menu:clients:balance:<relId>`. Use `clientName ?? senderPhone` as label (same pattern as payment-flow.ts).

Limit display to 20 clients with a "..." note if more exist (matches `listSessions` 20-item cap pattern).

**Individual balance:** On `menu:clients:balance:<relId>`, look up the `senderPhone` from `clientBusinessRelationships` via `findClientBusinessRelationshipById` (already in database/queries.ts). Then call `getClientActiveMembership(business.id, senderPhone)`. Show formatted result. Add a "Αποστολή Υπενθύμισης" button with `callback_data: menu:clients:nudge:<relId>`.

**Renewal nudge:** On `menu:clients:nudge:<relId>`, call the same nudge logic as `send_renewal_reminder` in aiOwnerAgent — `getClientActiveMembership` check → `sendTelegramMessage` to client. Confirm to owner with text reply.

### AMENU-05: Today's Agenda On-Demand

On `menu:agenda` callback:

```typescript
// 1. Get today's Athens date
const today = isoDateInAthens(new Date());
// 2. Fetch bookings (confirmed + pending)
const bookings = await listBookingsForDate(business.id, today, ['pending_owner_approval', 'confirmed']);
// 3. Fetch service names
const serviceNamesById = new Map<number, string>();
for (const b of bookings) { /* ... */ }
// 4. Format with existing function
const message = bookings.length > 0
  ? formatAgendaMessage(bookings, serviceNamesById)
  : 'Δεν υπάρχουν ραντεβού για σήμερα.';
await sendTelegramMessage(senderTelegramId, message);
```

`formatAgendaMessage` must be exported from `scheduler/agenda.ts` (currently not exported — currently module-private).

### AMENU-06: Binary Decisions (Ναι/Όχι)

Already partially implemented:
- Booking approve/reject: `approve_<id>` / `reject_<id>` — existing, unchanged
- Slotless approve/reject: `slotless:req_approve:<id>` / `slotless:req_reject:<id>` — existing, unchanged
- Package confirm/cancel: `billing:pkg_confirm:<id>` / `billing:pkg_cancel:<id>` — existing, unchanged

New binary decisions needed in Phase 17:
- Class cancel confirmation: `menu:classes:cancel_confirm:<instanceId>` / `menu:classes:cancel_abort:<instanceId>`
- Toggle settings (slotless, booking mode): handled as single-button actions (toggle, not confirm/cancel) OR via Ναι/Όχι

All new Ναι/Όχι button pairs follow the existing pattern:
```typescript
[[
  { text: 'Ναι', callback_data: `menu:classes:cancel_confirm:${instanceId}` },
  { text: 'Όχι', callback_data: `menu:classes:cancel_abort:${instanceId}` },
]]
```

---

## Common Pitfalls

### Pitfall 1: parseCallbackData Discriminant Collision

**What goes wrong:** Adding `MenuCallbackResult` to the union with a discriminant field name that is also present in another union arm causes TypeScript narrowing to break in `handleCallbackQuery`.

**Why it happens:** The existing arms use `bookingId`, `firstId`, `slotlessRequestId`, `businessId` as discriminants. If `MenuCallbackResult` reuses any of these field names, the `'fieldName' in parsed` checks in `handleCallbackQuery` may match the wrong arm.

**How to avoid:** Use a unique discriminant field like `menuAction: string` in `MenuCallbackResult`. Update `handleCallbackQuery` to check `'menuAction' in parsed` as the first branch (before existing arms, since menu: is a new prefix).

**Warning signs:** TypeScript compiler error "Property X does not exist on type Y" or menu callbacks silently routed to wrong handler.

### Pitfall 2: claimAgendaSlot Called During On-Demand Agenda

**What goes wrong:** If `runAgendaSweep` logic is reused wholesale (including `claimAgendaSlot`), calling the on-demand agenda in the afternoon blocks the 8am agenda from being claimed later.

**Why it happens:** `claimAgendaSlot` atomically sets `agendaSentDate` to today's date. Once claimed, it cannot be claimed again (returns false).

**How to avoid:** Only call `listBookingsForDate` + `formatAgendaMessage` directly in the admin-menu handler. Never call `claimAgendaSlot` or `runAgendaSweep` from the admin menu path. Export `formatAgendaMessage` as a separate utility.

### Pitfall 3: 64-byte callback_data Overflow

**What goes wrong:** Telegram rejects `setWebhook` updates where any `callback_data` exceeds 64 bytes. The bot silently stops receiving callback_query events for that message.

**Why it happens:** Greek text, service names, or concatenated IDs pushed into `callback_data`.

**How to avoid:** Only numeric IDs in `callback_data`. Add the same `Buffer.byteLength(callbackData, 'utf8') > 64` guard that exists in `payment-flow.ts`. Log a warning if exceeded; never throw.

**Warning signs:** Tap on button produces no callback_query event; Telegram API returns error on sendMessage.

### Pitfall 4: Missing answerCallbackQuery for Menu Callbacks

**What goes wrong:** Telegram's inline button spinner keeps spinning indefinitely for the user if `answerCallbackQuery` is not called for every callback_query event, including the new `menu:*` ones.

**Why it happens:** The existing `handleCallbackQuery` calls `answerCallbackQuery(callbackQuery.id)` immediately as its first line — before any DB work. New menu callbacks arrive via the same `handleCallbackQuery` path so they benefit from this automatically.

**How to avoid:** Route all menu callbacks through the existing `handleCallbackQuery` dispatch path. Never create a separate webhook handler that bypasses the existing `answerCallbackQuery` call.

### Pitfall 5: Business Identity from callback_data (Cross-Tenant)

**What goes wrong:** Using a businessId embedded in `callback_data` directly for DB mutations. A crafted callback could target another tenant's data.

**Why it happens:** Convenience — `callback_data` is available at callback time.

**How to avoid:** Always re-derive `businessId` from `senderTelegramId` via `findBusinessByOwnerTelegramId(senderTelegramId)`. The `business` object available in `handleFoundBusiness` is NOT available in `handleCallbackQuery` — the callback handler must re-fetch. This is the established pattern in all existing billing/slotless/renewal handlers.

### Pitfall 6: editMessageReplyMarkup After Menu Navigation

**What goes wrong:** After a button tap navigates to a sub-menu, the original message still shows the old keyboard. If the owner taps old buttons repeatedly, stale callbacks fire.

**Why it happens:** Telegram keeps keyboards persistent unless explicitly cleared.

**How to avoid:** After any navigation callback, clear the previous keyboard via `editTelegramMessageReplyMarkup(senderTelegramId, callbackQuery.message.message_id, [])` before sending the new menu message. The `callbackQuery.message?.message_id` is available in `handleCallbackQuery` (it's already used for billing/slotless cleanup).

---

## Code Examples

### Root Menu Display

```typescript
// Source: follows payment-flow.ts showClientSelection pattern
export async function showAdminRootMenu(chatId: string, business: Business): Promise<void> {
  const keyboard: InlineKeyboard = [
    [
      { text: '⚙️ Ρυθμίσεις', callback_data: 'menu:settings' },
      { text: '📅 Μαθήματα', callback_data: 'menu:classes' },
    ],
    [
      { text: '👥 Πελάτες', callback_data: 'menu:clients' },
      { text: '📋 Ατζέντα', callback_data: 'menu:agenda' },
    ],
  ];
  await sendTelegramMessageWithKeyboard(
    chatId,
    `Πίνακας Ελέγχου — ${business.name}`,
    keyboard
  );
}
```

### Extended parseCallbackData

```typescript
// Source: follows existing billingMatch / slotlessMatch pattern in telegram.ts
export type MenuCallbackResult = {
  menuAction: string; // discriminant: unique field name not in other result types
  id?: number;
};

// In parseCallbackData():
const menuMatch = data?.match(/^menu:([\w:]+?)(?::(\d+))?$/);
if (menuMatch) {
  return {
    menuAction: menuMatch[1],
    id: menuMatch[2] ? Number(menuMatch[2]) : undefined,
  };
}
```

### handleCallbackQuery Extension

```typescript
// Source: follows existing 'businessId' in parsed / 'firstId' in parsed pattern
if ('menuAction' in parsed) {
  const menuResult = parsed as MenuCallbackResult;
  const ownerBusiness = await findBusinessByOwnerTelegramId(senderTelegramId);
  if (!ownerBusiness) {
    logger.warn({ senderTelegramId }, 'menu callback from unregistered owner, ignoring');
    return;
  }
  if (callbackQuery.message?.message_id) {
    await editTelegramMessageReplyMarkup(senderTelegramId, callbackQuery.message.message_id, []);
  }
  await handleMenuCallback(menuResult, ownerBusiness, senderTelegramId, callbackQuery);
  return;
}
```

### On-Demand Agenda (formatAgendaMessage export)

```typescript
// In scheduler/agenda.ts — change from:
function formatAgendaMessage(bookings: Booking[], serviceNamesById: Map<number, string>): string

// to:
export function formatAgendaMessage(bookings: Booking[], serviceNamesById: Map<number, string>): string
```

---

## Recommended Plan Structure

Phase 17 fits cleanly into 4 plans, each independently testable:

| Plan | Focus | Key Deliverables |
|------|-------|-----------------|
| 17-01 | Foundation: /menu detection + parseCallbackData extension | `/menu` pre-emption in handleFoundBusiness; MenuCallbackResult type; handleMenuCallback dispatcher skeleton; root menu display; formatAgendaMessage export |
| 17-02 | Settings + Agenda sub-menus | showSettingsMenu (read-only display); binary toggle handlers (slotless, booking mode, cancellation cutoff on/off); showTodaysAgenda on-demand |
| 17-03 | Classes sub-menu | showClassesMenu; showUpcomingClasses; cancel class flow with Ναι/Όχι confirmation |
| 17-04 | Clients sub-menu | showClientsList; showClientBalance; send renewal nudge from menu |

Each plan produces a working, independently exercisable feature slice. Plans 17-01 must complete before 17-02/17-03/17-04 (it defines the callback routing infrastructure). Plans 17-02, 17-03, and 17-04 can be executed sequentially without ordering constraints among themselves.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|-----------------|--------|
| All owner commands via free-text NLU (aiOwnerAgent) | Structured `/menu` command + inline keyboard for common operations | Reduces Gemini API calls; more discoverable for owner |
| Binary decisions only for booking approve/reject | Binary decisions for class cancel, settings toggles | Consistent UX pattern across all owner decisions |

**Deprecated/outdated:**
- None for this phase. No existing behavior is removed — menu is additive.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `formatAgendaMessage` accepts `Booking[]` from `listBookingsForDate` with the same shape used in `runAgendaSweep` | AMENU-05 implementation | If function signature differs, on-demand agenda returns wrong format — low risk, both call sites are in same repo |
| A2 | Settings toggles (slotless, booking mode, cancellation cutoff on/off) are safe to perform directly in the callback handler without AI confirmation | AMENU-02 | If owner taps wrong button, there is no undo. Mitigate with Ναι/Όχι confirmation step for destructive toggles (e.g. disabling slotless removes pending requests from display) |
| A3 | `findClientBusinessRelationshipById` is already exported from database/queries.ts | AMENU-04 | If not exported, need to add it. Low risk — the function is referenced in payment-flow.ts already |

---

## Open Questions

1. **Settings mutations: keyboard toggle or chat redirect?**
   - What we know: Binary settings (slotless on/off, booking mode, cutoff on/off) can be toggled via keyboard. Free-text settings (hours, prices, service names) cannot.
   - What's unclear: Should cutoff hours (a numeric value) show an edit prompt or route to chat?
   - Recommendation: Route all numeric value changes to chat (aiOwnerAgent). Show current value in the settings display with a "Γράψε μου στο chat για αλλαγή" note.

2. **Client list cap: how many clients to show?**
   - What we know: `getAllClientsForBusiness` returns all clients with no limit. Telegram inline keyboards with >30 buttons become unwieldy.
   - What's unclear: Typical PoC business size (1-20 clients expected in PoC).
   - Recommendation: Cap at 20 clients in the keyboard, append a note if more exist (follows listSessions pattern).

3. **"Back" button: message edit or new message?**
   - What we know: `editMessageText` (not yet in `client.ts`) can edit in-place. Sending a new message leaves a trail.
   - What's unclear: Whether in-place editing improves UX enough to warrant adding `editMessageText` to `client.ts`.
   - Recommendation: Send new message for each sub-menu level (simpler, no need for new Telegram API method). Clear old keyboard via `editTelegramMessageReplyMarkup`.

---

## Environment Availability

Phase 17 is purely TypeScript code changes. No new external dependencies. All external services (Telegram Bot API, Neon, Google Gemini) already operational.

| Dependency | Required By | Available | Notes |
|------------|------------|-----------|-------|
| Telegram Bot API (sendMessage, editMessageReplyMarkup, answerCallbackQuery) | All menu rendering | Yes | Already in src/telegram/client.ts |
| Neon Postgres | DB reads for settings, clients, sessions | Yes | Already operational |
| Google Gemini API | create_recurring_session redirected to chat | Yes | Not called from menu path directly |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest (inferred from project conventions — no jest.config found in scan, but existing test patterns use Jest based on CLAUDE.md note about `--testPathPattern`) |
| Quick run command | `npx jest --testPathPattern=admin-menu` |
| Full suite command | `npx jest --testPathPattern=admin-menu` |

### Phase Requirements → Test Map

| ID | Behavior | Test Type | Notes |
|----|----------|-----------|-------|
| AMENU-01 | /menu detected pre-aiOwnerAgent | unit | Test handleFoundBusiness with text="/menu"; verify showAdminRootMenu called |
| AMENU-01 | Root menu has 4 buttons in 2×2 layout | unit | Test showAdminRootMenu output keyboard shape |
| AMENU-02 | Settings sub-menu shows current business values | unit | Mock business object; verify message text includes setting values |
| AMENU-03 | Class list shows upcoming sessions | unit | Mock listSessions; verify formatted output |
| AMENU-03 | Cancel class confirm → Ναι fires cancelSession | unit | Mock cancelSession; verify called with correct instanceId |
| AMENU-04 | Client list uses getAllClientsForBusiness | unit | Mock getAllClientsForBusiness; verify keyboard buttons |
| AMENU-04 | Client balance calls getClientActiveMembership | unit | Mock getClientActiveMembership; verify Greek message format |
| AMENU-05 | On-demand agenda skips claimAgendaSlot | unit | Verify claimAgendaSlot NOT called when handling menu:agenda |
| AMENU-06 | parseCallbackData returns MenuCallbackResult for menu: prefix | unit | Test parseCallbackData("menu:classes:cancel:42") returns {menuAction:"classes:cancel",id:42} |
| Cross-cutting | menu: callback without owner ownership is ignored | unit | Mock findBusinessByOwnerTelegramId returning null; verify no DB mutation |

### Wave 0 Gaps

- [ ] `src/telegram/handlers/admin-menu.ts` — new file, covers AMENU-01 through AMENU-06
- [ ] Unit tests for `parseCallbackData` MenuCallbackResult arm
- [ ] Export `formatAgendaMessage` from `scheduler/agenda.ts`

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Admin is recognized by ownerTelegramId match only — no new auth |
| V3 Session Management | No | Stateless keyboard; no session table |
| V4 Access Control | Yes | Every callback handler re-derives businessId from senderTelegramId via findBusinessByOwnerTelegramId |
| V5 Input Validation | Yes | callback_data matched via regex before use; numeric IDs parsed with Number() and validated |
| V6 Cryptography | No | No new crypto |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged callback_data with foreign instanceId | Tampering | Re-derive businessId from senderTelegramId; use FK chain (catalogId → businessId) in cancelSession |
| Callback replay (old menu button tapped after navigation) | Tampering | Idempotent handlers — cancelSession returns false if already cancelled; toggles are idempotent |
| Owner menu accessible to client | Elevation of privilege | findBusinessByOwnerTelegramId check in every menu callback handler; returns null for non-owners |
| Arbitrary text in callback_data (injection) | Tampering | Regex validation in parseCallbackData; only alphanumeric + colon + digits accepted |

---

## Sources

### Primary (HIGH confidence)

- Codebase `src/webhooks/telegram.ts` — `parseCallbackData`, `handleCallbackQuery`, `handleFoundBusiness` patterns [VERIFIED: codebase]
- Codebase `src/telegram/handlers/payment-flow.ts` — stateless keyboard flow template [VERIFIED: codebase]
- Codebase `src/scheduler/agenda.ts` — `formatAgendaMessage`, `claimAgendaSlot` contracts [VERIFIED: codebase]
- Codebase `src/billing/queries.ts` — `getAllClientsForBusiness`, `getClientActiveMembership` signatures [VERIFIED: codebase]
- Codebase `src/session/manager.ts` — `listSessions`, `cancelSession` signatures [VERIFIED: codebase]
- Codebase `src/onboarding/ai-owner-agent.ts` — OWNER_TOOLS list, settings mutation patterns [VERIFIED: codebase]
- Codebase `src/database/schema.ts` — `businesses` table columns available in Business interface [VERIFIED: codebase]

### Secondary (MEDIUM confidence)

- Telegram Bot API inline keyboard 64-byte `callback_data` limit [ASSUMED — well-known Telegram constraint; enforced by existing `payment-flow.ts` guard]

---

## Metadata

**Confidence breakdown:**
- Command detection pattern: HIGH — directly read handleFoundBusiness; trivial pre-emption
- Callback routing extension: HIGH — parseCallbackData discriminant union pattern fully understood
- Settings sub-menu (read-only + binary toggles): HIGH — all field values available on Business interface
- Classes sub-menu: HIGH — listSessions, cancelSession already exist with correct signatures
- Clients sub-menu: HIGH — getAllClientsForBusiness, getClientActiveMembership exist; pattern mirrors payment-flow
- Today's agenda on-demand: HIGH — formatAgendaMessage exists; only needs export; claimAgendaSlot must be bypassed
- 64-byte callback_data sizing: HIGH — verified against longest proposed callback strings

**Research date:** 2026-07-24
**Valid until:** 90 days (stable architecture; no external dependencies changing)
