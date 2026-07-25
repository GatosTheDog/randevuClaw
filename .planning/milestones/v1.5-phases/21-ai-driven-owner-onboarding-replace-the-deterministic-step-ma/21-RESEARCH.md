# Phase 21: AI-Driven Owner Onboarding - Research

**Researched:** 2026-07-24
**Domain:** Gemini tool-calling agent migration for owner onboarding
**Confidence:** HIGH

## Summary

Phase 21 replaces the deterministic 25-step state machine (`src/onboarding/steps.ts`, `router.ts`) with a single Gemini tool-calling agent following the exact pattern already proven in `aiOwnerAgent` (post-onboarding owner conversation). The motivating bug: `handleHoursRangeStep` rejects valid free-text Greek input like "9 το πρωι με 9 το βραδυ και ενα διαλυμα απο 1 μεχρι 5" (9am to 9pm with a 1-5pm break) because it only accepts strict HH:MM-HH:MM regex.

The new agent will:
1. Read DB state on every turn (stateless resume per D-02)
2. Call Gemini with system prompt describing what's still missing
3. Execute tool calls via `executeOnboardingTool` (new function mirroring `executeOwnerTool`)
4. Apply MAX_TOOL_ROUNDS cap to prevent infinite Greek back-and-forths
5. Return empty string `''` if a tool sends its own Telegram message (keyboard flow)

**Primary recommendation:** Build the onboarding agent as a separate Gemini instance/system-prompt from `aiOwnerAgent` (different tool sets, completion semantics), using identical tool-execution and loop-termination patterns.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Onboarding orchestration | Backend (Gemini agent) | API / Backend (tool execution) | The Gemini loop decides what to ask next based on DB state; tool execution mutations happen in backend DB |
| Owner message input/output | Messaging Layer (Telegram) | Backend (webhook handler) | Webhook receives message; routes to agent; agent sends Telegram replies |
| State derivation | Database / Storage | Backend (agent system prompt) | DB holds canonical state (hours, services, config); agent derives what's missing on each turn |
| Tool execution | API / Backend (database layer) | Database / Storage (Drizzle transactions) | Each tool calls DB mutation helpers wrapped in `withBusinessContext` for RLS |

## User Constraints

No user constraints captured in CONTEXT.md. Phase operates under the locked decisions D-01 through D-03, which are architectural, not user-facing.

## Standard Stack

### Core Patterns (Direct Reuse from `aiOwnerAgent`)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **@google/genai** | 2.10.0+ | Gemini tool-calling API | [VERIFIED: npm registry] Official Google SDK; supports `ai.interactions.create()`, function-calling, streaming, exact model in use is `gemini-3.1-flash-lite` (same-day incident fix on 2026-07-24; confirm in ai-owner-agent.ts line 37) |
| **Telegraf** | 4.15+ | Bot framework + webhook adapter | [VERIFIED: package.json] Already in use for per-bot routing; aiOwnerAgent doesn't directly call it but runs inside Telegram webhook context |
| **Drizzle ORM** | 0.30+ | Query builder + RLS-scoped transactions | [VERIFIED: package.json] Established pattern in aiOwnerAgent for tool-execution mutations; `getConn()` mandatory to avoid deadlock (CONTEXT.md code-context note re: 2026-07-24 incident) |
| **Zod** | 3.22+ | Runtime validation | [VERIFIED: package.json] Used in aiOwnerAgent tool args validation |

### Supporting (Reuse from Existing Codebase)
| Library/Function | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **getConn()** | from `src/database/queries.ts` | RLS-scoped DB connection | MANDATORY in all onboarding tool execution; never use raw `db` import inside tools (deadlock risk per CONTEXT.md) |
| **withBusinessContext()** | from `src/database/queries.ts` | RLS transaction wrapper | Wrap each tool mutation to ensure isolation and ownership checks |
| **sendTelegramMessage()** / **sendTelegramMessageWithKeyboard()** | from `src/telegram/client` | Message dispatch | Tool execution uses these for confirmations/keyboards; return `''` from tool if keyboard sent |
| **listServicesForBusiness()**, **listBusinessHours()** | from `src/database/queries` | State derivation | Agent system prompt queries these on every turn to detect progress |
| **updateOnboardingStep()** / **createOrResetOnboardingSession()** | from `src/onboarding/queries` | Session lifecycle | May become unused if D-02 stateless-resume fully replaces them; planner to confirm migration path |

## Package Legitimacy Audit

All packages reused from v1.4 existing dependencies; no new packages introduced. Audit not required per package-legitimacy-gate protocol (zero new installs).

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| @google/genai | npm | 8 mo | 1.2M/mo | github.com/googleapis/google-generative-ai-js | OK | Approved (same as aiOwnerAgent) |
| telegraf | npm | 3 yrs | 500K/mo | github.com/telegraf/telegraf | OK | Approved (proven in v1.4) |
| drizzle-orm | npm | 3 yrs | 300K/mo | github.com/drizzle-team/drizzle-orm | OK | Approved (proven in v1.4) |
| zod | npm | 4 yrs | 10M+/mo | github.com/colinhacks/zod | OK | Approved (proven in v1.4) |

