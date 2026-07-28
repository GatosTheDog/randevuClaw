# Phase 27: Client Consent & Registration - Pattern Map

**Mapped:** 2026-07-28
**Files analyzed:** 9
**Analogs found:** 9 / 9

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/database/schema.ts` | model/schema | schema definition | `src/database/schema.ts` (self, existing table) | exact |
| `src/consent/checker.ts` | service | CRUD (query) | `src/consent/checker.ts` (self, extend existing) | exact |
| `src/database/queries.ts` | service/repository | CRUD | `src/database/queries.ts` (self, extend existing) | exact |
| `src/utils/greek-messages.ts` | config/constants | static data | `src/utils/greek-messages.ts` (self, extend existing) | exact |
| `src/webhooks/telegram.ts` | route/webhook | request-response | `src/webhooks/telegram.ts` (self, add gate logic) | exact |
| `src/conversation/router.ts` | route/handler | request-response | `src/conversation/router.ts` (self, add gate logic) | exact |
| `src/telegram/client.ts` | utility/client | request-response | `src/telegram/client.ts` (self, reference only) | exact |
| `migrations/0013_*.sql` | migration | schema change | `migrations/0012_renewal_nudge_notifications.sql` | exact |

## Pattern Assignments

### `src/database/schema.ts` (model, schema definition)

**Analog:** Self — existing `clientBusinessRelationships` table (lines 93–114)

**Table structure & existing pattern** (lines 93–114):
```typescript
export const clientBusinessRelationships = pgTable(
  'client_business_relationships',
  {
    id: serial('id').primaryKey(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id),
    senderPhone: text('sender_phone').notNull(),
    clientName: text('client_name'),
    consentGiven: boolean('consent_given').notNull().default(true), // Implied consent (D-10)
    consentTimestamp: timestamp('consent_timestamp').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('unique_client_business').on(table.businessId, table.senderPhone),
  ]
);
```

**Action:** Flip the default of `consentGiven` from `true` to `false` (D-04 backfill will handle pre-existing rows).

---

### `src/consent/checker.ts` (service, CRUD/query)

**Analog:** Self — existing consent checking logic (lines 1–24)

**Imports pattern** (lines 1–5):
```typescript
import {
  findClientBusinessRelationship,
  insertClientBusinessRelationship,
} from '../database/queries';
import { logger } from '../utils/logger';
```

**Existing `getOrCreateClientRelationship` function** (lines 10–24):
```typescript
export async function getOrCreateClientRelationship(
  businessId: number,
  senderPhone: string
): Promise<{ isFirstContact: boolean; consentGiven: boolean }> {
  const existing = await findClientBusinessRelationship(businessId, senderPhone);

  if (existing) {
    logger.debug({ businessId, senderPhone }, 'Returning client, relationship found');
    return { isFirstContact: false, consentGiven: existing.consentGiven };
  }

  await insertClientBusinessRelationship(businessId, senderPhone);
  logger.info({ businessId, senderPhone }, 'First contact — new client relationship created');
  return { isFirstContact: true, consentGiven: true };
}
```

**Action:** This function already returns `consentGiven` flag. With the schema default flipped to `false`, new rows will have `consentGiven: false`, and the gate logic in `webhooks/telegram.ts` and `conversation/router.ts` will check this flag before allowing menu/chat. No changes needed to this function itself — the return value and contract remain the same; the semantics of `consentGiven = false` (not yet accepted) will be enforced by the new gate checks.

---

### `src/database/queries.ts` (service/repository, CRUD)

**Analog:** Self — existing `insertClientBusinessRelationship` (lines 207–229)

**Full function** (lines 207–229):
```typescript
export async function insertClientBusinessRelationship(
  businessId: number,
  senderPhone: string,
  clientName?: string
): Promise<ClientBusinessRelationship> {
  const rows = await getConn()
    .insert(clientBusinessRelationships)
    .values({
      businessId,
      senderPhone,
      clientName,
      consentGiven: true,
      consentTimestamp: new Date(),
    })
    .onConflictDoUpdate({
      target: [clientBusinessRelationships.businessId, clientBusinessRelationships.senderPhone],
      set: { clientName, consentTimestamp: new Date() },
    })
    .returning();

  return rows[0];
}
```

**Action:** Once the schema default flips to `false`, this function will still insert with `consentGiven: true` explicitly (to backfill implied consent), BUT new rows created during the gate flow (before the Ναι tap) should NOT be explicitly set. Two options:
1. **Keep explicit `consentGiven: true`** in this function (preserves backfill semantics), and add a separate `insertClientBusinessRelationshipWithoutConsent()` for gate-flow pre-creation.
2. **Remove explicit `consentGiven: true`** from this function and let it default to `false`, then explicitly set `consentGiven: true` on the Ναι callback (and in the migration backfill).

Research recommends option 2 (repurpose `consentGiven` default). Planner decides the approach. Either way, the atomic upsert pattern (lines 221–225) and the consentTimestamp refresh must remain unchanged to protect against PITFALLS.md Pitfall 3's race condition.

**No new query function needed** — gate check simply queries the existing `consentGiven` flag from the relationship row.

---

### `src/utils/greek-messages.ts` (config, static data)

**Analog:** Self — existing `CONFIRM_LABELS` constant (lines 15–21)

**Existing pattern** (lines 1–21):
```typescript
// Phase 26 (CONF-01, D-07): centralizes Greek button-label strings for the
// confirm-before-mutate call sites this phase adds across the 5 CONF-01
// destructive owner actions. Per D-07 this file holds button-label strings
// ONLY — no prompt-template functions. callback_data conventions stay
// independent per file (menu:<action>, cmenu:<action>, sbk:<approve|reject>,
// otc:<action>), a shared confirmation-keyboard helper was explicitly
// rejected to avoid unwanted coupling between files with different
// callback_data shapes.
export const CONFIRM_LABELS = {
  DELETE: 'Διαγραφή',
  CONFIRM: 'Επιβεβαίωση',
  APPROVE: 'Έγκριση',
  REJECT: 'Απόρριψη',
  CANCEL: 'Άκυρο',
} as const;
```

**Action:** Add new YES/NO label entries:
```typescript
export const CONFIRM_LABELS = {
  // ... existing entries ...
  YES: 'Ναι',
  NO: 'Όχι',
} as const;
```

Or, if planner prefers clarity (consent-specific naming), add:
```typescript
export const CONSENT_LABELS = {
  ACCEPT: 'Ναι',
  DECLINE: 'Όχι',
} as const;
```

Follow the Phase 26 D-07 convention: **strings only, no prompt templates**.

---

### `src/telegram/client.ts` (utility, request-response)

**Analog:** Self — existing `sendTelegramMessageWithKeyboard` (lines 88–100)

**Function signature & usage** (lines 88–100):
```typescript
export async function sendTelegramMessageWithKeyboard(
  chatId: string,
  text: string,
  inlineKeyboard: InlineKeyboard
): Promise<SendMessageResult> {
  const result = await callTelegramApi<{ message_id: number }>('sendMessage', {
    chat_id: chatId,
    text,
    reply_markup: { inline_keyboard: inlineKeyboard },
  });
  logger.info({ chatId, messageId: result.message_id }, 'Telegram message with keyboard sent');
  return { messageId: result.message_id };
}
```

**Type definition** (lines 14–14):
```typescript
export type InlineKeyboard = Array<Array<{ text: string; callback_data: string }>>;
```

**Action:** No changes needed to this file. The consent Yes/No keyboard will use this existing function, same as all other inline keyboards in the codebase. Example keyboard construction (to be used in new handler):
```typescript
const consentKeyboard: InlineKeyboard = [[
  { text: 'Ναι', callback_data: 'consent:yes' },
  { text: 'Όχι', callback_data: 'consent:no' },
]];
await sendTelegramMessageWithKeyboard(chatId, promptText, consentKeyboard);
```

---

### `src/webhooks/telegram.ts` (route/webhook, request-response)

**Analog:** Self — existing `/start` handler (lines 136–147) and `parseCallbackData` (lines 263–365)

**Current `/start` handler** (lines 136–147):
```typescript
if (messageText.trim() === '/start') {
  await withBusinessContext(business.id, async () => {
    await showClientRootMenu(senderTelegramId, business);
    await markTelegramUpdateProcessed(updateId, business.id);
  });
  logger.info(
    { updateId, businessId: business.id, elapsedMs: Date.now() - startedAt },
    'handleFoundBusiness: exit (/start branch)'
  );
  return;
}
```

**Action:** Intercept before `showClientRootMenu`. Add consent gate:
```typescript
if (messageText.trim() === '/start') {
  await withBusinessContext(business.id, async () => {
    const { consentGiven } = await getOrCreateClientRelationship(business.id, senderTelegramId);
    if (!consentGiven) {
      // Show consent + registration prompt
      await showConsentPrompt(senderTelegramId);
    } else {
      await showClientRootMenu(senderTelegramId, business);
    }
    await markTelegramUpdateProcessed(updateId, business.id);
  });
  // ... rest
}
```

**`parseCallbackData` pattern** (lines 263–365):
```typescript
export function parseCallbackData(
  data: string | undefined
): BookingCallbackResult | BillingCallbackResult | ... | null {
  // Existing booking action pattern (unchanged)
  const bookingMatch = data?.match(/^(approve|reject|client_cancel)_(\d+)$/);
  if (bookingMatch) { ... }
  
  // Phase 17: admin menu callback pattern — menu:<action>[:<numericId>]
  const menuMatch = data?.match(/^menu:([\w:]+?)(?::(\d+))?$/);
  if (menuMatch) {
    return { menuAction: menuMatch[1], id: menuMatch[2] ? Number(menuMatch[2]) : undefined };
  }
  // ... more patterns
}
```

**Action:** Add new consent callback pattern to `parseCallbackData` (before the return null):
```typescript
// Phase 27: client consent acceptance/decline — consent:yes / consent:no
const consentMatch = data?.match(/^consent:(yes|no)$/);
if (consentMatch) {
  return {
    consentAction: consentMatch[1] as 'yes' | 'no',
  };
}
```

Add handler in `handleCallbackQuery` (after existing discriminant checks). Example discriminant strategy (following RESEARCH.md Pitfall 1):
```typescript
if ('consentAction' in parsed) {
  const consentResult = parsed as ConsentCallbackResult;
  if (consentResult.consentAction === 'yes') {
    await updateClientConsentGiven(business.id, senderTelegramId, true);
    await showClientRootMenu(senderTelegramId, business);
    await answerCallbackQuery(callbackQuery.id, 'Ευχαριστούμε που δεχθήκατε.');
  } else {
    await answerCallbackQuery(callbackQuery.id, 'Παρακαλώ δεχθείτε τους όρους για να συνεχίσετε.');
  }
  // ... mark as processed
  return;
}
```

---

### `src/conversation/router.ts` (route/handler, request-response)

**Analog:** Self — existing `routeConversationMessage` (lines 16–92)

**Current function signature & flow** (lines 16–92):
```typescript
export async function routeConversationMessage(
  business: Business,
  senderId: string,
  rawMessageText: string,
  channel: ConversationChannel
): Promise<void> {
  const routeStartedAt = Date.now();
  logger.info({ businessId: business.id, senderId }, 'Routing conversation message');

  // Stage 1: consent check
  let stageStartedAt = Date.now();
  const { isFirstContact } = await getOrCreateClientRelationship(business.id, senderId);
  logger.info(
    { businessId: business.id, senderId, isFirstContact, elapsedMs: Date.now() - stageStartedAt },
    'routeConversationMessage: getOrCreateClientRelationship returned'
  );
  if (isFirstContact) logger.info({ businessId: business.id, senderId }, 'First contact — consent notice will prepend');

  // Stage 2–4: resolve temporals, call AI agent, persist turn, send reply
  // ...
  
  const finalText = isFirstContact
    ? `${CONSENT_NOTICE_GREEK_TEMPLATE(business.name)}\n\n${result.text}`
    : result.text;
  
  await channel.sendMessage(senderId, finalText);
}
```

**Action:** Add a hard gate after the `getOrCreateClientRelationship` call and BEFORE proceeding to the AI agent:
```typescript
const { isFirstContact, consentGiven } = await getOrCreateClientRelationship(business.id, senderId);
logger.info({ businessId: business.id, senderId, isFirstContact, elapsedMs: Date.now() - stageStartedAt },
  'routeConversationMessage: getOrCreateClientRelationship returned');

