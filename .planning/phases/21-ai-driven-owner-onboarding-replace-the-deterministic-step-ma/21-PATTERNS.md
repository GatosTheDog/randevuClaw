# Phase 21: AI-Driven Owner Onboarding - Pattern Map

**Mapped:** 2026-07-24  
**Files analyzed:** 3 new/modified files  
**Analogs found:** 3 / 3 (100%)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/onboarding/ai-onboarding-agent.ts` | agent | request-response | `src/onboarding/ai-owner-agent.ts` | **exact** |
| `src/webhooks/telegram.ts` | webhook handler | request-response | (same file, modify existing) | **exact** |
| `src/onboarding/queries.ts` | data access | CRUD | (same file, simplify per D-02) | **exact** |

---

## Pattern Assignments

### `src/onboarding/ai-onboarding-agent.ts` (NEW agent, request-response)

**Analog:** `src/onboarding/ai-owner-agent.ts` (lines 1-963)

**Imports pattern** (lines 1-34):
```typescript
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config';
import { Business, withBusinessContext, getConn, listServicesForBusiness, listBusinessHours } from '../database/queries';
import { logger } from '../utils/logger';
import { sendTelegramMessage, sendTelegramMessageWithKeyboard } from '../telegram/client';
```

**Core Gemini tool-calling loop pattern** (lines 882-963):
```typescript
const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
const GEMINI_MODEL = 'gemini-3.1-flash-lite';  // MUST match ai-owner-agent.ts
const MAX_TOOL_ROUNDS = 5;

export async function aiOnboardingAgent(
  business: Business,
  ownerTelegramId: string,
  messageText: string,
  today: string
): Promise<string> {
  const systemInstruction = buildOnboardingSystemPrompt(business, today);

  let input: string | GeminiFunctionResultInput[] = messageText;
  let currentInteractionId: string | undefined;
  let round = 0;

  while (true) {
    if (++round > MAX_TOOL_ROUNDS) {
      logger.error({ businessId: business.id }, 'aiOnboardingAgent exceeded MAX_TOOL_ROUNDS');
      return 'Συγγνώμη, κάτι πήγε στραβά. Δοκιμάστε ξανά.';
    }

    let interaction: GeminiInteractionResult;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      interaction = await (ai.interactions.create as any)({
        model: GEMINI_MODEL,
        input,
        tools: ONBOARDING_TOOLS,  // Different tool set from OWNER_TOOLS
        system_instruction: systemInstruction,
        previous_interaction_id: currentInteractionId,
        generation_config: { temperature: 0.4, max_output_tokens: 512, top_p: 0.95 },
      } as GeminiCreateParams) as GeminiInteractionResult;
    } catch (err) {
      logger.error({ err, businessId: business.id }, 'aiOnboardingAgent Gemini call failed');
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

    const functionResults: GeminiFunctionResultInput[] = [];
    for (const call of functionCalls) {
      const result = await executeOnboardingTool(
        call.name,
        call.arguments as OnboardingToolArgs,
        business,
        today,
        ownerTelegramId
      );
      logger.info(
        { businessId: business.id, tool: call.name, result: result || '(keyboard sent)' },
        'Onboarding tool executed'
      );

      // D-03: '' signals the tool already sent its own Telegram message
      // (keyboard or direct reply). Break the Gemini loop immediately.
      if (result === '') {
        return '';
      }

      functionResults.push({
        type: 'function_result',
        name: call.name,
        call_id: call.id,
        result: [{ type: 'text', text: result }],
      });
    }

    input = functionResults;
  }
}
```

**Tool schemas pattern** (lines 46-391 demonstrate structure):
```typescript
export const ONBOARDING_TOOLS = [
  {
    type: 'function' as const,
    name: 'set_business_name',
    description: 'Ορίζει το όνομα της επιχείρησης.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Όνομα της επιχείρησης' },
      },
      required: ['name'],
    },
  },
  {
    type: 'function' as const,
    name: 'set_business_hours',
    description: 'Ενημερώνει το ωράριο λειτουργίας για μια ημέρα.',
    parameters: {
      type: 'object',
      properties: {
        day_of_week: { type: 'integer', description: '0=Κυριακή, 1=Δευτέρα, ..., 6=Σάββατο' },
        open_time: { type: 'string', description: 'Ώρα ανοίγματος HH:MM' },
        close_time: { type: 'string', description: 'Ώρα κλεισίματος HH:MM' },
      },
      required: ['day_of_week', 'open_time', 'close_time'],
    },
  },
  // ... other onboarding tools (add_service, create_recurring_session, etc.)
];
```

**System prompt derivation pattern** (lines 397-438):
```typescript
function buildOnboardingSystemPrompt(
  business: Business,
  today: string
): string {
  // Fetch current state from DB to detect what's already configured
  const services = await listServicesForBusiness(business.id);
  const hours = await listBusinessHours(business.id);

  // Determine what's still missing
  const hasName = business.name && business.name !== '[placeholder]';
  const hasAllHours = hours.length === 7; // 0=Sun..6=Sat
  const hasServices = services.length > 0;

  // Build prompt describing what's still needed
  const missingSteps = [];
  if (!hasName) missingSteps.push('όνομα επιχείρησης');
  if (!hasAllHours) missingSteps.push('ωράριο λειτουργίας (7 ημέρες)');
  if (!hasServices) missingSteps.push('υπηρεσίες');

  return [
    `Είσαι ο βοηθός εγγραφής του ιδιοκτήτη της επιχείρησης.`,
    `Σημερινή ημερομηνία: ${today}`,
    '',
    'Κανόνες:',
    '- Μιλάς ΠΑΝΤΑ Ελληνικά, συνοπτικά και φιλικά.',
    '- Αν δεν καταλαβαίνεις τι θέλει ο ιδιοκτήτης, ρώτησέ τον συνοπτικά.',
    `- Τα ακόλουθα χρειάζονται ακόμα: ${missingSteps.join(', ')}`,
  ].join('\n');
}
```

**Tool executor pattern (MANDATORY getConn() + withBusinessContext)** (lines 483-850):
```typescript
interface OnboardingToolArgs {
  day_of_week?: number;
  open_time?: string;
  close_time?: string;
  name?: string;
  price_cents?: number;
  duration_min?: number;
  // ... other fields per tool
}

