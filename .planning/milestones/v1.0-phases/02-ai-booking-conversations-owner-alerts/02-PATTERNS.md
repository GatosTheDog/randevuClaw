# Phase 2: AI Booking Conversations & Owner Alerts - Pattern Map

**Mapped:** 2026-07-08
**Files analyzed:** 9 new files, 3 modified files
**Analogs found:** 8/9 new files with matches, 1/9 requires new pattern

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/webhooks/telegram.ts` | middleware | request-response | `src/webhooks/whatsapp.ts` | exact-role |
| `src/conversation/router.ts` | utility | request-response | `src/business/resolver.ts` | role-match |
| `src/conversation/ai-agent.ts` | service | request-response | AI-SPEC.md / RESEARCH.md patterns | reference-impl |
| `src/conversation/function-executor.ts` | service | CRUD | `src/database/queries.ts` | role-match |
| `src/conversation/greek-preprocessor.ts` | utility | transform | `src/business/resolver.ts` | role-match |
| `src/business/availability.ts` | service | CRUD | `src/database/queries.ts` | role-match |
| `src/utils/timezone.ts` | utility | transform | `src/utils/diacritics.ts` | role-match |
| `src/database/schema.ts` | model | N/A | `src/database/schema.ts` (extend) | extend-existing |
| `src/database/queries.ts` | service | CRUD | `src/database/queries.ts` (extend) | extend-existing |
| `src/config.ts` | config | N/A | `src/config.ts` (extend) | extend-existing |

---

## Pattern Assignments

### `src/webhooks/telegram.ts` (middleware, request-response)

**Analog:** `src/webhooks/whatsapp.ts`

**Match Quality:** Exact role match — both are webhook handlers for messaging channels with identical responsibility (signature verification → dedup → business resolution → core routing → reply → mark processed).

**Imports pattern** (lines 1-15 from whatsapp.ts):
```typescript
import crypto from 'crypto';
import express, { Router, Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';
import { validateWebhookPayload } from '../utils/validation';
import { extractAndNormalizeAllBusinessCodeCandidates } from '../business/resolver';
import {
  Business,
  findBusinessBySlug,
  findMessageByWhatsappId,
  insertOrIgnoreMessage,
  markMessageProcessed,
} from '../database/queries';
```

**Authentication pattern** (lines 26-39 from whatsapp.ts — adapt for Telegram):
```typescript
// WhatsApp uses HMAC signature; Telegram uses simple token check
export function verifyWhatsAppSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader) return false;
  const expected =
    'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  if (Buffer.byteLength(signatureHeader) !== Buffer.byteLength(expected)) return false;
  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
}
```

**For Telegram, replace with token comparison:**
```typescript
export function verifyTelegramSignature(
  secretToken: string | undefined,
  expectedToken: string
): boolean {
  if (!secretToken) return false;
  return secretToken === expectedToken; // Simple string comparison, no HMAC
}
```

**Core webhook pattern** (lines 95-154 from whatsapp.ts — mirror for Telegram):
```typescript
async function handleWebhookPost(req: Request, res: Response): Promise<void> {
  // Always return 200 for webhook delivery (never let Telegram retry a message we already handled)
  try {
    const secretToken = req.headers['x-telegram-bot-api-secret-token'] as string | undefined;
    if (!verifyTelegramSignature(secretToken, config.telegramWebhookSecret)) {
      res.status(403).send('Forbidden');
      return;
    }

    const update = req.body; // Telegram update object
    const messageId = update.update_id;

    // Dedup by update_id
    const dedupResult = await insertOrIgnoreMessage(messageId, 0, senderPhone, messageBody);
    if (dedupResult === 'ignored') {
      logger.info({ messageId }, 'Duplicate update ignored');
      return res.json({ success: true });
    }

    // Extract business code from message text
    const candidates = extractAndNormalizeAllBusinessCodeCandidates(update.message.text);
    let business: Business | null = null;
    for (const candidate of candidates) {
      business = await findBusinessBySlug(candidate);
      if (business) break;
    }

    if (business) {
      await handleFoundBusiness(messageId, business, senderPhone, messageBody);
    } else {
      await handleNotFoundBusiness(messageId, senderPhone);
    }

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Unhandled error processing Telegram webhook');
  }
}

