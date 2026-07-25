import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { listServicesForBusiness, listBusinessHours, Business, Service, BusinessHours } from '../database/queries';
import { executeTool } from './function-executor';
import { logger } from '../utils/logger';

// Bounds the Gemini HTTP call to 25s so a stalled booking-conversation response
// rejects instead of hanging silently — the existing try/catch already logs
// + returns a Greek fallback message on rejection.
const ai = new GoogleGenAI({ apiKey: config.geminiApiKey, httpOptions: { timeout: 25000 } });

const GEMINI_MODEL = 'gemini-3.1-flash-lite';

// CR-01: generous upper bound for a single conversation turn; prevents a
// stuck Gemini tool-call loop from hanging the webhook request that awaits it.
const MAX_TOOL_ROUNDS = 6;

export const RATE_LIMIT_REPLY_GREEK =
  'Έχουμε μεγάλη κίνηση αυτή τη στιγμή. Δοκιμάστε ξανά σε λίγα λεπτά.';

// Debug (webhook-hang-no-reply): previously, any non-429 error from
// callGeminiWithRetry (including the TimeoutError the per-call { timeout,
// maxRetries: 0 } fix now deterministically produces) propagated straight
// out of aiBookingAgent, up through routeConversationMessage, and was
// swallowed by handleFoundBusiness's catch (src/webhooks/telegram.ts) with
// only a log line — the client got ZERO reply. That is a plausible
// explanation for "0 responses" recurring even with the Gemini-call fix
// deployed: the call now fails FAST instead of hanging forever, but nothing
// downstream ever tells the client anything failed. aiOwnerAgent and
// aiOnboardingAgent already had this exact fallback for their own Gemini
// call; aiBookingAgent (the client-facing path) did not. Mirrored here so
// the client-facing path is no longer the odd one out.
export const AGENT_ERROR_REPLY_GREEK = 'Το σύστημα δεν απόκρινε. Δοκιμάστε ξανά σε λίγο.';

class GeminiRateLimitError extends Error {
  constructor() {
    super('Gemini rate limit exceeded after retries');
    this.name = 'GeminiRateLimitError';
  }
}

export interface AiAgentResult {
  text: string;
  interactionId: string | null;
  requestId: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
}

