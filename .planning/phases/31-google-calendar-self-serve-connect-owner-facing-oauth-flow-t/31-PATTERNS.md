# Phase 31: Google Calendar Self-Serve Connect - Pattern Map

**Mapped:** 2026-08-13
**Files analyzed:** 6 (5 new/modified)
**Analogs found:** 5 / 5

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/calendar/ics.ts` | utility | transform | `src/invites/generator.ts` | exact |
| `src/telegram/handlers/calendar-connect.ts` | handler | request-response | `src/telegram/handlers/admin-menu.ts` | exact |
| `src/server.ts` (/oauth/callback route) | route | request-response | `src/server.ts` (existing /healthz) + `src/google/oauth.ts` | role-match |
| `src/telegram/handlers/admin-menu.ts` (settings button) | handler | request-response | `src/telegram/handlers/admin-menu.ts` (showSettingsMenu) | exact |
| `src/telegram/client.ts` (sendTelegramDocument) | utility | request-response | `src/telegram/client.ts` (sendTelegramPhoto) | exact |
| Telegram command registration | config | setup | `src/telegram/handlers/admin-menu.ts` (setMyCommands) | exact |

---

## Pattern Assignments

### `src/calendar/ics.ts` (utility, transform)

**Analog:** `src/invites/generator.ts`

**Pattern:** Pure utility function that transforms domain objects (Booking, Business, Service) into a formatted output (ICS string, similar to how generateInviteImageBuffer transforms to PNG Buffer).

**Imports pattern** (lines 14-19):
```typescript
import { z } from 'zod';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { Business } from '../database/queries';
import { getMeBotInfo, sendTelegramPhoto } from '../telegram/client';
import { logger } from '../utils/logger';
```

For ICS generator, use similar structure but with calendar-focused imports:
```typescript
import { Booking, Business, Service } from '../database/queries';
import { addCalendarDays } from '../utils/timezone';
import { logger } from '../utils/logger';
```

**Core transform pattern** (lines 47-51):
```typescript
export async function generateInviteImageBuffer(
  deepLink: string,
  businessName: string,
  greekCTA: string
): Promise<Buffer> {
  const parsedName = businessNameSchema.safeParse(businessName);
  if (!parsedName.success) {
    throw new Error('Μη έγκυρο όνομα επιχείρησης για δημιουργία invite.');
  }
  const safeName = parsedName.data;
  // ... generate and return Buffer
}
```

For ICS: Replace validation schema with input validation, return string instead of Buffer:
```typescript
export function generateIcsEvent(
  booking: Booking,
  business: Business,
  service: Service
): string {
  // Validate inputs as needed
  // Construct and return RFC 5545 formatted string
}
```

**Encoding/escaping pattern** (lines 33-40):
```typescript
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
```

For ICS: Similar escaping pattern for special characters in SUMMARY/DESCRIPTION fields (use RFC 5545 escaping rules, not XML — but the multi-step replace pattern is identical).

**Helper function pattern** (lines 27-29):
```typescript
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
```

The pad2 function in src/calendar/sync.ts (lines 27-29) is the same pattern needed for ICS time formatting.

---

### `src/telegram/handlers/calendar-connect.ts` (handler, request-response)

**Analog:** `src/telegram/handlers/admin-menu.ts`

**Pattern:** Telegram command handler that sends an OAuth URL to the owner. Handler mirrors the structure of showTodaysAgenda (request-response: command → message).

**Imports pattern** (lines 13-41 of admin-menu.ts):
```typescript
import { eq } from 'drizzle-orm';
import { db } from '../../database/db';
import {
  Business,
  findServiceById,
  listBookingsForDate,
  findClientBusinessRelationship,
  // ... other queries
} from '../../database/queries';
import { businesses } from '../../database/schema';
import { formatAgendaMessage } from '../../scheduler/agenda';
import { isoDateInAthens } from '../../utils/timezone';
import { logger } from '../../utils/logger';
import { findBusinessByOwnerTelegramId } from '../../onboarding/queries';
import {
  InlineKeyboard,
  sendTelegramMessage,
  sendTelegramMessageWithKeyboard,
  botTokenStore,
  setMyCommands,
  setChatMenuButton,
} from '../client';
```

For calendar-connect handler, import:
```typescript
import { Business, findBusinessById } from '../../database/queries';
import { logger } from '../../utils/logger';
import { sendTelegramMessage, sendTelegramMessageWithKeyboard, InlineKeyboard } from '../client';
import { getOAuth2AuthUrl } from '../../google/oauth';
import { signOAuthState, verifyOAuthState } from '../../google/oauth-state'; // (new utility to add to src/google/oauth.ts)
```

**Command handler pattern** (lines 306-341 of admin-menu.ts — showTodaysAgenda):
```typescript
export async function showTodaysAgenda(chatId: string, business: Business): Promise<void> {
  const today = isoDateInAthens(new Date());
  const bookingList = await listBookingsForDate(business.id, today, [
    'confirmed',
    'pending_owner_approval',
  ]);

  // ... load additional data
  
  const message = bookingList.length > 0
    ? formatAgendaMessage(bookingList, serviceNamesById, clientNamesByPhone)
    : 'Δεν υπάρχουν ραντεβού για σήμερα.';

  await sendTelegramMessage(chatId, message);

  const backCallbackData = 'menu:root';
  assertCallbackDataSize(backCallbackData);
  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', [
    [{ text: BACK_MENU_LABELS.ADMIN, callback_data: backCallbackData }],
  ]);
}
```

For calendar-connect handler (simplified, no DB query needed):
```typescript
export async function handleCalendarConnect(chatId: string, business: Business): Promise<void> {
  const state = signOAuthState(business.id);
  const authUrl = getOAuth2AuthUrl(state);
  const message = `Κάντε κλικ στον σύνδεσμο για να συνδέσετε το Google Calendar σας:\n\n${authUrl}`;
  
  await sendTelegramMessage(chatId, message);
  
  const backCallbackData = 'menu:root';
  assertCallbackDataSize(backCallbackData);
  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', [
    [{ text: BACK_MENU_LABELS.ADMIN, callback_data: backCallbackData }],
  ]);
}
```

**Error handling pattern** (lines 353-366 of admin-menu.ts — handleInviteGeneration):
```typescript
export async function handleInviteGeneration(chatId: string, business: Business): Promise<void> {
  try {
    await sendBusinessInvite(business, chatId);
  } catch (err) {
    logger.error({ err, businessId: business.id }, 'Failed to generate invite');
    await sendTelegramMessage(chatId, 'Σφάλμα κατά τη δημιουργία του invite. Δοκιμάστε ξανά.');
  }

  const backCallbackData = 'menu:root';
  assertCallbackDataSize(backCallbackData);
  await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', [
    [{ text: BACK_MENU_LABELS.ADMIN, callback_data: backCallbackData }],
  ]);
}
```

For calendar-connect (in case OAuth URL generation fails — unlikely but follow the pattern):
```typescript
export async function handleCalendarConnect(chatId: string, business: Business): Promise<void> {
  try {
    const state = signOAuthState(business.id);
    const authUrl = getOAuth2AuthUrl(state);
    await sendTelegramMessage(chatId, `Σύνδεση Google Calendar:\n\n${authUrl}`);
  } catch (err) {
    logger.error({ err, businessId: business.id }, 'Failed to generate OAuth URL');
    await sendTelegramMessage(chatId, 'Σφάλμα κατά τη δημιουργία του συνδέσμου. Δοκιμάστε ξανά.');
  }
  // ... back-to-menu button follows
}
```

---

### `src/server.ts` (/oauth/callback route)

**Analog:** `src/server.ts` (existing routes) + `src/google/oauth.ts` (OAuth token handling)

**Route pattern** (lines 13-22 of src/server.ts):
```typescript
const app = express();

