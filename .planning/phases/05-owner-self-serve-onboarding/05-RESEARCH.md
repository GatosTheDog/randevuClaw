# Phase 5: Owner Self-Serve Onboarding - Research

**Researched:** 2026-07-14
**Domain:** Telegram platform bot, DB-backed state machine, Telegram webhook registration API
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** A platform onboarding bot (separate `PLATFORM_BOT_TOKEN` env var, separate `PLATFORM_WEBHOOK_SECRET`) handles all owner registration. This is a new bot distinct from any per-business bot. Owner DMs their Telegram bot token to this platform bot to begin onboarding.

**D-02:** The sender's Telegram user ID (`from.id`) becomes `businesses.ownerTelegramId`. Whoever sends the bot token to the platform bot is the owner — no extra confirmation step needed.

**D-03:** The platform bot runs the full onboarding flow (name → hours → services) before calling `setWebhook`. The owner's bot is not activated until all required config is complete.

**D-04:** A DB-backed state machine drives the guided setup. `onboarding_sessions` table stores `(business_id, current_step, collected_data JSON)`. The platform bot reads `current_step` on every message and asks the matching question.

**D-05:** A new `onboarding_sessions` table persists onboarding state. Columns: `id`, `business_id` (FK to `businesses`), `current_step` (text enum), `collected_data` (text, JSON), `created_at`, `updated_at`.

**D-06:** Post-setup config edits (ONB-03) are triggered by specific Greek keywords in the owner's own bot (e.g., `αλλαγή ωραρίου`, `νέα υπηρεσία`, `αλλαγή τιμής`). No Gemini call needed for the trigger — keyword detection is a simple string match before routing to the booking agent.

**D-07:** Hours are collected day-by-day sequentially, in JS `Date.getDay()` order (0=Sunday … 6=Saturday). Bot asks "Είστε ανοιχτά τη Δευτέρα;" — if yes, follows up for times; if no, marks `isClosed: true`.

**D-08:** Open/close times collected via two separate prompts. Time stored as `"HH:MM"` 24h text, matching `business_hours.openTime`/`closeTime`.

**D-09:** Each confirmed day is written to `business_hours` immediately (incremental DB writes). `onboarding_sessions.current_step` advances to the next day.

**D-10:** All hardcoded FIXTURES, SERVICE_FIXTURES, and HOURS_FIXTURES constants are removed from `src/database/seed.ts`. `seed.ts` itself may be repurposed or removed — no fixture-seeded businesses exist after Phase 5.

**D-11:** Tests that previously depended on `pilates-athens`/`hair-salon-athens` are updated to use an `insertTestBusiness()` DB helper that writes directly to `businesses`, `services`, and `business_hours` tables, bypassing the onboarding chat flow.

**D-12:** Each test file creates its own test business in `beforeAll`/`beforeEach` (per-test-file setup, not shared `jest.setup.ts` seed). Prevents hidden shared state.

**D-13:** Onboarding flow integration tests mock `callTelegramApi` (for `getMe()` and `setWebhook`) via `jest.spyOn`, following the Phase 4 test pattern. No real `TEST_PLATFORM_BOT_TOKEN` needed for CI.

### Claude's Discretion

- Exact shape of `onboarding_sessions.current_step` enum values and the full step sequence.
- Whether to use `upsert` or `insert + unique` for `onboarding_sessions` (one active session per business).
- How `seed.ts` is restructured after fixture removal — could become a test-only helper module or be deleted entirely.
- Greek day names used in prompts (Κυριακή/Δευτέρα/Τρίτη/Τετάρτη/Πέμπτη/Παρασκευή/Σάββατο).

### Deferred Ideas (OUT OF SCOPE)

- Web dashboard for owner config management
- Multi-staff / per-instructor calendars (v2.0)
- Owner-initiated WhatsApp bot registration (v1.2+ after Meta BV)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BOT-01 | Owner can register a Telegram bot by submitting their bot token via chat; platform automatically calls Telegram's `setWebhook` API to activate it | Telegram `getMe` validates token; `setWebhook` activates; `deleteWebhook` must precede on re-registration. New helpers needed in `client.ts`. |
| ONB-01 | Owner completes a guided chat conversation to configure their business: name, weekly hours per day, and each service (name, price, duration in minutes) | DB-backed state machine (D-04) with fine-grained step enum. 7 days × 3 sub-steps + service collection loop. All in Greek. |
| ONB-02 | Onboarding state is persisted; owner can resume exactly where they left off without restarting | `onboarding_sessions.current_step` is the resume anchor; incremental DB writes per step (D-09). |
| ONB-03 | Owner can edit their business configuration after initial setup via chat: update hours, add/remove services, change prices | Greek keyword detection in `handleFoundBusiness` before routing to booking agent (D-06). New `routeOwnerEdit()` function. |
| ONB-04 | All hardcoded fixture/seed businesses removed; every business results from owner completing the onboarding flow | Remove FIXTURES from `seed.ts`; add `insertTestBusiness()` test helper; update affected test files. |
</phase_requirements>

## Summary

Phase 5 adds a platform onboarding bot — a separate Telegram bot that collects bot tokens from business owners and walks them through a guided setup. The technical core is a DB-backed state machine in a new `onboarding_sessions` table. Each incoming message to the platform bot is dispatched to a step handler based on `current_step`, and results are incrementally written to `business_hours` and `services` tables as the owner progresses.

The platform bot is architecturally distinct from per-business bots: it uses the admin `db` (not `appDb`) for all operations, bypasses `withBusinessContext`, and has its own fixed route `/webhooks/telegram/platform` registered before the dynamic `/:webhookId` router in `server.ts`. This ordering is critical — Express matches routes in declaration order, and `/:webhookId` would otherwise consume `/platform` requests.

