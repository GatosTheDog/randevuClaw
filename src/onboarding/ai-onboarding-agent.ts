import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config';
import { businesses, businessHours, services } from '../database/schema';
import { db } from '../database/db';
import {
  Business,
  Service,
  BusinessHours,
  listServicesForBusiness,
  listBusinessHours,
  withBusinessContext,
  getConn,
} from '../database/queries';
import { generateSlug } from '../database/seed';
import { logger } from '../utils/logger';
import {
  handleSetCancellationCutoff,
  handleSetLastSessionThreshold,
} from '../billing/tools';
import { createSessionCatalogWithExpansion, buildRRuleString, listSessions } from '../session/manager';
import { sendTelegramMessage, registerBotWebhook, unregisterBotWebhook } from '../telegram/client';
import { activateBusiness } from './queries';
import { GEMINI_MODEL } from './ai-owner-agent';

// ---------------------------------------------------------------------------
// D-01/D-02 constants
// ---------------------------------------------------------------------------

/**
 * Exact placeholder name/slug scripts/create-business.ts inserts when a
 * business row is bootstrapped ahead of guided onboarding (see
 * scripts/create-business.ts createBusinessForOnboarding call). Used to
 * detect "the owner hasn't set a name yet" without any extra DB flag (D-02:
 * stateless resume — completeness is always re-derived from current data).
 */
const PLACEHOLDER_BUSINESS_NAME = 'New Business (onboarding)';

/**
 * Greek day names keyed by JS Date.getDay() index (0=Sunday..6=Saturday).
 * Duplicated locally rather than imported — ai-owner-agent.ts does not
 * export its own GREEK_WEEKDAYS constant.
 */
const GREEK_WEEKDAYS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