app.use('/webhooks/telegram', telegramWebhookRouter);

app.get('/healthz', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});
```

Add `/oauth/callback` route in the same location (after webhook router, before error handler):
```typescript
import { Request, Response } from 'express';
import { db } from './database/db';
import { businesses } from './database/schema';
import { eq } from 'drizzle-orm';
import { exchangeAuthCodeForTokens, storeGoogleRefreshToken } from './google/oauth';
import { verifyOAuthState } from './google/oauth-state'; // (new utility to add)

app.get('/oauth/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
      logger.error({ code, state }, 'OAuth callback missing code or state');
      res.status(400).send('<html><body>Missing authorization code or state.</body></html>');
      return;
    }

    // Extract and verify businessId from state
    const businessId = extractBusinessIdFromState(state);
    if (!businessId) {
      logger.error({ state }, 'OAuth state format invalid');
      res.status(400).send('<html><body>Invalid state format.</body></html>');
      return;
    }

    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, businessId),
    });
    if (!business) {
      logger.error({ businessId }, 'Business not found for state');
      res.status(404).send('<html><body>Business not found.</body></html>');
      return;
    }

    // Verify state signature
    if (!verifyOAuthState(businessId, state)) {
      logger.error({ state, businessId }, 'OAuth state signature mismatch');
      res.status(400).send('<html><body>State mismatch — possible CSRF.</body></html>');
      return;
    }

    // Exchange code for refresh token
    const { refreshToken } = await exchangeAuthCodeForTokens(code);
    await storeGoogleRefreshToken(businessId, refreshToken);

    // Success page
    res.status(200).send(
      `<html><body><p>Google Calendar connected for ${business.name}.</p><p>You can close this tab and return to Telegram.</p></body></html>`
    );
  } catch (err) {
    logger.error({ err }, 'OAuth callback handler failed');
    res.status(500).send('<html><body>Setup failed, see server logs.</body></html>');
  }
});
```

**OAuth token exchange pattern** (lines 28-42 of src/google/oauth.ts):
```typescript
export async function exchangeAuthCodeForTokens(
  code: string
): Promise<{ refreshToken: string; accessToken: string }> {
  const { tokens } = await getOAuth2Client().getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token -- ensure prompt=consent was used and this is the account's first authorization"
    );
  }
  return { refreshToken: tokens.refresh_token, accessToken: tokens.access_token ?? '' };
}

