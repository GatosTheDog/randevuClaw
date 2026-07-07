# Phase 1: Foundation, Webhook & Business Resolution - Pattern Map

**Mapped:** 2026-07-07  
**Repository Status:** Greenfield (no existing source code)  
**Files analyzed:** 18 new files across core app, database, utilities, config, and tests  
**Analogs found:** 0 / 18 (no existing codebase to match against)

---

## Executive Summary

This is a **greenfield repository** — RandevuClaw has no prior source code, only `.planning/` artifacts. As a result, there are **no existing code analogs** to pattern-match against. All files in this phase must be built from first principles, following the patterns described in RESEARCH.md and the locked decisions in CONTEXT.md.

However, the RESEARCH.md file contains comprehensive code examples and architectural patterns that the planner and executor should reference directly. This PATTERNS.md document maps each new file to its intended role and data flow, lists the patterns it should follow (from RESEARCH.md), and identifies where shared cross-cutting patterns apply.

---

## File Classification

| New File | Role | Data Flow | Analog in Codebase | Notes |
|----------|------|-----------|-------------------|-------|
| `src/server.ts` | config (app entry) | request-response | ❌ None | Express app initialization; webhook route setup; entry point for fly.io |
| `src/webhooks/whatsapp.ts` | controller | request-response | ❌ None | Webhook handler: signature verification, payload parsing, routing to business resolver |
| `src/business/resolver.ts` | service/utility | transform | ❌ None | Business code extraction & Greek diacritic normalization; no I/O, pure function |
| `src/consent/checker.ts` | service | CRUD | ❌ None | First-contact detection; consent flag upsert via database queries |
| `src/database/schema.ts` | model | schema | ❌ None | Drizzle ORM table definitions: businesses, messages, client_business_relationships |
| `src/database/seed.ts` | utility | batch | ❌ None | Fixture data loader; creates two test businesses via Drizzle seed API |
| `src/database/queries.ts` | service | CRUD | ❌ None | Typed query helpers: find business by slug, insert message, check client-business relationship |
| `src/whatsapp/client.ts` | service | request-response | ❌ None | WhatsApp Cloud API wrapper; sends replies via WhatsApp-Nodejs-SDK |
| `src/utils/validation.ts` | utility | transform | ❌ None | Zod schema definitions for webhook payload, environment variables, business code input |
| `src/utils/logger.ts` | utility | transform | ❌ None | Pino logger setup and initialization; structured logging to stdout |
| `src/utils/diacritics.ts` | utility | transform | ❌ None | Greek diacritic stripping wrapper around `remove-accents` npm package |
| `src/config.ts` | config | transform | ❌ None | Environment variable loading; centralized config object with defaults |
| `migrations/0001_initial_schema.sql` | migration | batch | ❌ None | Drizzle-generated (or manually written) SQL schema initialization |
| `jest.config.js` | config | transform | ❌ None | Jest test runner configuration; module resolution, coverage thresholds |
| `package.json` | config | transform | ❌ None | npm dependency manifest; scripts (start, dev, test, seed, migrate) |
| `tsconfig.json` | config | transform | ❌ None | TypeScript compiler configuration; path aliases, target version (Node 20+) |
| `fly.toml` | config | transform | ❌ None | fly.io deployment configuration; app name, region, environment variables |
| `.env.local` (example) | config | transform | ❌ None | Development environment variables; not committed; example provided as `.env.example` |

**Test Files:**

| Test File | Role | Data Flow | Analog in Codebase |
|-----------|------|-----------|-------------------|
| `tests/webhook.test.ts` | test | request-response | ❌ None |
| `tests/business-resolver.test.ts` | test | transform | ❌ None |
| `tests/idempotency.test.ts` | test | CRUD | ❌ None |
| `tests/consent.test.ts` | test | CRUD | ❌ None |
| `tests/fixtures.test.ts` | test | batch | ❌ None |

---

## Pattern Assignments by File

Since there are no existing analogs, each file will follow the **patterns and code examples from RESEARCH.md** (§ Code Examples and Architecture Patterns sections) and the locked decisions from CONTEXT.md. Below is the mapping of each file to the relevant pattern sections in RESEARCH.md.

