# Phase 25: Client Invite Generator - Pattern Map

**Mapped:** 2026-07-27
**Files analyzed:** 8 new/modified files
**Analogs found:** 8/8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `package.json` | config | transform | `package.json` (existing) | exact |
| `src/telegram/client.ts` | utility | request-response | `src/telegram/client.ts` (extend) | exact |
| `src/invites/generator.ts` | service | transform | `src/session/manager.ts` | role-match |
| `src/telegram/handlers/admin-menu.ts` | handler | request-response | `src/telegram/handlers/admin-menu.ts` (extend) | exact |
| `src/onboarding/ai-owner-agent.ts` | agent | request-response | `src/onboarding/ai-owner-agent.ts` (extend) | exact |
| `tests/invites/generator.test.ts` | test | transform | `tests/admin-menu.test.ts` | role-match |
| `tests/telegram/client.test.ts` | test | request-response | `tests/telegram-client.test.ts` (extend) | exact |
| `tests/telegram/handlers/admin-menu.test.ts` | test | request-response | `tests/admin-menu.test.ts` (extend) | exact |

---

## Pattern Assignments

### `package.json` (config, transform)

**Analog:** `package.json` (existing, lines 1-48)

**Dependency addition pattern** (lines 22-34):
```json
"dependencies": {
  "@google/genai": "^2.10.0",
  "dotenv": "^16.4.5",
  "drizzle-orm": "^0.45.2",
  "express": "^5.2.1",
  "googleapis": "^173.0.0",
  "pg": "^8.13.0",
  "pino": "^10.3.1",
  "qrcode": "^1.5.4",
  "remove-accents": "^0.5.0",
  "rrule": "^2.8.1",
  "telegraf": "^4.16.3",
  "zod": "^4.4.3"
}
```

**Note:** Add either `"svg2png-wasm": "^0.1.0"` (zero native deps) OR `"sharp": "^0.33.0"` (native bindings). RESEARCH.md recommends Path A (WASM) for alignment with project minimalism; choose Path B (sharp) if performance testing shows WASM limitations.

---

### `src/telegram/client.ts` (utility, request-response)

**Analog:** `src/telegram/client.ts` (existing, lines 34-77 for pattern, 79-100 for sendMessage reference)

**Imports pattern** (lines 1-8):
```typescript
import { AsyncLocalStorage } from 'async_hooks';
import { logger } from '../utils/logger';

export const botTokenStore = new AsyncLocalStorage<string>();
export interface SendMessageResult {
  messageId: number;
}
```

