# Architecture Patterns: v1.1 Multi-Business Telegram Bots & Owner Onboarding

**Project:** RandevuClaw  
**Milestone:** v1.1 (Per-Business Bots & Telegram PoC Completion)  
**Researched:** 2026-07-10  
**Confidence:** HIGH  

## Executive Summary

v1.1 pivots from a single shared Telegram bot (v1.0, token in environment) to per-business bots. Each business registers its own bot token via chat, and the platform handles webhook routing, state persistence for multi-step onboarding, and cascading GDPR deletion. The existing conversation router and AI agent stay largely unchanged—the shift is architectural (multi-token routing) rather than algorithmic (booking logic, Gemini function-calling, calendar sync all remain intact).

**Key architectural shifts:**
1. **Webhook routing:** From single `/webhooks/telegram` → shared token resolution, to dynamic `/webhooks/telegram/:botToken` path with token-to-business lookup
2. **Bot token storage:** From `TELEGRAM_BOT_TOKEN` env var (global) → `telegramBotToken` column in `businesses` table (per-business)
3. **Webhook registration:** New: call Telegram's `setWebhook` API when owner provides token; de-register on deletion
4. **Onboarding:** New: multi-step state machine collecting business name, hours, services via guided chat flow
5. **Configuration:** Owner config moves from env/CLI to pure chat; no CLI setup steps remain

---

## Current Architecture (v1.0 — Single Shared Bot)

```
┌─────────────────────────────────────────────────────────────────┐
│                      Telegram User (client/owner)               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                   message / callback_query
                             │
                             ▼
        ┌────────────────────────────────────────┐
        │  Telegram Bot API (single @BotUsername)│
        │         token: env.TELEGRAM_BOT_TOKEN  │
        └────────────────┬───────────────────────┘
                         │
         POST /webhooks/telegram (single path)
                         │
                         ▼
        ┌────────────────────────────────────────┐
        │  webhook handler                       │
        │  (telegram.ts)                         │
        │  • Verify secret token                 │
        │  • Dedup via telegramUpdates table     │
        │  • Extract business from message/      │
        │    fallback to client's last business  │
        └────────────┬───────────────────────────┘
                     │
        ┌────────────▼───────────────────────────┐
        │  routeConversationMessage              │
        │  • Consent check                       │
        │  • Greek temporal parsing              │
        │  • AI agent call (Gemini)              │
        │  • Persist conversationTurns           │
        └────────────┬───────────────────────────┘
                     │
        ┌────────────▼───────────────────────────┐
        │  aiBookingAgent (Gemini 2.5 Flash)    │
        │  • Function-calling loop               │
        │  • Tool execution (booking/cancel/etc) │
        │  • Calendar sync orchestration         │
        └────────────┬───────────────────────────┘
                     │
        ┌────────────▼───────────────────────────┐
        │  Database (Neon/Drizzle)               │
        │  • businesses (global config, single)  │
        │  • bookings, services, business_hours │
        │  • conversationTurns, telegramUpdates  │
        │  • clientBusinessRelationships         │
        └────────────────────────────────────────┘
```

**Key invariants (v1.0):**
- Single bot token in `config.telegramBotToken`
- Single webhook URL registered with Telegram (platform-owned)
- Business resolution: extract from message text or client's latest relationship
- All queries scoped by `businessId` (multi-tenant within one bot)

---

## v1.1 Architecture: Multi-Bot Per-Business