### `src/server.ts` (config, request-response)

**Pattern source:** RESEARCH.md § "Pattern 5: Webhook Handler Entry Point (Express)"

**Purpose:** Initialize Express app, register webhook routes, start HTTP server for fly.io.

**Key responsibilities:**
- Bind `/webhooks/whatsapp` GET endpoint (webhook verification)
- Bind `/webhooks/whatsapp` POST endpoint (message events, with raw body middleware)
- Export app for testing and startup

**Template to follow:**
```typescript
// Express app initialization
// - Middleware setup (raw body for webhook, JSON for other routes)
// - Route registration (GET for verification, POST for events)
// - Error handling middleware (log, return generic 500)
// - Server startup on process.env.PORT || 3000

import express from 'express';
import webhookRouter from './webhooks/whatsapp';

const app = express();
// ... middleware setup ...
app.use('/webhooks/whatsapp', webhookRouter);
// ... error handling ...

export default app;

// In separate entry file (e.g. src/index.ts):
// app.listen(process.env.PORT || 3000, () => { ... });
```

---

### `src/webhooks/whatsapp.ts` (controller, request-response)

**Pattern sources:**
- RESEARCH.md § "Pattern 1: Webhook Signature Verification"
- RESEARCH.md § "Pattern 5: Webhook Handler Entry Point (Express)"
- RESEARCH.md § Code Examples: "WhatsApp Webhook Signature Verification"

**Purpose:** Handle incoming WhatsApp messages; verify signature, parse payload, route to business/consent/reply logic.

**Key responsibilities:**
1. **GET handler:** Return `hub.challenge` if token matches (webhook verification)
2. **POST handler:**
   - Extract raw body before JSON parsing
   - Verify `X-Hub-Signature-256` header using `crypto.timingSafeEqual()`
   - Parse JSON payload
   - Validate with Zod schema (extract message, sender phone, message ID)
   - Extract business code from message text (call resolver)
   - Look up business by normalized code
   - Check consent status for (phone, business) pair
   - Send reply via WhatsApp API
   - Mark message processed in database (after reply succeeds)
   - Return HTTP 200

**Error handling:**
- Signature verification fails → HTTP 403
- Parsing fails → HTTP 400
- Business not found → Send "not found" reply, return HTTP 200
- Reply send fails → Log error, return HTTP 200 (ack to Meta, queue retry for Phase 2)
- Database error → Log error, return HTTP 200

**Dedup logic:**
- Try to insert message with `onConflictDoNothing()`
- If insert was silently ignored (duplicate), log it and return HTTP 200 with no further processing

---

### `src/business/resolver.ts` (utility, transform)

**Pattern source:** RESEARCH.md § "Pattern 2: Business Code Extraction & Normalization"

**Purpose:** Extract business code from message text; normalize and validate.

**Key responsibilities:**
- Regex extraction of slug-like pattern from message text (e.g., `pilates-athens`)
- Normalize: lowercase, trim, strip Greek diacritics, standardize hyphens
- Return normalized code or empty string if no match found

**Template:**
```typescript
// Pure function, no I/O
// Uses remove-accents to handle Greek diacritics (ά, ί, ό, ώ)
// Input: message text (may contain Greek, mixed case, various punctuation)
// Output: normalized slug or empty string

import removeAccents from 'remove-accents';

export function extractAndNormalizeBusinessCode(text: string): string {
  // Find slug-like pattern (letters, numbers, hyphens)
  // Remove accents, lowercase, trim, standardize hyphens
  // Return result
}
```

---

### `src/consent/checker.ts` (service, CRUD)

**Pattern source:** RESEARCH.md § "Pattern 4: First-Contact Consent Tracking"

**Purpose:** Detect first-contact for (phone, business) pair; manage consent flag and timestamp.

**Key responsibilities:**
- Query `client_business_relationships` for (businessId, senderPhone) pair
- If exists: return `isFirstContact: false` and current `consentGiven` status
- If missing: INSERT new row with `consentGiven: true` (implied consent per D-10), return `isFirstContact: true`
- Handle UNIQUE constraint gracefully (rare race condition: two requests for same pair simultaneously)

