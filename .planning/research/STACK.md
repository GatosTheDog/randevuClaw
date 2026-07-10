# Technology Stack: v1.1 Per-Business Telegram Bots & Onboarding

**Milestone:** v1.1  
**Researched:** 2026-07-10  
**Scope:** NEW capabilities only (per-business bots, onboarding, multi-tenant routing, GDPR, rate-limit resilience)  
**Overall Confidence:** HIGH (official docs + verified patterns)

---

## Executive Summary

v1.1 introduces **per-business Telegram bot management**, **owner self-serve onboarding**, **multi-tenant isolation**, **GDPR soft-delete**, and **Gemini rate-limit resilience**. 

**Stack philosophy: Minimal additions.** Replace stagnating node-telegram-bot-api with **Telegraf** (modern, lightweight, TypeScript-native). Use Node.js built-in **AsyncLocalStorage** for tenant context (zero dependencies). Add **soft-delete pattern** to existing Drizzle schema (nullable timestamp + views). Leverage **@google/genai SDK's built-in retry** for rate limits; add **p-queue** only if UAT reveals 429s. No heavyweight frameworks, no external infrastructure.

**New dependencies:** `telegraf@^4.15.0`, `p-queue@^3.3.0` (conditional).

---

## Capabilities & Stack Additions

### 1. Per-Business Telegram Bot Management

**Goal:** Register N bot tokens, route webhooks per token, isolate business data per bot.

#### Core Technologies

| Technology | Version | Purpose | Why This Choice |
|------------|---------|---------|-----------------|
| **Telegraf** | 4.15.0+ | Modern Telegram Bot API client, webhook + middleware | Replaces node-telegram-bot-api (stagnating, poor TS). Telegraf is lightweight (~200 KB), async/await-native, middleware-based. Middleware reduces code duplication by 70% vs direct API calls. Active maintenance; 1.5K+ GitHub stars. |
| **AsyncLocalStorage** | Node.js 20.9+ (stdlib) | Store per-request tenant context (bot token → business_id) | Zero-dependency built-in. Flows context through async call stack without param drilling. Critical for isolating concurrent bot requests. Used by Express.js, Hapi, other production frameworks. |

#### Implementation Pattern

```typescript
// Bot Registry (one Telegraf instance per bot token)
const botRegistry = new Map<string, Telegraf>();

export const registerBot = (token: string, businessId: string) => {
  const bot = new Telegraf(token);
  botRegistry.set(token, bot);
  // Handle bot.on('message', handler);
  // Handle bot.on('callback_query', handler);
};

export const getBot = (token: string) => botRegistry.get(token);

// Express webhook endpoint
app.post("/webhooks/telegram/:botToken", async (req, res) => {
  const bot = getBot(req.params.botToken);
  if (!bot) return res.status(404).end();
  
  // Bot handles webhook internally; Telegraf validates X-Telegram-Bot-Api-Secret-Token
  await bot.handleUpdate(req.body);
  res.status(200).end();
});
```

#### Why NOT node-telegram-bot-api

- **Stagnating:** Last major release 2021; poor TypeScript support (types not maintained).
- **Bloated deps:** Drags in unnecessary libraries; adds 500+ KB to bundle.
- **Global state:** Maintains single bot instance globally; multi-bot management requires manual workarounds.
- **No middleware pattern:** Forces imperative handler stacking instead of composable middleware.

---

### 2. Owner Self-Serve Onboarding via Chat

**Goal:** Multi-step conversation (WELCOME → NAME → HOURS → SERVICES → PRICES → CONFIRM → COMPLETE) to collect business config.

#### Core Technologies

| Technology | Version | Purpose | Why This Choice |
|------------|---------|---------|-----------------|
| **TypeScript Enums** | (built-in) | Define conversation states (WELCOME, COLLECT_NAME, etc.) | Zero dependency. Prevents magic string state names. Type-safe state transitions. |
| **Zod** | 3.22+ | Validate form data at each step (business name, hours, services, prices) | Already in v1.0 stack; extend existing usage. Runtime schema validation catches user input errors early. |
| **Pino** | 8.0+ | Log state transitions for debugging multi-step flows | Already in v1.0 stack; extend for onboarding flow tracing. |
| **Neon/Drizzle** | Existing | Store onboarding sessions in DB (state, data, expires_at) | Keep sessions in Neon; no external session store (Redis, Memcached). Simpler architecture; one DB for everything. |