```
┌──────────────────────────────────────────────────────────────────────┐
│         Telegram Users (clients/owners, N businesses)                │
│                                                                      │
│  Business A:         Business B:         Business C:                │
│  @BotUsernameA       @BotUsernameB       @BotUsernameC             │
└──────────┬──────────────┬──────────────────┬───────────────────────┘
           │              │                  │
       message        message            message
           │              │                  │
           ▼              ▼                  ▼
   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
   │ Telegram Bot │ │ Telegram Bot │ │ Telegram Bot │
   │ (Business A) │ │ (Business B) │ │ (Business C) │
   │ token: ABC   │ │ token: XYZ   │ │ token: DEF   │
   └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
          │                │                │
    setWebhook URL:
    https://domain/webhooks/telegram/ABC
          │                │                │
          └────────────────┼────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────┐
        │  POST /webhooks/telegram/:botToken   │
        │  (express param router)               │
        │  • Extract token from path            │
        │  • Look up business by token          │
        │  • Verify X-Telegram-Bot-Api-Secret- │
        │    Token header (per-business)        │
        │  • Dedup & route                      │
        └──────────────┬───────────────────────┘
                       │
        ┌──────────────▼───────────────────────┐
        │ Business resolution (v1.1 change)    │
        │ • Token → business (DB lookup)       │
        │ • Skip text-based extraction         │
        │ • No fallback (token is definitive)  │
        └──────────────┬───────────────────────┘
                       │
     ┌─────────────────▼─────────────────┐
     │ Check: Is this an onboarding msg? │
     │ (business.status == 'onboarding') │
     └─────────┬───────────────────────┬─┘
               │                       │
          YES  │                       │ NO
               ▼                       ▼
    ┌──────────────────────┐ ┌────────────────────────┐
    │ Onboarding router    │ │ routeConversationMsg   │
    │ (NEW)                │ │ (existing, unchanged)  │
    │ • Collect business   │ │ • AI booking agent     │
    │   name, hours,       │ │ • Calendar sync        │
    │   services, prices   │ │ • Reminders            │
    │ • Multi-step state   │ │                        │
    │   machine            │ │                        │
    └──────────────────────┘ └────────────────────────┘
                  │                      │
                  └──────────┬───────────┘
                             │
                 (both persist to DB)
                             │
                             ▼
        ┌──────────────────────────────────────┐
        │  Database (Neon/Drizzle)              │
        │  [schema changes for v1.1]            │
        │  • businesses.telegramBotToken (NEW)  │
        │  • onboarding_sessions (NEW)          │
        │  • businesses.onboarding_status       │
        │  • [existing tables unchanged]        │
        └──────────────────────────────────────┘
```

**Key architectural changes:**
- Multiple bot tokens (one per business), each with its own webhook secret
- Webhook path includes bot token as route parameter
- Token → business lookup replaces text-based business extraction
- New onboarding router for multi-step config flow
- Existing AI agent, calendar sync, reminder pollers unchanged
- Conversation routing scoped by business (already multi-tenant)

---

## Component Changes: New vs Modified

| Component | Status | Detail |
|-----------|--------|--------|
| **Webhook handler** (`webhooks/telegram.ts`) | MODIFIED | Extract bot token from path param; look up business by token; skip text-based business extraction; route to onboarding or conversation based on business.onboarding_status |
| **Config** (`config.ts`) | MODIFIED | Remove `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `OWNER_TELEGRAM_ID` from global env; these become per-business (stored in DB, not env) |
| **Telegram client** (`telegram/client.ts`) | MODIFIED | Accept bot token as parameter to `callTelegramApi()` instead of using global config; add `setWebhook()`, `deleteWebhook()` functions for webhook registration |
| **Conversation router** (`conversation/router.ts`) | UNCHANGED | Already scoped by `businessId`; works identically with multi-bot setup |
| **AI agent** (`conversation/ai-agent.ts`) | UNCHANGED | Gemini function-calling logic identical; no changes needed |
| **Calendar sync** (`calendar/sync.ts`) | UNCHANGED | Operates on bookings scoped by `businessId`; no changes |
| **Pollers** (expiry, agenda, reminders, calendar-sync) | UNCHANGED | Already iterate over all businesses; no changes |
| **Express server** (`server.ts`) | MODIFIED | Change webhook route from `app.use('/webhooks/telegram', ...)` to `app.use('/webhooks/telegram/:botToken', ...)` |
| **Database schema** (`database/schema.ts`) | MODIFIED | Add `telegramBotToken`, `onboarding_status` to `businesses`; new `onboarding_sessions` table |
| **Database queries** (`database/queries.ts`) | MODIFIED | Add queries: `findBusinessByTelegramToken()`, `insertOnboardingSession()`, `updateOnboardingSession()`, etc.; `deleteBusinessCascade()` for GDPR |
| **Onboarding router** (`conversation/onboarding.ts`) | NEW | Multi-step state machine: `handleOnboardingMessage()` routes based on session state; collects name → hours → services |
| **Webhook registration client** (`telegram/webhook-manager.ts`) | NEW | `registerWebhookForBusiness()`, `deregisterWebhookForBusiness()` using Telegram's `setWebhook` / `deleteWebhook` API |
| **Onboarding flow tests** | NEW | Test state transitions, invalid token handling, cascade deletion |

---

## Database Schema Changes

### New Columns on `businesses`

```sql
ALTER TABLE businesses ADD COLUMN telegram_bot_token TEXT UNIQUE;
-- Unique constraint ensures no two businesses can claim the same token
-- Nullable during transition; required after v1.1 launch