export async function storeGoogleRefreshToken(businessId: number, refreshToken: string): Promise<void> {
  await updateBusinessGoogleRefreshToken(businessId, refreshToken);
  logger.info({ businessId }, 'Google refresh token stored');
}
```

These functions are already in codebase and are Express-safe (idempotent, no closure-based state). The /oauth/callback route just calls them in sequence.

---

### `src/telegram/handlers/admin-menu.ts` (add calendar settings button)

**Analog:** `src/telegram/handlers/admin-menu.ts` (showSettingsMenu function)

**Button pattern** (lines 166-245 of admin-menu.ts):
```typescript
export async function showSettingsMenu(chatId: string, business: Business): Promise<void> {
  const slotlessStatus = business.slotlessRequestsEnabled ? '✅ Ενεργό' : '❌ Ανενεργό';
  // ... build status strings

  const messageText = `Ρυθμίσεις — ${business.name}

Ώρες λειτουργίας: (γράψε στο chat για αλλαγή)
Υπηρεσίες & τιμές: (γράψε στο chat για αλλαγή)

Αποδοχή αιτημάτων χωρίς slot: ${slotlessStatus}
...`;

  const slotlessCallbackData = business.slotlessRequestsEnabled
    ? 'menu:settings:slotless_off'
    : 'menu:settings:slotless_on';
  // ... define other callback data

  const backCallbackData = 'menu:root';
  assertCallbackDataSize(backCallbackData);

  const keyboard: InlineKeyboard = [
    [{ text: slotlessText, callback_data: slotlessCallbackData }],
    // ... other buttons
    [{ text: BACK_MENU_LABELS.ADMIN, callback_data: backCallbackData }],
  ];

  await sendTelegramMessageWithKeyboard(chatId, messageText, keyboard);
}
```

To add calendar button to showSettingsMenu, insert before the BACK button:
```typescript
const calendarCallbackData = 'menu:settings:calendar_connect';
assertCallbackDataSize(calendarCallbackData);

const keyboard: InlineKeyboard = [
  [{ text: slotlessText, callback_data: slotlessCallbackData }],
  // ... existing buttons
  [{ text: '📅 Σύνδεση Ημερολογίου', callback_data: calendarCallbackData }],
  [{ text: BACK_MENU_LABELS.ADMIN, callback_data: backCallbackData }],
];
```

**Callback dispatch pattern** (lines 782-810 of admin-menu.ts):
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
    // ... other cases
  }
}
```

Add calendar case:
```typescript
case menuAction === 'settings:calendar_connect':
  await handleCalendarConnect(chatId, business);
  break;
```

---

### `src/telegram/client.ts` (add sendTelegramDocument function)

**Analog:** `src/telegram/client.ts` (sendTelegramPhoto function, lines 107-156)

**Pattern:** Multipart form-data wrapper around callTelegramApi, reusing botTokenStore guard, timeout, and error handling.

