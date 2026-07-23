# Phase 16: Single-Bot Architecture - Pattern Map

**Mapped:** 2026-07-23  
**Files analyzed:** 5 new/modified files  
**Analogs found:** 5 / 5 (100% coverage)

## Summary

Phase 16 consolidates the platform (onboarding) bot and business bot into a single per-business bot. The key architectural shift is:

1. **Delete** `src/webhooks/platform.ts` (platform onboarding bot webhook handler)
2. **Extend** `src/webhooks/telegram.ts` to route by Telegram ID match:
   - Owner (ownerTelegramId match) → AI owner agent + onboarding state machine
   - Client → booking conversation agent
3. **Move onboarding logic** into the business bot's message handler
4. **Auto-start onboarding** when admin messages their business bot and session is not 'done'
5. **Register single webhook** per business (already done in telegram.ts via webhookId)

All analogs found in existing codebase. No new patterns required.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/webhooks/telegram.ts` (extend) | webhook handler | request-response | `src/webhooks/platform.ts` | exact role, same auth pattern |
| `src/webhooks/telegram.ts::handleTelegramWebhookPost()` (extend) | router/dispatcher | request-response | `src/webhooks/platform.ts::handlePlatformBotWebhook()` | exact pattern |
| `src/webhooks/telegram.ts::handleFoundBusiness()` (extend) | owner/client dispatcher | request-response | `src/webhooks/platform.ts::handlePlatformBotWebhook()` lines 140-246 | exact pattern |
| `src/server.ts` (modify) | route registration | static config | `src/server.ts` lines 1-20 | same pattern |
| `src/database/queries.ts` (no change) | query layer | CRUD | existing | no changes needed |

---

## Pattern Assignments

### `src/webhooks/telegram.ts::handleTelegramWebhookPost()` — Webhook handler entry point (EXTEND)

**Analog:** `src/webhooks/platform.ts::handlePlatformBotWebhook()` (lines 74-252)

The current `handleTelegramWebhookPost()` already implements most of the required pattern. Phase 16 requires:
- Keep HMAC secret verification (crypto.timingSafeEqual) — already present
- Keep update dedup pattern (insertOrIgnoreTelegramUpdate) — already present
- Keep botTokenStore context manager — already present
- Keep withBusinessContext for tenant isolation — already present
- **NEW**: Remove platform-bot-specific logic; merge onboarding into `handleFoundBusiness()` for owner messages

**Secret verification pattern** (lines 520-537):
```typescript
// Constant-time HMAC verification (per D-06 / T-04-10).
// crypto.timingSafeEqual throws if buffers have different lengths, so the
// try/catch maps that case to secretValid=false without leaking timing info.
const rawHeader = req.headers['x-telegram-bot-api-secret-token'];
const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
const headerBuffer = Buffer.from(headerValue ?? '');
const secretBuffer = Buffer.from(business.webhookSecret);
let secretValid: boolean;
try {
  secretValid = crypto.timingSafeEqual(headerBuffer, secretBuffer);
} catch {
  secretValid = false;
}
if (!secretValid) {
  logger.warn({ webhookId }, 'Webhook secret verification failed');
  res.status(401).send('Unauthorized');
  return;
}
```

**Update dedup + context pattern** (lines 540-612):
```typescript
// Bot instance and update parsing.
const update = req.body as TelegramUpdate;
const bot = getOrCreateBotInstance(webhookId, business.botToken);
const updateId = String(update.update_id);

// Early-exit for unsupported Telegram update types (WR-03).
if (!update.message && !update.callback_query) {
  logger.info(
    { updateId, updateType: Object.keys(update).filter((k) => k !== 'update_id') },
    'Unsupported Telegram update type, ignoring'
  );
  res.status(200).send('OK');
  return;
}