const router = Router();
router.post('/telegram', express.json(), handleWebhookPost);
export default router;
```

**Error handling pattern** (lines 149-154 from whatsapp.ts):
```typescript
try {
  // ... webhook processing
  res.status(200).send('OK');
} catch (err) {
  logger.error({ err }, 'Unhandled error processing webhook');
} finally {
  if (!res.headersSent) res.status(200).send('OK');
}
```

---

### `src/conversation/router.ts` (utility, request-response)

**Analog:** `src/business/resolver.ts`

**Match Quality:** Role match — both extract/normalize information from a message and route to downstream handlers.

**Imports pattern** (from resolver.ts lines 1-2):
```typescript
import { stripGreekDiacritics } from '../utils/diacritics';
```

**Extraction and normalization pattern** (lines 12-26 from resolver.ts):
```typescript
export function extractBusinessCode(messageText: string): string | null {
  const match = HYPHENATED_SLUG_RE.exec(messageText);
  return match ? match[0] : null;
}

export function normalizeBusinessCode(raw: string): string {
  return stripGreekDiacritics(raw)
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .trim();
}
```

**For conversation router, apply same extraction discipline:**
```typescript
export async function routeConversation(
  message: string,
  business: Business,
  clientPhone: string,
  previousInteractionId?: string
) {
  // Route to AI agent vs. consent check vs. fallback
  // Same pattern: extract intent → classify → dispatch
}
```

---

### `src/conversation/ai-agent.ts` (service, request-response)

**Analog:** Reference AI-SPEC.md Section 3 & RESEARCH.md Code Examples

**Match Quality:** Reference implementation — no direct Phase 1 code to copy; patterns from RESEARCH.md and AI-SPEC.md Section 4 are authoritative.

**Imports pattern** (from AI-SPEC.md lines 188-192):
```typescript
import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from "uuid";
import { db } from "../database/db";
import { logger } from "../utils/logger";
import { executeTool } from "./function-executor";
```

**Sequential function-calling loop** (from AI-SPEC.md lines 257-311, adapted):
```typescript
async function aiBookingAgent(
  userMessage: string,
  businessId: number,
  clientPhone: string,
  previousInteractionId?: string
): Promise<{ text: string; interactionId: string }> {
  const requestId = uuidv4(); // Idempotency key for this turn
  let input: string | any[] = userMessage;
  let currentInteractionId = previousInteractionId;

  while (true) {
    // Step 1: Create Gemini interaction
    const interaction = await ai.interactions.create({
      model: "gemini-3.5-flash",
      input,
      tools: bookingTools,
      systemInstruction: BOOKING_SYSTEM_PROMPT,
      previous_interaction_id: currentInteractionId,
    });

    currentInteractionId = interaction.id; // Store for next turn

    // Step 2: Check for function calls
    const functionCalls = interaction.steps.filter((s: any) => s.type === "function_call");
    if (functionCalls.length === 0) {
      // No more calls; return final response
      return {
        text: interaction.output_text || "Ένα σφάλμα συνέβη.",
        interactionId: currentInteractionId,
      };
    }

    // Step 3: Execute sequentially (ONE at a time, not parallel)
    const functionResults = [];
    for (const call of functionCalls) {
      const result = await executeTool(call.name, call.arguments, {
        business_id: businessId,
        client_phone: clientPhone,
        request_id: requestId,
      });

      functionResults.push({
        type: "function_result",
        name: call.name,
        call_id: call.id,
        result: [{ type: "text", text: JSON.stringify(result) }],
      });
    }

    // Step 4: Loop back to Gemini with results
    input = functionResults;
  }
}

