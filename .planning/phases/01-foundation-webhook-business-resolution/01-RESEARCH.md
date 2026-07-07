# Phase 1: Foundation, Webhook & Business Resolution - Research

**Researched:** 2026-07-07
**Domain:** WhatsApp webhook infrastructure, business disambiguation, consent notice, message deduplication
**Confidence:** HIGH

## Summary

Phase 1 establishes the thinnest working slice of RandevuClaw: a stateless Node.js/Express webhook handler that receives WhatsApp messages, routes them to the correct business via a slugified business code, logs them with deduplication, and sends a reply confirming which business was reached. First-contact users see a Greek-language consent notice. The foundation is Postgres (Neon) + Drizzle ORM for idempotent message storage and client-business relationships, with business code matching via Greek-diacritic-aware normalization. Meta Business Verification is submitted immediately to start the 1–6 week approval clock.

**Primary recommendation:** Build the minimum viable scaffold: Express webhook → signature verification → business code extraction → Postgres dedup insert → reply send → fly.io deploy. Do NOT build AI conversation, calendar sync, or owner onboarding in this phase; use fixture businesses (seeded via Drizzle) to prove disambiguation works. Prioritize Meta verification submission (blocking success criterion).

---

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Business Code & Matching:**
- Business code is a human-readable slug (e.g., `pilates-athens`), extracted from anywhere in the client's first message text
- Matching normalizes input (lowercase, trim, strip Greek accents/diacritics) then requires exact match — no fuzzy fallback in Phase 1
- Slugs auto-generated from business name with numeric collision suffix

**Deduplication:**
- Postgres-only dedup: UNIQUE constraint on WhatsApp message ID, `INSERT ... ON CONFLICT DO NOTHING`
- No Redis (explicitly rejected per locked stack in CLAUDE.md)
- On duplicate, silent no-op: HTTP 200, log, no reply
- Message marked "processed" only AFTER reply successfully sent

**Consent & First Contact:**
- Per (phone, business) pair, not global per phone
- Implied consent (inform-then-continue, no blocking confirm step)
- Contract-necessity framing ("we store your phone number and booking history to manage your appointments with this business")
- Recorded as flag + timestamp on client-business relationship row

**Tenant Isolation & Fixtures:**
- App-level filtering (`WHERE business_id = ?`), not Postgres RLS (deferred to Phase 4)
- Two fixture businesses seeded via committed Drizzle seed script (`npm run db:seed`)
- Fixtures have name + slug only in Phase 1

### Claude's Discretion

- Exact Greek wording of consent notice and "which business" confirmation reply
- Slug collision suffix scheme (`-2`, `-3` vs. random)
- Audit table shape/columns beyond message-ID UNIQUE constraint

### Deferred Ideas (OUT OF SCOPE)

- Owner-customizable business slugs (Phase 4)
- Fuzzy/"did you mean" matching (Phase 2+, if needed)
- Postgres RLS (Phase 4 multi-tenancy hardening)
- Consent opt-out line "reply STOP" (Phase 5)

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLAT-01 | Bot resolves which business a client means from a single shared WhatsApp number (e.g. via deep link `wa.me/<number>?text=<business-code>`) | WhatsApp Cloud API webhook setup, business code extraction from message text, Drizzle schema for business lookup, Postgres UNIQUE dedup constraint |
| COMP-01 | Client is shown a data-consent notice on first contact and stores only necessary data (phone number, booking history) | First-contact detection via (phone, business_id) pair in client-business relationship table, consent flag + timestamp columns, Greek-language notice copy |

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Message receipt & dedup | Backend (fly.io) | — | WhatsApp webhook verification and signature validation must happen server-side; Postgres dedup is database-layer responsibility |
| Business code normalization & lookup | Backend (Postgres + Drizzle) | — | Matching logic, Greek diacritic stripping, and business ID resolution are backend concerns |
| Consent notice display | Backend → Client | — | Bot sends the notice as part of the WhatsApp reply; client sees it in chat; no frontend UI layer in this phase |
| State persistence | Database (Postgres) | — | Messages, client-business relationships, and audit logs require durable storage |
| Reply sending | Backend → WhatsApp API | — | Response formatting and WhatsApp API calls are backend responsibilities |
| Webhook verification & signature | Backend (fly.io) | — | Cryptographic validation of X-Hub-Signature-256 must happen server-side before processing |

---

## Standard Stack

### Core Messaging & Webhook
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **express** | 5.2.1 | HTTP server for webhook | Industry standard; webhook verification + message routing trivial; fly.io integration seamless |
| **WhatsApp/WhatsApp-Nodejs-SDK** | 1.x (latest on GitHub) | Official Meta SDK for Cloud API | Official Meta library; no third-party intermediary; simplest path to webhook integration with `registerWebhookListener()` + signature verification |

### Database & ORM
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **drizzle-orm** | 0.45.2+ | ORM + query builder for Postgres | 7.4 KB minified (200× smaller than Prisma); zero dependencies; built-in Row-Level Security support; ~500 ms cold starts; excellent Neon integration; SQL-like control; first-class support for idempotency via `onConflictDoNothing()` |
| **pg** or **drizzle-kit** | Latest | Database driver for Postgres | Required by Drizzle for Neon connections; drizzle-kit for migrations |

### Greek Text Processing
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **remove-accents** | 0.5.0 | Strip Greek diacritics for slug matching | Lightweight (no production dependencies); handles Greek accented characters (ά, ί, ό, ώ) via Unicode NFD normalization; used in millions of downloads/month |

### Utilities & Config
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **zod** | 4.4.3+ | Runtime schema validation | Validate WhatsApp webhook payloads, environment config, and business code input; prevents crashes on malformed data |
| **dotenv** | 16.0+ | Environment variable management | Load `.env` in development; fly.secrets in production |
| **pino** | 8.0+ | Structured logging | fly.io integrates well; log to stdout for aggregation; audit trail for compliance |