// Per-request context: botTokenStore + withBusinessContext
await botTokenStore.run(business.botToken, async () => {
  await withBusinessContext(business.id, async () => {
    const senderTelegramId = String(
      update.message?.from.id ?? update.callback_query?.from.id ?? ''
    );
    const updateType = update.message ? 'message' : 'callback_query';

    logger.info({ updateId, webhookId, senderTelegramId, updateType }, 'Telegram update received');

    const dedupResult = await insertOrIgnoreTelegramUpdate(
      updateId,
      business.id,
      senderTelegramId,
      updateType
    );

    if (dedupResult === 'ignored') {
      logger.info({ updateId }, 'Duplicate Telegram update ignored');
      return;
    }

    // ... dispatch logic here (handleCallbackQuery, handleFoundBusiness, etc.)
  });
});
```

**HTTP response pattern** (lines 614-620):
```typescript
// Step 6 — Always 200 to Telegram (success path).
res.status(200).send('OK');
} catch (err) {
  logger.error({ err }, 'Telegram webhook handler failed');
} finally {
  if (!res.headersSent) res.status(200).send('OK');
}
```

---

### `src/webhooks/telegram.ts::handleFoundBusiness()` — Owner/Client dispatcher (EXTEND)

**Analog:** `src/webhooks/platform.ts::handlePlatformBotWebhook()` (lines 140-246, onboarding dispatch logic)

**Current pattern** (lines 62-95 of telegram.ts):
```typescript
async function handleFoundBusiness(
  updateId: string,
  business: Business,
  senderTelegramId: string,
  messageText: string
): Promise<void> {
  try {
    // Owner intercept: any message from the business owner goes to the AI
    // owner management agent (not the client booking AI). Identity check only —
    // no keyword gating — so the owner is recognized from their very first message.
    if (business.ownerTelegramId === senderTelegramId) {
      // WR-04: use Athens calendar date instead of UTC slice
      const today = isoDateInAthens(new Date());
      const reply = await aiOwnerAgent(business, senderTelegramId, messageText, today);
      // D-03/D-08: tools that send their own keyboards return '' to signal no additional reply.
      if (reply) {
        await sendTelegramMessage(senderTelegramId, reply);
      }
      await markTelegramUpdateProcessed(updateId, business.id);
      return;
    }

    // Client path
    await routeConversationMessage(business, senderTelegramId, messageText, {
      sendMessage: sendTelegramMessage,
    });
    await markTelegramUpdateProcessed(updateId, business.id);
  } catch (err) {
    logger.error({ err }, 'Failed to route Telegram conversation message');
  }
}
```

**Phase 16 EXTENSION POINT**: When owner message is received AND onboarding session is not 'done', dispatch to onboarding router instead of aiOwnerAgent. This mirrors the platform.ts logic at lines 140-157:

```typescript
// From src/webhooks/platform.ts:140-157
const activeResult = await findActiveSessionByOwnerTelegramId(ownerTelegramId);

if (activeResult !== null) {
  // Owner is mid-flow — resume at their current step (ONB-02).
  await dispatchOnboardingStep(
    activeResult.session,
    activeResult.business,
    ownerTelegramId,
    messageText
  );
  // Clear the tapped button row so old buttons can't be retapped.
  if (isCallback && update.callback_query?.message?.message_id) {
    try {
      await editTelegramMessageReplyMarkup(ownerTelegramId, update.callback_query.message.message_id, []);
    } catch {}
  }
  return;
}
```

**Pattern to merge into `handleFoundBusiness()`**:
1. Check if `business.ownerTelegramId === senderTelegramId`
2. If yes, call `findActiveSessionByOwnerTelegramId(senderTelegramId)` from `src/onboarding/queries.ts`
3. If session is active (not 'done'), dispatch to `dispatchOnboardingStep()` from `src/onboarding/router.ts`
4. If session is 'done' or null, dispatch to `aiOwnerAgent()` as currently done
5. Auto-create session if needed (see "Auto-Start Onboarding" below)

---

### Auto-Start Onboarding Pattern

**Analog:** `src/webhooks/platform.ts::handlePlatformBotWebhook()` (lines 208-244, B2 path)

When an owner messages their business bot for the first time (after webhook registration), auto-create an onboarding session if none exists. Pattern from platform.ts lines 208-244:

```typescript
// B2 — Brand-new owner. Treat message text as bot token submission.
const newBotToken = messageText.trim();
try {
  await getMeBotInfo(newBotToken);
} catch {
  // T-05-12: invalid token — send Greek error, do not create business row.
  logger.warn('Platform: new-owner bot token validation failed');
  await sendTelegramMessage(
    ownerTelegramId,
    'Μη έγκυρο token bot. Παρακαλώ ελέγξτε και ξαναστείλτε.'
  );
  return;
}

// Token valid — create placeholder business row and onboarding session.
const webhookId = crypto.randomUUID();
const webhookSecret = crypto.randomBytes(32).toString('hex');
const placeholderSlug = 'business-' + Date.now();

const newBusiness = await createBusinessForOnboarding({
  ownerTelegramId,
  name: 'Νέα Επιχείρηση',
  slug: placeholderSlug,
  botToken: newBotToken,
  webhookId,
  webhookSecret,
});

await createOrResetOnboardingSession(newBusiness.id, 'name');