async function executeOnboardingTool(
  toolName: string,
  args: OnboardingToolArgs,
  business: Business,
  today: string,
  ownerTelegramId: string
): Promise<string> {
  // WR-02: top-level try/catch so any DB error returns a Greek error string to Gemini
  try {
    switch (toolName) {
      case 'set_business_name': {
        const { name } = args;
        if (!name) return 'Μη έγκυρο όνομα.';
        
        // WR-04: MANDATORY: wrap in withBusinessContext + use getConn() inside
        // Never use raw db import — deadlock risk per CONTEXT.md code-context incident
        return withBusinessContext(business.id, async () => {
          await getConn()
            .update(businesses)
            .set({ name })
            .where(eq(businesses.id, business.id));
          return `OK: Όνομα επιχείρησης ορίστηκε σε "${name}"`;
        });
      }

      case 'set_business_hours': {
        const { day_of_week, open_time, close_time } = args;
        if (day_of_week === undefined || !open_time || !close_time) return 'Μη έγκυρα δεδομένα.';
        
        // WR-04: wrap in withBusinessContext so RLS applies; use getConn() inside
        return withBusinessContext(business.id, async () => {
          await getConn()
            .insert(businessHours)
            .values({
              businessId: business.id,
              dayOfWeek: day_of_week,
              openTime: open_time,
              closeTime: close_time,
              isClosed: false,
            })
            .onConflictDoUpdate({
              target: [businessHours.businessId, businessHours.dayOfWeek],
              set: { openTime: open_time, closeTime: close_time, isClosed: false },
            });
          return `OK: ${GREEK_WEEKDAYS[day_of_week]} ${open_time}–${close_time}`;
        });
      }

      // ... other tool cases

      default:
        return `Άγνωστο εργαλείο: ${toolName}`;
    }
  } catch (err) {
    logger.error({ err, toolName, businessId: business.id }, 'executeOnboardingTool failed');
    return 'Σφάλμα κατά την εκτέλεση. Δοκιμάστε ξανά.';
  }
}
```

**Gemini types** (lines 856-876):
```typescript
interface GeminiCreateParams {
  model: string;
  input: string | GeminiFunctionResultInput[];
  tools: typeof ONBOARDING_TOOLS;  // Different from OWNER_TOOLS
  system_instruction: string;
  previous_interaction_id?: string;
  generation_config: { temperature: number; max_output_tokens: number; top_p: number };
}

interface GeminiFunctionResultInput {
  type: 'function_result';
  name: string;
  call_id: string;
  result: Array<{ type: 'text'; text: string }>;
}

interface GeminiInteractionResult {
  id: string;
  output_text?: string;
  steps?: Array<{ type: string; name?: string; arguments?: Record<string, unknown>; id?: string }>;
}
```

---

### `src/webhooks/telegram.ts` (MODIFIED webhook handler, request-response)

**Analog:** `src/webhooks/telegram.ts` (existing file)

**Message path routing — UPDATE lines ~83-106** (currently calls `dispatchOnboardingStep`, change to `aiOnboardingAgent`):

```typescript
// BEFORE (lines 87-95):
if (!business.onboardingCompleted) {
  // ARCH-03: owner messages bot before onboarding is complete — route to
  // the onboarding state machine.
  const activeResult = await findActiveSessionByOwnerTelegramId(senderTelegramId);
  if (activeResult) {
    await dispatchOnboardingStep(
      activeResult.session,
      activeResult.business,
      senderTelegramId,
      messageText
    );
  } else {
    // First-contact owner: create session and send welcome
    await createOrResetOnboardingSession(business.id, 'name');
    await sendTelegramMessage(
      senderTelegramId,
      'Καλωσήρθατε! Πώς ονομάζεται η επιχείρησή σας;'
    );
  }
  await markTelegramUpdateProcessed(updateId, business.id);
  return;
}