// Tool schemas deliberately omit any field the server already knows
// (business_id is echoed back by the AI for defense-in-depth cross-tenant
// checking in function-executor.ts; client_phone/request_id are NEVER
// LLM-supplied — injecting them via ToolContext instead closes a
// spoofing/idempotency-bypass vector).
const BOOKING_TOOLS = [
  {
    type: 'function' as const,
    name: 'check_availability',
    description: 'Ελέγχει διαθέσιμα ραντεβού για μια υπηρεσία σε συγκεκριμένη ημερομηνία.',
    parameters: {
      type: 'object',
      properties: {
        business_id: { type: 'integer', description: 'Το αναγνωριστικό της επιχείρησης' },
        service_id: { type: 'integer', description: 'Το αναγνωριστικό της υπηρεσίας' },
        calendar_date: { type: 'string', description: 'Ημερομηνία σε μορφή YYYY-MM-DD' },
      },
      required: ['business_id', 'service_id', 'calendar_date'],
    },
  },
  {
    type: 'function' as const,
    name: 'book_appointment',
    description: 'Δημιουργεί νέο ραντεβού σε αναμονή έγκρισης από την επιχείρηση.',
    parameters: {
      type: 'object',
      properties: {
        business_id: { type: 'integer', description: 'Το αναγνωριστικό της επιχείρησης' },
        service_id: { type: 'integer', description: 'Το αναγνωριστικό της υπηρεσίας' },
        calendar_date: { type: 'string', description: 'Ημερομηνία σε μορφή YYYY-MM-DD' },
        calendar_time: { type: 'string', description: 'Ώρα σε 24ωρη μορφή HH:MM' },
      },
      required: ['business_id', 'service_id', 'calendar_date', 'calendar_time'],
    },
  },
  {
    type: 'function' as const,
    name: 'cancel_appointment',
    description: 'Ακυρώνει υπάρχον ραντεβού του πελάτη.',
    parameters: {
      type: 'object',
      properties: {
        business_id: { type: 'integer', description: 'Το αναγνωριστικό της επιχείρησης' },
        booking_id: { type: 'integer', description: 'Το αναγνωριστικό του ραντεβού' },
      },
      required: ['business_id', 'booking_id'],
    },
  },
  {
    type: 'function' as const,
    name: 'reschedule_appointment',
    description: 'Μετατοπίζει υπάρχον ραντεβού του πελάτη σε νέα ημερομηνία/ώρα (ή υπηρεσία).',
    parameters: {
      type: 'object',
      properties: {
        business_id: { type: 'integer', description: 'Το αναγνωριστικό της επιχείρησης' },
        booking_id: { type: 'integer', description: 'Το αναγνωριστικό του υπάρχοντος ραντεβού' },
        service_id: { type: 'integer', description: 'Το αναγνωριστικό της νέας υπηρεσίας' },
        calendar_date: { type: 'string', description: 'Νέα ημερομηνία σε μορφή YYYY-MM-DD' },
        calendar_time: { type: 'string', description: 'Νέα ώρα σε 24ωρη μορφή HH:MM' },
      },
      required: ['business_id', 'booking_id', 'service_id', 'calendar_date', 'calendar_time'],
    },
  },
  {
    type: 'function' as const,
    name: 'list_client_bookings',
    description: 'Επιστρέφει τις ενεργές κρατήσεις του πελάτη (σε αναμονή ή επιβεβαιωμένες). Κάλεσέ το όταν ο πελάτης θέλει να δει τις κρατήσεις του ή πριν ακυρώσεις/αλλάξεις ραντεβού χωρίς να ξέρεις το booking_id.',
    parameters: {
      type: 'object',
      properties: {
        business_id: { type: 'integer', description: 'Το αναγνωριστικό της επιχείρησης' },
      },
      required: ['business_id'],
    },
  },
  {
    type: 'function' as const,
    name: 'check_membership_balance',
    description: 'Ελέγχει το υπόλοιπο συνδρομής του πελάτη — αριθμός εναπομεινάντων μαθημάτων και ημερομηνία λήξης.',
    parameters: {
      type: 'object',
      properties: {
        business_id: { type: 'integer', description: 'Το αναγνωριστικό της επιχείρησης' },
      },
      required: ['business_id'],
    },
  },
  // Phase 11: session booking tools (SBOK-01, SBOK-03, SBOK-04)
  {
    type: 'function' as const,
    name: 'list_sessions_for_client',
    description: 'Επιστρέφει τα επερχόμενα διαθέσιμα μαθήματα της επιχείρησης που μπορεί να κλείσει ο πελάτης. Κάλεσέ το πριν από το book_session αν ο πελάτης δεν γνωρίζει τις ακριβείς λεπτομέρειες του μαθήματος.',
    parameters: {
      type: 'object',
      properties: {
        business_id: { type: 'integer', description: 'Αναγνωριστικό επιχείρησης' },
      },
      required: ['business_id'],
    },
  },
  {
    type: 'function' as const,
    name: 'book_session',
    description: 'Κλείνει συγκεκριμένο μάθημα για τον πελάτη. Χρησιμοποίησε list_sessions_for_client αν χρειάζεσαι να βρεις το ακριβές session_instance_id. Αν allow_multi_booking είναι ενεργό, μπορείς να στείλεις λίστα session_instance_ids για πολλαπλές κρατήσεις μαζί.',
    parameters: {
      type: 'object',
      properties: {
        business_id: { type: 'integer' },
        session_instance_id: { type: 'integer', description: 'ID του συγκεκριμένου μαθήματος από list_sessions_for_client' },
        session_instance_ids: { type: 'array', items: { type: 'integer' }, description: 'Λίστα session instance IDs για πολλαπλές κρατήσεις (μόνο αν allow_multi_booking=true)' },
      },
      required: ['business_id'],
    },
  },
  {
    type: 'function' as const,
    name: 'reschedule_session',
    description: 'Αλλάζει μια κράτηση μαθήματος σε διαφορετικό μάθημα. Ελέγχει αν το νέο μάθημα είναι εντός ισχύος της συνδρομής του πελάτη.',
    parameters: {
      type: 'object',
      properties: {
        business_id: { type: 'integer' },
        booking_id: { type: 'integer', description: 'ID της υπάρχουσας κράτησης' },
        new_session_instance_id: { type: 'integer', description: 'ID του νέου μαθήματος' },
      },
      required: ['business_id', 'booking_id', 'new_session_instance_id'],
    },
  },
];