ALTER TABLE businesses ADD COLUMN telegram_webhook_secret TEXT;
-- Derived from: sha256(telegram_bot_token + APP_SECRET)
-- Used to verify incoming webhook requests (X-Telegram-Bot-Api-Secret-Token header)
-- Nullable during transition; required after v1.1

ALTER TABLE businesses ADD COLUMN onboarding_status TEXT DEFAULT 'not_started';
-- Values: 'not_started' | 'token_validating' | 'collecting_config' | 'completed' | 'failed'
-- Defaults to 'not_started' for legacy businesses
-- Routing: if 'completed', use normal booking agent; else, use onboarding router
```

### New Table: `onboarding_sessions`

```sql
CREATE TABLE onboarding_sessions (
  id SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  owner_telegram_id TEXT NOT NULL,  -- Owner who initiated this session
  
  -- Multi-step state tracking
  session_status TEXT NOT NULL DEFAULT 'in_progress',
  -- 'in_progress' | 'completed' | 'abandoned' | 'error'
  
  current_step TEXT NOT NULL,
  -- Step in the onboarding flow: 'token_wait' | 'name' | 'hours' | 'services' | 'confirm'
  
  -- Collected data (nullable until each step completes)
  business_name TEXT,
  hours_config JSONB,  -- { "0": { open: "10:00", close: "18:00", closed: false }, ... }
  services_config JSONB,  -- [ { name: "...", duration_min: 30, price: 2500 }, ... ]
  
  step_data JSONB,  -- Temporary holding for in-progress step (e.g., "user typed name: 'Pilates Athens'")
  
  error_message TEXT,  -- If session_status = 'error', reason why
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP  -- After 48h of inactivity, session can be abandoned
);

CREATE INDEX idx_onboarding_sessions_business_id 
  ON onboarding_sessions(business_id);

CREATE INDEX idx_onboarding_sessions_owner_telegram_id 
  ON onboarding_sessions(owner_telegram_id);
```

---

## Webhook Routing: Path vs Token Encoding

**Chosen approach:** Path parameter

```typescript
// v1.1 route:
app.use('/webhooks/telegram/:botToken', telegramWebhookRouter);

// Express extracts botToken from path:
const botToken = req.params.botToken;

// Query DB:
const business = await findBusinessByTelegramToken(botToken);

// Verify secret:
const expectedSecret = deriveWebhookSecret(botToken, config.appSecret);
const headerSecret = req.headers['x-telegram-bot-api-secret-token'];
if (headerSecret !== expectedSecret) return 403;
```

**Why path param over token-in-secret:**
- Telegram's webhook secret is a fixed bearer token (no HMAC); it's only verified at HTTP level
- Putting the bot token in the URL path makes the routing clean and obvious
- Webhook URL registered with Telegram: `https://domain.fly.dev/webhooks/telegram/bot123abc`
- Clean deregistration: if token changes/deleted, old URL simply 404s
- Easier to audit: logs show which bot token hit which endpoint

**Webhook secret derivation:**
```typescript
// In telegram-webhook-manager.ts:
function deriveWebhookSecret(botToken: string, appSecret: string): string {
  const hmac = createHmac('sha256', appSecret);
  hmac.update(botToken);
  return hmac.digest('hex').slice(0, 32);  // Telegram expects ≤32 chars
}
```

---

## Bot Token Storage & Secret Management

### Where Bot Tokens Are Stored

1. **`businesses.telegram_bot_token`** — plaintext in DB (necessary; Telegram API needs it to call their API)
2. **`businesses.telegram_webhook_secret`** — derived from token + APP_SECRET, not stored separately in env
3. **Environment config** — `APP_SECRET` only (used to derive per-business secrets on the fly)

### Securing Token Access

**DO NOT log bot tokens.** Audit:
```typescript
// BAD (log middleware):
logger.info({ botToken: business.telegramBotToken }, 'Calling Telegram API');

// GOOD:
logger.info({ botTokenPrefix: business.telegramBotToken.slice(0, 4) }, 'Calling Telegram API');
```

**Parameterize `callTelegramApi()` to accept token:**
```typescript
// Before (v1.0):
async function callTelegramApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/${method}`;
  // ...
}

// After (v1.1):
async function callTelegramApi<T>(
  method: string,
  body: Record<string, unknown>,
  botToken: string  // NEW: per-business
): Promise<T> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  // ...
}
```

Update all callers:
```typescript
// In telegram/client.ts:
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  botToken: string  // NEW
): Promise<SendMessageResult> {
  return callTelegramApi('sendMessage', { chat_id: chatId, text }, botToken);
}
```

---

## Webhook Registration & Deregistration

### Registration Flow (Owner Provides Bot Token)

```
Owner sends: "/bot my_token_123abc"
         ↓