Phase 5 also removes the two hardcoded fixture businesses (`pilates-athens`, `hair-salon-athens`) and replaces them with an `insertTestBusiness()` DB helper that tests use directly. This is the largest refactor surface in the phase: approximately 12 test files reference fixture slugs or call `seed()`, and all need updating.

**Primary recommendation:** Build the state machine with fine-grained step names (`hours_0_query`, `hours_0_open`, `hours_0_close`, …) rather than a coarser structure — each step maps to exactly one message exchange, making resume logic trivially correct: whatever `current_step` says, send that prompt.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Bot token receipt and `getMe` validation | API / Backend | — | Token validation requires a Telegram API call; cannot be trusted to client |
| `setWebhook`/`deleteWebhook` registration | API / Backend | — | Server-to-server call using owner's bot token; no client involvement |
| Onboarding state persistence | Database / Storage | — | `onboarding_sessions` table owns state; platform bot reads/writes it |
| Guided onboarding prompts (Greek) | API / Backend | — | Platform bot sends prompts; no frontend layer exists |
| Greek keyword detection (ONB-03) | API / Backend | — | Pre-routing string match in webhook handler, before AI agent |
| Per-business hours and services insert | Database / Storage | API / Backend | Drizzle writes to `business_hours`/`services`; triggered by step handlers |
| Fixture removal and test migration | API / Backend | — | Code + test change; no schema impact beyond dropping seed data |
| Platform bot webhook HMAC verification | API / Backend | — | Same `crypto.timingSafeEqual` pattern as per-business bots (Phase 4) |

## Standard Stack

### Core (all already installed — no new packages)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `telegraf` | 4.16.3 | Webhook adapter for platform bot (same D-01 pattern from Phase 4) | Already in use; Phase 5 adds a second Telegraf instance for platform bot |
| `drizzle-orm` | 0.45.2 | ORM for `onboarding_sessions` CRUD; `$onUpdate` for `updated_at` | Already in use; `$onUpdate(() => new Date())` supported in 0.30.5+ [VERIFIED: npm registry] |
| `express` | 5.2.1 | HTTP server; platform bot route registered as fixed path before dynamic router | Already in use |
| `zod` | 4.4.3 | Validate env vars (`PLATFORM_BOT_TOKEN`, `PLATFORM_WEBHOOK_SECRET`, `WEBHOOK_BASE_URL`) | Already in use for env schema |
| `crypto` | Node.js built-in | `timingSafeEqual` for platform bot HMAC; `randomBytes` for `webhookId`/`webhookSecret` | Already used in Phase 4 webhook handler |

### No new packages required

Phase 5 adds no new npm dependencies. All required capabilities (Telegram API calls, state machine DB, Express routing, HMAC verification, env validation) are covered by the existing stack.

**Installation:** None needed.

**Version verification:**

```bash
npm view telegraf version       # 4.16.3
npm view drizzle-orm version    # 0.45.2
npm view express version        # 5.2.1
npm view zod version            # 4.4.3
```

## Package Legitimacy Audit

All packages are pre-existing project dependencies — no new installs.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| telegraf | npm | ~5 yrs | 259K/wk | github.com/telegraf/telegraf | OK | Approved (existing dep) |
| drizzle-orm | npm | ~3 yrs | 10.6M/wk | github.com/drizzle-team/drizzle-orm | OK | Approved (existing dep) |
| express | npm | ~13 yrs | 106.5M/wk | github.com/expressjs/express | OK | Approved (existing dep) |
| zod | npm | ~5 yrs | 208M/wk | github.com/colinhacks/zod | OK | Approved (existing dep) |

**Packages removed due to SLOP verdict:** none
**Packages flagged as suspicious:** none

## Architecture Patterns

### System Architecture Diagram

```
Owner Telegram DM
       |
       v
POST /webhooks/telegram/platform           (fixed path — registered BEFORE /:webhookId)
       |
       v
platformBotWebhookHandler (src/webhooks/platform.ts)
  | verify PLATFORM_WEBHOOK_SECRET (timingSafeEqual)
  | dedup-insert telegram_updates (null business_id until registration)
  | look up businesses by ownerTelegramId (admin db, no RLS)
  |
  +--[no business found]------------------------+
  |  treat message as bot token submission      |
  |  callTelegramApiDirect(token, 'getMe', {})  |
  |  on success: INSERT businesses (admin db)   |
  |  INSERT onboarding_sessions (current_step='name')
  |  botTokenStore.run(PLATFORM_BOT_TOKEN, ...) |
  |  sendTelegramMessage(ownerId, "Τι όνομα...") |
  |                                             |
  +--[business found, session not done]---------+
     load onboarding_sessions by business_id    |
     stepDispatch(session, messageText)         |
     |                                          |
     +-- 'name'         → UPDATE businesses.name/slug; advance step
     +-- 'hours_N_query'→ parse yes/no; advance to open/close or next day
     +-- 'hours_N_open' → validate HH:MM; save in collected_data; advance
     +-- 'hours_N_close'→ validate HH:MM; INSERT business_hours row; advance
     +-- 'svc_name'     → save to collected_data; advance
     +-- 'svc_price'    → validate cents; save to collected_data; advance
     +-- 'svc_duration' → validate minutes; INSERT services row; advance to 'svc_more'
     +-- 'svc_more'     → "Άλλη υπηρεσία;" yes→'svc_name', no→activate
     +-- activate:
           callTelegramApiDirect(botToken, 'deleteWebhook', {})
           callTelegramApiDirect(botToken, 'setWebhook', {url, secret_token})
           UPDATE businesses SET webhookId, webhookSecret confirmed-active
           UPDATE onboarding_sessions SET current_step='done'
           sendTelegramMessage(ownerId, "Η επιχείρησή σας είναι ενεργή!")

Per-business bot (existing)
POST /webhooks/telegram/:webhookId
  |
  +-- [sender == ownerTelegramId AND Greek edit keyword detected]
  |   routeOwnerEdit(business, senderTelegramId, messageText)   ← NEW (ONB-03)
  |
  +-- [else]
      routeConversationMessage(...)                              ← unchanged
```