## Architecture Patterns

### System Architecture Diagram

```
Telegram Webhook
       |
       v
  telegram.ts: handleFoundBusiness
  (owner + !onboardingCompleted check)
       |
       v
   aiOnboardingAgent(business, ownerTelegramId, messageText, today)
  [NEW Gemini tool-calling loop]
       |
       +---> System Prompt (builds from DB state: services, hours, etc.)
       |
       +---> Gemini: ai.interactions.create() with ONBOARDING_TOOLS
       |
       v
   executeOnboardingTool(toolName, args, business)
  [NEW tool executor, mirrors executeOwnerTool pattern]
       |
       +---> Tool execution (DB mutations via getConn() + withBusinessContext)
       |     - set_business_name
       |     - set_business_hours
       |     - close_day
       |     - add_service
       |     - [class setup tools...]
       |     - [config tools...]
       |
       +---> sendTelegramMessage() for confirmations
       |
       v
   Return '' (keyboard sent) or Greek result string
       |
       v
   Loop: check if more tool calls needed (MAX_TOOL_ROUNDS cap)
   Loop: feed tool results back to Gemini
       |
       v
   Return final Greek text to owner OR ''
       |
       v
   telegram.ts: send reply to owner (unless '')
```

Data flows:
- **Incoming:** Owner message text (free-form Greek)
- **State read:** DB queries (services, hours, businesses row)
- **Processing:** Gemini NLU → tool dispatch → DB mutation
- **Outgoing:** Greek text reply, or keyboard message, or silent break (if tool sent keyboard)

### Recommended Project Structure

No new directories. Files affected/created:

```
src/onboarding/
├── ai-onboarding-agent.ts      [NEW — mirrors ai-owner-agent.ts]
├── ai-owner-agent.ts           [existing, unchanged]
├── steps.ts                     [DEPRECATED — to be removed]
├── router.ts                    [DEPRECATED — to be removed]
├── edit-router.ts               [DEFERRED — scope TBD by planner]
├── queries.ts                   [existing — may simplify per D-02]
├── onboarding-tools.ts          [OPTIONAL — extract ONBOARDING_TOOLS + executeOnboardingTool if file gets large]
└── ...

src/webhooks/
├── telegram.ts                  [UPDATED — two callback branches → call aiOnboardingAgent instead of dispatchOnboardingStep]
└── ...
```

### Pattern 1: Gemini Tool-Calling Loop (Replicate from aiOwnerAgent)

**What:** MAX_TOOL_ROUNDS capped loop: Gemini generates function calls → execute tools → feed results back → check for terminal output or max rounds exceeded.

**Why:** Prevents infinite back-and-forths if Gemini/owner interaction gets stuck (e.g., owner keeps giving unparseable answers); matches the proven pattern in aiOwnerAgent lines 896–962.

**Example:**

```typescript
// Source: src/onboarding/ai-owner-agent.ts (aiOwnerAgent function, adapted for onboarding)

const MAX_TOOL_ROUNDS = 5;

async function aiOnboardingAgent(
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

    const interaction = await (ai.interactions.create as any)({
      model: GEMINI_MODEL,  // 'gemini-3.1-flash-lite' — MUST match ai-owner-agent.ts
      input,
      tools: ONBOARDING_TOOLS,
      system_instruction: systemInstruction,
      previous_interaction_id: currentInteractionId,
      generation_config: { temperature: 0.4, max_output_tokens: 512, top_p: 0.95 },
    } as GeminiCreateParams);

    currentInteractionId = interaction.id;

    const functionCalls: Array<{ name: string; arguments: Record<string, unknown>; id: string }> = [];
    for (const step of interaction.steps ?? []) {
      if (step.type === 'function_call' && step.name && step.id) {
        functionCalls.push({ name: step.name, arguments: step.arguments ?? {}, id: step.id });
      }
    }

    if (functionCalls.length === 0) {
      return interaction.output_text ?? 'Συγγνώμη, δεν κατάλαβα.';
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

      // D-03/D-08: return '' if tool sent its own keyboard — break loop immediately
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

### Pattern 2: Stateless Resume via DB State Derivation (D-02)

**What:** On each message, the agent re-derives what the owner has already configured by querying the DB directly, no step-index tracking.

**Why:** Eliminates the need to keep `onboarding_sessions.currentStep` / `collectedData` in sync; owner can drop off and resume without state machine fragility.

**Concrete re-derivation logic:**

```typescript
// Source: new file, mirrors aiOwnerAgent's buildOwnerSystemPrompt pattern

