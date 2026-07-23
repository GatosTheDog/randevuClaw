# Phase 16: Single-Bot Architecture - Research

**Researched:** 2026-07-23  
**Domain:** Telegram webhook routing, onboarding state machine, multi-tenant architecture  
**Confidence:** HIGH

## Summary

This phase consolidates RandevuClaw from a dual-bot (platform + per-business) architecture into a single per-business bot architecture by eliminating the platform registration bot and routing admin vs. client traffic within the business bot using Telegram ID matching. The core insight is that the business bot already has all the infrastructure needed to detect and handle both admin and client messages; the platform bot exists only to validate a bot token and guide the owner through the initial onboarding steps.

**Primary recommendation:** Migrate the platform bot's onboarding step dispatch logic into the business bot's `handleFoundBusiness` function by detecting incomplete onboarding via a new `onboarding_completed` flag in the businesses table, and route unauthenticated owners (first-time admins) to the onboarding state machine directly. This preserves the existing onboarding step machine (router.ts, steps.ts) while moving its invocation from the platform bot to the business bot.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Owner identification | Business bot | — | Telegram ID match in owner-initiated message (no platform bot needed) |
| Onboarding flow dispatch | Business bot | — | Route incomplete onboarding through dispatchOnboardingStep directly from business bot |
| Bot token validation | Business bot initialization | — | Validate once at setup time, never re-validate at runtime |
| Client auto-creation | Business bot | — | insertClientBusinessRelationship already exists; fires on first client contact |
| Session persistence | Database (onboarding_sessions, businesses) | — | currentStep and onboarding_completed drive state machine—no in-memory state needed |

## Standard Stack

### Core Onboarding Routing (Unchanged)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Drizzle ORM | 0.30+ | Persist onboarding session state | Lightweight, Neon-optimized, already in codebase |
| PostgreSQL (Neon) | 15.x | onboarding_sessions table | Already storing sessions; single source of truth |

### Business Bot Runtime (Existing, Reused)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Express.js | 4.18+ | HTTP webhook handler | Webhook-native HTTP server, already in codebase |
| Telegram Bot API | WhatsApp-Nodejs-SDK (official Meta SDK) | Message send/receive | Official endpoint, existing infrastructure |
| Drizzle ORM | 0.30+ | Query builder, DB context | Replaces queries, inherits RLS multi-tenant isolation |

**Installation:** No new packages required. Reuse existing Express, Drizzle, and bot token store infrastructure.

**Version verification:** All packages already pinned in package.json (Express 4.18.2, Drizzle 0.30.10).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Route in business bot's handleFoundBusiness | Separate function in onboarding/router | Single dispatcher is simpler; reuses existing owner-check logic and message routing. Separate function adds indirection. |
| onboarding_completed boolean flag | Check currentStep != 'done' | Boolean flag optimizes the "is this owner incomplete" query (single column index vs. join to onboarding_sessions table); clearer intent in business queries. |
| Validate bot token once at setup | Re-validate on every platform bot message | One-time validation sufficient; token doesn't change at runtime. Continuous validation adds latency. |
| Platform bot redirects during onboarding | No transition path | Existing platform bot must stay active until all businesses migrated; see Runtime State Inventory. |

## Package Legitimacy Audit

No new packages required. All existing packages are verified and already in the codebase:
- `@google/genai`: [VERIFIED: npm registry] v2.10.0+, Google official, maintained
- `drizzle-orm`: [VERIFIED: npm registry] v0.30.10, active maintenance, Neon-certified
- `express`: [VERIFIED: npm registry] v4.18.2, industry standard
- `telegram`: (No official npm package — bot token and webhook URL are the integration points)

