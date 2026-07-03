# Architecture Patterns: WhatsApp Booking System

**Domain:** Multi-tenant SaaS conversational booking platform
**Researched:** 2026-07-03
**Stack:** Node.js/TypeScript, Postgres (Neon), Redis (Upstash), fly.io, Gemini API, WhatsApp Cloud API, Google Calendar API
**Confidence:** HIGH for core patterns; MEDIUM for transaction safety (requires implementation validation)

## Executive Summary

The system is a **multi-tenant webhook-driven conversational booking platform** serving many Greek businesses through a single shared WhatsApp Business number. The architecture emphasizes **stateless message handlers** (idempotent, replay-safe) backed by **persistent state** (Postgres for bookings, Redis for hot conversation context), with **sequential LLM function calling** (not parallel) to prevent race conditions and double-booking.

Key architectural decisions:
- **Pool multi-tenancy model:** Single Postgres instance, all tenants isolated by `tenant_id` column and row-level security
- **Webhook + checkpoint pattern:** Stateless handlers store conversation snapshots in Redis/Postgres, enabling recovery and replay
- **Sequential AI execution:** Gemini function calls execute one-at-a-time with idempotency keys; database constraints enforce booking uniqueness
- **Hybrid conversation storage:** Redis for fast hot access (conversation history, current slot checks), Postgres for durable episodic storage
- **Pre-approved message templates:** Reminders and daily agendas use WhatsApp template API (24-hour window constraints)
- **BullMQ + Redis:** Scheduled jobs for daily agendas, reminders, calendar sync

---

## Recommended Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ WhatsApp Cloud API (Webhook)                                │
│ ↓ Incoming message (text, status update, etc.)              │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Message Webhook Handler (fly.io Node.js/TypeScript)         │
│  • Verify X-Hub-Signature (Meta security)                   │
│  • Deduplicate by message ID (Redis TTL: 24h)               │
│  • Parse inbound message, extract business context          │
│  • Load conversation state from Redis                       │
│  • Call Conversation Router (below)                         │
│  • Persist webhook payload to Postgres (audit log)          │
│  • Return HTTP 200 immediately (async processing)           │
└─────────────────────────────────────────────────────────────┘
         ↓ (fork/queue)     ↓ (fork/queue)     ↓ (fork/queue)
    ┌─────────────────┐ ┌───────────────┐ ┌──────────────────┐
    │ Conversation    │ │ State Store   │ │ Audit & DLQ      │
    │ Router          │ │ (see below)   │ │ (Postgres)       │
    │                 │ │               │ │                  │
    │ • Identify      │ │ Redis/        │ │ • Webhook logs   │
    │   business      │ │ Postgres      │ │ • Error replay   │
    │   (code/phone)  │ │               │ │ • Compliance     │
    │ • Route:        │ │ • Hot state   │ │   (GDPR)         │
    │   Onboarding    │ │ • History     │ │                  │
    │   Booking       │ │ • Last AI     │ │ • Dead-letter    │
    │   Cancellation  │ │   context     │ │   queue          │
    │   FAQ/Support   │ │               │ │                  │
    │ • Queue to      │ │               │ │                  │
    │   AI Agent      │ │               │ │                  │
    └─────────────────┘ └───────────────┘ └──────────────────┘
         ↓
┌─────────────────────────────────────────────────────────────┐
│ AI Agent (Gemini Function Calling)                          │
│  • System prompt: Greek language, business context          │
│  • Classification: Is this booking/cancellation/FAQ/admin?  │
│  • Sequential function dispatch:                            │
│    1. Call function A, wait for result                      │
│    2. Use A's output to decide function B (if any)          │
│    3. Never parallel calls — prevents race conditions       │
│  • Retry policy: 2x with exponential backoff (Gemini limits)│
│  • Functions:                                               │
│    - check_availability(business_id, date, time, duration)  │
│    - book_appointment(business_id, phone, time, service_id) │
│    - cancel_appointment(booking_id, phone)                  │
│    - get_business_info(business_id)                         │
│    - list_services(business_id)                             │
│    - add_service(business_id, name, price, duration)        │
│    - set_hours(business_id, day, open_time, close_time)     │
│  • Outputs: Structured JSON with next_action, user_message  │
│  • Idempotency: Include request_id in every function call   │
└─────────────────────────────────────────────────────────────┘
      ↓ (after each function call)