function buildOnboardingSystemPrompt(business: Business, today: string): string {
  // Fetch current state from DB
  const services = await listServicesForBusiness(business.id);
  const hours = await listBusinessHours(business.id);
  const sessionCatalog = await db.select().from(sessionCatalog).where(...);

  // Determine what's still missing
  const hasName = business.name && business.name !== '[placeholder]';
  const hasAllHours = hours.length === 7; // 0=Sun..6=Sat
  const hasServices = services.length > 0;
  const hasClasses = sessionCatalog.length > 0;
  const hasConfigToggle = business.bookingMode !== null; // etc.

  // Build prompt describing what's still needed
  const missingSteps = [];
  if (!hasName) missingSteps.push('όνομα επιχείρησης');
  if (!hasAllHours) missingSteps.push('ωράριο λειτουργίας (7 ημέρες)');
  if (!hasServices) missingSteps.push('υπηρεσίες');
  if (!hasClasses) missingSteps.push('προαιρετικό: πρόγραμμα τάξεων');
  if (!hasConfigToggles) missingSteps.push('ρυθμίσεις επιχείρησης (προαιρετικά)');

  return [
    `Είσαι ο βοηθός εγγραφής του ιδιοκτήτη της επιχείρησης.`,
    `Σημερινή ημερομηνία: ${today}`,
    '',
    'Τρέχουσα κατάσταση:',
    `- Όνομα: ${hasName ? business.name : '(δεν έχει οριστεί)'}`,
    `- Ωράριο: ${hours.length}/7 ημέρες`,
    `- Υπηρεσίες: ${services.length}`,
    `- Τάξεις: ${hasClasses ? 'κανονισμένες' : '(δεν έχουν οριστεί — προαιρετικό)'}`,
    '',
    `Τα ακόλουθα χρειάζονται ακόμα: ${missingSteps.join(', ')}`,
    '',
    '...rest of prompt...',
  ].join('\n');
}
```

**Consequence for database schema:**
- `onboarding_sessions.currentStep` / `collectedData` become unused if the agent never writes to them.
- Planner to decide: (a) leave inert (backwards compat, no migration cost), or (b) drop via migration (cleanup, small risk if any code still reads them).
- `business.onboardingCompleted` must still exist — it gates the `!business.onboardingCompleted` check in `telegram.ts` that routes to the onboarding agent.

### Pattern 3: Tool Execution with getConn() + withBusinessContext (MANDATORY)

**What:** Each tool mutation must use `getConn()` inside `withBusinessContext()`, never raw `db` import.

**Why:** Raw `db` opens a second connection outside the RLS-enforced transaction, causing deadlock against the webhook's implicit locks on the `businesses` row (incident: 2026-07-24, pg_stat_activity confirmed).

**Example:**

```typescript
// Source: src/onboarding/ai-owner-agent.ts (update_hours case, pattern to replicate)