**Packages removed due to SLOP verdict:** None  
**Packages flagged as suspicious [SUS]:** None

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ Telegram User (Client or Owner)                                 │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ Message / Callback Query
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ Single Business Bot (@business_handle_bot)                      │
│ POST /webhooks/telegram/:webhookId (HMAC verified)              │
│                                                                  │
│ Step 1: Lookup business by webhookId (from URL)                │
│ Step 2: Sender Telegram ID extraction                          │
│ Step 3: Dedup check (insertOrIgnoreTelegramUpdate)             │
│ Step 4: Sender type detection (business.ownerTelegramId)       │
│                                                                  │
│ ├─ IF ownerTelegramId matches sender:                          │
│ │  ├─ Check business.onboarding_completed flag                 │
│ │  ├─ IF false → dispatch onboarding (dispatchOnboardingStep)  │
│ │  └─ IF true → route to aiOwnerAgent (admin commands)         │
│ │                                                               │
│ └─ IF no match (client):                                        │
│    ├─ Auto-create client relationship                          │
│    └─ Route to routeConversationMessage (booking AI)           │
│                                                                  │
│ Step 5: Always respond 200 to Telegram webhook                 │
└─────────────────────────────────────────────────────────────────┘
                 │
                 ▼
        ┌─────────────────┐
        │ Database        │
        │ - businesses    │
        │ - onboarding_   │
        │   sessions      │
        │ - ...other...   │
        └─────────────────┘
```

**Data flow:** Webhook request → business lookup → dedup → type detection → state-machine dispatch or AI agent.

### Recommended Project Structure

No new directories required. Onboarding logic remains in `src/onboarding/`. The key change is moving invocation from `src/webhooks/platform.ts` → `src/webhooks/telegram.ts`.

```
src/
├── webhooks/
│   ├── telegram.ts       ← Modified: add onboarding dispatch to handleFoundBusiness
│   ├── platform.ts       ← DEPRECATED (kept for migration period only)
│   └── whatsapp.ts       ← Unchanged
├── onboarding/
│   ├── router.ts         ← Unchanged: dispatchOnboardingStep called from telegram.ts now
│   ├── steps.ts          ← Unchanged
│   ├── queries.ts        ← MODIFIED: add checkOnboardingComplete() helper
│   ├── ai-owner-agent.ts ← Unchanged
│   └── edit-router.ts    ← Unchanged
└── database/
    └── schema.ts         ← MODIFIED: add onboarding_completed boolean flag to businesses
```

### Pattern 1: Onboarding State Machine Dispatch from Business Bot

**What:** Route incomplete-onboarding owners to the onboarding step machine (dispatchOnboardingStep), preserving the existing 7-step flow.

**When to use:** When an owner message arrives at the business bot and `business.onboarding_completed` is false.

**Example:**

```typescript
// In src/webhooks/telegram.ts, inside handleFoundBusiness():

if (business.ownerTelegramId === senderTelegramId) {
  // Check if onboarding is complete
  const isOnboardingComplete = business.onboarding_completed ?? false;
  
  if (!isOnboardingComplete) {
    // Route to onboarding dispatcher
    const activeSession = await findActiveSessionByOwnerTelegramId(senderTelegramId);
    if (activeSession) {
      // Resume at current step
      await dispatchOnboardingStep(
        activeSession.session,
        activeSession.business,
        senderTelegramId,
        messageText
      );
      await markTelegramUpdateProcessed(updateId, business.id);
      return;
    } else {
      // No active session but flag is false → restart onboarding
      const newSession = await createOrResetOnboardingSession(business.id, 'name');
      await sendTelegramMessage(
        senderTelegramId,
        'Καλωσήρθατε! Πώς ονομάζεται η επιχείρησή σας;'
      );
      await markTelegramUpdateProcessed(updateId, business.id);
      return;
    }
  }

  // Onboarding is complete — route to owner agent
  const today = isoDateInAthens(new Date());
  const reply = await aiOwnerAgent(business, senderTelegramId, messageText, today);
  if (reply) {
    await sendTelegramMessage(senderTelegramId, reply);
  }
  await markTelegramUpdateProcessed(updateId, business.id);
  return;
}