const GREEK_WEEKDAYS = [
  'Κυριακή',
  'Δευτέρα',
  'Τρίτη',
  'Τετάρτη',
  'Πέμπτη',
  'Παρασκευή',
  'Σάββατο',
];

function formatServiceLine(service: Service): string {
  const price = service.price === null ? '' : ` (€${(service.price / 100).toFixed(2)})`;
  return `${service.id}. ${service.name} — ${service.durationMin} λεπτά${price}`;
}

function formatHoursLine(hours: BusinessHours): string {
  const label = hours.isClosed ? 'Κλειστά' : `${hours.openTime}-${hours.closeTime}`;
  return `${GREEK_WEEKDAYS[hours.dayOfWeek]}: ${label}`;
}

function buildSystemInstruction(
  business: Business,
  services: Service[],
  businessHours: BusinessHours[]
): string {
  const servicesList = services.map(formatServiceLine).join('\n');
  const hoursList = businessHours
    .slice()
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
    .map(formatHoursLine)
    .join('\n');

  const rules: string[] = [
    '- Μιλάς πάντα Ελληνικά, με ζεστό και φιλικό τόνο, ποτέ ρομποτικό ύφος.',
    '- ΠΟΤΕ μην αναφέρεις υπηρεσία, τιμή ή ωράριο που δεν υπάρχει στα παραπάνω στοιχεία.',
    "- Όταν δημιουργείς ή αλλάζεις ραντεβού, ΠΟΤΕ μην πεις ότι επιβεβαιώθηκε — μόνο ότι είναι σε αναμονή έγκρισης από την επιχείρηση, ΜΗΝ χρησιμοποιήσεις τη λέξη 'επιβεβαιώθηκε' μέχρι να το πει το ίδιο το σύστημα.",
    '- Πριν καλέσεις book_appointment ή reschedule_appointment, κάλεσε πάντα πρώτα check_availability για το ίδιο slot.',
    '- Όταν ο πελάτης θέλει να δει τις κρατήσεις του, να ακυρώσει ή να αλλάξει ραντεβού χωρίς να αναφέρει booking_id, κάλεσε πρώτα list_client_bookings για να δεις τι έχει και ρώτησέ τον ποιο ραντεβού εννοεί.',
    '- Αν το αίτημα είναι εκτός θέματος (όχι σχετικό με ραντεβού ή την επιχείρηση), αρνήσου ευγενικά χωρίς να προσπαθήσεις να βοηθήσεις εκτός θέματος.',
    `- Χρησιμοποίησε πάντα business_id=${business.id} σε κάθε κλήση εργαλείου.`,
  ];

  // Phase 11 (CLSS-01/SBOK-01): fixed_sessions mode — redirect Gemini to session tools
  if (business.bookingMode === 'fixed_sessions') {
    const sessionRules = [
      '- Αυτή η επιχείρηση λειτουργεί με ΣΤΑΘΕΡΑ ΜΑΘΗΜΑΤΑ. Χρησιμοποίησε list_sessions_for_client για να δεις τα διαθέσιμα μαθήματα και book_session για να κλείσεις.',
      '- ΜΗΝ χρησιμοποιείς check_availability ή book_appointment για κρατήσεις — χρησιμοποίησε ΜΟΝΟ book_session.',
      ...(business.allowMultiBooking
        ? ['- Ο πελάτης μπορεί να κλείσει ΠΟΛΛΑΠΛΑ μαθήματα σε ένα μήνυμα — χρησιμοποίησε session_instance_ids (λίστα) αντί για session_instance_id.']
        : []),
    ];
    rules.push(...sessionRules);
  }

  return [
    `Είσαι ο ψηφιακός βοηθός κρατήσεων της επιχείρησης "${business.name}".`,
    '',
    'Διαθέσιμες υπηρεσίες:',
    servicesList,
    '',
    'Ωράριο λειτουργίας:',
    hoursList,
    '',
    'Κανόνες:',
    rules.join('\n'),
  ].join('\n');
}

function is429(err: unknown): boolean {
  const status =
    (err as { status?: number } | null | undefined)?.status ??
    (err as { error?: { status?: number } } | null | undefined)?.error?.status;
  return status === 429;
}