┌─────────────────────────────────────────────────────────────┐
│ Function Execution Layer (Transactional Boundaries)         │
│  • check_availability: Queries Bookings table, no writes    │
│  • book_appointment: BEGIN → INSERT booking → COMMIT        │
│    - Constraint: UNIQUE(business_id, calendar_time, phone)  │
│    - Prevents double-booking at DB level                    │
│    - Sets booking_status = 'pending_owner_approval'         │
│    - Idempotency: ON CONFLICT (request_id) DO NOTHING       │
│  • cancel_appointment: UPDATE booking_status = 'cancelled'  │
│  • get_business_info: SELECT * FROM Businesses              │
│  • list_services: SELECT * FROM Services                    │
│  • add_service: INSERT into Services (for owner setup)      │
│  • set_hours: INSERT/UPDATE BusinessHours                   │
│                                                              │
│  All writes lock on tenant_id to prevent cross-tenant data  │
│  leakage (Row-Level Security enabled in Postgres)           │
└─────────────────────────────────────────────────────────────┘
      ↓ (after AI completes)
┌─────────────────────────────────────────────────────────────┐
│ Response Handler                                            │
│  • Update conversation state in Redis (TTL: 7 days)         │
│  • Format AI response as WhatsApp message                   │
│  • Send via WhatsApp API (send_message endpoint)            │
│  • If critical event (booking/cancellation/approval):       │
│    - Notify owner (separate WhatsApp send)                  │
│    - Trigger async job: sync to Google Calendar             │
│    - Trigger async job: schedule reminder (if booking)      │
│  • Log completion to audit table                            │
│  • Store conversation checkpoint to Postgres                │
└─────────────────────────────────────────────────────────────┘
      ↓ (async jobs, via BullMQ/Redis)