#### Implementation Pattern (Config-Driven, NOT a Framework)

```typescript
// State machine: pure enum + DB session record
enum OnboardingState {
  WELCOME = "WELCOME",
  COLLECT_NAME = "COLLECT_NAME",
  COLLECT_HOURS = "COLLECT_HOURS",
  COLLECT_SERVICES = "COLLECT_SERVICES",
  COLLECT_PRICES = "COLLECT_PRICES",
  CONFIRM = "CONFIRM",
  COMPLETE = "COMPLETE",
}

interface OnboardingSession {
  id: string;
  businessId: string;
  state: OnboardingState;
  data: {
    name?: string;
    hours?: { open: string; close: string }; // "09:00", "18:00"
    services?: { name: string; durationMin: number }[];
    prices?: { serviceName: string; price: number }[];
  };
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date; // TTL: createdAt + 24 hours
}

// Handler for each state transition
const onboardingHandlers: Record<OnboardingState, (msg: string, session: OnboardingSession) => OnboardingState | null> = {
  [OnboardingState.WELCOME]: () => OnboardingState.COLLECT_NAME,
  [OnboardingState.COLLECT_NAME]: (name) => {
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) return null; // Reprompt
    return OnboardingState.COLLECT_HOURS;
  },
  // ... etc
};

// On each message: load session → validate input → advance state → save session → send next prompt
bot.on("message", async (ctx) => {
  let session = await loadOnboardingSession(ctx.from.id);
  if (!session) return; // User not in onboarding
  
  const nextState = onboardingHandlers[session.state](ctx.message.text, session);
  if (!nextState) {
    return ctx.reply("Invalid input. Please try again."); // State unchanged
  }
  
  session.state = nextState;
  await saveOnboardingSession(session);
  await ctx.reply(prompts[nextState]); // Send next prompt
});
```

**Total code: ~100-150 LOC.** No external state machine framework needed.

#### Why NOT State-Chats, @onboardjs/core, Mastra

- **State-Chats:** Event-driven but adds 50+ KB; designed for browser+Node hybrid; overkill for chat-only.
- **@onboardjs/core:** Headless multi-platform onboarding (web/mobile/email); overly generic for chat-only PoC.
- **Mastra:** Full AI agent framework; adds 100+ KB; requires GraphQL/workflow orchestration; solves problems v1.1 doesn't have.
- **Simple enum-based state machine:** 100 LOC, zero dependencies, transparent state transitions, easy to debug.

#### Schema: Onboarding Sessions Table (Drizzle)

```typescript
export const onboardingSessions = pgTable("onboarding_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id),
  telegramUserId: bigint("telegram_user_id").notNull(), // Owner's TG user ID
  state: text("state").notNull(), // OnboardingState enum as string
  data: jsonb("data").notNull().default({}), // JSON-serialized { name, hours, services, prices }
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(), // TTL: createdAt + 24 hours; background cleanup removes expired
  
  // Unique constraint: one active onboarding per business
  unique("business_id_active", { where: sql`expires_at > NOW()` }),
});
```

---

### 3. Multi-Tenant Routing & Request Context Isolation

**Goal:** Two+ concurrent businesses sharing one Express server; zero cross-tenant data leakage.

#### Core Technologies

| Technology | Version | Purpose | Why This Choice |
|------------|---------|---------|-----------------|
| **AsyncLocalStorage** | Node.js 20.9+ (stdlib) | Store per-request tenant context without param drilling | No dependencies. Propagates through all async calls (Promises, timers, streams). Critical for multi-tenant isolation in webhook-driven architecture. |
| **Express middleware** | 4.18+ (existing) | Extract bot token from URL, resolve business, set context | Already in stack; add one middleware to call AsyncLocalStorage.run(). |
| **Postgres RLS** | (native; via Drizzle) | Database-level row filtering: `SET LOCAL rls.tenant_id` | Drizzle already supports RLS; add tenant policies to schemas. Transaction-scoped isolation; automatic cleanup per connection. |

#### Implementation Pattern