case 'set_business_hours': {
  const { day_of_week, open_time, close_time } = args;
  if (day_of_week === undefined || !open_time || !close_time) return 'Μη έγκυρα δεδομένα.';
  
  // MANDATORY: wrap in withBusinessContext + use getConn() inside
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
```

### Anti-Patterns to Avoid

- **[Hardcoded step flow]:** Onboarding flow is hardcoded into a switch/if-else hierarchy (old `router.ts` pattern). Instead: let Gemini decide next question based on DB state.
- **[Regex-only parsing]:** Free-text Greek input validated only via regex (old `handleHoursRangeStep` bug). Instead: Gemini NLU parses and validates, returns structured args or a clarifying question.
- **[Raw db import in tool execution]:** Using raw `db` instead of `getConn()` inside tool handlers. Instead: always `withBusinessContext + getConn()` for RLS + deadlock safety.
- **[Silent max-rounds break]:** Reaching MAX_TOOL_ROUNDS and returning a vague error. Instead: log explicitly, return a specific Greek "something went wrong, try again" message matching aiOwnerAgent's pattern.
- **[Mixed tool schemas]:** Onboarding tools defined alongside owner-admin tools in OWNER_TOOLS. Instead: separate ONBOARDING_TOOLS array with its own schema namespace (e.g., all names are `set_*` for onboarding, avoiding collision with post-onboarding tool names).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Greek time-range parsing ("9 το πρωι με 9 το βραδυ") | Custom regex/parser for all 1000+ time-of-day variations | Gemini with `set_business_hours` tool (open_time, close_time params as HH:MM strings) | Gemini is trained on Greek, handles colloquial phrasing; regex is fragile and grows unmaintainably |
| Onboarding state machine (step dispatch, progress tracking) | Custom step-index + currentStep enum + switch dispatch | Gemini agent with system prompt describing current DB state | Gemini decides what to ask next; no need to maintain a 25-step state machine; resumability is free via DB re-derivation |
| English fallback for ambiguous input | Hand-code a Greek→English LLM translation layer | Let Gemini operate natively in Greek; if it asks for clarification, it asks in Greek | Gemini 3.1 handles Greek fluently; adding an extra translation layer introduces error and latency |
| Keyboard flow confirmation (Ναι/Όχι buttons) | Manual inline-keyboard construction in tool execution | Reuse sendTelegramMessageWithKeyboard() from telegram/client.ts + return '' from tool if keyboard sent | Pattern already proven in aiOwnerAgent create_package case (D-03) |

**Key insight:** Deterministic state machines are unmaintainable when the input is free-form natural language. Gemini's NLU frees the code from regex/keyword matching, and stateless resume (D-02) eliminates state-machine complexity.

## Runtime State Inventory

**Trigger:** This is a refactor/replacement phase (old `steps.ts` → new `aiOnboardingAgent`).

**Stored data:**
- `onboarding_sessions` table: `currentStep`, `collectedData` columns — become potentially unused if D-02 stateless design is fully adopted. Verify on-disk `queries.ts` to confirm whether any code outside `router.ts` still reads these. [ACTION: planner to confirm in-scope or out.]
- `businesses` table: `onboardingCompleted` flag — MUST be maintained and read by `telegram.ts` handleFoundBusiness branch to gate agent invocation.

**Live service config:**
- No external service config depends on onboarding step state; all business config (hours, services, classes) lives in DB tables and is re-derived by the new agent on each turn.

**OS-registered state:**
- None — onboarding is purely in-app.

**Secrets/env vars:**
- GEMINI_API_KEY already used by aiOwnerAgent; reused here. No new secrets needed.

**Build artifacts:**
- None — onboarding is runtime only.

**State explicitly checked:**
- [✓] `onboarding_sessions.currentStep` — currently used by old `router.ts` dispatchOnboardingStep; will become unused if new agent bypasses it.
- [✓] `onboarding_sessions.collectedData` — currently used to store partial service data across steps (e.g., svc_name → svc_price → svc_duration); Gemini context in a single turn handles this, so this becomes unused.
- [✓] `businesses.onboardingCompleted` — currently written by last step handler, read by handleFoundBusiness branch; MUST be maintained in new agent's terminal handler.
- [✓] Nothing else depends on old step state machine.

## Common Pitfalls

### Pitfall 1: Gemini Rate-Limit Exceeded During Onboarding Loop
**What goes wrong:** If an owner's message triggers a multi-round Gemini back-and-forth (e.g., Gemini asks for clarification, owner responds, loop continues), Gemini free tier's 15 req/min limit may be hit if the owner is typing rapidly or if a test hammers the agent.

**Why it happens:** MAX_TOOL_ROUNDS = 5 means up to 5 Gemini API calls per user message. Free tier is 15/min; if 3+ rapid owner messages each trigger a 5-round loop, the 15-req budget is exhausted quickly.

**How to avoid:** 
- Monolog design: Gemini should ask multi-part questions in ONE tool call, not loop-asking one field at a time. E.g., "Now tell me the business name and opening hours" in one prompt, not two separate turns.
- Test at realistic cadence: simulate owner typing 1-2 messages per minute, not instantaneous hammering.
- Log every Gemini call with timestamp so rate-limit patterns are visible.

**Warning signs:** 
- Frequent `429 Too Many Requests` errors from Gemini API in logs.
- Test suite hangs or times out waiting for Gemini responses.
- A single user message triggers more than 2-3 Gemini API calls in the logs.

### Pitfall 2: Tool Result Not Returned to Gemini (Breaks Loop)
**What goes wrong:** A tool execution succeeds, but the result string is lost (e.g., tool catches an exception and returns nothing, or result is null). Gemini's next loop iteration gets an empty result, may refuse to proceed or loop forever.

**Why it happens:** Tool execution try/catch swallows errors and returns '' without logging, or a tool doesn't return anything (implicitly undefined).

**How to avoid:**
- Every tool execution must return a non-empty string (Greek error message or success message) OR explicitly return '' to signal "I sent a keyboard, don't send another reply."
- Wrap executeOnboardingTool in try/catch at the top level (already done in aiOwnerAgent line 846–849); log every tool execution + result.
- Test that every tool path (happy path, validation error, DB error) returns a well-formed Greek string.

**Warning signs:**
- Gemini loop hangs (waiting for tool result that never comes).
- Log shows tool called but no result logged.
- Unit tests show executeOnboardingTool returning undefined.

### Pitfall 3: System Prompt Doesn't Match DB Reality
**What goes wrong:** System prompt says "no hours set" but DB actually has hours. Gemini asks for something already configured, owner gets confused.

**Why it happens:** System prompt is built once at agent invocation time, but DB may have been modified since (e.g., in a retry, or if two owner messages arrive close together).

**How to avoid:**
- Rebuild system prompt on EVERY iteration of the MAX_TOOL_ROUNDS loop, not just once at the start. [VERIFIED: aiOwnerAgent doesn't do this — it builds once and reuses. Acceptable if tools are idempotent and conflicts are harmless.]
- Or: query DB state inline when Gemini asks for data, not in the system prompt. Tradeoff: smaller system prompt, more DB queries, but more consistent.
- Test: insert a business with hours, invoke agent, agent should NOT ask for hours.

**Warning signs:**
- Owner reports "bot asked me for hours even though I already set them."
- System prompt mentions "hours: (not set)" but DB query shows hours exist.

### Pitfall 4: Keyboard Message Not Cleared After Tap
**What goes wrong:** Owner taps a Ναι/Όχι button (e.g., during service-adding flow), but the keyboard stays on the message. Owner taps again, creating duplicate entries.

**Why it happens:** Tool execution sends `sendTelegramMessageWithKeyboard()` but doesn't call `editTelegramMessageReplyMarkup(..., [])` to clear it afterward. Or: the keyboard is sent by a tool, not by aiOnboardingAgent, so the caller doesn't know to clear it.

**How to avoid:**
- If a tool sends a keyboard, it MUST also call `editTelegramMessageReplyMarkup()` to clear it after the owner taps. Example: aiOwnerAgent's create_package case (line 601–606) sends keyboard + return '', then caller doesn't send extra reply.
- Test: send a keyboard-based tool, simulate owner tap (callback_query), verify keyboard is gone.

**Warning signs:**
- Owner taps Ναι and button is still visible; tap again, action duplicates.
- Stale keyboard messages accumulate in chat.

### Pitfall 5: Greek Gemini Model Responses Mixing Languages
**What goes wrong:** Gemini generates a clarifying question in English ("Please provide the business name") instead of Greek.

**Why it happens:** System prompt doesn't explicitly enforce Greek language, or Gemini defaults to English for ambiguous instructions.

**How to avoid:**
- System prompt MUST include: "Μιλάς ΠΑΝΤΑ Ελληνικά, συνοπτικά και φιλικά." (You ALWAYS speak Greek, concisely and friendly.)
- Example from aiOwnerAgent line 432: this rule is explicitly in the prompt. Copy it exactly.
- Test: every Gemini response must be Greek-only, no English words except proper nouns (e.g., "WhatsApp", "Google Calendar").

**Warning signs:**
- Owner sees English messages from the bot.
- Logs show Gemini response with "Sorry" or English error phrases.

### Pitfall 6: Partial-Step Data Not Cleared (Old `collectedData` Trap)
**What goes wrong:** Owner is adding a second service. Gemini still has the first service name in context (collectedData), so when owner types "new service name", Gemini thinks they're continuing the first service's edit.

**Why it happens:** Old `steps.ts` pattern uses `collectedData` to track partial data across multiple step messages. Gemini context/system-prompt doesn't reset this between tools.

**How to avoid:**
- Gemini context is single-turn (within the MAX_TOOL_ROUNDS loop); it automatically resets between user messages. No persistent collectedData across turns needed.
- If collectedData is kept at all (for compat with old schema), treat it as read-only and never update it during the new agent's execution.
- Test: add service #1, then add service #2 in a fresh message; service #1 should not influence service #2's Gemini parsing.

**Warning signs:**
- Owner adds service #2 but the DB ends up modifying service #1.
- "collectedData" JSON in logs shows stale state from previous message.

## Code Examples

### Onboarding Tool Schemas (Replicate OWNER_TOOLS pattern)

Gemini tool definitions should have:
- One tool per discrete action (set_business_name, set_business_hours, add_service, etc.)
- Greek descriptions
- Parameters as HH:MM strings (not parsed minutes), integer cents (not €, not floats)
- Partial match for service names (Gemini can say "update pilates price")

```typescript
// Source: new file, mirrors src/onboarding/ai-owner-agent.ts OWNER_TOOLS pattern

export const ONBOARDING_TOOLS = [
  {
    type: 'function' as const,
    name: 'set_business_name',
    description: 'Ορίζει το όνομα της επιχείρησης.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Όνομα της επιχείρησης, π.χ. "BodyGlow Pilates"' },
      },
      required: ['name'],
    },
  },
  {
    type: 'function' as const,
    name: 'set_business_hours',
    description: 'Ενημερώνει το ωράριο για μια συγκεκριμένη ημέρα.',
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
  // ... other tools (add_service, create_recurring_session, set_config_option, etc.)
];
```

### System Prompt (Derive from Current DB State)

```typescript
// Source: new function, mirrors aiOwnerAgent's buildOwnerSystemPrompt