await sendTelegramMessage(
  ownerTelegramId,
  'Καλωσήρθατε! Πώς ονομάζεται η επιχείρησή σας;'
);
```

**For Phase 16**, the pattern simplifies to:
- Owner messages business bot for first time with `currentStep === null` → auto-create onboarding session with `createOrResetOnboardingSession(business.id, 'name')`
- Send welcome message in Greek
- Dispatch to `dispatchOnboardingStep()`

This avoids the bot-token validation (already done at webhook registration).

---

### `src/server.ts` — Route registration (MODIFY)

**Analog:** `src/server.ts` (lines 15-20 — current webhook routing)

**Current pattern**:
```typescript
app.use('/webhooks/whatsapp', webhookRouter);
// Platform onboarding bot route MUST be registered before the dynamic
// telegramWebhookRouter so Express does not shadow it with :webhookId.
// See RESEARCH.md §"Pitfall 1: Express Route Shadow".
app.post('/webhooks/telegram/platform', express.json(), handlePlatformBotWebhook);
app.use('/webhooks/telegram', telegramWebhookRouter);
```

**Phase 16 change**: Remove the `/webhooks/telegram/platform` route entirely. The comment about route shadowing no longer applies because there is no platform-specific route — all business bots use the dynamic `/:webhookId` route.

**New pattern** (lines 15-20):
```typescript
app.use('/webhooks/whatsapp', webhookRouter);
app.use('/webhooks/telegram', telegramWebhookRouter);
```

No order dependency, no static route registration for platform bot.

---

## Shared Patterns

### 1. Telegram Webhook Secret Verification (HMAC)

**Source:** `src/webhooks/telegram.ts` lines 520-537 and `src/webhooks/platform.ts` lines 78-92

**Apply to:** All webhook handlers that accept untrusted HTTP input

**Pattern**:
```typescript
import crypto from 'crypto';

const rawHeader = req.headers['x-telegram-bot-api-secret-token'];
const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
const headerBuffer = Buffer.from(headerValue ?? '');
const secretBuffer = Buffer.from(business.webhookSecret); // or config.platformWebhookSecret
let secretValid: boolean;
try {
  secretValid = crypto.timingSafeEqual(headerBuffer, secretBuffer);
} catch {
  secretValid = false;
}
if (!secretValid) {
  logger.warn({ webhookId }, 'Webhook secret verification failed');
  res.status(401).send('Unauthorized');
  return;
}
```

**Why**: Constant-time comparison prevents timing-based secret leaks. Catches buffer-length mismatches in try/catch rather than leaking timing info.

---

### 2. Telegram Update Deduplication

**Source:** `src/webhooks/telegram.ts` lines 572-582 and `src/webhooks/platform.ts` lines 125-132

**Apply to:** All Telegram webhook handlers before processing

**Pattern**:
```typescript
const dedupResult = await insertOrIgnoreTelegramUpdate(
  updateId,
  business.id,  // or null for platform bot
  senderTelegramId,
  updateType
);

