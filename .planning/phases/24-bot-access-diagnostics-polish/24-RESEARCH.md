# Phase 24: Bot Access & Diagnostics Polish - Research

**Researched:** 2026-07-27
**Domain:** Telegram Bot API menu button registration, error diagnostics & owner notifications
**Confidence:** HIGH

## Summary

Phase 24 requires two independent, small features: (1) **BOT-06** — persistent Telegram menu buttons scoped to owner vs clients so each can one-tap access their respective menu without retyping commands; (2) **DIAG-01** — when the bot sends its generic Greek error fallback to a *client*, the owner's chat receives a best-effort technical follow-up message (what step/tool failed, error details). Both features reuse existing patterns and rely on Telegram Bot API capabilities already present in the codebase.

**Primary recommendation:** Implement BOT-06 by adding `setChatMenuButton` and `setMyCommands` HTTP wrappers to `src/telegram/client.ts` (mirroring the existing `callTelegramApiDirect` pattern), called during owner bot activation in `src/onboarding/queries.ts`'s `registerBotWebhook` flow. Set the owner's chat-specific menu button + commands at activation time (chat_id known), and establish a BotCommandScopeAllPrivateChats default for clients. For DIAG-01, inject owner-notification logic at the two confirmed client-facing fallback sites (`aiBookingAgent` catch and `handleFoundBusiness` catch) following the proven Phase 22/23 best-effort pattern (`if (business.ownerTelegramId && business.botToken) { try { botTokenStore.run(...) } }`); correlate failures using the `requestId` (aiBookingAgent) or error object (handleFoundBusiness).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Menu button UI registration | API / Backend | — | Telegram Bot API calls during onboarding (backend-only) |
| Per-chat menu button scoping | API / Backend | — | Requires chat_id known at bot activation (backend-only) |
| Client-facing error fallback | Client-visible Telegram message | API / Backend | Message composed in backend, sent via Telegram webhook response |
| Owner-facing diagnostic message | Admin-visible Telegram message | API / Backend | Sent best-effort to owner after client error is handled |

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BOT-06 | Persistent Telegram menu button (admin `/menu`, client `/start`) scoped by owner vs client | Telegram API supports `setChatMenuButton(chat_id)` + `BotCommandScope{Chat,AllPrivateChats}` for per-chat / per-scope scoping; call during `registerBotWebhook` for owner, default for clients |
| DIAG-01 | Owner gets technical follow-up when bot sends generic Greek error to client | Two fallback sites confirmed client-facing: (1) `aiBookingAgent` catch with `requestId`, (2) `handleFoundBusiness` catch with error object; owner notification pattern proven in Phase 22 |

## Telegram Bot API: Menu Button & Command Scoping

### setChatMenuButton

**Method Signature:** `POST https://api.telegram.org/bot<token>/setChatMenuButton`

**Parameters:**
- `chat_id` (integer, optional): Unique identifier for target private chat. If omitted, default menu button is set.
- `menu_button` (object): MenuButton object (e.g., `{ type: 'commands' }` for default /commands menu)

**Behavior:**
- When a specific `chat_id` is provided, the menu button applies only to that chat.
- If no `chat_id` is specified, the default menu button (global) is changed.
- For private chats, a custom menu button takes precedence over the default.