**Template:**
```typescript
// Uses drizzle-orm for database access
// Handles upsert logic: check existence, INSERT if missing

export async function getOrCreateClientRelationship(
  businessId: number,
  senderPhone: string
): Promise<{ isFirstContact: boolean; consentGiven: boolean }> {
  // Query existing relationship
  // If not found, insert new row
  // Return status
}
```

---

### `src/database/schema.ts` (model, schema)

**Pattern source:** RESEARCH.md § "Pattern 3" and Code Examples § "Drizzle Schema: Messages & Client-Business Relationships"

**Purpose:** Define Drizzle ORM table schemas for businesses, messages, and client-business relationships.

**Key tables:**

1. **businesses** (id, name, slug, phoneNumberId?, createdAt)
   - `slug` is UNIQUE and the dedup key for business lookup
   - `phoneNumberId` optional (for future WhatsApp Business Account integration)

2. **messages** (id, whatsappMessageId, businessId, senderPhone, messageBody, status, createdAt)
   - `whatsappMessageId` is UNIQUE (dedup key for idempotency)
   - `status`: 'received' | 'processed' (set to 'processed' after reply succeeds)
   - `businessId` foreign key to businesses table

3. **client_business_relationships** (id, businessId, senderPhone, consentGiven, consentTimestamp, createdAt)
   - Composite UNIQUE index on (businessId, senderPhone)
   - `consentGiven`: boolean, default true (implied consent per D-10)
   - `consentTimestamp`: timestamp of first contact (immutable)
   - First-contact detection: if pair doesn't exist, it's first contact

**Additional considerations:**
- Add `references()` foreign keys from messages and relationships to businesses
- Use Drizzle's `timestamp().notNull().defaultNow()` for createdAt columns
- No RLS yet (deferred to Phase 4 per D-13); app-level filtering will enforce isolation

---

### `src/database/seed.ts` (utility, batch)

**Pattern source:** RESEARCH.md § "Fixture Businesses & Tenant Isolation" (D-14, D-15, D-16)

**Purpose:** Seed exactly two fixture businesses for testing business resolution.

**Key responsibilities:**
- Use Drizzle's seed API or a script function
- Create exactly two businesses with name + slug only (no hours/services/prices yet)
- Example: "Pilates Athens" → slug "pilates-athens"; "Hair Salon Athens" → slug "hair-salon-athens"
- Run via `npm run db:seed`
- Idempotent: safe to re-run; check for existing slugs before inserting

**Template:**
```typescript
// Use Drizzle seed or a standalone function
// Insert two fixture businesses
// Verify they were created with correct slugs
// Log confirmation

export async function seed() {
  // Query existing fixtures
  // If missing, insert them
  // Log results
}
```

---

### `src/database/queries.ts` (service, CRUD)

**Purpose:** Typed query helpers; abstraction layer over Drizzle for webhook handler.

**Key queries:**
1. `findBusinessBySlug(slug: string)` → Business | null
2. `insertMessage(whatsappMessageId, businessId, senderPhone, messageBody)` → 'inserted' | 'ignored'
3. `markMessageProcessed(whatsappMessageId)` → void
4. `findClientBusinessRelationship(businessId, senderPhone)` → relationship | null
5. `insertClientBusinessRelationship(businessId, senderPhone)` → relationship (with timestamp)

**Template:**
```typescript
// Import schema, db connection
// Define async functions for each query
// Use Drizzle methods: select().from().where(), insert().values().onConflictDoNothing(), etc.
// Return typed results
// Error handling: throw application errors (to be caught by webhook handler)
```

---

### `src/whatsapp/client.ts` (service, request-response)

**Purpose:** WhatsApp Cloud API wrapper; abstracts message sending.

**Key responsibilities:**
- Accept message parameters (recipient phone, text, businessId)
- Call WhatsApp-Nodejs-SDK or raw HTTP to POST /messages
- Handle response: extract message_id, verify success
- Return status or throw error
- Respect 24-hour conversation window (Phase 1 only sends replies, within window)

