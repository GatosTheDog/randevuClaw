---
phase: 01-foundation-webhook-business-resolution
reviewed: 2026-07-07T00:00:00Z
depth: standard
files_reviewed: 33
files_reviewed_list:
  - .env.example
  - .gitignore
  - drizzle.config.ts
  - fly.toml
  - jest.config.js
  - migrations/0000_cloudy_expediter.sql
  - migrations/meta/0000_snapshot.json
  - migrations/meta/_journal.json
  - package.json
  - src/business/resolver.ts
  - src/config.ts
  - src/consent/checker.ts
  - src/database/db.ts
  - src/database/queries.ts
  - src/database/schema.ts
  - src/database/seed.ts
  - src/index.ts
  - src/server.ts
  - src/utils/diacritics.ts
  - src/utils/logger.ts
  - src/utils/validation.ts
  - src/webhooks/whatsapp.ts
  - src/whatsapp/client.ts
  - tests/business-resolver.test.ts
  - tests/config.test.ts
  - tests/consent-schema.test.ts
  - tests/consent.test.ts
  - tests/fixtures.test.ts
  - tests/idempotency.test.ts
  - tests/jest.setup.ts
  - tests/webhook.test.ts
  - tests/whatsapp-client.test.ts
  - tsconfig.json
findings:
  critical: 2
  warning: 3
  info: 2
  total: 7
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-07-07T00:00:00Z
**Depth:** standard
**Files Reviewed:** 33
**Status:** issues_found

## Summary

Reviewed the full Phase 1 foundation: Drizzle schema/migrations/seed (session A), and the webhook handler, business resolver, WhatsApp client, and consent/dedup logic (session B), plus their integration seams. The two sessions' contracts line up well at the type/signature level — `Business`, `ClientBusinessRelationship`, and every `queries.ts` export match exactly what `webhook.ts` and `consent/checker.ts` call, and `Config`'s shape matches every consumer. `tsc --noEmit` and the 34-test suite passing is consistent with that seam being clean.

However, tracing the actual request-handling logic (not just types) surfaced two data-loss-risk bugs that the current tests don't exercise: an unhandled unique-constraint race in the first-contact consent path, and a webhook parser that only ever looks at the first message of the first entry/change, silently discarding anything else in the same payload. Both are `data loss risk` per the review's Critical bar and would need fixing before this ships past PoC scale. There are also three lower-severity robustness/quality issues and two info-level cleanups (an unused dependency and an unvalidated external API response shape).

## Critical Issues

### CR-01: Concurrent first-contact messages permanently lose their reply due to an unguarded unique-constraint race

**File:** `src/database/queries.ts:78-93` (root cause), interacting with `src/consent/checker.ts:9-21` and `src/webhooks/whatsapp.ts:53-79`

**Issue:** `insertClientBusinessRelationship` inserts into `client_business_relationships` with no `onConflictDoNothing()`/`onConflictDoUpdate()`, even though the table has a unique index on `(business_id, sender_phone)` (`unique_client_business`, schema.ts:43-46).

`getOrCreateClientRelationship` (checker.ts) does a classic check-then-insert: `findClientBusinessRelationship` → if null, `insertClientBusinessRelationship`. This is not atomic. If the same sender sends two distinct messages to the same business in quick succession (two different WhatsApp message IDs — a very plausible real-world case, e.g. a user typing two lines), both requests pass `insertOrIgnoreMessage` with `'inserted'` (different message IDs, no conflict there), both then race through `getOrCreateClientRelationship`, both see no existing relationship row, and both call `insertClientBusinessRelationship`. The second insert throws a Postgres unique-violation error.

That error is never caught: `handleFoundBusiness` (whatsapp.ts:53-79) only wraps the `sendWhatsAppMessage`/`markMessageProcessed` pair in try/catch — the `getOrCreateClientRelationship` call above it is unguarded, and `handleWebhookPost` itself has no top-level try/catch either (see WR-01). The exception propagates out of the Express async handler, which (Express 5 auto-forwards rejected promises to error middleware) returns a 500 to Meta for that webhook delivery.

The permanent-loss part: the *second* message's row was already inserted into `messages` with status `'received'` before the crash (`insertOrIgnoreMessage` succeeded). When Meta retries the failed (500) webhook delivery, `insertOrIgnoreMessage` now returns `'ignored'` (row already exists) and `handleFoundBusiness` returns immediately — the reply is never sent, the row is never marked `'processed'`, and there is no other retry path. The customer's second message is silently dropped forever with no reply and no error surfaced anywhere except a log line for the original 500.

