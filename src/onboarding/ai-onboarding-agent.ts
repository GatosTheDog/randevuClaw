import { eq } from 'drizzle-orm';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config';
import { businesses, businessHours, services } from '../database/schema';
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
        hours: { type: 'integer', description: 'Ώρες πριν το μάθημα (1-168). Απαιτείται όταν enabled=true.' },
      },
      required: ['enabled'],
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
          description: 'Αριθμός εναπομεινάντων μαθημάτων που ενεργοποιεί την ειδοποίηση (1-20)',
        },
      },
      required: ['enabled'],
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

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
const MAX_TOOL_ROUNDS = 5;

// NOTE: executeOnboardingTool and aiOnboardingAgent are implemented in Task 2.