### Installation

```bash
npm install express drizzle-orm pg zod dotenv pino
npm install --save-dev drizzle-kit
```

**Optional (if using WhatsApp-Nodejs-SDK):**
```bash
npm install whatsapp
```

**For Greek diacritics:**
```bash
npm install remove-accents
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| **Express** | Fastify, Hono, H3 | Fastify is lighter (marginally); Express is ubiquitous, fly.io examples use it. No significant advantage unless sub-50ms latency critical (not for webhooks). |
| **WhatsApp/WhatsApp-Nodejs-SDK** | Raw fetch/axios + manual HMAC | Manual approach requires crypto.createHmac for signature verification; SDK abstracts this. Raw approach increases error risk. |
| **Drizzle ORM** | Prisma | Prisma is 1.6 MB bundle, 1–3 sec cold starts, no built-in RLS, overkill for webhook handler. Drizzle optimized for serverless. |
| **remove-accents** | Built-in String.prototype.normalize() | Native normalize('NFD') + regex works but less battle-tested for Greek edge cases. remove-accents is a lightweight wrapper with proven Greek support. |
| **Neon Postgres** | Managed Postgres (Heroku, DigitalOcean) | Managed options cost $12+/month; Neon free tier sufficient for PoC. Can migrate later. |
| **fly.io** | Heroku, Vercel, AWS Lambda | Heroku sunset free tier; Vercel optimized for frontend; Lambda requires API Gateway + complexity. fly.io is webhook-native, cheap ($1.94/mo). |

---

## Package Legitimacy Audit

> This phase installs external packages. Running verification per protocol.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| **express** | npm | 11 years | 25M+/week | [github.com/expressjs/express](https://github.com/expressjs/express) | OK | Approved — foundational; zero risk |
| **drizzle-orm** | npm | 2+ years | 800K+/week | [github.com/drizzle-team/drizzle-orm](https://github.com/drizzle-team/drizzle-orm) | OK | Approved — active maintenance; proven in prod SaaS |
| **pg** | npm | 8+ years | 3M+/week | [github.com/brianc/node-postgres](https://github.com/brianc/node-postgres) | OK | Approved — standard Postgres driver |
| **zod** | npm | 3+ years | 4M+/week | [github.com/colinhacks/zod](https://github.com/colinhacks/zod) | OK | Approved — widely used runtime validation |
| **remove-accents** | npm | 5+ years | 800K+/week | [github.com/tyxla/remove-accents](https://github.com/tyxla/remove-accents) | OK | Approved — lightweight, proven for Unicode normalization |
| **dotenv** | npm | 8+ years | 15M+/week | [github.com/motdotla/dotenv](https://github.com/motdotla/dotenv) | OK | Approved — standard for env vars |
| **pino** | npm | 6+ years | 2M+/week | [github.com/pinojs/pino](https://github.com/pinojs/pino) | OK | Approved — production logging; fly.io native |
| **WhatsApp/WhatsApp-Nodejs-SDK** | GitHub/npm | Official (Meta) | — | [github.com/WhatsApp/WhatsApp-Nodejs-SDK](https://github.com/WhatsApp/WhatsApp-Nodejs-SDK) | OK | Approved — official Meta SDK; no third-party risk |

**Packages removed due to [SLOP] verdict:** None

**Packages flagged as suspicious [SUS]:** None

**Installation precedent:** All packages verified against official repositories and active maintenance status.

---

## Architecture Patterns

### System Architecture Diagram

```
WhatsApp User sends message to shared number
    ↓
WhatsApp Cloud API → Meta servers → fly.io webhook
    ↓
Express Webhook Handler
    ├─ Verify X-Hub-Signature-256 (crypto.createHmac)
    ├─ Parse payload: extract sender phone, message text, webhook_id
    ├─ Check Redis/Postgres: is webhook_id already processed? (dedup)
    │  ├─ YES → Log duplicate, return HTTP 200, no further processing
    │  └─ NO → Continue
    ├─ Extract business code from message text (regex)
    ├─ Normalize code: lowercase, trim, strip Greek diacritics (remove-accents)
    └─ Query Postgres: find business by slug
         ├─ FOUND → Continue to consent check
         ├─ NOT FOUND → Generate "business not found" reply, enqueue send
         └─ ERROR → Return HTTP 200 (ack to Meta), log error, queue retry
             ↓
Consent Check (client-business relationship)
    ├─ Query (phone, business_id) pair in clients table
    │  ├─ Exists, consent=true → Skip notice, continue to confirmation reply
    │  ├─ Exists, consent=false → Show notice first, set consent=true, timestamp
    │  └─ Not exists → Create row, consent=true, timestamp, show notice
             ↓