onboarding router recognizes command
         ↓
Validate token format: must match Telegram's pattern (digits + letters/underscores)
         ↓
Call registerWebhookForBusiness(businessId, token):
  1. Insert/update businesses.telegram_bot_token = token
  2. Derive webhook secret = sha256(token + APP_SECRET)
  3. Update businesses.telegram_webhook_secret = secret
  4. Call Telegram setWebhook API:
     POST https://api.telegram.org/bot{token}/setWebhook
     body: { url: "https://domain.fly.dev/webhooks/telegram/{token}" }
  5. If 200 & ok=true: update onboarding_status → 'collecting_config'
  6. If error: return error msg to owner, stay in 'token_validating'
```

### Deregistration Flow (Business Deletion or GDPR Request)

```
User requests: /delete_my_data
         ↓
Verify it's the business owner (callback_query/message scope check)
         ↓
Call deleteBusinessCascade(businessId):
  1. Call deregisterWebhookForBusiness(business.telegramBotToken)
     POST https://api.telegram.org/bot{token}/deleteWebhook
     (best-effort; if bot no longer exists, that's fine — webhook is already gone)
  2. Delete from onboarding_sessions where business_id = businessId
  3. Delete from conversationTurns where business_id = businessId
  4. Delete from telegramUpdates where business_id = businessId
  5. Delete from bookings where business_id = businessId (cascade to calendar_sync_status, etc.)
  6. Delete from services where business_id = businessId
  7. Delete from business_hours where business_id = businessId
  8. Delete from clientBusinessRelationships where business_id = businessId
  9. Delete from businesses where id = businessId
```

### Retry & Idempotency

```typescript
// telegram/webhook-manager.ts:

export async function registerWebhookForBusiness(
  business: Business,
  newBotToken: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const webhookUrl = `${config.webhookBaseUrl}/webhooks/telegram/${newBotToken}`;
    const secret = deriveWebhookSecret(newBotToken, config.appSecret);

    // Call Telegram API
    const response = await fetch(`https://api.telegram.org/bot${newBotToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secret,
        // max_connections: 40 (optional; default is fine for PoC)
      }),
    });

    const data = await response.json();
    if (!data.ok) {
      return { success: false, error: data.description || 'Unknown error' };
    }

    // Persist to DB
    await db.update(businesses)
      .set({
        telegramBotToken: newBotToken,
        telegramWebhookSecret: secret,
        onboardingStatus: 'collecting_config',
      })
      .where(eq(businesses.id, business.id));

    return { success: true };
  } catch (err) {
    logger.error({ err }, 'Failed to register webhook');
    return { success: false, error: String(err) };
  }
}
```

---

## Onboarding State Machine

### States & Transitions

```
START
  ↓
[not_started] ──user sends "/bot token123"-→ [token_validating]
                                              ↓
                                         (webhook registration API call)
                                         ↓
                                  [success]     [error]
                                    ↓             ↓
                            [collecting_config] [error]
                              ↓         ↓         ↓
                            [name]   [hours]  [token_validating]
                              ↓
                            [hours] (after name collected)
                              ↓
                            [services] (after hours)
                              ↓
                            [confirm] (after services)
                              ↓
                           [completed]
                              ↓
                           READY FOR BOOKINGS
```

### Step Details

| Step | Prompt | Input | Action | Next |
|------|--------|-------|--------|------|
| `token_validating` | (silent; registering webhook) | N/A | Call setWebhook API; if error, show to owner | `collecting_config` or `error` |
| `name` | "Ποιο είναι το όνομα της επιχείρησης;" | Free text | Extract & store in onboarding_sessions.business_name | `hours` |
| `hours` | "Πόιες ώρες λειτουργείτε; (απάντηση σε μορφή Δευτέρα 10:00-18:00)" | Day + times | Parse & store in onboarding_sessions.hours_config | `services` |
| `services` | "Ποιες υπηρεσίες προσφέρετε; (π.χ. Pilates 45min €20)" | Service list | Parse & store in onboarding_sessions.services_config | `confirm` |
| `confirm` | "Ας επιβεβαιώσουμε: [summary]. Σωστά;" | Yes/No button | If yes: insert to services/business_hours; update businesses.onboarding_status='completed' | `completed` |

### Onboarding Router Implementation

```typescript
// conversation/onboarding.ts (NEW)

export async function handleOnboardingMessage(
  business: Business,
  session: OnboardingSession,
  senderTelegramId: string,
  messageText: string,
  channel: ConversationChannel
): Promise<void> {
  // 1. Verify sender is the owner (callback_query context provides this)
  if (senderTelegramId !== business.ownerTelegramId) {
    await channel.sendMessage(senderTelegramId, 'Μόνο ο ιδιοκτήτης μπορεί να τελειώσει την ρύθμιση.');
    return;
  }

  // 2. Route by current step
  switch (session.currentStep) {
    case 'name':
      return handleNameStep(business, session, messageText, channel);
    case 'hours':
      return handleHoursStep(business, session, messageText, channel);
    case 'services':
      return handleServicesStep(business, session, messageText, channel);
    case 'confirm':
      return handleConfirmStep(business, session, messageText, channel);
    default:
      logger.warn({ currentStep: session.currentStep }, 'Unknown onboarding step');
      await channel.sendMessage(senderTelegramId, 'Σφάλμα. Δοκιμάστε ξανά.');
  }
}

async function handleNameStep(
  business: Business,
  session: OnboardingSession,
  messageText: string,
  channel: ConversationChannel
): Promise<void> {
  // Extract name
  const name = messageText.trim().slice(0, 100);
  if (!name) {
    await channel.sendMessage(session.ownerTelegramId, 'Πληκτρολογήστε το όνομα.');
    return;
  }

  // Store name, advance to hours
  await db
    .update(onboardingSessions)
    .set({
      businessName: name,
      currentStep: 'hours',
      updatedAt: new Date(),
    })
    .where(eq(onboardingSessions.id, session.id));

  await channel.sendMessage(
    session.ownerTelegramId,
    'Ευχαριστώ! Τώρα, ποιες ώρες λειτουργείτε; (π.χ. "Δευτέρα 10:00-18:00")'
  );
}

// Similar for hours, services, confirm steps
```

---

## Integration Points & Data Flow

### Webhook Reception

```
Telegram → POST /webhooks/telegram/:botToken
           ├─ Extract token from path
           ├─ Query businesses by token
           ├─ Verify secret header
           ├─ Check onboarding_status
           ├─ Route:
           │  ├─ if 'not_started' or 'token_validating': onboarding router
           │  ├─ if 'collecting_config': onboarding router
           │  └─ if 'completed': conversation router (existing)
           └─ Return 200 OK
```

### AI Agent (No Change)

```
routeConversationMessage(business, senderId, text)
  ├─ Consent check (unchanged)
  ├─ Greek temporal parsing (unchanged)
  ├─ aiBookingAgent (unchanged)
  │  ├─ Gemini function-calling loop
  │  ├─ Tool execution (create_booking, cancel_appointment, etc.)
  │  └─ Calendar sync orchestration
  └─ Persist conversationTurns (unchanged)
```

### Pollers (No Change)

```
setInterval pollers (expiry, calendar-sync, agenda, reminders):
  ├─ Query all businesses (iterate)
  ├─ Operate on bookings/conversationTurns scoped by business_id
  └─ Send messages via sendTelegramMessage(chatId, text, botToken)
     ← NEW: botToken parameter passed in
```

---

## Build Order & Dependencies

### Phase 1: Foundation (Webhook Routing & Token Storage)

**Goal:** Support multiple bot tokens; no onboarding yet.

1. **Schema changes**
   - Add `telegram_bot_token`, `telegram_webhook_secret`, `onboarding_status` columns to `businesses`
   - Nullable columns; run migration with defaults

2. **Config changes**
   - Remove `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `OWNER_TELEGRAM_ID` from EnvSchema (they stay as optional for backward compat during transition)
   - Add `WEBHOOK_BASE_URL` (e.g., `https://randevu.fly.dev`) to config

3. **Telegram client changes**
   - Parameterize `callTelegramApi()` to accept `botToken`
   - Update all message-sending functions to accept `botToken`
   - Add `setWebhook()` and `deleteWebhook()` functions

4. **Express route changes**
   - Change `/webhooks/telegram` to `/webhooks/telegram/:botToken`
   - Extract business by token lookup (not by message text extraction)

5. **Database queries**
   - Add `findBusinessByTelegramToken(token: string): Promise<Business | null>`
   - Add `deleteBusinessCascade(businessId: number): Promise<void>`

**Tests:**
- Route `/webhooks/telegram/abc123` with correct secret → processes normally
- Route `/webhooks/telegram/abc123` with wrong secret → 403
- Route `/webhooks/telegram/unknown_token` → 404 or 400
- Both message and callback_query routing works

**Milestones:**
- All message sending now parameterized by bot token
- Existing tests pass (backward compat: if TELEGRAM_BOT_TOKEN is set in env, use it as fallback)
- New tests for token-based routing

---

### Phase 2: Onboarding State Machine

**Goal:** Owners can provide their bot token via chat; platform validates and stores it.

1. **Database changes**
   - Create `onboarding_sessions` table with state tracking

2. **Onboarding router**
   - `handleOnboardingMessage()` dispatcher
   - Step handlers: name, hours, services, confirm
   - Error handling & recovery

3. **Webhook registration client**
   - `registerWebhookForBusiness(business, token): Promise<{ success, error? }>`
   - `deregisterWebhookForBusiness(token): Promise<void>`
   - Derive & store webhook secrets

4. **Webhook handler changes**
   - Check `business.onboarding_status` and route to onboarding router if needed
   - Onboarding messages skip conversation router entirely

5. **GDPR deletion**
   - `deleteBusinessCascade()` now calls `deregisterWebhookForBusiness()` before cascade delete

**Tests:**
- Owner sends `/bot token123` → webhook registration API called
- If token invalid (Telegram API returns error) → owner sees error, stays in token_validating
- If token valid → moves to name collection step
- Complete full onboarding flow: token → name → hours → services → confirm → completed
- Onboarding session expires after 48h inactivity
- `/delete_my_data` from owner → cascade delete including webhook deregistration

**Milestones:**
- Owners self-serve bot registration via chat
- Onboarding flow guided & recoverable
- No manual CLI setup required for v1.1

---

### Phase 3: Transition & Cleanup

**Goal:** Migrate existing businesses from v1.0 single-bot setup to v1.1 multi-bot.

1. **Data migration**
   - For each existing business:
     - If it's the "main" business (from env `OWNER_TELEGRAM_ID`), assign a bot token (provision new bot in Telegram UI, copy token)
     - Call `registerWebhookForBusiness()` to set up webhook
     - Update `onboarding_status = 'completed'`

2. **Environment cleanup**
   - Remove `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `OWNER_TELEGRAM_ID` from production `fly.secrets`
   - Keep only `APP_SECRET`, `GEMINI_API_KEY`, etc.

3. **Remove fallback code**
   - Delete any v1.0 compat code that fell back to `config.telegramBotToken`

**Tests:**
- Migrate existing business; onboarding_status now 'completed'
- Existing clients can still chat (webhook routing works)
- New business self-onboards with new bot token

---

## Pitfalls & Mitigations

### Pitfall 1: Webhook Secret Verification Skipped

**What goes wrong:** Attacker sends fake Telegram updates to `/webhooks/telegram/any-token` claiming to be a legitimate user.

**Why it happens:** If secret verification is lazy-loaded or skipped.

**Prevention:**
```typescript
// MUST verify before any DB query:
const expectedSecret = deriveWebhookSecret(botToken, config.appSecret);
if (req.headers['x-telegram-bot-api-secret-token'] !== expectedSecret) {
  res.status(403).send('Forbidden');
  return;
}
```

**Detection:** Add audit logging for failed secret verifications; spike in 403s indicates attack attempt.

---

### Pitfall 2: Bot Token Logged in Plain Text

**What goes wrong:** Bot token appears in log aggregation; attacker can exfiltrate it and impersonate the bot.

**Why it happens:** Casual logging of entire request/response bodies.

**Prevention:**
- Audit all logger calls for references to `telegramBotToken`
- Create a `redact(token)` helper that shows only prefix + ellipsis
- Use structured logging; never log request bodies that might contain secrets

---

### Pitfall 3: Concurrent Webhook Registrations Stomp Each Other

**What goes wrong:** Two owners simultaneously provide a bot token; both succeed in creating an onboarding session; first one's session gets overwritten.

**Why it happens:** No uniqueness constraint on (business_id, token) in onboarding_sessions.

**Prevention:**
```typescript
// In onboarding_sessions schema:
CREATE UNIQUE INDEX idx_onboarding_active_per_business 
  ON onboarding_sessions(business_id) 
  WHERE session_status IN ('in_progress', 'token_validating');

// In registerWebhookForBusiness:
// Use upsert (INSERT ... ON CONFLICT) to ensure only one active session
```

---

### Pitfall 4: Webhook Registration Hangs on Telegram API Timeout

**What goes wrong:** Owner provides bot token; platform tries to call Telegram's setWebhook API; Telegram is slow/down; webhook handler timeout hits; owner never sees feedback.

**Why it happens:** No timeout or retry logic on Telegram API calls.

**Prevention:**
```typescript
export async function registerWebhookForBusiness(...): Promise<{ success, error? }> {
  try {
    const response = await fetch('https://api.telegram.org/...', {
      signal: AbortSignal.timeout(10_000),  // 10-second timeout
    });
    // ...
  } catch (err) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'Telegram API timeout. Δοκιμάστε ξανά.' };
    }
    // ...
  }
}
```

**Detection:** Monitor API call latencies; alert if >5s.

---

### Pitfall 5: Onboarding Session Abandoned Indefinitely

**What goes wrong:** Owner starts onboarding, gets stuck on "services" step, never finishes. Session row remains in DB forever, orphaned.

**Why it happens:** No expiry or cleanup job.

**Prevention:**
```typescript
// In onboarding_sessions:
ALTER TABLE onboarding_sessions ADD COLUMN expires_at TIMESTAMP;
-- Set expires_at = NOW() + INTERVAL '48 hours' at insertion