**Template:**
```typescript
// Use WhatsApp-Nodejs-SDK if available, else raw fetch
// sendMessage(recipientPhone: string, text: string, businessId?: number)
// Return { messageId: string; status: string }
// Throw on error (webhook handler catches and queues retry)
```

---

### `src/utils/validation.ts` (utility, transform)

**Pattern source:** RESEARCH.md § "Pattern 5" and Common Pitfalls § "Pitfall 5: WhatsApp Webhook Payload Parsing"

**Purpose:** Zod schemas for runtime validation of webhook payloads and environment variables.

**Key schemas:**
1. **WhatsAppWebhookPayload** — Full payload structure (entry, changes, messages array, sender phone, message ID, text.body)
2. **MessageInput** — Business code and message text from client
3. **EnvironmentVariables** — APP_SECRET, WEBHOOK_VERIFY_TOKEN, DATABASE_URL, etc.
4. **BusinessCodeInput** — Validated business code string

**Template:**
```typescript
// import { z } from 'zod';
// 
// export const WhatsAppWebhookPayloadSchema = z.object({
//   entry: z.array(z.object({
//     changes: z.array(z.object({
//       value: z.object({
//         messages: z.array(z.object({
//           id: z.string(),
//           from: z.string(),
//           type: z.enum(['text', 'image', 'button']),
//           text: z.object({ body: z.string() }).optional(),
//         })),
//       }),
//     })),
//   })),
// });
//
// export function validateWebhookPayload(data: unknown) {
//   return WhatsAppWebhookPayloadSchema.parse(data);
// }
```

---

### `src/utils/logger.ts` (utility, transform)

**Pattern source:** RESEARCH.md § "Standard Stack: Utilities & Config" (Pino)

**Purpose:** Structured logging setup; abstracts Pino configuration.

**Key responsibilities:**
- Initialize Pino logger with fly.io-friendly defaults
- Log to stdout (for aggregation)
- Include request ID (if available) for tracing
- Provide logger instance for import across codebase

**Template:**
```typescript
// import pino from 'pino';
// 
// export const logger = pino({
//   level: process.env.LOG_LEVEL || 'info',
//   // fly.io friendly: log to stdout
//   transport: { target: 'pino-pretty', options: { colorize: false } },
// });
//
// export default logger;
```

---

### `src/utils/diacritics.ts` (utility, transform)

**Pattern source:** RESEARCH.md § "Pattern 2: Business Code Extraction & Normalization"

**Purpose:** Wrapper around `remove-accents` for Greek diacritic stripping.

**Key responsibilities:**
- Accept string (may contain Greek accented characters)
- Return normalized string (accents removed)
- Handle edge cases: combining diacritics, various Unicode forms

**Template:**
```typescript
// import removeAccents from 'remove-accents';
//
// export function stripGreekDiacritics(text: string): string {
//   return removeAccents(text);
// }
```

---

### `src/config.ts` (config, transform)

**Purpose:** Centralized environment variable loading and configuration object.

**Key variables:**
- `APP_SECRET` — WhatsApp signature verification
- `WEBHOOK_VERIFY_TOKEN` — Webhook challenge verification
- `DATABASE_URL` — Neon Postgres connection string
- `LOG_LEVEL` — Pino logging level
- `PORT` — HTTP server port (default 3000)
- `NODE_ENV` — 'development' | 'production'

**Template:**
```typescript
// Load and validate environment variables using Zod
// Export as a single config object
// Throw early on missing required vars
//
// export const config = {
//   appSecret: process.env.APP_SECRET!,
//   webhookVerifyToken: process.env.WEBHOOK_VERIFY_TOKEN!,
//   databaseUrl: process.env.DATABASE_URL!,
//   port: parseInt(process.env.PORT || '3000', 10),
//   logLevel: process.env.LOG_LEVEL || 'info',
//   nodeEnv: process.env.NODE_ENV || 'development',
// };
```

---

### `migrations/0001_initial_schema.sql` (migration, batch)

**Purpose:** Database schema initialization; run once at startup.

**Method:** Generate via `drizzle-kit generate` from schema.ts, or write manually.