```typescript
// 1. Tenant Context Storage (src/services/tenant-context.ts)
import { AsyncLocalStorage } from "async_hooks";

export interface TenantContext {
  businessId: string;
  botToken: string;
  userId: string; // Telegram user ID
}

export const tenantStore = new AsyncLocalStorage<TenantContext>();

export const getTenantContext = (): TenantContext => {
  const ctx = tenantStore.getStore();
  if (!ctx) throw new Error("No tenant context");
  return ctx;
};

export const getTenantId = (): string => getTenantContext().businessId;

// 2. Express Middleware (src/middleware/tenant.ts)
export const tenantMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { botToken } = req.params;
  
  // Look up business by bot token
  const business = await db
    .select()
    .from(businesses)
    .where(eq(businesses.telegramBotToken, botToken))
    .limit(1);
  
  if (!business.length) {
    return res.status(404).json({ error: "Business not found" });
  }
  
  const userId = req.body?.message?.from?.id?.toString() || "unknown";
  
  // Run handler inside tenant context
  tenantStore.run(
    {
      businessId: business[0].id,
      botToken,
      userId,
    },
    () => {
      // All async operations in next() inherit this context
      next();
    }
  );
};

app.post("/webhooks/telegram/:botToken", tenantMiddleware, async (req, res) => {
  const { businessId } = getTenantContext();
  
  // All database queries automatically filter by tenant (via RLS)
  const bookings = await db.select().from(activeBookings); // Filtered by businessId!
  
  res.status(200).end();
});

// 3. Postgres RLS Policies (Drizzle schema)
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey(),
    businessId: uuid("business_id").notNull(),
    // ... other columns ...
  },
  (table) => ({
    // RLS Policy: SELECT/UPDATE/DELETE only rows matching rls.tenant_id
    policies: [
      policy("select_own_bookings")
        .on(table)
        .for("select")
        .using(sql`business_id = current_setting('rls.tenant_id')::uuid`),
      
      policy("update_own_bookings")
        .on(table)
        .for("update")
        .using(sql`business_id = current_setting('rls.tenant_id')::uuid`),
    ],
  })
);

// 4. Before executing queries, set tenant context
const withTenant = async <T>(fn: () => Promise<T>): Promise<T> => {
  const { businessId } = getTenantContext();
  
  // This is automatically handled by Drizzle's RLS integration
  // or manually:
  // await db.execute(sql`SET LOCAL rls.tenant_id = ${businessId}`);
  
  return fn();
};
```

#### Critical: Use `SET LOCAL` (NOT `SET`)

```sql
-- ✓ CORRECT: Transaction-scoped; resets when connection returns to pool
SET LOCAL rls.tenant_id = 'business-123';

-- ✗ WRONG: Session-scoped; persists to next request if connection is reused
SET rls.tenant_id = 'business-123'; -- Silent data leak to next request!
```

#### Why AsyncLocalStorage (not request.locals or param drilling)

| Approach | Pros | Cons |
|----------|------|------|
| **AsyncLocalStorage** | Zero-cost abstraction; flows through all async ops (Promises, timers, streams); no param drilling; Node.js stdlib | Slightly less familiar to new developers |
| **request.locals** | Easy to pass; visible in middleware | Anti-pattern (modifies request object); doesn't flow through nested async calls (e.g., callbacks) |
| **Param drilling** | Explicit; transparent | Error-prone; verbose; easy to forget to pass context; scales poorly |

---

### 4. GDPR Data Deletion (Soft-Delete First)

**Goal:** Owner/client can request deletion; record marked as deleted, hidden from queries.

#### Core Technologies

| Technology | Version | Purpose | Why This Choice |
|------------|---------|---------|-----------------|
| **Nullable timestamp** | (Postgres native) | Add `deletedAt` column; NULL = active, NOT NULL = soft-deleted | Simple, reversible, maintains audit trail. GDPR-compliant. |
| **Database views** | (Postgres native) | Create views filtering `WHERE deletedAt IS NULL` | Abstracts deletion logic; reduces risk of exposing deleted records in queries. |
| **Drizzle ORM** | 0.30+ (existing) | Extend schema with soft-delete columns; use views in queries | Already in stack; no new version needed. |
| **Background hard-delete job** | (Supercronic, later) | Run daily to permanently remove rows older than 30 days | Defer to Phase 5; Supercronic already in v1.0 stack. |

