import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { listServicesForBusiness, listBusinessHours, Business, Service, BusinessHours } from '../database/queries';
import { executeTool } from './function-executor';
import { logger } from '../utils/logger';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

const GEMINI_MODEL = 'gemini-2.5-flash-lite';

// CR-01: generous upper bound for a single conversation turn; prevents a
// stuck Gemini tool-call loop from hanging the webhook request that awaits it.
const MAX_TOOL_ROUNDS = 6;

export const RATE_LIMIT_REPLY_GREEK =
  'Έχουμε μεγάλη κίνηση αυτή τη στιγμή. Δοκιμάστε ξανά σε λίγα λεπτά.';

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
    description: 'Επιστρέφει τις επερχόμενες διαθέσιμες σεζόν της επιχείρησης που μπορεί να κλείσει ο πελάτης. Κάλεσέ το πριν από το book_session αν ο πελάτης δεν γνωρίζει τις ακριβείς λεπτομέρειες της σεζόν.',
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
    description: 'Κλείνει συγκεκριμένη σεζόν για τον πελάτη. Χρησιμοποίησε list_sessions_for_client αν χρειάζεσαι να βρεις το ακριβές session_instance_id. Αν allow_multi_booking είναι ενεργό, μπορείς να στείλεις λίστα session_instance_ids για πολλαπλές κρατήσεις μαζί.',
    parameters: {
      type: 'object',
      properties: {
        business_id: { type: 'integer' },
        session_instance_id: { type: 'integer', description: 'ID της συγκεκριμένης σεζόν από list_sessions_for_client' },
        session_instance_ids: { type: 'array', items: { type: 'integer' }, description: 'Λίστα session instance IDs για πολλαπλές κρατήσεις (μόνο αν allow_multi_booking=true)' },
      },
      required: ['business_id'],
    },
  },
  {
    type: 'function' as const,
    name: 'reschedule_session',
    description: 'Αλλάζει μια κράτηση σεζόν σε διαφορετική σεζόν. Ελέγχει αν η νέα σεζόν είναι εντός ισχύος της συνδρομής του πελάτη.',
    parameters: {
      type: 'object',
      properties: {
        business_id: { type: 'integer' },
        booking_id: { type: 'integer', description: 'ID της υπάρχουσας κράτησης' },
        new_session_instance_id: { type: 'integer', description: 'ID της νέας σεζόν' },
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
      '- Αυτή η επιχείρηση λειτουργεί με ΣΤΑΘΕΡΕΣ ΣΕΖΟΝ. Χρησιμοποίησε list_sessions_for_client για να δεις τις διαθέσιμες σεζόν και book_session για να κλείσεις.',
      '- ΜΗΝ χρησιμοποιείς check_availability ή book_appointment για κρατήσεις — χρησιμοποίησε ΜΟΝΟ book_session.',
      ...(business.allowMultiBooking
        ? ['- Ο πελάτης μπορεί να κλείσει ΠΟΛΛΑΠΛΕΣ σεζόν σε ένα μήνυμα — χρησιμοποίησε session_instance_ids (λίστα) αντί για session_instance_id.']
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
  sleepFn: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<GeminiInteractionResult> {
  const maxAttempts = 4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await ai.interactions.create(params as any);
      return result as unknown as GeminiInteractionResult;
    } catch (err) {
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
      interaction = await callGeminiWithRetry({
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
      });
    } catch (err) {
      if (err instanceof GeminiRateLimitError) {
        return {
          text: RATE_LIMIT_REPLY_GREEK,
          interactionId: previousInteractionId ?? null,
          requestId,
          toolCalls: accumulatedToolCalls,
        };
      }
      throw err;
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
      const result = await executeTool(call.name, call.arguments, {
        business: {
          id: business.id,
          name: business.name,
          ownerTelegramId: business.ownerTelegramId,
          enforcementPolicy: business.enforcementPolicy,
          bookingMode: business.bookingMode,
          allowMultiBooking: business.allowMultiBooking,
        },
        clientPhone,
        requestId,
        idempotencyKey,
      });
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
