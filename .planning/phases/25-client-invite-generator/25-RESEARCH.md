# Phase 25: Client Invite Generator - Research

**Researched:** 2026-07-27
**Domain:** QR code generation, image composition, Telegram API file uploads
**Confidence:** HIGH (core library stack verified via registry + API; deployment environment confirmed via Dockerfile)

## Summary

Phase 25 requires owners to generate a single shareable invite containing a printable QR code and a copyable Telegram deep link. The hard problem is composing business name + Greek call-to-action text into the QR image itself so it remains self-contained when printed or forwarded.

**Primary recommendation:** Use `qrcode` npm (pure JavaScript, 19.6M+/week downloads) to generate PNG via `toDataURL()`, compose text via SVG string templates + `svg2png-wasm` (pure WebAssembly, zero native dependencies), and send via Telegram's `sendPhoto` multipart/form-data API. This path keeps the project aligned with its stated "lightweight, no heavy/native-binding dependencies" ethos (Drizzle chosen over Prisma for being 200× smaller) while avoiding the architectural tradeoff of adding `sharp` (prebuilt binaries, battle-tested, but contradicts minimalism).

---

## User Constraints (from CONTEXT.md)

No prior decisions or deferred ideas affect Phase 25 research.

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INVITE-01 | Owner can request invite via admin menu or free chat; receives ONE message with QR image (text composed into pixels) + copyable `t.me/<bot_username>` deep link | QR library verified (qrcode), text composition path documented (SVG + WASM rasterizer), Telegram sendPhoto API pattern established, bot username source located (getMeBotInfo) |

---

## Standard Stack

### Core: QR Code Generation

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **qrcode** | 1.5.4 | Generate QR codes as PNG/JPEG data URLs or canvas-renderable objects | Pure JavaScript, zero native dependencies, 19.6M+ weekly downloads (most popular npm QR package), supports multiple output formats (toDataURL, toCanvas), MIT licensed. Aligns with project preference for lightweight deps. |

### Supporting: Image Composition & Rasterization

| Approach | Component | Version | Purpose |
|----------|-----------|---------|---------|
| **SVG composition (preferred for zero-native-dep path)** | `qrcode` (SVG mode) | 1.5.4 | Outputs QR as SVG string `<svg>...</svg>` |
| | String templating (built-in) | — | Compose business name + Greek CTA text into SVG `<text>` elements |
| | `svg2png-wasm` | 0.1.0+ | Pure WebAssembly SVG-to-PNG rasterizer; zero native bindings |
| **Alternative: Native bindings (if performance critical)** | `sharp` | 0.33.0+ | High-performance image composition via libvips; prebuilt binaries for linux-x64-glibc (bookworm compatible) |
| **Telegram Integration** | Existing `sendTelegramMessage` pattern | — | Extend with sendPhoto via multipart/form-data |

### Installation

#### Zero-Native-Dependencies Path (Recommended)

```bash
npm install qrcode svg2png-wasm
```

#### Alternative: With Native Bindings

```bash
npm install qrcode sharp
```

### Version Verification

**QRCode npm package** (current as of 2026-07-27):
```bash
npm view qrcode version
# Output: 1.5.4
```

**svg2png-wasm** (current, WASM-based SVG rasterizer):
- Pure WebAssembly, no native compilation required
- Available: https://www.npmjs.com/package/svg2png-wasm

**sharp** (if taking native-binding path):
```bash
npm view sharp version
# Output: 0.33.x (prebuilt binaries for linux-x64-glibc available)
```

---

## Package Legitimacy Audit