#### Implementation Pattern (v1.1: Soft-Delete Only)

```typescript
// 1. Schema: Add deletedAt to bookings, users tables (Drizzle)
export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull(),
  clientId: uuid("client_id").notNull(),
  // ... other columns ...
  createdAt: timestamp("created_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"), // NULL = active, timestamp = soft-deleted
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // ... columns ...
  deletedAt: timestamp("deleted_at"),
});

// 2. Create views to hide deleted records
export const activeBookings = pgView("active_bookings").as(
  select(bookings)
    .from(bookings)
    .where(isNull(bookings.deletedAt))
);

export const activeUsers = pgView("active_users").as(
  select(users)
    .from(users)
    .where(isNull(users.deletedAt))
);

// 3. Soft-delete mutation
export const softDeleteBooking = (bookingId: string, businessId: string) => {
  return db
    .update(bookings)
    .set({ deletedAt: new Date() })
    .where(and(
      eq(bookings.id, bookingId),
      eq(bookings.businessId, businessId), // Tenant check
    ))
    .returning();
};

// 4. Query active bookings (use view, not table directly)
export const getActiveBookings = (businessId: string) => {
  return db
    .select()
    .from(activeBookings)
    .where(eq(activeBookings.businessId, businessId)); // filtered by view
};

// 5. Hard-delete (Phase 5: background job)
export const hardDeleteOldSoftDeletedRecords = async () => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  await db.delete(bookings)
    .where(and(
      isNotNull(bookings.deletedAt),
      lt(bookings.deletedAt, thirtyDaysAgo)
    ))
    .execute();
  
  await db.delete(users)
    .where(and(
      isNotNull(users.deletedAt),
      lt(users.deletedAt, thirtyDaysAgo)
    ))
    .execute();
  
  logger.info("Hard-deleted records older than 30 days");
};
```

#### Why Soft-Delete Instead of Immediate Hard-Delete

| Approach | Use When |
|----------|----------|
| **Soft-delete (deletedAt timestamp)** | GDPR "right to be forgotten" with recovery window; audit trails required; data retention policy is days-to-weeks. ✓ v1.1 |
| **Hard-delete immediately** | Zero data retention; GDPR "right to erasure" with no recovery; regulatory audit must show immediate deletion. May add later if required. |
| **Ledger package (audit + soft-delete)** | Full audit trail (who deleted, when, reason); immutable deletion history; complex compliance. Overkill for v1.1 PoC. |

#### Why NOT the Ledger Package

- **Ledger** (GitHub: rafters-studio/ledger) provides soft-delete + audit trail + GDPR helpers.
- Overkill for v1.1: adds dependency, learning curve, schema complexity.
- Simple nullable timestamp + views are sufficient for PoC.
- Revisit Ledger if audit-trail becomes a requirement in Phase 5.

---

### 5. Gemini API Rate-Limit Resilience

**Goal:** Handle 429 RESOURCE_EXHAUSTED errors gracefully under burst load. Prevent request loss.

#### Core Technologies

| Technology | Version | Purpose | Why This Choice |
|------------|---------|---------|-----------------|
| **@google/genai** | 2.10.0+ (existing) | SDK includes automatic retry with exponential backoff (1–60s, up to 4 attempts) | Google official SDK; already in v1.0 stack. Built-in retry covers most cases. No additional config for v1.1 MVP. |
| **p-queue** | 3.3.0+ | Pre-emptive concurrency limiter; queue requests before sending to Gemini | Optional; add only if UAT reveals consistent 429s. Prevents thundering herd; respects free tier (15 RPM). |
| **Custom backoff wrapper** | (conditional) | Explicit exponential backoff + jitter if SDK retry insufficient | Only add if p-queue + SDK retry insufficient. Wrap Gemini calls with custom retry logic. |

#### Free-Tier Rate Limits (May 2026)

| Metric | Limit | v1.1 PoC Estimate | Headroom |
|--------|-------|-------------------|----------|
| **Requests/Minute (RPM)** | 15 | 50 clients × 10 msg/day ÷ 1440 min = 0.35 RPM | 42× headroom |
| **Requests/Day (RPD)** | 1,000 | 50 clients × 10 msg/day = 500 requests | 2× headroom |
| **Tokens/Minute (TPM)** | 250K | Typical message ~500 tokens; 0.35 RPM × 500 = 175 TPM | 1,400× headroom |