### Recommended Project Structure (new files only)

```
src/
├── webhooks/
│   ├── telegram.ts          # existing — add ONB-03 keyword intercept
│   └── platform.ts          # NEW — platform bot webhook handler
├── onboarding/
│   ├── router.ts            # NEW — state machine step dispatcher
│   ├── steps.ts             # NEW — individual step handlers (name/hours/services)
│   └── queries.ts           # NEW — onboarding_sessions DB CRUD
migrations/
│   └── 0004_phase5_onboarding.sql  # NEW — onboarding_sessions table
tests/
├── helpers/
│   └── test-business.ts     # NEW — insertTestBusiness() helper
├── onboarding-platform.test.ts  # NEW — platform handler integration tests
└── onboarding-flow.test.ts      # NEW — state machine unit tests
```

### Pattern 1: DB-Backed State Machine Step Dispatch

**What:** `current_step` is a single text column that uniquely determines the next action. No branching logic outside of the step handler functions.

**When to use:** Any multi-turn guided conversation where the owner can drop off and resume.

**Recommended step enum (Claude's discretion — this is the recommended design):**

```typescript
// Source: codebase analysis — matches D-04/D-07/D-08/D-09 from CONTEXT.md
type OnboardingStep =
  | 'name'
  | 'hours_0_query' | 'hours_0_open' | 'hours_0_close'
  | 'hours_1_query' | 'hours_1_open' | 'hours_1_close'
  | 'hours_2_query' | 'hours_2_open' | 'hours_2_close'
  | 'hours_3_query' | 'hours_3_open' | 'hours_3_close'
  | 'hours_4_query' | 'hours_4_open' | 'hours_4_close'
  | 'hours_5_query' | 'hours_5_open' | 'hours_5_close'
  | 'hours_6_query' | 'hours_6_open' | 'hours_6_close'
  | 'svc_name'
  | 'svc_price'
  | 'svc_duration'
  | 'svc_more'
  | 'done';

// When owner's day response is "closed", skip hours_N_open and hours_N_close,
// write isClosed=true row to business_hours, advance directly to hours_{N+1}_query.
// closed days still get a business_hours row (pattern from HOURS_FIXTURES in seed.ts).
```

**Why fine-grained:** Each step maps to exactly one message exchange. `current_step` alone is the resume anchor — no sub-state in `collected_data` needed for hours. The `collected_data` JSON only holds partial service-in-progress data during `svc_name`/`svc_price` steps.

### Pattern 2: Platform Bot Telegram API Calls (Explicit Token, No botTokenStore)

**What:** `getMe`, `setWebhook`, `deleteWebhook` are called with the owner's bot token — NOT the platform bot's token. These must bypass `botTokenStore`.

**Example:**

```typescript
// Source: codebase analysis — extends existing client.ts pattern
// Add to src/telegram/client.ts:

async function callTelegramApiDirect<T>(
  botToken: string,
  method: string,
  body: Record<string, unknown>
): Promise<T> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as TelegramApiResponse<T>;
  if (!response.ok || !data.ok) {
    throw new Error(data.description ?? `Telegram API error: ${response.status}`);
  }
  return data.result as T;
}

export async function getMeBotInfo(
  botToken: string
): Promise<{ id: number; username: string | undefined; firstName: string }> {
  const result = await callTelegramApiDirect<{
    id: number;
    username?: string;
    first_name: string;
    is_bot: boolean;
  }>(botToken, 'getMe', {});
  return { id: result.id, username: result.username, firstName: result.first_name };
}

export async function registerBotWebhook(
  botToken: string,
  webhookUrl: string,
  secretToken: string
): Promise<void> {
  await callTelegramApiDirect<boolean>(botToken, 'setWebhook', {
    url: webhookUrl,
    secret_token: secretToken,
  });
}

export async function unregisterBotWebhook(botToken: string): Promise<void> {
  await callTelegramApiDirect<boolean>(botToken, 'deleteWebhook', {});
}
```

### Pattern 3: `insertTestBusiness()` Helper (replaces seed fixtures in tests)

**What:** Writes directly to `businesses`, `services`, `businessHours` tables. No chat flow. Returns a usable Business object.

**Example:**

```typescript
// Source: codebase analysis — replaces seed.ts FIXTURES pattern (D-11)
// Create: tests/helpers/test-business.ts

import { db } from '../../src/database/db';
import { businesses, services, businessHours } from '../../src/database/schema';
import type { Business } from '../../src/database/queries';
import crypto from 'crypto';

interface TestBusinessOptions {
  name?: string;
  slug?: string;
  ownerTelegramId?: string;
  botToken?: string;
  webhookId?: string;
  webhookSecret?: string;
  withDefaultHours?: boolean;   // inserts 7 days: Mon-Sat 09:00-18:00, Sun closed
  withDefaultServices?: boolean; // inserts 1 default service
}

export async function insertTestBusiness(
  options: TestBusinessOptions = {}
): Promise<Business> {
  const webhookId = options.webhookId ?? crypto.randomUUID();
  const rows = await db
    .insert(businesses)
    .values({
      name: options.name ?? 'Test Business',
      slug: options.slug ?? `test-${webhookId.slice(0, 8)}`,
      ownerTelegramId: options.ownerTelegramId ?? '999999999',
      botToken: options.botToken ?? `test-token-${webhookId.slice(0, 8)}`,
      webhookId,
      webhookSecret: options.webhookSecret ?? crypto.randomBytes(32).toString('hex'),
    })
    .returning();
  const business = rows[0];

  if (options.withDefaultServices !== false) {
    await db.insert(services).values({
      businessId: business.id,
      name: 'Test Service',
      durationMin: 60,
      price: 2000,
    });
  }

  if (options.withDefaultHours !== false) {
    const hourRows = [0,1,2,3,4,5,6].map((day) => ({
      businessId: business.id,
      dayOfWeek: day,
      openTime: day === 0 ? '00:00' : '09:00',
      closeTime: day === 0 ? '00:00' : '18:00',
      isClosed: day === 0,
    }));
    await db.insert(businessHours).values(hourRows);
  }

  return business as Business;
}
```

### Pattern 4: ONB-03 Keyword Intercept in Per-Business Bot Handler

**What:** Owner edit commands are detected before routing to the booking AI agent. Simple `String.prototype.includes()` match on trimmed lowercase.

**Example:**

```typescript
// Source: codebase analysis — new logic in handleFoundBusiness() in telegram.ts

const OWNER_EDIT_KEYWORDS = [
  'αλλαγή ωραρίου',
  'νέα υπηρεσία',
  'αλλαγή τιμής',
  'διαγραφή υπηρεσίας',
] as const;

export function isOwnerEditCommand(text: string): boolean {
  const normalised = text.trim().toLowerCase();
  return OWNER_EDIT_KEYWORDS.some((kw) => normalised.includes(kw));
}

// In handleFoundBusiness(), add BEFORE routeConversationMessage():
if (
  business.ownerTelegramId === senderTelegramId &&
  isOwnerEditCommand(rawMessageText)
) {
  await routeOwnerEdit(business, senderTelegramId, rawMessageText, channel);
  return;
}
```

### Pattern 5: Express Platform Route Registration Order (CRITICAL)

**What:** The platform bot's fixed route `/webhooks/telegram/platform` must be registered as a full path in `server.ts` BEFORE `app.use('/webhooks/telegram', telegramWebhookRouter)`. [ASSUMED — inferred from Express route ordering rules]

**Example:**

```typescript
// Source: codebase analysis — src/server.ts modification

// CRITICAL: platform route BEFORE the /:webhookId router.
// Express matches in declaration order — if telegramWebhookRouter is declared
// first, its '/:webhookId' pattern matches '/platform' and steals the request.
app.post('/webhooks/telegram/platform', express.json(), platformBotWebhookHandler);
app.use('/webhooks/telegram', telegramWebhookRouter);
```

### Pattern 6: `onboarding_sessions` Schema (Migration 0004)

**What:** New table anchoring the DB state machine. `business_id` is NOT NULL (business row created with placeholder at registration time). `updated_at` uses Drizzle `$onUpdate`.

**Example:**

```typescript
// Source: codebase analysis — add to src/database/schema.ts

export const onboardingSessions = pgTable('onboarding_sessions', {
  id: serial('id').primaryKey(),
  // Phase 5: FK to businesses — NOT NULL because businesses row is created
  // immediately on bot token validation (with placeholder name until step 'name').
  businessId: integer('business_id')
    .notNull()
    .references(() => businesses.id),
  // Text enum — see OnboardingStep type in src/onboarding/router.ts.
  // 'done' = activation complete; sessions at 'done' are excluded from active lookup.
  currentStep: text('current_step').notNull(),
  // JSON blob: partial state for mid-step data (e.g. partial service being collected).
  // null when no partial state is in progress.
  collectedData: text('collected_data'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  // $onUpdate fires on every Drizzle .update() call (application-level, not DB trigger).
  updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
},
(table) => [
  // One active session per business (D-05). onConflictDoUpdate used on re-registration.
  uniqueIndex('unique_onboarding_session_per_business').on(table.businessId),
]);
```

### Pattern 7: `insertOrIgnoreTelegramUpdate` with Null businessId

**What:** Platform bot messages arrive before a business exists. `telegram_updates.business_id` is already nullable in the schema. The existing query must accept `null`.

**Example:**

```typescript
// Source: codebase analysis — update signature in src/database/queries.ts

export async function insertOrIgnoreTelegramUpdate(
  updateId: string,
  businessId: number | null,   // <-- changed from `number` to `number | null`
  senderTelegramId: string,
  updateType: string
): Promise<'inserted' | 'ignored'>
```

### Anti-Patterns to Avoid

- **Registering `/:webhookId` before `/platform` in the same Express prefix:** The dynamic param swallows the static route. Always declare fixed paths first.
- **Using `botTokenStore.run(ownerBotToken, ...)` for `getMe`/`setWebhook`:** Semantically wrong — `botTokenStore` is for the currently-serving bot; `getMe`/`setWebhook` on the owner's token are out-of-band registration calls. Use `callTelegramApiDirect` (explicit token).
- **Logging the bot token during `getMe`/`setWebhook`:** `callTelegramApiDirect` must NOT log the `botToken` parameter — it goes into the URL. Follow `client.ts` existing pattern of logging only the `method` name.
- **Calling `setWebhook` before `deleteWebhook` on re-registration:** Telegram returns a conflict error. Always call `deleteWebhook` first (documented STATE.md blocker). The activate step must always do: unregisterBotWebhook → registerBotWebhook.
- **Relying on `$onUpdate` for DB-side updated_at triggers:** Drizzle's `$onUpdate` is application-level — it only fires on Drizzle `.update()` calls, not on raw SQL updates or migrations.
- **Writing closed-day hours without a placeholder row:** `findBusinessHoursForDay` expects a row for every `dayOfWeek` (existing pattern from HOURS_FIXTURES). Even closed days must insert a row with `isClosed: true, openTime: '00:00', closeTime: '00:00'`.
- **Creating an onboarding session without a business row:** `onboarding_sessions.business_id` is NOT NULL. The business row (with placeholder name/slug) must be inserted first.
- **Reusing the `seed()` function for testing after Phase 5:** `seed.ts` will no longer seed businesses. Tests must use `insertTestBusiness()`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Webhook HMAC verification for platform bot | Custom header parsing | Exact same `crypto.timingSafeEqual` pattern from `src/webhooks/telegram.ts` Phase 4 | Already battle-tested; constant-time comparison required |
| Session lookup with business join | Raw SQL join | Drizzle `.innerJoin(businesses, ...)` in `onboarding/queries.ts` | Type-safe, RLS-compatible |
| Slug generation from business name | String manipulation | Existing `generateSlug()` in `src/database/seed.ts` | Already handles Greek business names, collision suffix, lowercase normalization |
| Platform bot token auth | Custom JWT/OAuth | `botTokenStore.run(PLATFORM_BOT_TOKEN, ...)` for outbound platform messages | Already used for per-business bots; same pattern works |
| UUID generation for webhookId | Custom random string | `crypto.randomUUID()` (Node.js 20+ built-in) | Collision-free, no extra package |
| Webhook secret generation | Custom entropy | `crypto.randomBytes(32).toString('hex')` (existing Phase 4 pattern) | Already in seed.ts; 64-char hex fits Telegram's 1-256 char limit |

**Key insight:** Phase 5 is almost entirely plumbing — connecting existing pieces (botTokenStore, registry, callTelegramApi, withBusinessContext, Drizzle) in a new sequence. Very little new logic; the risk is in the wiring.

## Runtime State Inventory

> This is a refactor/removal phase (ONB-04 removes fixture-seeded businesses).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Live Neon DB: `pilates-athens` and `hair-salon-athens` rows in `businesses`, `services`, `business_hours` tables (seeded at Phase 1). Also: `ownerTelegramId`, `botToken`, `webhookId`, `webhookSecret` set via `seed.ts` from TEST_BOT_* env vars. | **Data migration**: Delete fixture rows from live Neon DB before/after Phase 5. Do NOT delete during tests — test DB uses per-test insertions. |
| Live service config | No n8n workflows or external services reference `pilates-athens`/`hair-salon-athens`. No Telegram webhooks actively registered for fixture bots (Phase 4 seeds were for testing only). | None |
| OS-registered state | No scheduled tasks or OS services reference fixture names. | None — verified by grep of project |
| Secrets/env vars | `TEST_BOT_1_TOKEN`, `TEST_BOT_1_WEBHOOK_ID`, `TEST_BOT_1_WEBHOOK_SECRET`, `TEST_BOT_2_*` in `.env.local` and `fly.secrets`. These are fixture-specific. | Remove from `.env.local` and `fly secrets unset` after Phase 5. Add `PLATFORM_BOT_TOKEN`, `PLATFORM_WEBHOOK_SECRET`, `WEBHOOK_BASE_URL`. |
| Build artifacts | None — no compiled binaries or egg-info. `dist/` is rebuilt on each deploy. | None |

**Critical data migration note:** The live Neon DB contains fixture business rows. Phase 5 must include a task to DELETE these rows (or they remain as orphaned data). The local `randevuclaw_test` DB used by `booking-queries.test.ts` must NOT have fixture rows if `insertTestBusiness()` is used — the test DB should start clean.

## Common Pitfalls

### Pitfall 1: Express Route Shadow (`:webhookId` eats `/platform`)

**What goes wrong:** `app.use('/webhooks/telegram', telegramWebhookRouter)` is registered before the platform route. Every POST to `/webhooks/telegram/platform` gets routed to the `/:webhookId` handler with `webhookId='platform'`. The platform handler is never reached.

**Why it happens:** Express `app.use('/prefix', router)` mounts the router at `/prefix`. Inside the router, `router.post('/:webhookId', ...)` matches any single path segment — including `platform`.

**How to avoid:** In `server.ts`, register `app.post('/webhooks/telegram/platform', express.json(), platformBotWebhookHandler)` on the top-level `app` BEFORE `app.use('/webhooks/telegram', telegramWebhookRouter)`. The top-level route wins. [ASSUMED — inferred from Express route ordering rules, verified against Express docs pattern]

**Warning signs:** Platform bot registration never fires; Telegram delivers webhook messages to the platform bot but server logs show "Webhook ID not found" from the per-bot handler.

### Pitfall 2: `botTokenStore` is Platform Bot Context, Not Owner Bot Context

**What goes wrong:** During onboarding, the platform bot's `botTokenStore` holds `PLATFORM_BOT_TOKEN`. A call to `callTelegramApi('getMe', {})` validates the PLATFORM bot, not the owner's submitted token.

**Why it happens:** `callTelegramApi` reads from `botTokenStore`, which is set to the platform bot token during the platform handler's execution context.

**How to avoid:** Use `callTelegramApiDirect(ownerBotToken, 'getMe', {})` — a private function that takes an explicit token parameter and bypasses `botTokenStore`. Never log the token; log only the method name.

**Warning signs:** `getMe()` returns the platform bot's own info instead of the submitted bot's info; all bot tokens appear "valid" regardless of what was submitted.

### Pitfall 3: Missing Closed-Day `business_hours` Row

**What goes wrong:** The owner says "closed" for Sunday. The step handler skips the DB insert. Later, `findBusinessHoursForDay(businessId, 0)` returns `null`, causing the booking agent to error on Sunday queries.

**Why it happens:** The booking agent expects a row for every `dayOfWeek` 0–6 (this is the established pattern from `HOURS_FIXTURES` in `seed.ts`).

**How to avoid:** When the owner says "closed" for day N, always INSERT `business_hours(isClosed: true, openTime: '00:00', closeTime: '00:00')` — same as `HOURS_FIXTURES` closed-day pattern. Never skip the insert.

**Warning signs:** Booking queries fail for days that are supposed to be closed; null reference errors in availability logic.

### Pitfall 4: `setWebhook` Without `deleteWebhook` on Re-Registration

**What goes wrong:** An owner submits a new bot token after already completing onboarding. The `setWebhook` call returns an error: "Webhook was already set."

**Why it happens:** Telegram prevents setting a new webhook URL while one is already active. The conflict detection must happen at the application level.

**How to avoid:** The activation step in the state machine always calls `unregisterBotWebhook(botToken)` before `registerBotWebhook(botToken, ...)`. For re-registration, also call `unregisterBotWebhook(oldBotToken)` if `businesses.botToken` already exists and differs.

**Warning signs:** `setWebhook` throws "another webhook is active"; the per-business bot never comes online.

### Pitfall 5: Fixture Row Still Present in Test DB During `insertTestBusiness` Tests

**What goes wrong:** Test DB still contains `pilates-athens` row from previous seed. A test calls `insertTestBusiness({ slug: 'test-abc' })` and passes, but a different test that somehow references `pilates-athens` finds a stale row, creating phantom test data coupling.

**Why it happens:** The local `randevuclaw_test` DB is a real Postgres DB that persists between test runs. `seed()` is not called in tests (jest.setup.ts only sets env vars), but if `npm run db:seed` was run against the test DB, fixture rows exist.

**How to avoid:** Per D-12, each test file uses `beforeAll` to insert its own business and `afterAll`/`afterEach` to clean up. Run `DELETE FROM businesses WHERE slug LIKE 'pilates-athens' OR slug LIKE 'hair-salon-athens'` once as a migration step against the test DB.

**Warning signs:** `unique_slug` constraint violations when inserting a business with the same slug as a leftover fixture.

### Pitfall 6: `collected_data` Partial Service State Not Cleared on `svc_more → No`

**What goes wrong:** Owner says "yes" to another service, starts entering name, then drops off. Later resumes at `svc_name`. The `collected_data` JSON still has a partial `currentService` from the previous incomplete attempt. The step handler appends instead of replacing.

**Why it happens:** `collected_data` is only cleared when a full service is INSERTed, not when advancing back to `svc_name` from `svc_more`.

**How to avoid:** When advancing to `svc_name` (either first time or after "yes"), clear `collected_data.currentService = {}` in the UPDATE.

## Code Examples

### Drizzle `$onUpdate` for `updated_at`

```typescript
// Source: drizzle-orm 0.30.5+ release notes (websearch, LOW confidence)
// Fires on every Drizzle .update() call (application-level, not DB trigger)
updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date())
```

### Telegram `getMe` — Response Shape

```typescript
// Source: core.telegram.org/bots/api (websearch, LOW confidence)
// Valid token response: { ok: true, result: { id: number, is_bot: true, username?: string, first_name: string } }
// Invalid token response: { ok: false, error_code: 401, description: "Unauthorized" }
// callTelegramApiDirect throws on invalid token (existing callTelegramApi pattern).
```

### Active Session Lookup Query

```typescript
// Source: codebase analysis — admin db (no RLS), join pattern
const rows = await db
  .select({ session: onboardingSessions, business: businesses })
  .from(onboardingSessions)
  .innerJoin(businesses, eq(onboardingSessions.businessId, businesses.id))
  .where(
    and(
      eq(businesses.ownerTelegramId, senderTelegramId),
      not(eq(onboardingSessions.currentStep, 'done'))
    )
  )
  .limit(1);
```

### Greek Day Names for Prompts

```typescript
// Source: codebase analysis — matches Date.getDay() 0=Sunday convention (CRITICAL: not 1=Monday)
const GREEK_DAY_NAMES: Record<number, string> = {
  0: 'Κυριακή',
  1: 'Δευτέρα',
  2: 'Τρίτη',
  3: 'Τετάρτη',
  4: 'Πέμπτη',
  5: 'Παρασκευή',
  6: 'Σάββατο',
};
```

### Migration 0004 SQL Skeleton

```sql
-- migrations/0004_phase5_onboarding.sql
CREATE TABLE onboarding_sessions (
  id          SERIAL PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  current_step TEXT    NOT NULL,
  collected_data TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX unique_onboarding_session_per_business
  ON onboarding_sessions (business_id);

-- Grant app role access (platform bot uses admin db, but app role may need it for ONB-03 edit flows)
GRANT SELECT, INSERT, UPDATE ON onboarding_sessions TO randevuclaw_app;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded FIXTURES in `seed.ts` | `insertTestBusiness()` per-test helper | Phase 5 (ONB-04) | Tests no longer share hidden state; each test file is self-contained |
| Manual bot token in `TELEGRAM_BOT_TOKEN` env var | DB-driven per-bot tokens in `businesses.botToken` | Phase 4 | Platform bot adds `PLATFORM_BOT_TOKEN` as the only remaining global token |
| Webhook handler reads slug from URL | Webhook handler reads UUID `webhookId` from URL, looks up business by it | Phase 4 (D-04) | Bot tokens never appear in URLs or logs |
| `findBusinessBySlug()` as primary routing key | `findBusinessByWebhookId()` as primary routing key | Phase 4 | Slug-based routing gone from per-bot handler |

**Deprecated after Phase 5:**

- `FIXTURES`, `SERVICE_FIXTURES`, `HOURS_FIXTURES` constants in `seed.ts` — removed (D-10)
- `seed()` function — removed or gutted; `generateSlug()` retained
- `TEST_BOT_1_TOKEN`, `TEST_BOT_1_WEBHOOK_ID`, etc. env vars — removed from config schema
- Pilot business rows in Neon live DB — deleted via data migration task

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Fixed path `/webhooks/telegram/platform` must be registered before `app.use('/webhooks/telegram', telegramWebhookRouter)` on the top-level Express `app` to avoid shadowing | Architecture Patterns, Pitfall 1 | Platform bot never receives messages; silent routing failure |
| A2 | `callTelegramApiDirect` (explicit token, no botTokenStore) is the cleanest pattern for getMe/setWebhook/deleteWebhook on owner's bot token during platform bot handler | Architecture Patterns, Pattern 2 | If wrong: alternative is `botTokenStore.run(ownerToken, ...)` which is semantically misleading but functionally equivalent |
| A3 | `businesses.name` and `businesses.slug` are NOT NULL so the business row must be created with placeholder values at bot-token validation time, then updated at the 'name' step | Architecture Patterns | If nullable was acceptable: could defer business creation to 'name' step; simpler but requires nullable `business_id` FK in sessions |
| A4 | Live Neon DB contains fixture business rows that must be deleted as a data migration task in this phase | Runtime State Inventory | If not deleted: orphaned rows remain; no functional impact but misleading state |
| A5 | `$onUpdate(() => new Date())` on `updated_at` is supported in drizzle-orm 0.45.2 (documented from 0.30.5+) | Standard Stack, Pattern 6 | If wrong: set `updatedAt: new Date()` manually in every UPDATE call — trivial workaround |

## Open Questions (RESOLVED)

1. **Re-registration flow for completed businesses**
   - What we know: `deleteWebhook` must precede `setWebhook`; the platform bot creates the session
   - What's unclear: If an owner with a live bot (step='done') submits a new bot token, should the platform bot: (a) reset the session and start over, (b) allow token-only replacement, or (c) reject with "already registered"?
   - RESOLVED: For Phase 5 scope, implement (b): detect existing 'done' session, call `deleteWebhook` on the old token, replace `businesses.botToken`/`webhookId`/`webhookSecret`, reset session to 'name', let the owner re-configure. This handles the common "I made a new bot by mistake" case. Implemented in Plan 04 platform handler branch B1.

2. **Fixture row deletion from live Neon DB**
   - What we know: `pilates-athens`/`hair-salon-athens` are in the live DB; other tables FK to them
   - What's unclear: Do bookings, conversation turns, or other rows exist for these fixture businesses that must also be deleted (cascade or explicit)?
   - RESOLVED: Plan 07 Task 3 (human checkpoint) covers the DELETE with cascade guidance. Executor runs SELECT first to check for FK dependencies; deletes dependent rows before businesses rows if cascade is not available. Verified safe in Plan 07 threat model (T-05-18).

3. **ONB-03 edit state machine scope**
   - What we know: Keywords trigger edit flows; no Gemini involved (D-06)
   - What's unclear: Does the edit flow reuse the same `onboarding_sessions` state machine, or is it a separate per-edit conversation anchored differently?
   - RESOLVED: All four keywords implement actual DB writes. αλλαγή ωραρίου (upsert business_hours), νέα υπηρεσία (insert services), αλλαγή τιμής (update services.price) are single-turn: owner sends the keyword with inline data in one message (e.g. "αλλαγή ωραρίου Δευτέρα,09:00,17:00"); bot writes to DB and confirms. διαγραφή υπηρεσίας is two-turn (list services → owner sends number → delete row) using a module-level in-memory Map in edit-router.ts — no onboarding_sessions reuse needed. Implemented in Plan 05 Task 1.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All | ✓ | 20+ (project enforced) | — |
| PostgreSQL (randevuclaw_test) | `booking-queries.test.ts` + new integration tests | ✓ | See Phase 3 notes | — |
| `PLATFORM_BOT_TOKEN` | Platform bot startup | ✗ (not yet set) | — | Tests mock via jest.spyOn; prod requires real token |
| `PLATFORM_WEBHOOK_SECRET` | Platform bot HMAC | ✗ (not yet set) | — | Tests use jest.setup.ts placeholder |
| `WEBHOOK_BASE_URL` | `setWebhook` URL construction | ✗ (not yet set) | — | Tests use placeholder; prod requires fly.io domain |

**Missing dependencies with no fallback:**
- `PLATFORM_BOT_TOKEN`, `PLATFORM_WEBHOOK_SECRET`, `WEBHOOK_BASE_URL` — required in prod; `jest.setup.ts` must add test placeholders for CI.

**Missing dependencies with fallback:**
- None — all tooling is available.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest 29.7.0 with ts-jest |
| Config file | `jest.config.js` (existing) |
| Quick run command | `npm test -- --testPathPattern=onboarding` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BOT-01 | Bot token validated via `getMe()`, `setWebhook` called on activation | integration | `npm test -- --testPathPattern=onboarding-platform` | ❌ Wave 0 |
| BOT-01 | Invalid token rejected with Greek error message | unit | `npm test -- --testPathPattern=onboarding-platform` | ❌ Wave 0 |
| ONB-01 | Full guided flow (name → hours → services) completes with bookable business | integration | `npm test -- --testPathPattern=onboarding-flow` | ❌ Wave 0 |
| ONB-01 | Closed day writes `isClosed: true` row | unit | `npm test -- --testPathPattern=onboarding-flow` | ❌ Wave 0 |
| ONB-02 | Owner drops off after day 3, resumes at day 4 | integration | `npm test -- --testPathPattern=onboarding-flow` | ❌ Wave 0 |
| ONB-03 | Greek keyword `αλλαγή ωραρίου` detected, not forwarded to Gemini | unit | `npm test -- --testPathPattern=telegram-webhook` | ✅ (update needed) |
| ONB-03 | Non-owner cannot trigger edit commands | unit | `npm test -- --testPathPattern=telegram-webhook` | ✅ (update needed) |
| ONB-04 | `seed.ts` no longer has FIXTURES; `insertTestBusiness()` works | unit | `npm test -- --testPathPattern=fixtures` | ✅ (rewrite needed) |
| ONB-04 | All existing tests pass with `insertTestBusiness()` helper | regression | `npm test` | ✅ (multiple updates) |

### Sampling Rate

- **Per task commit:** `npm test -- --testPathPattern=<changed-area> --no-coverage`
- **Per wave merge:** `npm test` (full suite, ~208 tests + new Phase 5 tests)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `tests/onboarding-platform.test.ts` — covers BOT-01 (getMe validation, setWebhook, HMAC verification for platform bot)
- [ ] `tests/onboarding-flow.test.ts` — covers ONB-01 (full flow), ONB-02 (resume), step machine unit tests
- [ ] `tests/helpers/test-business.ts` — `insertTestBusiness()` helper used by all updated tests
- [ ] `tests/jest.setup.ts` — add `PLATFORM_BOT_TOKEN`, `PLATFORM_WEBHOOK_SECRET`, `WEBHOOK_BASE_URL` placeholders
- [ ] Framework install: none needed (Jest already configured)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Platform bot verifies HMAC on every incoming webhook (same `crypto.timingSafeEqual` as per-bot handler) |
| V3 Session Management | yes | `onboarding_sessions.current_step` owns state; no JWT/cookie; session is DB-row scoped to `business_id` |
| V4 Access Control | yes | Ownership anchored to `businesses.ownerTelegramId = from.id` (D-02); only the registering owner can drive their session |
| V5 Input Validation | yes | Bot token validated via Telegram `getMe` (not just regex); HH:MM time validated via regex `^([01]\d|2[0-3]):[0-5]\d$`; price validated as positive integer (euro cents); duration validated as positive integer (minutes) |
| V6 Cryptography | yes | `webhookId` = `crypto.randomUUID()`; `webhookSecret` = `crypto.randomBytes(32).toString('hex')` — never logged, never in URLs (same as Phase 4 pattern) |

### Known Threat Patterns for Platform Bot

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Replay attack on platform bot webhook | Spoofing | HMAC `timingSafeEqual` + `insertOrIgnoreTelegramUpdate` dedup (same as per-bot handler) |
| Unauthorized business creation (any user DMs bot token) | Elevation of privilege | One session per `ownerTelegramId`; `businesses.ownerTelegramId` anchors ownership at INSERT time; no separate "claim" step needed |
| Bot token theft via logs | Information Disclosure | `callTelegramApiDirect` logs only `method`, never `botToken`; `businesses.botToken` never included in structured log output |
| Malformed HH:MM input causing downstream slot-calculation errors | Tampering | Validate time strings with regex before writing to `business_hours.openTime`/`closeTime`; reject with Greek error message |
| Re-registration denial of service (exhausting webhook slots) | Denial of Service | `UNIQUE INDEX` on `onboarding_sessions.business_id` prevents duplicate sessions; re-registration resets existing session via `onConflictDoUpdate` |
| Prompt injection via business name field | Tampering | Business name stored verbatim in DB, displayed back to owner; not passed to Gemini during onboarding flow; low risk. Validate max length (e.g., 100 chars). |

## Sources

### Primary (MEDIUM confidence)

- Codebase — `src/telegram/client.ts`, `src/webhooks/telegram.ts`, `src/database/schema.ts`, `src/database/queries.ts`, `src/database/seed.ts`, `src/server.ts`, `src/config.ts`, `tests/jest.setup.ts` — direct code read confirming all existing patterns, table schemas, and migration history

### Secondary (LOW confidence — websearch)

- [Telegram Bot API Reference](https://core.telegram.org/bots/api) — `getMe`, `setWebhook`, `deleteWebhook` endpoint shapes
- [Drizzle ORM v0.30.5 release](https://orm.drizzle.team/docs/latest-releases/drizzle-orm-v0305) — `$onUpdate`/`$onUpdateFn` syntax
- [Express.js Routing Guide](https://expressjs.com/en/5x/guide/routing/) — route ordering: static before dynamic

### Tertiary (LOW confidence — training knowledge)

- Express route ordering behavior (`:param` matches static segments) — confirmed consistent with official docs

## Metadata

**Confidence breakdown:**

- Standard Stack: HIGH — all packages already installed and verified in codebase; no new packages
- Architecture: MEDIUM — state machine design is Claude's discretion (CONTEXT.md explicitly delegates); all patterns derived from existing codebase
- Telegram API shapes: LOW — from official docs via websearch; `getMe`/`setWebhook` shapes are stable but not verified via Context7 this session
- Pitfalls: MEDIUM — Express routing pitfall verified against docs; others derived from codebase analysis
- Test migration scope: HIGH — confirmed by grep of all test files referencing fixture slugs

**Research date:** 2026-07-14
**Valid until:** 2026-08-14 (stable domain — Telegram API and Express routing are stable)