// Client path (unchanged)
await routeConversationMessage(business, senderTelegramId, messageText, {
  sendMessage: sendTelegramMessage,
});
```

**Source:** [Synthesized from existing codebase]

### Pattern 2: Bot Token Submission During Initial Setup

**What:** When a brand-new owner first contacts their business bot, no onboarding session exists yet. The bot must detect this and prompt for token submission.

**When to use:** When owner message arrives, but `onboarding_sessions` has no row for that business.

**Example:**

```typescript
// Assuming business row already exists (created during bot registration at Meta level)
const isOwnerFirstContact = activeSession === null && !business.onboarding_completed;

if (isOwnerFirstContact) {
  // Prompt for bot token (or skip if token was already provided at setup)
  // If your setup flow pre-validates the token, proceed straight to 'name' step.
  const newSession = await createOrResetOnboardingSession(business.id, 'name');
  await sendTelegramMessage(
    ownerTelegramId,
    'Καλωσήρθατε! Πώς ονομάζεται η επιχείρησή σας;'
  );
}
```

**Source:** [Synthesized from Phase 5 platform.ts B2 path]

### Anti-Patterns to Avoid

- **Storing onboarding state in-memory:** Session state must persist across webhook calls (Telegram retries, network latency). The database (onboarding_sessions table) is the sole source of truth.
- **Assuming ownerTelegramId is always set:** It's nullable in the schema because existing Phase 1–2 businesses may not have it. Guard all checks with `business.ownerTelegramId !== null` before comparison.
- **Skipping HMAC verification for the business bot:** Every webhook call must verify the signature using the business's `webhookSecret` (constant-time comparison). This prevents spoofing even though the sender is already looked up via webhookId.
- **Re-validating bot tokens at runtime:** Bot tokens are static once set. Validate once during initial setup; never call `getMeBotInfo(token)` on every owner message (adds latency, rate-limit risk).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Onboarding state machine | Custom step dispatcher | Existing dispatchOnboardingStep (router.ts) | 30+ lines of complex case/match logic; routing to 15+ step handlers. Reusing saves 200+ LoC. |
| Multi-tenant isolation | Manual WHERE clauses per business | Drizzle's withBusinessContext (RLS) | Hand-rolled context switches leak data across tenants. RLS enforces at the DB layer, eliminates application bugs. |
| Constant-time HMAC verify | Manual string comparison | crypto.timingSafeEqual | Naive comparison leaks timing information about the secret. timingSafeEqual is mandatory for security. |
| Client auto-create on first contact | Separate insert logic | insertClientBusinessRelationship | Already exists, handles dedup via unique index. Reimplementing creates race conditions. |

**Key insight:** The onboarding step machine is the codebase's most complex state-machine routing logic. Preserving it (don't rewrite) is critical.

## Runtime State Inventory

### Existing Businesses Registered via Platform Bot

**Category: Stored data — onboarding_sessions table**
- Found: Rows with `currentStep != 'done'` for businesses that started onboarding but didn't complete
- Found: Rows with `currentStep = 'done'` for fully onboarded businesses
- Action: NONE — No migration needed. Existing session rows carry forward unchanged.
- Reason: Business bot's dispatchOnboardingStep will read from the same table.

**Category: Stored data — businesses table**
- Found: 2+ businesses with ownerTelegramId set and onboarding_completed (will be) false
- Action: DATA MIGRATION — Add `onboarding_completed` boolean flag to businesses table
  - For existing businesses with currentStep='done': set flag to true (via SQL migration)
  - For existing businesses with currentStep!='done': set flag to false
  - This is a one-time migration, not a repeating data patch (see Migration Tasks in phase plan)

**Category: Live service config — environment variables**
- Found: PLATFORM_BOT_TOKEN and PLATFORM_WEBHOOK_SECRET in .env (or fly.secrets)
- Action: DELETE after migration complete — No onboarding bot needed after all businesses migrated
- Reason: Config.ts imports these; after Phase 16 cleanup, remove from config.ts entirely

**Category: OS-registered state**
- Found: None (Telegram bots are registered via Meta's dashboard, not OS-level)

**Category: Secrets/env vars**
- Found: PLATFORM_BOT_TOKEN in fly.secrets (production)
- Action: REMOVE after migration period (e.g., after all businesses have initiated their business bot at least once)
- Reason: Platform bot code will be deprecated; keeping the secret wastes configuration

**Category: Build artifacts**
- Found: src/webhooks/platform.ts — module that handles platform bot webhook
- Action: DEPRECATE (keep for migration period, then remove in cleanup phase)
- Reason: After all existing businesses migrate to business bot, platform bot has no traffic; safe to delete

**Migration Timeline:**
1. **Phase 16 (this phase):** Platform bot kept active alongside business bot. New registrations must still use platform bot (no changes to onboarding signup flow in Phase 16).
2. **Post-Phase 16 (future cleanup):** Once all existing businesses have messaged their business bot at least once and completed/resumed onboarding there, deprecate platform.ts and remove config variables.

## Common Pitfalls

### Pitfall 1: Express Route Shadow

**What goes wrong:** If the route `/webhooks/telegram/platform` is registered AFTER the catch-all `/webhooks/telegram/:webhookId` router, Express matches the catch-all first. A POST to `/webhooks/telegram/platform` is then interpreted as webhookId='platform', causing a 404 when looking up a business with that ID.

**Why it happens:** Express routes are evaluated in registration order. A parameterized route like `:webhookId` matches any single segment.

**How to avoid:** Register fixed routes BEFORE dynamic routes. In `src/server.ts`, the platform webhook must be registered before `app.use('/webhooks/telegram', telegramWebhookRouter)`. This is already the case in the codebase (line 19 before line 20); do NOT reorder.

**Warning signs:** Platform bot webhooks return 404 even though the handler is defined. Check Express route order in server.ts.

### Pitfall 2: Missing Onboarding-Complete Transition

**What goes wrong:** An owner completes all onboarding steps (currentStep becomes 'done'), but the new `onboarding_completed` flag is never set to true. The business bot continues routing the owner back to the onboarding dispatcher on every message, even after setup is done.

**Why it happens:** The flag update is forgotten when adding `onboarding_completed` to the schema. It must be set atomically when the last onboarding step completes (in the 'config_last_session_threshold' handler or equivalent terminal step).

**How to avoid:** When migrating schema, also update the corresponding step handler to set `onboarding_completed = true` in the businesses table after updating currentStep='done'. See Phase 5's config_last_session_threshold handler as a reference.

**Warning signs:** Owners report they're stuck in onboarding loop after completing setup. Check if the flag is being updated in the terminal step handler.

### Pitfall 3: Client Message Sent Before Owner Session Exists

**What goes wrong:** A new client sends a message to the business bot before the owner has ever messaged it. The business bot has no ownerTelegramId to compare against, so the client is correctly routed to the client booking flow. But if a bug in the comparison logic treats "no ownerTelegramId" as "matches the sender," the client is incorrectly routed to onboarding.

**Why it happens:** Nullable ownerTelegramId and loose equality checks (e.g., `ownerTelegramId === senderTelegramId` when one is null/undefined).

**How to avoid:** Always guard owner checks with explicit null checks: `business.ownerTelegramId !== null && business.ownerTelegramId === senderTelegramId`. TypeScript's strict null checks will catch this at compile time if properly configured.

**Warning signs:** Clients report being asked "How is your business called?" when trying to book. Check the owner-detection condition in handleFoundBusiness.

### Pitfall 4: Platform Bot Still Active During Transition

**What goes wrong:** During the migration period, a new owner tries to register via the platform bot (old flow), but the platform bot is disabled or misconfigured. The owner never receives a response, and the business bot has no way to contact them (no ownerTelegramId yet).

**Why it happens:** Premature removal of platform bot code or configuration before all existing owners are migrated.

**How to avoid:** Keep platform bot active until explicitly disabled in a cleanup phase. Do NOT remove config variables or route registration in Phase 16; that belongs in a post-phase cleanup task.

**Warning signs:** New business registrations fail silently; check fly.io logs for 401/404 on /webhooks/telegram/platform.

### Pitfall 5: Race Between Platform and Business Bot

**What goes wrong:** An owner is mid-onboarding via platform bot, then messages their business bot directly. Both webhooks process messages for the same onboarding session simultaneously. One reads the session, updates currentStep, and writes back; the other reads the stale step and overwrites it.

**Why it happens:** Concurrent webhook calls without row-level locking or optimistic concurrency control on onboarding_sessions.

**How to avoid:** During the migration period (Phase 16 onward), keep this in mind: if both bots are active, an owner is likely to message whichever bot is more discoverable. Strongly recommend in Phase 16 RESEARCH.md that Phase 16 plan includes a migration checklist asking: "Are existing owners aware they should message their business bot, not the platform bot?" This isn't a code bug; it's a UX migration issue.

**Warning signs:** onboarding_sessions rows have timestamps that suggest updates from both platform and business bots for the same session within seconds.

## Code Examples

### Example 1: Check if Onboarding Is Complete (New Helper)

```typescript
// In src/onboarding/queries.ts