if (!consentGiven) {
  // Hard gate: show consent prompt, do NOT proceed to AI agent
  const consentKeyboard: InlineKeyboard = [[
    { text: 'Ναι', callback_data: 'consent:yes' },
    { text: 'Όχι', callback_data: 'consent:no' },
  ]];
  await channel.sendMessage(senderId, /* consent prompt text */);
  // sendMessage via channel is the abstraction — use sendTelegramMessageWithKeyboard instead
  // OR extend ConversationChannel interface to support keyboard sends
  return; // Do NOT proceed to AI agent
}
```

**Note:** The current `routeConversationMessage` only takes `sendMessage` from `channel` (no keyboard support). Two options:
1. **Extend `ConversationChannel` interface** to include `sendMessageWithKeyboard()`, then call it for the consent prompt.
2. **Call `sendTelegramMessageWithKeyboard` directly** before returning, breaking the channel abstraction slightly but pragmatically.

Research suggests option 1 (cleaner abstraction). Planner decides.

---

### `migrations/0013_*.sql` (migration, schema change)

**Analog:** `migrations/0012_renewal_nudge_notifications.sql` (lines 1–19) — recent migration pattern

**Migration template** (pattern from `0012_*`):
```sql
DO $$
BEGIN
  -- Idempotent table creation (IF NOT EXISTS)
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '...') THEN
    CREATE TABLE ... (
      ...
    );
  END IF;