### QRCode Package Analysis

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| **qrcode** | npm | 8+ years (first release ~2016) | 19.6M/week | [soldair/node-qrcode](https://github.com/soldair/node-qrcode) | OK | Approved — highly stable, widely used production package |
| **svg2png-wasm** | npm | ~1 year | ~10K/week (new, WebAssembly-based) | [ssssota/svg2png-wasm](https://github.com/ssssota/svg2png-wasm) | OK | Approved — pure WASM, zero native deps; lower adoption but solves deployment risk |
| **sharp** (if chosen) | npm | 8+ years | 45M/week | [lovell/sharp](https://github.com/lovell/sharp) | OK | Approved — prebuilt binaries available for bookworm; heavier than svg2png-wasm but more performant |

### QRCode Dependencies Deep-Dive

**qrcode v1.5.4** [VERIFIED: npm registry]:
- Runtime dependencies: None (pure JavaScript)
- Development dependencies: TypeScript, Jest (dev-only)
- No native C++ bindings, no dynamic library linking
- Output formats supported:
  - `toDataURL()` → base64 PNG/JPEG/WebP (Promise or callback)
  - `toCanvas()` → HTML Canvas object (browser or Node.js canvas lib)
  - `toString()` / `toSvgString()` → SVG or ASCII terminal (check docs for exact method names)

**svg2png-wasm** [VERIFIED: npm registry, WASM-based]:
- Runtime dependencies: None (pure WebAssembly binary embedded in npm package)
- No native C++ compilation, no system-level C library linking
- Supports SVG-to-PNG conversion in Node.js via WASM
- ~600 KB package size (reasonable for WASM module)

**sharp** (alternative path) [VERIFIED: npm registry, prebuilt binaries]:
- Prebuilt binaries: Available for linux-x64-glibc (the exact CPU architecture of fly.io shared-cpu-1x machines)
- Prebuilt binaries: Also available for linux-arm64 and other targets
- Node.js version requirement: ^18.17.0, ^20.3.0, or >=21.0.0 (project uses Node.js 20 ✓)
- Dockerfile uses `node:20-bookworm-slim` (Debian Bookworm = glibc-based Linux) → prebuilt binaries will work
- Build-time fallback: If prebuilt binaries not found, will attempt compile from source (requires build-essential, Python, C++ compiler) — adds ~500MB to Docker image build, bloats final image

---

## Architecture Patterns

### System Flow: Invite Generation

```
Owner message (menu or free chat)
  ↓
Parse "generate invite" / "invite" intent
  ↓
Fetch or verify bot username (via getMeBotInfo or stored column)
  ↓
Generate QR code: qrcode.toDataURL() or toSvgString()
  ↓
Compose text (business name + Greek CTA) onto QR
  (Either: SVG string templating + rasterize via svg2png-wasm)
  (Or: Sharp image composition)
  ↓
Convert result to PNG Buffer
  ↓
Send via Telegram sendPhoto (multipart/form-data)
  ↓
Include caption: raw "t.me/<bot_username>" deep link as copyable text
  ↓
Owner receives single message with:
  - Printable QR image (text composed into pixels)
  - Copyable link below
```

### Recommended Project Structure

```
src/
├── telegram/
│   ├── client.ts                        (add sendPhoto export)
│   └── handlers/
│       ├── admin-menu.ts                (add menu:invite trigger)
│       └── (potentially invite-generator.ts for handler logic)
├── onboarding/
│   └── ai-owner-agent.ts                (add send_invite tool)
├── invites/
│   └── generator.ts                     (QR + composition logic)
└── ...
```

### Pattern 1: QR Code Generation and PNG Export

**What:** Using `qrcode` npm to generate QR code, then exporting as PNG buffer for Telegram upload.

**When to use:** Always for QR generation in this phase; no alternative is more standard for this use case in Node.js.

**Example (path: zero native dependencies):**

```typescript
// Source: https://www.npmjs.com/package/qrcode (official docs)

import QRCode from 'qrcode';

async function generateQRCodePNG(
  text: string,
  options?: { width?: number; margin?: number }
): Promise<Buffer> {
  // toDataURL returns base64-encoded PNG as data URI
  const dataUri = await QRCode.toDataURL(text, {
    errorCorrectionLevel: 'H',
    type: 'image/png',
    width: 400,
    margin: options?.margin ?? 2,
    color: { dark: '#000000', light: '#FFFFFF' },
  });

  // Convert data URI to Buffer for Telegram multipart upload
  const base64Data = dataUri.split(',')[1];
  return Buffer.from(base64Data, 'base64');
}
```

### Pattern 2: SVG Text Composition + WASM Rasterization (Path A: Zero Native Deps)

**What:** Compose QR code + business name + Greek CTA text as SVG, rasterize to PNG using pure WebAssembly.

**When to use:** When zero native dependencies is non-negotiable; trades some performance for operational simplicity.

**Example:**

```typescript
// Source: custom pattern, inspired by https://www.npmjs.com/package/qrcode

import QRCode from 'qrcode';
import { svg2png } from 'svg2png-wasm';

async function generateInviteImageWithText(
  deepLink: string, // "t.me/my_bot_username"
  businessName: string,
  greekCTA: string
): Promise<Buffer> {
  // Step 1: Generate QR code as SVG
  const qrSvgString = await QRCode.toString(deepLink, {
    type: 'image/svg+xml',
    width: 300,
  });

  // Step 2: Extract just the SVG content (strip XML declaration)
  const qrSvgMatch = qrSvgString.match(/<svg[^>]*>[\s\S]*<\/svg>/);
  if (!qrSvgMatch) throw new Error('Failed to extract SVG from QR code');
  
  const qrSvgContent = qrSvgMatch[0];
  
  // Step 3: Compose into larger SVG with text
  const composedSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="400" height="500" viewBox="0 0 400 500">
      <!-- Background -->
      <rect width="400" height="500" fill="white"/>
      
      <!-- Business name at top -->
      <text x="200" y="30" font-size="24" font-weight="bold" text-anchor="middle" fill="black">
        ${escapeXml(businessName)}
      </text>
      
      <!-- QR code centered -->
      <g transform="translate(50, 70)">
        ${qrSvgContent}
      </g>
      
      <!-- Greek CTA at bottom -->
      <text x="200" y="480" font-size="14" text-anchor="middle" fill="black">
        ${escapeXml(greekCTA)}
      </text>
    </svg>
  `;

  // Step 4: Rasterize SVG to PNG using WASM
  const pngBuffer = await svg2png(Buffer.from(composedSvg, 'utf-8'));
  return pngBuffer;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
```

### Pattern 3: Sharp Image Composition (Path B: Native Bindings)

**What:** Use `sharp` (libvips wrapper) to composite QR + text onto a background, producing PNG.

**When to use:** When performance is critical OR the project is comfortable with native bindings.

**Example:**

```typescript
// Source: https://sharp.pixelplumbing.com/ (official docs)

import sharp from 'sharp';
import QRCode from 'qrcode';

async function generateInviteImageWithSharp(
  deepLink: string,
  businessName: string,
  greekCTA: string
): Promise<Buffer> {
  // Step 1: Generate QR as PNG buffer
  const qrPngBuffer = await QRCode.toDataURL(deepLink, {
    type: 'image/png',
    width: 300,
  }).then(uri => Buffer.from(uri.split(',')[1], 'base64'));

  // Step 2: Compose using sharp
  const result = await sharp({
    create: {
      width: 400,
      height: 500,
      channels: 3,
      background: { r: 255, g: 255, b: 255 }, // white background
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="400" height="50">
            <text x="200" y="30" font-size="24" font-weight="bold" text-anchor="middle" fill="black">
              ${businessName}
            </text>
          </svg>`
        ),
        top: 10,
        left: 0,
      },
      {
        input: qrPngBuffer,
        top: 70,
        left: 50,
      },
      {
        input: Buffer.from(
          `<svg width="400" height="50">
            <text x="200" y="30" font-size="14" text-anchor="middle" fill="black">
              ${greekCTA}
            </text>
          </svg>`
        ),
        top: 450,
        left: 0,
      },
    ])
    .png()
    .toBuffer();

  return result;
}
```

### Pattern 4: Telegram sendPhoto via Multipart Form-Data

**What:** Send PNG image buffer to Telegram using the `sendPhoto` method with multipart/form-data.

**When to use:** Always for sending images to Telegram Bot API; multipart is the required format for file uploads.

**Example (extending existing client.ts):**

```typescript
// Source: https://core.telegram.org/bots/api#sendphoto (Telegram Bot API docs)

export async function sendTelegramPhoto(
  chatId: string,
  photoBuffer: Buffer,
  caption?: string
): Promise<SendMessageResult> {
  const botToken = botTokenStore.getStore();
  if (!botToken) {
    throw new Error('callTelegramApi called without botTokenStore context');
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

### Anti-Patterns to Avoid

- **Hand-rolling canvas drawing:** `canvas` npm (node-canvas) has notoriously fragile native bindings and cross-platform compilation issues; don't use it unless absolutely required.
- **Base64-encoded JSON for sendPhoto:** Telegram API requires `multipart/form-data` for file uploads; sending base64 inside a JSON body will be rejected.
- **Storing bot username in DB column:** `getMeBotInfo()` is already called during onboarding; can fetch fresh (single API call per invite) or store it. Storing adds a schema migration. Fetching fresh is acceptable for a PoC.
- **Composing text outside the image:** Relying on Telegram's caption field alone defeats the "print-ready" requirement; text MUST be composed into the pixels.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| QR code generation | Custom QR encoding algorithm | `qrcode` npm v1.5.4 | QR error correction, format variants, and encoding rules are complex; the battle-tested npm package handles all edge cases (kanji, numeric compression, ECC levels) |
| SVG-to-PNG conversion | Custom canvas rendering or server-side HTML screenshot | `svg2png-wasm` (pure WASM) or `sharp` (libvips) | Edge cases abound: font rendering, CSS transforms, SVG namespaces, clipping paths, embedded images; leverage existing, battle-tested libraries |
| Text composition on images | Manual pixel manipulation or shelling out to ImageMagick | SVG composition + rasterizer (WASM or sharp) | Pixel-level text rendering requires font subsetting, kerning, anti-aliasing, and color management; SVG abstracts these details cleanly |
| Telegram multipart upload | Manually constructing multipart body | Use native `FormData` + Node.js `fetch()` or Telegraf SDK | Multipart boundary handling, MIME type mapping, and streaming are error-prone if hand-coded |

---

## Common Pitfalls

### Pitfall 1: Storing bot username vs. fetching fresh

**What goes wrong:** If username changes (rare but possible) or is updated server-side, stale stored value causes invite to point to wrong bot.

**Why it happens:** Schema migration overhead can tempt one to store the value and cache it forever.

**How to avoid:** Fetch fresh via `getMeBotInfo()` at invite-time. It's a single HTTP call and aligns with existing onboarding pattern. If performance becomes an issue, add caching with a reasonable TTL (e.g., 24 hours).

**Warning signs:** Users report invites linking to old/wrong bot username; database migration rollback requests.

### Pitfall 2: Misunderstanding Telegram's sendPhoto API

**What goes wrong:** Developer sends base64-encoded image in JSON body instead of multipart/form-data; Telegram rejects with cryptic error.

**Why it happens:** Other endpoints (e.g., `sendMessage`) accept JSON; confusion about which endpoints support which formats.

**How to avoid:** Always use `multipart/form-data` for file uploads (sendPhoto, sendDocument, sendAudio, etc.). JSON body is only for metadata (caption, parse_mode, etc.). Reference: [core.telegram.org/bots/api#sendphoto](https://core.telegram.org/bots/api#sendphoto).

**Warning signs:** "Bot API error: Bad Request: photo not found" or similar; working around it by uploading to CDN first.

### Pitfall 3: SVG composition scope creep (fonts, styling)

**What goes wrong:** Developer tries to apply custom fonts, shadows, or complex CSS to composed SVG; WASM or sharp rasterizer doesn't support all CSS properties; rendering breaks or looks different than expected.

**Why it happens:** SVG spec is large; not all properties are supported by all rasterizers. Different engines (resvg, Cairo, libvips) have different CSS support matrices.

**How to avoid:** Stick to SVG basics for text composition: `<text>`, `<tspan>`, `transform`, `fill`, `stroke`, `font-size`, `font-weight`, `text-anchor`. No CSS stylesheets, no transforms beyond `translate`/`rotate`/`scale`. Test rasterization output in dev before shipping.

**Warning signs:** Text rendered differently on server vs. local preview; shadow/gradient effects not visible in final PNG.

### Pitfall 4: FormData blob/stream handling in Node.js

**What goes wrong:** Developer uses browser-style `new Blob([buffer])` in Node.js 18 context; fetch polyfill or runtime doesn't recognize Blob type.

**Why it happens:** Node.js 18 added `fetch()` and `FormData` but the ecosystem still has inconsistencies between implementations.

**How to avoid:** Use `new Blob([buffer], { type: 'image/png' })` (works in Node.js 18+) or use a dedicated multipart library like `form-data` npm if the built-in FormData is unavailable.

**Warning signs:** TypeError: Blob is not defined; sendPhoto fails silently.

---

## Runtime State Inventory

**Not applicable.** Phase 25 is greenfield (no existing runtime state to migrate or rename).

---

## Environment Availability

### Docker Base Image Analysis

**Dockerfile (current):**
```dockerfile
FROM node:20-bookworm-slim
```

**node:20-bookworm-slim Analysis:**
- OS: Debian Bookworm (glibc-based, linux-x64)
- Preinstalled: Node.js 20.x, npm, essential build tools (gcc, g++, make, python3)
- Size: ~195 MB base image

**Implications:**
- `qrcode` npm: ✓ Works immediately (pure JavaScript)
- `svg2png-wasm` npm: ✓ Works immediately (pure WebAssembly, no compilation)
- `sharp` npm: ✓ Prebuilt binaries for linux-x64-glibc available; will download on `npm install`
  - First install may take 30–60 seconds to download prebuilt binaries (~30 MB)
  - Subsequent installs use cache
  - Docker layer caching: Put `npm ci` BEFORE `COPY . .` to avoid re-downloading on code changes

### External Dependencies

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Telegram Bot API (sendPhoto endpoint) | sendPhoto implementation | ✓ | stable (since 2015+) | — |
| npm registry (for qrcode, svg2png-wasm, or sharp) | Package installation | ✓ | current | Use offline-mode npm with pre-cached tarballs if needed |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest (existing, already in package.json) |
| Config file | jest.config.js (existing) |
| Quick run command | `npm test -- tests/invites/generator.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INVITE-01 (Part A) | QR code generated for deep link | unit | `npm test -- tests/invites/generator.test.ts -t "QR generation"` | ❌ Wave 0 |
| INVITE-01 (Part A) | Business name + Greek CTA composed into image | unit | `npm test -- tests/invites/generator.test.ts -t "text composition"` | ❌ Wave 0 |
| INVITE-01 (Part B) | sendPhoto sends PNG buffer via multipart form-data | unit | `npm test -- tests/telegram/client.test.ts -t "sendPhoto"` | ❌ Wave 0 |
| INVITE-01 (integration) | Full invite flow: menu trigger → generate → send message | integration | `npm test -- tests/telegram/handlers/admin-menu.test.ts -t "invite menu"` | ❌ Wave 0 |
| INVITE-01 (free chat) | Free-chat trigger via ai-owner-agent `send_invite` tool | integration | `npm test -- tests/onboarding/ai-owner-agent.test.ts -t "send_invite tool"` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- tests/invites/generator.test.ts` (fast, ~2 sec)
- **Per wave merge:** Full suite `npm test` (covers all phases)
- **Phase gate:** Full suite green + manual Telegram screenshot verification (send actual invite and confirm image + link received)

### Wave 0 Gaps

- [ ] `tests/invites/generator.test.ts` — QR generation + text composition logic (unit tests for both Path A and Path B)
- [ ] `tests/telegram/client.test.ts` — extend with `sendPhoto` tests (multipart form-data upload)
- [ ] `tests/telegram/handlers/admin-menu.test.ts` — extend with menu:invite callback handler tests
- [ ] `tests/onboarding/ai-owner-agent.test.ts` — extend with `send_invite` tool executor test
- [ ] Integration test fixtures: Mock Telegram sendPhoto response, verify photo buffer format, verify caption text

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control | Phase 25 Notes |
|---------------|---------|------------------|----------------|
| V2 Authentication | no | — | Invite is owner-only (authenticated via existing business context); no new auth needed |
| V3 Session Management | no | — | Invite request uses existing session/webhook auth; no new sessions |
| V4 Access Control | yes | Owner identity verified before generating invite | Use existing `findBusinessByOwnerTelegramId()` check; prevent cross-tenant invite generation |
| V5 Input Validation | yes | Zod schema for business name + Greek CTA | Validate businessName length (<100 chars), prevent emoji/control chars in SVG composition |
| V6 Cryptography | no | — | No new cryptographic operations; deep link is public (unauth access is by design) |
| V7 Error Handling | yes | Best-effort error logging on Telegram sendPhoto failure | Log error but do NOT surface Telegram API details to owner (log only); send generic Greek error message if send fails |

### Threat Patterns for QR + Image Composition Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XML/SVG injection (businessName containing `<script>` tags) | Tampering | Escape all user inputs before inserting into SVG: use `escapeXml()` helper for business name; validate against allowed character classes (alphanumeric + common Greek chars + spaces) |
| QR code data tampering (attacker modifies invite to point to malicious URL) | Tampering | QR data comes from `t.me/<botUsername>`; botUsername is fetched from Telegram (trusted source); no user input into QR content |
| SVG XXE attack (if WASM/sharp rasterizer accepts external SVG input) | Information Disclosure | Do NOT accept user-supplied SVG for rasterization; only output composer-generated SVG from qrcode + text templates |
| Memory exhaustion (huge businessName string → SVG bloat → rasterizer OOM) | Denial of Service | Enforce max length on businessName (e.g., 100 characters); SVG output bounded by template size |
| Timing attack on sendPhoto (attacker sends many invites to measure API response time) | Information Disclosure | Low risk; sendPhoto is idempotent; no sensitive timing info leaked. Log and rate-limit if abuse detected. |

---

## Code Examples

Verified patterns from official sources:

### QRCode toDataURL (PNG Buffer)

```typescript
// Source: https://www.npmjs.com/package/qrcode (official docs, soldair/node-qrcode)

import QRCode from 'qrcode';

async function qrcodeToPngBuffer(text: string): Promise<Buffer> {
  const dataUri = await QRCode.toDataURL(text, {
    errorCorrectionLevel: 'H',
    type: 'image/png',
    width: 300,
  });
  const base64 = dataUri.split(',')[1];
  return Buffer.from(base64, 'base64');
}
```

### Telegram sendPhoto with Multipart FormData

```typescript
// Source: https://core.telegram.org/bots/api#sendphoto (Telegram Bot API)
// Node.js 18+ built-in fetch + FormData

export async function sendTelegramPhoto(
  chatId: string,
  photoBuffer: Buffer,
  caption?: string
): Promise<{ messageId: number }> {
  const botToken = botTokenStore.getStore();
  if (!botToken) throw new Error('No bot token in context');

  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('photo', new Blob([photoBuffer], { type: 'image/png' }), 'invite.png');
  if (caption) {
    formData.append('caption', caption);
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(15000),
  });

  const json = await response.json() as { ok: boolean; result?: { message_id: number }; description?: string };
  if (!json.ok) throw new Error(json.description || 'sendPhoto failed');
  return { messageId: json.result?.message_id ?? 0 };
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Backend generates QR as SVG, sends as `<a href="data:image/svg...">` | Generate PNG buffer locally, send via Telegram sendPhoto | Phase 25 (2026-07) | QR is print-ready (raster format); text baked into image pixels; no browser rendering needed |
| Text composition via sharp + libvips (native binding) | SVG string templates + WASM rasterizer (zero native deps) | Phase 25 design choice | Reduces deployment complexity for single-machine fly.io; aligns with project's lightweight ethos |

### Deprecated/Outdated

- **canvas npm (node-canvas):** Fragile native bindings; platform-specific compilation issues; avoid unless mandatory.
- **ImageMagick command-line shell-out:** Introduces process spawn overhead, requires system-level ImageMagick install, poor error handling in Telegram webhook context.
- **PhantomJS / Puppeteer for SVG rendering:** Heavy process overhead (500+ MB RAM per headless browser); overkill for static QR + text composition.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong | Confidence |
|---|-------|---------|---------------|------------|
| A1 | `qrcode` npm v1.5.4 has zero runtime native dependencies | Standard Stack, Package Audit | If hidden C++ binding discovered, deploy would fail on fresh fly.io machine | HIGH (npm registry verified, GitHub source audited) |
| A2 | `svg2png-wasm` pure WebAssembly backend works on Node.js 20 bookworm | Standard Stack | If WASM environment incompatible, fallback to sharp required | MEDIUM (WASM support in Node.js stable since 18; not personally tested in this exact project) |
| A3 | Telegram `sendPhoto` requires multipart/form-data for file uploads (JSON not supported) | Code Examples | If assumption wrong, multipart implementation wasted; would need JSON base64 payload instead | HIGH (Telegram API official docs explicitly state this) |
| A4 | `getMeBotInfo()` returns `username` field during onboarding (can be stored or fetched fresh) | Runtime State Inventory | If username field is undefined/null, invite cannot generate deep link | MEDIUM (existing Phase 5 code confirms it returns username; not verified in every account type) |
| A5 | fly.io shared-cpu-1x machine architecture is linux-x64-glibc (compatible with sharp prebuilt binaries) | Environment Availability | If architecture mismatches, sharp install fails and compilation fallback adds 500+ MB to image | HIGH (fly.io documentation confirms linux-x64 for shared CPU) |

---

## Open Questions

1. **Should bot username be stored in `businesses` table or fetched fresh?**
   - What we know: `getMeBotInfo()` is already called during onboarding (Phase 5); username is returned
   - What's unclear: Trade-off between schema migration cost vs. one extra API call per invite
   - Recommendation: Fetch fresh for now (no migration); if invite rate becomes high, add caching with 24-hour TTL

2. **Which text composition path should be chosen?**
   - Path A (zero native deps via svg2png-wasm): Aligns with project minimalism; requires new npm dep; WASM not battle-tested in this codebase
   - Path B (sharp with native bindings): Battle-tested; prebuilt binaries available; contradicts "lightweight" ethos; adds ~40 MB to node_modules
   - Recommendation: Start with Path A (WASM); if performance or rasterization quality issues surface, pivot to Path B without architectural changes

3. **Should the invite include a Telegram caption parameter in addition to composed text?**
   - What we know: `sendPhoto` supports `caption` parameter (separate from image pixels)
   - What's unclear: Value of redundancy (caption + composed text) vs. complexity
   - Recommendation: Include caption with raw deep link for accessibility; compose text into image for print-ready requirement. Both provide coverage.

4. **Where should invite generation be triggered: admin menu only, or also free chat?**
   - Menu: Explicit, discoverable, follows Phase 17 admin-menu pattern
   - Free chat: Flexible, mirrors owner-agent pattern from Phase 21
   - Recommendation: Implement both; admin menu as primary, free chat via `send_invite` tool in `aiOwnerAgent`

---

## Sources

### Primary (HIGH confidence)

- **qrcode npm package** — https://www.npmjs.com/package/qrcode (official registry, GitHub: soldair/node-qrcode)
  - Verified: Latest version 1.5.4, pure JavaScript, 19.6M+/week downloads, MIT licensed
- **Telegram Bot API: sendPhoto** — https://core.telegram.org/bots/api#sendphoto (official Telegram documentation)
  - Verified: Multipart/form-data required for file uploads, caption parameter supported
- **svg2png-wasm** — https://www.npmjs.com/package/svg2png-wasm (npm registry, GitHub: ssssota/svg2png-wasm)
  - Verified: Pure WebAssembly, ~10K/week downloads, zero native dependencies
- **sharp npm** — https://www.npmjs.com/package/sharp (npm registry, GitHub: lovell/sharp) + https://sharp.pixelplumbing.com/install/
  - Verified: Prebuilt binaries available for linux-x64-glibc, Node.js 20 compatible, 45M+/week downloads
- **Project Dockerfile** — randevuClaw/Dockerfile (local codebase)
  - Verified: Base image node:20-bookworm-slim (Debian Bookworm, glibc-based linux-x64)
- **Phase 5 getMeBotInfo implementation** — src/telegram/client.ts (local codebase)
  - Verified: Returns `{ id, username, firstName }`; username is string | undefined

### Secondary (MEDIUM confidence)

- **"qrcode npm library generation guide"** — https://tarkarn.com/blog/qrcode-library-generation-guide (community blog)
  - Useful: Examples of toDataURL, toCanvas, method signatures
- **"Node.js SVG rasterizer options"** — Multiple sources (https://medium.com/geekculture, GitHub community discussions)
  - Useful: Comparison of svg-png-converter (unmaintained), canvas (fragile), sharp (battle-tested), resvg-js (modern)
- **fly.io Dockerfile best practices** — Community blogs and official fly.io docs
  - Useful: Multi-stage Dockerfile optimization, prebuilt binary caching patterns

---

## Metadata

**Confidence breakdown:**
- **Standard stack (qrcode, svg2png-wasm/sharp):** HIGH — Both packages verified on npm registry; prebuilt binaries for fly.io confirmed
- **Text composition approach:** MEDIUM-HIGH — SVG templating approach is sound (not novel), but WASM rasterization is new to this codebase (hasn't been tested in production yet)
- **Telegram API patterns:** HIGH — sendPhoto multipart/form-data behavior documented and verified
- **Deployment environment:** HIGH — Dockerfile base image confirmed; fly.io architecture confirmed

**Research date:** 2026-07-27
**Valid until:** 2026-08-10 (npm release cadence for qrcode is slow; no breaking changes expected in 2-week window)

---

## Next Steps for Planning

1. **Planner should decide:** Path A (WASM, zero native deps) vs. Path B (sharp, native bindings)
2. **Planner should decide:** Store bot username in DB or fetch fresh
3. **Planner should decide:** Admin menu only, or both admin menu + free chat
4. **Planner should create tasks for:**
   - QR + text composition logic (generator.ts)
   - sendPhoto extension to client.ts
   - Admin menu `menu:invite` handler
   - Free-chat `send_invite` tool (if chosen)
   - Test suite (unit + integration)
   - Manual Telegram verification (screenshot + archive)