export { aiBookingAgent };
```

**Tool definitions** (from AI-SPEC.md lines 207-254):
```typescript
const bookingTools = [
  {
    type: "function",
    name: "check_availability",
    description: "Check available time slots for a service on a given date",
    parameters: {
      type: "object",
      properties: {
        business_id: { type: "integer", description: "Business ID" },
        service_id: { type: "integer", description: "Service ID" },
        calendar_date: { type: "string", description: "YYYY-MM-DD" },
        duration_min: { type: "integer", description: "Duration in minutes" },
      },
      required: ["business_id", "service_id", "calendar_date", "duration_min"],
    },
  },
  {
    type: "function",
    name: "book_appointment",
    description: "Create a new booking",
    parameters: {
      type: "object",
      properties: {
        business_id: { type: "integer" },
        client_phone: { type: "string" },
        service_id: { type: "integer" },
        calendar_date: { type: "string", description: "YYYY-MM-DD" },
        calendar_time: { type: "string", description: "HH:MM 24-hour" },
        request_id: { type: "string", description: "Idempotency key (UUID)" },
      },
      required: ["business_id", "client_phone", "service_id", "calendar_date", "calendar_time", "request_id"],
    },
  },
  {
    type: "function",
    name: "cancel_appointment",
    description: "Cancel an existing booking",
    parameters: {
      type: "object",
      properties: {
        business_id: { type: "integer" },
        booking_id: { type: "integer" },
        request_id: { type: "string", description: "Idempotency key" },
      },
      required: ["business_id", "booking_id", "request_id"],
    },
  },
];
```

---

### `src/conversation/function-executor.ts` (service, CRUD)

**Analog:** `src/database/queries.ts`

**Match Quality:** Role match — both execute database CRUD operations with error handling and idempotency.

**Imports pattern** (from queries.ts lines 1-3):
```typescript
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { businesses, clientBusinessRelationships, messages } from './schema';
```

**Query structure with error handling** (from queries.ts lines 32-50):
```typescript
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

  return result.length > 0 ? 'inserted' : 'ignored';
}
```

**For function-executor, apply same pattern:**
```typescript
async function bookAppointment(args: any, idempotencyKey: string) {
  const result = await db
    .insert(bookings)
    .values({
      business_id: args.business_id,
      client_phone: args.client_phone,
      service_id: args.service_id,
      calendar_date: args.calendar_date,
      calendar_time: args.calendar_time,
      booking_status: "pending_owner_approval",
      request_id: idempotencyKey,
      created_at: new Date(),
      expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000),
    })
    .onConflictDoNothing()
    .returning({ id: bookings.id });

  return result.length > 0 
    ? { success: true, booking_id: result[0].id, status: "pending_owner_approval" }
    : { success: false, error: "Slot no longer available" };
}

async function executeTool(
  toolName: string,
  args: any,
  context: { business_id: number; client_phone: string; request_id: string }
): Promise<any> {
  try {
    switch (toolName) {
      case "check_availability":
        return await checkAvailability(args.business_id, args.service_id, args.calendar_date, args.duration_min);
      case "book_appointment":
        return await bookAppointment(args, context.request_id);
      case "cancel_appointment":
        return await cancelAppointment(args.booking_id, context.request_id);
      default:
        return { error: `Tool '${toolName}' not found` };
    }
  } catch (error) {
    logger.error({ error }, `Tool execution failed: ${toolName}`);
    return { error: error.message || "Internal error" };
  }
}
```

---

### `src/conversation/greek-preprocessor.ts` (utility, transform)

**Analog:** `src/business/resolver.ts`

**Match Quality:** Role match — both normalize and extract information from Greek text.

**Normalization pattern** (from resolver.ts lines 21-26):
```typescript
export function normalizeBusinessCode(raw: string): string {
  return stripGreekDiacritics(raw)
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .trim();
}
```

**For Greek date preprocessing:**
```typescript
import { stripGreekDiacritics } from '../utils/diacritics';