// AFTER (pattern to follow):
if (!business.onboardingCompleted) {
  const today = isoDateInAthens(new Date());
  const reply = await aiOnboardingAgent(business, senderTelegramId, messageText, today);
  // D-03: tools that send their own keyboards return '' (empty string).
  // Skip empty replies — the tool already sent the keyboard message.
  if (reply) {
    await sendTelegramMessage(senderTelegramId, reply);
  }
  await markTelegramUpdateProcessed(updateId, business.id);
  return;
}
```

**Callback_query (Ναι/Όχι buttons) path routing — UPDATE lines ~821-844** (currently calls `dispatchOnboardingStep`, change to `aiOnboardingAgent`):

```typescript
// BEFORE (lines 821-844):
if (
  business.ownerTelegramId !== null &&
  business.ownerTelegramId === senderTelegramId &&
  !business.onboardingCompleted
) {
  await answerCallbackQuery(update.callback_query.id);
  if (update.callback_query.message) {
    await editTelegramMessageReplyMarkup(
      senderTelegramId,
      update.callback_query.message.message_id,
      []
    );
  }
  const activeResult = await findActiveSessionByOwnerTelegramId(senderTelegramId);
  if (activeResult) {
    await dispatchOnboardingStep(
      activeResult.session,
      activeResult.business,
      senderTelegramId,
      update.callback_query.data ?? ''
    );
  }
  await markTelegramUpdateProcessed(updateId, business.id);
  return;
}

// AFTER (pattern to follow):
if (
  business.ownerTelegramId !== null &&
  business.ownerTelegramId === senderTelegramId &&
  !business.onboardingCompleted
) {
  await answerCallbackQuery(update.callback_query.id);
  if (update.callback_query.message) {
    await editTelegramMessageReplyMarkup(
      senderTelegramId,
      update.callback_query.message.message_id,
      []
    );
  }
  const today = isoDateInAthens(new Date());
  const reply = await aiOnboardingAgent(
    business,
    senderTelegramId,
    update.callback_query.data ?? '',
    today
  );
  if (reply) {
    await sendTelegramMessage(senderTelegramId, reply);
  }
  await markTelegramUpdateProcessed(updateId, business.id);
  return;
}
```

**Import changes** (add at top of telegram.ts):
```typescript
// REMOVE:
import { dispatchOnboardingStep } from '../onboarding/router';
import {
  findBusinessByOwnerTelegramId,
  findActiveSessionByOwnerTelegramId,
  createOrResetOnboardingSession,
} from '../onboarding/queries';

// ADD:
import { aiOnboardingAgent } from '../onboarding/ai-onboarding-agent';
// Keep: findBusinessByOwnerTelegramId for billing callback checks (T-07-01)
// (imports already present per line 23-26)
```

---

### `src/onboarding/queries.ts` (MODIFIED data access, CRUD)

**Analog:** `src/onboarding/queries.ts` (same file)

**Per D-02 (stateless resume), the following functions may become UNUSED if the new agent doesn't write to them:**

Functions that may be marked as deprecated but kept for backwards compatibility:
- `updateOnboardingStep()` (lines 82-91) — no longer written by new agent
- `OnboardingSession.collectedData` — no longer used if agent stores multi-field data in Gemini context

**Kept and reused by new agent:**
```typescript
// Lines 23-32: used by agent to check business ownership
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

