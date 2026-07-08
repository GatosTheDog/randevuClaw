# Phase 2: AI Booking Conversations & Owner Alerts - Research

**Researched:** 2026-07-08
**Domain:** Telegram Bot API integration, Gemini multi-turn function-calling, appointment availability schema, pending-booking expiry
**Confidence:** HIGH for Telegram & Gemini patterns; HIGH for schema design; MEDIUM for pending-booking expiry (requires implementation validation)

## Summary

Phase 2 transitions the platform from a simple message relay (Phase 1) to a fully conversational AI booking agent. **Key decision: Telegram Bot API replaces WhatsApp** as the primary channel for Phase 2, pending Meta Business Verification (D-01). The system handles multi-turn Greek-language conversations where clients book, cancel, or ask questions, owners receive alerts with inline keyboard buttons to accept/reject, and a 2-hour auto-expiry mechanism prevents stale pending bookings without requiring background jobs (uses PostgreSQL triggers). Sequential Gemini function-calling (per ARCHITECTURE.md) enforces booking atomicity; availability is queried at 1-hour granularity against a schema supporting multiple services with distinct durations and per-day business hours.

**Primary recommendation:** Build a channel-agnostic conversation router and AI function-calling layer that speaks to both Telegram (new) and WhatsApp (reusable from Phase 1), then implement the full availability schema (services, business_hours, bookings tables) with database-level constraints for double-booking prevention. Use Telegram's `callback_query` mechanism with inline keyboards (D-08) for owner approval/rejection, and implement the 2-hour pending-booking expiry via PostgreSQL trigger rather than cron jobs (to fit the Postgres-only stack from Phase 1).

**Key risks:**
1. **Gemini rate limits (15 req/min free tier):** Implement exponential backoff + circuit breaker (from PITFALLS.md Pitfall 4); load test with 10+ concurrent booking requests before going live
2. **Greek date/time parsing:** Pre-process relative expressions ("αύριο", "Παρασκευή") before LLM (from PITFALLS.md Pitfall 6); build 20+ test corpus
3. **Double-booking under concurrency:** Sequential Gemini function calls + UNIQUE DB constraints (from PITFALLS.md Pitfall 3); auto-test with dual concurrent bookings to same slot
4. **Pending booking expiry state machine:** Ensure transitions (pending → confirmed/rejected/expired) are atomic; expired bookings release their slot immediately (D-11)

---

## User Constraints (from CONTEXT.md)

### Locked Decisions (Research THESE)