**Key tables:** businesses, messages, client_business_relationships (as defined in schema.ts).

**Notes:**
- Use Drizzle's migration tools: `drizzle-kit generate:pg` generates SQL from TypeScript schema
- Run via `npm run migrate` or `drizzle-kit migrate:pg`
- Idempotent: Drizzle tracks applied migrations; safe to re-run

---

### `jest.config.js` (config, transform)

**Purpose:** Jest test runner configuration.

**Key settings:**
- `testEnvironment: 'node'` (server-side tests)
- `transform: { '^.+\\.ts$': 'ts-jest' }` (TypeScript support)
- `moduleNameMapper` for path aliases (e.g., `@/` → `src/`)
- `collectCoverageFrom` to include src files, exclude node_modules
- `testMatch` to find test files (`tests/**/*.test.ts`)

**Template:**
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/tests/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts', // Entry point may not have coverage requirements
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },
};
```

---

### `package.json` (config, transform)

**Purpose:** npm dependency manifest and build scripts.

**Key dependencies:**
- `express` 4.18+
- `drizzle-orm` 0.45.2+
- `pg` (Postgres driver)
- `zod` 4.4.3+
- `dotenv` 16.0+
- `pino` 8.0+
- `remove-accents` 0.5.0+
- `whatsapp` (Meta SDK, if using official; else skip and use HTTP)

**Dev dependencies:**
- `typescript` 5.x
- `ts-node` (for scripts)
- `drizzle-kit` (for migrations)
- `jest` 29+
- `ts-jest` (TypeScript support for Jest)
- `@types/node` 20.x
- `@types/express` 4.17+

**Scripts:**
- `start` — `node dist/index.js` (production)
- `dev` — `ts-node src/index.ts` (development with auto-reload)
- `build` — `tsc` (compile TypeScript to dist/)
- `test` — `jest` (run all tests)
- `test:watch` — `jest --watch` (development)
- `db:migrate` — `drizzle-kit migrate:pg` (apply schema migrations)
- `db:generate` — `drizzle-kit generate:pg` (generate migration from schema.ts)
- `db:seed` — `ts-node src/database/seed.ts` (populate fixtures)
- `db:studio` — `drizzle-kit studio:pg` (Drizzle Studio UI for development)

**Template:**
```json
{
  "name": "randevuclaw",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts",
    "build": "tsc",
    "test": "jest",
    "test:watch": "jest --watch",
    "db:migrate": "drizzle-kit migrate:pg",
    "db:generate": "drizzle-kit generate:pg",
    "db:seed": "ts-node src/database/seed.ts",
    "db:studio": "drizzle-kit studio:pg"
  },
  "dependencies": {
    "express": "^4.18.2",
    "drizzle-orm": "^0.45.2",
    "pg": "^8.11.0",
    "zod": "^4.4.3",
    "dotenv": "^16.0.3",
    "pino": "^8.0.0",
    "remove-accents": "^0.5.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "ts-node": "^10.9.0",
    "drizzle-kit": "^0.45.2",
    "jest": "^29.5.0",
    "ts-jest": "^29.1.0",
    "@types/node": "^20.0.0",
    "@types/express": "^4.17.17",
    "@types/jest": "^29.5.0"
  }
}
```

---

### `tsconfig.json` (config, transform)

**Purpose:** TypeScript compiler configuration.

**Key settings:**
- `target: "ES2020"` (Node 20+ support)
- `module: "ES2020"` (modern modules)
- `strict: true` (strict type checking)
- `outDir: "dist"` (compiled output)
- `rootDir: "src"` (source root)
- `baseUrl` and `paths` for path aliases (e.g., `@/*` → `src/*`)
- `esModuleInterop: true` (CommonJS interop)

**Template:**
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    },
    "allowSyntheticDefaultImports": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

---

### `fly.toml` (config, transform)

**Purpose:** fly.io deployment configuration.

**Key settings:**
- `app = "randevuclaw"` (app name; must be unique across fly.io)
- `primary_region = "ams"` (Amsterdam, closest to Greece; adjust if needed)
- `[env]` section for production variables (DATABASE_URL, APP_SECRET, etc.)
- `[processes]` for multi-process apps (e.g., app + cron in Phase 2)
- `[build]` for Dockerfile or buildpack configuration

**Template:**
```toml
app = "randevuclaw"
primary_region = "ams"

[build]
  builder = "paketobuildpacks/builder:base"

[env]
  LOG_LEVEL = "info"
  NODE_ENV = "production"

[[services]]
  protocol = "tcp"
  internal_port = 3000
  processes = ["app"]

  [services.concurrency]
    type = "connections"
    hard_limit = 25
    soft_limit = 20

[[services]]
  protocol = "http"

  [services.http_checks]
    [[services.http_checks.checks]]
      grace_period = "5s"
      interval = "15s"
      method = "GET"
      path = "/healthz"
      protocol = "http"
      timeout = "5s"
      tls_skip_verify = false

[env]
  # Set via fly secrets:
  # flyctl secrets set APP_SECRET=<...> WEBHOOK_VERIFY_TOKEN=<...> DATABASE_URL=<...>
```

---

### `.env.local` (config, example)

**Purpose:** Development environment variables (NOT committed).

**Key variables:**
```
APP_SECRET=your_meta_app_secret_here
WEBHOOK_VERIFY_TOKEN=your_webhook_verify_token_here
DATABASE_URL=postgresql://user:password@localhost:5432/randevuclaw
LOG_LEVEL=debug
PORT=3000
NODE_ENV=development
```

**Notes:**
- Create `.env.local` in root directory; add to `.gitignore`
- Provide `.env.example` in repo with dummy values for developers to copy
- Production uses `fly secrets set` to inject variables (not `.env.local`)

---

## Shared Patterns

These patterns apply to **multiple files** across the phase and should be implemented consistently:

### Pattern A: Webhook Signature Verification

**Apply to:** `src/webhooks/whatsapp.ts` (POST handler)

**Source:** RESEARCH.md § "Pattern 1: Webhook Signature Verification" and "WhatsApp Webhook Signature Verification" code example

**Concrete implementation:**
```typescript
import crypto from 'crypto';

function verifyWhatsAppSignature(
  rawBody: Buffer,
  xHubSignature: string,
  appSecret: string
): boolean {
  const expected = 'sha256=' +
    crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(xHubSignature)
  );
}

// In middleware (BEFORE json() parsing):
app.post('/webhooks/whatsapp', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-hub-signature-256'] as string;

  if (!verifyWhatsAppSignature(req.body, signature, process.env.APP_SECRET!)) {
    return res.status(403).json({ error: 'Invalid signature' });
  }

  const payload = JSON.parse(req.body.toString('utf-8'));
  // Continue processing...
});
```

---

### Pattern B: Business Code Extraction & Normalization

**Apply to:** `src/business/resolver.ts`, `src/utils/diacritics.ts`

**Source:** RESEARCH.md § "Pattern 2: Business Code Extraction & Normalization" and "Business Code Normalization (Greek Diacritics)" code example

**Concrete implementation:**
```typescript
import removeAccents from 'remove-accents';

export function extractAndNormalizeBusinessCode(text: string): string {
  // 1. Regex to find slug-like pattern (letters, numbers, hyphens)
  const codeMatch = text.match(/([a-zA-Zα-ωάέήίόύώ0-9-]+)/);
  if (!codeMatch) return '';

  const raw = codeMatch[1];

  // 2. Remove accents (ά → α, ί → ι, etc.)
  const withoutAccents = removeAccents(raw);

  // 3. Lowercase, trim, standardize hyphens
  const normalized = withoutAccents
    .toLowerCase()
    .trim()
    .replace(/[^\w-]/g, '') // Keep only letters, numbers, hyphen
    .replace(/\s+/g, '-');  // Replace spaces with hyphens

  return normalized;
}

// Test cases:
// extractAndNormalizeBusinessCode('Pilates-Αθήνα') → 'pilates-athina'
// extractAndNormalizeBusinessCode('ΠΙΛΆΤΕΣ ΑΘΉΝΑ') → 'pilates-athina'
// extractAndNormalizeBusinessCode('pilates–athens') → 'pilates-athens' (em-dash to hyphen)
```

---

### Pattern C: Idempotent Message Insertion with Postgres UNIQUE Constraint

**Apply to:** `src/database/queries.ts` (insertMessage function), `src/database/schema.ts`

**Source:** RESEARCH.md § "Pattern 3: Idempotent Message Insertion with Postgres UNIQUE Constraint"

**Concrete implementation (schema):**
```typescript
export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  whatsappMessageId: text('whatsapp_message_id').notNull().unique(), // Dedup key
  businessId: integer('business_id').notNull().references(() => businesses.id),
  senderPhone: text('sender_phone').notNull(),
  messageBody: text('message_body').notNull(),
  status: text('status').notNull().default('received'), // 'received', 'processed'
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

**Concrete implementation (query):**
```typescript
import { onConflictDoNothing } from 'drizzle-orm/postgres-core';

export async function insertOrIgnoreMessage(
  whatsappMessageId: string,
  businessId: number,
  senderPhone: string,
  messageBody: string
): Promise<'inserted' | 'ignored'> {
  const result = await db
    .insert(messages)
    .values({
      whatsappMessageId,
      businessId,
      senderPhone,
      messageBody,
      status: 'received',
    })
    .onConflictDoNothing()
    .returning({ id: messages.id });

  // If result is empty, the insert was ignored (duplicate message ID)
  return result.length > 0 ? 'inserted' : 'ignored';
}

// After reply is sent successfully:
export async function markMessageProcessed(whatsappMessageId: string) {
  await db
    .update(messages)
    .set({ status: 'processed' })
    .where(eq(messages.whatsappMessageId, whatsappMessageId));
}
```

---

### Pattern D: First-Contact Consent Tracking

**Apply to:** `src/consent/checker.ts`, `src/database/schema.ts`

**Source:** RESEARCH.md § "Pattern 4: First-Contact Consent Tracking"

**Concrete implementation (schema):**
```typescript
export const clientBusinessRelationships = pgTable(
  'client_business_relationships',
  {
    id: serial('id').primaryKey(),
    businessId: integer('business_id').notNull().references(() => businesses.id),
    senderPhone: text('sender_phone').notNull(),
    consentGiven: boolean('consent_given').notNull().default(true), // Implied consent (D-10)
    consentTimestamp: timestamp('consent_timestamp').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('unique_client_business').on(table.businessId, table.senderPhone),
  ]
);
```

**Concrete implementation (logic):**
```typescript
import { and, eq } from 'drizzle-orm';

export async function getOrCreateClientRelationship(
  businessId: number,
  senderPhone: string
): Promise<{ isFirstContact: boolean; consentGiven: boolean }> {
  // Query existing relationship
  const existing = await db
    .select()
    .from(clientBusinessRelationships)
    .where(
      and(
        eq(clientBusinessRelationships.businessId, businessId),
        eq(clientBusinessRelationships.senderPhone, senderPhone)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return {
      isFirstContact: false,
      consentGiven: existing[0].consentGiven,
    };
  }

  // First contact: insert new relationship with implied consent
  await db.insert(clientBusinessRelationships).values({
    businessId,
    senderPhone,
    consentGiven: true, // Implied consent per D-10
    consentTimestamp: new Date(),
  });

  return { isFirstContact: true, consentGiven: true };
}
```

---

### Pattern E: Zod Validation for Webhook Payloads

**Apply to:** `src/utils/validation.ts`, `src/webhooks/whatsapp.ts`

**Source:** RESEARCH.md § Common Pitfalls § "Pitfall 5: WhatsApp Webhook Payload Parsing"

**Concrete implementation:**
```typescript
import { z } from 'zod';

export const WhatsAppWebhookPayloadSchema = z.object({
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          value: z.object({
            messages: z.array(
              z.object({
                id: z.string(),
                from: z.string(),
                type: z.enum(['text', 'image', 'button']),
                text: z
                  .object({ body: z.string() })
                  .optional(),
              })
            ),
          }),
        })
      ),
    })
  ),
});

export function validateWebhookPayload(data: unknown) {
  return WhatsAppWebhookPayloadSchema.parse(data);
}

// In webhook handler:
let payload;
try {
  payload = validateWebhookPayload(JSON.parse(rawBody));
} catch (err) {
  logger.error({ error: err }, 'Invalid webhook payload');
  return res.status(400).json({ error: 'Invalid payload' });
}

// Only process text messages in Phase 1
const message = payload.entry[0]?.changes[0]?.value?.messages?.[0];
if (message?.type !== 'text' || !message.text?.body) {
  logger.info('Ignoring non-text message type');
  return res.status(200).send('OK');
}
```

---

### Pattern F: Environment Variable Validation

**Apply to:** `src/config.ts`, `src/utils/validation.ts`

**Source:** RESEARCH.md § "Standard Stack: Utilities & Config" (Zod for validation)

**Concrete implementation:**
```typescript
import { z } from 'zod';

const EnvSchema = z.object({
  APP_SECRET: z.string().min(1),
  WEBHOOK_VERIFY_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
});

export const config = EnvSchema.parse(process.env);

// Early validation: if parsing fails, app crashes immediately with clear error
// (not a silent failure later)
```

---

### Pattern G: Structured Logging with Pino

**Apply to:** All source files that need logging (`src/webhooks/whatsapp.ts`, `src/database/queries.ts`, etc.)

**Source:** RESEARCH.md § "Standard Stack: Utilities & Config" (Pino)

**Concrete implementation:**
```typescript
import { logger } from '@/utils/logger';

// In webhook handler:
logger.info(
  { businessId, senderPhone, messageId: msg.id },
  'Processing incoming WhatsApp message'
);

// On error:
logger.error(
  { error: err, messageId, businessId },
  'Failed to send reply'
);

// On duplicate message (expected behavior, not an error):
logger.info(
  { messageId },
  'Duplicate message detected, ignoring'
);
```

---

## Test Files Structure

The following test files are required by the validation architecture in RESEARCH.md:

| Test File | Coverage | Purpose |
|-----------|----------|---------|
| `tests/webhook.test.ts` | Signature verification, payload parsing, GET/POST handlers | Unit tests for webhook handler entry point |
| `tests/business-resolver.test.ts` | Business code extraction, normalization, Greek diacritics | Unit tests for business code resolver |
| `tests/idempotency.test.ts` | Duplicate message ID handling, UNIQUE constraint behavior | Unit tests for idempotent message insertion |
| `tests/consent.test.ts` | First-contact detection, consent flag logic, second-contact no-notice | Unit tests for consent checker |
| `tests/fixtures.test.ts` | Seed script creates two businesses, slug generation | Integration tests for database seed |

**Test command reference (from RESEARCH.md):**
```bash
npm test -- --testPathPattern=webhook --testNamePattern="signature verification"
npm test -- --testPathPattern=business-resolver.test.ts
npm test -- --testPathPattern=idempotency.test.ts
npm test -- --testPathPattern=consent.test.ts
npm test -- --testPathPattern=fixtures.test.ts
npm test  # Full suite
```

---

## No Analog Found — Greenfield Repository

This entire phase is greenfield development. **No existing code to pattern-match against.** All files are new creations that should follow:

1. **RESEARCH.md patterns** — Code examples and architecture patterns sections provide concrete implementations
2. **CONTEXT.md decisions** — Locked decisions (D-01 through D-16) constrain implementation choices
3. **CLAUDE.md stack** — Technology choices are locked (Express, Drizzle ORM, Zod, Pino, etc.)

**Implication for planner:** When writing implementation tasks, reference the relevant sections of RESEARCH.md and CONTEXT.md directly. No "copy from existing file" references are available.

---

## Metadata

**Analog search scope:**
- Codebase: `.planning/`, `.claude/`, `.git/` only; no `src/` directory
- External: RESEARCH.md and CONTEXT.md artifacts provided in-phase

**Files scanned:** 0 source files; 0 analogs found

**Pattern extraction date:** 2026-07-07

**Next step:** Planner uses this classification to assign files to implementation tasks, referencing RESEARCH.md patterns as the source of truth for implementation details.