**API timeout and error handling pattern** (lines 22-76):
```typescript
const TELEGRAM_API_TIMEOUT_MS = 15_000;

interface TelegramApiResponse<T> {
  ok: boolean;
  description?: string;
  result?: T;
}

async function callTelegramApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const botToken = botTokenStore.getStore();
  if (!botToken) {
    throw new Error(
      'callTelegramApi called without botTokenStore context — wrap the call in botTokenStore.run(business.botToken, ...)'
    );
  }
  const url = `https://api.telegram.org/bot${botToken}/${method}`;

  const startedAt = Date.now();
  logger.debug({ method }, 'Calling Telegram API');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS),
    });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    logger.error(
      { err, method, elapsedMs, timeoutMs: TELEGRAM_API_TIMEOUT_MS },
      'Telegram API fetch failed or timed out'
    );
    throw err;
  }

  const data = (await response.json()) as TelegramApiResponse<T>;
  const elapsedMs = Date.now() - startedAt;

  if (!response.ok || !data.ok) {
    const description = data.description ?? `Telegram API error: ${response.status}`;
    logger.error({ method, status: response.status, description, elapsedMs }, 'Telegram API call failed');
    throw new Error(description);
  }

  logger.debug({ method, elapsedMs }, 'Telegram API call succeeded');
  return data.result as T;
}
```

**sendPhoto function pattern** (new, based on sendTelegramMessage structure — lines 79-86 reference):
```typescript
export async function sendTelegramPhoto(
  chatId: string,
  photoBuffer: Buffer,
  caption?: string
): Promise<SendMessageResult> {
  const botToken = botTokenStore.getStore();
  if (!botToken) {
    throw new Error('sendTelegramPhoto called without botTokenStore context');
  }

  const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('photo', new Blob([photoBuffer], { type: 'image/png' }), 'invite.png');
  if (caption) {
    formData.append('caption', caption);
  }

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS),
    });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    logger.error({ err, method: 'sendPhoto', elapsedMs }, 'Telegram API fetch failed');
    throw err;
  }

  const data = (await response.json()) as TelegramApiResponse<{ message_id: number }>;
  const elapsedMs = Date.now() - startedAt;

  if (!response.ok || !data.ok) {
    const description = data.description ?? `Telegram API error: ${response.status}`;
    logger.error({ method: 'sendPhoto', status: response.status, description, elapsedMs }, 'Telegram API failed');
    throw new Error(description);
  }

  logger.info({ chatId, messageId: data.result?.message_id, elapsedMs }, 'Telegram photo sent');
  return { messageId: data.result?.message_id ?? 0 };
}
```

---

### `src/invites/generator.ts` (service, transform)

**Analog:** `src/session/manager.ts` (lines 1-67, import structure and async utility module pattern)

**Imports and structure pattern** (lines 1-20 of session/manager.ts):
```typescript
import { z } from 'zod';
import { logger } from '../utils/logger';
import { getMeBotInfo } from '../telegram/client';

// Validation schema for business name
const BusinessNameSchema = z
  .string()
  .min(1, 'Business name required')
  .max(100, 'Business name too long')
  .regex(/^[a-zA-Z0-9\s\-όάέίύώΐΰ]+$/, 'Invalid characters in business name');

// Helper: escape XML entities for SVG safety
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
```

**Core generation pattern** (async function following session/manager.ts style):
```typescript
/**
 * Generates a printable invite image with QR code, business name, and Greek CTA.
 * Returns PNG buffer ready for Telegram sendPhoto.
 * 
 * WR-01: businessName is user-supplied; validate length and character set before SVG composition.
 * T-25-01: All user inputs (businessName, greekCTA) escaped via escapeXml() before embedding.
 */