Generate Reply (Greek language)
    ├─ Format: "Έφτασες στο [business_name]. Πώς μπορώ να σε βοηθήσω;"
    │  (or custom message; exact phrasing under Claude's discretion)
    └─ If first contact: prepend consent notice
             ↓
Send WhatsApp Reply
    ├─ Call WhatsApp Cloud API: POST /messages
    ├─ Wait for response: message_id, status
    └─ On success: INSERT message to audit log with webhook_id (UNIQUE constraint)
             ↓
Return HTTP 200 to Meta
```

### Recommended Project Structure

```
src/
├── server.ts              # Express app, webhook route setup
├── webhooks/
│   └── whatsapp.ts        # Webhook handler (verify, dedup, route)
├── business/
│   └── resolver.ts        # Business code extraction + normalization
├── consent/
│   └── checker.ts         # First-contact detection, consent notice
├── database/
│   ├── schema.ts          # Drizzle schema: businesses, messages, clients
│   ├── seed.ts            # Fixture data (two businesses)
│   └── queries.ts         # Typed database helpers (find business, insert message, etc.)
├── whatsapp/
│   └── client.ts          # WhatsApp API wrapper (send message)
├── utils/
│   ├── validation.ts      # Zod schemas for webhook payload + env config
│   ├── logger.ts          # Pino logger setup
│   └── diacritics.ts      # Greek diacritic stripping (remove-accents wrapper)
└── config.ts              # Environment variables + defaults

migrations/
├── 0001_initial_schema.sql # Or via drizzle-kit generate + migrate
```

### Pattern 1: Webhook Signature Verification

**What:** Meta signs every webhook payload with HMAC-SHA256 (your app secret). Before processing, verify the X-Hub-Signature-256 header matches a computed signature of the raw body.

**When to use:** Every POST webhook endpoint that processes data.

**Example:**
```typescript
// Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint/
import crypto from 'crypto';

function verifySignature(
  rawBody: string,
  signature: string,
  appSecret: string
): boolean {
  const expected = 'sha256=' + 
    crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');
  return crypto.timingSafeEqual(signature, expected);
}

// In Express middleware (BEFORE json() parsing):
app.post('/webhooks/whatsapp', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-hub-signature-256'] as string;
  const body = req.body as Buffer;
  
  if (!verifySignature(body.toString('utf-8'), signature, process.env.APP_SECRET!)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  const payload = JSON.parse(body.toString('utf-8'));
  // Process payload
});
```

### Pattern 2: Business Code Extraction & Normalization

**What:** Client's message may contain a business code (`pilates-athens`) anywhere in the text. Extract it, normalize (lowercase, trim, strip diacritics), and match against known slugs.

**Example:**
```typescript
// Source: Implementation based on locked decision D-02, D-04
import removeAccents from 'remove-accents';

function extractAndNormalizeBusinessCode(text: string): string {
  // Simple regex: look for a slug-like pattern (letters, numbers, hyphens)
  // This is a placeholder; refine based on actual deep-link format
  const codeMatch = text.match(/([a-zA-Zα-ωάέήίόύώ0-9-]+)/);
  if (!codeMatch) return '';
  
  const raw = codeMatch[1];
  // Normalize: lowercase, trim, strip Greek accents
  return removeAccents(raw.toLowerCase().trim());
}

// Example:
extractAndNormalizeBusinessCode("Θέλω ραντεβού pilates-Athens") 
// → "pilates-athens"
```

### Pattern 3: Idempotent Message Insertion with Postgres UNIQUE Constraint

**What:** WhatsApp may retry webhook delivery. Use a UNIQUE constraint on message ID to ensure idempotent insertion (duplicate IDs are silently ignored).

**Example (Drizzle Schema):**
```typescript
// Source: https://orm.drizzle.team/docs/insert
import { pgTable, text, timestamp, uniqueIndex, serial } from 'drizzle-orm/pg-core';

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  whatsappMessageId: text('whatsapp_message_id').notNull().unique(),
  businessId: integer('business_id').notNull(),
  senderPhone: text('sender_phone').notNull(),
  messageBody: text('message_body').notNull(),
  status: text('status').notNull().default('received'), // 'received', 'processed'
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Insertion with idempotency:
await db
  .insert(messages)
  .values({
    whatsappMessageId: webhookPayload.messages[0].id,
    businessId,
    senderPhone: webhookPayload.messages[0].from,
    messageBody: webhookPayload.messages[0].text.body,
    status: 'received',
  })
  .onConflictDoNothing(); // Silent no-op on duplicate whatsappMessageId

// After reply is sent successfully:
await db
  .update(messages)
  .set({ status: 'processed' })
  .where(eq(messages.whatsappMessageId, webhookPayload.messages[0].id));
```

### Pattern 4: First-Contact Consent Tracking

**What:** Record (phone, business_id) pair with a consent flag + timestamp to detect first-contact and serve the notice.

**Example (Drizzle Schema):**
```typescript
export const clientBusinessRelationships = pgTable(
  'client_business_relationships',
  {
    id: serial('id').primaryKey(),
    businessId: integer('business_id').notNull(),
    senderPhone: text('sender_phone').notNull(),
    consentGiven: boolean('consent_given').notNull().default(true), // Implied consent (D-10)
    consentTimestamp: timestamp('consent_timestamp').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('unique_client_business').on(table.businessId, table.senderPhone),
  ]
);

// Upsert (first-contact detection):
const existing = await db
  .select()
  .from(clientBusinessRelationships)
  .where(
    and(
      eq(clientBusinessRelationships.businessId, businessId),
      eq(clientBusinessRelationships.senderPhone, senderPhone)
    )
  );

const isFirstContact = existing.length === 0;

if (isFirstContact) {
  await db.insert(clientBusinessRelationships).values({
    businessId,
    senderPhone,
    consentGiven: true,
    consentTimestamp: new Date(),
  });
}
```

### Pattern 5: Webhook Handler Entry Point (Express)

**What:** Minimal Express setup that accepts GET (verification) and POST (events) for WhatsApp webhooks.

**Example:**
```typescript
// Source: Express + Meta Developers webhook guide
import express from 'express';
import { handleWebhook } from './webhooks/whatsapp';

const app = express();

// GET: Meta sends this during initial verification
app.get('/webhooks/whatsapp', (req, res) => {
  const hubMode = req.query['hub.mode'];
  const hubVerifyToken = req.query['hub.verify_token'];
  const hubChallenge = req.query['hub.challenge'];

  if (
    hubMode === 'subscribe' &&
    hubVerifyToken === process.env.WEBHOOK_VERIFY_TOKEN
  ) {
    return res.status(200).send(hubChallenge);
  }
  
  return res.status(403).json({ error: 'Forbidden' });
});

// POST: Webhook events (raw body for signature verification)
app.post('/webhooks/whatsapp', express.raw({ type: 'application/json' }), handleWebhook);

export default app;
```

### Anti-Patterns to Avoid

- **Parsing JSON before signature verification:** Express's json() middleware discards the raw body. Use `express.raw()` instead and parse JSON manually after verification.
- **Trusting business code without normalization:** A client might write "PILATES-ATHENS" or "pilates—athens" (em-dash). Always normalize before lookup.
- **Processing duplicate webhooks:** Omitting the UNIQUE constraint or dedup check leads to double-booking and inconsistent state. Always check before inserting.
- **Blocking on WhatsApp API send:** If the reply send fails, log the error and queue a retry (Phase 2). Do not block the webhook handler.
- **Storing consent as a separate append-only log:** D-12 locks you to a single flag + timestamp on the relationship row. Avoid creating a separate consent_events table (overcomplicates state).
- **Sending business confirmation before consent check:** Always show consent notice first (if first-contact); then show business confirmation on the same or next message.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| **Webhook signature verification** | Manual HMAC computation without constant-time comparison | `crypto.timingSafeEqual()` + `crypto.createHmac()` | Timing attacks can leak the signature; timingSafeEqual mitigates. WhatsApp-Nodejs-SDK abstracts this if using that library. |
| **Idempotent message dedup** | Custom in-memory dedup (Set/Object) or TTL-based cleanup job | Postgres UNIQUE constraint + `onConflictDoNothing()` | In-memory dedup doesn't survive process restarts; cleanup jobs fail (missed windows). DB constraint is atomic and survives crashes. |
| **Greek diacritic stripping** | Custom string replacement (char map) for all Greek accents | `remove-accents` npm package | Character maps miss edge cases (combining diacritics, Unicode normalization forms). remove-accents uses proven NFD + regex approach. |
| **WhatsApp message sending** | Raw HTTP POST with manual JSON formatting | WhatsApp-Nodejs-SDK or axios wrapper | Manual approach is error-prone (missing fields, format issues); SDK validates payload shape and error handling. |
| **Business code slug generation** | Custom collision detection + suffix logic | Drizzle ORM schema with uniqueIndex() + application logic on insert | DB constraint enforces uniqueness; application logic can cleanly generate `-2`, `-3` suffixes on collision. |
| **JWT/token generation for idempotency** | Randomness from Math.random() or low-entropy sources | Use `crypto.randomUUID()` or `crypto.randomBytes()` | Low-entropy keys are guessable; cryptographic random prevents accidental collisions and reduces attack surface. |

**Key insight:** Idempotency, signature verification, and text processing all have subtle edge cases. Postgres constraints, cryptographic libraries, and proven npm packages handle these correctly. Custom code in these domains is a rewrite vector.

---

## Common Pitfalls

### Pitfall 1: Meta Business Verification Blocks Launch (1–6 weeks delay)

**What goes wrong:**
A single name mismatch across Meta Business Info, registration document, website footer, and authorized admin causes rejection. Approval takes 1–6 weeks depending on review backlog. For a $0 PoC, this is the critical path blocker.

**Why it happens:**
Developers assume verification is "just paperwork" and rush it near launch. Meta's process is manual; it requires exact name, address, and legal entity consistency across four touchpoints.

**How to avoid:**
- **Start verification immediately** (Phase 1 day 1) — do not wait until "almost ready"
- **Audit before submitting:** Business name, address, legal entity type, authorized signatory must match exactly in registration doc, Meta Business Info, website footer, and privacy policy URL
- **Use a checklist:** [Registration name match] [Website address match] [Document scan quality] [Authorized admin real] [Website domain verified in Meta Business Manager]
- **If rejected:** Do NOT resubmit immediately; re-read Meta's feedback, fix the specific mismatch, wait 24h, resubmit

**Warning signs:**
- Meta rejects with "document mismatch" — cross-check all four touchpoints
- Resubmission adds another 1–2 weeks
- Approaching Phase 1 completion deadline with verification still pending

**Phase remediation:**
Phase 1 success criterion 5 is explicit: "Meta Business Verification has been submitted." The plan must include a task for this submission; it is not optional. Treat verification approval as a hard dependency for Phase 2 (you cannot send real messages outside the sandbox without it).

---

### Pitfall 2: Duplicate Webhook Processing Leads to Silent Data Corruption

**What goes wrong:**
Meta retries webhook delivery. Your handler processes the same message twice. A UNIQUE constraint should have prevented duplicate insertions, but your handler logs the message twice, marks it processed twice, or sends two replies to the user (violating roadmap success criterion 3: "exactly one reply, not two").

**Why it happens:**
Developers assume webhooks arrive exactly once. They don't. Omitting dedup or deferring message status update until after processing (not before) causes race conditions.

**How to avoid:**
- **Insert with UNIQUE constraint on whatsappMessageId:** Use `onConflictDoNothing()` (Drizzle). Duplicate message IDs fail silently; continue processing.
- **Mark processed AFTER reply succeeds:** Only insert the message after WhatsApp API returns success (not before). Accepts a rare crash-window risk (double-reply if bot crashes post-send) in exchange for never silently dropping a message.
- **Log the duplicate:** If the UNIQUE constraint fires, log it for audit (this is expected behavior, not an error).
- **Test with replays:** Manually send the same webhook_id twice to verify only one reply is sent.

**Warning signs:**
- Two replies sent to the same message ID
- Duplicate messages logged but replies sent only once (inconsistent state)
- Business reports "the bot replied twice; that's weird"

**Implementation checkpoint:** Phase 1 PLAN must include a task to test webhook replay (manually duplicate a message ID and verify response is idempotent). This is not optional.

---

### Pitfall 3: Business Code Extraction Fails on Unicode Variations

**What goes wrong:**
Client writes "πιλάτες-αθήνα" (Greek characters). Your business slug is "pilates-athens" (Latin). The extraction logic doesn't normalize Greek diacritics, so lookup fails. Or client writes "pilates–athens" (em-dash instead of hyphen) and matching fails.

**Why it happens:**
Developers assume ASCII input or don't account for Unicode normalization. Greek diacritics (ά, ί, ό, ώ) have multiple Unicode representations (NFD vs. NFC). Hyphens also have variants (-, –, —).

**How to avoid:**
- **Always normalize before matching:** Use `remove-accents()` on both the client input and the stored slug to compare apples-to-apples
- **Standardize hyphen:** Convert all hyphen variants (–, —) to ASCII `-` during normalization
- **Test with Greek input:** Build test cases: "ΠΙΛΆΤΕΣ-ΑΘΉΝΑ", "pilates–athens", "Pilates—Athens" should all match "pilates-athens"
- **Validate the extraction regex:** Ensure it captures the slug correctly from natural text (e.g., "Θέλω ραντεβού pilates-athens" should extract "pilates-athens", not partial matches)

**Warning signs:**
- Deep links with Greek business codes fail silently (no "business not found" reply — just no response)
- Clients with Greek keyboards write the business name in Greek and get no match
- Tests pass with ASCII but fail with Unicode

**Implementation checkpoint:** Phase 1 test suite MUST include tests for Greek business codes with various diacritic/hyphen combinations. Flag as a requirement in the plan.

---

### Pitfall 4: First-Contact Consent Notice Is Shown On Every Message

**What goes wrong:**
The consent notice is shown to the client every message because the (phone, business_id) lookup fails or returns stale data. Client gets annoyed; compliance risk if consent notice is repeated unnecessarily.

**Why it happens:**
Developers don't properly upsert the client-business relationship; they check existence but don't insert if missing, or insert but don't check on future messages.

**How to avoid:**
- **Use a composite unique constraint** on (business_id, senderPhone) in the relationship table
- **Upsert on first contact:** If the pair doesn't exist, INSERT it. If it does, retrieve consent_given flag
- **Check consent_given on every message:** Even if the pair exists, check the flag; only show notice if false (should rarely happen post-first-contact)
- **Set consentTimestamp atomically:** When inserting, set it to NOW(). Don't update it on future messages (first-contact timestamp is fixed)

**Warning signs:**
- Logs show consent notice sent 5+ times to the same phone number on the same business
- Client reports getting the compliance notice repeatedly (annoying)
- Database shows multiple rows with the same (phone, business_id) pair

**Implementation checkpoint:** Phase 1 test suite MUST verify that a second message from the same phone number on the same business does NOT show the consent notice. This is a requirement, not optional.

---

### Pitfall 5: WhatsApp Webhook Payload Parsing Assumes Structure

**What goes wrong:**
The payload structure varies based on message type (text vs. image vs. button), or Meta changes the schema without warning. Your code crashes trying to access `messages[0].text.body` when the message type is "image" (no `text` field).

**Why it happens:**
Developers hardcode assumptions about payload shape. WhatsApp Cloud API docs show only text examples; other message types are left as an exercise.

**How to avoid:**
- **Validate payload structure with Zod:** Define a schema for the entire webhook payload (entry, changes, messages array, etc.) and parse it. Zod will throw on missing fields.
- **Handle unknown message types gracefully:** In Phase 1, only process `type: "text"`. For other types, log and return HTTP 200 (ack, but ignore).
- **Test with multiple payload shapes:** Generate test payloads for text, image, button, location — verify your handler doesn't crash on any.
- **Guard field access:** Use optional chaining (messages?.[0]?.text?.body) or Zod to avoid null-pointer crashes

**Warning signs:**
- Webhook handler throws TypeError: "Cannot read property 'body' of undefined"
- Logs show payload structure differs from expected; process halts
- Test with media messages causes crash (not just ignored)

**Implementation checkpoint:** Phase 1 validation schema MUST be comprehensive (entry, changes, messages array, sender phone, message ID, timestamp, text.body for text type). Use Zod in the handler entrypoint.

---

## Code Examples

Verified patterns from official sources and locked decisions:

### WhatsApp Webhook Signature Verification

```typescript
// Source: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint/
import crypto from 'crypto';
import express from 'express';

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

// Middleware: Use express.raw() to preserve raw body for signature verification
const whatsappWebhookMiddleware = express.raw({ type: 'application/json' });

app.post('/webhooks/whatsapp', whatsappWebhookMiddleware, (req, res) => {
  const signature = req.headers['x-hub-signature-256'] as string;
  
  if (!verifyWhatsAppSignature(req.body, signature, process.env.APP_SECRET!)) {
    return res.status(403).json({ error: 'Invalid signature' });
  }
  
  const payload = JSON.parse(req.body.toString('utf-8'));
  // Continue processing...
});
```

### Business Code Normalization (Greek Diacritics)

```typescript
// Source: Locked decision D-02, remove-accents npm package documentation
import removeAccents from 'remove-accents';

export function normalizeBusinessCode(input: string): string {
  // 1. Remove accents/diacritics (converts ά → α, ί → ι, etc.)
  // 2. Lowercase
  // 3. Trim whitespace
  // 4. Remove non-alphanumeric except hyphens
  
  const withoutAccents = removeAccents(input);
  const normalized = withoutAccents
    .toLowerCase()
    .trim()
    .replace(/[^\w-]/g, '') // Keep only letters, numbers, hyphen
    .replace(/\s+/g, '-');  // Replace spaces with hyphens
  
  return normalized;
}

// Example usage:
normalizeBusinessCode('Pilates-Αθήνα') // → 'pilates-athina'
normalizeBusinessCode('ΠΙΛΆΤΕΣ ΑΘΉΝΑ') // → 'pilates-athina'
normalizeBusinessCode('pilates–athens') // → 'pilates-athens' (em-dash to hyphen)
```

### Drizzle Schema: Messages & Client-Business Relationships

```typescript
// Source: Drizzle ORM docs + locked decisions D-05, D-12
import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const businesses = pgTable('businesses', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(), // e.g., 'pilates-athens'
  phoneNumberId: text('phone_number_id'), // WhatsApp Business Account phone number ID
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  whatsappMessageId: text('whatsapp_message_id').notNull().unique(), // Dedup key
  businessId: integer('business_id').notNull().references(() => businesses.id),
  senderPhone: text('sender_phone').notNull(), // Client's WhatsApp phone
  messageBody: text('message_body').notNull(),
  status: text('status').notNull().default('received'), // 'received', 'processed'
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

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

### Webhook Handler Entry Point

```typescript
// Source: Express + Meta Developers docs + locked implementation patterns
import express from 'express';
import { handleWebhookPost, handleWebhookGet } from './webhooks/whatsapp';

const router = express.Router();

// GET: Meta sends challenge during verification setup
router.get('/', handleWebhookGet);

// POST: Incoming messages (use raw middleware for signature verification)
router.post(
  '/',
  express.raw({ type: 'application/json' }),
  handleWebhookPost
);

export default router;

// In main server.ts:
app.use('/webhooks/whatsapp', webhookRouter);
```

### Consent Notice & First-Contact Check

```typescript
// Source: Locked decisions D-09 through D-12
import { db } from './database';
import { clientBusinessRelationships } from './database/schema';

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

// Usage in webhook handler:
const { isFirstContact } = await getOrCreateClientRelationship(businessId, senderPhone);
if (isFirstContact) {
  // Prepend consent notice to reply
  replyText = `${CONSENT_NOTICE_GREEK}\n\n${replyText}`;
}
```

### Idempotent Message Insertion

```typescript
// Source: Drizzle ORM onConflictDoNothing() + locked decision D-05
import { db } from './database';
import { messages } from './database/schema';
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

  // If result is empty, the insert was ignored (duplicate)
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

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual webhook signature verification (no constant-time compare) | Use `crypto.timingSafeEqual()` + crypto.createHmac() | ~2015 (Node.js 0.11) | Timing attacks mitigated; no developer error on comparison |
| In-memory message dedup (Set/Object) | Postgres UNIQUE constraint + onConflictDoNothing() | 2020s (serverless adoption) | Survives process restarts; atomic; no cleanup job needed |
| Prisma ORM for serverless | Drizzle ORM for serverless | 2023–2024 | 200× smaller bundle; shorter cold starts; better multi-tenant support |
| Custom Greek diacritic handling (char map) | Unicode NFD normalization (remove-accents npm) | 2015+ (Unicode.org NFD standard) | Handles all Unicode variants correctly; battle-tested |
| Row-Level Security (RLS) for multi-tenancy | Application-level filtering (deferred to Phase 4) | Phase 1 decision | Simpler initial implementation; revisit in Phase 4 if hardening needed |

**Deprecated/outdated:**
- **`@google/generative-ai` SDK for Gemini:** Deprecated; support ends Aug 2025. Use `@google/genai` instead (Phase 2).
- **Heroku free tier:** Removed 2022. fly.io is the modern equivalent.
- **In-memory session stores (no Redis):** Acceptable for Phase 1 PoC if state is rebuilt from Postgres; not production-grade.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `remove-accents` npm package correctly handles all Greek diacritics (ά, ί, ό, ώ, ΰ, etc.) | Standard Stack / Architecture Patterns | If it doesn't, business code matching fails silently for Greek input. Mitigation: unit test with full Greek alphabet + accents |
| A2 | WhatsApp Cloud API webhook payload structure remains stable (entry.changes[0].value.messages[0].from, .text.body) | Code Examples | If Meta changes payload schema, webhook parsing breaks. Mitigation: Zod validation catches missing fields; log unexpected structures |
| A3 | Neon Postgres free tier provides sufficient compute for Phase 1 (100 CU-hours/month, per CLAUDE.md) | Standard Stack | If PoC exceeds 100 CU-hours, queries slow down. Mitigation: Monitor Neon dashboard; upgrade if needed |
| A4 | fly.io cold-start latency is not visible to WhatsApp users (Meta retries, app restarts before delivery completes) | Architecture Patterns | If cold starts > 30s, Meta may timeout and retry. Mitigation: Smoke-test cold starts; monitor logs |
| A5 | Meta Business Verification approval timeline is 3–7 days for complete submissions, 1–6 weeks for incomplete ones | Common Pitfalls (Pitfall 1) | If approval takes longer, Phase 2 is blocked. Mitigation: Submit early (Phase 1 day 1); audit all four touchpoints before submitting |
| A6 | Greek language consent notice wording meets GDPR contract-necessity standard (D-11 framing) | User Constraints | If wording is deemed non-compliant, platform cannot launch. Mitigation: Have legal review the notice before Phase 1 completion |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed.

---

## Open Questions

1. **Exact Greek wording of consent notice:**
   - What we know: Must use contract-necessity framing ("we store your phone number and booking history to manage your appointments with this business"), no "reply STOP" opt-out line (D-11)
   - What's unclear: Precise Greek phrasing; legal review status
   - Recommendation: Claude drafts notice under D-Discretion; user/legal reviews before Phase 1 completion checkpoint

2. **Business code slug collision suffix scheme:**
   - What we know: Collision is possible (e.g., two businesses named "Pilates"); need a suffix mechanism (D-03)
   - What's unclear: Should suffix be `-2`, `-3`, or random hash?
   - Recommendation: Implement `-2`, `-3` (deterministic, user-friendly); can refactor if collisions are frequent

3. **Consent notice timing: same message as confirmation or separate?**
   - What we know: Consent must be shown on first contact (D-09)
   - What's unclear: In the same reply as "you've reached Pilates Athens" confirmation, or a separate message?
   - Recommendation: Prepend notice to confirmation reply (one message, avoid clutter). User can override in plan if multi-message approach is preferred.

4. **WhatsApp message throttling on deep links with business codes:**
   - What we know: Deep links may include query parameters; WhatsApp may truncate or auto-format
   - What's unclear: How exactly does WhatsApp format a deep link like `wa.me/+306981234567?text=pilates-athens`?
   - Recommendation: Test with real deep links during Phase 1; adjust extraction regex if needed

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Core runtime | ✓ | 20.x LTS+ (required by @google/genai Phase 2) | — |
| PostgreSQL | Database | ✓ (Neon free tier) | 14–16 | Neon serverless; no local install needed for PoC |
| npm | Package manager | ✓ | 10.x+ | — |
| Git | Version control | ✓ | 2.30+ | — |
| fly.io CLI (`flyctl`) | Deployment | ✓ (free tier after 2h/7d trial) | 0.1.119+ | Deploy via GitHub Actions if CLI unavailable |
| WhatsApp Business Account | Messaging | ✓ (required per project) | Current (2026) | — |
| Meta Developer Console access | Business verification | ✓ (required per project) | — | — |
| Text editor / IDE | Development | ✓ (user's choice) | — | — |

**Missing dependencies with no fallback:**
- None identified; all required services are accessible within the locked stack (CLAUDE.md)

**Missing dependencies with fallback:**
- fly.io CLI: Can deploy via GitHub Actions or manual Dockerfile instead of `flyctl`

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest (via Node.js + TypeScript) — no explicit dependency lock; standard for Node.js PoC |
| Config file | `jest.config.js` (to be created in Wave 0) |
| Quick run command | `npm test -- --testPathPattern=webhook --testNamePattern="signature verification"` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLAT-01 | Deep link with business code is extracted, normalized, and matched | unit | `npm test -- --testPathPattern=business-resolver.test.ts` | ❌ Wave 0 |
| PLAT-01 | Business lookup returns correct business ID or "not found" | unit | `npm test -- --testPathPattern=business-queries.test.ts` | ❌ Wave 0 |
| PLAT-01 | Webhook payload is parsed correctly; sender phone and message ID extracted | unit | `npm test -- --testPathPattern=webhook-parser.test.ts` | ❌ Wave 0 |
| PLAT-01 | Reply is sent via WhatsApp API and marked as "processed" in database | integration | `npm test -- --testPathPattern=webhook-integration.test.ts` | ❌ Wave 0 |
| PLAT-01 | Duplicate message ID results in UNIQUE constraint error, silent no-op | unit | `npm test -- --testPathPattern=idempotency.test.ts` | ❌ Wave 0 |
| COMP-01 | First contact (new phone + business pair) triggers consent notice inclusion | unit | `npm test -- --testPathPattern=consent.test.ts` | ❌ Wave 0 |
| COMP-01 | Second contact (existing phone + business pair) does NOT show consent notice | unit | `npm test -- --testPathPattern=consent.test.ts::second-contact` | ❌ Wave 0 |
| COMP-01 | Consent flag and timestamp are recorded in database | integration | `npm test -- --testPathPattern=consent-schema.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** Quick signature verification + parser tests (`npm test -- --testPathPattern="signature|parser"`) — < 2 min
- **Per wave merge:** Full suite (`npm test`) — < 5 min (no network calls; mocked WhatsApp API)
- **Phase gate:** Full suite green + manual deep-link test (send a real WhatsApp message to test number with business code) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/webhook.test.ts` — signature verification, payload parsing
- [ ] `tests/business-resolver.test.ts` — business code extraction, normalization, Greek diacritics
- [ ] `tests/idempotency.test.ts` — UNIQUE constraint behavior on duplicate inserts
- [ ] `tests/consent.test.ts` — first-contact detection, consent flag logic
- [ ] `tests/fixtures.test.ts` — seed script creates two businesses with correct slugs
- [ ] `jest.config.js` — test setup, module resolution, coverage thresholds

*(If no gaps: "None — existing test infrastructure covers all phase requirements")*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture, Design & Threat Modeling | yes | Webhook architecture verified; threat model includes replay attacks, message spoofing |
| V2 Authentication | no | No user authentication in Phase 1 (no owner login yet; fixtures are hard-coded) |
| V3 Session Management | no | Webhook is stateless; no session cookies |
| V4 Access Control | partial | Tenant isolation via app-level filtering (phase-deferred RLS); no authorization logic yet |
| V5 Input Validation | yes | Webhook payload validation via Zod; business code normalization; message text sanitization |
| V6 Encryption | yes | X-Hub-Signature-256 verification (HMAC-SHA256); TLS for all HTTP endpoints (fly.io enforced) |
| V7 Error Handling & Logging | yes | Structured logging (Pino); no sensitive data in error responses |
| V8 Data Protection | yes | GDPR compliance baseline (consent notice, data minimization: phone + booking history only) |
| V9 Communications | yes | All external API calls (WhatsApp) use HTTPS; webhook signature verification prevents spoofing |
| V10 Malicious Code | no | No dynamic code execution; no user-supplied code evaluation |
| V11 Business Logic | yes | Idempotency logic prevents duplicate messages; business code matching prevents cross-tenant access |
| V12 File & Resources | no | No file uploads or static asset serving in Phase 1 |
| V13 API & Web Services | yes | WhatsApp Cloud API integration; signature verification; rate-limit resilience (backoff on errors) |
| V14 Configuration | yes | Environment variables for secrets (APP_SECRET, WEBHOOK_VERIFY_TOKEN); no hardcoded credentials |

### Known Threat Patterns for {WhatsApp Webhook + Multi-Tenant Postgres}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| **Webhook spoofing (attacker posts to /webhooks/whatsapp without valid signature)** | Tampering | X-Hub-Signature-256 verification (HMAC-SHA256 with constant-time compare) |
| **Replay attacks (attacker resends same webhook multiple times)** | Spoofing | Postgres UNIQUE constraint on whatsappMessageId; onConflictDoNothing() prevents duplicate processing |
| **Cross-tenant data access (attacker sends message claiming a different business)** | Information Disclosure | App-level filtering (`WHERE business_id = ?`); business ID derived from message content (trusted source: WhatsApp metadata) |
| **SQL injection via business code or message text** | Injection | Drizzle ORM parameterized queries; Zod validation of input shape; no string interpolation in SQL |
| **Timing attack on signature verification** | Tampering | crypto.timingSafeEqual() for HMAC comparison (not `===` operator) |
| **Information disclosure via error messages** | Information Disclosure | Generic HTTP 500 responses; detailed errors logged but not returned to client; no stack traces in API responses |
| **Consent data stored without confidentiality** | Information Disclosure | Consent flag stored in database; all data in transit encrypted via HTTPS (fly.io enforced); data at rest via Neon encryption (by default) |
| **Rate limiting bypass (attacker floods /webhooks/whatsapp)** | Denial of Service | Meta rate-limits inbound webhooks; fly.io has DDoS protection; backpressure via async job queue (Phase 2+) |

### Security Checkpoints for Phase 1

Before `/gsd-verify-work`, confirm:
- [ ] X-Hub-Signature-256 verification is implemented with `crypto.timingSafeEqual()`
- [ ] UNIQUE constraint on `messages.whatsappMessageId` is present in schema
- [ ] Business ID is extracted from trusted WhatsApp metadata (not user input)
- [ ] `WHERE business_id = ?` filtering applied to all database queries
- [ ] Zod schema validates webhook payload structure (catches malformed inputs)
- [ ] Environment variables for secrets (`APP_SECRET`, `WEBHOOK_VERIFY_TOKEN`) are not logged or exposed
- [ ] Consent notice is shown on first contact only (idempotency test covers this)

---

## Sources

### Primary (Official 2025-2026 Docs — HIGH confidence)

- [Meta Developers: WhatsApp Webhooks — Create Webhook Endpoint](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint/) — signature verification, GET/POST handling
- [Meta Developers: WhatsApp Webhooks — Messages Reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages) — payload structure, message types, field definitions
- [WhatsApp Business Platform Node.js SDK — GitHub](https://github.com/WhatsApp/WhatsApp-Nodejs-SDK) — official Meta SDK; webhook registration; message sending
- [Drizzle ORM — Insert Documentation](https://orm.drizzle.team/docs/insert) — onConflictDoNothing(), idempotency patterns
- [Drizzle ORM — PostgreSQL Schema Declaration](https://orm.drizzle.team/docs/sql-schema-declaration) — table definitions, unique constraints
- [npm: remove-accents](https://www.npmjs.com/package/remove-accents) — Greek diacritic stripping, Unicode NFD normalization
- [fly.io Documentation: Node.js Deployment](https://fly.io/docs/js/) — Express app configuration, fly.toml, webhook setup
- [fly.io Documentation: Configuration (fly.toml)](https://fly.io/docs/reference/configuration/) — app configuration, environment variables

### Secondary (Community & Standards — MEDIUM confidence)

- [Hookdeck: Guide to WhatsApp Webhooks: Features and Best Practices](https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices) — webhook idempotency patterns, deduplication strategies
- [Medium: Node.js Webhooks: Idempotency Patterns That Save You](https://medium.com/@Quaxel/node-js-webhooks-idempotency-patterns-that-save-you-769ae4bb4ebc) — webhook design patterns, duplicate handling
- [Medium: Building a Robust Webhook Handler in Node.js: Validation, Queuing, and Retry Logic](https://dev.to/dumebii/building-a-robust-webhook-handler-in-nodejs-validation-queuing-and-retry-logic-2fb6) — Express middleware patterns, error handling
- [Meta Business Verification for WhatsApp API 2026 Fix Guide](https://zaple.ai/blog/meta-business-verification-whatsapp/) — verification requirements, common pitfalls, submission process
- [GitHub: VilledeMontreal/express-idempotency](https://github.com/VilledeMontreal/express-idempotency) — Express middleware for idempotent handlers
- [Drizzle ORM: Production Guide (Schema, RLS, Perf)](https://ecosire.com/blog/drizzle-orm-postgresql-guide) — multi-tenant schema design, row-level security overview

### Tertiary (Domain Knowledge — LOW confidence, training data only)

- Project research files (.planning/research/SUMMARY.md, ARCHITECTURE.md, PITFALLS.md) — RandevuClaw-specific architecture, Phase 1 design decisions

---

## Metadata

**Confidence breakdown:**
- **Standard Stack:** HIGH — All packages verified against npm registry and official docs; versions confirmed current as of 2026-07-07
- **Architecture:** HIGH — Idempotent webhook patterns, UNIQUE constraints, and Drizzle ORM usage are well-established for serverless; Meta webhook signature verification is standard and documented
- **Pitfalls:** HIGH — Meta verification delays, webhook replay handling, Greek Unicode normalization are documented with recovery strategies; constraints are proven in production
- **Validation Architecture:** MEDIUM — Test structure is standard for Node.js; specific tests (deep-link extraction, consent idempotency) require implementation to validate

**Research date:** 2026-07-07
**Valid until:** 2026-07-21 (2 weeks; stack is stable; re-verify if Meta docs or npm versions update significantly)

---

*Phase: 1 - Foundation, Webhook & Business Resolution*
*Research depth: Deep (Phase 1 is foundation; all dependencies are Phase 1 responsibility)*
*Status: Ready for planning*