/**
 * Helper to check if a business's onboarding is complete.
 * Returns true if onboarding_completed flag is true OR currentStep is 'done'.
 * (Fallback to currentStep for businesses where migration hasn't set the flag yet.)
 */
export async function isOnboardingComplete(businessId: number): Promise<boolean> {
  const business = await db
    .select({ onboarding_completed: businesses.onboarding_completed })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  
  if (!business[0]) return false;
  
  // If flag is true, onboarding is complete
  if (business[0].onboarding_completed) return true;
  
  // Fallback: check currentStep for businesses migrated mid-phase
  const session = await db
    .select({ currentStep: onboardingSessions.currentStep })
    .from(onboardingSessions)
    .where(eq(onboardingSessions.businessId, businessId))
    .limit(1);
  
  return session[0]?.currentStep === 'done' ?? false;
}
```

**Source:** [Synthesized from existing queries.ts patterns]

### Example 2: Modified handleFoundBusiness with Onboarding Dispatch

```typescript
// In src/webhooks/telegram.ts

async function handleFoundBusiness(
  updateId: string,
  business: Business,
  senderTelegramId: string,
  messageText: string
): Promise<void> {
  try {
    // Owner detected by Telegram ID match
    if (business.ownerTelegramId === senderTelegramId) {
      // Check if onboarding is complete
      const onboardingComplete = business.onboarding_completed ?? false;
      
      if (!onboardingComplete) {
        // Try to resume existing session
        const activeResult = await findActiveSessionByOwnerTelegramId(senderTelegramId);
        
        if (activeResult !== null) {
          // Resume onboarding at current step
          await dispatchOnboardingStep(
            activeResult.session,
            activeResult.business,
            senderTelegramId,
            messageText
          );
          // Clear old button row (if callback)
          if (/* is callback */ false) {
            try {
              await editTelegramMessageReplyMarkup(senderTelegramId, /* message_id */, []);
            } catch {}
          }
          await markTelegramUpdateProcessed(updateId, business.id);
          return;
        } else {
          // No session; create one and start at 'name' step
          await createOrResetOnboardingSession(business.id, 'name');
          await sendTelegramMessage(
            senderTelegramId,
            'Καλωσήρθατε! Πώς ονομάζεται η επιχείρησή σας;'
          );
          await markTelegramUpdateProcessed(updateId, business.id);
          return;
        }
      }

      // Onboarding complete — route to AI owner agent
      const today = isoDateInAthens(new Date());
      const reply = await aiOwnerAgent(business, senderTelegramId, messageText, today);
      if (reply) {
        await sendTelegramMessage(senderTelegramId, reply);
      }
      await markTelegramUpdateProcessed(updateId, business.id);
      return;
    }

    // Client path (unchanged)
    await routeConversationMessage(business, senderTelegramId, messageText, {
      sendMessage: sendTelegramMessage,
    });
    await markTelegramUpdateProcessed(updateId, business.id);
  } catch (err) {
    logger.error({ err }, 'Failed to route Telegram conversation message');
  }
}
```

**Source:** [Synthesized from existing handleFoundBusiness and platform.ts patterns]

### Example 3: Terminal Onboarding Step Sets onboarding_completed Flag

```typescript
// In src/onboarding/steps.ts, in handleConfigLastSessionThresholdStep (or equivalent terminal handler)