// Lines 40-55: optional — agent may skip this and check !business.onboardingCompleted directly
// If used, it's a performance optimization to detect active session.
export async function findActiveSessionByOwnerTelegramId(
  ownerTelegramId: string
): Promise<{ session: OnboardingSession; business: Business } | null> {
  const rows = await db
    .select({ session: onboardingSessions, business: businesses })
    .from(onboardingSessions)
    .innerJoin(businesses, eq(onboardingSessions.businessId, businesses.id))
    .where(
      and(
        eq(businesses.ownerTelegramId, ownerTelegramId),
        not(eq(onboardingSessions.currentStep, 'done'))
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
```

**Note:** The planner should audit all references to `onboardingSessions.currentStep` and `collectedData` before deciding whether to drop them via migration or leave them inert. See RESEARCH.md §A4.

---

## Shared Patterns

### Authentication & Ownership Checks
**Source:** `src/webhooks/telegram.ts` (lines 82, 447, 358, etc.)

Applied to all onboarding code paths:
```typescript
// MANDATORY: T-16-04 explicit null guard before comparison
if (business.ownerTelegramId !== null && business.ownerTelegramId === senderTelegramId) {
  // owner-only logic
}
```

### Error Handling (Greek-language error messages)
**Source:** `src/onboarding/ai-owner-agent.ts` (lines 846-849, 898-899, 915)

Applied to all tool executions and agent invocations:
```typescript
// Gemini call failure
try {
  interaction = await (ai.interactions.create as any)({...});
} catch (err) {
  logger.error({ err, businessId: business.id }, 'aiOnboardingAgent Gemini call failed');
  return 'Το σύστημα δεν απόκρινε. Δοκιμάστε ξανά σε λίγο.';
}

// Tool execution failure
try {
  switch (toolName) {
    case 'set_business_name': {
      // ... tool logic
    }
  }
} catch (err) {
  logger.error({ err, toolName, businessId: business.id }, 'executeOnboardingTool failed');
  return 'Σφάλμα κατά την εκτέλεση. Δοκιμάστε ξανά.';
}
```

### Message Sending (Empty string = Tool sent keyboard)
**Source:** `src/onboarding/ai-owner-agent.ts` (lines 949-950)

Applied to onboarding agent caller in telegram.ts:
```typescript
const reply = await aiOnboardingAgent(business, senderTelegramId, messageText, today);
// D-03: '' signals the tool already sent its own Telegram message
if (reply) {
  await sendTelegramMessage(senderTelegramId, reply);
}
```

### Database Mutation Pattern (MANDATORY getConn + withBusinessContext)
**Source:** `src/onboarding/ai-owner-agent.ts` (lines 500-510, 516-526, 532-540, 549-555, 564-567)

Applied to every tool that modifies business data:
```typescript
// MANDATORY pattern — never use raw db import inside tool execution
return withBusinessContext(business.id, async () => {
  await getConn()
    .insert(businessHours)
    .values({
      businessId: business.id,
      dayOfWeek: day_of_week,
      openTime: open_time,
      closeTime: close_time,
      isClosed: false,
    })
    .onConflictDoUpdate({
      target: [businessHours.businessId, businessHours.dayOfWeek],
      set: { openTime: open_time, closeTime: close_time, isClosed: false },
    });
  return `OK: ${GREEK_WEEKDAYS[day_of_week]} ${open_time}–${close_time}`;
});
```

### System Prompt Construction (Derive DB State on Each Turn)
**Source:** `src/onboarding/ai-owner-agent.ts` (lines 397-438)

Applied to new agent's system prompt builder:
```typescript
function buildOnboardingSystemPrompt(
  business: Business,
  today: string
): string {
  const services = await listServicesForBusiness(business.id);
  const hours = await listBusinessHours(business.id);

  // Construct prompt describing what's still missing based on current DB state
  // This enables stateless resume (D-02): agent re-derives context on each message
  return [
    `Είσαι ο βοηθός εγγραφής...`,
    `Σημερινή ημερομηνία: ${today}`,
    // ... list current services, hours, config
    `Τα ακόλουθα χρειάζονται ακόμα: ...`,
  ].join('\n');
}
```

---

## No Analog Found

All files have direct analogs in the codebase. No files required external pattern lookup from RESEARCH.md.

---

## Metadata

**Analog search scope:** src/onboarding/, src/webhooks/, src/conversation/  
**Files scanned:** 3 primary (ai-owner-agent.ts, telegram.ts, queries.ts) + 1 secondary (function-executor.ts)  
**Pattern extraction date:** 2026-07-24

**Key patterns identified:**
1. **Gemini tool-calling loop** — MAX_TOOL_ROUNDS cap, system prompt re-derivation, function result threading (replicate exactly from aiOwnerAgent)
2. **Database safety (MANDATORY)** — All tool mutations use `withBusinessContext(businessId, async () => { await getConn()...})` pattern; never raw `db` import (deadlock risk per CONTEXT.md incident)
3. **Webhook integration** — Two routing points in telegram.ts (message path + callback_query path) currently call `dispatchOnboardingStep`; both must call `aiOnboardingAgent` with today date
4. **Greek language enforcement** — All system prompts and error messages must explicitly include "Μιλάς ΠΑΝΤΑ Ελληνικά" rule (Pitfall 5 mitigation)
5. **Stateless resume** — Agent derives missing config from DB state on each turn; no step-index tracking required (D-02 design)

---

*Phase: 21 — AI-Driven Owner Onboarding*  
*Patterns mapped: 2026-07-24*  
*Status: Ready for planning*