// Poller job (like expiry-poller.ts for bookings):
async function cleanupAbandonedOnboardingSessions() {
  await db
    .delete(onboardingSessions)
    .where(
      and(
        eq(onboardingSessions.sessionStatus, 'in_progress'),
        lt(onboardingSessions.expiresAt, new Date())
      )
    );
}

// startAbandonedOnboardingPoller(); // in server.ts
```

---

### Pitfall 6: GDPR Cascade Delete Misses a Table

**What goes wrong:** Owner requests deletion; cascade delete runs but misses `conversationTurns`; personal data (chat history) remains.

**Why it happens:** New table (`onboarding_sessions`) added but cascade not updated; developer forgets to include it.

**Prevention:**
- Document the full cascade chain in a comment:
  ```typescript
  /**
   * Cascade delete for business (GDPR COMP-02):
   * businesses → services (FK)
   *           → business_hours (FK)
   *           → bookings (FK) → calendar_sync_retries (implicit cascade)
   *           → conversation_turns (FK)
   *           → telegram_updates (FK)
   *           → client_business_relationships (FK)
   *           → onboarding_sessions (FK)
   *           → [webhook deregistration via Telegram API]
   */
  ```
- Test: insert a business + onboarding session; delete; verify all rows gone with `COUNT(*) = 0` queries

---

### Pitfall 7: Multiple Businesses Claim the Same Token

**What goes wrong:** Business A registers token `abc123`; Business B somehow also claims `abc123`. Telegram can only have one webhook URL per bot; one business is silently broken.

**Why it happens:** No UNIQUE constraint on `businesses.telegram_bot_token`.

**Prevention:**
```typescript
ALTER TABLE businesses ADD CONSTRAINT unique_telegram_bot_token 
  UNIQUE (telegram_bot_token) 
  WHERE telegram_bot_token IS NOT NULL;