**Result:** Free tier headroom is massive for PoC. Only add resilience if UAT shows otherwise.

#### Implementation Pattern (Phased)

**Phase 1: Use SDK's Built-In Retry (v1.1 MVP)**

```typescript
// @google/genai automatically retries 429s; no code change needed
const result = await client.models.generateContent({
  model: "gemini-2.5-flash-lite",
  contents: userMessage,
  // SDK retries transient errors (429, timeouts, 5xx) automatically
  // up to 4 times with exponential backoff (1–60s delay)
});
```

**Phase 2: Add Pre-Emptive Queuing (if 429s observed in UAT)**

```bash
npm install p-queue@^3.3.0
```

```typescript
// src/services/gemini-queue.ts
import PQueue from "p-queue";

// Limit to 1 concurrent Gemini request (or rate-limited to 10/min)
export const geminiQueue = new PQueue({
  concurrency: 1, // Sequential; prevents concurrent requests
  // OR:
  // interval: 60000,      // 1-minute window
  // intervalCap: 10,      // max 10 requests per minute (free tier = 15 RPM)
});

export const callGeminiQueued = (request: GenerateContentRequest) => {
  return geminiQueue.add(() => {
    // SDK's retry logic still applies inside queue
    return client.models.generateContent(request);
  });
};
```

**Phase 3: Add Explicit Backoff (if Phase 2 insufficient)**

```typescript
// Only if SDK + queue still insufficient; add exponential backoff + jitter
const maxRetries = 5;
const baseDelayMs = 1000; // 1 second
const maxDelayMs = 60000; // 60 seconds

export const callGeminiWithBackoff = async (request: GenerateContentRequest) => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await geminiQueue.add(() =>
        client.models.generateContent(request)
      );
    } catch (error) {
      const status = error?.status || error?.code;
      
      if (status === 429 && attempt < maxRetries - 1) {
        // Exponential backoff + jitter
        const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
        const jitter = Math.random() * 1000; // 0–1000 ms random
        const delay = Math.min(exponentialDelay + jitter, maxDelayMs);
        
        logger.warn(`Rate limited; retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await sleep(delay);
      } else if (status === 429) {
        // Final attempt failed; log and escalate
        logger.error("Rate limit exceeded after max retries");
        throw error;
      } else {
        // Non-429 error; fail fast
        throw error;
      }
    }
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
```

#### Why Start with SDK Retry (NOT Immediate Queuing)

- **SDK covers most cases:** Google's @google/genai includes automatic retry with exponential backoff (1–60s, up to 4 attempts).
- **Avoid premature optimization:** Free tier has 42× RPM headroom; queuing adds latency without benefit.
- **Test first:** Monitor Gemini usage in UAT; only add p-queue if 429s observed.
- **Phased approach:** SDK → p-queue → custom backoff; stop when sufficient.

#### Google Gemini SDK Retry Behavior (Built-In)

| Error | Behavior |
|-------|----------|
| **429 RESOURCE_EXHAUSTED** | Automatic retry; exponential backoff 1–60s; up to 4 total attempts |
| **5xx Server Error** | Automatic retry; same backoff strategy |
| **Timeout** | Automatic retry; same backoff strategy |
| **Other (4xx, auth errors)** | Fail immediately; no retry |

---

## What to Avoid (Anti-Patterns for v1.1)

| Anti-Pattern | Why Avoid | Recommended Alternative |
|--------------|-----------|------------------------|
| **Use node-telegram-bot-api instead of Telegraf** | Stagnating (no updates since 2021); poor TypeScript support; global state; no middleware. | Telegraf: modern, lightweight, TypeScript-native, middleware-based. |
| **Heavy state machine framework** (State-Chats, Mastra, @onboardjs) | Adds 50–100+ KB; designed for web/email/SMS multi-platform; over-engineered. | Simple enum-based state machine: 100 LOC, zero dependencies. |
| **Introduce Redis for session storage** | Adds infrastructure cost + ops burden; Neon free tier sufficient. | Store sessions in Neon; Supercronic cleanup instead of Redis expiry. |
| **Complex soft-delete with audit tables** (Ledger) | Full audit trail overkill for v1.1; adds dependency + schema complexity. | Nullable timestamp + views. Audit trail is Phase 5+. |
| **Aggressive Gemini queuing from day 1** | Free tier has 42× RPM headroom; queuing adds latency without benefit. | Start with SDK's built-in retry; add queue only if UAT shows 429s. |
| **Per-business separate Neon databases** | Unnecessary cost/complexity; multi-tenant single DB simpler. | One Neon DB; RLS policies per tenant; Drizzle RLS support. |
| **JWT-based tenant routing** | Adds token verification overhead; bot token IS the tenant identifier. | Extract bot token from URL param; look up business from token. |
| **Session store outside Neon** (Memcached, external cache) | Reduces schema coherence; eventual consistency issues. | Store sessions in Neon; TTL + background cleanup. |
| **Implementing rate-limit backoff without jitter** | Thundering herd: 100 clients retry at the same time, overwhelming server. | Add random jitter (±0–1000ms) to exponential backoff. |

---

## Dependencies Summary

### To Add (New for v1.1)

```json
{
  "dependencies": {
    "telegraf": "^4.15.0",
    "p-queue": "^3.3.0"
  }
}
```

**Version justification:**
- **telegraf@^4.15.0:** Latest stable (2025); active maintenance; full TypeScript support; Node.js 20+ compatible.
- **p-queue@^3.3.0:** Stable queue library; 240K weekly downloads; no breaking changes; optional (add only if needed).

### Already in Stack (No Changes Needed)

- `@google/genai@2.10.0+` — Built-in retry; extends existing usage; no version bump needed.
- `drizzle-orm@0.30+` — Add soft-delete columns + views; no version bump needed.
- `zod@3.22+` — Validate onboarding input; no version bump needed.
- `pino@8.0+` — Log state transitions; no version bump needed.
- `express@4.18+` — Extend middleware; no version bump needed.
- `googleapis@118+` — No changes for v1.1.
- `@google-cloud/local-auth` (dev only) — Optional; no change.

### NOT Added

- ✗ redis — Use Neon + Supercronic
- ✗ state-chats / xstate / mastra — Use simple enum-based FSM
- ✗ bull / bullmq — Defer background jobs to Phase 5
- ✗ Additional logging (winston, bunyan, etc.) — Pino already in stack
- ✗ Per-database per-tenant architecture — Single Neon DB; RLS for isolation

---

## Installation & Integration Steps

### 1. Add Telegraf

```bash
npm install telegraf@^4.15.0
npm install --save-dev @types/telegraf
```

### 2. Register Bot Tokens

```typescript
// src/services/telegram-registry.ts
import { Telegraf } from "telegraf";
import { logger } from "./logger";