**Source:** [BotCommandScopeChat documentation](https://core.telegram.org/type/BotCommandScope), [setChatMenuButton aiogram docs](https://docs.aiogram.dev/en/latest/api/methods/set_chat_menu_button.html)

### setMyCommands with BotCommandScope

**Method Signature:** `POST https://api.telegram.org/bot<token>/setMyCommands`

**Parameters:**
- `commands` (array): List of command objects: `{ command: "menu", description: "Δείτε το μενού" }`
- `scope` (object): [CITED: core.telegram.org] One of:
  - `BotCommandScopeDefault` — applies to all chats (default if scope omitted)
  - `BotCommandScopeAllPrivateChats` — applies to all private chats
  - `BotCommandScopeChat` — applies to specific chat (requires `chat_id`)
  - `BotCommandScopeChatAdministrators` / `BotCommandScopeChatMember` — group-specific (not used for single-business per-bot)
- `language_code` (string, optional): ISO 639-1 language code (e.g., "el" for Greek)

**Scope Resolution:** Telegram matches the most specific scope for each user. `BotCommandScopeChat` overrides `BotCommandScopeAllPrivateChats`, which overrides `BotCommandScopeDefault`.

**Source:** [Telegram Bot API setMyCommands](https://gramio.dev/telegram/methods/setmycommands), [aiogram setMyCommands docs](https://docs.aiogram.dev/en/latest/api/methods/set_my_commands.html)

## Implementation Patterns

### 1. Adding Menu Button HTTP Wrappers (src/telegram/client.ts)

The existing `callTelegramApiDirect` function (lines 132–170) handles out-of-band API calls with an explicit bot token. Mirror this pattern for `setChatMenuButton` and `setMyCommands`:

```typescript
// In src/telegram/client.ts, add after unregisterBotWebhook():

export async function setChatMenuButton(
  botToken: string,
  chatId: string,
  menuButton?: { type: 'commands' | 'web_app' | 'default' }
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (chatId) body.chat_id = chatId;
  if (menuButton) body.menu_button = menuButton;
  
  await callTelegramApiDirect<boolean>(botToken, 'setChatMenuButton', body);
}

export async function setMyCommands(
  botToken: string,
  commands: Array<{ command: string; description: string }>,
  scope?: { type: string; chat_id?: string }
): Promise<void> {
  const body: Record<string, unknown> = {
    commands,
  };
  if (scope) body.scope = scope;
  
  await callTelegramApiDirect<boolean>(botToken, 'setMyCommands', body);
}
```

### 2. Calling During Bot Activation

In `src/onboarding/queries.ts`, the `registerBotWebhook` function is called once per bot during owner onboarding (Phase 5 decision, per STATE.md). This is the ideal place to also register the owner's scoped menu button and commands.

**Location:** `registerBotWebhook` or a new wrapper function called after webhook registration is confirmed.

**Timing:** Once `registerBotWebhook` succeeds and the owner's Telegram ID is known (already available in onboarding context).

**Action:**
```typescript
// Pseudo-code
// 1. Set owner's scoped menu button + commands
await setChatMenuButton(botToken, ownerTelegramId, { type: 'commands' });
await setMyCommands(botToken, ownerCommands, {
  type: 'BotCommandScopeChat',
  chat_id: ownerTelegramId,
});

// 2. Set default (all private chats) for clients
// This can be done once per bot, or lazily on first client message
await setMyCommands(botToken, clientCommands, {
  type: 'BotCommandScopeAllPrivateChats',
});
```

### 3. Owner-Facing Diagnostic Notification (DIAG-01)

Pattern confirmed in Phase 22 (approval keyboard) and Phase 23 (cascade cancel notify):

```typescript
try {
  if (business.ownerTelegramId && business.botToken) {
    const diagnosticMsg = `⚠️ Σφάλμα κατά την ανταπόκριση: <error-type>\nRequest ID: <requestId>\nΕπικοινωνήστε με support αν το πρόβλημα επαναληφθεί.`;
    
    await botTokenStore.run(business.botToken, async () => {
      await sendTelegramMessage(business.ownerTelegramId!, diagnosticMsg);
    });
  }
} catch (err) {
  logger.error({ err, businessId: business.id }, 'Owner diagnostic notification failed (best-effort)');
}
```

**Key Insight:** `botTokenStore.run(business.botToken, ...)` is required to set the current request's bot token context before calling `sendTelegramMessage`. This is already the pattern used throughout Phases 22–23.

## Client-Facing Fallback Call Sites (DIAG-01 Applies)

Research identified exactly TWO call sites where a generic Greek error message is sent to a CLIENT (not an owner):

### Site 1: aiBookingAgent (src/conversation/ai-agent.ts, lines 396–422)

**Trigger:** Any unrecoverable error during Gemini AI agent loop (Gemini API failure, rate limit exhaustion after retries, timeout, malformed response, etc.)

**Current behavior (lines 413–422):**
```typescript
} catch (err) {
  logger.error(
    { err, requestId, businessId: business.id, round, elapsedMs: Date.now() - agentStartedAt },
    'aiBookingAgent: unrecoverable Gemini call failure, returning fallback reply'
  );
  return {
    text: AGENT_ERROR_REPLY_GREEK, // 'Το σύστημα δεν απόκρινε. Δοκιμάστε ξανά σε λίγο.'
    interactionId: currentInteractionId ?? null,
    requestId,
    toolCalls: accumulatedToolCalls,
  };
}
```

**Diagnostic data available:**
- `requestId` (UUID, unique per client message turn) ✓
- `businessId` ✓
- `round` (which Gemini tool-call round failed, 1–6) ✓
- `err` (error object with message/type)
- `elapsedMs` (total time before failure)

**Path to owner:** The returned `requestId` is persisted in the `AiAgentResult` struct → passed to `routeConversationMessage` → persisted in `insertConversationTurn` (line 63–71, router.ts). The owner-facing message should reference this `requestId` for log correlation.

### Site 2: handleFoundBusiness catch (src/webhooks/telegram.ts, lines 159–180)

**Trigger:** Any error thrown by routeConversationMessage (client message) or other setup logic in the client branch (lines 149–154). This is a catch-all for errors that escape the aiBookingAgent's own try/catch.

**Current behavior (lines 168–179):**
```typescript
} catch (err) {
  logger.error(
    { err, updateId, businessId: business.id, senderTelegramId, elapsedMs: Date.now() - startedAt },
    'Failed to route Telegram conversation message'
  );
  try {
    await sendTelegramMessage(senderTelegramId, 'Παρουσιάστηκε πρόβλημα. Δοκιμάστε ξανά σε λίγο.');
  } catch (sendErr) {
    logger.error(
      { err: sendErr, updateId, senderTelegramId },
      'handleFoundBusiness: failed to send fallback error message to client'
    );
  }
}
```

**Diagnostic data available:**
- `err` (error object) ✓
- `updateId` (Telegram update ID, unique per incoming message) ✓
- `businessId` ✓
- `senderTelegramId` (client Telegram ID) ✓
- `elapsedMs` (total time before failure)

**Path to owner:** No requestId available here (error happened outside aiBookingAgent). Owner message should reference `updateId` or error type/message extracted from `err`.

### Sites 3 & 4: NOT client-facing (DIAG-01 does NOT apply)

- **aiOwnerAgent catch (src/onboarding/ai-owner-agent.ts, line 946–951):** Owner receives the error message directly. Sending the owner a technical message about their own error is redundant/confusing. ❌
- **aiOnboardingAgent catch (src/onboarding/ai-onboarding-agent.ts, line 676–681):** Owner receiving onboarding messages. Same rationale as above. ❌

## Structured Logging & Correlation

**Current State:**
- Pino structured logger is used throughout (already added per Phase 23 cycle-2 fixes per STATE.md).
- Logs include `requestId` for client conversation turns, `updateId` for webhook updates.
- Fly logs are aggregated; grepping by `requestId` or `updateId` correlates client + system logs.

**For DIAG-01 owner notification:**
- Include the `requestId` (for Site 1) or `updateId` (for Site 2) in the owner-facing message.
- Owner can then ask support or check logs with this ID for full context.
- Message format: "⚠️ [error type] — Request ID: <requestId> (UTC timestamp optional)"

## Known Limitations & Open Questions

### BOT-06: Menu Button Timing

**Current codebase architecture:**
- Per-business, per-bot deployment (Phase 16 pivot).
- Owner Telegram ID is determined at onboarding time (Phase 5).
- Client Telegram IDs are unknown until first message arrives.

**Implication for BOT-06:**
- Owner's scoped menu button CAN be set immediately after `registerBotWebhook` succeeds (owner chat_id known).
- Clients' default menu button (BotCommandScopeAllPrivateChats) should be set once per bot, either:
  - During `registerBotWebhook` as well, OR
  - Lazily on first client message (but this adds latency to first-message experience)
  
**Recommendation:** Set both during `registerBotWebhook` for simplicity and consistency.

### BOT-06: Command List Design

The research did not specify what commands should appear in each scope. Per the ROADMAP and existing code:
- **Owner commands:** `/menu` (Phase 17) is the main one; future admin commands would go here.
- **Client commands:** `/start` (Phase 18) is the main one; clients can also send free-text queries.

**Decision point for planner:** Should `/start` and `/menu` appear in BOTH scopes, or is `/menu` owner-only and `/start` client-only? Based on Phase 17/18 menu design:
- `/menu` shows admin sub-menus → owner-only makes sense.
- `/start` shows client welcome → client-only makes sense.
- Other commands (e.g., `/help`, `/contact`) could be in both or either.

For this phase's PoC, a minimal implementation:
- Owner scope: `/menu`, `/today` (view today's schedule)
- Client scope: `/start`, `/help`

### DIAG-01: Error Type Extraction

**Current state:** Errors are logged as full error objects. At the fallback sites, we have:
- `err.message` (string) — e.g., "Gemini rate limit exceeded" or "Database connection timeout"
- `err.name` (string) — e.g., "GeminiRateLimitError" or "TimeoutError"

**For human-readable owner message:** Extract error type and a 1-line summary. Examples:
- "Gemini API rate-limited — try again in a minute"
- "Database timeout — contact support"
- "Telegram API error: 403 Forbidden"

**Open question:** Should planner implement a structured error classification (e.g., `LockedErrorType enum { GEMINI_RATE_LIMIT, DB_TIMEOUT, TELEGRAM_BLOCKED, ... }`) or use simple string extraction (`err.name`)? For this PoC, string extraction from `err.name` + `err.message` is sufficient.

## Standard Stack

### Telegram Bot API Methods (HTTP)

| Method | Version | Purpose | Why Standard |
|--------|---------|---------|--------------|
| `setChatMenuButton` | Bot API 6.2+ | Set menu button for specific chat | Official Telegram API; simplest way to provide UI affordance for commands |
| `setMyCommands` | Bot API 5.3+ | Register command list with optional scope | Official; supports per-scope command scoping for owner vs client UX |

### Implementation Library

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `node` fetch (built-in) | 20+ | HTTP POST to Telegram API | Already used in `src/telegram/client.ts` via `callTelegramApiDirect`; no new dependency needed |
| `pino` (existing) | 10.3.1 | Structured logging | Already in use; requestId/updateId correlation already present |

**No new npm packages required for either feature.**

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Telegram Bot API HTTP calls | Custom fetch logic | Existing `callTelegramApiDirect` pattern in `src/telegram/client.ts` | Already handles timeout, error JSON parsing, logging, response validation |
| Menu button rendering (Telegram-side) | Custom keyboard logic | Telegram's native MenuButton (type: 'commands') | Menu buttons are rendered by Telegram, not by the bot — the bot only registers the config |
| Owner notifications | Custom channels / webhooks | Existing Telegram message pattern (`botTokenStore.run`, `sendTelegramMessage`) | Proven in Phase 22–23; ensures owner always gets message in the same chat where they manage the business |
| Error type classification | Complex error hierarchy | Simple `err.name` + `err.message` string extraction | PoC doesn't need sophisticated error categorization; strings suffice for human-readable diagnostic messages |

## Existing Patterns to Reuse

### 1. Out-of-Band Telegram API Calls

**Pattern:** `callTelegramApiDirect(botToken, method, body)` (lines 132–170, telegram/client.ts)

**Used by:**
- `getMeBotInfo` (line 177)
- `registerBotWebhook` (line 194)
- `unregisterBotWebhook` (line 210)

**Reuse for:** `setChatMenuButton`, `setMyCommands`

### 2. In-Request Bot Context Management

**Pattern:** `botTokenStore.run(business.botToken, async () => { await sendTelegramMessage(...) })`

**Used by:**
- Phase 22: Approval keyboard notifications (function-executor.ts)
- Phase 23: Cascade-cancel notifications (client-menu.ts)
- Phase 20: Escalation notifications (escalation.ts)

**Reuse for:** Owner diagnostic notification in DIAG-01

### 3. Best-Effort Owner Notification

**Pattern:**
```typescript
try {
  if (business.ownerTelegramId && business.botToken) {
    await botTokenStore.run(business.botToken, async () => {
      await sendTelegramMessage(business.ownerTelegramId!, msg);
    });
  }
} catch (err) {
  logger.error({ err, ... }, 'Owner notification failed (best-effort)');
}
```

**Used by:** Phase 22, Phase 23, Phase 20 (all owner notifications)

**Reuse for:** DIAG-01 owner diagnostic notification

## Common Pitfalls

### Pitfall 1: Menu Button Timing — Calling Too Early

**What goes wrong:** If `setChatMenuButton(chatId)` is called before the owner has sent any message to the bot, Telegram may reject the call with "chat not found" or silently ignore it.

**Why it happens:** Telegram requires the chat to exist in the bot's context. A private chat is "created" from Telegram's side when the user sends the first `/start` or message to the bot.

**How to avoid:** Set the owner's menu button AFTER they complete onboarding and their Telegram ID is confirmed in the database. This happens during `registerBotWebhook` in `src/onboarding/queries.ts`, which is already called after the owner has messaged the bot to register it. ✓ Safe.

**Warning signs:** Owner complains that menu button doesn't appear; logs show `setChatMenuButton` errors for the ownerTelegramId.

### Pitfall 2: Confusing Client and Owner Fallback Paths

**What goes wrong:** Developer adds DIAG-01 owner notification to aiOwnerAgent or aiOnboardingAgent, sending the owner a message like "The system didn't respond — try again." This is confusing when the owner JUST sent a message and received the exact error message.

**Why it happens:** The error path is the same (generic fallback text), but the RECIPIENT is different (owner vs. client). The research requirement explicitly states "when the bot sends the generic Greek fallback error message to a **client**" — the owner is not a client, they are the recipient.

**How to avoid:** Implement DIAG-01 only at the two confirmed client-facing fallback sites: (1) aiBookingAgent catch, (2) handleFoundBusiness catch (which can be after routeConversationMessage, the client path). ✓ Verified by code flow analysis.

**Warning signs:** Logs show owner-facing agents returning fallback; owner receives duplicate error messages (one to them, one to the client).

### Pitfall 3: botTokenStore Context Not Set During Owner Notification

**What goes wrong:** Developer calls `sendTelegramMessage(ownerTelegramId, msg)` directly without wrapping in `botTokenStore.run(business.botToken, ...)`. The call fails with "botTokenStore context missing" error.

**Why it happens:** `sendTelegramMessage` reads the current request's bot token from `botTokenStore` (AsyncLocalStorage). If not set, the function throws. This is a safety feature to prevent accidental use of the wrong bot token across concurrent requests.

**How to avoid:** Always wrap owner-notification sends in `botTokenStore.run(business.botToken, async () => { ... })`. ✓ Pattern proven in Phase 22–23.

**Warning signs:** Error logs: "callTelegramApi called without botTokenStore context"; owner never receives diagnostic message.

### Pitfall 4: requestId Lost Between aiBookingAgent and Owner

**What goes wrong:** aiBookingAgent returns a requestId, but the owner-facing message fails to include it, so the owner can't correlate their diagnostic message to the client's error in the logs.

**Why it happens:** Developer doesn't thread the requestId from aiBookingAgent → routeConversationMessage → insertConversationTurn → (later) owner notification. The requestId is logged in aiBookingAgent but not accessible at the fallback site.

**How to avoid:** For Site 1 (aiBookingAgent), the requestId is returned in the AiAgentResult and persisted in insertConversationTurn (line 67, router.ts). To include it in the owner message, either:
- Query `findLatestConversationTurn` for this client to retrieve the most recent requestId, OR
- Emit the owner notification from within aiBookingAgent's catch (before returning the fallback text).

The second approach is simpler: in aiBookingAgent line 413–422, immediately after logging, call the owner-notification helper (before returning). This keeps the requestId in scope. ✓ Recommended for Phase 24 plan.

**Warning signs:** Owner message has no requestId; logs show mismatched client and admin messages.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 |
| Config file | jest.config.js (existing) |
| Quick run command | `npm run test -- tests/PHASEXX.test.ts` |
| Full suite command | `npm run test` (but see Memory.md: use --testPathPattern to avoid crash) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BOT-06 | Owner receives menu button + scoped commands after bot activation | integration | `npm run test -- tests/BOT-06.test.ts` | ❌ Wave 0 |
| BOT-06 | Client receives default menu button + commands after first message | integration | (covered by existing client-menu tests or new integration) | ❌ Wave 0 |
| DIAG-01 | When aiBookingAgent fails, owner receives diagnostic message with requestId | integration | `npm run test -- tests/DIAG-01.test.ts` | ❌ Wave 0 |
| DIAG-01 | When handleFoundBusiness catch fires (client path), owner receives diagnostic with updateId | integration | (covered by DIAG-01.test.ts) | ❌ Wave 0 |

### Wave 0 Gaps
- [ ] `tests/BOT-06.test.ts` — integration tests for setChatMenuButton/setMyCommands during onboarding
- [ ] `tests/DIAG-01.test.ts` — integration tests for owner diagnostic notification on client errors
- [ ] Mock helpers: `jest.mock('src/telegram/client')` to spy on `setChatMenuButton` / `setMyCommands` calls
- [ ] Mock helpers: `jest.mock('src/telegram/client')` to verify `sendTelegramMessage` called with diagnostic text + requestId/updateId

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Telegram Bot API (HTTP) | BOT-06, DIAG-01 | ✓ | Bot API 6.2+ | — |
| Node.js 20+ (built-in fetch) | BOT-06, DIAG-01 | ✓ | 20.16.11 | — |
| Neon DB (existing) | DIAG-01 (queryconversation_turns for requestId) | ✓ | — | — |
| Pino logger (existing) | BOT-06, DIAG-01 | ✓ | 10.3.1 | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

## Security Considerations

### ASVS Categories Applicable

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | No | Bot token stored in DB, not modified by BOT-06/DIAG-01 |
| V3 Session Management | No | Telegram manages session; bot doesn't create sessions |
| V4 Access Control | **Yes** | Menu button + commands scoped by `BotCommandScopeChat` (Telegram enforces); requestId correlated to owner-only (no cross-business data leak) |
| V5 Input Validation | No | Menu button/command registration is bot-to-API only, no user input |
| V6 Cryptography | No | Bot token already HMAC-verified in webhook (Phase 4); no new crypto needed |

### Access Control (BOT-06)

- **Threat:** Owner's scoped menu button accidentally visible to clients, or clients' menu button visible to owner.
- **Mitigation:** Telegram's `BotCommandScope` system (V4 framework) enforces scoping server-side. If a client sends a message to a chat with an owner-only command registered, Telegram does not include that command in the client's command list. The bot has no enforcement responsibility; Telegram handles it.

### Access Control (DIAG-01)

- **Threat:** Technical diagnostic message sent to the wrong owner (e.g., owner A receives diagnostic for owner B's client error).
- **Mitigation:** Owner notification uses `business.ownerTelegramId` (RLS-scoped to current business in webhook context via `withBusinessContext`). Cross-business data cannot leak because each webhook call is wrapped in a business context. ✓ RLS enforced by Phase 4 database layer.

### Best-Effort Delivery (DIAG-01)

- **Design:** Owner diagnostic notification is best-effort (caught & logged, never throws back).
- **Rationale:** Client already received their fallback message. If owner notification fails, client should not be affected. This is acceptable for a diagnostic feature (nice-to-have, not critical).

## Code Examples

### BOT-06: Adding Menu Button HTTP Wrappers

**Source:** Mirrors `callTelegramApiDirect` pattern in src/telegram/client.ts

```typescript
// src/telegram/client.ts, add these after unregisterBotWebhook():

/**
 * Sets the menu button for a specific chat or the default (if no chat_id).
 * For private chats only. Type 'commands' uses the registered command list.
 */
export async function setChatMenuButton(
  botToken: string,
  chatId?: string,
  menuButton?: { type: 'commands' | 'web_app' | 'default' }
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (chatId) body.chat_id = chatId;
  if (menuButton) body.menu_button = menuButton;
  
  await callTelegramApiDirect<boolean>(botToken, 'setChatMenuButton', body);
  logger.debug(
    { chatId: chatId || '(default)', menuButtonType: menuButton?.type || 'default' },
    'Menu button set'
  );
}

/**
 * Registers the bot's commands with an optional scope.
 * Scope defaults to global if not provided.
 */
export async function setMyCommands(
  botToken: string,
  commands: Array<{ command: string; description: string }>,
  scope?: { type: string; chat_id?: string }
): Promise<void> {
  const body: Record<string, unknown> = {
    commands,
  };
  if (scope) body.scope = scope;
  
  await callTelegramApiDirect<boolean>(botToken, 'setMyCommands', body);
  logger.debug(
    { scopeType: scope?.type || 'BotCommandScopeDefault', commandCount: commands.length },
    'Commands registered'
  );
}
```

### BOT-06: Calling During Onboarding

**Location:** src/onboarding/queries.ts, in the `activateBusiness` or wrapper function

```typescript
// Pseudo-code; exact location TBD by planner
async function registerOwnerMenuAndCommands(
  botToken: string,
  ownerTelegramId: string
): Promise<void> {
  const ownerCommands = [
    { command: 'menu', description: 'Εμφάνιση μενού διαχείρισης' },
    { command: 'today', description: 'Δείτε σημερινά ραντεβού' },
  ];
  
  const clientCommands = [
    { command: 'start', description: 'Έναρξη κράτησης ραντεβού' },
    { command: 'help', description: 'Βοήθεια' },
  ];
  
  try {
    // Set owner's scoped commands
    await setMyCommands(botToken, ownerCommands, {
      type: 'BotCommandScopeChat',
      chat_id: ownerTelegramId,
    });
    
    // Set default for clients
    await setMyCommands(botToken, clientCommands, {
      type: 'BotCommandScopeAllPrivateChats',
    });
    
    logger.info({ ownerTelegramId }, 'Owner menu + commands registered');
  } catch (err) {
    logger.error({ err, ownerTelegramId }, 'Failed to register menu/commands (best-effort)');
    // Not critical; continue onboarding
  }
}
```

### DIAG-01: Owner Diagnostic Notification at Site 1 (aiBookingAgent)

**Location:** src/conversation/ai-agent.ts, in the catch block (lines 396–422)

```typescript
} catch (err) {
  const elapsedMs = Date.now() - agentStartedAt;
  logger.error(
    { err, requestId, businessId: business.id, round, elapsedMs },
    'aiBookingAgent: unrecoverable Gemini call failure, returning fallback reply'
  );
  
  // DIAG-01: Send diagnostic to owner (best-effort, don't throw)
  try {
    const errorType = err?.name || 'Unknown';
    const errorMsg = err?.message || 'No details';
    const diagnosticText =
      `⚠️ Σφάλμα κατά την ανταπόκριση πελάτη\n` +
      `Τύπος: ${errorType}\n` +
      `Request ID: ${requestId}\n` +
      `(Ειδοποιηθείτε ότι ο πελάτης έλαβε generic fallback message)`;
    
    if (business.ownerTelegramId && business.botToken) {
      await botTokenStore.run(business.botToken, async () => {
        await sendTelegramMessage(business.ownerTelegramId!, diagnosticText);
      });
    }
  } catch (notifyErr) {
    logger.error(
      { err: notifyErr, requestId, businessId: business.id },
      'Failed to send DIAG-01 owner notification (best-effort)'
    );
  }
  
  return {
    text: AGENT_ERROR_REPLY_GREEK,
    interactionId: currentInteractionId ?? null,
    requestId,
    toolCalls: accumulatedToolCalls,
  };
}
```

### DIAG-01: Owner Diagnostic Notification at Site 2 (handleFoundBusiness)

**Location:** src/webhooks/telegram.ts, in the catch block (lines 159–180)

```typescript
} catch (err) {
  const elapsedMs = Date.now() - startedAt;
  logger.error(
    { err, updateId, businessId: business.id, senderTelegramId, elapsedMs },
    'Failed to route Telegram conversation message'
  );
  
  // Send fallback to client
  try {
    await sendTelegramMessage(senderTelegramId, 'Παρουσιάστηκε πρόβλημα. Δοκιμάστε ξανά σε λίγο.');
  } catch (sendErr) {
    logger.error(
      { err: sendErr, updateId, senderTelegramId },
      'handleFoundBusiness: failed to send fallback error message to client'
    );
  }
  
  // DIAG-01: Send diagnostic to owner (best-effort, don't throw)
  try {
    const errorType = err?.name || 'Unknown';
    const diagnosticText =
      `⚠️ Σφάλμα κατά την ανταπόκριση πελάτη\n` +
      `Τύπος: ${errorType}\n` +
      `Update ID: ${updateId}\n` +
      `(Ειδοποιηθείτε ότι ο πελάτης έλαβε generic fallback message)`;
    
    if (business.ownerTelegramId && business.botToken) {
      await botTokenStore.run(business.botToken, async () => {
        await sendTelegramMessage(business.ownerTelegramId!, diagnosticText);
      });
    }
  } catch (notifyErr) {
    logger.error(
      { err: notifyErr, updateId, businessId: business.id },
      'Failed to send DIAG-01 owner notification (best-effort)'
    );
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Menu button not available in Telegram Bot API | `setChatMenuButton` + scoped `setMyCommands` (Bot API 5.3–6.2) | June 2021 – Feb 2023 | Enables one-tap menu access; no need for user to type `/menu` or `/start` |
| Owner gets no visibility on client errors (silent failures) | DIAG-01: owner receives technical follow-up on client errors | Phase 24 (this phase) | Owner can troubleshoot recurring issues; improves support experience |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Telegram Bot API `setChatMenuButton` with `chat_id` parameter scopes menu to specific private chat | Telegram Bot API | Menu button is not scoped correctly, appears for all users instead of owner only |
| A2 | `BotCommandScopeChat` + `BotCommandScopeAllPrivateChats` prevent command-list overlap (Telegram enforces server-side) | Telegram Bot API | Commands appear in wrong scope; Telegram's behavior on scope collision is undefined |
| A3 | `requestId` (UUID) is unique per client conversation turn and sufficient for log correlation | Existing Code | Owner cannot correlate their diagnostic message to client error in logs; need to redesign correlation ID strategy |
| A4 | Best-effort owner notification pattern (try/catch, log only) is acceptable for DIAG-01 | Existing Code | Owner misses diagnostic messages if Telegram send fails; business owners complain about silent failures |

## Open Questions

1. **Menu button icon customization:** Can we specify a custom icon for the menu button, or does `type: 'commands'` use Telegram's default? Research shows Telegram's menu button is functional, not cosmetic, for this PoC, so the default is acceptable.

2. **Command description language:** Should command descriptions (e.g., "View today's schedule") be in Greek, English, or both? Telegram's command list is shown to users in their own language context (Telegram handles i18n). For Greek-speaking users, Greek descriptions are better. ✓ Already decided: Greek.

3. **Client menu button lazy registration:** Should the client's default menu button be registered during `registerBotWebhook` (owner onboarding) or lazily on the first client message? Registering during onboarding is simpler and faster for first client. ✓ Recommended.

4. **Owner notification urgency:** Should DIAG-01 messages be sent as regular messages or as "alert" notifications (toast pop-up in Telegram)? Research shows `answerCallbackQuery` supports `show_alert: true` for alerts, but `sendTelegramMessage` does not. Regular messages are sufficient for diagnostics (no need for alerts). ✓ Use regular `sendTelegramMessage`.

5. **Error type extraction:** Should we create a structured `ErrorType` enum (GEMINI_RATE_LIMIT, DB_TIMEOUT, etc.) or use simple `err.name` string extraction? For PoC, string extraction is sufficient; structured enums can be added in a later phase if needed. ✓ String extraction for Phase 24.

## Sources

### Primary (HIGH confidence)

- [Telegram Bot API BotCommandScope Documentation](https://core.telegram.org/type/BotCommandScope) — Official Telegram documentation for scope types
- [aiogram setMyCommands docs (v3.29.0)](https://docs.aiogram.dev/en/latest/api/methods/set_my_commands.html) — Implementation reference from mature Telegram SDK
- [aiogram setChatMenuButton docs (v3.15.0)](https://docs.aiogram.dev/en/v3.15.0/api/methods/set_chat_menu_button.html) — Implementation reference
- [Telegram Bot API (core.telegram.org)](https://core.telegram.org/bots/api) — Official API documentation
- **Codebase analysis:** src/telegram/client.ts, src/webhooks/telegram.ts, src/conversation/ai-agent.ts (verified fallback sites and patterns)

### Secondary (MEDIUM confidence)

- [GramIO setMyCommands documentation](https://gramio.dev/telegram/methods/setmycommands) — Secondary Telegram SDK reference
- Phase 22–23 implementation (src/telegram/handlers/client-menu.ts, src/webhooks/telegram.ts) — Proven best-effort notification pattern used as reference

### Tertiary (LOW confidence)

- None — all claims are either from official Telegram API docs or verified in existing codebase.

## Metadata

**Confidence breakdown:**
- BOT-06 (Menu Button Scoping): **HIGH** — Telegram API documentation explicit, no ambiguity on BotCommandScope behavior
- DIAG-01 (Owner Diagnostics): **HIGH** — Existing patterns (Phase 22–23) proven, fallback sites verified in codebase
- Error type extraction: **MEDIUM** — Simple string parsing; more sophisticated error categorization deferred to future phases

**Research date:** 2026-07-27
**Valid until:** 2026-08-10 (14 days; Telegram Bot API stable, codebase patterns established)