// Debug (webhook-hang-no-reply): distinguishes a bounded per-call timeout
// rejection (the fix this session verifies is finally taking effect) from
// any other Gemini-side error, so fly logs can immediately tell the two
// apart instead of requiring another investigation cycle.
function isTimeoutError(err: unknown): boolean {
  const name = (err as { name?: string } | null | undefined)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

// NOTE ON SDK SHAPE (deviation from AI-SPEC's illustrative pseudocode, Rule 1
// bug fix): the plan's pseudocode used camelCase field names
// (`systemInstruction`, top-level `temperature`/`max_output_tokens`/`top_p`).
// The actually-installed @google/genai@2.10.0 SDK's real
// `ai.interactions.create()` signature uses snake_case
// (`system_instruction`, `previous_interaction_id`) and nests sampling
// params under `generation_config`. Verified directly against
// node_modules/@google/genai/dist/node/node.d.ts. The internal
// Interaction/Step/Tool types are not exported from the package, so this
// module defines its own minimal structural types for what it reads/writes
// and casts at the single SDK call-site — everything else in this module is
// fully typed against those local types.
interface GeminiCreateParams {
  model: string;
  input: string | GeminiFunctionResultInput[];
  tools: typeof BOOKING_TOOLS;
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

async function callGeminiWithRetry(
  params: GeminiCreateParams,
  sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  logCtx: Record<string, unknown> = {}
): Promise<GeminiInteractionResult> {
  const maxAttempts = 4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const startedAt = Date.now();
    logger.info({ ...logCtx, attempt }, 'callGeminiWithRetry: calling ai.interactions.create()');
    try {
      // NOTE: the 25s httpOptions.timeout passed at `new GoogleGenAI({...})`
      // construction (cbb7310) does NOT bound this call — @google/genai's
      // `ai.interactions` getter builds a separate internal client that never
      // inherits client-level httpOptions (verified against
      // node_modules/@google/genai/dist/node/index.mjs: only
      // getNextGenClient(), which .interactions never calls, forwards it).
      // The per-call RequestOptions below IS honored by this SDK's
      // interactions.create() request path (empirically verified against a
      // hanging local server) — this is what actually bounds the call.
      // maxRetries: 0 is required alongside timeout: without it, the SDK's
      // own internal retry-with-backoff re-attempts a timed-out request
      // several times (observed 5 attempts / ~16.5s wall time for a
      // configured 2s timeout), which would defeat the purpose of bounding a
      // webhook-request-scoped call. This app already has its own retry
      // layer above (callGeminiWithRetry, for 429s only) — a single bounded
      // attempt here keeps the total worst-case latency deterministic.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await ai.interactions.create(params as any, { timeout: 25000, maxRetries: 0 });
      const elapsedMs = Date.now() - startedAt;
      logger.info({ ...logCtx, attempt, elapsedMs }, 'callGeminiWithRetry: ai.interactions.create() returned');
      return result as unknown as GeminiInteractionResult;
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      logger.error(
        { ...logCtx, attempt, elapsedMs, err, timedOut: isTimeoutError(err), is429: is429(err) },
        'callGeminiWithRetry: ai.interactions.create() rejected'
      );
      if (!is429(err)) throw err;
      if (attempt === maxAttempts - 1) {
        throw new GeminiRateLimitError();
      }
      const delayMs = 2 ** attempt * 1000 + Math.random() * 1000;
      await sleepFn(delayMs);
    }
  }
  // Unreachable — the loop above always either returns or throws.
  throw new GeminiRateLimitError();
}

export async function aiBookingAgent(
  userMessage: string,
  business: Business,
  clientPhone: string,
  previousInteractionId: string | null
): Promise<AiAgentResult> {
  const requestId = randomUUID();
  const agentStartedAt = Date.now();
  logger.info({ requestId, businessId: business.id, clientPhone }, 'aiBookingAgent: entry');

  const services = await listServicesForBusiness(business.id);
  const businessHours = await listBusinessHours(business.id);
  const systemInstruction = buildSystemInstruction(business, services, businessHours);

  const accumulatedToolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let input: string | GeminiFunctionResultInput[] = userMessage;
  let currentInteractionId: string | undefined = previousInteractionId ?? undefined;
  let round = 0;

  while (true) {
    if (++round > MAX_TOOL_ROUNDS) {
      logger.error({ requestId, round }, 'aiBookingAgent exceeded MAX_TOOL_ROUNDS, aborting turn');
      return {
        text: 'Συγγνώμη, κάτι πήγε στραβά. Δοκιμάστε ξανά.',
        interactionId: currentInteractionId ?? null,
        requestId,
        toolCalls: accumulatedToolCalls,
      };
    }

    let interaction: GeminiInteractionResult;
    try {
      interaction = await callGeminiWithRetry(
        {
          model: GEMINI_MODEL,
          input,
          tools: BOOKING_TOOLS,
          system_instruction: systemInstruction,
          previous_interaction_id: currentInteractionId,
          generation_config: {
            temperature: 0.7,
            max_output_tokens: 512,
            top_p: 0.95,
          },
        },
        undefined,
        { requestId, businessId: business.id, round }
      );
    } catch (err) {
      if (err instanceof GeminiRateLimitError) {
        logger.warn({ requestId, businessId: business.id, round }, 'aiBookingAgent: rate-limited after retries, returning fallback');
        return {
          text: RATE_LIMIT_REPLY_GREEK,
          interactionId: previousInteractionId ?? null,
          requestId,
          toolCalls: accumulatedToolCalls,
        };
      }
      // Debug (webhook-hang-no-reply): any other error (network failure,
      // TimeoutError from the bounded per-call timeout, malformed response,
      // etc.) previously propagated uncaught out of aiBookingAgent all the
      // way to handleFoundBusiness's catch in telegram.ts, which only logs
      // — the client received zero reply. Return a Greek fallback instead,
      // matching the pattern already used by aiOwnerAgent/aiOnboardingAgent
      // for their own Gemini call, so the client always gets SOME response.
      logger.error(
        { err, requestId, businessId: business.id, round, elapsedMs: Date.now() - agentStartedAt },
        'aiBookingAgent: unrecoverable Gemini call failure, returning fallback reply'
      );
      return {
        text: AGENT_ERROR_REPLY_GREEK,
        interactionId: currentInteractionId ?? null,
        requestId,
        toolCalls: accumulatedToolCalls,
      };
    }

    currentInteractionId = interaction.id;

    const functionCalls: Array<{ name: string; arguments: Record<string, unknown>; id: string }> = [];
    for (const step of interaction.steps ?? []) {
      if (step.type === 'function_call' && step.name && step.id) {
        functionCalls.push({ name: step.name, arguments: step.arguments ?? {}, id: step.id });
      }
    }

    if (functionCalls.length === 0) {
      if (!interaction.output_text) {
        logger.error(
          { requestId, round, interactionId: currentInteractionId, steps: interaction.steps },
          'Gemini returned no output_text and no function calls'
        );
      }
      logger.info(
        { requestId, businessId: business.id, round, elapsedMs: Date.now() - agentStartedAt },
        'aiBookingAgent: exit (final text, no more tool calls)'
      );
      return {
        text: interaction.output_text ?? 'Συγγνώμη, κάτι πήγε στραβά.',
        interactionId: currentInteractionId,
        requestId,
        toolCalls: accumulatedToolCalls,
      };
    }

    // Sequential, never Promise.all — parallel tool execution would allow
    // two concurrent book_appointment calls to race past each other before
    // either's DB write lands, defeating the slot-atomicity guarantee.
    const functionResults: GeminiFunctionResultInput[] = [];
    for (const call of functionCalls) {
      const idempotencyKey = `${requestId}:${call.id}`;
      const toolStartedAt = Date.now();
      logger.info({ requestId, businessId: business.id, tool: call.name }, 'aiBookingAgent: executeTool call');
      const result = await executeTool(call.name, call.arguments, {
        business: {
          id: business.id,
          name: business.name,
          ownerTelegramId: business.ownerTelegramId,
          enforcementPolicy: business.enforcementPolicy,
          bookingMode: business.bookingMode,
          allowMultiBooking: business.allowMultiBooking,
          cancellationCutoffEnabled: business.cancellationCutoffEnabled,
          cancellationCutoffHours: business.cancellationCutoffHours,
          slotlessRequestsEnabled: business.slotlessRequestsEnabled,
        },
        clientPhone,
        requestId,
        idempotencyKey,
      });
      logger.info(
        { requestId, businessId: business.id, tool: call.name, elapsedMs: Date.now() - toolStartedAt },
        'aiBookingAgent: executeTool returned'
      );
      accumulatedToolCalls.push({ name: call.name, args: call.arguments });
      functionResults.push({
        type: 'function_result',
        name: call.name,
        call_id: call.id,
        result: [{ type: 'text', text: JSON.stringify(result) }],
      });
    }

    input = functionResults;
  }
}