**sendTelegramPhoto pattern** (lines 107-156):
```typescript
/**
 * Sends a photo message (Telegram sendPhoto) using a multipart/form-data body.
 * Cannot reuse callTelegramApi (JSON-only) — mirrors its botTokenStore guard,
 * AbortSignal.timeout, and try/catch + ok-double-check + logging shape.
 */
export async function sendTelegramPhoto(
  chatId: string,
  photoBuffer: Buffer,
  caption?: string
): Promise<SendMessageResult> {
  const botToken = botTokenStore.getStore();
  if (!botToken) {
    throw new Error(
      'sendTelegramPhoto called without botTokenStore context — wrap the call in botTokenStore.run(business.botToken, ...)'
    );
  }
  const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;

  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('photo', new Blob([photoBuffer], { type: 'image/png' }), 'invite.png');
  if (caption !== undefined) formData.append('caption', caption);

  const startedAt = Date.now();
  logger.debug({ method: 'sendPhoto' }, 'Calling Telegram API');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS),
    });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    logger.error(
      { err, method: 'sendPhoto', elapsedMs, timeoutMs: TELEGRAM_API_TIMEOUT_MS },
      'Telegram API fetch failed or timed out'
    );
    throw err;
  }

  const data = (await response.json()) as TelegramApiResponse<{ message_id: number }>;
  const elapsedMs = Date.now() - startedAt;

  if (!response.ok || !data.ok) {
    const description = data.description ?? `Telegram API error: ${response.status}`;
    logger.error({ method: 'sendPhoto', status: response.status, description, elapsedMs }, 'Telegram API call failed');
    throw new Error(description);
  }

  logger.debug({ method: 'sendPhoto', elapsedMs }, 'Telegram API call succeeded');
  logger.info({ chatId, messageId: data.result?.message_id }, 'Telegram photo sent');
  return { messageId: data.result?.message_id ?? 0 };
}
```

For sendTelegramDocument, replicate the same structure with minimal changes:
```typescript
export async function sendTelegramDocument(
  chatId: string,
  fileBuffer: Buffer,
  filename: string,
  caption?: string
): Promise<SendMessageResult> {
  const botToken = botTokenStore.getStore();
  if (!botToken) {
    throw new Error(
      'sendTelegramDocument called without botTokenStore context — wrap the call in botTokenStore.run(business.botToken, ...)'
    );
  }
  const url = `https://api.telegram.org/bot${botToken}/sendDocument`;

  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('document', new Blob([fileBuffer]), filename);
  if (caption !== undefined) formData.append('caption', caption);

  const startedAt = Date.now();
  logger.debug({ method: 'sendDocument', filename }, 'Calling Telegram API');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS),
    });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    logger.error(
      { err, method: 'sendDocument', filename, elapsedMs },
      'Telegram API fetch failed or timed out'
    );
    throw err;
  }

  const data = (await response.json()) as TelegramApiResponse<{ message_id: number }>;
  const elapsedMs = Date.now() - startedAt;

  if (!response.ok || !data.ok) {
    const description = data.description ?? `Telegram API error: ${response.status}`;
    logger.error(
      { method: 'sendDocument', status: response.status, description, elapsedMs },
      'Telegram API call failed'
    );
    throw new Error(description);
  }

  logger.debug({ method: 'sendDocument', elapsedMs }, 'Telegram API call succeeded');
  logger.info({ chatId, messageId: data.result?.message_id }, 'Telegram document sent');
  return { messageId: data.result?.message_id ?? 0 };
}
```

---

### Telegram Command Registration

**Analog:** `src/telegram/handlers/admin-menu.ts` (reassertMenuButtonAndCommands, lines 69-99)

**Command registration pattern** (lines 77-96):
```typescript
await setMyCommands(
  botToken,
  [
    { command: 'menu', description: 'Εμφάνιση μενού διαχείρισης' },
    { command: 'settings', description: 'Ρυθμίσεις' },
    { command: 'classes', description: 'Μαθήματα' },
    { command: 'clients', description: 'Πελάτες' },
    { command: 'agenda', description: 'Ατζέντα Σήμερα' },
    { command: 'payment', description: 'Καταχώρηση Πληρωμής' },
    { command: 'invite', description: 'Πρόσκληση Πελάτη' },
  ],
  { type: 'chat', chat_id: chatId }
);
```

Add `/calendar` command to this list:
```typescript
await setMyCommands(
  botToken,
  [
    { command: 'menu', description: 'Εμφάνιση μενού διαχείρισης' },
    { command: 'settings', description: 'Ρυθμίσεις' },
    { command: 'classes', description: 'Μαθήματα' },
    { command: 'clients', description: 'Πελάτες' },
    { command: 'agenda', description: 'Ατζέντα Σήμερα' },
    { command: 'payment', description: 'Καταχώρηση Πληρωμής' },
    { command: 'invite', description: 'Πρόσκληση Πελάτη' },
    { command: 'calendar', description: 'Σύνδεση Google Ημερολογίου' },
  ],
  { type: 'chat', chat_id: chatId }
);
```

**Command routing pattern** (lines 191-202 of src/webhooks/telegram.ts):
```typescript
if (messageText.trim() === '/settings') {
  await withBusinessContext(business.id, async () => {
    clearPendingReply(business.id, senderTelegramId);
    await showSettingsMenu(senderTelegramId, business);
    await markTelegramUpdateProcessed(updateId, business.id);
  });
  logger.info(
    { updateId, businessId: business.id, elapsedMs: Date.now() - startedAt },
    'handleFoundBusiness: exit (/settings branch)'
  );
  return;
}
```

Add `/calendar` command routing in the same section:
```typescript
if (messageText.trim() === '/calendar') {
  await withBusinessContext(business.id, async () => {
    clearPendingReply(business.id, senderTelegramId);
    await handleCalendarConnect(senderTelegramId, business);
    await markTelegramUpdateProcessed(updateId, business.id);
  });
  logger.info(
    { updateId, businessId: business.id, elapsedMs: Date.now() - startedAt },
    'handleFoundBusiness: exit (/calendar branch)'
  );
  return;
}
```

---

## Shared Patterns

### OAuth State Parameter Security
**Source:** `src/google/oauth.ts` + RESEARCH.md Code Examples
**Apply to:** `/oauth/callback` route handling

HMAC-signed state parameter to securely map businessId without session storage:

```typescript
// New utility functions to add to src/google/oauth.ts
import crypto from 'crypto';
import { config } from '../config';