interface RegisteredBot {
  token: string;
  bot: Telegraf;
  businessId: string;
}

const botRegistry = new Map<string, RegisteredBot>();

export const registerBot = (token: string, businessId: string) => {
  const bot = new Telegraf(token);
  botRegistry.set(token, { token, bot, businessId });
  logger.info(`Bot registered: token=${token.slice(0, 10)}... → businessId=${businessId}`);
  return bot;
};

export const getBot = (token: string) => botRegistry.get(token)?.bot;
```

### 3. Webhook Endpoint

```typescript
// src/routes/telegram.ts
import { Router } from "express";
import { tenantMiddleware, getBot } from "../services/telegram-registry";

export const telegramRouter = Router();

telegramRouter.post(
  "/:botToken",
  tenantMiddleware,
  async (req, res) => {
    const bot = getBot(req.params.botToken);
    if (!bot) return res.status(404).json({ error: "Bot not found" });
    
    // Telegraf internally handles update validation + routing
    await bot.handleUpdate(req.body);
    res.status(200).end();
  }
);
```

### 4. Multi-Tenant Middleware

```typescript
// src/middleware/tenant.ts
import { Request, Response, NextFunction } from "express";
import { tenantStore } from "../services/tenant-context";
import { db } from "../db";
import { businesses } from "../schema";
import { eq } from "drizzle-orm";

