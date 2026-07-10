# Domain Pitfalls: v1.1 Multi-Bot Telegram & Onboarding Migration

**Project:** RandevuClaw v1.1
**Researched:** 2026-07-10
**Domain:** Migrating from single shared Telegram bot to per-business bots with owner self-serve onboarding, multi-tenant isolation, GDPR deletion, and rate-limit resilience.
**Confidence:** HIGH

---

## Critical Pitfalls

These mistakes cause data corruption, security breaches, or complete architecture rewrites.

### Pitfall 1: Telegram Bot Token Exposure in Webhook URL Path

**What goes wrong:**
Storing bot token in the URL path (e.g., `/webhooks/telegram/:botToken`) or logging it during webhook registration makes the token visible in HTTP access logs, WAF logs, Cloudflare analytics, and error stack traces. Once exposed, an attacker immediately controls the bot and can impersonate your platform, send fake booking confirmations, collect client messages, or delete events.

**Why it happens:**
Developers assume the webhook URL is "secret" because it's not published. Telegram's setWebhook API doesn't warn that tokens should never appear in URLs. Early multi-bot implementations often use tokens in URLs for "easy" routing without realizing the security implication.

**Consequences:**
- Bot takeover: attacker sends malicious messages, collects booking/payment data
- Reputation damage: business receives fake confirmations or cancellations
- Data breach: all conversations with clients become readable to attacker
- Requires immediate bot token revocation and registration with new token (1-2 business hours downtime)

**Prevention:**
1. **Never include bot token in URL paths.** Extract from request headers or body after signature verification.
2. **Use bot_id (UUID) in URL, not token:** `/webhooks/telegram/:botId` → look up token from database → verify signature with token.
3. **Store bot_token → webhook_url mapping in database**, not in the URL itself. Webhook registration should store the mapping, not expose it.
4. **Verify X-Telegram-Bot-Api-Secret-Token header first** before looking up any database records. This signature is your first gate.
5. **Rotate tokens immediately on suspected exposure.** Use `deleteWebhook()` then `setWebhook()` with a new URL.
6. **Scan git history for leaked tokens.** Use `git-secrets` or `trufflehog` in CI; fail deployment if tokens are found.
7. **Filter tokens from all logs.** Redact bot_token values in application logs, error tracking (Sentry), and fly.io logs.

**Detection:**
- Alert on unusual `setWebhook` calls with new URLs
- Monitor for spike in bot messages (sudden volume change)
- Alerts for permission failures (bot attempts to send message but is revoked)
- Regular git history audit for exposed tokens

**Phase:** Phase 1 (Infrastructure Setup) — This must be addressed before registering the first webhook. Include token security in the webhook registration design checklist.

---

### Pitfall 2: Webhook Conflict — "another webhook is active" on Token Reuse

**What goes wrong:**
When transitioning to per-business bots, if a bot token is registered with an old webhook URL and you try to set it to a new URL, Telegram returns: `Error: Conflict: another webhook is active`. The service fails to register, hangs waiting for webhooks that never arrive, and customers cannot reach the bot.

This happens because Telegram only allows **one active webhook per bot token**. If an old webhook is still set, the new registration fails. Multiple environments (dev, staging, prod) or app instances competing for the same token also trigger this conflict.

**Why it happens:**
Developers assume old webhooks are automatically cleaned up or can be skipped. No explicit delete-then-set pattern. Multiple environments or app instances try to claim the same token without coordinating.

**Consequences:**
- Bot becomes unreachable; customers cannot book or cancel
- Service restart worsens the problem (tries to set webhook again, fails again)
- Silent failure: the app logs a webhook setup error but continues, leading customers to think the bot is live when it's actually broken
- Recovery requires manual BotFather intervention or token revocation

**Prevention:**
1. **Always delete old webhook before setting new one:**
   ```typescript
   // On service startup, before setWebhook:
   try {
     await bot.deleteWebhook();  // Idempotent; safe even if no webhook was set
   } catch (e) {
     // Log but don't fail; deleteWebhook might not exist on new tokens
   }
   const result = await bot.setWebhook(newUrl, { secret_token: newSecret });
   if (!result) throw new Error('Failed to set webhook');
   ```