const STATE_SIGNING_SECRET = config.googleClientSecret;

export function signOAuthState(businessId: number): string {
  const payload = businessId.toString();
  const hmac = crypto.createHmac('sha256', STATE_SIGNING_SECRET);
  hmac.update(payload);
  return hmac.digest('hex');
}

export function verifyOAuthState(businessId: number, state: string): boolean {
  const expected = signOAuthState(businessId);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(state));
}
```

### Telegram Bot Token Management
**Source:** `src/telegram/client.ts` (botTokenStore pattern)
**Apply to:** All new functions that call Telegram API

Always use AsyncLocalStorage context (botTokenStore) to access token — never log it or pass it as direct parameter:

```typescript
const botToken = botTokenStore.getStore();
if (!botToken) {
  throw new Error(
    'Function called without botTokenStore context — wrap the call in botTokenStore.run(business.botToken, ...)'
  );
}
```

### Error Handling
**Source:** `src/telegram/handlers/admin-menu.ts` (handleInviteGeneration) + `src/calendar/sync.ts`
**Apply to:** All handler functions and API calls

Pattern: Try-catch with logger.error, always send user-facing Greek error message, continue to back-to-menu button:

```typescript
try {
  // ... main logic
} catch (err) {
  logger.error({ err, businessId: business.id }, 'Action description');
  await sendTelegramMessage(chatId, 'Σφάλμα κατά τη δράση. Δοκιμάστε ξανά.');
}
// Always show back-to-menu button, error or not
await sendTelegramMessageWithKeyboard(chatId, 'Τι άλλο θέλεις να κάνεις;', [
  [{ text: BACK_MENU_LABELS.ADMIN, callback_data: 'menu:root' }],
]);
```

### Calendar Sync Integration
**Source:** `src/calendar/sync.ts` (syncBookingToCalendar pattern)
**Apply to:** Ensure /oauth/callback safely stores token without breaking existing sync

Pattern: The sync poller already no-ops safely when `googleRefreshToken` is null. Storing a new token via /oauth/callback just populates the column; the next sync cycle picks it up. No additional integration needed.

---

## No Analog Found

No new code pattern categories without established analogs in the codebase.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | All files follow existing patterns |

---

## Metadata

**Analog search scope:**
- `src/calendar/` — sync, poller, existing calendar patterns
- `src/telegram/handlers/` — admin-menu, payment-flow, client-menu (command handlers)
- `src/telegram/client.ts` — Telegram API wrappers (sendMessage, sendPhoto)
- `src/google/oauth.ts` — OAuth token exchange (reused, not reimplemented)
- `src/server.ts` — Express route patterns
- `src/webhooks/telegram.ts` — command routing and context binding

**Files scanned:** 12 (calendar, telegram, google, server modules)

**Pattern extraction date:** 2026-08-13

**Key Findings:**
- All new files follow exact analogs in the codebase (no new patterns needed)
- OAuth functions (`exchangeAuthCodeForTokens`, `storeGoogleRefreshToken`) are already Express-safe and require no modification
- State parameter signing via HMAC is a new utility but uses standard crypto.createHmac (Node.js built-in)
- ICS generation follows the utility-to-string pattern already established by invites/generator.ts
- Telegram command registration and routing follows recent quick-task 260729-s9c patterns exactly