export const ONBOARDING_TOOLS = [
  {
    type: 'function' as const,
    name: 'set_business_name',
    description: 'Ορίζει το όνομα της επιχείρησης.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Όνομα επιχείρησης' },
      },
      required: ['name'],
    },
  },
  {
    type: 'function' as const,
    name: 'set_business_hours',
    description:
      'Ορίζει το ωράριο λειτουργίας για μια συγκεκριμένη ημέρα. Υποστηρίζει προαιρετικό δεύτερο εύρος ωρών (διάλειμμα).',
    parameters: {
      type: 'object',
      properties: {
        day_of_week: {
          type: 'integer',
          description: '0=Κυριακή, 1=Δευτέρα, 2=Τρίτη, 3=Τετάρτη, 4=Πέμπτη, 5=Παρασκευή, 6=Σάββατο',
        },
        open_time: { type: 'string', description: 'Ώρα ανοίγματος σε μορφή HH:MM (24ωρη)' },
        close_time: { type: 'string', description: 'Ώρα κλεισίματος σε μορφή HH:MM (24ωρη)' },
        open_time_2: {
          type: 'string',
          description: 'Προαιρετικό: ώρα ανοίγματος μετά από διάλειμμα, μορφή HH:MM',
        },
        close_time_2: {
          type: 'string',
          description: 'Προαιρετικό: ώρα κλεισίματος μετά από διάλειμμα, μορφή HH:MM',
        },
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
        day_of_week: {
          type: 'integer',
          description: '0=Κυριακή, 1=Δευτέρα, 2=Τρίτη, 3=Τετάρτη, 4=Πέμπτη, 5=Παρασκευή, 6=Σάββατο',
        },
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
        price_cents: {
          type: 'integer',
          description: 'Τιμή σε λεπτά ευρώ (π.χ. 2000 = €20,00). 0 αν δεν έχει τιμή.',
        },
        duration_min: { type: 'integer', description: 'Διάρκεια σε λεπτά' },
      },
      required: ['name', 'price_cents', 'duration_min'],
    },
  },
  {
    type: 'function' as const,
    name: 'set_booking_mode',
    description:
      'Ορίζει τον τρόπο κράτησης της επιχείρησης μεταξύ ελεύθερων θέσεων και ορισμένου προγράμματος τάξεων.',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['open_slots', 'fixed_sessions'],
          description: '"open_slots" για ελεύθερες θέσεις, "fixed_sessions" για πρόγραμμα τάξεων',
        },
      },
      required: ['mode'],
    },
  },
  {
    type: 'function' as const,
    name: 'create_class_schedule',
    description:
      'Δημιουργεί επαναλαμβανόμενο πρόγραμμα μαθημάτων για μια υπηρεσία. Ισχύει ΜΟΝΟ όταν ο τρόπος κράτησης είναι "fixed_sessions".',
    parameters: {
      type: 'object',
      properties: {
        service_name: { type: 'string', description: 'Όνομα υπηρεσίας, π.χ. "Pilates"' },
        weekdays: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ημέρες εβδομάδας στα Ελληνικά, π.χ. ["Δευτέρα", "Τετάρτη", "Παρασκευή"]',
        },
        start_time: { type: 'string', description: 'Ώρα έναρξης σε μορφή HH:MM, π.χ. "10:00"' },
        capacity: { type: 'integer', description: 'Χωρητικότητα θέσεων, π.χ. 15' },
      },
      required: ['service_name', 'weekdays', 'start_time', 'capacity'],
    },
  },
  {
    type: 'function' as const,
    name: 'set_cancellation_cutoff',
    description:
      'Ορίζει το παράθυρο ακύρωσης: αν ένας πελάτης ακυρώσει εντός X ωρών πριν το μάθημα, χάνει το session.',
    parameters: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'true = ενεργοποίηση παραθύρου ακύρωσης, false = απενεργοποίηση' },
        hours: {
          type: 'integer',
          description:
            'Ώρες πριν το μάθημα (1-168). Απαιτείται πάντα — ο επικυρωτής το απαιτεί ακόμα κι όταν enabled=false· χρησιμοποίησε την τελευταία γνωστή τιμή ή 24 ως προεπιλογή.',
        },
      },
      required: ['enabled', 'hours'],
    },
  },
  {
    type: 'function' as const,
    name: 'set_slotless_requests',
    description: 'Ενεργοποιεί/απενεργοποιεί αιτήματα κράτησης όταν δεν υπάρχει διαθέσιμη θέση.',
    parameters: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'true = ενεργοποίηση, false = απενεργοποίηση' },
      },
      required: ['enabled'],
    },
  },
  {
    type: 'function' as const,
    name: 'set_last_session_threshold',
    description: 'Ρυθμίζει την ειδοποίηση ανανέωσης συνδρομής όταν ένας πελάτης έχει λίγα εναπομείναντα μαθήματα.',
    parameters: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'true για ενεργοποίηση, false για απενεργοποίηση' },
        count: {
          type: 'integer',
          description:
            'Αριθμός εναπομεινάντων μαθημάτων που ενεργοποιεί την ειδοποίηση (1-20). Απαιτείται πάντα — ο επικυρωτής το απαιτεί ακόμα κι όταν enabled=false· χρησιμοποίησε την τελευταία γνωστή τιμή ή 2 ως προεπιλογή.',
        },
      },
      required: ['enabled', 'count'],
    },
  },
  {
    type: 'function' as const,
    name: 'finish_onboarding',
    description:
      'Ολοκληρώνει την εγκατάσταση της επιχείρησης. Κάλεσέ το ΜΟΝΟ όταν υπάρχουν όνομα, πλήρες ωράριο (και οι 7 ημέρες) και τουλάχιστον 1 υπηρεσία, ΚΑΙ ο ιδιοκτήτης έχει επιβεβαιώσει ότι δεν έχει κάτι άλλο να προσθέσει.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------
// D-02: stateless completeness derivation (shared by the system prompt and
// the finish_onboarding tool case added in Task 2)
// ---------------------------------------------------------------------------

interface OnboardingCompleteness {
  hasName: boolean;
  hasAllHours: boolean;
  hasServices: boolean;
  missing: string[];
}

function computeOnboardingCompleteness(
  business: Business,
  svcList: Service[],
  hoursList: BusinessHours[]
): OnboardingCompleteness {
  const hasName = business.name !== PLACEHOLDER_BUSINESS_NAME;
  const hasAllHours = hoursList.length === 7;
  const hasServices = svcList.length >= 1;

  const missing: string[] = [];
  if (!hasName) missing.push('όνομα επιχείρησης');
  if (!hasAllHours) missing.push('πλήρες εβδομαδιαίο ωράριο (και οι 7 ημέρες)');
  if (!hasServices) missing.push('τουλάχιστον 1 υπηρεσία');

  return { hasName, hasAllHours, hasServices, missing };
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export function buildOnboardingSystemPrompt(
  business: Business,
  svcList: Service[],
  hoursList: BusinessHours[],
  today: string
): string {
  const { hasName, missing } = computeOnboardingCompleteness(business, svcList, hoursList);

  const missingText = missing.length
    ? `Λείπουν ακόμα: ${missing.join(', ')}.`
    : 'Όλα τα απαραίτητα στοιχεία (όνομα, πλήρες ωράριο, τουλάχιστον 1 υπηρεσία) έχουν ήδη καταχωρηθεί.';

  const nameText = hasName
    ? `Όνομα επιχείρησης: ${business.name}`
    : 'Όνομα επιχείρησης: (δεν έχει οριστεί ακόμα)';

  const svcText = svcList.length
    ? svcList
        .map(
          (s) =>
            `- ${s.name}: ${s.price != null ? (s.price / 100).toFixed(2) + '€' : 'χωρίς τιμή'}, ${s.durationMin} λεπτά`
        )
        .join('\n')
    : '(καμία υπηρεσία ακόμα)';

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
    : '(δεν έχουν οριστεί ωράρια ακόμα)';

  const configText = [
    `Τρόπος κράτησης: ${business.bookingMode === 'fixed_sessions' ? 'πρόγραμμα τάξεων' : 'ελεύθερες θέσεις'}`,
    `Όριο ακύρωσης: ${
      business.cancellationCutoffEnabled ? business.cancellationCutoffHours + ' ώρες' : 'απενεργοποιημένο'
    }`,
    `Αιτήματα χωρίς θέση: ${business.slotlessRequestsEnabled ? 'ενεργά' : 'ανενεργά'}`,
    `Ειδοποίηση ανανέωσης: ${
      business.lastSessionThresholdEnabled
        ? 'ενεργή στα ' + business.lastSessionThresholdCount + ' μαθήματα'
        : 'ανενεργή'
    }`,
  ].join('\n');

  return [
    'Είσαι ο βοηθός εγκατάστασης (onboarding) μιας νέας επιχείρησης στο RandevuClaw.',
    `Σημερινή ημερομηνία: ${today}`,
    '',
    nameText,
    '',
    'Τρέχουσες υπηρεσίες:',
    svcText,
    '',
    'Τρέχον ωράριο λειτουργίας:',
    hoursText,
    '',
    'Τρέχουσες ρυθμίσεις:',
    configText,
    '',
    missingText,
    '',
    'Κανόνες:',
    '- Μιλάς ΠΑΝΤΑ Ελληνικά, συνοπτικά και φιλικά.',
    '- Ρωτάς ΜΟΝΟ για ό,τι λείπει ακόμα από την παραπάνω λίστα — ποτέ μην ξαναρωτάς κάτι που έχει ήδη καταχωρηθεί.',
    '- Αν ο ιδιοκτήτης δώσει τις ίδιες ώρες για πολλές ημέρες μέσα σε ένα μήνυμα, κάλεσε ένα ξεχωριστό set_business_hours για κάθε ημέρα μέσα στο ίδιο turn — μην αναβάλλεις καμία ημέρα για επόμενο μήνυμα.',
    '- Κάλεσε finish_onboarding ΜΟΝΟ όταν υπάρχουν όνομα + πλήρες ωράριο (και οι 7 ημέρες) + τουλάχιστον 1 υπηρεσία, ΚΑΙ ο ιδιοκτήτης έχει επιβεβαιώσει ότι δεν έχει κάτι άλλο να προσθέσει.',
    '- Αν δεν καταλαβαίνεις κάτι που είπε ο ιδιοκτήτης, ρώτησέ τον μια σύντομη διευκρινιστική ερώτηση στα Ελληνικά — μην τον απορρίπτεις με έτοιμο μήνυμα σφάλματος.',
    '- Μην κάνεις ενέργειες εκτός των παραπάνω εργαλείων.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Tool executor (Task 2)
// ---------------------------------------------------------------------------

export interface OnboardingToolArgs {
  name?: string;
  day_of_week?: number;
  open_time?: string;
  close_time?: string;
  open_time_2?: string;
  close_time_2?: string;
  price_cents?: number;
  duration_min?: number;
  mode?: string;
  service_name?: string;
  weekdays?: string[];
  start_time?: string;
  capacity?: number;
  enabled?: boolean;
  hours?: number;
  count?: number;
}

// ---------------------------------------------------------------------------
// Gemini types (mirror ai-owner-agent.ts)
// ---------------------------------------------------------------------------

interface GeminiCreateParams {
  model: string;
  input: string | GeminiFunctionResultInput[];
  tools: typeof ONBOARDING_TOOLS;
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

// Bounds the Gemini HTTP call to 25s so a stalled onboarding response can no
// longer hang the open Postgres transaction (withBusinessContext) indefinitely;
// the existing catch block below already logs + falls back on rejection.
const ai = new GoogleGenAI({ apiKey: config.geminiApiKey, httpOptions: { timeout: 25000 } });
const MAX_TOOL_ROUNDS = 5;

/**
 * Executes a Gemini-dispatched onboarding tool and returns a Greek string to
 * feed back to Gemini as the function result.
 *
 * D-03/D-08 special case: finish_onboarding sends its own Telegram confirmation
 * message and returns '' (empty string). The Gemini loop treats '' as a signal
 * to break immediately — the caller must NOT send an additional reply.
 *
 * WR-02 (mirrors ai-owner-agent.ts): top-level try/catch so any DB error
 * returns a Greek error string to Gemini instead of propagating uncaught.
 */
export async function executeOnboardingTool(
  toolName: string,
  args: OnboardingToolArgs,
  business: Business,
  today: string,
  ownerTelegramId: string
): Promise<string> {
  try {
    switch (toolName) {
      case 'set_business_name': {
        const name = args.name?.trim();
        if (!name) return 'Μη έγκυρο όνομα.';
        if (name.length > 100) return 'Το όνομα είναι πολύ μεγάλο (μέγιστο 100 χαρακτήρες).';
        // CR-01: the cross-tenant slug-uniqueness lookup MUST use the admin
        // connection (db), not getConn() — businesses_isolation RLS would
        // otherwise scope this SELECT to just this business's own row,
        // silently defeating the uniqueness check. Only the actual per-tenant
        // UPDATE runs inside withBusinessContext.
        const existingSlugsRows = await db.select({ slug: businesses.slug }).from(businesses);
        const existingSlugs = existingSlugsRows.map((r) => r.slug);
        const slug = generateSlug(name, existingSlugs);
        return await withBusinessContext(business.id, async () => {
          await getConn().update(businesses).set({ name, slug }).where(eq(businesses.id, business.id));
          return `OK: το όνομα ορίστηκε σε "${name}"`;
        });
      }

      case 'set_business_hours': {
        const { day_of_week, open_time, close_time, open_time_2, close_time_2 } = args;
        if (day_of_week === undefined || day_of_week < 0 || day_of_week > 6 || !open_time || !close_time) {
          return 'Μη έγκυρα δεδομένα ωραρίου.';
        }
        return await withBusinessContext(business.id, async () => {
          await getConn()
            .insert(businessHours)
            .values({
              businessId: business.id,
              dayOfWeek: day_of_week,
              openTime: open_time,
              closeTime: close_time,
              openTime2: open_time_2 ?? null,
              closeTime2: close_time_2 ?? null,
              isClosed: false,
            })
            .onConflictDoUpdate({
              target: [businessHours.businessId, businessHours.dayOfWeek],
              set: {
                openTime: open_time,
                closeTime: close_time,
                openTime2: open_time_2 ?? null,
                closeTime2: close_time_2 ?? null,
                isClosed: false,
              },
            });
          return `OK: ${GREEK_WEEKDAYS[day_of_week]} ${open_time}–${close_time}`;
        });
      }

      case 'close_day': {
        const { day_of_week } = args;
        if (day_of_week === undefined || day_of_week < 0 || day_of_week > 6) return 'Μη έγκυρη ημέρα.';
        return await withBusinessContext(business.id, async () => {
          await getConn()
            .insert(businessHours)
            .values({
              businessId: business.id,
              dayOfWeek: day_of_week,
              openTime: '00:00',
              closeTime: '00:00',
              isClosed: true,
            })
            .onConflictDoUpdate({
              target: [businessHours.businessId, businessHours.dayOfWeek],
              set: { isClosed: true },
            });
          return `OK: ${GREEK_WEEKDAYS[day_of_week]} ορίστηκε ως κλειστή`;
        });
      }

      case 'add_service': {
        const { name, price_cents, duration_min } = args;
        if (!name || duration_min === undefined || duration_min <= 0) return 'Μη έγκυρα δεδομένα υπηρεσίας.';
        return await withBusinessContext(business.id, async () => {
          await getConn()
            .insert(services)
            .values({
              businessId: business.id,
              name,
              price: price_cents && price_cents > 0 ? price_cents : null,
              durationMin: duration_min,
            });
          return `OK: υπηρεσία "${name}" προστέθηκε`;
        });
      }

      case 'set_booking_mode': {
        const mode = args.mode;
        if (mode !== 'open_slots' && mode !== 'fixed_sessions') {
          return 'Μη έγκυρος τρόπος κράτησης. Επιτρεπτές τιμές: open_slots, fixed_sessions.';
        }
        return await withBusinessContext(business.id, async () => {
          if (mode === 'fixed_sessions') {
            // Mirrors ai-owner-agent.ts's change_booking_mode: warn but still switch
            // when existing session bookings already exist.
            const sessions = await listSessions(business.id);
            if (sessions.length > 0) {
              await getConn().update(businesses).set({ bookingMode: mode }).where(eq(businesses.id, business.id));
              return (
                `⚠️ Προσοχή: υπάρχουν ${sessions.length} υπάρχοντα μαθήματα. ` +
                'Ο τρόπος κράτησης άλλαξε σε "πρόγραμμα τάξεων".'
              );
            }
          }
          await getConn().update(businesses).set({ bookingMode: mode }).where(eq(businesses.id, business.id));
          const modeLabel = mode === 'fixed_sessions' ? 'πρόγραμμα τάξεων' : 'ελεύθερες θέσεις';
          return `OK: ο τρόπος κράτησης ορίστηκε σε "${modeLabel}"`;
        });
      }

      case 'create_class_schedule': {
        const svcNameArg = (args.service_name ?? '').trim();
        if (!svcNameArg) return 'Δεν δόθηκε όνομα υπηρεσίας.';
        const svcList = await listServicesForBusiness(business.id);
        const matchedService = svcList.find((s) => s.name.toLowerCase().includes(svcNameArg.toLowerCase()));
        if (!matchedService) {
          return `Δεν βρέθηκε υπηρεσία με όνομα "${svcNameArg}".`;
        }
        const weekdays = args.weekdays ?? [];
        if (weekdays.length === 0) {
          return 'Δεν δόθηκαν ημέρες εβδομάδας.';
        }
        const start_time = args.start_time ?? '';
        const capacity = args.capacity ?? 0;
        const rruleString = buildRRuleString(weekdays, start_time);
        // createSessionCatalogWithExpansion calls withBusinessContext internally
        const { instanceCount } = await createSessionCatalogWithExpansion(
          business.id,
          matchedService.id,
          rruleString,
          start_time,
          capacity
        );
        return `Δημιουργήθηκαν ${instanceCount} μαθήματα για "${matchedService.name}" (${start_time}) τις επόμενες ~90 ημέρες.`;
      }

      case 'set_cancellation_cutoff': {
        return await withBusinessContext(business.id, () =>
          handleSetCancellationCutoff(business.id, args as Record<string, unknown>)
        );
      }

      case 'set_slotless_requests': {
        const enabled = args.enabled;
        if (typeof enabled !== 'boolean') return 'Μη έγκυρα δεδομένα.';
        return await withBusinessContext(business.id, async () => {
          await getConn()
            .update(businesses)
            .set({ slotlessRequestsEnabled: enabled })
            .where(eq(businesses.id, business.id));
          return enabled
            ? 'OK: τα αιτήματα χωρίς θέση ενεργοποιήθηκαν'
            : 'OK: τα αιτήματα χωρίς θέση απενεργοποιήθηκαν';
        });
      }

      case 'set_last_session_threshold': {
        return await withBusinessContext(business.id, () =>
          handleSetLastSessionThreshold(business.id, args as Record<string, unknown>)
        );
      }

      case 'finish_onboarding': {
        const svcList = await listServicesForBusiness(business.id);
        const hoursList = await listBusinessHours(business.id);
        const { missing } = computeOnboardingCompleteness(business, svcList, hoursList);

        if (missing.length > 0) {
          return `Δεν μπορώ να ολοκληρώσω ακόμα. Λείπουν: ${missing.join(', ')}.`;
        }

        if (!config.webhookBaseUrl) {
          return 'Σφάλμα: το WEBHOOK_BASE_URL δεν έχει οριστεί. Επικοινωνήστε με τον διαχειριστή.';
        }

        const webhookId = crypto.randomUUID();
        const webhookSecret = crypto.randomBytes(32).toString('hex');

        // Always unregister before registering to prevent webhook conflicts (T-05-09
        // pattern, mirrors the pre-Phase-21 handleActivate — see git history for
        // src/onboarding/steps.ts, deleted in this phase).
        await unregisterBotWebhook(business.botToken!);
        await registerBotWebhook(
          business.botToken!,
          `${config.webhookBaseUrl}/webhooks/telegram/${webhookId}`,
          webhookSecret
        );

        await activateBusiness(business.id, webhookId, webhookSecret);

        // ARCH-03 pattern: persist onboardingCompleted=true under RLS before sending
        // the congratulatory message.
        await withBusinessContext(business.id, async () => {
          await getConn().update(businesses).set({ onboardingCompleted: true }).where(eq(businesses.id, business.id));
        });

        logger.info({ businessId: business.id, webhookId }, 'Business activated via AI onboarding agent');

        await sendTelegramMessage(
          ownerTelegramId,
          'Η επιχείρησή σας είναι ενεργή! Οι πελάτες μπορούν τώρα να κάνουν κράτηση μέσω του bot σας.'
        );
        return '';
      }

      default:
        return `Άγνωστο εργαλείο: ${toolName}`;
    }
  } catch (err) {
    logger.error({ err, toolName, businessId: business.id }, 'executeOnboardingTool failed');
    return 'Σφάλμα κατά την εκτέλεση. Δοκιμάστε ξανά.';
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * D-01/D-02: single freeform multi-turn Gemini conversation covering the
 * entire onboarding flow. Stateless resume — the system prompt is rebuilt
 * from current DB state on every call (no onboarding_sessions step tracking).
 */
export async function aiOnboardingAgent(
  business: Business,
  ownerTelegramId: string,
  messageText: string,
  today: string
): Promise<string> {
  const svcList = await listServicesForBusiness(business.id);
  const hoursList = await listBusinessHours(business.id);
  const systemInstruction = buildOnboardingSystemPrompt(business, svcList, hoursList, today);

  let input: string | GeminiFunctionResultInput[] = messageText;
  let currentInteractionId: string | undefined;
  let round = 0;

  while (true) {
    if (++round > MAX_TOOL_ROUNDS) {
      logger.error({ businessId: business.id, ownerTelegramId }, 'aiOnboardingAgent exceeded MAX_TOOL_ROUNDS');
      return 'Συγγνώμη, κάτι πήγε στραβά. Δοκιμάστε ξανά.';
    }

    let interaction: GeminiInteractionResult;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      interaction = await (ai.interactions.create as any)({
        model: GEMINI_MODEL,
        input,
        tools: ONBOARDING_TOOLS,
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
        { businessId: business.id, tool: call.name, result: result || '(webhook activated)' },
        'Onboarding tool executed'
      );

      // D-03/D-08: '' signals finish_onboarding already sent its own Telegram
      // message. Break the Gemini loop immediately — the caller must NOT send
      // an additional reply when this function returns ''.
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