2. **Verify webhook configuration on startup.** Call `getWebhookInfo()` and compare expected vs. actual URL. Raise an alarm if mismatch.
3. **Use separate tokens per environment.** Each environment (dev, staging, prod) gets its own bot from BotFather. Prevents conflicts and enforces isolation.
4. **Document token → environment mapping.** Maintain a table of token ↔ business_id ↔ environment to detect ownership conflicts.
5. **Add webhook healthcheck.** Telegram sends a test request to your webhook URL when `setWebhook()` is called. Log the result; if healthcheck fails, reject the webhook configuration change.
6. **Implement startup verification.** If webhook setup fails at startup, fail the service entirely (don't proceed with stale config). Force manual intervention.

**Detection:**
- Alert on webhook setup failures in startup logs
- Alert if `getWebhookInfo()` shows unexpected URL
- Daily audit: compare active webhooks in Telegram API vs. expected configuration
- Health check: test webhook endpoints daily (send test message, verify received)

**Phase:** Phase 1 (Infrastructure Setup) — Implement webhook lifecycle management (delete + verify) before routing logic. Include webhook health checks in startup.

---

### Pitfall 3: Multi-Bot Express Routing — Shared Middleware State Leaks Across Bots

**What goes wrong:**
When handling multiple bot tokens in a single Express app (e.g., `/webhooks/telegram/:botId`), shared middleware state (in-memory caches, request context, global variables) causes cross-bot data leakage:

```typescript
// WRONG: Shared state
let currentOwner = null;  // Global; shared across all requests
let pendingBooking = null;  // Another global

app.post('/webhooks/telegram/:botId', async (req, res) => {
  const owner = await db.getOwner(req.body.message.from.id);
  currentOwner = owner;  // Bot A sets this
  pendingBooking = req.body.message.text;  // Bot A sets this
  
  // Concurrent request from Bot B reads currentOwner and thinks it belongs to Bot B
  // Booking intended for business A gets routed to business B
  // Owner data from business A is visible to business B's handlers
});
```

One bot's owner data is visible to another bot. Client messages from business A are routed to business B's logic.

**Why it happens:**
Developers migrate from single-bot to multi-bot by adding a `:botId` parameter, assuming request handlers are isolated. But global/module-level state is shared across all requests. Express middleware is also shared. Request handler isolation holds only if there's no async suspension or callback-based code.

**Consequences:**
- Data leakage: business A's clients see business B's availability, prices, or bookings
- Booking corruption: a booking intended for business A is stored for business B
- Service degradation: one bot's crash affects all bots
- Silent corruption: no obvious error; incorrect behavior masquerades as a bug elsewhere

**Prevention:**
1. **Never use global or module-level variables for request state.** Every request must carry its context from start to finish.

2. **Use request-scoped context (res.locals or AsyncLocalStorage):**
   ```typescript
   app.post('/webhooks/telegram/:botId', async (req, res) => {
     res.locals.botId = req.params.botId;
     res.locals.bot = bots[req.params.botId];
     res.locals.owner = await db.getOwner(req.body.message.from.id);
     // Pass res.locals to all downstream functions
     await handleBookingRequest(res.locals);
   });
   ```

3. **Isolate session stores per bot token.** Don't use in-memory caches. Use Neon or Redis with bot_token as key prefix:
   ```typescript
   const sessionKey = `${botToken}:${userId}:onboarding_state`;
   const session = await redis.get(sessionKey);
   ```

4. **Avoid middleware that modifies global state.** Every middleware must leave global state unchanged between requests.

5. **Test concurrent requests from multiple bots.** Unit tests won't catch cross-bot isolation failures. Use integration tests or load tests hammering multiple bots in parallel.

6. **Code review checklist:** In every bot handler, verify:
   - No assignments to global variables
   - No in-memory caches without bot_token isolation
   - All state read from `res.locals` or database

**Detection:**
- Integration tests sending concurrent requests to different bots, verifying isolation
- Logs that correlate `botId` with every operation
- Unit tests for request-scoped helpers (ensure no shared state)
- Smoke test: create two business bots, send concurrent messages, verify data doesn't leak

**Phase:** Phase 2 (Multi-Bot Routing) — Build request isolation patterns before writing any handler logic. This is foundational; retrofitting isolation is expensive.

---

### Pitfall 4: Telegram Signature Verification — Wrong Secret Per Token

**What goes wrong:**
Telegram sends an `X-Telegram-Bot-Api-Secret-Token` header with each webhook request. If you verify signatures with a shared secret or the wrong token's secret, attackers can forge webhooks:

```typescript
// WRONG: Shared secret for all bots
const sharedSecret = process.env.TELEGRAM_SECRET;  // Used for ALL bots
const receivedSignature = req.headers['x-telegram-bot-api-secret-token'];
const expectedSignature = crypto.createHmac('sha256', sharedSecret)
  .update(JSON.stringify(req.body))
  .digest('hex');
// If attacker knows sharedSecret, they can forge messages for ANY bot
```

Attacker sends fake booking cancellations, confirmations, or payment notifications to any bot in your system.

**Why it happens:**
Developers assume one shared secret is simpler. They don't realize that secrets must be unique per bot or that Telegram's header name is generic (doesn't hint at per-bot uniqueness). The security implication isn't obvious until after implementation.

**Consequences:**
- Forged webhooks: attacker sends fake cancellations, bookings, or payments
- Business reputation: customers see malicious or false messages
- Financial impact: fake cancellations disrupt revenue
- Regulatory: GDPR violations if forged data incorrectly deletes customer records

**Prevention:**
1. **Generate unique secret token per bot.** When onboarding a business, create a random secret:
   ```typescript
   const botSecret = crypto.randomBytes(32).toString('hex');
   await db.saveBotConfig({
     business_id,
     bot_token,
     bot_secret_token: botSecret  // Store securely in Neon
   });
   ```

2. **Bind secret verification to the bot_token in request.** Extract bot_id from URL, look up its secret, verify with that secret:
   ```typescript
   app.post('/webhooks/telegram/:botId', async (req, res) => {
     const botConfig = await db.getBotConfig(req.params.botId);
     const receivedSignature = req.headers['x-telegram-bot-api-secret-token'];
     const expectedSignature = crypto
       .createHmac('sha256', botConfig.bot_secret_token)
       .update(JSON.stringify(req.body))
       .digest('hex');
     
     // Constant-time comparison (prevents timing attacks)
     if (!crypto.timingSafeEqual(
       Buffer.from(receivedSignature),
       Buffer.from(expectedSignature)
     )) {
       return res.status(401).send('Unauthorized');
     }
   });
   ```

3. **Use constant-time comparison** (`crypto.timingSafeEqual`) to prevent timing attacks.

4. **Log verification failures** with botId, but never log the secret itself:
   ```typescript
   if (verificationFailed) {
     logger.warn('Webhook signature verification failed', {
       botId: req.params.botId,
       receivedSignaturePrefix: receivedSignature.substring(0, 8),
       reason: 'signature_mismatch'  // Don't log actual values
     });
   }
   ```

5. **Rotate secrets if exposed.** Call `setWebhook()` again with a new secret.

**Detection:**
- Alert on verification failure spikes (401 Unauthorized responses)
- Rate of failed signatures per botId
- Unexpected bot behavior (messages from unknown sources)
- Review webhook logs for unsigned or incorrectly-signed requests

**Phase:** Phase 2 (Multi-Bot Routing) — Implement per-token signature verification BEFORE handling any webhooks. Make this part of the webhook registration checklist.

---

### Pitfall 5: Owner Onboarding State Machine — Incomplete State & Dropout Recovery

**What goes wrong:**
Owner begins onboarding via chat:
1. "Hi, I want to set up my business"
2. Bot: "What's your business name?"
3. Owner: "Pilates Athens"
4. Bot: "What are your hours?"
5. **Owner closes chat, forgets, comes back 2 hours later**
6. Owner: "Monday to Friday, 9am-6pm"
7. Bot **doesn't know if this is continuing the old conversation or starting fresh.** It may:
   - Ask for the business name again (confusing)
   - Ignore the hours because it lost the onboarding state
   - Partially save data, leaving the database in an undefined state

Also: what if the same message arrives twice (network retry)? The bot might execute onboarding twice, creating duplicate business configs.

**Why it happens:**
Stateless webhook handlers don't track where in the onboarding flow the owner is. Each message is processed independently. No resumption logic; no idempotency. The onboarding "flow" is implicit in the code, not explicitly modeled.

**Consequences:**
- Owner frustration: repeated questions, unclear progress
- Data corruption: partial business configs, duplicate services/hours
- Abandoned onboarding: owners give up and never complete setup
- Silent failures: database has incomplete/inconsistent owner data

**Prevention:**
1. **Model onboarding as explicit state machine:**
   ```typescript
   enum OnboardingState {
     Started = 'started',
     AwaitingBusinessName = 'awaiting_business_name',
     AwaitingHours = 'awaiting_hours',
     AwaitingServices = 'awaiting_services',
     Completed = 'completed'
   }

   interface OnboardingSession {
     owner_id: string;
     bot_id: string;
     state: OnboardingState;
     business_name?: string;
     hours?: string;
     services?: string[];
     started_at: Date;
     last_message_at: Date;
   }
   ```

2. **Persist state in database.** On each message, load session state, process message, update state, save:
   ```typescript
   const session = await db.getOnboardingSession(ownerId);
   if (!session) throw new Error('Onboarding not started');
   
   switch (session.state) {
     case OnboardingState.AwaitingBusinessName:
       session.business_name = req.body.message.text;
       session.state = OnboardingState.AwaitingHours;
       break;
     // ... other states
   }
   await db.saveOnboardingSession(session);
   ```

3. **Implement idempotent state transitions.** Detect duplicate messages and don't update state twice:
   ```typescript
   const dedupeKey = `onboarding:${ownerId}:${messageId}`;
   const alreadyProcessed = await redis.get(dedupeKey);
   if (alreadyProcessed) {
     return res.status(200).send('Already processed');
   }
   // Process the message...
   await redis.setex(dedupeKey, 3600, 'done');  // 1-hour expiry
   ```

4. **Add timeout for incomplete onboarding.** If an owner hasn't progressed in 7 days, reset and ask to restart.

5. **Provide resume/status command.** Owner types `/status` to see where they are and skip completed steps.

6. **Log state transitions.** Audit trail: who started, who completed, what data was saved.

**Detection:**
- Onboarding sessions in "awaiting_*" state for >24 hours
- Duplicate onboarding sessions for the same owner
- Business configs with missing required fields
- Error log spike during onboarding flows

**Phase:** Phase 3 (Owner Onboarding) — Implement state machine and database persistence BEFORE handling first owner message. State machine is the foundation; retrofit is expensive.

---

### Pitfall 6: Token Registration Race — Duplicate Bot Claims

**What goes wrong:**
Two owners try to register the same bot token simultaneously:

1. Owner A: "Set up my bot @mybusiness_bot" → provides token: `123:ABCDEF`
2. Owner B: "Set up my bot" → provides the same token: `123:ABCDEF`
3. Both requests hit your API at the same time.
4. Both check: `SELECT * FROM bots WHERE bot_token = '123:ABCDEF'` — both see it's free.
5. Both call `setWebhook()` and save to the database.
6. Now two business rows point to the same bot token. Webhook requests are routed to the first business (A), but business B thinks they own the token and can manage the bot.

**Why it happens:**
Check-then-act is not atomic. Time-of-check to time-of-act window allows concurrent registrations. No database uniqueness constraint. Developers assume sequential webhook processing.

**Consequences:**
- Bot token belongs to business A in the database, but business B thinks they own it.
- Webhook routing sends B's customers' messages to A's handlers.
- Ownership confusion: both businesses claim ownership; resolving requires manual intervention.
- Data corruption: a booking from B's customer is stored under A's business.

**Prevention:**
1. **Add UNIQUE database constraint on bot_token:**
   ```sql
   CREATE UNIQUE INDEX idx_bot_token_unique ON bots(bot_token);
   ```
   This ensures the database rejects duplicate tokens at the storage layer.

2. **Use atomic upsert or INSERT with conflict handling:**
   ```typescript
   const result = await db
     .insert(bots)
     .values({ bot_token, business_id, bot_secret_token })
     .onConflict('bot_token')
     .doThrow();  // Throw error if token already registered
   if (!result) {
     throw new Error('Bot token already in use');
   }
   ```

3. **Verify token ownership with Telegram API.** After registration, call `getMe()` to validate:
   ```typescript
   const botMe = await bot.getMe();  // Validates token and gets bot info
   if (!botMe.username) throw new Error('Invalid bot token');
   ```

4. **Return clear error to owner if token is in use:**
   ```
   Sorry, this bot token is already registered by another business.
   Please contact support or create a new bot in BotFather.
   ```

5. **Implement distributed lock for registration if needed.** Use Redis SETNX or database transaction lock:
   ```typescript
   const lock = await redis.set(
     `bot_registration_lock:${botToken}`,
     '1',
     'NX',
     'EX',
     30  // 30-second lock
   );
   if (!lock) {
     throw new Error('Registration in progress; please try again');
   }
   ```

**Detection:**
- Database uniqueness constraint violations in error logs
- Duplicate bot_token entries (run audit query)
- Mismatches between expected and actual bot ownership

**Phase:** Phase 3 (Owner Onboarding) — Add uniqueness constraint BEFORE owner registration logic. Also verify token ownership with Telegram API.

---

### Pitfall 7: Migration from Single Shared Bot — Existing Clients Orphaned

**What goes wrong:**
v1.0 operated with a single shared bot token. In v1.1, each business has its own bot. You deploy the per-business bot architecture. But the old shared bot is still running or clients still have the old chat link.

Result:
- Existing clients continue messaging the old shared bot, expecting it to work.
- The old bot is no longer maintained; messages go unanswered or are processed by stale code.
- New clients don't know about the per-business bots.
- Confusion: which bot should I use?

**Why it happens:**
Big-bang migration: v1.0 is shut down completely, v1.1 deployed. No dual-mode operation. No migration messaging. The platform assumes all clients will switch overnight.

**Consequences:**
- Customer support burden: existing clients confused why the old bot doesn't respond
- Lost bookings: clients give up and use competitors
- Reputation damage: perceived service outage or abandonment
- Data loss: if the old shared bot's database is shut down, existing bookings orphaned

**Prevention:**
1. **Operate both architectures in parallel during transition.** Keep the old shared bot active for 2–4 weeks after deploying v1.1 per-business bots.

2. **Detect old shared bot messages and redirect:**
   ```typescript
   // In old shared bot handler:
   if (clientKnownToBusiness && businessNowHasPerBotId) {
     return bot.sendMessage(chatId, `
       We've upgraded! Your business now has a dedicated bot:
       @${business.per_bot_username}
       Click to switch: [link to new bot]
       All your bookings have been moved.
     `);
   }
   ```

3. **Migrate existing bookings to per-business schema.** Write a migration script:
   ```sql
   -- Copy bookings from old shared bot table to new per-business schema
   INSERT INTO bookings (business_id, customer_id, slot_time, status, created_at)
   SELECT b.business_id, c.customer_id, b.slot_time, b.status, b.created_at
   FROM legacy_bookings b
   JOIN customers c ON b.customer_phone = c.phone
   WHERE b.migrated_at IS NULL;
   UPDATE legacy_bookings SET migrated_at = NOW() WHERE migrated_at IS NULL;
   ```

4. **Send migration message to all existing clients** via the old bot:
   ```
   Your booking bot has moved to a new dedicated number!
   We've moved your bookings to: @${business.per_bot_username}
   All your appointments are safe; no action needed.
   ```

5. **Support dual-mode during transition.** The old shared bot can query the database and forward relevant messages to the new per-business bot, so clients aren't completely orphaned.

6. **Monitor old bot usage.** Track how many clients are still messaging the old bot. Set a deadline for shutdown (e.g., 4 weeks after migration).

**Detection:**
- Spike in "bot not responding" support tickets
- Drop in booking activity during migration period
- Orphaned bookings (bookings with business_id but no corresponding per_bot)

**Phase:** Phase 2 (Multi-Bot Routing) — Plan migration messaging and backward compatibility BEFORE per-business bot launch. Migration is critical to avoid user churn.

---

## Moderate Pitfalls

These mistakes cause data inconsistency or service degradation but are recoverable.

### Pitfall 8: GDPR Deletion — Cascade Delete Breaks Audit Trails

**What goes wrong:**
A customer requests deletion under GDPR. Your code deletes the customer record via:
```sql
DELETE FROM customers WHERE customer_id = ?;
```

This cascades to delete all bookings, reviews, and audit logs for that customer. Later, a business owner disputes a chargeback or questions a booking. You can't prove the booking existed or was completed—the audit trail is gone. Or: a government audit requires proof of deletion compliance, but you have no record of *what* was deleted *when*.

**Why it happens:**
Developers use `DELETE ... CASCADE` as a shortcut. They conflate "personal data deletion" with "all traces of the person must vanish." They don't realize that audit/compliance requires historical records of deleted data.

**Consequences:**
- Lost audit trail: no proof of deletion compliance
- Chargeback disputes: no historical evidence
- Regulatory penalties: EDPB or HDPA fines for incomplete audit logs
- Business risk: can't defend against false claims

**Prevention:**
1. **Use soft deletes (logical deletion), not hard deletes:**
   ```sql
   ALTER TABLE customers ADD COLUMN deleted_at TIMESTAMP;
   UPDATE customers SET deleted_at = NOW() WHERE customer_id = ?;
   -- When querying: WHERE deleted_at IS NULL
   ```

2. **Maintain separate deletion audit log:**
   ```sql
   CREATE TABLE deletion_audit_log (
     id UUID PRIMARY KEY,
     deleted_entity_type VARCHAR,  -- 'customer', 'booking'
     deleted_entity_id UUID,
     deleted_by VARCHAR,  -- 'customer_request', 'admin'
     deleted_at TIMESTAMP,
     reason TEXT,
     retained_fields JSONB  -- Store critical data (booking_id, date) before deletion
   );
   ```

3. **Retain minimal data for compliance:**
   - Delete PII (name, phone, email)
   - Retain anonymous booking history (dates, times, prices) for audit
   - Separate tables: `customers_pii` (deleted) vs. `bookings` (retained with nulled customer_id)

4. **Don't cascade deletes through business relationships.** If customer deletes their account:
   - Delete: customer name, phone, email, payment info
   - Retain: booking records (with customer_id nulled), timestamps

5. **Create deletion report for compliance.** Log every deletion:
   ```
   2026-07-10 15:30: Customer deletion request for customer_id=abc123
   Deleted: name, email, phone, payment methods
   Retained: 5 bookings (2026-06-01 to 2026-07-01)
   Erasure confirmed via audit_log/uuid-xyz
   ```

**Detection:**
- Compare deletion requests to deletion audit log; alert on mismatches
- Monthly audit: verify all requested deletions are logged
- Check for orphaned bookings (booking with no customer record)

**Phase:** Phase 5 (GDPR Deletion) — Design soft-delete strategy BEFORE implementing deletion logic. Retrofitting soft deletes is expensive.

---

### Pitfall 9: GDPR Deletion — Backup Restoration Undoes Deletions

**What goes wrong:**
Customer requests deletion on 2026-07-10. Your system deletes the record and logs it. Later that day, you restore a backup from 2026-07-09 to fix a corruption issue. The "forgotten" customer's data is restored into the live database.

Now the customer's data is back—you've violated GDPR's "Right to be Forgotten."

**Why it happens:**
Backup restoration is not coordinated with deletion tracking. DBAs restore from backup unaware of deletion requests. No pre-restore check against the deletion audit log.

**Consequences:**
- GDPR violation: data subject's data re-appears without consent
- Regulatory penalties: fines up to 4% of global revenue
- Customer breach notification required
- Loss of trust

**Prevention:**
1. **Query deletion audit log before restoring:**
   ```bash
   # Before restore:
   SELECT COUNT(*) FROM deletion_audit_log 
   WHERE deleted_at > backup_timestamp;
   # If count > 0, alert and require manual review
   ```

2. **Use point-in-time recovery aware deletion.** If restoring to time T:
   - Restore database to time T
   - Re-apply all deletions that occurred after T from the audit log

3. **Archive deletion audit logs separately** (Cloudflare R2, S3) so they survive a full database restore.

4. **Create erasure retention marker.** Mark customers as `erasure_requested_at`. During backup restoration, automatically re-delete records with erasure_requested_at < restore_time.

5. **Manual approval for backup restores.** Require a compliance lead to approve restores from before a deletion date.

**Detection:**
- Alert if soft-deleted customer suddenly has active bookings
- Audit: scan for customers with both deleted_at timestamp and active data
- Deletion log audit: verify no customer appears in active tables after deletion_at

**Phase:** Phase 5 (GDPR Deletion) — Coordinate backup strategy with deletion tracking BEFORE handling any deletions. This is a legal requirement, not optional.

---

### Pitfall 10: Gemini Rate Limiting — Naive Exponential Backoff Without Jitter

**What goes wrong:**
Your app hits Gemini rate limit (429 RESOURCE_EXHAUSTED). Your code retries with exponential backoff:

```typescript
let delay = 1000;  // 1 second
for (let attempt = 0; attempt < maxRetries; attempt++) {
  try {
    return await gemini.generateContent(prompt);
  } catch (error) {
    if (error.status === 429) {
      await sleep(delay);
      delay *= 2;  // 1s, 2s, 4s, 8s, ...
    }
  }
}
```

With one instance, this works fine. But with 10 concurrent instances (fly.io autoscale), all hit the rate limit at the same time. All wait 1 second, then retry at the same millisecond. All retry together at 2s, then 4s. This creates a **thundering herd**—the rate limiter never recovers.

**Why it happens:**
Developers assume exponential backoff is sufficient. They don't consider multiple app instances retrying in lockstep. The algorithm is correct for single-client but amplifies with multiple clients.

**Consequences:**
- Bookings fail or are delayed by minutes
- Rate limit window extends (more retries = more 429s)
- Customer experience: booking is slow; they cancel and try competitors
- Operational: rapid alert spam (all instances triggering rate-limit alarms)

**Prevention:**
1. **Add jitter (randomization) to backoff delays.** Full jitter strategy:
   ```typescript
   // Full jitter: random delay between 0 and (2^attempt - 1)
   const maxJitter = Math.pow(2, attempt) - 1;
   const jitterMs = Math.random() * maxJitter * 1000;
   await sleep(jitterMs);
   ```

2. **Respect Retry-After header if provided:**
   ```typescript
   if (error.status === 429) {
     const retryAfter = error.headers['retry-after'] || '60';
     await sleep(parseInt(retryAfter) * 1000);
   }
   ```

3. **Use circuit breaker pattern.** If 429s persist, stop retrying and return user-facing error:
   ```typescript
   const breaker = new CircuitBreaker({
     timeout: 30000,
     errorThresholdPercentage: 50,
     resetTimeout: 60000
   });
   await breaker.fire(async () => gemini.generateContent(prompt));
   ```

4. **Queue requests locally to avoid thundering herd.** Serialize requests:
   ```typescript
   const queue = new PQueue({ concurrency: 1 });  // One at a time
   queue.add(() => gemini.generateContent(prompt));
   ```

5. **Log every rate limit.** Track the rate and alert when it exceeds a threshold (e.g., >10/minute).

**Detection:**
- Alert on rate-limit error spike (429s per minute)
- Correlation: rate-limit errors spike when concurrent requests spike
- Slow booking confirmations during peak load

**Phase:** Phase 4 (Resilience) — Implement jitter and circuit breaker BEFORE high-load testing.

---

### Pitfall 11: Gemini Rate Limiting — Context Window Loss on Retry

**What goes wrong:**
Your booking bot sends a multi-turn prompt to Gemini with full context (business hours, available slots, customer preferences). Gemini starts responding. While processing, Gemini throws a 429. Your code retries, but on retry, you send a minimal prompt:

```typescript
// WRONG: Lost context
const retryPrompt = `Please try again.`;  // Context is gone!
await gemini.generateContent(retryPrompt);
```

Gemini has no knowledge of the customer, business, or available slots. It responds with a generic error. The customer is confused; conversation coherence breaks.

**Why it happens:**
Developers assume Gemini conversations are stateful (like ChatGPT) and that retrying with a minimal prompt will pick up where it left off. But Gemini is stateless; each request is independent. On retry, you must send the full original prompt—but many codebases lose the prompt context during error handling.

**Consequences:**
- Booking fails: Gemini doesn't understand the context
- Customer sees incoherent bot responses
- User trust: bot appears broken or confused
- Hidden race: conversation is partially processed; retrying with different context creates unpredictable behavior

**Prevention:**
1. **Cache the original request immutably.** Don't modify the prompt between retries:
   ```typescript
   const originalRequest = {
     prompt: fullPromptWithContext,
     generationConfig: { ... },
     timestamp: Date.now()
   };

   let attempt = 0;
   while (attempt < maxRetries) {
     try {
       return await gemini.generateContent(originalRequest);  // Full context
     } catch (error) {
       if (error.status === 429) {
         attempt++;
         await sleep(jitter(attempt));
       }
     }
   }
   ```

2. **Make prompts idempotent.** If the same prompt is sent twice, response should be identical:
   ```typescript
   const prompt = `
   [System instructions]
   Request ID: ${requestId}  // Gemini can deduplicate
   [rest of prompt]
   `;
   ```

3. **Never strip context on retry.** If you need to simplify the prompt for token limits, do so BEFORE the initial request, not during retry.

4. **Use idempotency keys in your database.** Before retrying, check if the exact request was already processed:
   ```typescript
   const requestHash = sha256(JSON.stringify(originalRequest));
   const cached = await db.getCachedGeminiResponse(requestHash);
   if (cached) return cached.response;  // Return cached result, no retry needed
   ```

**Detection:**
- Incoherent bot responses (Gemini response doesn't match context)
- Alert on retries followed by different response content
- User feedback: "bot forgot my request details"

**Phase:** Phase 4 (Resilience) — Implement immutable request caching BEFORE retry logic.

---

### Pitfall 12: Gemini Rate Limiting — Queue Ordering Guarantees Lost

**What goes wrong:**
Your booking system queues requests to handle rate limits. Customer A sends: "Book me Friday 3pm". Customer B sends: "Book me Friday 3pm". Both hit rate limit and are queued.

But due to async or race conditions, they may process out of order. Customer B's booking is processed first, consuming the Friday 3pm slot. Then Customer A's booking fails.

But Customer A's message was sent *first*. They should have priority.

**Why it happens:**
The queue doesn't enforce strict ordering. Async operations are processed in parallel. Or: the queue is per-bot, not per-business, so different businesses' requests are interleaved.

**Consequences:**
- Unfair bookings: customer who asked second gets the slot instead of customer who asked first
- Customer complaints: "I clearly asked first"
- Double-booking: both customers think they booked the same slot (queue corruption)
- Revenue loss: unfair slot allocation damages reputation

**Prevention:**
1. **Enforce sequential processing per business.** Use a distributed lock or queue:
   ```typescript
   // Process one booking at a time for each business
   const queue = new PQueue({ concurrency: 1 });
   const queueKey = `booking:${business_id}`;
   queue.add(() => processBooking(...), { priority: message.timestamp });
   ```

2. **Use message timestamps as tiebreaker.** If two requests arrive simultaneously:
   ```typescript
   const bookings = [
     { customer_a, slot: 'friday_3pm', timestamp: 1000 },
     { customer_b, slot: 'friday_3pm', timestamp: 1001 }
   ].sort((a, b) => a.timestamp - b.timestamp);
   // customer_a processed first
   ```

3. **Verify bookings atomically in database.** Use a UNIQUE constraint to ensure only one booking per slot:
   ```sql
   CREATE UNIQUE INDEX idx_booking_slot 
     ON bookings(business_id, calendar_date, calendar_time) 
     WHERE status = 'confirmed';
   ```

4. **Persist queue state.** If the app restarts, the queue is lost. Store pending bookings in database:
   ```sql
   CREATE TABLE booking_queue (
     id UUID PRIMARY KEY,
     business_id UUID,
     customer_message TEXT,
     requested_at TIMESTAMP,
     status VARCHAR,  -- 'pending', 'processing', 'confirmed', 'failed'
     retry_count INT
   );
   ```

5. **Test with concurrent requests.** Simulate multiple customers booking the same slot; verify FIFO order.

**Detection:**
- Alert on double-bookings (two confirmed bookings for same slot)
- Audit: compare message timestamp order vs. booking confirmation order
- User complaints about unfair slot allocation

**Phase:** Phase 4 (Resilience) — Implement sequential-per-business processing BEFORE handling multiple concurrent bookings.

---

## Minor Pitfalls

### Pitfall 13: Onboarding Timeout — Incomplete Setup Lingers in Database

If an owner starts onboarding but never completes, the database is left with a partially initialized business. After 7+ days, manual cleanup is needed or stale records clutter reports.

**Prevention:**
- Add `onboarding_expires_at` timestamp to onboarding session.
- Write a cron job (Supercronic on fly.io) that cleans up expired sessions daily.
- Send "resume onboarding?" reminder after 24 hours of inactivity.

**Phase:** Phase 3 (Owner Onboarding).

---

### Pitfall 14: Telegram Chat History Lost on Client Reset

If a customer resets their Telegram app or switches devices, they lose chat history with the bot. They won't see previous booking confirmation or cancellation.

**Prevention:**
- Send booking confirmations via message AND store in database.
- Provide `/history` command so customers can retrieve past bookings.
- Include booking reference code in confirmation: "Ref: BOOK-2026-07-001".

**Phase:** Phase 2 (Messaging).

---

### Pitfall 15: Gemini Token Limit — Prompt Gets Truncated

If your prompt is very long (large list of services, availability, history), it may exceed Gemini's token limit (1M tokens for Flash-Lite), failing silently or being truncated.

**Prevention:**
- Monitor token usage via `getTokenCount()` before sending to Gemini.
- Summarize or paginate large lists (show top 5 services, not all 100).
- Implement fallback: if prompt is too large, use simpler query.

**Phase:** Phase 4 (Resilience).

---

## Phase-Specific Warnings

| Phase | Topic | Likely Pitfall | Mitigation |
|-------|-------|----------------|-----------|
| **Phase 1: Infra Setup** | Token storage | Token exposure via URL or logs | Environment variables, secret masking, git-secrets scanning |
| **Phase 1: Infra Setup** | Webhook setup | Webhook conflicts (another webhook is active) | Delete old webhook, verify via getWebhookInfo(), per-env tokens |
| **Phase 2: Multi-Bot Routing** | Express routing | Shared state leaking across bots | Request-scoped context (res.locals), no global variables, isolation tests |
| **Phase 2: Multi-Bot Routing** | Signature verification | Wrong secret per token | Unique secret per bot, bind verification to token, constant-time comparison |
| **Phase 2: Multi-Bot Routing** | Migration | Existing clients orphaned | Dual-mode operation, migration messages, booking migration script |
| **Phase 3: Owner Onboarding** | State machine | Incomplete state, dropout, no resume | Explicit state model, database persistence, idempotency keys, timeout cleanup |
| **Phase 3: Owner Onboarding** | Token registration | Duplicate claims, race condition | UNIQUE constraint, atomic upsert, token validation via getMe() |
| **Phase 4: Resilience** | Gemini retry | Naive backoff, thundering herd | Exponential backoff + full jitter, circuit breaker, queue limits |
| **Phase 4: Resilience** | Gemini context | Context loss on retry | Immutable request cache, idempotent prompts, request deduplication |
| **Phase 4: Resilience** | Booking ordering | Out-of-order processing, unfair slot allocation | Sequential per-business, timestamp tiebreaker, DB uniqueness constraint |
| **Phase 5: GDPR Deletion** | Cascade delete | Audit trail loss | Soft delete, separate audit log, retain anonymized bookings |
| **Phase 5: GDPR Deletion** | Backup restore | Un-erased data restored | Pre-restore deletion audit check, point-in-time recovery, erasure retention markers |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| **Telegram Token Exposure** | HIGH | Token security is well-documented in Telegram Bot API and security literature; URL exposure is a known anti-pattern. |
| **Webhook Conflicts** | HIGH | "another webhook is active" is a common error in Telegram forums and GitHub issues; setWebhook API docs are clear. |
| **Multi-Bot Express Routing** | HIGH | Shared state isolation is a fundamental async/Node.js pattern; tested across frameworks. |
| **Signature Verification** | HIGH | HMAC-SHA256 verification is standard; per-token binding is explicit in webhook security best practices. |
| **Onboarding State Machine** | MEDIUM-HIGH | State machine pitfalls are well-known in distributed systems; application-specific patterns vary. Recommendation is sound. |
| **Token Registration Race** | HIGH | Check-then-act race conditions are classic database concurrency issues; UNIQUE constraints are proven mitigations. |
| **Migration & Backward Compatibility** | MEDIUM | Migration strategies depend on business context; dual-mode operation is standard. |
| **GDPR Deletion (Cascade)** | HIGH | EDPB Feb 2026 report confirms cascade-delete-related compliance failures; soft delete is recommended. |
| **GDPR Deletion (Backup)** | HIGH | GDPR compliance guide on backups is explicit; backup restoration + deletion is a known gap. |
| **Gemini Rate Limiting (Jitter)** | HIGH | Exponential backoff + jitter is industry standard (AWS, Stripe, Google docs). |
| **Gemini Rate Limiting (Context)** | MEDIUM-HIGH | Context loss on retry is specific to stateless LLM APIs; recommendation is sound but requires implementation testing. |
| **Gemini Rate Limiting (Queue Ordering)** | MEDIUM | Ordering guarantees depend on queue implementation; FIFO + DB constraints are proven. Implementation complexity varies. |

---

## Gaps to Address

- **Token rotation testing:** How to test token rotation without disrupting live service? Need a testing strategy.
- **Migration window duration:** How long to keep dual-mode operation? No clear industry standard; suggest 2–4 weeks.
- **Deletion audit compliance:** What format should the deletion audit log take for regulatory approval? Consult with legal.
- **Rate-limit monitoring dashboard:** What metrics matter most? Recommend: 429 rate, retry latency, queue depth, Gemini quota usage.

---

## Sources

- [Telegram Bot Security Best Practices (2025)](https://alexhost.com/faq/what-are-the-best-practices-for-building-secure-telegram-bots/)
- [Secure Telegram Bots: API Key Protection Guide](https://www.bitget.com/academy/12560603879287)
- [Telegram Bot Webhooks Guide (Official)](https://core.telegram.org/bots/webhooks)
- [Telegram Bot FAQ (Official)](https://core.telegram.org/bots/faq)
- [Webhook Security Best Practices](https://hooque.io/guides/webhook-security/)
- [GitHub Webhook Signature Verification](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [State Machine Pitfalls in Embedded Systems](https://www.archimetric.com/common-pitfalls-state-machine-diagrams-embedded-systems/)
- [Why Users Drop Off During Onboarding](https://www.saasfactor.co/blogs/why-users-drop-off-during-onboarding-and-how-to-fix-it)
- [Best Practices for GDPR-Compliant Data Deletion](https://www.reform.app/blog/best-practices-gdpr-compliant-data-deletion)
- [GDPR and Backups: Right to be Forgotten](https://www.struto.io/blog/gdpr-and-backups-how-to-restore-data-without-breaking-the-right-to-be-forgotten)
- [GDPR Compliance Audit Failures 2026](https://www.red-gate.com/simple-talk/databases/its-2026-why-are-databases-still-failing-gdpr-compliance-audits/)
- [Gemini API Rate Limits Guide](https://blog.laozhang.ai/en/posts/gemini-api-rate-limits-guide)
- [Gemini API 429 RESOURCE_EXHAUSTED Fix (2026)](https://www.aifreeapi.com/en/posts/gemini-api-error-429-resource-exhausted-fix)
- [Google Cloud: Handle 429 Resource Exhaustion Errors](https://cloud.google.com/blog/products/ai-machine-learning/learn-how-to-handle-429-resource-exhaustion-errors-in-your-llms)
- [API Rate Limiting: 2026 Engineering Reference](https://www.digitalapplied.com/blog/api-rate-limiting-strategies-2026-engineering-reference/)
- [API Rate Limiting at Scale: Patterns & Strategies](https://www.gravitee.io/blog/rate-limiting-apis-scale-patterns-strategies)
- [GitHub Bot User to GitHub App Migration (2026)](https://brtkwr.com/posts/2026-01-06-migrating-from-github-bot-user-to-github-app/)
- [Chatbot Platform Migration Guide](https://seamly.ai/resources/switching-from-one-chatbot-platform-to-another-heres-how-to-migrate-effortlessly)
- [Multi-Tenant Webhook Security](https://instatunnel.substack.com/p/from-proxy-to-gateway-managing-multi)

---

*Pitfalls research for: v1.1 multi-bot Telegram migration with owner onboarding, multi-tenant isolation, GDPR deletion, and rate-limit resilience*
*Researched: 2026-07-10*
*Overall confidence: HIGH*