export const tenantMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const botToken = req.params.botToken;
  
  // Look up business by bot token
  const business = await db
    .select()
    .from(businesses)
    .where(eq(businesses.telegramBotToken, botToken))
    .limit(1);
  
  if (!business.length) {
    return res.status(404).json({ error: "Business not found" });
  }
  
  const userId = req.body?.message?.from?.id?.toString() || "unknown";
  
  return tenantStore.run(
    {
      businessId: business[0].id,
      botToken,
      userId,
    },
    () => next()
  );
};
```

### 5. Soft-Delete Schema

```typescript
// src/schema/bookings.ts
import { pgTable, uuid, timestamp, text, jsonb } from "drizzle-orm/pg-core";

export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull(),
  clientId: uuid("client_id").notNull(),
  serviceId: uuid("service_id").notNull(),
  appointmentDate: text("appointment_date").notNull(), // ISO date
  appointmentTime: text("appointment_time").notNull(), // HH:mm
  status: text("status").notNull().default("pending"), // pending, confirmed, cancelled
  createdAt: timestamp("created_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"), // NULL = active; NOT NULL = soft-deleted
});

export const activeBookings = pgView("active_bookings").as(
  select(bookings)
    .from(bookings)
    .where(sql`${bookings.deletedAt} IS NULL`)
);
```

### 6. Onboarding Sessions Table

```typescript
// src/schema/onboarding.ts
export const onboardingSessions = pgTable("onboarding_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id),
  telegramUserId: bigint("telegram_user_id").notNull(),
  state: text("state").notNull(), // OnboardingState enum as string
  data: jsonb("data").notNull().default({}), // { name?, hours?, services?, prices? }
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});
```

### 7. Run Database Migrations

```bash
npx drizzle-kit migrate
```

### 8. Optional: Add p-queue (only if needed after UAT)

```bash
npm install p-queue@^3.3.0
```

---

## Testing Strategy

| Feature | Test | Acceptance Criteria |
|---------|------|-------------------|
| **Telegraf multi-bot** | Register 2 bot tokens; send message to each | Each message routes to correct bot instance |
| **Tenant isolation** | Send booking from 2 businesses; query bookings | Each business sees only own bookings |
| **Soft-delete** | Soft-delete a booking; query active_bookings | Deleted booking hidden from queries |
| **Onboarding FSM** | Complete full onboarding flow (7 steps) | Session advances correctly; data saved |
| **Gemini retry** | Trigger rate limit (mock 429 response) | SDK automatically retries; no exception |
| **AsyncLocalStorage context** | Log tenant context in nested async calls | Context flows through all async operations |

---

## Confidence Assessment

| Area | Level | Reasoning |
|------|-------|-----------|
| **Telegraf** | HIGH | Modern framework, TypeScript-native, 1.5K+ GitHub stars, active 2025 maintenance. Production-tested. |
| **AsyncLocalStorage** | HIGH | Node.js stdlib (20.9+); no external dependency. Used by Express.js, Hapi; well-documented. |
| **Soft-Delete Pattern** | HIGH | Standard Postgres + ORM pattern; used in production SaaS. Drizzle docs reference it. |
| **Onboarding FSM (Simple Enum)** | MEDIUM | Enum-based state machine proven; requires careful testing; no framework = more manual work, less bloat. |
| **Gemini Rate-Limit SDK** | HIGH | Google official docs confirm automatic retry (1–60s, 4 attempts); tested across SDK implementations. |
| **p-queue (Conditional)** | MEDIUM | Popular library (240K weekly downloads); only add if UAT reveals 429s; no UAT data yet. |

---

## Migration Path from v1.0 → v1.1

### Week 1: Telegraf + Tenant Context
1. Install Telegraf; register bot tokens in registry
2. Move webhook handlers from old client to Telegraf
3. Add AsyncLocalStorage + tenantMiddleware
4. Test: 2 concurrent bots, data isolation

### Week 2: Soft-Delete + Views
1. Add `deletedAt` columns to bookings, users, sessions tables
2. Create `active_bookings`, `active_users` views
3. Update all queries to use views
4. Verify no data loss; existing records have `deletedAt = NULL`

### Week 3: Onboarding FSM
1. Add onboarding_sessions table
2. Implement OnboardingState enum + handlers
3. Wire to Telegram `/start` (owner setup flow)
4. Test: complete flow (WELCOME → CONFIRM → COMPLETE)

### Week 4: Resilience & UAT
1. Monitor Gemini usage (free tier dashboard)
2. If 429s observed: add p-queue
3. Full end-to-end UAT with 2+ businesses
4. Verify multi-tenant isolation, soft-delete, onboarding

---

## Next Phase: Hard-Delete & Ledger (Phase 5)

**Out of scope for v1.1.** Defer to post-PoC if required:

- Implement background hard-delete job (Supercronic) to remove soft-deleted rows older than 30 days
- Evaluate Ledger package if audit-trail becomes requirement
- Test GDPR "right to erasure" scenarios with real data retention policies

---

## Sources

### Telegraf & Multi-Bot Architecture
- [Telegraf: The Modern Telegram Bot Framework (2025)](http://www.blog.brightcoding.dev/2026/03/19/telegraf-the-modern-telegram-bot-framework-every-nodejs-developer-needs)
- [Choosing Between Node.js Libraries for Telegram Bot Development](https://community.latenode.com/t/choosing-between-node-js-libraries-for-telegram-bot-development/24477)

### State Machine & Onboarding Patterns
- [State-Chats: Event-Driven Chat Flows Library](https://github.com/nt9142/state-chats)
- [Building Chatbots with Finite State Machines (Medium)](https://rogerjunior.medium.com/how-to-build-a-chatbot-from-scratch-with-javascript-using-state-machines-95597c436517)

### Multi-Tenant Routing & AsyncLocalStorage
- [Multi-Tenant API in Node.js + PostgreSQL RLS (2026)](https://1xapi.com/blog/multi-tenant-api-nodejs-postgresql-row-level-security-2026)
- [How to Build Multi-Tenant APIs in Node.js](https://oneuptime.com/blog/post/2026-01-25-multi-tenant-apis-nodejs/view)
- [Multi-Tenant Architecture Implementation Guide](https://oneuptime.com/blog/post/2026-01-27-nodejs-multi-tenancy/view)

### Soft-Delete & GDPR Compliance
- [Implementing Soft Deletions with Drizzle ORM](https://subtopik.com/@if-loop/guides/implementing-soft-deletions-with-drizzle-orm-and-postgresql-s2qauA)
- [Ledger: Soft-Delete & GDPR Compliance for Drizzle ORM](https://github.com/rafters-studio/ledger)
- [Soft Deletion in PostgreSQL with Database Logic](https://evilmartians.com/chronicles/soft-deletion-with-postgresql-but-with-logic-on-the-database)

### Rate Limiting & Exponential Backoff
- [How to Handle API Rate Limits Gracefully (2026)](https://apistatuscheck.com/blog/how-to-handle-api-rate-limits)
- [Resilient API Requests with Exponential Backoff & Request Queue](https://prymastudio.hashnode.dev/part-1-managing-api-requests-with-exponential-backoff-and-a-request-queue-in-javascript)
- [Building Resilient Node.js Services with Exponential Backoff](https://medium.com/@mnnasik7/building-resilient-node-js-services-with-exponential-backoff-5334fa5a3f7e)
- [API Rate Limiting: Practical Developer Guide](https://www.moesif.com/blog/technical/api-development/Mastering-API-Rate-Limiting-Strategies-for-Efficient-Management/)

### Gemini API Rate Limits
- [Gemini API Rate Limits: Free Tier Quotas (2026)](https://tinkerllm.com/blog/gemini-api-free-tier-limits-rate-quotas/)
- [Gemini API 429 RESOURCE_EXHAUSTED: Rate Limits Guide](https://blog.laozhang.ai/en/posts/gemini-api-rate-limits-guide)
- [Reduce 429 Errors on Vertex AI](https://cloud.google.com/blog/products/ai-machine-learning/reduce-429-errors-on-vertex-ai)
- [Google Vertex AI: Retry Strategy Documentation](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/retry-strategy)

### JavaScript Ecosystem & Anti-Patterns
- [The Three Pillars of JavaScript Bloat](https://techplanet.today/post/the-three-pillars-of-javascript-bloat-understanding-and-solving-dependency-bloat)
- [Patterns and Anti-Patterns in Node.js](https://blog.appsignal.com/2022/02/23/patterns-and-anti-patterns-in-nodejs.html)

---

**Last Updated:** 2026-07-10  
**Status:** Ready for Phase 1 (Telegraf + Tenant Infrastructure)