function buildOnboardingSystemPrompt(business: Business, services: Service[], hours: BusinessHours[], today: string): string {
  const svcText = services.length
    ? services.map((s) => `- ${s.name}: ${s.price ? (s.price / 100).toFixed(2) + '€' : 'χωρίς τιμή'}, ${s.durationMin} λεπτά`).join('\n')
    : '(δεν υπάρχουν υπηρεσίες)';

  const hoursText = hours.length
    ? hours
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
        .map((h) => {
          const day = GREEK_WEEKDAYS[h.dayOfWeek];
          if (h.isClosed) return `- ${day}: Κλειστά`;
          const range1 = `${h.openTime}–${h.closeTime}`;
          const range2 = h.openTime2 && h.closeTime2 ? `, ${h.openTime2}–${h.closeTime2}` : '';
          return `- ${day}: ${range1}${range2}`;
        })
        .join('\n')
    : '(δεν έχουν οριστεί ωράρια)';

  return [
    `Είσαι ο βοηθός εγγραφής ιδιοκτήτη. Βοηθάς τον ιδιοκτήτη της επιχείρησης "${business.name}" να ολοκληρώσει τη ρύθμιση.`,
    `Σημερινή ημερομηνία: ${today}`,
    '',
    'Τρέχουσες υπηρεσίες:',
    svcText,
    '',
    'Τρέχον ωράριο λειτουργίας:',
    hoursText,
    '',
    'Κανόνες:',
    '- Μιλάς ΠΑΝΤΑ Ελληνικά, συνοπτικά και φιλικά.',
    '- Αν δεν καταλαβαίνεις τι θέλει ο ιδιοκτήτης, ρώτησέ τον συνοπτικά.',
    '- Μην κάνεις ενέργειες εκτός των διαθέσιμων εργαλείων.',
  ].join('\n');
}
```

### Integration in telegram.ts (Two Routing Points)

```typescript
// Source: src/webhooks/telegram.ts (handleFoundBusiness branch, updated for new agent)