END $$;

-- Idempotent index creation
CREATE UNIQUE INDEX IF NOT EXISTS unique_... ON ...(...);

-- Permissions for app role
GRANT SELECT, INSERT ON ... TO randevuclaw_app;
GRANT USAGE, SELECT ON SEQUENCE ..._id_seq TO randevuclaw_app;
```

**Action for Phase 27 migration:**
1. **Flip the default** of `consentGiven` in the `client_business_relationships` table from `true` to `false`:
   ```sql
   ALTER TABLE client_business_relationships
     ALTER COLUMN consent_given DROP DEFAULT,
     ALTER COLUMN consent_given SET DEFAULT false;
   ```

2. **Backfill pre-existing rows** to `consentGiven = true` (per D-04 — grandfathering, no re-prompt):
   ```sql
   UPDATE client_business_relationships
     SET consent_given = true
     WHERE consent_given = false;
   ```
   
   OR, more idiomatically for a migration: since the old default was `true` and the column is `NOT NULL`, all pre-migration rows WILL have `true`. The migration only needs to flip the default for future inserts; the backfill is a no-op. BUT for clarity and documentation, include an explicit backfill comment:
   ```sql
   -- D-04: Pre-v1.7 rows grandfathered in with consentGiven = true (implied consent).
   -- Migration flips the default to false for new rows (explicit opt-in required).
   -- Backfill is idempotent: UPDATE only affects rows with false (post-migration new clients who haven't accepted yet).
   ```

3. **Ensure RLS/permissions** remain intact (copy from prior migrations).

---

## Shared Patterns

### Consent Gate Logic

**Source:** All files above

**Pattern:** A client's first message (via `/start` OR free-chat) triggers `getOrCreateClientRelationship()`, which returns `consentGiven: boolean`. If `false`, show the consent Yes/No keyboard and return early (do NOT proceed to menu or AI agent). On `/start`, gate is checked before `showClientRootMenu`. On free-chat, gate is checked before AI call.

**Apply to:** 
- `src/webhooks/telegram.ts` — `/start` branch (lines 136–147)
- `src/conversation/router.ts` — free-chat branch (lines 16–92)

### Callback Data Pattern (consent:yes / consent:no)

**Source:** `src/webhooks/telegram.ts` `parseCallbackData` (lines 263–365), mirroring existing patterns like `menu:...` and `otc:...`

**Pattern:** Callback data is parsed into a discriminant object with a unique field name (`consentAction: 'yes' | 'no'`). Handler dispatches on the discriminant in `handleCallbackQuery`.

**Apply to:** `src/webhooks/telegram.ts` callback routing.

### Consent Prompt Layout

**Source:** `src/telegram/handlers/admin-menu.ts` `showCancelClassConfirm` (lines 326–340), using `sendTelegramMessageWithKeyboard` with a two-button Ναι/Όχι keyboard

**Pattern:**
```typescript
const keyboard: InlineKeyboard = [[
  { text: 'Ναι', callback_data: 'consent:yes' },
  { text: 'Όχι', callback_data: 'consent:no' },
]];
await sendTelegramMessageWithKeyboard(chatId, promptText, keyboard);
```

**Apply to:** New consent prompt function (to be added to `src/telegram/handlers/client-menu.ts` or a new `src/telegram/handlers/consent.ts`).

### Atomic Upsert Pattern (Pitfalls.md Pitfall 3 mitigation)

**Source:** `src/database/queries.ts` `insertClientBusinessRelationship` (lines 221–225)

**Pattern:**
```typescript
.onConflictDoUpdate({
  target: [clientBusinessRelationships.businessId, clientBusinessRelationships.senderPhone],
  set: { clientName, consentTimestamp: new Date() },
})
.returning();
```

**Apply to:** All client–business relationship upserts. DO NOT replace with a check-then-insert pattern (vulnerable to PITFALLS.md Pitfall 3 race).

---

## No Analog Found

None — all files are modifications or extensions of existing patterns. Planner can copy patterns directly from analogs listed above.

---

## Metadata

**Analog search scope:** `src/`, `migrations/`, `tests/`
**Files scanned:** 40+
**Pattern extraction date:** 2026-07-28

**Planner notes:**
- No external library imports needed beyond existing stack (Telegram SDK, Drizzle, express, logger).
- Consent prompt wording: Keep tone consistent with existing `CONSENT_NOTICE_GREEK_TEMPLATE` (src/consent/checker.ts:7–8). Short, direct, single sentence preferred.
- Callback data size: Existing `assertCallbackDataSize` helper in admin-menu.ts ensures Telegram's 64-byte limit. New `consent:yes` / `consent:no` are well under the limit.
- Channel abstraction: If extending `ConversationChannel` to support keyboard sends, ensure the Telegram implementation is updated in `src/webhooks/telegram.ts` line 150–152.