┌─────────────────────────────────────────────────────────────┐
│ Background Jobs (BullMQ + Redis)                            │
│  • Job: sync_booking_to_calendar                            │
│    - Triggered on: new booking approved, cancellation       │
│    - Action: Call Google Calendar API                       │
│    - Store Calendar event ID ↔ Booking ID mapping           │
│    - Retry on timeout (3x + exponential backoff)            │
│    - Dead-letter to Postgres if exhausted                   │
│                                                              │
│  • Job: send_daily_agenda                                   │
│    - Scheduled: Cron every day at 08:00 EET (owner's TZ)    │
│    - Action: Query today's bookings, send via template API  │
│    - Use pre-approved "Daily Agenda" template (Meta review)  │
│    - No retries (outside 24-hour window → template only)    │
│                                                              │
│  • Job: send_appointment_reminder                           │
│    - Scheduled: T-24h before appointment (or next working)   │
│    - Action: Send reminder to client via template API       │
│    - Use pre-approved "Appointment Reminder" template       │
│    - Log send status for tracking                           │
│                                                              │
│  • Job: sync_calendar_changes (fallback)                    │
│    - Scheduled: Every 6 hours                               │
│    - Action: Polling to detect owner's manual changes       │
│    - Reconcile with our Bookings table                      │
│    - Detect and flag conflicts                              │
└─────────────────────────────────────────────────────────────┘
      ↓
┌─────────────────────────────────────────────────────────────┐
│ Data Layer (Postgres + Redis)                               │
│  Postgres (Neon):                                           │
│    • Businesses (tenant_id, phone_number, timezone, etc.)   │
│    • Services (business_id, name, price, duration_min)      │
│    • Bookings (id, business_id, phone, time, status)        │
│    • BusinessHours (business_id, day_of_week, open/close)   │
│    • ConversationCheckpoints (session_id, state_json)       │
│    • WhatsAppAuditLog (webhook_id, payload_json, status)    │
│    • CalendarSync (booking_id, event_id, last_sync_time)    │
│    • Users (business_phone, display_name, timezone)         │
│                                                              │
│  Redis (Upstash):                                           │
│    • conversationState:[phone_number] → JSON (TTL: 7d)      │
│    • processedWebhooks:[webhook_id] → 1 (TTL: 24h)          │
│    • slots:[business_id]:[date] → list (cached availability)│
│    • BullMQ queues (job definitions, workers)               │
│                                                              │
│  Row-Level Security Policy:                                 │
│    tenant_id is context; all SELECT/INSERT/UPDATE/DELETE    │
│    automatically scoped to current tenant_id                │
└─────────────────────────────────────────────────────────────┘
```

---

## Component Boundaries

| Component | Responsibility | Input | Output | Dependencies |
|-----------|----------------|-------|--------|--------------|
| **Message Webhook Handler** | Parse incoming messages, deduplicate, route to business logic | WhatsApp webhook JSON | HTTP 200 (immediate); async queue job | Postgres (audit), Redis (dedup), Router |
| **Conversation Router** | Identify business, classify intent, load/save state | Raw message text, phone number | State-enriched message object | Postgres, Redis, AI Agent |
| **AI Agent (Gemini)** | Understand intent, decide which actions to take, generate response | Conversation state, message, business context | Function calls (sequential) + response text | Google Gemini API, Function Execution Layer |
| **Function Execution Layer** | Execute AI-requested operations (bookings, queries) with ACID guarantees | Function name + args | Result JSON (success/error) | Postgres (bookings, business data) |
| **Response Handler** | Format response, send WhatsApp reply, trigger follow-up jobs | AI output + operation results | WhatsApp message sent; background jobs queued | WhatsApp API, BullMQ, Redis, Postgres |
| **Background Jobs (BullMQ)** | Scheduled/deferred work: calendar sync, reminders, daily agendas | Job queue entries | External API calls (Google Calendar, WhatsApp) | Redis, Postgres, Google Calendar API, WhatsApp API |
| **Postgres** | Persistent, multi-tenant data store with ACID guarantees | Write/read requests | Rows | — |
| **Redis** | Hot cache + message broker for BullMQ | Get/Set/Queue operations | Values + job execution | — |
| **State Store (Redis/Postgres hybrid)** | Maintain conversation history, last AI context, idempotency keys | Conversation updates | State snapshots | — |
| **Audit & Dead-Letter Queue** | Log all webhooks, trace failures, enable replays | Webhook payloads, failed jobs | Stored records in Postgres | Postgres |

---

## Data Flow

### Happy Path: Client Books an Appointment

```
1. Client sends: "Θέλω να κάνω booking γιόγκα αύριο στις 6 το απόγευμα"
   ↓
2. WhatsApp → Meta servers → fly.io webhook
   ↓
3. Webhook handler:
   • Validates signature (Meta security)
   • Checks Redis for duplicate message ID → cache miss
   • Loads conversation state from Redis (first message → empty state)
   • Routes to AI Agent
   ↓
4. AI Agent (Gemini):
   • System prompt includes all businesses (disambiguates by context/name)
   • Classifies: intent = "book_appointment"
   • Calls function: check_availability(business_id=2, date=tomorrow, time=18:00, duration=60)
   ↓
5. Function Execution Layer queries Bookings table:
   • Checks slots for business_id=2 on that date/time
   • Returns: [{ slot_time: 18:00, status: available }]
   ↓
6. AI Agent receives availability, calls:
   book_appointment(business_id=2, phone="+306981234567", time=18_00, service_id=yoga_60min)
   ↓
7. Function Execution Layer (BEGIN TRANSACTION):
   • INSERT into Bookings with idempotency_key (prevents double-booking on retry)
   • Constraint violated if slot already taken → rolls back, returns error
   • Sets booking_status = 'pending_owner_approval'
   • COMMIT
   ↓
8. AI Agent receives booking ID, generates Greek response:
   "Το booking σας για αύριο στις 6 έχει δεχθεί! Ο ιδιοκτήτης θα το επιβεβαιώσει σύντομα."
   ↓
9. Response Handler:
   • Updates Redis conversation state (TTL 7 days)
   • Sends response message via WhatsApp API
   • Queues job: sync_booking_to_calendar (booking_id=XYZ)
   • Queues job: send_appointment_reminder (booking_id=XYZ, time=tomorrow 17:30)
   • Logs to ConversationCheckpoints (Postgres)
   ↓
10. Background jobs execute asynchronously:
    • sync_booking_to_calendar: Creates event in owner's Google Calendar
    • send_appointment_reminder: Scheduled for T-30min
    ↓
11. Owner receives WhatsApp notification:
    "Νέο booking: Γιόγκα αύριο 18:00. /approve or /reject"
    ↓
12. Owner replies: "/approve"
    → Another webhook cycle, Router recognizes admin command
    → AI Agent calls: approve_booking(booking_id=XYZ)
    → booking_status = 'confirmed'
    → Google Calendar event updated (if already created)
    → Client receives: "Booking επιβεβαιώθηκε! Εισαι έτοιμος/η για αύριο στις 6."
```

### Failure Mode: Double-Booking Prevention

```
Scenario: Two clients simultaneously book the last slot at 18:00

Time T+0ms:  Client A sends booking request
             → Webhook handler route to AI
Time T+5ms:  Client B sends booking request
             → Webhook handler routes to AI (Redis dedup passed, different message ID)
Time T+10ms: AI Agent A calls book_appointment()
             → Function Execution Layer: BEGIN; INSERT booking_a; COMMIT
             → Booking A stored, status='pending'
Time T+15ms: AI Agent B calls book_appointment()
             → Function Execution Layer: BEGIN; INSERT booking_b
             → UNIQUE constraint (business_id, calendar_time) violated
             → Constraint fires, rolls back
             → Returns error JSON: { error: "Slot already booked", code: 409 }
Time T+20ms: AI Agent B receives error, responds to client:
             "Δυστυχώς το slot δεν είναι διαθέσιμο. Ας δοκιμάσουμε άλλη ώρα;"

Result: Double-booking prevented at the database layer, not the AI layer.
```

### Failure Mode: Webhook Replay (Idempotency)

```
Scenario: Meta retries webhook delivery due to network blip

Time T+0s:   Message arrives, processed, HTTP 200 returned
             → Booking A created
Time T+5s:   Meta thinks it didn't receive 200 (was delayed), retries
             → Same webhook_id in Redis dedup cache (not expired)
             → Webhook handler skips to audit log (duplicate detected)
             → No double-processing

Result: Webhook is idempotent, safe to retry.
```

### Constraint: WhatsApp 24-Hour Window

```
Scenario: Owner wants to send appointment reminder outside 24-hour window

Time T+0h:   Client books, conversation is open (within 24h)
Time T+20h:  Last message from client
             → 24-hour window: T+20h to T+44h
Time T+48h:  Outside window; owner wants to send reminder
             → Cannot use free-form message API (blocked by WhatsApp)
             → Must use pre-approved template: "Appointment Reminder"
             → If template not approved, reminder fails (logged, retried)

Solution:
- Auto-queue reminders via send_appointment_reminder job
- Use BullMQ scheduler to send within the 24-hour window
- If appointment > 24h away, use scheduled template send
- Store template IDs in Postgres (Business.reminder_template_id)
```

---

## Patterns to Follow

### Pattern 1: Idempotent Message Handlers

**What:** Every webhook handler uses a deduplication key (message ID) stored in Redis with TTL. If a message ID is already processed, skip expensive operations.

**When:** Always, for WhatsApp webhooks — Meta promises at-least-once delivery, not exactly-once.

**Example:**
```typescript
async function handleWebhook(req: Request) {
  const messageId = req.body.entry[0].changes[0].value.messages[0].id;
  
  // Check if already processed
  const cached = await redis.get(`webhook:${messageId}`);
  if (cached) {
    logger.warn(`Duplicate webhook detected: ${messageId}`);
    return { success: true }; // Idempotent response
  }
  
  // Process message
  const result = await processMessage(req.body);
  
  // Mark as processed (TTL 24h to handle retries)
  await redis.setex(`webhook:${messageId}`, 86400, "1");
  
  return result;
}
```

### Pattern 2: Checkpoint & Conversation State

**What:** After every user interaction, snapshot the conversation state (last message, AI context, current booking flow) to Redis and Postgres.

**When:** After every webhook successfully processes; before closing the handler.

**Example:**
```typescript
async function updateConversationState(phone: string, state: ConversationState) {
  // Hot cache: Redis (fast reads during flow)
  await redis.setex(`conversation:${phone}`, 604800, JSON.stringify(state)); // 7 days
  
  // Durable: Postgres (audit trail, recovery)
  await db.insert(ConversationCheckpoints).values({
    session_id: phone,
    state_json: JSON.stringify(state),
    created_at: new Date(),
  });
}
```

### Pattern 3: Sequential AI Function Calls (No Parallelism)

**What:** After Gemini returns a function call request, execute it, then pass the result back to Gemini for the next decision. Never batch or parallelize function calls.

**When:** Designing the AI loop — this prevents race conditions and ensures transactional consistency.

**Example:**
```typescript
async function agenLoop(userMessage: string, business: Business) {
  let messages: MessageParam[] = [
    { role: "user", content: userMessage }
  ];
  
  while (true) {
    const response = await gemini.generateContent({
      contents: [{ role: "user", parts: messages }],
      tools: BOOKING_TOOLS,
    });
    
    const toolCalls = extractToolCalls(response);
    if (!toolCalls.length) break; // No more calls, exit
    
    // Execute ONE tool at a time
    for (const call of toolCalls) {
      const result = await executeTool(call, business);
      messages.push({ role: "model", parts: [{ functionResult: result }] });
    }
  }
  
  return extractFinalResponse(messages);
}
```

### Pattern 4: Database-Level Constraints for Consistency

**What:** Double-booking is prevented not by application logic, but by a unique constraint in Postgres: `UNIQUE(business_id, calendar_time, date)`. Idempotency is enforced by `UNIQUE(business_id, request_id)` on bookings.

**When:** Any operation with side effects (bookings, payments, inventory) — assume the database, not the app layer.

**Example:**
```sql
CREATE TABLE bookings (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL,
  client_phone TEXT NOT NULL,
  calendar_time TIME NOT NULL,
  calendar_date DATE NOT NULL,
  service_id UUID NOT NULL,
  booking_status TEXT DEFAULT 'pending_owner_approval',
  request_id TEXT NOT NULL, -- Idempotency key
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Prevent double-booking at DB level
  UNIQUE(business_id, calendar_date, calendar_time),
  
  -- Prevent duplicate inserts (idempotency)
  UNIQUE(business_id, request_id),
  
  FOREIGN KEY (business_id) REFERENCES businesses(id)
);
```

### Pattern 5: Row-Level Security (RLS) for Multi-Tenancy

**What:** Enable Postgres RLS policies so that even if SQL injection occurs, data is scoped to the current tenant. All queries are automatically restricted by tenant_id.

**When:** Setting up the database schema for any multi-tenant system.

**Example:**
```sql
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON bookings
  USING (business_id IN (
    SELECT id FROM businesses WHERE tenant_id = current_setting('app.current_tenant')
  ));
```

### Pattern 6: Webhook Payload Logging (Audit Trail)

**What:** Before processing any webhook, log the raw JSON payload to Postgres. If processing fails or needs replay, you can re-process from the audit log.

**When:** Always — WhatsApp has no event log or replay API.

**Example:**
```typescript
async function handleWebhook(req: Request) {
  const webhookId = generateId();
  
  // Log first
  await db.insert(WhatsAppAuditLog).values({
    webhook_id: webhookId,
    payload_json: JSON.stringify(req.body),
    status: 'received',
    created_at: new Date(),
  });
  
  try {
    // Process...
    await updateAuditLog(webhookId, { status: 'processed' });
  } catch (error) {
    await updateAuditLog(webhookId, { status: 'failed', error_message: error.message });
    // Could manually replay from audit log later
  }
}
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Parallel LLM Function Calls

**What:** Calling `check_availability()` and `book_appointment()` simultaneously, expecting Gemini to order them.

**Why bad:** Race conditions, double-booking. Both functions see the same slot as available, both book it, system is corrupt. Parallel tool execution is a known $47k mistake in production systems.

**Instead:** Execute tools sequentially in a state machine. Feed each result back to the LLM before calling the next tool.

### Anti-Pattern 2: Storing Conversation State Only in Redis

**What:** Deleting Redis or losing the cache and having no recovery path.

**Why bad:** Conversation history is lost, replay is impossible, debugging is hard. GDPR compliance may require audit trails.

**Instead:** Redis for speed, Postgres for durability. Checkpoint every N interactions or after critical operations.

### Anti-Pattern 3: Ignoring WhatsApp's 24-Hour Window

**What:** Trying to send a free-form reminder message 48 hours after the last customer message.

**Why bad:** WhatsApp API silently drops the message or rate-limits the business phone number. Reminders are lost, no notification to the business.

**Instead:** Always use approved message templates for out-of-window messages. Pre-define templates: "Appointment Reminder", "Daily Agenda", etc. Have Meta review them during onboarding.

### Anti-Pattern 4: Webhook Handler as Synchronous

**What:** Holding the HTTP request open while calling Google Calendar, Gemini, and other external APIs.

**Why bad:** Timeouts, slow responses, retry storms, wasted resources. Meta may give up and retry the webhook.

**Instead:** Return HTTP 200 immediately, queue all work (Gemini call, Calendar sync, reminder scheduling) to BullMQ. Process asynchronously.

### Anti-Pattern 5: No Idempotency Keys in AI Function Calls

**What:** Calling `book_appointment(...)` without a unique request_id, so retries duplicate the booking.

**Why bad:** If Gemini retries or the network is unreliable, the client's booking is duplicated.

**Instead:** Every AI function call includes a request_id (derived from message_id + function_name). Database has UNIQUE constraint on (business_id, request_id). Retries are automatically deduplicated.

### Anti-Pattern 6: Sharing WhatsApp Business Number State Without Tenant Context

**What:** Storing conversation state by phone number only, not including business_id.

**Why bad:** If a client messages multiple businesses through the same number (e.g., has bookings at two gyms), state gets mixed up. Conversation context leaks across businesses.

**Instead:** Conversation state key = `conversation:[tenant_id]:[phone]` or store tenant_id in the state object itself. Always include tenant context.

---

## Scalability Considerations

| Concern | At 100 Users | At 10K Bookings/Month | At 100K+ Bookings/Month |
|---------|-------|--------------|-------------|
| **Webhook throughput** | Single fly.io instance, ~100 req/s capacity | Still single instance; BullMQ absorbs spikes | Need horizontal scaling: multiple fly.io VMs, load balancer |
| **Conversation state** | Redis (Upstash free tier: 10K ops/s) sufficient | Still sufficient; hits ~1K concurrent conversations | Consider upgrading to Redis cluster or dedicated instance |
| **AI API rate limit** | Gemini free tier: 60 req/min sufficient | Gemini free tier becomes bottleneck; need paid tier | Paid Gemini: 600 req/min (standard rate limit) — may need batching |
| **Booking conflicts** | Database constraints handle all cases | UNIQUE index on (business_id, calendar_date, calendar_time) is O(log n) — no issue | Still no issue; constraint is table-independent |
| **Calendar sync** | Google Calendar API quota: 10M units/day (1 insert = 1 unit); 100 users = ~100 inserts/day — OK | ~10K inserts/day still OK (free tier: 1M units/day) | May approach quota; monitor or paginate syncs |
| **Scheduled jobs** | BullMQ on Redis, daily agenda + reminders = ~100 jobs/day | ~10K jobs/day still handles easily | Still OK; Redis is designed for message queues at scale |

---

## Build Order & Component Dependencies

This sequence minimizes rework and maximizes validation cycles:

### Phase 1: Foundation (Weeks 1-2)
**Goal:** Get a webhook running, messages flowing through the system.

1. **Postgres schema + RLS setup**
   - Businesses, Services, Bookings, BusinessHours, Users tables
   - Row-level security policies by tenant_id
   - Idempotency keys on bookings
   - Unique constraints for double-booking prevention
   - Audit log table

2. **Redis setup** (Upstash free tier)
   - Test connection from fly.io
   - Create key patterns (conversation:*, processed_webhooks:*)

3. **WhatsApp webhook handler** (fly.io)
   - Verify X-Hub-Signature (Meta security)
   - Deduplication by message ID (Redis)
   - Parse inbound message
   - Log all payloads to audit table
   - Return HTTP 200 immediately
   - **Status:** Receives messages, logs them, does nothing with them yet

4. **Manual Gemini call** (not integrated yet)
   - Test Gemini API directly with sample messages
   - Validate function calling interface
   - Confirm Greek language support

**Validation:** Deploy webhook, send test message from real WhatsApp, see it logged in Postgres and Redis. No errors.

---

### Phase 2: AI Integration (Weeks 3-4)
**Goal:** Connect the AI agent; route messages through Gemini.

1. **Conversation Router** (in-memory for now, stateless)
   - Extract business_id from deep link/code or conversation history
   - Load conversation state from Redis
   - Classify intent (booking, cancellation, FAQ, admin)
   - Format prompt for Gemini

2. **AI Agent loop** (sequential function execution)
   - Call Gemini with tools (check_availability, list_services, etc.)
   - Extract function calls from response
   - Call Function Execution Layer (see Phase 3)
   - Loop until no more function calls
   - Format final response

3. **Conversation state persistence**
   - After every interaction, update Redis (hot cache)
   - After critical operations, checkpoint to Postgres

4. **Response handler** (skeleton only)
   - Format AI response as WhatsApp message
   - Send via WhatsApp API
   - Log to audit table

**Validation:** Send test message "Ποιες είναι οι υπηρεσίες σας;" (What services do you offer?) → Gemini returns list → Sent back via WhatsApp. No bookings yet.

---

### Phase 3: Transactions & Booking (Weeks 5-6)
**Goal:** Implement transactional booking with double-booking prevention.

1. **Function Execution Layer**
   - Implement each AI function (check_availability, book_appointment, cancel_appointment, etc.)
   - Wrap writes in explicit transactions (BEGIN/COMMIT)
   - Catch and handle constraint violations (double-booking)
   - Include idempotency_key in all writes

2. **Database constraints**
   - Add UNIQUE(business_id, calendar_date, calendar_time) to bookings
   - Add UNIQUE(business_id, request_id) for idempotency
   - Test constraint violations (insert duplicate → should fail)

3. **AI function calls in sequence**
   - Modify AI Agent loop to handle errors from Function Execution Layer
   - If booking fails (slot taken), ask client to choose different time
   - Retry logic with exponential backoff

4. **Owner notifications**
   - When booking created (pending approval), send WhatsApp to owner
   - Implement /approve and /reject commands

**Validation:** Two simultaneous booking attempts to the same slot → one succeeds, one gets "slot taken" message. No database corruption.

---

### Phase 4: Async Jobs & Calendar Sync (Weeks 7-8)
**Goal:** Decouple slow operations (calendar sync, reminders) from webhook handling.

1. **BullMQ setup + Redis broker**
   - Define job types: sync_booking_to_calendar, send_daily_agenda, send_appointment_reminder
   - Create workers for each job type
   - Implement retry logic + dead-letter queue

2. **Google Calendar sync job**
   - Triggered on: booking approved, cancellation
   - Call Google Calendar API (create/update/delete event)
   - Store Calendar event ID in CalendarSync table
   - Map back to Booking ID for future updates

3. **Daily agenda job** (scheduled, cron-like)
   - Trigger every day at 08:00 (owner's timezone)
   - Query bookings for that day
   - Format and send via WhatsApp template API
   - Use pre-approved "Daily Agenda" template

4. **Appointment reminder job** (scheduled, per-booking)
   - Trigger 24 hours before appointment (or next working day if outside window)
   - Send via WhatsApp template API
   - Use pre-approved "Appointment Reminder" template

5. **Dead-letter queue handling**
   - Jobs that exhaust retries → logged to DLQ table in Postgres
   - Owner can manually retry or investigate

**Validation:** Book appointment → owner receives approval prompt → approve it → Google Calendar event created automatically. Next day at 08:00, daily agenda message sent. Day before appointment, reminder sent.

---

### Phase 5: Multi-Business & Scaling (Weeks 9-10)
**Goal:** Ensure multi-tenancy works end-to-end; test with multiple businesses.

1. **Business onboarding flow**
   - Owner sends: "Θέλω να ξεκινήσω ένα booking" (I want to start a booking)
   - AI Agent routes to onboarding conversation
   - Collect: business name, services (name + price + duration), hours
   - Create Businesses + Services + BusinessHours records
   - Generate unique business_code or link

2. **Conversation state per business**
   - Ensure conversation:phone includes business context
   - Test: client messages about Business A, then Business B → states don't mix

3. **RLS policies validation**
   - Manually try to query another business's bookings → RLS blocks
   - Verify all operations are tenant-scoped

4. **Webhook load testing**
   - Simulate 10 simultaneous bookings to different businesses
   - Verify no data leakage, all bookings distinct

**Validation:** Two separate businesses onboarded, each receiving bookings independently. Conversation context doesn't leak.

---

### Phase 6: Polish & Production Readiness (Week 11)
**Goal:** Prepare for public PoC launch.

1. **WhatsApp Message Template approval**
   - Create templates with Meta: "Appointment Reminder", "Daily Agenda", "Booking Confirmation"
   - Submit for review
   - Handle approval delays

2. **Error handling & DLQ**
   - All failed jobs logged and retryable
   - Owner can view DLQ, retry manually

3. **Monitoring & alerts**
   - Log all webhook processing times
   - Alert on failed jobs (Slack or email)
   - Track rate limits (Gemini, WhatsApp, Calendar API)

4. **Documentation**
   - Setup guide for owners (WhatsApp code sharing, calendar linking)
   - Runbooks for common issues

**Validation:** End-to-end test: onboard business, client books, owner approves, calendar syncs, reminder sent, all logged.

---

## Constraint Highlights

### WhatsApp 24-Hour Window

- **Free-form messaging:** Only within 24 hours of customer's last message (window resets on each customer message)
- **Outside window:** Must use pre-approved message templates (Utility, Authentication, or Marketing categories)
- **Implication:** Reminders and daily agendas require template pre-approval; build template submission into Phase 1

### Gemini Free Tier Rate Limits

- **Quota:** 60 requests per minute (free tier)
- **Implication:** ~1 booking per second capacity. For higher throughput, switch to paid tier (600 req/min standard). Monitor during Phase 5 load testing.

### LLM Function Calling Reliability

- **Risk:** Hallucinations, race conditions, parallel execution causing double-booking
- **Mitigation:** Database-level UNIQUE constraints, sequential (not parallel) tool execution, idempotency keys, explicit error handling

### Google Calendar API Sync

- **Conflict risk:** Owner manually edits an event in Calendar; our Bookings table doesn't know → divergence
- **Mitigation:** Store Calendar event ID; implement bidirectional sync with periodic reconciliation job (every 6 hours)

---

## Sources

- [Architecting Multi-Tenant SaaS: Database Isolation Patterns](https://www.developers.dev/tech-talk/multi-tenant-database-architecture-a-guide-to-isolation-patterns-and-scaling-trade-offs.html)
- [Guide to WhatsApp Webhooks: Features and Best Practices](https://hookdeck.com/webhooks/platforms/guide-to-whatsapp-webhooks-features-and-best-practices)
- [Agent State Management: Redis vs Postgres for AI Memory](https://www.sitepoint.com/state-management-for-long-running-agents-redis-vs-postgres/)
- [Model Context Protocol (MCP) with Google Gemini 2.5 Pro](https://medium.com/google-cloud/model-context-protocol-mcp-with-google-gemini-llm-a-deep-dive-full-code-ea16e3fac9a3)
- [Deferring long-running tasks to a distributed work queue · Fly Docs](https://fly.io/docs/blueprints/work-queues/)
- [WhatsApp Business API: What is a Customer Care Window?](https://www.saysimple.com/blog/whatsapp-business-api-what-is-a-customer-care-window)
- [LLM Function Calling Explained — The $47k Mistake We Made](https://thecodeforge.io/ml-ai/llm-function-calling-explained/)
- [Synchronize resources efficiently | Google Calendar | Google for Developers](https://developers.google.com/workspace/calendar/api/guides/sync)
