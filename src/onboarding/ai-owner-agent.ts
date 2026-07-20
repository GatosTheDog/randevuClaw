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
  listBookingsForDate,
  findServiceById,
  withBusinessContext,
} from '../database/queries';
import { logger } from '../utils/logger';
import {
  handleCreatePackage,
  handleListPackages,
  handleDeactivatePackage,
  handleViewClientMembership,
  handleSetEnforcementPolicy,
  CreatePackageResult,
} from '../billing/tools';
import { showClientSelection } from '../telegram/handlers/payment-flow';
import { sendTelegramMessageWithKeyboard } from '../telegram/client';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const MAX_TOOL_ROUNDS = 5;

const GREEK_WEEKDAYS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

export const OWNER_TOOLS = [
  {
    type: 'function' as const,
    name: 'update_hours',
    description: 'Ενημερώνει το ωράριο λειτουργίας για μια συγκεκριμένη ημέρα. Χρησιμοποίησε αυτό για να αλλάξεις ώρες ανοίγματος/κλεισίματος.',
    parameters: {
      type: 'object',
      properties: {
        day_of_week: { type: 'integer', description: '0=Κυριακή, 1=Δευτέρα, 2=Τρίτη, 3=Τετάρτη, 4=Πέμπτη, 5=Παρασκευή, 6=Σάββατο' },
        open_time: { type: 'string', description: 'Ώρα ανοίγματος σε μορφή HH:MM (24ωρη)' },
        close_time: { type: 'string', description: 'Ώρα κλεισίματος σε μορφή HH:MM (24ωρη)' },
      },
      required: ['day_of_week', 'open_time', 'close_time'],
    },
  },
  {
    type: 'function' as const,
    name: 'close_day',
    description: 'Ορίζει μια ημέρα ως κλειστή (δεν λειτουργεί η επιχείρηση).',
    parameters: {
      type: 'object',
      properties: {
        day_of_week: { type: 'integer', description: '0=Κυριακή, 1=Δευτέρα, 2=Τρίτη, 3=Τετάρτη, 4=Πέμπτη, 5=Παρασκευή, 6=Σάββατο' },
      },
      required: ['day_of_week'],
    },
  },
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
  {
    type: 'function' as const,
    name: 'update_service_price',
    description: 'Αλλάζει την τιμή μιας υπηρεσίας.',
    parameters: {
      type: 'object',
      properties: {
        service_name: { type: 'string', description: 'Όνομα υπηρεσίας (partial match OK)' },
        new_price_cents: { type: 'integer', description: 'Νέα τιμή σε λεπτά ευρώ' },
      },
      required: ['service_name', 'new_price_cents'],
    },
  },
  {
    type: 'function' as const,
    name: 'delete_service',
    description: 'Διαγράφει υπηρεσία από την επιχείρηση.',
    parameters: {
      type: 'object',
      properties: {
        service_name: { type: 'string', description: 'Όνομα υπηρεσίας (partial match OK)' },
      },
      required: ['service_name'],
    },
  },
  {
    type: 'function' as const,
    name: 'view_todays_schedule',
    description: 'Εμφανίζει τα ραντεβού της σημερινής ημέρας.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  // ---------------------------------------------------------------------------
  // Phase 7: Billing tools (D-07)
  // ---------------------------------------------------------------------------
  {
    type: 'function' as const,
    name: 'create_package',
    description:
      'Δημιουργεί νέο πακέτο μαθημάτων για την επιχείρηση. Χρησιμοποιείται όταν ο ιδιοκτήτης θέλει να ορίσει νέο πακέτο με τιμή, διάρκεια και αριθμό συνεδριών.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: "Όνομα πακέτου, π.χ. 'Μηνιαίο', 'Εισαγωγικό'",
        },
        price_cents: {
          type: 'integer',
          description: 'Τιμή σε λεπτά ευρώ, π.χ. 8000 για €80,00',
        },
        valid_days: {
          type: 'integer',
          description: 'Ημέρες ισχύος, π.χ. 30',
        },
        session_count: {
          type: 'integer',
          nullable: true,
          description:
            'Αριθμός συνεδριών. Null/απών για απεριόριστες — αναγνωρίζεται από λέξεις: απεριόριστες, απεριόριστο, χωρίς όριο, unlimited',
        },
      },
      required: ['name', 'price_cents', 'valid_days', 'session_count'],
    },
  },
  {
    type: 'function' as const,
    name: 'list_packages',
    description: 'Εμφανίζει όλα τα ενεργά πακέτα της επιχείρησης.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    type: 'function' as const,
    name: 'deactivate_package',
    description:
      'Απενεργοποιεί ένα πακέτο (υπάρχουσες συνδρομές δεν επηρεάζονται). Το πακέτο δεν εμφανίζεται πλέον σε νέες πληρωμές.',
    parameters: {
      type: 'object',
      properties: {
        package_id: {
          type: 'integer',
          description: 'ID του πακέτου που θα απενεργοποιηθεί',
        },
      },
      required: ['package_id'],
    },
  },
  {
    type: 'function' as const,
    name: 'record_payment',
    description:
      'Ξεκινά τη ροή καταγραφής πληρωμής — εμφανίζει πλήκτρα επιλογής πελάτη και πακέτου. Χρησιμοποιείται όταν ο ιδιοκτήτης αναφέρει πληρωμή ή αγορά πακέτου.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    type: 'function' as const,
    name: 'view_client_membership',
    description:
      'Εμφανίζει την ενεργή συνδρομή ενός πελάτη — υπόλοιπο συνεδριών και ημερομηνία λήξης.',
    parameters: {
      type: 'object',
      properties: {
        client_phone: {
          type: 'string',
          description: 'Τηλέφωνο ή Telegram ID του πελάτη',
        },
      },
      required: ['client_phone'],
    },
  },
  // ---------------------------------------------------------------------------
  // Phase 8: Enforcement policy tool (ENFC-01)
  // ---------------------------------------------------------------------------
  {
    type: 'function' as const,
    name: 'set_enforcement_policy',
    description:
      'Ορίζει την πολιτική κρατήσεων για πελάτες χωρίς ενεργή συνδρομή: "block" = μπλοκάρει (αρνείται κράτηση), "flag" = επιτρέπει αλλά ειδοποιεί τον ιδιοκτήτη, "allow" = επιτρέπει πάντα (προεπιλογή).',
    parameters: {
      type: 'object',
      properties: {
        policy: {
          type: 'string',
          enum: ['allow', 'block', 'flag'],
          description: 'Πολιτική εφαρμογής: allow | block | flag',
        },
      },
      required: ['policy'],
    },
  },
];

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildOwnerSystemPrompt(
  business: Business,
  svcList: Service[],
  hoursList: BusinessHours[],
  today: string
): string {
  const svcText = svcList.length
    ? svcList.map((s) => `- ${s.name}: ${s.price != null ? (s.price / 100).toFixed(2) + '€' : 'χωρίς τιμή'}, ${s.durationMin} λεπτά`).join('\n')
    : '(καμία υπηρεσία)';

  const hoursText = hoursList.length
    ? hoursList
        .slice()
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
    `Είσαι ο διαχειριστικός βοηθός του ιδιοκτήτη της επιχείρησης "${business.name}".`,
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
    '- Μπορείς να αλλάξεις ωράρια, να προσθέσεις/αλλάξεις/διαγράψεις υπηρεσίες, και να δεις το πρόγραμμα της ημέρας.',
    '- Αν δεν καταλαβαίνεις τι θέλει ο ιδιοκτήτης, ρώτησέ τον συνοπτικά.',
    '- Μην κάνεις ενέργειες εκτός των παραπάνω εργαλείων.',
    '- Για αλλαγή τιμής ή διαγραφή υπηρεσίας, αν δεν βρίσκεις ακριβές match ονόματος, κάνε partial match (case-insensitive).',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

interface ToolArgs {
  // Existing scheduling / service fields
  day_of_week?: number;
  open_time?: string;
  close_time?: string;
  name?: string;
  price_cents?: number;
  duration_min?: number;
  service_name?: string;
  new_price_cents?: number;
  // Phase 7: billing fields (D-07)
  valid_days?: number;
  session_count?: number | null;
  package_id?: number;
  client_phone?: string;
  // Phase 8: enforcement policy (ENFC-01)
  policy?: string;
}

/**
 * Executes a Gemini-dispatched owner tool and returns a Greek string to feed
 * back to Gemini as the function result.
 *
 * D-08 / D-03 special case: create_package and record_payment send their own
 * Telegram messages (keyboard or direct reply) and return '' (empty string).
 * The Gemini loop treats '' as a signal to break immediately — the caller must
 * NOT send an additional reply when the return value is ''.
 */
async function executeOwnerTool(
  toolName: string,
  args: ToolArgs,
  business: Business,
  svcList: Service[],
  today: string,
  ownerTelegramId: string
): Promise<string> {
  switch (toolName) {
    case 'update_hours': {
      const { day_of_week, open_time, close_time } = args;
      if (day_of_week === undefined || !open_time || !close_time) return 'Μη έγκυρα δεδομένα.';
      await db
        .insert(businessHours)
        .values({ businessId: business.id, dayOfWeek: day_of_week, openTime: open_time, closeTime: close_time, isClosed: false })
        .onConflictDoUpdate({
          target: [businessHours.businessId, businessHours.dayOfWeek],
          set: { openTime: open_time, closeTime: close_time, isClosed: false },
        });
      return `OK: ${GREEK_WEEKDAYS[day_of_week]} ${open_time}–${close_time}`;
    }

    case 'close_day': {
      const { day_of_week } = args;
      if (day_of_week === undefined) return 'Μη έγκυρη ημέρα.';
      await db
        .insert(businessHours)
        .values({ businessId: business.id, dayOfWeek: day_of_week, openTime: '00:00', closeTime: '00:00', isClosed: true })
        .onConflictDoUpdate({
          target: [businessHours.businessId, businessHours.dayOfWeek],
          set: { isClosed: true },
        });
      return `OK: ${GREEK_WEEKDAYS[day_of_week]} ορίστηκε ως κλειστή`;
    }

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

    case 'update_service_price': {
      const { service_name, new_price_cents } = args;
      if (!service_name || new_price_cents === undefined) return 'Μη έγκυρα δεδομένα.';
      const match = svcList.find((s) => s.name.toLowerCase().includes(service_name.toLowerCase()));
      if (!match) return `Δεν βρέθηκε υπηρεσία με όνομα "${service_name}".`;
      await db.update(services).set({ price: new_price_cents }).where(eq(services.id, match.id));
      return `OK: τιμή "${match.name}" → ${(new_price_cents / 100).toFixed(2)}€`;
    }

    case 'delete_service': {
      const { service_name } = args;
      if (!service_name) return 'Μη έγκυρο όνομα.';
      const match = svcList.find((s) => s.name.toLowerCase().includes(service_name.toLowerCase()));
      if (!match) return `Δεν βρέθηκε υπηρεσία με όνομα "${service_name}".`;
      await db.delete(services).where(eq(services.id, match.id));
      return `OK: υπηρεσία "${match.name}" διαγράφηκε`;
    }

    case 'view_todays_schedule': {
      const todayBookings = await listBookingsForDate(
        business.id,
        today,
        ['pending_owner_approval', 'confirmed']
      );
      if (todayBookings.length === 0) return 'Δεν υπάρχουν ραντεβού σήμερα.';
      const lines = await Promise.all(
        todayBookings.map(async (b) => {
          const svc = await findServiceById(b.serviceId, business.id).catch(() => null);
          const svcName = svc?.name ?? `υπηρεσία #${b.serviceId}`;
          const statusLabel = b.bookingStatus === 'confirmed' ? '✅' : '⏳';
          return `${statusLabel} ${b.calendarTime} — ${svcName} (${b.clientPhone})`;
        })
      );
      return lines.join('\n');
    }

    // -----------------------------------------------------------------------
    // Phase 7: Billing tool cases (D-07, D-03, D-08)
    // -----------------------------------------------------------------------

    case 'create_package': {
      // D-03: handleCreatePackage inserts with isActive:false (pending confirmation).
      // If Gemini-parsed args are valid, returns CreatePackageResult with confirmation
      // text + pendingPackageId. If invalid, returns a Greek error string.
      const result = await handleCreatePackage(business.id, args as Record<string, unknown>);
      if (typeof result === 'object' && result !== null && 'pendingPackageId' in result) {
        const pkgResult = result as CreatePackageResult;
        // Send Ναι/Όχι confirmation keyboard directly to the owner (D-03).
        // Return '' so the Gemini loop breaks and no extra reply is sent.
        await sendTelegramMessageWithKeyboard(ownerTelegramId, pkgResult.confirmationText, [
          [
            { text: '✅ Ναι', callback_data: `billing:pkg_confirm:${pkgResult.pendingPackageId}` },
            { text: '❌ Όχι', callback_data: `billing:pkg_cancel:${pkgResult.pendingPackageId}` },
          ],
        ]);
        return '';
      }
      // Zod validation failed — return the Greek error string to Gemini
      return result as string;
    }

    case 'list_packages': {
      // Wrap in withBusinessContext so RLS enforcement applies (T-07-03)
      return withBusinessContext(business.id, () => handleListPackages(business.id));
    }

    case 'deactivate_package': {
      return handleDeactivatePackage(Number(args.package_id));
    }

    case 'record_payment': {
      // D-08: Gemini detected payment intent → switch to inline keyboard flow.
      // showClientSelection sends the keyboard directly; return '' to break the loop.
      await showClientSelection(business.id, ownerTelegramId);
      return '';
    }

    case 'view_client_membership': {
      const clientPhone = String(args.client_phone ?? '');
      // Wrap in withBusinessContext so RLS enforcement applies (T-07-03)
      return withBusinessContext(business.id, () =>
        handleViewClientMembership(business.id, clientPhone)
      );
    }

    // -----------------------------------------------------------------------
    // Phase 8: Enforcement policy case (ENFC-01 / T-08-12)
    // -----------------------------------------------------------------------

    case 'set_enforcement_policy': {
      // withBusinessContext ensures the UPDATE on businesses runs under RLS
      // for the correct tenant — T-08-12 mitigation (bypassing withBusinessContext
      // would let the UPDATE run as admin db user, breaking tenant isolation).
      return withBusinessContext(business.id, () =>
        handleSetEnforcementPolicy(business.id, args as Record<string, unknown>)
      );
    }

    default:
      return `Άγνωστο εργαλείο: ${toolName}`;
  }
}

// ---------------------------------------------------------------------------
// Gemini types (mirror ai-agent.ts)
// ---------------------------------------------------------------------------

interface GeminiCreateParams {
  model: string;
  input: string | GeminiFunctionResultInput[];
  tools: typeof OWNER_TOOLS;
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

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function aiOwnerAgent(
  business: Business,
  ownerTelegramId: string,
  messageText: string,
  today: string
): Promise<string> {
  const svcList = await listServicesForBusiness(business.id);
  const hoursList = await listBusinessHours(business.id);
  const systemInstruction = buildOwnerSystemPrompt(business, svcList, hoursList, today);

  let input: string | GeminiFunctionResultInput[] = messageText;
  let currentInteractionId: string | undefined;
  let round = 0;

  while (true) {
    if (++round > MAX_TOOL_ROUNDS) {
      logger.error({ businessId: business.id, ownerTelegramId }, 'aiOwnerAgent exceeded MAX_TOOL_ROUNDS');
      return 'Συγγνώμη, κάτι πήγε στραβά. Δοκιμάστε ξανά.';
    }

    let interaction: GeminiInteractionResult;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    const functionResults: GeminiFunctionResultInput[] = [];
    for (const call of functionCalls) {
      const result = await executeOwnerTool(
        call.name,
        call.arguments as ToolArgs,
        business,
        svcList,
        today,
        ownerTelegramId
      );
      logger.info(
        { businessId: business.id, tool: call.name, result: result || '(keyboard sent)' },
        'Owner tool executed'
      );

      // D-03 / D-08: '' signals the tool already sent its own Telegram message
      // (keyboard or direct reply). Break the Gemini loop immediately — the
      // caller must NOT send an additional reply when this function returns ''.
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