**Messaging Channel Pivot (D-01 to D-04):**
- Phase 2 is built against **Telegram** (Bot API) first, not WhatsApp
- WhatsApp integration from Phase 1 stays but is shelved pending Meta Business Verification (1-6 week timeline, not our control)
- Structure code as channel-agnostic core (business resolution, dedup, Gemini conversation, booking logic) + thin channel adapters (Phase 1's WhatsApp adapter + new Telegram adapter)
- REQUIREMENTS.md and ROADMAP.md still say "WhatsApp" — treat as "Telegram" for Phase 2 implementation

**Booking Approval Scope (D-05 to D-07):**
- Owner accept/reject applies to **new bookings and reschedules only** (both claim a slot that could conflict)
- Cancellations are auto-processed, no owner veto, FYI alert only (per BOOK-02)
- New booking request → client receives "pending owner confirmation" (not "confirmed" yet)
- Second message follows once owner accepts or rejects

**Owner Response Mechanism & Timeout (D-08 to D-09):**
- Owner accepts/rejects via **Telegram inline keyboard buttons** (e.g., "Αποδοχή" / "Απόρριψη"), not text commands
- One tap; unambiguous which booking it targets (callback_query data)
- If owner doesn't respond: pending booking auto-expires after **2 hours**
- Client is told slot wasn't confirmed in time

**Slot Holding & Double-Booking Prevention (D-10 to D-11):**
- Booking request immediately locks its slot on entering `pending_owner_approval` state (DB row inserted)
- Second client requesting same slot while one pending is told slot is already requested
- When pending booking auto-expires or owner rejects it, slot hold is released immediately (no grace period)

**Availability Data Model (D-12 to D-14):**
- Build **full data model now**, not placeholder: per-service durations + per-day business hours (not one fixed hours block + generic service)
- `check_availability` reasons about open slots in **1-hour granularity**
- Exact service names/durations and weekly hours for two fixture businesses (pilates studio, hair salon) are left to planner — pick plausible Greek values

### Claude's Discretion

- Exact Greek wording for all new Telegram messages (pending-confirmation notice, owner alert text, expiry notice, confirmation/rejection replies)
- Exact schema/table design for availability model — services table, business_hours table, columns
- Telegram adapter internal structure (webhook handler shape, callback_query routing) — should mirror WhatsApp adapter patterns where reasonable
- Idempotency key format for Gemini function calls — left to planner/executor per research

### Deferred Ideas (OUT OF SCOPE)

- Per-business dedicated messaging accounts post-PoC
- Bringing WhatsApp back online once Meta Business Verification clears (future phase; adapter split is designed for this drop-in)
- Cancellation cutoff windows (BOOK2-01, v2 requirement) — cancellations stay unrestricted

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|-----------|-------------|----------------|-----------|
| Message ingestion & webhook validation | Backend (fly.io) | — | Telegram webhook handler validates X-Telegram-Bot-Api-Secret-Token; responsible for security + audit |
| Business disambiguation & tenant context | Backend (fly.io) | — | Resolve which business from message; set tenant_id in request scope before LLM |
| Conversation state management | Database (Postgres) | Backend cache | Hot state in memory/Redis optional; durable state in Postgres for recovery + audit |
| AI conversation & booking decisions | Backend (LLM boundary) | Database | Gemini makes decisions; database enforces constraints (double-booking prevention) |
| Slot availability queries | Database (Postgres) | Backend | Postgres services + business_hours + bookings tables; planner/executor optimizes query patterns |
| Booking persistence + constraints | Database (Postgres) | — | UNIQUE(business_id, calendar_date, calendar_time) prevents double-booking; ACID guarantees |
| Pending booking expiry | Database (Postgres trigger) | — | PostgreSQL BEFORE INSERT trigger on bookings table auto-expires old pending rows every insert |
| Owner approval/rejection UI | Telegram API | — | Inline keyboards with callback_query; backend processes callback via answerCallbackQuery |
| Owner alert dispatch | Telegram API | — | Send alert to owner phone via Telegram Bot API; callback_query button data includes booking_id |
| Timezone handling | Backend + Database | — | All times stored UTC in Postgres; display/parse as Europe/Athens for users; Drizzle schema handles TZ-aware columns |

---

## Standard Stack

### Messaging: Telegram Bot API

| Technology | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| **Telegram Bot API** | 2024-2026 current | Webhook + message send/receive | Official API; zero friction bot creation (BotFather token instant); inline keyboard callbacks built-in; `X-Telegram-Bot-Api-Secret-Token` for security |
| **node-telegram-bot-api** or **telegraf** | Latest (2026) | Node.js SDK wrapper | Popular, mature libraries; webhookCallback support with secretToken; TypeScript declarations |

**Telegram specifics:**
- Webhook registration via `setWebhook(url, secret_token)` — Telegram validates your endpoint accepts POST with JSON updates
- `secret_token` (1-256 chars) included in header `X-Telegram-Bot-Api-Secret-Token` on each delivery; validate before processing
- Callback queries from inline buttons arrive as `update.callback_query` in webhook JSON; respond with `answerCallbackQuery(callback_query_id, ...)` to show notification/alert
- `callback_query.data` field carries the metadata (booking_id, action) — no need for text parsing; one tap per button unambiguous
- Inline keyboard markup: `InlineKeyboardMarkup` with `InlineKeyboardButton` — attach to message for interactive UI
- **Free tier:** Unlimited messages, no rate limit per bot (differs from WhatsApp's conversation-tier limits); no approval/verification gate
- **Unlike WhatsApp:** No 24-hour window; all free-form messages allowed anytime. No template approval needed for Phase 2 (simplifies setup)

**Implementation pattern (from Phase 1 WhatsApp adapter):**
```typescript
// Mirror Phase 1's webhook handler shape:
// 1. Verify signature (X-Telegram-Bot-Api-Secret-Token vs stored token)
// 2. Deduplicate by message ID (from update.update_id) — INSERT OR IGNORE
// 3. Extract business context (parse message or deep-link)
// 4. Route to conversation router (AI agent)
// 5. After AI generates response, send via Telegram API
// 6. Mark message processed only after send succeeds
```

### AI: Google Gemini 2.5 Flash-Lite with @google/genai SDK

| Technology | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| **@google/genai** | 2.3.0+ | Gemini LLM + function-calling | Official SDK; supports Interactions API (stateful multi-turn); sequential function-calling (prevents race conditions); works with Node.js 20+; supports Greek language |
| **Gemini 2.5 Flash-Lite** | May 2026 | LLM model | Free tier: 15 req/min (sufficient for PoC); fast inference; native function-calling support |

**Gemini function-calling specifics:**
- **Stateful conversation:** Use `Interactions API` with `previous_interaction_id` to maintain history server-side; simpler than managing client-side history
- **Function definitions:** Define tool_choice functions (e.g., `check_availability`, `book_appointment`, `cancel_appointment`) in Gemini request; no MCP overhead (per CLAUDE.md)
- **Sequential execution:** Never parallelize function calls; always: (1) receive function call from Gemini, (2) execute it, (3) send result back to Gemini in next interaction (4) let Gemini decide next step
- **Idempotency:** Include `request_id` (unique per client request) in every function call; database stores request_id + uses it as dedup key
- **Multi-turn flow:** Example booking conversation:
  1. User: "Θέλω booking yoga αύριο στις 6" → Gemini classifies intent, calls `check_availability(date=tomorrow, time=18:00, business_id=...)`
  2. Result: slot is open → Gemini calls `book_appointment(phone=..., time=18:00, service_id=yoga_60)` → returns booking_id
  3. Gemini generates user response: "Booking pending owner confirmation!" → send to Telegram
  4. Owner taps "Αποδοχή" → callback_query arrives → call `approve_booking(booking_id=...)` → trigger separate Gemini function or direct DB update
- **Rate limits:** 15 req/min free tier; implement exponential backoff (1s, 2s, 4s, 8s) on 429 errors; circuit breaker at 80% quota (from PITFALLS.md)
- **Fallback on rate limit:** If 429 hit, respond to client: "Handling lots of bookings; please try again in 2 minutes"

**Tool definitions** (examples):
```typescript
const tools = [
  {
    name: "check_availability",
    description: "Check available slots for a service on a date",
    inputSchema: {
      type: "object",
      properties: {
        business_id: { type: "integer", description: "Business ID" },
        date: { type: "string", description: "YYYY-MM-DD format" },
        service_id: { type: "integer", description: "Service ID" },
        duration_min: { type: "integer", description: "Appointment duration in minutes" },
      },
      required: ["business_id", "date", "service_id", "duration_min"],
    },
  },
  {
    name: "book_appointment",
    description: "Create a new booking",
    inputSchema: {
      type: "object",
      properties: {
        business_id: { type: "integer" },
        client_phone: { type: "string" },
        service_id: { type: "integer" },
        calendar_date: { type: "string", description: "YYYY-MM-DD" },
        calendar_time: { type: "string", description: "HH:MM 24-hour format" },
        request_id: { type: "string", description: "Idempotency key (UUID)" },
      },
      required: ["business_id", "client_phone", "service_id", "calendar_date", "calendar_time", "request_id"],
    },
  },
  // ... cancel_appointment, approve_booking, etc.
];
```

**Greek date preprocessing** (before sending to Gemini):
- Client says "αύριο" → preprocess to tomorrow's ISO date (system_date + 1)
- Client says "Παρασκευή" → preprocess to next Friday's date
- Client says "στις 3 μ.μ." → preprocess to "15:00" in 24-hour format
- Client says "στις 3 π.μ." → preprocess to "03:00"
- Build a test corpus of 20+ Greek temporal expressions; validate before shipping (from PITFALLS.md Pitfall 6)

### Database: Postgres (Neon) + Drizzle ORM

| Technology | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| **Neon PostgreSQL** | 15+ | Serverless database | Free tier: 100 CU-hours/month, 0.5 GB storage per project; per-query pricing; optimized for fly.io |
| **Drizzle ORM** | 0.30+ | ORM + migrations | 7.4 KB (vs Prisma 1.6 MB); zero deps; multi-tenant RLS support; SQL-like control; good timezone handling |

**New tables for Phase 2:**

```typescript
// Services: what the business offers
export const services = pgTable("services", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull().references(() => businesses.id),
  name: text("name").notNull(), // "Yoga 60min", "Haircut", etc.
  durationMin: integer("duration_min").notNull(), // minutes
  price: integer("price"), // cents (nullable for Phase 2 if not collected yet)
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("unique_business_service").on(table.businessId, table.name),
]);

// BusinessHours: weekly schedule per business
export const businessHours = pgTable("business_hours", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull().references(() => businesses.id),
  dayOfWeek: integer("day_of_week").notNull(), // 0=Monday, 6=Sunday
  openTime: text("open_time").notNull(), // "08:00" HH:MM format
  closeTime: text("close_time").notNull(), // "18:00" HH:MM format
  isClosed: boolean("is_closed").notNull().default(false), // if true, day is closed
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("unique_business_day").on(table.businessId, table.dayOfWeek),
]);

// Bookings: client appointments (CORE table for Phase 2)
export const bookings = pgTable("bookings", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull().references(() => businesses.id),
  clientPhone: text("client_phone").notNull(), // From WhatsApp/Telegram
  serviceId: integer("service_id").notNull().references(() => services.id),
  calendarDate: text("calendar_date").notNull(), // "YYYY-MM-DD"
  calendarTime: text("calendar_time").notNull(), // "HH:MM" 24-hour format (slot start time)
  bookingStatus: text("booking_status").notNull().default("pending_owner_approval"),
  // pending_owner_approval | confirmed | cancelled | rejected | expired
  requestId: text("request_id").notNull(), // Idempotency key (UUID)
  ownerTelegramMessageId: integer("owner_telegram_message_id"), // Telegram message ID of owner alert (for editing)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"), // For auto-expiry (2 hours from creation)
}, (table) => [
  // D-10: Prevent double-booking via UNIQUE constraint
  uniqueIndex("unique_slot_per_business").on(table.businessId, table.calendarDate, table.calendarTime),
  // Idempotency: same request_id on retry returns cached result
  uniqueIndex("unique_request_per_client").on(table.clientPhone, table.requestId),
]);
```

**Availability query pattern (1-hour granularity):**
```typescript
// Pseudo-code for check_availability function
async function checkAvailability(businessId, date, serviceId, durationMin) {
  // 1. Get business hours for that date
  const hours = await db.query(`
    SELECT open_time, close_time FROM business_hours
    WHERE business_id = ? AND day_of_week = EXTRACT(DOW FROM ?::date)
  `, [businessId, date]);

  // 2. Generate 1-hour slots from open to close
  const slots = generateHourlySlots(hours.openTime, hours.closeTime);

  // 3. Filter out booked slots (check for conflicts)
  const booked = await db.query(`
    SELECT calendar_time FROM bookings
    WHERE business_id = ? AND calendar_date = ?
    AND booking_status IN ('pending_owner_approval', 'confirmed')
  `, [businessId, date]);

  // 4. For each slot, check if durationMin fits before next booked slot or close time
  const available = slots.filter(slot => {
    const slotEndTime = addMinutes(slot, durationMin);
    const isConflict = booked.some(b => 
      (slot >= b.calendar_time && slot < addMinutes(b.calendar_time, durationMin))
      || (slotEndTime > b.calendar_time && slotEndTime <= addMinutes(b.calendar_time, durationMin))
    );
    return !isConflict && slotEndTime <= hours.closeTime;
  });

  return available; // ["09:00", "10:00", "11:00", ...]
}
```

### Supporting: Timezone & Date Handling

| Library | Version | Purpose | When to Use |
|---------|---------|---------|------------|
| **date-fns** or **day.js** | Latest (2026) | Timezone-aware date parsing/formatting | Format dates for display; ensure all times are stored as UTC internally, parsed/displayed as Europe/Athens |

**Timezone rule:**
- All times stored in Postgres as UTC (`TIMESTAMPTZ`)
- When parsing user input (Telegram message): always assume Europe/Athens timezone
- When displaying to user: convert UTC to Europe/Athens for display
- Gemini receives date/time in ISO format (YYYY-MM-DD HH:MM UTC) but system confirms with user in Greece timezone

---

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| @google/genai | npm | ~6 mo | ~50K/wk | [github.com/googleapis/google-ai-nodejs-sdk](https://github.com/googleapis/google-ai-nodejs-sdk) | OK | Approved — official Google SDK, actively maintained |
| node-telegram-bot-api | npm | ~8 yrs | ~200K/wk | [github.com/yagop/node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api) | OK | Approved — stable, widely used, long history |
| telegraf | npm | ~6 yrs | ~150K/wk | [github.com/telegraf/telegraf](https://github.com/telegraf/telegraf) | OK | Approved — TypeScript-first, well-maintained |
| drizzle-orm | npm | ~2 yrs | ~300K/wk | [github.com/drizzle-team/drizzle-orm](https://github.com/drizzle-team/drizzle-orm) | OK | Approved — used in Phase 1, stable, growing adoption |
| date-fns | npm | ~6 yrs | ~2M+/wk | [github.com/date-fns/date-fns](https://github.com/date-fns/date-fns) | OK | Approved — standard for timezone-aware date handling in Node.js |

**Recommendation:** Phase 2 adds one new primary SDK (`@google/genai`) and one messaging library (choose either `node-telegram-bot-api` or `telegraf`; recommend `telegraf` for TypeScript ergonomics). Both are mature, widely used, and actively maintained.

---

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│ Telegram Bot (BotFather token, setWebhook registered)       │
│ ↓ Incoming message or callback_query                        │
└──────────────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────────────┐
│ Telegram Webhook Handler (fly.io Node.js)                  │
│  • Verify X-Telegram-Bot-Api-Secret-Token header             │
│  • Deduplicate by update_id (INSERT OR IGNORE messages)     │
│  • Extract business code from message text / deep-link       │
│  • Load conversation state from Postgres                     │
│  • Route: message → Conversation Router, callback_query → Owner Router  │
│  • Return HTTP 200 immediately                              │
└──────────────────────────────────────────────────────────────┘
                ↓                              ↓
        ┌───────────────┐            ┌──────────────────┐
        │ Conversation  │            │ Owner Router     │
        │ Router        │            │                  │
        │               │            │ Handle callback_ │
        │ • Extract     │            │ query from       │
        │   business    │            │ inline keyboard  │
        │ • Check       │            │ buttons          │
        │   consent     │            │ (approve/reject) │
        │ • Load state  │            │ → Update booking │
        │ • → AI Agent  │            │   status         │
        └───────────────┘            └──────────────────┘
                ↓
        ┌───────────────────────────────────────────────┐
        │ AI Agent (Gemini Function-Calling Loop)      │
        │  • System prompt: Greek, booking domain      │
        │  • Classify intent: book/cancel/ask/info    │
        │  • Sequential function calls:                │
        │    1. check_availability(...)                │
        │    2. book_appointment(...) if available     │
        │    3. Return result to Gemini                │
        │  • Generate Greek response text              │
        │  • Idempotency: include request_id           │
        └───────────────────────────────────────────────┘
                ↓
        ┌───────────────────────────────────────────────┐
        │ Function Execution Layer (Transactional)     │
        │  • check_availability: Query bookings + hours │
        │  • book_appointment: INSERT with UNIQUE      │
        │    constraint; idempotency key dedup         │
        │  • cancel_appointment: UPDATE status         │
        │  • Response: JSON {success, result, error}   │
        └───────────────────────────────────────────────┘
                ↓
        ┌───────────────────────────────────────────────┐
        │ Response Handler                             │
        │  • Format AI response as Telegram message    │
        │  • Send to client via Telegram API           │
        │  • If booking created: send owner alert      │
        │    with inline keyboard (approve/reject)     │
        │  • Store conversation checkpoint in Postgres │
        │  • Mark message processed                    │
        └───────────────────────────────────────────────┘
                ↓
        ┌───────────────────────────────────────────────┐
        │ Data Layer (PostgreSQL + Drizzle ORM)        │
        │  • services, business_hours, bookings tables │
        │  • UNIQUE constraint prevents double-booking │
        │  • Trigger: auto-expire pending bookings     │
        │    after 2 hours (D-09)                      │
        │  • Row-level filtering by business_id        │
        └───────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/
├── webhooks/
│   ├── telegram.ts          # NEW: Telegram webhook handler (mirrors whatsapp.ts)
│   └── whatsapp.ts          # EXISTING: Phase 1 (shelved but kept)
├── conversation/            # NEW: Shared conversation router
│   ├── router.ts            # Disambiguate business, load state, route intent
│   ├── ai-agent.ts          # Gemini function-calling loop (sequential)
│   ├── function-executor.ts # Execute check_availability, book_appointment, etc.
│   └── greek-preprocessor.ts # Pre-process temporal expressions
├── database/
│   ├── schema.ts            # EXTEND: Add services, business_hours, bookings tables
│   ├── queries.ts           # EXTEND: Availability check, booking creation
│   ├── migrations/          # NEW: Drizzle migration for Phase 2 schema
│   └── seed.ts              # EXTEND: Seed fixture services + hours
├── business/
│   ├── resolver.ts          # EXISTING: Phase 1 (reuse for Telegram too)
│   └── availability.ts      # NEW: Compute available slots
├── utils/
│   ├── logger.ts            # EXISTING: Reuse
│   ├── validation.ts        # EXISTING: Reuse
│   └── timezone.ts          # NEW: Europe/Athens timezone handling
└── config.ts                # EXISTING: Add TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET
```

### Pattern 1: Channel-Agnostic Conversation Router

**What:** Separate the channel-specific webhook handler (WhatsApp, Telegram) from the business logic (AI, booking, state management). Both channels call the same core router.

**When:** Always, for multi-channel support. Enables WhatsApp to slot back in later (D-03).

**Example (pseudo-code):**
```typescript
// src/webhooks/telegram.ts
async function handleTelegramWebhook(req: Request) {
  const token = req.headers['x-telegram-bot-api-secret-token'];
  if (token !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return { error: 'Unauthorized' };
  }

  const update = req.body;
  const messageId = update.update_id;

  // Dedup
  const cached = await db.query(`
    SELECT 1 FROM messages WHERE telegram_message_id = ?
  `, [messageId]);
  if (cached) return { success: true }; // Idempotent

  // Extract business + message content
  const businessCode = extractBusinessCode(update.message.text);
  const business = await resolver.resolveByCode(businessCode);
  const senderPhone = update.message.from.id; // Telegram user ID (use as unique identifier)

  // Core router (shared with WhatsApp)
  const response = await conversationRouter.handle({
    business,
    senderPhone,
    messageText: update.message.text,
    channel: 'telegram',
  });

  // Send response + mark processed
  await telegramClient.sendMessage(senderPhone, response.text);
  if (response.replyMarkup) {
    // Inline keyboard for owner approval
    await telegramClient.sendMessage(ownerPhone, response.ownerAlert, {
      reply_markup: response.replyMarkup,
    });
  }

  // Dedup mark
  await db.insert(messages).values({
    telegram_message_id: messageId,
    business_id: business.id,
    sender_phone: senderPhone,
    message_body: update.message.text,
    status: 'processed',
  });

  return { success: true };
}
```

### Pattern 2: Sequential Gemini Function Calling (No Parallelism)

**What:** After Gemini returns a function call, execute it synchronously, then send result back to Gemini. Never queue multiple calls in parallel.

**When:** Designing the AI booking loop — prevents race conditions and ensures booking atomicity (from ARCHITECTURE.md Pattern 3).

**Example (pseudo-code):**
```typescript
async function aiAgentLoop(userMessage: string, business: Business) {
  const requestId = uuidv4(); // Idempotency key for this conversation turn

  let contents = [{ role: "user", parts: [{ text: userMessage }] }];

  while (true) {
    const response = await gemini.generateContent({
      model: "gemini-2.5-flash-lite",
      contents,
      tools: BOOKING_TOOLS, // check_availability, book_appointment, etc.
      systemInstruction: `You are a helpful booking assistant for ${business.name}...`,
    });

    const functionCalls = response.functionCalls();
    if (!functionCalls || functionCalls.length === 0) {
      // No more calls; extract final response and return
      return response.text();
    }

    // Execute ONE call at a time
    for (const call of functionCalls) {
      const result = await executeTool(call.name, call.args, {
        business,
        requestId, // Include idempotency key
        senderPhone, // For context
      });

      // Add result back to conversation
      contents.push({ role: "model", parts: functionCalls });
      contents.push({ role: "user", parts: [{ functionResult: result }] });
    }
  }
}

// executeTool: dispatch to actual booking logic
async function executeTool(name: string, args: any, context: any) {
  switch (name) {
    case "check_availability":
      return await checkAvailability(args.business_id, args.date, args.service_id, args.duration_min);
    case "book_appointment":
      return await bookAppointment({
        ...args,
        idempotency_key: context.requestId,
      });
    case "cancel_appointment":
      return await cancelAppointment(args.booking_id);
    default:
      return { error: `Unknown function: ${name}` };
  }
}
```

### Pattern 3: Owner Approval via Telegram Callback Query

**What:** Send owner an alert with inline keyboard buttons (approve/reject). Owner taps button → Telegram sends `callback_query` → bot processes update and changes booking status.

**When:** New booking or reschedule arrives (D-05, D-08).

**Example (pseudo-code):**
```typescript
// Step 1: Send owner alert with inline keyboard
async function alertOwnerForApproval(booking: Booking, business: Business) {
  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: "Αποδοχή", callback_data: `approve_${booking.id}` },
        { text: "Απόρριψη", callback_data: `reject_${booking.id}` },
      ],
    ],
  };

  const message = `
Νέο booking:
Υπηρεσία: ${booking.service.name}
Ημερομηνία: ${booking.calendar_date}
Ώρα: ${booking.calendar_time}
Πελάτης: ${booking.client_phone}
  `;

  const sent = await telegramClient.sendMessage(business.ownerTelegramId, message, {
    reply_markup: inlineKeyboard,
  });

  // Store message ID for later editing (if needed)
  await db.update(bookings)
    .set({ owner_telegram_message_id: sent.message_id })
    .where({ id: booking.id });
}

// Step 2: Handle callback_query when owner taps button
async function handleCallbackQuery(update) {
  const callbackQuery = update.callback_query;
  const callbackId = callbackQuery.id;

  // Parse callback_data
  const [action, bookingId] = callbackQuery.data.split('_');

  // Update booking status
  if (action === 'approve') {
    await db.update(bookings)
      .set({ booking_status: 'confirmed' })
      .where({ id: bookingId });
    
    // Send confirmation to client
    const booking = await db.query(`SELECT * FROM bookings WHERE id = ?`, [bookingId]);
    await telegramClient.sendMessage(booking.client_phone, 
      `Το booking σας επιβεβαιώθηκε! Σας περιμένουμε...`);

    // Answer callback (removes loading spinner)
    await telegramClient.answerCallbackQuery(callbackId, {
      text: "Booking επιβεβαιώθηκε",
      show_alert: false,
    });
  } else if (action === 'reject') {
    await db.update(bookings)
      .set({ booking_status: 'rejected' })
      .where({ id: bookingId });

    // Notify client
    const booking = await db.query(`SELECT * FROM bookings WHERE id = ?`, [bookingId]);
    await telegramClient.sendMessage(booking.client_phone,
      `Δυστυχώς, το booking δεν ήταν δυνατόν. Δοκιμάστε άλλη ώρα.`);

    await telegramClient.answerCallbackQuery(callbackId, {
      text: "Booking απορρίφθηκε",
      show_alert: false,
    });
  }
}
```

### Pattern 4: PostgreSQL Trigger for 2-Hour Pending-Booking Expiry

**What:** Auto-expire pending bookings after 2 hours without requiring background jobs or cron (fits Postgres-only stack from Phase 1).

**When:** Every time a new booking is inserted, trigger cleans up old pending rows that exceed 2 hours.

**Why:** Avoids Phase 3 dependency (cron jobs); keeps all expiry logic in database layer; simple, reliable, no race conditions.

**Implementation (Drizzle migration or raw SQL):**
```sql
-- Trigger function: auto-expire old pending bookings
CREATE OR REPLACE FUNCTION expire_old_bookings()
RETURNS TRIGGER AS $$
BEGIN
  -- On any booking insert, delete pending bookings older than 2 hours
  DELETE FROM bookings
  WHERE booking_status = 'pending_owner_approval'
    AND created_at < NOW() - INTERVAL '2 hours'
    AND business_id = NEW.business_id; -- Only clean up for the affected business

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to bookings table
CREATE TRIGGER trigger_expire_bookings
AFTER INSERT ON bookings
FOR EACH ROW
EXECUTE FUNCTION expire_old_bookings();
```

**Alternative: Query-time expiry (no trigger):**
If triggers feel heavy, the app layer can check/expire on each `check_availability` query:
```typescript
async function checkAvailability(businessId, date, serviceId, durationMin) {
  // Expire stale pending bookings first
  await db.update(bookings)
    .set({ booking_status: 'expired' })
    .where({
      business_id: businessId,
      booking_status: 'pending_owner_approval',
      created_at: { lt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
    });

  // ... rest of availability check
}
```

**Decision:** Prefer trigger approach (D-09 intent is "auto-expiry", which trigger realizes cleanly). Query-time expiry is fallback if trigger complexity becomes an issue.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Telegram webhook signature validation | Custom header parser | Use `X-Telegram-Bot-Api-Secret-Token` header directly; compare string equality | Telegram's token is simple; no cryptographic operations needed (unlike WhatsApp's X-Hub-Signature HMAC) |
| Greek temporal expression parsing | Regex patterns | Pre-process with a Greek NLP library or hardcoded mapping table (e.g., {"αύριο": tomorrow, "Παρασκευή": next_friday}) | Regex will miss edge cases; colloquial Greek is irregular; test corpus of 20+ phrases must be validated (PITFALLS.md Pitfall 6) |
| Availability slot calculation | Manual time arithmetic | Date-fns or day.js for timezone-aware math; PostgreSQL interval arithmetic for queries | Time arithmetic with timezones, DST, and business hours is error-prone; off-by-one errors cause bookings to overlap |
| Double-booking prevention | App-layer checks | UNIQUE constraint on Postgres `(business_id, calendar_date, calendar_time)` | Database constraints are the only reliable lock under concurrent load; app layer has race conditions (PITFALLS.md Pitfall 3) |
| Pending booking expiry orchestration | Custom cron or background jobs | PostgreSQL trigger or query-time expiry check | No Redis, no cron infra until Phase 3; trigger is simple, reliable, keeps logic in database |
| Gemini function call sequencing | Parallel tool calls | Sequential execution: execute one, get result, send back to Gemini, repeat | Parallel calls lose the booking transaction boundary; idempotency keys + sequential execution prevents data corruption |

---

## Runtime State Inventory

N/A — Phase 2 is not a rename/refactor phase; it's feature addition. No existing runtime state to inventory. (Trigger if any migration of Phase 1 message/booking data is needed, but schema is additive, no renaming.)

---

## Common Pitfalls

### Pitfall 1: Gemini Rate Limits Cause Silent Failures Under Load

**What goes wrong:** (From PITFALLS.md Pitfall 4, extended for Phase 2)
Free tier is 15 req/min. Under realistic load (10+ concurrent booking requests), system hits 429 (Too Many Requests). Without proper retry logic, clients hang or get vague error messages. Booking requests are lost.

**Why it happens:** Developers test locally (1-2 req/min) and don't simulate concurrent load. 15 req/min is tight for a real PoC with 50+ DAU.

**How to avoid:**
- **Implement exponential backoff + jitter** on 429 errors: 1s, 2s, 4s, 8s max
- **Circuit breaker at 80% quota** — if approaching daily limit, switch to fallback response: "High demand; please try again in 2 minutes"
- **Load test with 15+ concurrent booking requests** before going live; measure response time and error rate
- **Monitor Gemini API dashboard** daily for quota usage; alert at 70% of daily limit
- **Budget for paid Gemini tier** (~$15/month) before scaling beyond PoC if rate limits are hit

**Warning signs:**
- Logs show "429 Too Many Requests" without retry logic
- Rapid-fire booking requests from multiple users result in timeouts
- Booking response times degrade over the day as quota is exhausted

**Verification in Phase 2 plan:**
- Add a "load test: 15 concurrent bookings to same time slot" task
- Add monitoring/alerting for Gemini quota usage

---

### Pitfall 2: Double-Booking Under Concurrent Requests

**What goes wrong:** (From PITFALLS.md Pitfall 3, extended for Phase 2 Telegram)
Two clients simultaneously request the same time slot. Both Gemini calls succeed, both call `book_appointment`, both bookings insert if the database layer isn't properly locked.

**Why it happens:** Developer assumes sequential Gemini calls alone prevent double-booking; they don't. Race condition still exists between checking availability and inserting the booking.

**How to avoid:**
- **UNIQUE constraint on Postgres:** `UNIQUE(business_id, calendar_date, calendar_time)` is the last line of defense; insertion of second booking violates constraint → rolls back → returns error → AI tells client slot is taken
- **Idempotency keys:** Every booking includes a `request_id` (UUID per client request). If Gemini retries (or Telegram retries the webhook), same `request_id` ensures no duplicate insert
- **Test with dual concurrent bookings:** Automation test: fire two booking requests to same slot simultaneously; verify exactly one succeeds, other gets "slot unavailable" response
- **Verify sequential execution:** Logs show check_availability returns slot, then book_appointment runs, not both in parallel

**Warning signs:**
- Two bookings appear for the same time slot in the database
- `check_availability` returns a slot, but `book_appointment` fails on UNIQUE constraint for the same slot (indicates parallel checks)
- Rapid concurrent requests result in inconsistent outcomes

**Verification in Phase 2 plan:**
- Add "concurrent booking test" task (send two requests to same slot; expect exactly one success)
- Code review: inspect Gemini function call loop for parallelism; must be sequential

---

### Pitfall 3: Greek Date/Time Parsing Misses Colloquial Expressions

**What goes wrong:** (From PITFALLS.md Pitfall 6, extended for Phase 2)
Client says "αύριο στις 5 το απόγευμα" or "την Παρασκευή" or "σε 3 ημέρες". LLM or parser misinterprets, booking is for wrong day/time. User is confused; no-show risk.

**Why it happens:** Generic NLP libraries don't handle Greek well. LLM's knowledge of Greek temporal expressions is good but not perfect; needs validation.

**How to avoid:**
- **Pre-process Greek temporal expressions** before sending to Gemini:
  - Map: "αύριο" → tomorrow's ISO date, "μεθαύριο" → day-after-tomorrow, "πρόχθες" → day-before-yesterday
  - Map day names: "Παρασκευή" → next Friday's date, "Δευτέρα" → next Monday, etc.
  - Map times: "στις 3 π.μ." → "03:00", "στις 3 μ.μ." → "15:00", "το πρωί" → "09:00" (heuristic)
- **Build a test corpus:** Collect 20+ real Greek temporal expressions from target audience (pilates studios, hair salons); validate parser on each
- **Confirmation pattern:** After LLM extracts a date, always ask user to confirm: "Καταλαβαίνω ότι θέλεις Παρασκευή 4 Ιουλίου στις 5 μ.μ., σωστά;" (I understand you want Friday July 4 at 5 p.m., correct?)
- **Store timezone explicitly:** All parsing assumes Europe/Athens; no ambiguity

**Warning signs:**
- Bookings are consistently for the wrong day (e.g., Friday instead of Wednesday)
- LLM asks clarifying questions about dates repeatedly
- Users report booking "αύριο" but system shows a different day

**Verification in Phase 2 plan:**
- Add "Greek date parsing test corpus" task (20+ test cases, document results)
- Code review: inspect pre-processing logic; ensure all colloquial phrases are handled

---

### Pitfall 4: Telegram Callback Query Not Processed Before Message Edit

**What goes wrong:** Owner taps "Αποδοχή" button. Telegram sends callback_query. App processes it slowly (due to rate limits, long Gemini call). Meanwhile, Telegram UI is still showing the loading spinner. Owner taps again. Duplicate approval is processed. Booking status updates twice (idempotent) but creates confusion.

**Why it happens:** Developer doesn't call `answerCallbackQuery` immediately to dismiss the spinner; or doesn't validate that callback has been processed before allowing re-taps.

**How to avoid:**
- **Always call `answerCallbackQuery` before doing work:** This immediately dismisses the loading spinner, giving user feedback that the tap was received
- **Use callback_query id as dedup key:** If same callback_query id arrives twice, skip processing (Telegram retries if server is slow)
- **Edit message to remove buttons after processing:** Once approved/rejected, edit the message to remove the keyboard, preventing further taps

**Example:**
```typescript
async function handleCallbackQuery(update) {
  const cq = update.callback_query;
  const [action, bookingId] = cq.data.split('_');

  // Immediate response to remove spinner
  await telegramClient.answerCallbackQuery(cq.id, {
    text: action === 'approve' ? "Booking αποδεκτό" : "Booking απορρίφθηκε",
    show_alert: false,
  });

  // Check if already processed
  const existing = await db.query(`
    SELECT 1 FROM callback_processing WHERE callback_query_id = ?
  `, [cq.id]);
  if (existing) return; // Already handled, skip

  // Mark as processing
  await db.insert(callback_processing).values({ callback_query_id: cq.id });

  // Do work
  await db.update(bookings).set({ booking_status: action === 'approve' ? 'confirmed' : 'rejected' });

  // Edit message to remove buttons
  await telegramClient.editMessageReplyMarkup(cq.from.id, cq.message.message_id, {
    reply_markup: { inline_keyboard: [] }, // Clear buttons
  });
}
```

**Warning signs:**
- Owner taps button, nothing happens for several seconds (no spinner feedback)
- Owner taps again because they think it didn't register
- Logs show callback_query processed twice

---

## Code Examples

### Telegram Webhook Handler (Channel Adapter)

[CITED: telegramhpc.com/news/104](https://telegramhpc.com/news/104/) pattern adapted for RandevuClaw:

```typescript
import express from "express";
import { TelegramClient } from "../whatsapp/client"; // Reuse messaging interface
import { conversationRouter } from "../conversation/router";
import { db } from "../database/db";

const app = express();
app.use(express.json());

const telegramClient = new TelegramClient(process.env.TELEGRAM_BOT_TOKEN);

app.post("/telegram-webhook", async (req, res) => {
  // Signature validation (D-08)
  const secretToken = req.headers['x-telegram-bot-api-secret-token'];
  if (secretToken !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const update = req.body;
  const messageId = update.update_id;

  // Dedup by update_id
  try {
    await db.insert(messages).values({
      telegram_message_id: messageId,
      business_id: 0, // Will be set after business resolution
      sender_phone: update.message?.from?.id?.toString() || "unknown",
      message_body: update.message?.text || "",
      status: "received",
    });
  } catch (err) {
    // Duplicate message ID
    console.log(`Duplicate update_id: ${messageId}`);
    return res.json({ success: true });
  }

  try {
    // Handle message or callback_query
    if (update.message) {
      const senderPhone = update.message.from.id.toString();
      const messageText = update.message.text;

      // Extract business code
      const businessCode = extractBusinessCode(messageText);
      if (!businessCode) {
        await telegramClient.sendMessage(senderPhone, "Δε κατάλαβα τη δοσμένη επιχείρηση. Δοκιμάστε ξανά.");
        return res.json({ success: true });
      }

      // Resolve business
      const business = await db.query(`SELECT * FROM businesses WHERE slug = ?`, [businessCode]);
      if (!business) {
        await telegramClient.sendMessage(senderPhone, "Δεν βρέθηκε η επιχείρηση.");
        return res.json({ success: true });
      }

      // Route to conversation
      const response = await conversationRouter.handle({
        business,
        senderPhone,
        messageText,
        channel: "telegram",
      });

      // Send response
      await telegramClient.sendMessage(senderPhone, response.text);

      // If booking was created, send owner alert
      if (response.ownerAlert) {
        await telegramClient.sendMessage(business.owner_telegram_id, response.ownerAlert.text, {
          reply_markup: response.ownerAlert.inlineKeyboard,
        });
      }

      // Mark processed
      await db.update(messages)
        .set({ status: "processed", business_id: business.id })
        .where({ telegram_message_id: messageId });
    } else if (update.callback_query) {
      // Owner approval/rejection
      const cq = update.callback_query;
      await handleCallbackQuery(cq);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("Webhook error:", error);
    // Log to DLQ for manual replay
    return res.status(500).json({ error: error.message });
  }
});

function extractBusinessCode(text: string): string | null {
  // Look for business code in message (e.g., "pilates-athens")
  const codePattern = /([a-z-]+)/i;
  const match = text.match(codePattern);
  return match ? match[1].toLowerCase() : null;
}

async function handleCallbackQuery(cq: any) {
  const [action, bookingId] = cq.data.split("_");

  await telegramClient.answerCallbackQuery(cq.id, {
    text: action === "approve" ? "Booking επιβεβαιώθηκε" : "Booking απορρίφθηκε",
    show_alert: false,
  });

  const booking = await db.query(`SELECT * FROM bookings WHERE id = ?`, [bookingId]);
  if (!booking) return;

  if (action === "approve") {
    await db.update(bookings)
      .set({ booking_status: "confirmed" })
      .where({ id: bookingId });

    await telegramClient.sendMessage(booking.client_phone,
      `✓ Το booking σας επιβεβαιώθηκε!\nΗμερομηνία: ${booking.calendar_date}\nΩρα: ${booking.calendar_time}`);
  } else if (action === "reject") {
    await db.update(bookings)
      .set({ booking_status: "rejected" })
      .where({ id: bookingId });

    await telegramClient.sendMessage(booking.client_phone,
      `✗ Δυστυχώς, το booking δεν είναι δυνατόν. Δοκιμάστε άλλη ώρα.`);
  }
}

export default app;
```

### Availability Query with 1-Hour Granularity

[CITED: orm.drizzle.team/docs/sql-schema-declaration](https://orm.drizzle.team/docs/sql-schema-declaration):

```typescript
async function checkAvailability(
  businessId: number,
  date: string, // "YYYY-MM-DD"
  serviceId: number,
  durationMin: number
): Promise<string[]> {
  // 1. Get service duration
  const service = await db.query(`
    SELECT duration_min FROM services WHERE id = ? AND business_id = ?
  `, [serviceId, businessId]);

  if (!service) throw new Error("Service not found");

  // 2. Get business hours for that weekday
  const dayOfWeek = new Date(date).getDay();
  const hours = await db.query(`
    SELECT open_time, close_time FROM business_hours
    WHERE business_id = ? AND day_of_week = ?
  `, [businessId, dayOfWeek]);

  if (!hours || hours.is_closed) return []; // Closed that day

  // 3. Generate 1-hour slots (e.g., 09:00, 10:00, 11:00, ...)
  const slots = generateHourlySlots(hours.open_time, hours.close_time);

  // 4. Exclude slots that conflict with existing bookings
  const bookedSlots = await db.query(`
    SELECT calendar_time FROM bookings
    WHERE business_id = ?
      AND calendar_date = ?
      AND booking_status IN ('pending_owner_approval', 'confirmed')
  `, [businessId, date]);

  const bookedTimes = new Set(bookedSlots.map(b => b.calendar_time));

  // 5. Filter: slot is available if it + service duration doesn't overlap any booked time
  const available = slots.filter(slot => {
    // Check if this slot conflicts with any booked appointment
    for (const booked of bookedSlots) {
      const bookedStart = timeToMinutes(booked.calendar_time);
      const bookedEnd = bookedStart + durationMin; // Assume all bookings are durationMin (simplification)
      const slotStart = timeToMinutes(slot);
      const slotEnd = slotStart + durationMin;

      if (!(slotEnd <= bookedStart || slotStart >= bookedEnd)) {
        // Overlap detected
        return false;
      }
    }

    // Also check if slot + duration doesn't exceed close time
    const slotEnd = timeToMinutes(slot) + durationMin;
    const closeEnd = timeToMinutes(hours.close_time);
    return slotEnd <= closeEnd;
  });

  return available; // ["09:00", "10:00", "11:00", ...]
}

function generateHourlySlots(openTime: string, closeTime: string): string[] {
  const slots: string[] = [];
  const [openHour, openMin] = openTime.split(":").map(Number);
  const [closeHour, closeMin] = closeTime.split(":").map(Number);

  let hour = openHour;
  let minute = openMin;

  while (hour < closeHour || (hour === closeHour && minute < closeMin)) {
    slots.push(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
    hour += 1; // 1-hour granularity
    if (hour >= 24) break;
  }

  return slots;
}

function timeToMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| WhatsApp for all messaging (Phase 1 + 2) | Telegram for Phase 2, WhatsApp shelved (D-01) | July 2026 (Meta Verification delays) | Accelerates PoC validation; unblocks Phase 2 from external approval timeline |
| Redis for dedup + conversation state | Postgres-only dedup, state in Postgres (Phase 1) | July 2026 (budget + stack lock) | Simpler architecture, no external dependency; trade-off: slightly higher DB load |
| Parallel LLM tool calls | Sequential function-calling (Phase 2) | July 2026 (race condition discovery) | Prevents double-booking; adds latency to Gemini loop (acceptable) |
| Cron jobs for pending booking expiry | PostgreSQL trigger (Phase 2) | July 2026 (no cron infra until Phase 3) | Immediate cleanup; no background job coordination needed |
| WhatsApp templates for reminders | Telegram free-form messages (Phase 2) | July 2026 (channel pivot) | No approval bottleneck; unlimited message flexibility; caveat: Telegram-only advantage (WhatsApp lacks until Phase 3 template approval) |

**Deprecated/outdated (not used in Phase 2):**
- @google/generative-ai (deprecated, support ends Aug 2025) — **MUST use @google/genai instead** (from CLAUDE.md)
- Redis/Upstash for job queue (until Phase 3 adds cron/reminders)

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Telegram Bot API free tier has no rate limits per bot (unlike WhatsApp 250 conv/24h) | Standard Stack › Messaging | If Telegram enforces undocumented limits, PoC may hit ceiling at >100 DAU |
| A2 | @google/genai SDK 2.3.0+ supports multi-turn Interactions API | Standard Stack › AI | If SDK is older, must fall back to client-side history management (more complex state handling) |
| A3 | PostgreSQL trigger execution is fast enough to not block booking inserts | Architecture Patterns › Pattern 4 | If trigger causes insert latency >100ms, booking response times degrade; may need to defer expiry to query-time |
| A4 | 1-hour granularity availability is sufficient for typical salon/gym bookings | Architecture Patterns › Availability Query | If customer wants 30-min or 15-min slots, schema needs refinement (more complex slot calculation) |
| A5 | Drizzle ORM can enforce UNIQUE constraints at INSERT, returning conflict error to app layer | Architecture Patterns › Pattern 1 | If Drizzle doesn't expose constraint violation, must catch raw PostgreSQL error (error handling complexity) |

**If this table grows beyond 5 items:** Assumptions are high-risk. Planner should prioritize research/validation tasks.

---

## Open Questions

1. **Pending booking expiry state machine:** When a pending booking expires, what status value should it have? "expired"? And should expired bookings be soft-deleted or retained forever for audit trail?
   - What we know: D-09 says expire after 2 hours; client is told "slot wasn't confirmed in time"
   - What's unclear: Whether expired rows remain in database or are purged
   - Recommendation: Retain with status="expired" for audit trail; do NOT purge (helps diagnose "why didn't owner approve" issues)

2. **Gemini context size for Greek bookings:** How much conversation history should be stored before truncating? Single-turn booking vs. multi-turn Q&A?
   - What we know: Interactions API manages state server-side; Gemini has 1M token context window
   - What's unclear: Whether context accumulates across multiple client messages or is per-turn
   - Recommendation: Per-turn context (simplest); store full conversation checkpoints in Postgres if multi-turn memory needed (Phase 3 refinement)

3. **Owner phone number in Telegram:** How is the owner's Telegram user ID stored/obtained? Does business onboarding (Phase 4) collect this, or Phase 2 fixtures hardcoded?
   - What we know: D-08 says owner receives alert via Telegram
   - What's unclear: Setup/registration flow for owner's Telegram ID
   - Recommendation: Phase 2 fixtures hardcoded with placeholder owner Telegram ID; Phase 4 owns real owner signup

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Telegram Bot API (BotFather) | Telegram channel adapter | ✓ | 2026 current | — |
| Google Gemini API key | AI agent | ✓ | Free tier: 15 req/min | Paid tier ($15/mo) |
| Node.js | All code | ✓ | 20.x LTS | — |
| PostgreSQL (Neon) | Database | ✓ | 15+ | — |
| Express.js | HTTP server | ✓ | 4.18+ | — |

**Missing dependencies with fallback:**
- Gemini rate limits (15 req/min) — fallback: implement exponential backoff + circuit breaker (handled in code)

**Missing dependencies with no fallback:**
- None identified; all required services are available

---

## Validation Architecture

> Validation assumes nyquist_validation enabled (not explicitly set to false in config).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest + ts-jest (existing Phase 1 setup) |
| Config file | `jest.config.js` (if exists, verify; if not, set up in Phase 2) |
| Quick run command | `npm test -- src/conversation/ --testPathPattern="ai-agent"` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BOOK-01 | Client books appointment via Telegram chat | integration | `npm test -- booking.integration.test.ts` | ❌ Wave 0 |
| BOOK-02 | Client cancels via chat, auto-processes | integration | `npm test -- cancellation.integration.test.ts` | ❌ Wave 0 |
| BOOK-03 | Client checks availability ("έχετε ελεύθερο;") | unit | `npm test -- src/conversation/availability.test.ts` | ❌ Wave 0 |
| BOOK-04 | Client reschedules via chat | integration | `npm test -- reschedule.integration.test.ts` | ❌ Wave 0 |
| ASK-01 | Client asks hours/location/prices → bot answers | integration | `npm test -- faq.integration.test.ts` | ❌ Wave 0 |
| ASK-02 | Client asks freeform question → Gemini responds | integration | `npm test -- freeform.integration.test.ts` | ❌ Wave 0 |
| OWNR-02 | Owner receives alert + can approve/reject via Telegram buttons | integration | `npm test -- owner-approval.integration.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- src/conversation/ai-agent.test.ts` (quick run, AI agent function tests)
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green + integration tests pass before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/conversation/ai-agent.test.ts` — unit tests for Gemini function-calling loop (sequential execution, idempotency)
- [ ] `src/conversation/greek-preprocessor.test.ts` — unit tests for Greek date/time parsing (20+ test cases)
- [ ] `src/database/availability.test.ts` — unit tests for availability query with 1-hour granularity
- [ ] `tests/integration/booking.integration.test.ts` — end-to-end Telegram webhook → Gemini → booking
- [ ] `tests/integration/concurrency.integration.test.ts` — dual concurrent bookings to same slot (expect exactly one success)
- [ ] `jest.config.js` (if not present) — configure ts-jest for TypeScript support

*(If Phase 1 has existing Jest setup, extend it. Otherwise, set up Jest + ts-jest in Wave 0.)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | (Handled by business code in Phase 1; owner auth is Phase 4) |
| V3 Session Management | yes | Conversation state in Postgres (not client-side tokens); no session cookies (Telegram handles auth) |
| V4 Access Control | yes | Tenant filtering: WHERE business_id = ? (app-level); ensure Telegram user ID ↔ business mapping is unique |
| V5 Input Validation | yes | Zod schema validation for Gemini function args (check_availability, book_appointment); Greek date preprocessing |
| V6 Cryptography | no | Telegram uses HTTPS; X-Telegram-Bot-Api-Secret-Token is simple string comparison (not HMAC) |
| V7 Error Handling & Logging | yes | Log all Gemini 429 errors, booking failures, expiry events; no PII in logs (use hash of phone for tracing) |
| V8 Data Protection | yes | Client phone numbers stored in plaintext (acceptable for PoC); consider encryption-at-rest for Phase 3+ if GDPR compliance needed |

### Known Threat Patterns for {Telegram, Gemini, Postgres}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Telegram bot token leaked in logs/code | Elevation | Store token in fly.io secrets; never log it; use environment variable access only |
| Gemini API key leaked | Elevation | Store in fly.io secrets; rotate quarterly; monitor GCP for unusual API usage |
| SQL injection via Gemini function args | Tampering | Use parameterized queries (Drizzle ORM enforces); validate all Gemini args via Zod schema |
| Double-booking via concurrent requests | Tampering | UNIQUE constraint on Postgres + idempotency keys; test with concurrent load |
| Unauthorized callback_query processing | Authorization | Verify callback_query came from expected owner Telegram ID; do NOT process requests from other users |
| Timezone confusion (client books wrong time) | Tampering | Always display times in Europe/Athens; confirm times with user before booking |
| Pending booking expiry race condition | Tampering | Trigger or query-time check ensures expired bookings are marked before availability recheck |

---

## Sources

### Telegram Bot API
- [Telegram Bot API Official Documentation](https://core.telegram.org/bots/api) — webhook setup, callback_query handling
- [Step-by-Step: Telegram Bot API Webhook Integration](https://telegramhpc.com/news/104/) — practical webhook patterns
- [GramIO: Telegram Bot Framework for Node.js](https://gramio.dev/triggers/callback-query) — callback query handler example

### Google Gemini @google/genai
- [Function calling with the Gemini API | Google AI for Developers](https://ai.google.dev/gemini-api/docs/function-calling) — sequential vs parallel function calls
- [Interactions API | Gemini API | Google AI for Developers](https://ai.google.dev/gemini-api/docs/interactions-overview) — stateful multi-turn conversations
- [Rate limits | Gemini API](https://ai.google.dev/gemini-api/docs/rate-limits) — free tier 15 req/min confirmed

### Appointment Scheduling & Availability
- [A Database Model to Manage Appointments](https://vertabelo.com/blog/a-database-model-to-manage-appointments-and-organize-schedules/) — canonical schema design
- [PostgreSQL: scheduling table design](https://www.postgresql.org/message-id/001801bf7e1d$ca3c15f0$0a64a8c0@fries) — hours + availability queries

### PostgreSQL Expiry & Triggers
- [Automatically expire rows in Postgres](https://schinckel.net/2021/09/09/automatically-expire-rows-in-postgres/) — trigger-based expiry pattern
- [PostgreSQL trigger for deleting old records](https://www.the-art-of-web.com/sql/trigger-delete-old/) — implementation details

### Drizzle ORM
- [Drizzle ORM PostgreSQL Documentation](https://orm.drizzle.team/docs/get-started/postgresql-new) — table definitions, constraints

### Prior Phase 2 Research (Internal)
- `.planning/research/ARCHITECTURE.md` — stateless webhook handler, sequential AI execution, idempotency patterns
- `.planning/research/PITFALLS.md` — Pitfall 3 (double-booking), Pitfall 4 (rate limits), Pitfall 5 (multi-tenant), Pitfall 6 (Greek dates)
- `.planning/research/SUMMARY.md` — Phase 2 scope, key recommendations

### Prior Phase Context (Internal)
- `.planning/phases/01-foundation-webhook-business-resolution/01-CONTEXT.md` — dedup patterns, tenant isolation, Phase 1 decisions

---

## Metadata

**Confidence breakdown:**
- **Telegram Bot API integration:** HIGH — Official Telegram docs, well-documented patterns, mature libraries (telegraf, node-telegram-bot-api)
- **Gemini @google/genai function-calling:** HIGH — Official Google docs, Interactions API clearly documented, sequential vs parallel patterns well-established
- **Availability schema (1-hour granularity):** HIGH — Standard appointment scheduling design, tested in production SaaS apps
- **Pending booking expiry via trigger:** MEDIUM — PostgreSQL triggers are standard, but requires implementation validation (edge cases: clock skew, trigger performance under load)
- **Greek date preprocessing:** MEDIUM — Colloquial Greek temporal expressions are non-trivial; test corpus of 20+ phrases must be built and validated before shipping
- **Double-booking prevention (concurrent load):** MEDIUM — UNIQUE constraint + idempotency are solid, but requires load testing (10+ concurrent bookings) to validate in this specific system

**Research date:** 2026-07-08
**Valid until:** 2026-07-22 (2 weeks for fast-moving domain: Gemini API updates, Telegram API changes)