**Fix:** Make the insert idempotent and re-fetch on conflict, e.g.:
```typescript
export async function insertClientBusinessRelationship(
  businessId: number,
  senderPhone: string
): Promise<ClientBusinessRelationship> {
  const rows = await db
    .insert(clientBusinessRelationships)
    .values({ businessId, senderPhone, consentGiven: true, consentTimestamp: new Date() })
    .onConflictDoNothing()
    .returning();

  if (rows[0]) return rows[0];

  // Lost the race — the winning insert already created the row; fetch it.
  const existing = await findClientBusinessRelationship(businessId, senderPhone);
  if (!existing) throw new Error('Failed to read client relationship after conflict');
  return existing;
}
```
Additionally wrap the whole `handleWebhookPost` body (see WR-01) so any remaining unexpected error still returns 200 to Meta instead of 500, per the invariant already documented elsewhere in this file ("Meta must always get 200").

### CR-02: Only the first message of the first entry/change in a webhook payload is ever processed — additional bundled messages are silently and permanently discarded

**File:** `src/webhooks/whatsapp.ts:113`

**Issue:**
```typescript
const message = payload.entry[0]?.changes[0]?.value?.messages?.[0];
```
WhatsApp Cloud API webhook payloads can (and per Meta's documented behavior, do) contain more than one entry, more than one change, and/or more than one item in `messages[]` in a single POST — e.g. when a user sends several messages in quick succession, or when a business/app is subscribed across multiple phone numbers. This code unconditionally takes only `entry[0].changes[0].value.messages[0]` and ignores everything else in the payload.

Because the handler always responds `200 OK` after processing just that one message (line 129), Meta considers the entire webhook event successfully delivered and will not retry or resend the remaining messages in `messages[]` (or the other entries/changes). Those messages are lost with no persisted record, no reply, and no log entry indicating anything was skipped — directly undermining the core value proposition ("a client can book... entirely through a WhatsApp conversation") for the exact case of a client sending more than one message in a burst.

**Fix:** Iterate over all entries/changes/messages instead of indexing `[0]` three times:
```typescript
for (const entry of payload.entry) {
  for (const change of entry.changes) {
    for (const message of change.value.messages ?? []) {
      if (message.type !== 'text' || !message.text) continue;
      const code = extractAndNormalizeBusinessCode(message.text.body);
      const business = code ? await findBusinessBySlug(code) : null;
      if (business) {
        await handleFoundBusiness(message.id, business, message.from, message.text.body);
      } else {
        await handleNotFoundBusiness(message.id, message.from);
      }
    }
  }
}
res.status(200).send('OK');
```
(Sequential `await` in the loop is fine for Phase 1 volume; parallelization is a performance concern, out of scope here.)

## Warnings

### WR-01: `handleWebhookPost` has no top-level try/catch — any unexpected error returns 500 to Meta instead of the required 200

**File:** `src/webhooks/whatsapp.ts:95-130`

**Issue:** The function only wraps `JSON.parse`/`validateWebhookPayload` (lines 105-111) in try/catch. Everything else — signature verification (line 99, which calls `crypto.createHmac(...).update(rawBody)` and will throw a `TypeError` synchronously if `rawBody` isn't actually a `Buffer`, e.g. if the request's `Content-Type` doesn't exactly type-match `application/json` and `express.raw()` left `req.body` as `{}`), `findBusinessBySlug`, `handleFoundBusiness`, `handleNotFoundBusiness` — is unguarded. Any transient failure here (DB hiccup, the race in CR-01, a malformed Content-Type header) turns into an uncaught rejection that Express 5 auto-forwards to the generic error middleware in `server.ts:13-16`, which responds 500. The codebase elsewhere explicitly treats "Meta must always get 200" as a hard invariant (see the comment in `whatsapp.ts:107` area and `tests/idempotency.test.ts:107`), so this is an inconsistently-enforced contract.

**Fix:** Wrap the body of `handleWebhookPost` (from the signature check through the final response) in try/catch, log the error, and always respond 200:
```typescript
export async function handleWebhookPost(req: Request, res: Response): Promise<void> {
  try {
    // ... existing logic ...
  } catch (err) {
    logger.error({ err }, 'Unhandled error processing webhook');
  } finally {
    if (!res.headersSent) res.status(200).send('OK');
  }
}
```

### WR-02: Business-code extraction takes the *first* hyphenated alphanumeric token in the message, which can misidentify the slug

**File:** `src/business/resolver.ts:5-10`

**Issue:** `HYPHENATED_SLUG_RE` and `extractBusinessCode` return the first regex match in the message text. Any other ASCII hyphenated token appearing earlier in a free-form Greek message — a phone number fragment ("690-1234-567"), a time range ("9-5", "18-00" won't match since no letters but "10-30" would if letters absent... actually digits alone still match `[a-zA-Z0-9]+`), a date, or an order code — will be extracted instead of the actual business slug that appears later in the same message. Since Phase 1's UX is "chat with the shared number, mention the business," and later phases lean into free-form conversational Greek (per CLAUDE.md's core value prop), this is a realistic failure mode, not a hypothetical one: the resolver would silently return "business not found" for a message that does in fact reference a known business, purely because of extraction order. None of the existing tests place a distracting hyphenated token before the real slug.

**Fix:** At minimum, when multiple candidates exist, try each hyphenated match (not just the first) against `findBusinessBySlug` until one resolves, rather than assuming positional priority:
```typescript
export function extractAllBusinessCodeCandidates(messageText: string): string[] {
  return [...messageText.matchAll(new RegExp(HYPHENATED_SLUG_RE, 'g'))].map((m) => m[0]);
}
```
and have the webhook handler loop through candidates, calling `findBusinessBySlug` for each until a match is found, falling back to not-found only if none resolve.

### WR-03: pino `redact` config only guards an exact top-level key match, not the more common nested-object logging pattern

**File:** `src/utils/logger.ts:8-11`

**Issue:** `redact.paths: ['appSecret', 'databaseUrl', 'whatsappAccessToken', 'webhookVerifyToken']` only redacts those keys when they appear at the top level of the object passed to a log call, i.e. it protects `logger.info(config)` (spreading `config`'s own keys as the log object) but does **not** protect the much more idiomatic pino call pattern `logger.info({ config }, 'debug dump')` (config nested one level under a `config` key) or any other nesting depth — pino's own docs recommend wildcard paths (e.g. `'*.databaseUrl'`) for that. The comment in the file ("this prevents an accidental future `logger.info(config)` from leaking secrets") documents the intent but the implementation only covers the narrower, less-likely-to-be-written call shape.

**Fix:**
```typescript
redact: {
  paths: [
    'appSecret', 'databaseUrl', 'whatsappAccessToken', 'webhookVerifyToken',
    '*.appSecret', '*.databaseUrl', '*.whatsappAccessToken', '*.webhookVerifyToken',
    'config.appSecret', 'config.databaseUrl', 'config.whatsappAccessToken', 'config.webhookVerifyToken',
  ],
  censor: '[REDACTED]',
},
```

## Info

### IN-01: `remove-accents` is a declared dependency but is never imported anywhere in the codebase

**File:** `package.json:24`

**Issue:** `"remove-accents": "^0.5.0"` is listed under `dependencies`, but `src/utils/diacritics.ts` (the only place accent-stripping happens) reimplements the behavior manually via `text.normalize('NFD').replace(/\p{M}/gu, '')` and never imports the package. A repo-wide search (`grep -rn "remove-accents" src/ tests/`) finds zero usages. This is dead weight in the dependency tree (install size, audit/attack surface, version-bump churn) left over from what looks like an earlier approach that was replaced by the NFD-based implementation.

**Fix:** Remove `remove-accents` from `package.json` dependencies (and re-run `npm install` to update the lockfile), or, if there was a reason to keep it (e.g. planned use in a later phase for full Latin transliteration), add a comment explaining why it's present but unused.

### IN-02: `sendWhatsAppMessage` trusts the WhatsApp API's success-response shape without validation

**File:** `src/whatsapp/client.ts:33-34`

**Issue:**
```typescript
const data = (await response.json()) as { messages: Array<{ id: string }> };
return { messageId: data.messages[0].id, status: 'sent' };
```
This is a blind type assertion with no runtime check. If the WhatsApp Cloud API ever returns a 2xx with an unexpected body shape (e.g. `messages: []`, or a field rename in a future API version), `data.messages[0].id` throws a raw `TypeError: Cannot read properties of undefined`. This is caught further up by the callers' generic try/catch (so it doesn't crash the process), but it produces an unhelpful, undifferentiated error log instead of a clear "unexpected API response shape" message, making production debugging harder.

**Fix:**
```typescript
const data = (await response.json()) as { messages?: Array<{ id: string }> };
if (!data.messages?.[0]?.id) {
  throw new Error(`WhatsApp API returned success but no message id: ${JSON.stringify(data)}`);
}
return { messageId: data.messages[0].id, status: 'sent' };
```

---

_Reviewed: 2026-07-07T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