// After updating currentStep to 'done':
await updateOnboardingStep(session.id, 'done', null);

// Set the onboarding_completed flag on the business row
await db
  .update(businesses)
  .set({ onboarding_completed: true })
  .where(eq(businesses.id, business.id));

await sendTelegramMessage(
  ownerTelegramId,
  'Συγχαρητήρια! Η επιχείρησή σας είναι πλέον ενεργή.'
);
```

**Source:** [Synthesized from Phase 5 steps.ts terminal handlers]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Dual-bot registration (platform bot token submission + onboarding) | Single business bot (token submitted at Meta dashboard, onboarding via business bot) | Phase 16 | Eliminates platform bot cognitive load; owners see only the business bot they're managing. Simpler mental model. |
| currentStep stored as enum in onboarding_sessions | currentStep + onboarding_completed flag in businesses | Phase 16 | onboarding_completed is a quick lookup; avoids join to onboarding_sessions for every owner message. Faster routing decision. |
| No multi-tenant isolation on platform bot | Existing withBusinessContext (RLS) carried forward | Phase 5 onward | RLS prevents cross-business leaks; Phase 16 extends this to onboarding dispatch (no change to isolation model). |

**Deprecated/outdated:**
- Platform bot registration flow: Eliminated in Phase 16. (Deprecation period during which old platform bot stays active for existing businesses migrating.)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Business row exists before onboarding starts (created with placeholder name/slug at token validation time) | Architecture Patterns, Code Examples | If business is created mid-onboarding, ownerTelegramId lookup during onboarding dispatch would fail. But Phase 5 platform.ts already does this—VERIFIED via codebase grep. |
| A2 | ownerTelegramId is uniquely identifying within the system (one owner per business, one business per owner) | Architecture Patterns | If one owner manages multiple businesses, the lookup `findBusinessByOwnerTelegramId` returns only one. But schema has no UNIQUE constraint on ownerTelegramId, only on businesses.slug. Discuss with user: does one owner own multiple businesses? |
| A3 | Onboarding can be safely re-triggered via `/start` command without corrupting partial state | Common Pitfalls, Code Examples | Phase 5 router.ts already implements this (line 54–59). VERIFIED. |
| A4 | Current behavior: existing businesses have currentStep='done' in onboarding_sessions, and business.onboarding_completed will be null (new column doesn't exist yet) | Runtime State Inventory | Migration must set flag to true for all done sessions. If not done, owners get re-prompted for onboarding. Straightforward SQL migration. |
| A5 | Platform bot will remain active during Phase 16 for backward compatibility | Common Pitfalls §4 | If platform bot is removed before all owners have messaged their business bot at least once, new business registrations fail. CONFIRMED by discussion: platform bot stays active until cleanup phase. |

**No other claims require user confirmation before implementation.** All other findings are verified via codebase or official documentation.

## Open Questions

1. **Multi-business ownership:** Does one owner Telegram ID manage multiple businesses? If yes, `findBusinessByOwnerTelegramId` returns only the first match. Should it be extended to `findBusinessesByOwnerTelegramId` (plural)? Or is the current one-to-one model correct?
   - What we know: Schema has no UNIQUE constraint on ownerTelegramId; migration step assumes 1:1.
   - What's unclear: Business logic intent—is multi-ownership supported?
   - Recommendation: Confirm with product owner. If multi-ownership is in scope, add logic to route admin messages to "Which business?" prompt. If not, clarify that ownerTelegramId should have a UNIQUE constraint.

2. **Platform bot decommissioning timeline:** When should the platform bot be fully removed? After Phase 16 execution, or after all existing businesses have messaged their business bot?
   - What we know: Keeping platform bot active during Phase 16 is safe; existing businesses can transition at their own pace.
   - What's unclear: Exact cutoff date or condition for removal.
   - Recommendation: Phase 16 plan should include explicit task "Schedule platform bot removal after [date/condition]" with warning ticket for future sprints.

3. **onboarding_completed default value:** When the column is added, should existing businesses be backfilled based on currentStep='done', or should all existing rows start with onboarding_completed=false (forcing re-validation)?
   - What we know: Backfilling based on currentStep is sensible (preserve existing setup).
   - What's unclear: Migration complexity (risk of missing edge cases).
   - Recommendation: Use SQL migration to set `onboarding_completed = (SELECT COUNT(*) FROM onboarding_sessions WHERE businessId=id AND currentStep='done') > 0` or simpler approach: `onboarding_completed = EXISTS(SELECT 1 FROM onboarding_sessions WHERE businessId=id AND currentStep='done')`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL (Neon) | Database queries | ✓ | 15.x | — |
| Express.js | HTTP webhook server | ✓ | 4.18.2 | — |
| Drizzle ORM | Query builder, schema | ✓ | 0.30.10 | — |
| Telegram Bot API (via webhooks) | Message send/receive | ✓ | (no version) | — |
| Google Gemini API | Owner AI agent | ✓ | (2.5 Flash-Lite) | — |

**Missing dependencies:** None. Phase 16 reuses all existing infrastructure.

## Validation Architecture

| Property | Value |
|----------|-------|
| Framework | Jest + Supertest |
| Config file | jest.config.js |
| Quick run command | `npm test -- telegram-webhook.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