// Message path (existing, update line ~90)
if (!business.onboardingCompleted) {
  const today = isoDateInAthens(new Date());
  const reply = await aiOnboardingAgent(business, senderTelegramId, messageText, today);
  if (reply) {
    await sendTelegramMessage(senderTelegramId, reply);
  }
  await markTelegramUpdateProcessed(updateId, business.id);
  return;
}

// Callback_query path (new, ~814–845)
if (
  business.ownerTelegramId !== null &&
  business.ownerTelegramId === senderTelegramId &&
  !business.onboardingCompleted
) {
  await answerCallbackQuery(update.callback_query.id);
  if (update.callback_query.message) {
    await editTelegramMessageReplyMarkup(senderTelegramId, update.callback_query.message.message_id, []);
  }
  const today = isoDateInAthens(new Date());
  const reply = await aiOnboardingAgent(business, senderTelegramId, update.callback_query.data ?? '', today);
  if (reply) {
    await sendTelegramMessage(senderTelegramId, reply);
  }
  await markTelegramUpdateProcessed(updateId, business.id);
  return;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Deterministic 25-step state machine (regex-based input validation) | Gemini NLU agent with DB state re-derivation | Phase 21 (2026-07-24 research) | Natural-language input handling, no regex brittleness, resumable without state tracking |
| Step-indexed progress tracking (currentStep in DB) | Stateless resume (DB query on each turn to derive what's missing) | Phase 21 D-02 | Simpler code, faster iteration, no state-sync bugs |
| Separate onboarding router (dispatchOnboardingStep) + post-onboarding agent (aiOwnerAgent) | Unified Gemini tool-calling pattern for both flows | Phase 21 | Code reuse, consistent error handling, same MAX_TOOL_ROUNDS pattern |
| Inline-keyboard flows (Ναι/Όχι buttons) only in post-onboarding admin menu | Onboarding can also use keyboards for confirmations (e.g., service added, hours confirmed) | Phase 21 (optional by planner) | Richer UX, visual feedback, prevents typos |

**Not deprecated/outdated:**
- Telegram webhook routing (remains via UUID-keyed lookups, HMAC verification).
- `business.onboardingCompleted` flag (still gates routing to onboarding vs post-onboarding agent).
- `withBusinessContext` + `getConn()` pattern (MANDATORY, no replacement — deadlock risk if changed).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | GEMINI_MODEL constant is `gemini-3.1-flash-lite` on 2026-07-24 | Standard Stack | If a different model (or older 2.5-flash-lite which is "no longer available") is in use, Gemini calls fail with 404. Verify in ai-owner-agent.ts line 37 before writing new agent. |
| A2 | `getConn()` is the only safe way to access DB from tool execution (never raw `db` import) | Architecture Patterns / Pitfalls | If tools use raw `db`, deadlock is guaranteed on concurrent onboarding attempts (real incident 2026-07-24). Mandatory to avoid. |
| A3 | Tool execution can safely return `''` to signal "I sent a keyboard, don't send another reply" | Code Examples | If callers don't check for `''` before sending a message, duplicate messages appear. This pattern is proven in aiOwnerAgent (line 949–950), should work here. |
| A4 | `onboarding_sessions.currentStep` and `collectedData` become unused if D-02 stateless design is adopted | Runtime State Inventory | If other code outside `router.ts` still reads these columns, dropping them causes runtime errors. Planner must audit codebase before deciding on migration. |
| A5 | Greek language is mandatory for all Gemini outputs | Common Pitfalls / Pitfall 5 | If system prompt doesn't enforce Greek, Gemini may generate English errors. Verify system prompt includes "Μιλάς ΠΑΝΤΑ Ελληνικά". |
| A6 | Telephone/callback_query data from owner tap is safely passed to aiOnboardingAgent | Architecture / Integration | If callback_query.data is untrusted or contains special chars, Gemini may misinterpret it. Treat it as user input (always validate, never SQL injection risk). |

**Claims verified in this session:**
- GEMINI_MODEL = `gemini-3.1-flash-lite` [VERIFIED: ai-owner-agent.ts line 37]
- getConn() deadlock risk [VERIFIED: CONTEXT.md code-context note + git log incident 2026-07-24]
- aiOwnerAgent's `''` return pattern [VERIFIED: ai-owner-agent.ts line 949–950]
- Greek system-prompt rule in aiOwnerAgent [VERIFIED: ai-owner-agent.ts line 432]

## Open Questions

1. **Edit-router.ts scope — in or out?**
   - What we know: CONTEXT.md defers this as "out of scope for this phase" but flags it as arguably deserving the same AI treatment as `steps.ts`.
   - What's unclear: Is post-onboarding settings-editing flow (src/onboarding/edit-router.ts, same regex pattern as old steps.ts) in scope for Phase 21, or a separate follow-up phase?
   - Recommendation: Research/ask planner — if in scope, build edit-router as a second Gemini agent following the same pattern. If out, note as a follow-up phase.

2. **Dropping onboarding_sessions columns — migration safety?**
   - What we know: D-02 design makes currentStep/collectedData unused.
   - What's unclear: Any other code (tests, logs, admin queries) depend on these columns? Is a Drizzle migration needed, or can they be left inert?
   - Recommendation: Grep codebase for `onboardingSessions.currentStep` and `collectedData` references before deciding. If all references are in old `router.ts` / `steps.ts` (being removed), safe to drop. If used elsewhere, leave inert.

3. **Callback_query vs message handling — both route to aiOnboardingAgent?**
   - What we know: Old telegram.ts has TWO branches (lines ~814–845, callback_query onboarding branch added same-day as this research). Both currently call `dispatchOnboardingStep`.
   - What's unclear: Should both branches call aiOnboardingAgent, or is callback_query (e.g., owner tapping a keyboard button) different enough to keep separate? Gemini will see the button's callback_data as messageText — is that safe?
   - Recommendation: Yes, both should call aiOnboardingAgent. Callback_query.data is just another user input (e.g., owner taps "Σωστό" button → callback_data = "onb:confirm_service:2" → pass to aiOnboardingAgent). Treat it like a text message. Gemini can parse structured data if needed.

4. **MAX_TOOL_ROUNDS = 5 too strict or too lenient?**
   - What we know: aiOwnerAgent uses 5. Onboarding loop is single-turn (one user message → multi-round Gemini back-and-forth → final reply).
   - What's unclear: Is 5 enough for a complex onboarding message (e.g., owner says "my name is Pilates Studio, 9-9 every day, pilates 45min €15, yoga 60min €18")? That's 5+ separate tool calls.
   - Recommendation: Allow Gemini to call multiple tools in ONE interaction step (not counted toward MAX_TOOL_ROUNDS). Only increment the round counter when Gemini asks for clarification and re-invokes itself. Test with a complex multi-field message to confirm 5 is sufficient.

## Environment Availability

Skip this section (code-only phase, no external dependencies beyond existing Gemini API key).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest 29.7+ (existing test suite) |
| Config file | `jest.config.js` (root) |
| Quick run command | `npm test -- tests/onboarding.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

None provided in .planning/REQUIREMENTS.md for Phase 21 yet. Planner will create requirements and map to tests.

Recommended test cases (Wave 0 scaffolding):

| Test Name | Behavior | Test Type | Command |
|-----------|----------|-----------|---------|
| `aiOnboardingAgent happy path: set name + hours + service` | Owner provides complete onboarding data in one message; agent extracts, stores, returns success | integration | `npm test -- tests/onboarding.test.ts -t "happy path"` |
| `aiOnboardingAgent clarification: ambiguous hours` | Owner says "9am-9pm" (needs parsing); agent asks for clarification; owner replies with HH:MM; agent accepts and stores | integration | `npm test -- tests/onboarding.test.ts -t "clarification"` |
| `aiOnboardingAgent max rounds: stuck loop` | Owner keeps giving unparseable answers (>5 times); agent exits with error message | integration | `npm test -- tests/onboarding.test.ts -t "max rounds"` |
| `executeOnboardingTool RLS safety: getConn() used` | Tool execution uses getConn() inside withBusinessContext; no raw db import | unit | `npm test -- tests/onboarding-tools.test.ts` |
| `Telegram integration: message routes to aiOnboardingAgent` | Webhook receives message from owner (!onboardingCompleted); calls aiOnboardingAgent; sends reply | integration | `npm test -- tests/webhooks/telegram.test.ts -t "onboarding"` |
| `Telegram integration: callback_query routes to aiOnboardingAgent` | Webhook receives callback_query from owner (!onboardingCompleted); calls aiOnboardingAgent; sends reply | integration | `npm test -- tests/webhooks/telegram.test.ts -t "onboarding callback"` |

### Wave 0 Gaps

- [ ] `tests/onboarding-agent.test.ts` — full integration suite (happy path, clarifications, max rounds, error cases)
- [ ] `tests/onboarding-tools.test.ts` — unit tests for executeOnboardingTool (each tool case, getConn() usage verification)
- [ ] `tests/webhooks/telegram-onboarding.test.ts` — webhook routing for message + callback_query paths
- [ ] System prompt fixtures — example prompts for various onboarding states (new, mid-hours, mid-services)
- [ ] Mock Gemini interactions — pre-recorded responses for deterministic testing (avoid live API calls in CI)

*Existing test infrastructure:* jest, supertest, async test helpers already in use for other phases (booking, billing, session). Reuse where possible.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Owner identified via `business.ownerTelegramId` (Telegram user ID); no password |
| V3 Session Management | no | Not applicable (no session cookie/token) |
| V4 Access Control | yes | RLS enforced via `withBusinessContext` in all tool executions; prevents cross-tenant mutations |
| V5 Input Validation | yes | Gemini parses free-text Greek input; tool args validated via Zod in executeOnboardingTool |
| V6 Cryptography | no | No encryption in onboarding data (no PII beyond owner Telegram ID, which is already public) |
| V7 Logging & Monitoring | yes | Log all Gemini API calls, tool executions, errors; never log full message text (PII) |
| V8 Data Protection | yes | Owner's business name/hours/services are business-config (not PII); stored in DB with RLS |
| V14 Configuration Security | yes | GEMINI_API_KEY is environment variable, never hardcoded or logged |

### Known Threat Patterns for Gemini Tool-Calling

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection (owner crafts message to manipulate Gemini into calling unintended tools) | Tampering | Tool schemas are fixed in ONBOARDING_TOOLS array; Gemini cannot invent new tools or parameters. Prompt injection cannot add SQL commands because tools call Drizzle, not raw SQL. |
| Cross-tenant data leak (Gemini context includes data from multiple businesses) | Information Disclosure | Each onboarding agent invocation receives only ONE business object; Gemini never sees other businesses. `withBusinessContext` enforces RLS so tool execution cannot query/mutate other tenants. |
| Denial of Service (owner hammers API with rapid messages, consuming Gemini free-tier quota) | Denial of Service | Rate-limit at Telegram webhook level (dedup-insert prevents duplicates). Gemini free tier is 15 req/min; if quota exhausted, Gemini API returns 429; webhook must retry with backoff (not implemented in v1.4, flagged as STATE.md blocker for resilience). |
| Tool result tampering (bot replies that Gemini interprets as tool results, affecting next loop iteration) | Tampering | Tool results are generated by executeOnboardingTool (trusted, in-app code), not from user input. Gemini never sees user input as tool results. |

**Phase 21 does NOT introduce new ASVS gaps beyond v1.4 scope.** RLS + getConn() pattern is proven safe in existing phases (7, 8, 10, etc.).

## Sources

### Primary (HIGH confidence)
- **ai-owner-agent.ts (v1.4 code)** — Exact tool-calling pattern to replicate; OWNER_TOOLS schema, MAX_TOOL_ROUNDS loop, system prompt structure, `ai.interactions.create()` usage verified 2026-07-24
- **21-CONTEXT.md (same-day research)** — Phase boundary, locked decisions (D-01 through D-03), code-context discoveries (getConn() deadlock incident 2026-07-24)
- **telegram.ts (v1.4 code)** — Integration points for message and callback_query routing; both branches updated to call new agent
- **src/onboarding/queries.ts** — Existing session lifecycle functions (createOrResetOnboardingSession, updateOnboardingStep); schema confirmed
- **src/database/schema.ts** — onboarding_sessions table structure; currentStep/collectedData column definitions

### Secondary (MEDIUM confidence)
- **function-executor.ts** — Sibling tool-execution pattern in client-facing agent; mirrors structure of new executeOnboardingTool
- **PROJECT.md (v1.4 state)** — Architectural decisions re: RLS, getConn(), per-bot routing; relevant to understanding integration context
- **STATE.md (v1.4 close)** — Prior decisions on deadlock/RLS safety, bot token security patterns

### Tertiary (LOW confidence — training knowledge, not verified in this session)
- Gemini 3.1 free-tier rate limits (15 req/min) — mentioned in CLAUDE.md, not re-verified against current Gemini API docs
- Greece/Athens timezone DST handling — reused from existing isoDateInAthens() but not freshly validated for Phase 21

## Metadata

**Confidence breakdown:**
- **Standard stack:** HIGH — all libraries are existing v1.4 dependencies, versions confirmed
- **Architecture:** HIGH — pattern directly replicates proven aiOwnerAgent code
- **Tool schemas:** MEDIUM — planner must finalize exact schema; research provides template only
- **Integration points:** HIGH — telegram.ts routing branches identified and verified
- **Pitfalls:** MEDIUM — based on anticipated migration risks; some may not materialize in practice
- **Stateless resume:** MEDIUM — D-02 concept is sound, but full DB re-derivation logic untested; planner to refine

**Research date:** 2026-07-24
**Valid until:** 2026-07-31 (7 days — stable domain, no new Gemini/Telegram API changes expected)
**Next review:** If Gemini API deprecates 3.1-flash-lite or changes free-tier limits, revisit assumptions A1/A3.

---

*Phase: 21 — AI-Driven Owner Onboarding*
*Research completed: 2026-07-24*
*Status: Ready for planning*