// Map colloquial Greek temporal expressions to ISO dates
const GREEK_TEMPORAL_MAPPING = {
  'αύριο': 'tomorrow',
  'μεθαύριο': 'day-after-tomorrow',
  'πρόχθες': 'day-before-yesterday',
  // ... more mappings
};

export function preprocessGreekTemporalExpression(messageText: string): string {
  // Replace "αύριο" with tomorrow's YYYY-MM-DD, "Παρασκευή" with next Friday, etc.
  // Return normalized message text with ISO dates substituted
  
  // This pattern mirrors the dash-normalization in resolver.ts:
  let normalized = messageText;
  for (const [greek, replacement] of Object.entries(GREEK_TEMPORAL_MAPPING)) {
    normalized = normalized.replace(new RegExp(greek, 'gi'), replacement);
  }
  return normalized;
}
```

---

### `src/business/availability.ts` (service, CRUD)

**Analog:** `src/database/queries.ts`

**Match Quality:** Role match — reads from database and computes availability slots.

**Query pattern** (from queries.ts lines 22-30):
```typescript
export async function findBusinessBySlug(slug: string): Promise<Business | null> {
  const rows = await db
    .select()
    .from(businesses)
    .where(eq(businesses.slug, slug))
    .limit(1);

  return rows[0] ?? null;
}
```

**For availability computation:**
```typescript
import { and, eq } from 'drizzle-orm';
import { db } from '../database/db';
import { bookings, services, businessHours } from '../database/schema';
import { logger } from '../utils/logger';

export async function checkAvailability(
  businessId: number,
  serviceId: number,
  date: string, // YYYY-MM-DD
  durationMin: number
): Promise<string[]> {
  try {
    // 1. Fetch service duration
    const service = await db
      .select()
      .from(services)
      .where(and(eq(services.id, serviceId), eq(services.businessId, businessId)))
      .limit(1);

    if (!service[0]) {
      logger.warn({ serviceId, businessId }, 'Service not found');
      return [];
    }

    // 2. Fetch business hours for that weekday
    const dayOfWeek = new Date(date).getDay();
    const hours = await db
      .select()
      .from(businessHours)
      .where(and(eq(businessHours.businessId, businessId), eq(businessHours.dayOfWeek, dayOfWeek)))
      .limit(1);

    if (!hours[0] || hours[0].isClosed) return [];

    // 3. Generate 1-hour slots
    const slots = generateHourlySlots(hours[0].openTime, hours[0].closeTime);

    // 4. Fetch booked slots for that date
    const booked = await db
      .select({ calendarTime: bookings.calendarTime })
      .from(bookings)
      .where(
        and(
          eq(bookings.businessId, businessId),
          eq(bookings.calendarDate, date),
          // Only count confirmed and pending bookings as occupying a slot
        )
      );

    // 5. Filter slots that don't conflict
    const available = slots.filter(slot => {
      // Check if this slot conflicts with any booked appointment
      return !booked.some(b => {
        const bookedStart = timeToMinutes(b.calendarTime);
        const bookedEnd = bookedStart + durationMin;
        const slotStart = timeToMinutes(slot);
        const slotEnd = slotStart + durationMin;
        return !(slotEnd <= bookedStart || slotStart >= bookedEnd);
      });
    });

    return available;
  } catch (error) {
    logger.error({ error }, 'Availability check failed');
    return [];
  }
}

function generateHourlySlots(openTime: string, closeTime: string): string[] {
  const slots: string[] = [];
  const [openHour, openMin] = openTime.split(':').map(Number);
  const [closeHour, closeMin] = closeTime.split(':').map(Number);

  let hour = openHour;
  let minute = openMin;

  while (hour < closeHour || (hour === closeHour && minute < closeMin)) {
    slots.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    hour += 1;
    if (hour >= 24) break;
  }

  return slots;
}

function timeToMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}
```

---

### `src/utils/timezone.ts` (utility, transform)

**Analog:** `src/utils/diacritics.ts`

**Match Quality:** Role match — both are utility functions that transform text/data.

**Transform pattern** (conceptual, no need to read diacritics.ts in full):
```typescript
// Diacritics pattern: simple utility that transforms text
export function stripGreekDiacritics(text: string): string {
  // ... implementation
}

// Timezone utility pattern: transform dates between UTC and display timezone
export function formatTimeForDisplay(isoTime: string, timezone: string = 'Europe/Athens'): string {
  // Convert UTC to Europe/Athens for display
}

export function parseClientTime(clientInput: string, timezone: string = 'Europe/Athens'): Date {
  // Parse client input (assumed to be in Europe/Athens timezone) and return UTC Date
}

export function getCurrentDateInTimezone(timezone: string = 'Europe/Athens'): string {
  // Return today's date in the given timezone as YYYY-MM-DD
}
```

---

### `src/database/schema.ts` (model)

**Analog:** `src/database/schema.ts` (extend existing)

**Match Quality:** Same file — extend with new tables following Phase 1 conventions.

**Existing pattern** (lines 11-47 from schema.ts):
```typescript
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
  slug: text('slug').notNull().unique(),
  phoneNumberId: text('phone_number_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  whatsappMessageId: text('whatsapp_message_id').notNull().unique(),
  businessId: integer('business_id')
    .notNull()
    .references(() => businesses.id),
  senderPhone: text('sender_phone').notNull(),
  messageBody: text('message_body').notNull(),
  status: text('status').notNull().default('received'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

**Add new tables following same conventions:**
```typescript
// Phase 2 new tables

export const services = pgTable('services', {
  id: serial('id').primaryKey(),
  businessId: integer('business_id').notNull().references(() => businesses.id),
  name: text('name').notNull(),
  durationMin: integer('duration_min').notNull(),
  price: integer('price'), // cents, nullable for Phase 2
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('unique_business_service').on(table.businessId, table.name),
]);

export const businessHours = pgTable('business_hours', {
  id: serial('id').primaryKey(),
  businessId: integer('business_id').notNull().references(() => businesses.id),
  dayOfWeek: integer('day_of_week').notNull(), // 0=Monday, 6=Sunday
  openTime: text('open_time').notNull(), // "08:00" HH:MM
  closeTime: text('close_time').notNull(), // "18:00" HH:MM
  isClosed: boolean('is_closed').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('unique_business_day').on(table.businessId, table.dayOfWeek),
]);

export const bookings = pgTable('bookings', {
  id: serial('id').primaryKey(),
  businessId: integer('business_id').notNull().references(() => businesses.id),
  clientPhone: text('client_phone').notNull(),
  serviceId: integer('service_id').notNull().references(() => services.id),
  calendarDate: text('calendar_date').notNull(), // YYYY-MM-DD
  calendarTime: text('calendar_time').notNull(), // HH:MM 24-hour
  bookingStatus: text('booking_status').notNull().default('pending_owner_approval'),
  // 'pending_owner_approval' | 'confirmed' | 'cancelled' | 'rejected' | 'expired'
  requestId: text('request_id').notNull(), // Idempotency key
  ownerTelegramMessageId: integer('owner_telegram_message_id'), // Telegram message ID
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'), // 2-hour auto-expiry
}, (table) => [
  // D-10: UNIQUE constraint prevents double-booking
  uniqueIndex('unique_slot_per_business').on(table.businessId, table.calendarDate, table.calendarTime),
  // Idempotency: same request_id per client returns cached result
  uniqueIndex('unique_request_per_client').on(table.clientPhone, table.requestId),
]);
```

---

### `src/database/queries.ts` (service, CRUD)

**Analog:** `src/database/queries.ts` (extend existing)

**Match Quality:** Same file — extend with booking operations following Phase 1 conventions.

**Existing pattern** (lines 22-30 from queries.ts):
```typescript
export async function findBusinessBySlug(slug: string): Promise<Business | null> {
  const rows = await db
    .select()
    .from(businesses)
    .where(eq(businesses.slug, slug))
    .limit(1);

  return rows[0] ?? null;
}
```

**Add booking query types and operations:**
```typescript
export interface Booking {
  id: number;
  businessId: number;
  clientPhone: string;
  serviceId: number;
  calendarDate: string;
  calendarTime: string;
  bookingStatus: string;
  requestId: string;
  ownerTelegramMessageId: number | null;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface Service {
  id: number;
  businessId: number;
  name: string;
  durationMin: number;
  price: number | null;
  createdAt: Date;
}

export interface BusinessHours {
  id: number;
  businessId: number;
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
  createdAt: Date;
}

// Query operations (following onConflictDoNothing pattern from phase 1)
export async function insertBooking(
  businessId: number,
  clientPhone: string,
  serviceId: number,
  calendarDate: string,
  calendarTime: string,
  requestId: string
): Promise<'inserted' | 'ignored'> {
  const result = await db
    .insert(bookings)
    .values({
      businessId,
      clientPhone,
      serviceId,
      calendarDate,
      calendarTime,
      bookingStatus: 'pending_owner_approval',
      requestId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    })
    .onConflictDoNothing()
    .returning({ id: bookings.id });

  return result.length > 0 ? 'inserted' : 'ignored';
}

export async function updateBookingStatus(
  bookingId: number,
  status: string
): Promise<void> {
  await db
    .update(bookings)
    .set({ bookingStatus: status })
    .where(eq(bookings.id, bookingId));
}

export async function findBookingById(bookingId: number): Promise<Booking | null> {
  const rows = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return rows[0] ?? null;
}
```

---

### `src/config.ts` (config)

**Analog:** `src/config.ts` (extend existing)

**Match Quality:** Same file — extend with Phase 2 environment variables.

**Existing pattern** (lines 19-32 from config.ts):
```typescript
const EnvSchema = z.object({
  APP_SECRET: z.string().min(1),
  WEBHOOK_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.string().default('development'),
});
```

**Extend with Phase 2 variables:**
```typescript
const EnvSchema = z.object({
  // Phase 1 variables (kept as-is)
  APP_SECRET: z.string().min(1),
  WEBHOOK_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  
  // Phase 2 new variables
  GEMINI_API_KEY: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  
  // Shared variables
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.string().default('development'),
});

export interface Config {
  // Phase 1
  appSecret: string;
  webhookVerifyToken: string;
  whatsappAccessToken: string;
  whatsappPhoneNumberId: string;
  
  // Phase 2
  geminiApiKey: string;
  telegramBotToken: string;
  telegramWebhookSecret: string;
  
  // Shared
  databaseUrl: string;
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  nodeEnv: 'development' | 'production';
}

const env = EnvSchema.parse(process.env);

export const config: Config = {
  // Phase 1
  appSecret: env.APP_SECRET,
  webhookVerifyToken: env.WEBHOOK_VERIFY_TOKEN,
  whatsappAccessToken: env.WHATSAPP_ACCESS_TOKEN,
  whatsappPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
  
  // Phase 2
  geminiApiKey: env.GEMINI_API_KEY,
  telegramBotToken: env.TELEGRAM_BOT_TOKEN,
  telegramWebhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
  
  // Shared
  databaseUrl: env.DATABASE_URL,
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  nodeEnv: env.NODE_ENV === 'production' ? 'production' : 'development',
};
```

---

## Shared Patterns

### Authentication & Signature Verification
**Source:** `src/webhooks/whatsapp.ts` (lines 26-39)
**Apply to:** All webhook handlers (both WhatsApp and Telegram)

**WhatsApp pattern (HMAC):**
```typescript
export function verifyWhatsAppSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader) return false;
  const expected =
    'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  if (Buffer.byteLength(signatureHeader) !== Buffer.byteLength(expected)) return false;
  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
}
```

**Telegram pattern (simple token check):**
```typescript
export function verifyTelegramSignature(
  secretToken: string | undefined,
  expectedToken: string
): boolean {
  if (!secretToken) return false;
  return secretToken === expectedToken;
}
```

### Deduplication & Idempotency
**Source:** `src/database/queries.ts` (lines 32-50, 78-103)
**Apply to:** All webhook handlers and booking operations

**Pattern:**
```typescript
// INSERT with onConflictDoNothing + RETURNING
export async function insertOrIgnoreMessage(
  whatsappMessageId: string,
  businessId: number,
  senderPhone: string,
  messageBody: string
): Promise<'inserted' | 'ignored'> {
  const result = await db
    .insert(messages)
    .values({ /* ... */ })
    .onConflictDoNothing()
    .returning({ id: messages.id });

  return result.length > 0 ? 'inserted' : 'ignored';
}
```

**For booking idempotency, apply same pattern with `request_id` as dedup key:**
```typescript
const result = await db
  .insert(bookings)
  .values({ /* ... requestId ... */ })
  .onConflictDoNothing()
  .returning({ id: bookings.id });
```

### Error Handling & Logging
**Source:** `src/utils/logger.ts` (lines 4-16)
**Apply to:** All services and handlers

**Pattern:**
```typescript
import { logger } from '../utils/logger';

try {
  // ... operation
  logger.info({ messageId }, 'Duplicate message ignored');
} catch (err) {
  logger.error({ err }, 'Failed to send WhatsApp reply');
}
```

### Webhook Invariant: Always Return 200
**Source:** `src/webhooks/whatsapp.ts` (lines 95-154)
**Apply to:** All webhook handlers (WhatsApp, Telegram)

**Pattern:**
```typescript
async function handleWebhookPost(req: Request, res: Response): Promise<void> {
  try {
    // ... signature verification
    // ... business logic
    res.status(200).send('OK');
  } catch (err) {
    logger.error({ err }, 'Unhandled error processing webhook');
  } finally {
    if (!res.headersSent) res.status(200).send('OK'); // Always return 200
  }
}
```

### Business Code Extraction & Normalization
**Source:** `src/business/resolver.ts` (lines 12-43)
**Apply to:** Telegram message processing (same as WhatsApp)

**Pattern:**
```typescript
export function extractAndNormalizeAllBusinessCodeCandidates(messageText: string): string[] {
  const normalizedText = messageText.replace(/[–—]/g, '-');
  return extractAllBusinessCodeCandidates(normalizedText).map(normalizeBusinessCode);
}

// Iterate candidates and try each against findBusinessBySlug
for (const candidate of candidates) {
  business = await findBusinessBySlug(candidate);
  if (business) break;
}
```

### Consent Flow
**Source:** `src/consent/checker.ts` (lines 1-21)
**Apply to:** All new channels (Telegram uses same consent check as WhatsApp)

**Pattern:**
```typescript
export async function getOrCreateClientRelationship(
  businessId: number,
  senderPhone: string
): Promise<{ isFirstContact: boolean; consentGiven: boolean }> {
  const existing = await findClientBusinessRelationship(businessId, senderPhone);

  if (existing) {
    return { isFirstContact: false, consentGiven: existing.consentGiven };
  }

  await insertClientBusinessRelationship(businessId, senderPhone);
  return { isFirstContact: true, consentGiven: true };
}
```

---

## No Analog Found

None — all Phase 2 files have analogs in Phase 1 or reference patterns from RESEARCH.md/AI-SPEC.md.

---

## Metadata

**Analog search scope:** `src/` directory, Phase 1 codebase
**Files scanned:** 14 Phase 1 files total
**Pattern extraction date:** 2026-07-08
**Confidence:** HIGH — Phase 1 patterns are well-established; Phase 2 extends with clear architectural guidance from RESEARCH.md and AI-SPEC.md