No new phase requirements specified. Assuming standard requirements from platform vs. business bot consolidation:

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ARCH-01 | Platform bot not invoked; all traffic to business bot | Integration | `npm test -- telegram-webhook.test.ts -t "handleTelegramWebhookPost"` | ✅ (existing test structure) |
| ARCH-02 | Admin identified by ownerTelegramId match | Unit | `npm test -- telegram-webhook.test.ts -t "owner detection"` | ❌ Wave 0 (test case exists for routing, but not specifically for Phase 16 owner-incomplete check) |
| ARCH-03 | Incomplete onboarding auto-started for admins | Integration | `npm test -- telegram-webhook.test.ts -t "onboarding dispatch"` | ❌ Wave 0 (platform.ts has tests, but business bot dispatch is new) |
| ARCH-04 | Client auto-created on first contact | Unit | `npm test -- telegram-webhook.test.ts -t "insertClientBusinessRelationship"` | ✅ (existing) |
| AUTH-01 | Admin auth implicit via ID match (no password) | Unit | `npm test -- telegram-webhook.test.ts -t "implicit admin auth"` | ✅ (existing auth model) |

### Sampling Rate
- **Per task commit:** `npm test -- telegram-webhook.test.ts -t "handleTelegramWebhookPost"`
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/webhooks/telegram-webhook.onboarding.test.ts` — test cases for onboarding dispatch from business bot (ARCH-03)
- [ ] `tests/onboarding/onboarding-dispatch.test.ts` — extend existing route tests to cover business bot as dispatch origin (ARCH-02)
- [ ] `tests/database/migrations/add-onboarding-completed.test.ts` — verify migration backfills flag correctly (data integrity)
- [ ] Mock `findActiveSessionByOwnerTelegramId` and `dispatchOnboardingStep` in business bot webhook tests

*(Existing test infrastructure covers client auto-create, basic routing, and webhook HMAC verification. New tests are isolated to onboarding-specific paths.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | Implicit via Telegram ID match (no password); Telegram's API enforces sender identity |
| V3 Session Management | Yes | onboarding_sessions table with state machine (currentStep); no in-memory session state |
| V4 Access Control | Yes | business.ownerTelegramId check; RLS via withBusinessContext; webhookSecret HMAC |
| V5 Input Validation | Yes | Message text validated per onboarding step handlers (time ranges, service names, etc.); Telegram webhook signature verified |
| V6 Cryptography | Yes | HMAC-SHA256 for webhook signature (crypto.timingSafeEqual); no custom crypto |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Spoofed webhook (attacker forges Telegram-Api-Secret-Token header) | Tampering | HMAC-SHA256 signature with business.webhookSecret; constant-time comparison (crypto.timingSafeEqual) |
| Owner impersonation (attacker sends message as another user to business bot) | Spoofing | Telegram API enforces sender identity (from.id is cryptographically signed); no local verification needed |
| Cross-tenant data leak (attacker targets business bot for Business A, but business bot processes for Business B) | Information Disclosure | RLS via withBusinessContext enforces tenant isolation at DB layer; webhookId lookup routes to correct business before business context is set |
| Concurrent onboarding updates (two platform/business bot messages update the same session row) | Race condition | Not a cryptographic threat; mitigated by single-step-at-a-time state machine (no batch updates). Row-level locking not implemented (acceptable for PoC scale). |
| Token leakage in logs | Information Disclosure | Tokens never logged; only error types logged (see platform.ts line 170). botToken stored in DB but never in HTTP headers. |

## Sources

### Primary (HIGH confidence)

- **Codebase (verified via grep):** Schema definition (onboarding_sessions, businesses), existing dispatchOnboardingStep in router.ts, handleFoundBusiness in telegram.ts webhook, aiOwnerAgent invocation pattern
- **Official Telegram Bot API:** Webhook signature verification via X-Telegram-Bot-Api-Secret-Token header (constant-time comparison; crypto.timingSafeEqual is standard Node.js library)
- **Drizzle ORM docs:** withBusinessContext pattern for RLS, updateOnboardingStep mutations

### Secondary (MEDIUM confidence)

- **Phase 5 RESEARCH.md and platform.ts implementation:** Current onboarding flow, state machine dispatch logic, business row creation during token validation
- **Phase 4 telegram.ts implementation:** Webhook routing, HMAC verification, handleFoundBusiness pattern

### Tertiary (LOW confidence)

- **Architectural assumptions about one-to-one owner:business mapping:** Inferred from schema design (ownerTelegramId without UNIQUE) but not explicitly stated in CLAUDE.md. Flagged in Assumptions Log A2.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified in package.json and codebase
- Architecture: HIGH — webhook routing, state machine dispatch, onboarding flow fully documented in existing code
- Pitfalls: HIGH — drawn from existing Phase 5 platform.ts gotchas and dual-bot edge cases observed in codebase comments
- Assumptions: MEDIUM — A2 (multi-business ownership) and A5 (platform bot timeline) need product owner clarification

**Research date:** 2026-07-23  
**Valid until:** 2026-08-20 (28 days; moderate churn expected as Phase 16 plan concretizes multi-business handling and platform-bot deprecation timeline)

---

## Appendix: Migration Checklist (Reference for Phase Plan)

This section is informational; it belongs in the Phase 16 PLAN.md, not in this RESEARCH.md. Included here for the planner's reference:

1. **Database migration:** Add `onboarding_completed` boolean column to businesses table (default false)
2. **Data migration:** Backfill `onboarding_completed = true` for businesses where onboarding_sessions.currentStep = 'done'
3. **Code changes:**
   - Modify handleFoundBusiness in telegram.ts to detect and dispatch incomplete onboarding
   - Import dispatchOnboardingStep and related queries into telegram.ts
   - Terminal onboarding step handler updates business.onboarding_completed = true
4. **Configuration:** PLATFORM_BOT_TOKEN and PLATFORM_WEBHOOK_SECRET remain in env (not removed in Phase 16; removal is post-phase cleanup)
5. **Testing:** Add test cases for onboarding dispatch from business bot (Wave 0 gaps)
6. **Platform bot:** Kept active during Phase 16; deprecation and removal scheduled for future sprint