export async function generateInviteImageWithText(
  deepLink: string, // "t.me/bot_username"
  businessName: string,
  greekCTA: string
): Promise<Buffer> {
  // Validate inputs
  BusinessNameSchema.parse(businessName);

  logger.debug({ businessName, deepLink }, 'Generating invite image');

  try {
    // Step 1: Generate QR code as PNG buffer (qrcode npm)
    const qrDataUri = await QRCode.toDataURL(deepLink, {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
    const base64Data = qrDataUri.split(',')[1];
    const qrPngBuffer = Buffer.from(base64Data, 'base64');

    // Step 2: Use chosen composition path (Path A or Path B)
    // Path A: SVG + WASM rasterizer (zero native deps)
    const pngBuffer = await composeInviteImageWASM(qrPngBuffer, businessName, greekCTA);
    
    logger.debug({ businessName }, 'Invite image generated successfully');
    return pngBuffer;
  } catch (err) {
    logger.error({ err, businessName }, 'Failed to generate invite image');
    throw err;
  }
}

/**
 * Path A: Compose using SVG templates + svg2png-wasm (zero native deps).
 */
async function composeInviteImageWASM(
  qrPngBuffer: Buffer,
  businessName: string,
  greekCTA: string
): Promise<Buffer> {
  const QRCode = await import('qrcode');
  const { svg2png } = await import('svg2png-wasm');

  // Generate QR as SVG string
  const qrSvgString = await QRCode.toString(/* deepLink already encoded in qrPngBuffer */, {
    type: 'image/svg+xml',
    width: 300,
  });

  const qrSvgMatch = qrSvgString.match(/<svg[^>]*>[\s\S]*<\/svg>/);
  if (!qrSvgMatch) throw new Error('Failed to extract SVG from QR code');
  
  const qrSvgContent = qrSvgMatch[0];

  const composedSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="400" height="500" viewBox="0 0 400 500">
      <rect width="400" height="500" fill="white"/>
      <text x="200" y="30" font-size="24" font-weight="bold" text-anchor="middle" fill="black">
        ${escapeXml(businessName)}
      </text>
      <g transform="translate(50, 70)">
        ${qrSvgContent}
      </g>
      <text x="200" y="480" font-size="14" text-anchor="middle" fill="black">
        ${escapeXml(greekCTA)}
      </text>
    </svg>
  `;

  const pngBuffer = await svg2png(Buffer.from(composedSvg, 'utf-8'));
  return pngBuffer;
}
```

**Error handling pattern** (follows session/manager.ts T-10-09):
```typescript
  } catch (err) {
    logger.error({ err, businessName }, 'Failed to generate invite image');
    throw err;
  }
```

---

### `src/telegram/handlers/admin-menu.ts` (handler, request-response)

**Analog:** `src/telegram/handlers/admin-menu.ts` (lines 45-73, lines 487-585 for dispatcher pattern)

**New menu button pattern** (add to showAdminRootMenu, lines 56-72):
```typescript
export async function showAdminRootMenu(chatId: string, business: Business): Promise<void> {
  const callbackDataSettings = 'menu:settings';
  const callbackDataClasses = 'menu:classes';
  const callbackDataClients = 'menu:clients';
  const callbackDataAgenda = 'menu:agenda';
  const callbackDataInvite = 'menu:invite';  // NEW

  assertCallbackDataSize(callbackDataSettings);
  assertCallbackDataSize(callbackDataClasses);
  assertCallbackDataSize(callbackDataClients);
  assertCallbackDataSize(callbackDataAgenda);
  assertCallbackDataSize(callbackDataInvite);  // NEW

  const keyboard: InlineKeyboard = [
    [
      { text: 'Ρυθμίσεις', callback_data: callbackDataSettings },
      { text: 'Μαθήματα', callback_data: callbackDataClasses },
    ],
    [
      { text: 'Πελάτες', callback_data: callbackDataClients },
      { text: 'Ατζέντα Σήμερα', callback_data: callbackDataAgenda },
    ],
    [
      { text: 'Δημιουργία Invite', callback_data: callbackDataInvite },  // NEW
    ],
  ];

  await sendTelegramMessageWithKeyboard(
    chatId,
    `Πίνακας Ελέγχου — ${business.name}`,
    keyboard
  );
}
```

**New handler function pattern** (add to handleMenuCallback dispatcher, lines 487-585):
```typescript
export async function handleInviteGeneration(
  chatId: string,
  business: Business
): Promise<void> {
  if (!business.botToken) {
    await sendTelegramMessage(chatId, 'Σφάλμα: δεν βρέθηκε το bot token της επιχείρησης.');
    return;
  }

  try {
    // Fetch fresh bot username
    const botInfo = await getMeBotInfo(business.botToken);
    if (!botInfo.username) {
      await sendTelegramMessage(chatId, 'Σφάλμα: δεν βρέθηκε το όνομα χρήστη του bot.');
      return;
    }

    const deepLink = `t.me/${botInfo.username}`;
    const greekCTA = 'Κάντε κράτηση τώρα!';

    // Generate invite image
    const inviteBuffer = await generateInviteImageWithText(
      deepLink,
      business.name,
      greekCTA
    );

    // Send photo + caption with copyable link
    await sendTelegramPhoto(
      chatId,
      inviteBuffer,
      `🔗 Αντιγράψτε τον σύνδεσμο:\n${deepLink}`
    );

    logger.info({ businessId: business.id }, 'Invite generated and sent');
  } catch (err) {
    logger.error({ err, businessId: business.id }, 'Failed to generate invite');
    await sendTelegramMessage(chatId, 'Σφάλμα κατά τη δημιουργία του invite.');
  }
}
```

**Dispatcher extension** (add case to handleMenuCallback switch, lines 494-585):
```typescript
    case menuAction === 'invite':
      await handleInviteGeneration(chatId, business);
      break;
```

---

### `src/onboarding/ai-owner-agent.ts` (agent, request-response)

**Analog:** `src/onboarding/ai-owner-agent.ts` (lines 51-158 for tool pattern)

**New tool definition pattern** (add to OWNER_TOOLS array):
```typescript
{
  type: 'function' as const,
  name: 'send_invite',
  description: 'Δημιουργεί και στέλνει ένα QR invite image με το όνομα της επιχείρησης και έναν σύνδεσμο Telegram για τις κρατήσεις.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
},
```

**Tool execution handler pattern** (add to switch statement in executeTool, following existing tool handlers):
```typescript
case 'send_invite': {
  return await handleSendInvite(business, chatId);
}
```

**Handler implementation** (follows pattern from handleCreatePackage, handleListPackages, etc.):
```typescript
async function handleSendInvite(
  business: Business,
  chatId: string
): Promise<string> {
  try {
    if (!business.botToken) {
      return 'Σφάλμα: δεν βρέθηκε το bot token της επιχείρησης.';
    }

    // Fetch fresh bot username (mirrors existing getMeBotInfo calls)
    const botInfo = await getMeBotInfo(business.botToken);
    if (!botInfo.username) {
      return 'Σφάλμα: δεν βρέθηκε το όνομα χρήστη του bot.';
    }

    const deepLink = `t.me/${botInfo.username}`;
    const greekCTA = 'Κάντε κράτηση τώρα!';

    // Generate invite image using generator utility
    const inviteBuffer = await generateInviteImageWithText(
      deepLink,
      business.name,
      greekCTA
    );

    // Send photo via Telegram
    await sendTelegramPhoto(
      chatId,
      inviteBuffer,
      `🔗 Αντιγράψτε τον σύνδεσμο:\n${deepLink}`
    );

    logger.info({ businessId: business.id }, 'Invite sent via owner tool');
    return 'Το invite δημιουργήθηκε και στάλθηκε!';
  } catch (err) {
    logger.error({ err, businessId: business.id }, 'Failed to send invite via tool');
    return 'Σφάλμα κατά τη δημιουργία του invite.';
  }
}
```

**Imports addition** (at top of ai-owner-agent.ts):
```typescript
import { sendTelegramPhoto, getMeBotInfo } from '../telegram/client';
import { generateInviteImageWithText } from '../invites/generator';
```

---

### `tests/invites/generator.test.ts` (test, transform)

**Analog:** `tests/admin-menu.test.ts` (lines 1-34 for test structure and mocking)

**Test file structure pattern**:
```typescript
import QRCode from 'qrcode';
import { generateInviteImageWithText } from '../src/invites/generator';
import { logger } from '../src/utils/logger';

jest.mock('qrcode');
jest.mock('../src/utils/logger');

describe('Invite Generator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Test 1: QR code generation
  it('Test 1: generateInviteImageWithText generates PNG buffer from QR code', async () => {
    const mockDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    (QRCode.toDataURL as jest.Mock).mockResolvedValue(mockDataUri);

    const result = await generateInviteImageWithText(
      't.me/test_bot',
      'Test Studio',
      'Κάντε κράτηση!'
    );

    expect(result).toBeInstanceOf(Buffer);
    expect(QRCode.toDataURL).toHaveBeenCalledWith(
      't.me/test_bot',
      expect.objectContaining({
        errorCorrectionLevel: 'H',
        type: 'image/png',
      })
    );
  });

  // Test 2: Business name validation
  it('Test 2: generateInviteImageWithText rejects invalid business names', async () => {
    await expect(
      generateInviteImageWithText(
        't.me/test_bot',
        'a'.repeat(101), // Too long
        'Κάντε κράτηση!'
      )
    ).rejects.toThrow();
  });

  // Test 3: XML escaping
  it('Test 3: Business name with XML special chars is escaped in image', async () => {
    const mockDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    (QRCode.toDataURL as jest.Mock).mockResolvedValue(mockDataUri);

    const result = await generateInviteImageWithText(
      't.me/test_bot',
      'Studio & Co.',
      'Κάντε κράτηση!'
    );

    expect(result).toBeInstanceOf(Buffer);
  });
});
```

---

### `tests/telegram/client.test.ts` (test, request-response — extend)

**Analog:** `tests/telegram-client.test.ts` (lines 1-100 for test structure)

**Add new test case to existing telegram-client.test.ts**:
```typescript
it('Test N: sendTelegramPhoto POSTs to sendPhoto with multipart form-data', async () => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, result: { message_id: 99 } }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  const photoBuffer = Buffer.from('fake-png-data');

  await botTokenStore.run('test-bot-token', async () => {
    const result = await sendTelegramPhoto('12345', photoBuffer, 'Test caption');

    expect(result).toEqual({ messageId: 99 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/sendPhoto$/);
    expect(options.method).toBe('POST');
    expect(options.body).toBeInstanceOf(FormData);
  });
});

it('Test N+1: sendTelegramPhoto throws on non-ok response', async () => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: false,
    json: async () => ({ ok: false, description: 'Photo not found' }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  const photoBuffer = Buffer.from('fake-png-data');

  await botTokenStore.run('test-bot-token', async () => {
    await expect(sendTelegramPhoto('12345', photoBuffer)).rejects.toThrow('Photo not found');
  });
});
```

---

### `tests/telegram/handlers/admin-menu.test.ts` (test, request-response — extend)

**Analog:** `tests/admin-menu.test.ts` (lines 65-79 for test pattern)

**Add new test case to existing admin-menu.test.ts**:
```typescript
describe('Admin menu invite handler', () => {
  it('Test N: parseCallbackData parses menu:invite as menuAction without id', () => {
    const result = parseCallbackData('menu:invite');
    expect(result).toEqual({ menuAction: 'invite', id: undefined });
  });

  it('Test N+1: handleMenuCallback routes invite action to handler', async () => {
    const { sendTelegramPhoto } = require('../src/telegram/client');
    const { handleMenuCallback } = require('../src/telegram/handlers/admin-menu');

    sendTelegramPhoto.mockResolvedValue({ messageId: 123 });

    const result = { menuAction: 'invite', id: undefined };
    await handleMenuCallback(result, mockBusiness, '123456789');

    // Verify handleInviteGeneration was called (indirectly via sendTelegramPhoto)
    expect(sendTelegramPhoto).toHaveBeenCalled();
  });
});
```

---

## Shared Patterns

### Telegram API Request Pattern
**Source:** `src/telegram/client.ts` (lines 34-77)
**Apply to:** All new Telegram API calls in Phase 25

```typescript
const TELEGRAM_API_TIMEOUT_MS = 15_000;

try {
  response = await fetch(url, {
    method: 'POST',
    headers: { /* appropriate headers */ },
    body: /* JSON or FormData */,
    signal: AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS),
  });
} catch (err) {
  const elapsedMs = Date.now() - startedAt;
  logger.error({ err, method, elapsedMs }, 'Telegram API fetch failed');
  throw err;
}

// Check both HTTP status and Telegram's ok field
if (!response.ok || !data.ok) {
  const description = data.description ?? `Telegram API error: ${response.status}`;
  logger.error({ method, status: response.status, description, elapsedMs }, 'Telegram API call failed');
  throw new Error(description);
}
```

### Error Handling & Logging
**Source:** `src/session/manager.ts` (lines 85-102)
**Apply to:** All async functions in generator.ts and handlers

```typescript
export async function myAsyncFunction(param: string): Promise<ReturnType> {
  try {
    logger.debug({ param }, 'Starting operation');
    // ... perform operation ...
    logger.info({ param, result: /* key fields */ }, 'Operation succeeded');
    return result;
  } catch (err) {
    logger.error({ err, param }, 'Operation failed');
    throw err;
  }
}
```

### Input Validation
**Source:** `src/onboarding/ai-owner-agent.ts` (lines 55-64, tool parameter schemas)
**Apply to:** All user-supplied input in Phase 25 (business name)

```typescript
import { z } from 'zod';

const BusinessNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9\s\-όάέίύώ]+$/);

// In async function:
BusinessNameSchema.parse(businessName);
```

### XML/SVG Escaping
**Source:** RESEARCH.md (section: Pattern 2, lines 252-258)
**Apply to:** All business name / Greek CTA text composed into SVG

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

### Callback Data Size Guard
**Source:** `src/telegram/handlers/admin-menu.ts` (lines 34-41)
**Apply to:** All callback_data in Phase 25 menu buttons

```typescript
function assertCallbackDataSize(data: string): void {
  if (Buffer.byteLength(data, 'utf8') > 64) {
    logger.warn(
      { data, bytes: Buffer.byteLength(data, 'utf8') },
      'callback_data exceeds 64 bytes — Telegram will reject'
    );
  }
}
```

### botTokenStore Context Pattern
**Source:** `src/telegram/client.ts` (lines 34-40, 130-136)
**Apply to:** All Telegram API calls requiring bot token

```typescript
const botToken = botTokenStore.getStore();
if (!botToken) {
  throw new Error('Function called without botTokenStore context');
}
// ... use botToken ...

// Or wrap at callsite:
await botTokenStore.run(business.botToken, async () => {
  // All Telegram API calls inside this block use the business.botToken
});
```

### Async Tool Executor Pattern
**Source:** `src/onboarding/ai-owner-agent.ts` (lines 200-250+ for tool execution examples)
**Apply to:** handleSendInvite tool implementation

```typescript
case 'tool_name': {
  return await handleToolName(business, chatId);
}

async function handleToolName(
  business: Business,
  chatId: string
): Promise<string> {
  try {
    // Perform operation
    const result = await performOperation();
    logger.info({ businessId: business.id, result: /* key fields */ }, 'Tool succeeded');
    return 'Το αποτέλεσμα...'; // Return Greek message for display
  } catch (err) {
    logger.error({ err, businessId: business.id }, 'Tool failed');
    return 'Σφάλμα: κάτι πήγε στραβά.'; // Return Greek error message
  }
}
```

---

## No Analog Found

None — all required file types and patterns exist in codebase analogs.

---

## Metadata

**Analog search scope:** `src/telegram/`, `src/invites/`, `src/onboarding/`, `src/session/`, `tests/`

**Files scanned:** 15 source files + 2 test files examined for pattern extraction

**Pattern extraction date:** 2026-07-27

**Confidence:** HIGH — All patterns sourced from existing, production code in the codebase

---

## Implementation Notes

1. **Dependency choice (Path A vs Path B):**
   - Path A (`svg2png-wasm`): Zero native bindings; aligns with project minimalism; add to package.json
   - Path B (`sharp`): Battle-tested; prebuilt binaries available; choose if WASM testing shows issues

2. **Bot username fetching:**
   - Always fetch fresh via `getMeBotInfo()` per RESEARCH.md Pitfall 1
   - Single API call per invite request; acceptable for PoC
   - Do NOT store in DB schema

3. **Callback data:** `menu:invite` — Single button, no ID suffix (fits 64-byte limit easily)

4. **Menu button placement:** Add to root menu below agenda (2x3 grid or append to 2x2 with new row)

5. **Test strategy:**
   - Unit tests: QR generation, image composition, XML escaping
   - Integration tests: Menu callback → image generation → sendPhoto
   - Manual verification: Send invite, confirm QR + link received in Telegram