if (dedupResult === 'ignored') {
  logger.info({ updateId }, 'Duplicate Telegram update ignored');
  return;  // or send 200 and return from HTTP handler
}
```

**Why**: Telegram may redeliver the same webhook if it doesn't receive a 200 response quickly. Dedup insert on (updateId, businessId, senderTelegramId, updateType) prevents double-processing.

---

### 3. Per-Request Context Management (Dual Context)

**Source:** `src/webhooks/telegram.ts` lines 562-612

**Apply to:** All request handlers that need bot token + business tenant isolation

**Pattern**:
```typescript
await botTokenStore.run(business.botToken, async () => {
  await withBusinessContext(business.id, async () => {
    // Inside this scope:
    // - All outbound telegram.client calls use business.botToken (via botTokenStore)
    // - All database queries run under RLS for exactly this business.id (via withBusinessContext)
    // - Async context preserved via AsyncLocalStorage in both managers
  });
});
```

**Why**: 
- `botTokenStore`: Each business has a different bot token; context manager ensures the right token is used for telegram API calls
- `withBusinessContext`: RLS (Row Level Security) enforces business isolation at the database level; prevents data leaks between tenants

---

### 4. Unsupported Update Type Early-Exit

**Source:** `src/webhooks/telegram.ts` lines 545-557 and `src/webhooks/platform.ts` lines 98-107

**Apply to:** All Telegram webhook handlers

**Pattern**:
```typescript
// Early-exit for unsupported Telegram update types (WR-03).
// Telegram delivers types beyond message/callback_query (edited_message,
// channel_post, inline_query, poll, my_chat_member, etc.). Without this
// guard, senderTelegramId becomes '' and updateType becomes 'callback_query',
// corrupting the dedup log. Return 200 so Telegram never retries.
if (!update.message && !update.callback_query) {
  logger.info(
    { updateId, updateType: Object.keys(update).filter((k) => k !== 'update_id') },
    'Unsupported Telegram update type, ignoring'
  );
  res.status(200).send('OK');
  return;
}
```

**Why**: Telegram sends many update types. Silently ignoring with 200 prevents retries and log corruption.

---

### 5. Always-200 HTTP Response (Fire-and-Forget Processing)

**Source:** `src/webhooks/telegram.ts` lines 614-620 and `src/webhooks/platform.ts` lines 119-123, 247-251

**Apply to:** All Telegram webhook handlers

**Pattern**:
```typescript
try {
  res.status(200).send('OK');  // Send 200 IMMEDIATELY, before async processing
  await botTokenStore.run(business.botToken, async () => {
    // ... async processing happens AFTER response sent
  });
} catch (err) {
  logger.error({ err }, 'Telegram webhook handler failed');
} finally {
  // Defense in depth: ensure 200 even if exception bubbles up
  if (!res.headersSent) res.status(200).send('OK');
}
```

**Why**: Telegram expects 200 response within ~25 seconds. Send it immediately so Telegram never retries, then process asynchronously inside the HTTP handler.

---

### 6. Owner Identity Check + Onboarding Dispatch

**Source:** `src/webhooks/platform.ts` lines 140-157 (onboarding check) + `src/webhooks/telegram.ts` lines 72-85 (owner identity check)

**Apply to:** All owner-facing message handlers

**Pattern**:
```typescript
if (business.ownerTelegramId === senderTelegramId) {
  // Owner-specific flow

  // Check for active onboarding session FIRST (before aiOwnerAgent)
  const activeResult = await findActiveSessionByOwnerTelegramId(senderTelegramId);
  if (activeResult !== null) {
    // Resume onboarding
    await dispatchOnboardingStep(
      activeResult.session,
      activeResult.business,
      senderTelegramId,
      messageText
    );
    if (callbackQuery?.message?.message_id) {
      await editTelegramMessageReplyMarkup(senderTelegramId, callbackQuery.message.message_id, []);
    }
    return;
  }

  // If no active session, dispatch to aiOwnerAgent (owner management)
  const reply = await aiOwnerAgent(business, senderTelegramId, messageText, today);
  if (reply) {
    await sendTelegramMessage(senderTelegramId, reply);
  }
  return;
}

// Otherwise: client flow (routeConversationMessage)
```

**Why**: Owner messages are either mid-onboarding (session.currentStep != 'done') or already-onboarded (management). Identity check via Telegram ID (not a keyword) ensures recognition on first message.

---

### 7. Callback Query Button Cleanup

**Source:** `src/webhooks/platform.ts` lines 152-155 and `src/webhooks/telegram.ts` lines 492-494

**Apply to:** All callback_query handlers after action completion

**Pattern**:
```typescript
if (callbackQuery.message?.message_id) {
  try {
    await editTelegramMessageReplyMarkup(senderTelegramId, callbackQuery.message.message_id, []);
  } catch (err) {
    // Best-effort; failure is logged but does not abort the action
    logger.error({ err }, 'Failed to clear callback button row');
  }
}
```

**Why**: After a button is tapped, clear the keyboard so old buttons cannot be retapped (prevent duplicate actions). Best-effort pattern: if Telegram API fails, the action already succeeded so don't rethrow.

---

## No Analog Found

All patterns already exist in the codebase. No new patterns required for Phase 16.

---

## Metadata

**Analog search scope:** 
- `src/webhooks/` (all webhook handlers)
- `src/onboarding/` (onboarding router, steps, queries)
- `src/database/` (business lookup queries)
- `src/server.ts` (route registration)

**Files scanned:** 8 files  
**Pattern extraction date:** 2026-07-23

---

## Key Takeaways for Planning

1. **No new patterns**: All Phase 16 logic is covered by existing code from platform.ts and telegram.ts.

2. **handleFoundBusiness() merge point**: This is where onboarding dispatch logic flows. The owner identity check (line 72) is the single-point decision that gates owner vs. client behavior.

3. **Session state machine**: Use `findActiveSessionByOwnerTelegramId()` from `src/onboarding/queries.ts` to detect active onboarding. If found, dispatch to `dispatchOnboardingStep()` from `src/onboarding/router.ts`. If 'done' or null, route to `aiOwnerAgent()`.

4. **Auto-start pattern**: When a new owner's business bot receives its first owner message AND session is null, call `createOrResetOnboardingSession(business.id, 'name')` and send welcome message. This mirrors lines 238-243 of platform.ts, but without bot-token validation (already done at registration).

5. **HTTP response timing**: Always send 200 to Telegram immediately (line 614 of telegram.ts), then process asynchronously (lines 562-612). The finally block ensures 200 even on exception.

6. **Tenant isolation**: Both `botTokenStore.run()` and `withBusinessContext()` are critical. Never omit either; the first ensures the right bot token is used, the second enforces business-level RLS.