```

**Detection:** Onboarding endpoint validation:
```typescript
const existing = await findBusinessByTelegramToken(newToken);
if (existing && existing.id !== business.id) {
  return { success: false, error: 'Αυτό το token χρησιμοποιείται ήδη.' };
}
```

---

### Pitfall 8: Webhook URL Contains Plaintext Token, Leaked in Logs

**What goes wrong:** Platform logs the webhook URL during registration: `https://domain/webhooks/telegram/abc123secret`. Logs are shared with 3rd-party monitoring; token is exfiltrated.

**Why it happens:** Logging webhook URLs for debugging.

**Prevention:**
```typescript
// GOOD:
logger.info(
  { tokenPrefix: botToken.slice(0, 4), webhookUrl: `${config.webhookBaseUrl}/webhooks/telegram/***` },
  'Registering webhook'
);

// BAD:
logger.info({ webhookUrl: `${config.webhookBaseUrl}/webhooks/telegram/${botToken}` }, 'Registering webhook');
```

---

## Summary: What Stays, What Changes

| Aspect | v1.0 | v1.1 | Impact |
|--------|------|------|--------|
| **Booking logic** | Gemini function-calling | Same | Zero change; existing tests pass |
| **Calendar sync** | Google Calendar API | Same | Zero change; still scoped by businessId |
| **Reminders/agenda** | In-process setInterval pollers | Same | Zero change; iterate over all businesses |
| **Consent** | Collected via consent_given flag | Same | Zero change |
| **Multi-tenancy** | businessId foreign key isolation | Same | Already proven; multi-bot is just N tenants with different bot tokens |
| **Webhook path** | Single `/webhooks/telegram` | `/webhooks/telegram/:botToken` | Express param routing |
| **Bot token source** | `env.TELEGRAM_BOT_TOKEN` | Per-business DB column | Token lookup replaces text extraction |
| **Business resolution** | Text slug extraction from message | Token-based direct lookup | No more ambiguity |
| **Owner config** | Pre-provisioned (CLI) | Self-serve onboarding via chat | Eliminates manual setup |
| **Webhook registration** | Manual (CLI or Telegram dashboard) | Automated (setWebhook API on token provision) | Owner never touches Telegram dashboard |
| **GDPR deletion** | Single business (simple) | Cascade across N businesses + webhook deregistration | Cleanup more thorough |

---

## Suggested Build Order (4 Weeks)

| Week | Focus | Deliverable |
|------|-------|-------------|
| **Week 1** | Phase 1 (Foundation) | Token-based routing working; existing bookings still flow through multi-bot; tests green |
| **Week 2** | Phase 2 part 1 (Onboarding schema + router) | Onboarding state machine; owners can start flow; tokens validated |
| **Week 3** | Phase 2 part 2 (Webhook registration + GDPR) | setWebhook API integration; webhook deregistration; cascade delete tests |
| **Week 4** | Phase 3 + Polish | Migrate existing business; remove legacy env vars; cleanup fallback code; e2e testing |

**Assumptions:**
- Existing tests (208 passing) continue to pass throughout
- No new Gemini/calendar logic needed
- Onboarding UI simple enough to implement in chat (no special UI library)

---

## Confidence Assessment

| Area | Confidence | Reasoning |
|---|---|---|
| **Webhook routing** | HIGH | Express param routing is standard; existing secret verification pattern proven in v1.0 |
| **Multi-tenancy isolation** | HIGH | Already working in v1.0 via businessId FK; N bots adds no new isolation risk |
| **Onboarding state machine** | MEDIUM-HIGH | State machine is straightforward; risk is in Telegram API integration (timeout, retry handling) |
| **GDPR cascade delete** | HIGH | Schema-level FKs + explicit delete queries are reliable; tested against N rows |
| **Webhook registration API** | MEDIUM | Telegram's setWebhook/deleteWebhook are stable but external; requires error handling + retry |
| **Token security** | MEDIUM | Risk is token leakage in logs/monitoring; mitigatable with strict logging audit |

---

## Files to Create/Modify

### Create

- `.planning/research/ARCHITECTURE.md` (this file)
- `src/telegram/webhook-manager.ts` (NEW) — webhook registration/deregistration
- `src/conversation/onboarding.ts` (NEW) — state machine + step handlers
- `tests/onboarding.test.ts` (NEW) — state transitions, edge cases
- `tests/webhook-routing.test.ts` (NEW) — multi-token routing

### Modify

- `src/server.ts` — change webhook route to `:botToken`
- `src/webhooks/telegram.ts` — token lookup, onboarding routing
- `src/telegram/client.ts` — parameterize botToken; add setWebhook/deleteWebhook
- `src/config.ts` — remove legacy env vars; add WEBHOOK_BASE_URL
- `src/database/schema.ts` — add columns to businesses; add onboarding_sessions table
- `src/database/queries.ts` — add token lookup, onboarding queries, cascade delete
- `src/conversation/router.ts` — no changes (already works)
- `src/conversation/ai-agent.ts` — no changes (already works)

---

## Sources

**Telegram Bot API:**
- [Telegram Bot API: setWebhook](https://core.telegram.org/bots/api#setwebhook)
- [Telegram Bot API: deleteWebhook](https://core.telegram.org/bots/api#deletewebhook)
- [Telegram Bot API: Secret Token](https://core.telegram.org/bots/api#setwebhook) — secret_token parameter
- [Telegram Webhook Best Practices](https://core.telegram.org/bots/webhooks)

**Current Codebase (v1.0):**
- `.planning/PROJECT.md` — milestone context, constraints
- `src/webhooks/telegram.ts` — current webhook handler, business resolution, callback_query flow
- `src/conversation/router.ts` — conversation routing, consent, AI agent orchestration
- `src/telegram/client.ts` — Telegram API client (sendMessage, answerCallbackQuery, etc.)
- `src/database/schema.ts` — current multi-tenant schema

**Architecture Patterns:**
- Express.js param routing: `app.use('/path/:param', handler)`
- Drizzle ORM: cascade deletes, unique indexes, transaction support
- State machines: typical pattern for multi-step flows in Node.js

**GDPR Compliance:**
- Data Deletion Requirements: all personal data (phone numbers, chat history, bookings) must be removable on request
- Cascade strategy: delete all child rows first (conversationTurns, bookings, etc.) before deleting business row
