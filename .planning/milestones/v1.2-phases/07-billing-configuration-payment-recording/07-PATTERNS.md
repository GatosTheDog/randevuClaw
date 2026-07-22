# Phase 7: Billing Configuration & Payment Recording - Pattern Map

**Mapped:** 2026-07-17
**Files analyzed:** 8 new/modified
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/billing/queries.ts` | service | CRUD | `src/onboarding/queries.ts` | exact |
| `src/billing/tools.ts` | service | request-response | `src/onboarding/ai-owner-agent.ts` (executeOwnerTool) | exact |
| `src/telegram/handlers/payment-flow.ts` | handler | request-response | `src/webhooks/telegram.ts` (handleCallbackQuery) | exact |
| `src/onboarding/ai-owner-agent.ts` | service | request-response | self (modify in-place) | exact |
| `src/webhooks/telegram.ts` | middleware | request-response | self (modify in-place) | exact |
| `src/database/schema.ts` | config | schema | self (modify in-place) | exact |
| `src/database/queries.ts` | service | CRUD | self (modify in-place) | exact |
| `migrations/0006-billing-schema.sql` | migration | schema | `migrations/0004_phase5_onboarding.sql` | exact |

## Pattern Assignments

### `src/billing/queries.ts` (service, CRUD)

**Analog:** `src/onboarding/queries.ts`

**Imports pattern** (lines 1-8):
```typescript
import { and, eq, not, desc, isNull, sql } from 'drizzle-orm';
import { db } from '../database/db';
import {
  // Import schema tables
  businesses,
  services,
  // other schema imports...
} from '../database/schema';
```

**Interface definitions pattern** (lines 10-17):
```typescript
export interface OnboardingSession {
  id: number;
  businessId: number;
  currentStep: string;
  collectedData: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

**Query function pattern** (lines 23-32):
```typescript
export async function findBusinessByOwnerTelegramId(
  ownerTelegramId: string
): Promise<Business | null> {
  const rows = await db
    .select()
    .from(businesses)
    .where(eq(businesses.ownerTelegramId, ownerTelegramId))
    .limit(1);

  return rows[0] ?? null;
}
```

**Insert/update with onConflictDoUpdate pattern** (lines 63-76):
```typescript
export async function createOrResetOnboardingSession(
  businessId: number,
  initialStep: string
): Promise<OnboardingSession> {
  const rows = await db
    .insert(onboardingSessions)
    .values({ businessId, currentStep: initialStep, collectedData: null })
    .onConflictDoUpdate({
      target: onboardingSessions.businessId,
      set: { currentStep: initialStep, collectedData: null, updatedAt: new Date() },
    })
    .returning();
  return rows[0];
}
```

**Comment conventions** (lines 34-38):
```typescript
/**
 * Looks up a business row by the owner's Telegram user ID.
 * Returns null if no business has been registered for that owner yet.
 */
```

---

### `src/billing/tools.ts` (service, request-response)

**Analog:** `src/onboarding/ai-owner-agent.ts` (executeOwnerTool section, lines 167-252)

**Imports pattern** (lines 1-17 of ai-owner-agent.ts):
```typescript
import { eq } from 'drizzle-orm';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config';
import { db } from '../database/db';
import { businessHours, services } from '../database/schema';
import {
  Business,
  BusinessHours,
  Service,
  listBusinessHours,
  listServicesForBusiness,
  // query imports...
} from '../database/queries';
import { logger } from '../utils/logger';
```

**Tool handler function pattern** (lines 167-252):
```typescript
async function executeOwnerTool(
  toolName: string,
  args: ToolArgs,
  business: Business,
  svcList: Service[],
  today: string
): Promise<string> {
  switch (toolName) {
    case 'add_service': {
      const { name, price_cents, duration_min } = args;
      if (!name || duration_min === undefined) return 'Μη έγκυρα δεδομένα.';
      await db.insert(services).values({
        businessId: business.id,
        name,
        price: price_cents && price_cents > 0 ? price_cents : null,
        durationMin: duration_min,
      });
      return `OK: υπηρεσία "${name}" προστέθηκε`;
    }
    // ... other cases
    default:
      return `Άγνωστο εργαλείο: ${toolName}`;
  }
}
```

**Greek confirmation pattern** (from CONTEXT.md D-03):
```typescript
// Echo parsed fields and wait for Ναι/Όχι before DB write
const confirmationText = [
  '📦 Πακέτο:',
  `Όνομα: ${parsed.name}`,
  `Τιμή: €${price}`,
  `Διάρκεια: ${parsed.valid_days} ημέρες`,
  `Συνεδρίες: ${sessionLabel}`,
  '',
  'Δημιουργώ;',
].join('\n');
```

---

### `src/telegram/handlers/payment-flow.ts` (handler, request-response)

**Analog:** `src/webhooks/telegram.ts` (handleCallbackQuery section, lines 137-242)

**Imports pattern** (lines 1-20):
```typescript
import { logger } from '../utils/logger';
import {
  Business,
  withBusinessContext,
  // query imports...
} from '../database/queries';
import {
  answerCallbackQuery,
  sendTelegramMessage,
  sendTelegramMessageWithKeyboard,
  botTokenStore,
} from '../telegram/client';
```

**Inline keyboard handler pattern** (lines 137-160 of webhooks/telegram.ts):
```typescript
async function handleCallbackQuery(
  callbackQuery: TelegramCallbackQuery,
  senderTelegramId: string
): Promise<void> {
  const parsed = parseCallbackData(callbackQuery.data);

  // answerCallbackQuery MUST fire before any DB work (dismiss spinner first)
  await answerCallbackQuery(callbackQuery.id);

  if (!parsed) {
    logger.warn({ data: callbackQuery.data }, 'Malformed callback_query data, ignoring');
    return;
  }

  // Parse the action and ID from callback_data
  // Validate ownership via business context
  // Execute the action
}
```

**Ownership validation pattern** (lines 160-178):
```typescript
const booking = await findBookingByIdUnscoped(parsed.bookingId);
if (!booking) {
  logger.warn({ bookingId: parsed.bookingId }, 'callback_query for unknown booking');
  return;
}

const business = await findBusinessById(booking.businessId);
const ownerTelegramId = business?.ownerTelegramId;
if (!ownerTelegramId || ownerTelegramId !== senderTelegramId) {
  logger.warn(
    { bookingId: booking.id, senderTelegramId },
    'callback_query from non-owner, ignoring'
  );
  return;
}
```

**Keyboard button with callback pattern** (line 232):
```typescript
await sendTelegramMessageWithKeyboard(
  updated.clientPhone,
  `Το ραντεβού σας επιβεβαιώθηκε! ${service?.name ?? ''}, ${updated.calendarDate} στις ${updated.calendarTime}.`,
  [[{ text: '🚫 Ακύρωση κράτησης', callback_data: `client_cancel_${updated.id}` }]]
);
```

---

### `src/onboarding/ai-owner-agent.ts` (service, request-response — MODIFIED)

**Analog:** self (existing file, modify OWNER_TOOLS array and executeOwnerTool function)

**Tool schema pattern** (lines 27-103):
```typescript
const OWNER_TOOLS = [
  {
    type: 'function' as const,
    name: 'add_service',
    description: 'Προσθέτει νέα υπηρεσία στην επιχείρηση.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Όνομα υπηρεσίας' },
        price_cents: { type: 'integer', description: 'Τιμή σε λεπτά ευρώ (π.χ. 2000 = €20,00). 0 αν δεν έχει τιμή.' },
        duration_min: { type: 'integer', description: 'Διάρκεια σε λεπτά' },
      },
      required: ['name', 'price_cents', 'duration_min'],
    },
  },
  // ... more tools
];
```

**System prompt pattern** (lines 109-150):
```typescript
function buildOwnerSystemPrompt(
  business: Business,
  svcList: Service[],
  hoursList: BusinessHours[],
  today: string
): string {
  const svcText = svcList.length
    ? svcList.map((s) => `- ${s.name}: ${s.price != null ? (s.price / 100).toFixed(2) + '€' : 'χωρίς τιμή'}, ${s.durationMin} λεπτά`).join('\n')
    : '(καμία υπηρεσία)';

  return [
    `Είσαι ο διαχειριστικός βοηθός του ιδιοκτήτη της επιχείρησης "${business.name}".`,
    `Σημερινή ημερομηνία: ${today}`,
    '',
    'Κανόνες:',
    '- Μιλάς ΠΑΝΤΑ Ελληνικά, συνοπτικά και φιλικά.',
  ].join('\n');
}
```

**Gemini loop pattern** (lines 298-352):
```typescript
while (true) {
  if (++round > MAX_TOOL_ROUNDS) {
    logger.error({ businessId: business.id, ownerTelegramId }, 'aiOwnerAgent exceeded MAX_TOOL_ROUNDS');
    return 'Συγγνώμη, κάτι πήγε στραβά. Δοκιμάστε ξανά.';
  }

  let interaction: GeminiInteractionResult;
  try {
    interaction = await (ai.interactions.create as any)({
      model: GEMINI_MODEL,
      input,
      tools: OWNER_TOOLS,
      system_instruction: systemInstruction,
      previous_interaction_id: currentInteractionId,
      generation_config: { temperature: 0.4, max_output_tokens: 512, top_p: 0.95 },
    } as GeminiCreateParams) as GeminiInteractionResult;
  } catch (err) {
    logger.error({ err, businessId: business.id }, 'aiOwnerAgent Gemini call failed');
    return 'Το σύστημα δεν απόκρινε. Δοκιμάστε ξανά σε λίγο.';
  }

  currentInteractionId = interaction.id;

  const functionCalls: Array<{ name: string; arguments: Record<string, unknown>; id: string }> = [];
  for (const step of interaction.steps ?? []) {
    if (step.type === 'function_call' && step.name && step.id) {
      functionCalls.push({ name: step.name, arguments: step.arguments ?? {}, id: step.id });
    }
  }

  if (functionCalls.length === 0) {
    return interaction.output_text ?? 'Συγγνώμη, δεν κατάλαβα. Μπορείτε να επαναδιατυπώσετε;';
  }

  // Execute each tool and collect results...
  input = functionResults;
}
```

---

### `src/webhooks/telegram.ts` (middleware, request-response — MODIFIED)

**Analog:** self (existing file, add billing callback handler)

**Callback data parsing pattern** (lines 76-81):
```typescript
export function parseCallbackData(
  data: string | undefined
): { action: 'approve' | 'reject' | 'client_cancel'; bookingId: number } | null {
  const match = data?.match(/^(approve|reject|client_cancel)_(\d+)$/);
  return match ? { action: match[1] as 'approve' | 'reject' | 'client_cancel', bookingId: Number(match[2]) } : null;
}
```

**Modify pattern to add billing actions** — extend the regex and return type:
```typescript
export function parseCallbackData(
  data: string | undefined
): {
  action: 'approve' | 'reject' | 'client_cancel' | 'billing:client' | 'billing:package' | 'billing:confirm';
  bookingId?: number;
  clientId?: number;
  packageId?: number;
} | null {
  // Match both existing booking actions and new billing actions
  const bookingMatch = data?.match(/^(approve|reject|client_cancel)_(\d+)$/);
  if (bookingMatch) {
    return { action: bookingMatch[1] as any, bookingId: Number(bookingMatch[2]) };
  }

  const billingMatch = data?.match(/^billing:(client|package|confirm):(\d+)(?::(\d+))?$/);
  if (billingMatch) {
    if (billingMatch[1] === 'client') {
      return { action: 'billing:client', clientId: Number(billingMatch[2]) };
    } else if (billingMatch[1] === 'package') {
      return { action: 'billing:package', clientId: Number(billingMatch[2]), packageId: Number(billingMatch[3]) };
    }
  }

  return null;
}
```

**Callback handling dispatch pattern** (lines 137-160):
```typescript
async function handleCallbackQuery(
  callbackQuery: TelegramCallbackQuery,
  senderTelegramId: string
): Promise<void> {
  const parsed = parseCallbackData(callbackQuery.data);
  await answerCallbackQuery(callbackQuery.id);

  if (!parsed) {
    logger.warn({ data: callbackQuery.data }, 'Malformed callback_query data, ignoring');
    return;
  }

  // Dispatch to handler based on action
  if (parsed.action === 'billing:client') {
    // Route to billing client selection handler
  } else if (parsed.action === 'client_cancel') {
    await handleClientCancelCallback(parsed.bookingId, senderTelegramId);
    return;
  }
  // ... other cases
}
```

---

### `src/database/schema.ts` (config, schema — MODIFIED)

**Analog:** self (existing file, add new tables)

**Existing column pattern with comment** (lines 14-24):
```typescript
export const businesses = pgTable('businesses', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  // Phase 2 (nullable — Phase 1 already inserted 2 rows, Postgres can't add a
  // NOT NULL column without a default to a non-empty table): Telegram user ID
  // of the business owner, used to route owner-approval alerts (D-08).
  ownerTelegramId: text('owner_telegram_id'),
  // ... more columns with phase-specific comments
});
```

**Add client_name column pattern** (modify clientBusinessRelationships):
```typescript
export const clientBusinessRelationships = pgTable(
  'client_business_relationships',
  {
    id: serial('id').primaryKey(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id),
    senderPhone: text('sender_phone').notNull(),
    // Phase 7 (nullable — captured from Telegram from.first_name on first
    // contact, upserted on every message). Used in payment flow UI to show
    // client display names in inline keyboard buttons (D-04/D-05).
    clientName: text('client_name'),
    consentGiven: boolean('consent_given').notNull().default(true),
    consentTimestamp: timestamp('consent_timestamp').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('unique_client_business').on(table.businessId, table.senderPhone),
  ]
);
```

**New table pattern** (following existing conventions):
```typescript
export const billingPackages = pgTable(
  'billing_packages',
  {
    id: serial('id').primaryKey(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id),
    // Phase 7 (D-01): package name (e.g., "Μηνιαία", "10 μαθήματα")
    name: text('name').notNull(),
    // Phase 7: price in cents (e.g., 8000 = €80.00)
    priceCents: integer('price_cents').notNull(),
    // Phase 7: validity period in days (e.g., 30)
    validDays: integer('valid_days').notNull(),
    // Phase 7: session count, nullable for unlimited (D-02)
    sessionCount: integer('session_count'),
    // Phase 7 (D-03): soft-delete via flag (no FK cascade)
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('unique_business_package_name').on(table.businessId, table.name),
  ]
);

export const memberships = pgTable(
  'memberships',
  {
    id: serial('id').primaryKey(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id),
    clientPhone: text('client_phone').notNull(),
    packageId: integer('package_id')
      .notNull()
      .references(() => billingPackages.id),
    // Phase 7: ISO date "YYYY-MM-DD" in Athens local time (D-02)
    purchaseDate: text('purchase_date').notNull(),
    // Phase 7: TIMESTAMP WITH TIME ZONE for rolling expiry (DST-safe)
    expiresAt: timestamp('expires_at').notNull(),
    // Phase 7: sessions remaining (null = unlimited, D-02)
    sessionsRemaining: integer('sessions_remaining'),
    // Phase 7: one active membership per (business_id, client_phone)
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    // D-10: one active membership per business+client
    uniqueIndex('unique_active_membership').on(table.businessId, table.clientPhone).where(
      sql`is_active = true`
    ),
  ]
);

export const membershipLedger = pgTable(
  'membership_ledger',
  {
    id: serial('id').primaryKey(),
    membershipId: integer('membership_id')
      .notNull()
      .references(() => memberships.id),
    // Phase 7: operation type (e.g., 'payment_recorded', 'session_deducted')
    operationType: text('operation_type').notNull(),
    // Phase 7: sessions deducted (0 for non-session operations)
    sessionsDeducted: integer('sessions_deducted').notNull().default(0),
    // Phase 8+: booking that triggered the deduction
    bookingId: integer('booking_id').references(() => bookings.id),
    // Phase 7/8: reason for the ledger entry
    reason: text('reason'),
    // Phase 7 (D-11): idempotency key — prevents duplicate deductions on replay
    idempotencyKey: text('idempotency_key').notNull().unique(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('unique_ledger_idempotency').on(table.idempotencyKey),
  ]
);
```

---

### `src/database/queries.ts` (service, CRUD — MODIFIED)

**Analog:** self (existing file, add upsert for client_name)

**Existing upsert pattern** (lines 147-172):
```typescript
export async function insertClientBusinessRelationship(
  businessId: number,
  senderPhone: string
): Promise<ClientBusinessRelationship> {
  const rows = await getConn()
    .insert(clientBusinessRelationships)
    .values({
      businessId,
      senderPhone,
      consentGiven: true,
      consentTimestamp: new Date(),
    })
    .onConflictDoNothing()
    .returning();

  if (rows[0]) return rows[0];

  const existing = await findClientBusinessRelationship(businessId, senderPhone);
  if (!existing) throw new Error('Failed to read client relationship after conflict');
  return existing;
}
```

**Modify pattern to upsert client_name**:
```typescript
export async function insertClientBusinessRelationship(
  businessId: number,
  senderPhone: string,
  clientName?: string
): Promise<ClientBusinessRelationship> {
  const rows = await getConn()
    .insert(clientBusinessRelationships)
    .values({
      businessId,
      senderPhone,
      clientName, // Phase 7 (D-04): capture from Telegram from.first_name
      consentGiven: true,
      consentTimestamp: new Date(),
    })
    .onConflictDoUpdate({
      target: [clientBusinessRelationships.businessId, clientBusinessRelationships.senderPhone],
      // Phase 7 (D-04): always upsert client_name, even if null
      set: { clientName, consentTimestamp: new Date() },
    })
    .returning();

  return rows[0];
}
```

**New billing query interface pattern**:
```typescript
export interface BillingPackage {
  id: number;
  businessId: number;
  name: string;
  priceCents: number;
  validDays: number;
  sessionCount: number | null;
  isActive: boolean;
  createdAt: Date;
}

export interface Membership {
  id: number;
  businessId: number;
  clientPhone: string;
  packageId: number;
  purchaseDate: string;
  expiresAt: Date;
  sessionsRemaining: number | null;
  isActive: boolean;
  createdAt: Date;
}
```

---

### `migrations/0006-billing-schema.sql` (migration, schema)

**Analog:** `migrations/0004_phase5_onboarding.sql`

**Migration template pattern**:
```sql
-- Migration: 0006_billing_schema.sql
-- Purpose: Add billing_packages, memberships, membership_ledger tables and
--   client_name column to client_business_relationships (Phase 7 D-01..D-11).
--
-- How to apply:
--   psql $DATABASE_URL -f migrations/0006_billing_schema.sql
--
-- Idempotency: CREATE TABLE wrapped in DO block with IF NOT EXISTS.
--   CREATE UNIQUE INDEX uses IF NOT EXISTS. ADD COLUMN uses IF NOT EXISTS.

-- ---------------------------------------------------------------------------
-- Section 1: Add client_name column to existing client_business_relationships
-- ---------------------------------------------------------------------------

ALTER TABLE client_business_relationships
  ADD COLUMN IF NOT EXISTS client_name TEXT;
  -- Phase 7 (D-04): captured from Telegram from.first_name on each message,
  -- upserted to reflect latest display name. Used in payment flow UI (D-05).

-- ---------------------------------------------------------------------------
-- Section 2: billing_packages table (D-01)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'billing_packages') THEN
    CREATE TABLE billing_packages (
      id              SERIAL PRIMARY KEY,
      business_id     INTEGER NOT NULL REFERENCES businesses(id),
      name            TEXT NOT NULL,
      price_cents     INTEGER NOT NULL,          -- price in cents (e.g., 8000 = €80.00)
      valid_days      INTEGER NOT NULL,          -- validity period in days
      session_count   INTEGER,                   -- NULL for unlimited sessions (D-02)
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,  -- soft-delete flag (D-03)
      created_at      TIMESTAMP NOT NULL DEFAULT NOW()
    );
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS unique_business_package_name
  ON billing_packages (business_id, name);

-- ---------------------------------------------------------------------------
-- Section 3: memberships table (D-02, D-10)
-- One active membership per (business_id, client_phone) enforced at DB level
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'memberships') THEN
    CREATE TABLE memberships (
      id                  SERIAL PRIMARY KEY,
      business_id         INTEGER NOT NULL REFERENCES businesses(id),
      client_phone        TEXT NOT NULL,
      package_id          INTEGER NOT NULL REFERENCES billing_packages(id),
      purchase_date       TEXT NOT NULL,         -- "YYYY-MM-DD" in Athens local time
      expires_at          TIMESTAMP NOT NULL,    -- TIMESTAMP WITH TIME ZONE (DST-safe)
      sessions_remaining  INTEGER,               -- NULL = unlimited
      is_active           BOOLEAN NOT NULL DEFAULT TRUE,
      created_at          TIMESTAMP NOT NULL DEFAULT NOW()
    );
  END IF;
END
$$;

-- D-10: one active membership per (business_id, client_phone) pair
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_membership
  ON memberships (business_id, client_phone)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- Section 4: membership_ledger table (D-11 immutable append-only)
-- Idempotency key UNIQUE constraint prevents duplicate deductions on replay
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'membership_ledger') THEN
    CREATE TABLE membership_ledger (
      id              SERIAL PRIMARY KEY,
      membership_id   INTEGER NOT NULL REFERENCES memberships(id),
      operation_type  TEXT NOT NULL,             -- 'payment_recorded', 'session_deducted', etc.
      sessions_deducted INTEGER NOT NULL DEFAULT 0,
      booking_id      INTEGER REFERENCES bookings(id),  -- nullable (for non-booking ops)
      reason          TEXT,                      -- 'Booking confirmed', 'Admin adjustment', etc.
      idempotency_key TEXT NOT NULL UNIQUE,      -- D-11: prevents replay duplicates
      created_at      TIMESTAMP NOT NULL DEFAULT NOW()
    );
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS unique_ledger_idempotency
  ON membership_ledger (idempotency_key);

-- ---------------------------------------------------------------------------
-- Section 5: Grant permissions to randevuclaw_app role
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON billing_packages TO randevuclaw_app;
GRANT SELECT, INSERT, UPDATE ON memberships TO randevuclaw_app;
GRANT SELECT, INSERT ON membership_ledger TO randevuclaw_app;
GRANT USAGE, SELECT ON SEQUENCE billing_packages_id_seq TO randevuclaw_app;
GRANT USAGE, SELECT ON SEQUENCE memberships_id_seq TO randevuclaw_app;
GRANT USAGE, SELECT ON SEQUENCE membership_ledger_id_seq TO randevuclaw_app;
```

---

## Shared Patterns

### Timezone-Safe Date Arithmetic

**Source:** `src/utils/timezone.ts` (lines 27-31)

**Apply to:** All billing expiry calculations (memberships.expiresAt)

```typescript
import { addCalendarDays, isoDateInAthens } from '../utils/timezone';

// Example in membership creation:
const todayAthens = isoDateInAthens(new Date());
const expiresDateAthens = addCalendarDays(todayAthens, package.validDays);
// Convert to TIMESTAMP WITH TIME ZONE for storage
const expiresAt = new Date(`${expiresDateAthens}T23:59:59+02:00`);
```

### Structured Logging Pattern

**Source:** `src/utils/logger.ts` (imported in all files)

**Apply to:** All billing operations

```typescript
import { logger } from '../utils/logger';

// Log successful operations with business context
logger.info({ businessId: business.id, packageId: package.id }, 'Package created');

// Log errors without secrets (prices, tokens)
logger.error({ err, businessId, packageId }, 'Package creation failed');

// Debug callback_query routing
logger.debug({ action: parsed.action, packageId }, 'Billing callback parsed');
```

### RLS Context Threading Pattern

**Source:** `src/database/queries.ts` (lines 77-85)

**Apply to:** All billing queries that need RLS enforcement

```typescript
import { withBusinessContext } from '../database/queries';

// Wrap billing operations in RLS context
await withBusinessContext(businessId, async () => {
  // All queries inside this callback automatically use RLS-enforced transaction
  const packages = await listActivePackagesForBusiness(businessId);
  const membership = await createMembership(businessId, clientPhone, packageId);
});
```

### Validation Pattern

**Source:** `src/utils/validation.ts` (Zod schema validation)

**Apply to:** All Gemini tool arguments and payment flow inputs

```typescript
import { z } from 'zod';

const CreatePackageSchema = z.object({
  name: z.string().min(1),
  price_cents: z.number().int().min(0),
  valid_days: z.number().int().min(1),
  session_count: z.number().int().min(1).nullable(),
});

// Validate before DB insert
const parsed = CreatePackageSchema.parse(args);
```

### Error Handling Pattern

**Source:** `src/onboarding/ai-owner-agent.ts` (lines 305-318)

**Apply to:** All Gemini API calls and billing operations

```typescript
try {
  const result = await someOperation();
  return successMessage;
} catch (err) {
  logger.error({ err, businessId, operation: 'create_package' }, 'Billing operation failed');
  return 'Συγγνώμη, κάτι πήγε στραβά. Δοκιμάστε ξανά.'; // Greek error message
}
```

### Callback Query Dispatch Pattern

**Source:** `src/webhooks/telegram.ts` (lines 76-81, 137-160)

**Apply to:** Billing callback handling in payment flow

```typescript
// 1. Validate callback_data format with regex
const parsed = parseCallbackData(callbackQuery.data);
if (!parsed) {
  logger.warn({ data: callbackQuery.data }, 'Malformed callback_data');
  return;
}

// 2. Answer callback query immediately (dismiss spinner)
await answerCallbackQuery(callbackQuery.id);

// 3. Validate ownership before executing action
if (ownerTelegramId !== senderTelegramId) {
  logger.warn({ senderTelegramId }, 'callback from non-owner, ignoring');
  return;
}

// 4. Execute action based on parsed.action
```

---

## No Analog Found

All files have close analogs in the existing codebase. No files require custom patterns from RESEARCH.md.

---

## Metadata

**Analog search scope:** src/billing, src/onboarding, src/telegram, src/webhooks, src/database, src/utils, migrations/

**Files scanned:** 12 (queries.ts, ai-owner-agent.ts, telegram/client.ts, webhooks/telegram.ts, database/schema.ts, database/queries.ts, onboarding/queries.ts, utils/timezone.ts, utils/logger.ts, migrations/0004_phase5_onboarding.sql, migrations/0005_split_hours.sql)

**Pattern extraction date:** 2026-07-17

---

*Phase: 7 - Billing Configuration & Payment Recording*
*Ready for planning: YES*
