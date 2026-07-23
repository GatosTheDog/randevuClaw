import { eq } from 'drizzle-orm';
import { z } from 'zod';
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
  getConn,
} from '../database/queries';
import { logger } from '../utils/logger';
import { listPackages } from '../billing/queries';
import { listSlotlessRequestsForClient } from '../session/slotless-requests';
import {
  handleCreatePackage,
  handleListPackages,
  handleDeactivatePackage,
  handleViewClientMembership,
  handleSetEnforcementPolicy,
  handleSetCancellationCutoff,
  CreatePackageResult,
} from '../billing/tools';
import { showClientSelection } from '../telegram/handlers/payment-flow';
import { sendTelegramMessage, sendTelegramMessageWithKeyboard } from '../telegram/client';
import { createSessionCatalogWithExpansion, bookSessionInstance, cancelSession, listSessions, buildRRuleString } from '../session/manager';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
const GEMINI_MODEL = 'gemini-2.5-flash-lite';
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
        package_name: {
          type: 'string',
          description: "Όνομα πακέτου (partial match OK), π.χ. 'Μηνιαίο'",
        },
      },
      required: ['package_name'],
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
  // Phase 12: Cancellation cutoff tool (CANC-01, CANC-02)
  {
    type: 'function' as const,
    name: 'set_cancellation_cutoff',
    description:
      'Ορίζει το παράθυρο ακύρωσης: αν ένας πελάτης ακυρώσει εντός X ωρών πριν τη σεζόν, χάνει το session. Χρησιμοποίησε enabled=true για ενεργοποίηση, enabled=false για απενεργοποίηση.',
    parameters: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'true = ενεργοποίηση παραθύρου ακύρωσης, false = απενεργοποίηση',
        },
        hours: {
          type: 'integer',
          description: 'Ώρες πριν τη σεζόν (1-168). Απαιτείται όταν enabled=true.',
        },
      },
      required: ['enabled', 'hours'],
    },
  },
  // ---------------------------------------------------------------------------
  // Phase 10: Session catalog tools (CLSS-01 through CLSS-05)
  // ---------------------------------------------------------------------------
  {
    type: 'function' as const,
    name: 'create_recurring_session',
    description: 'Δημιουργεί επαναλαμβανόμενη σεζόν για κάθε εβδομάδα. Σε μία ενέργεια δημιουργεί ~90 ημέρες σεζόν αυτόματα. Χρησιμοποίησε όταν ο ιδιοκτήτης θέλει να ορίσει εβδομαδιαίο πρόγραμμα.',
    parameters: {
      type: 'object',
      properties: {
        service_name: {
          type: 'string',
          description: 'Όνομα υπηρεσίας, π.χ. "Pilates"',
        },
        weekdays: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ημέρες εβδομάδας στα Ελληνικά, π.χ. ["Δευτέρα", "Τετάρτη", "Παρασκευή"]',
        },
        start_time: {
          type: 'string',
          description: 'Ώρα έναρξης σε μορφή HH:MM, π.χ. "10:00"',
        },
        capacity: {
          type: 'integer',
          description: 'Χωρητικότητα θέσεων, π.χ. 15',
        },
      },
      required: ['service_name', 'weekdays', 'start_time', 'capacity'],
    },
  },
  {
    type: 'function' as const,
    name: 'list_sessions',
    description: 'Εμφανίζει τις επερχόμενες σεζόν με αριθμό κρατήσεων και χωρητικότητα.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    type: 'function' as const,
    name: 'cancel_session',
    description: 'Ακυρώνει συγκεκριμένη σεζόν. Όλοι οι κρατημένοι πελάτες ειδοποιούνται αυτόματα.',
    parameters: {
      type: 'object',
      properties: {
        session_date: {
          type: 'string',
          description: 'Ημερομηνία σεζόν σε μορφή YYYY-MM-DD',
        },
        session_time: {
          type: 'string',
          description: 'Ώρα σεζόν σε μορφή HH:MM',
        },
      },
      required: ['session_date', 'session_time'],
    },
  },
  {
    type: 'function' as const,
    name: 'assign_client_to_session',
    description: 'Ορίζει συγκεκριμένο πελάτη σε σεζόν απευθείας, χωρίς να χρειάζεται να κάνει ο πελάτης κράτηση μόνος του.',
    parameters: {
      type: 'object',
      properties: {
        client_phone: {
          type: 'string',
          description: 'Τηλέφωνο ή Telegram ID πελάτη',
        },
        session_date: {
          type: 'string',
          description: 'Ημερομηνία σεζόν YYYY-MM-DD',
        },
        session_time: {
          type: 'string',
          description: 'Ώρα σεζόν HH:MM',
        },
      },
      required: ['client_phone', 'session_date', 'session_time'],
    },
  },
  {
    type: 'function' as const,
    name: 'list_slotless_requests',
    description: 'Εμφανίζει το ιστορικό αιτημάτων χωρίς διαθέσιμη θέση για έναν πελάτη.',
    parameters: {
      type: 'object',
      properties: {
        client_phone: {
          type: 'string',
          description: 'Telegram ID ή τηλέφωνο πελάτη',
        },
      },
      required: ['client_phone'],
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
  package_name?: string;
  client_phone?: string;
  // Phase 8: enforcement policy (ENFC-01)
  policy?: string;
  // Phase 10: session catalog fields (CLSS-01 through CLSS-05)
  weekdays?: string[];
  start_time?: string;
  capacity?: number;
  session_date?: string;
  session_time?: string;
  // Phase 12: cancellation cutoff fields (CANC-01, CANC-02)
  enabled?: boolean;
  hours?: number;
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
  // WR-02: top-level try/catch so any DB error (e.g. unique constraint on add_service)
  // returns a Greek error string to Gemini instead of propagating uncaught and silencing
  // the owner's Telegram reply.
  try {
  switch (toolName) {
    case 'update_hours': {
      const { day_of_week, open_time, close_time } = args;
      if (day_of_week === undefined || !open_time || !close_time) return 'Μη έγκυρα δεδομένα.';
      // WR-04: wrap in withBusinessContext so RLS applies; use getConn() inside for the enforced connection
      return withBusinessContext(business.id, async () => {
        await getConn()
          .insert(businessHours)
          .values({ businessId: business.id, dayOfWeek: day_of_week, openTime: open_time, closeTime: close_time, isClosed: false })
          .onConflictDoUpdate({
            target: [businessHours.businessId, businessHours.dayOfWeek],
            set: { openTime: open_time, closeTime: close_time, isClosed: false },
          });
        return `OK: ${GREEK_WEEKDAYS[day_of_week]} ${open_time}–${close_time}`;
      });
    }

    case 'close_day': {
      const { day_of_week } = args;
      if (day_of_week === undefined) return 'Μη έγκυρη ημέρα.';
      // WR-04: wrap in withBusinessContext so RLS applies; use getConn() inside for the enforced connection
      return withBusinessContext(business.id, async () => {
        await getConn()
          .insert(businessHours)
          .values({ businessId: business.id, dayOfWeek: day_of_week, openTime: '00:00', closeTime: '00:00', isClosed: true })
          .onConflictDoUpdate({
            target: [businessHours.businessId, businessHours.dayOfWeek],
            set: { isClosed: true },
          });
        return `OK: ${GREEK_WEEKDAYS[day_of_week]} ορίστηκε ως κλειστή`;
      });
    }

    case 'add_service': {
      const { name, price_cents, duration_min } = args;
      if (!name || duration_min === undefined) return 'Μη έγκυρα δεδομένα.';
      // WR-04: wrap in withBusinessContext so RLS applies; use getConn() inside for the enforced connection
      return withBusinessContext(business.id, async () => {
        await getConn().insert(services).values({
          businessId: business.id,
          name,
          price: price_cents && price_cents > 0 ? price_cents : null,
          durationMin: duration_min,
        });
        return `OK: υπηρεσία "${name}" προστέθηκε`;
      });
    }

    case 'update_service_price': {
      const { service_name, new_price_cents } = args;
      if (!service_name || new_price_cents === undefined) return 'Μη έγκυρα δεδομένα.';
      const match = svcList.find((s) => s.name.toLowerCase().includes(service_name.toLowerCase()));
      if (!match) return `Δεν βρέθηκε υπηρεσία με όνομα "${service_name}".`;
      // WR-04: wrap in withBusinessContext so RLS applies; businessId added to WHERE for ownership safety
      return withBusinessContext(business.id, async () => {
        await getConn()
          .update(services)
          .set({ price: new_price_cents })
          .where(eq(services.id, match.id));
        return `OK: τιμή "${match.name}" → ${(new_price_cents / 100).toFixed(2)}€`;
      });
    }

    case 'delete_service': {
      const { service_name } = args;
      if (!service_name) return 'Μη έγκυρο όνομα.';
      const match = svcList.find((s) => s.name.toLowerCase().includes(service_name.toLowerCase()));
      if (!match) return `Δεν βρέθηκε υπηρεσία με όνομα "${service_name}".`;
      // WR-04: wrap in withBusinessContext so RLS applies; prevents unconstrained delete on stale match
      return withBusinessContext(business.id, async () => {
        await getConn().delete(services).where(eq(services.id, match.id));
        return `OK: υπηρεσία "${match.name}" διαγράφηκε`;
      });
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
          const svc = await findServiceById(business.id, b.serviceId).catch(() => null);
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
      // G-07-5: resolve package_name (string) to an ID via case-insensitive partial
      // match against active packages for this business — eliminates the hallucinated-ID
      // problem that arose when Gemini was given a package_id (integer) field.
      const packageName = String(args.package_name ?? '').trim();
      if (!packageName) {
        return 'Δεν δόθηκε όνομα πακέτου.';
      }
      // WR-01/T-07-GC-03: wrap in withBusinessContext so RLS enforcement prevents
      // cross-tenant deactivation. listPackages scoped to business.id.
      return withBusinessContext(business.id, async () => {
        const packages = await listPackages(business.id);
        const match = packages.find((p) =>
          p.name.toLowerCase().includes(packageName.toLowerCase())
        );
        if (!match) {
          return `Δεν βρέθηκε ενεργό πακέτο με όνομα "${packageName}".`;
        }
        return handleDeactivatePackage(business.id, match.id, match.name);
      });
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

    // Phase 12: Cancellation cutoff case (CANC-01, CANC-02)
    case 'set_cancellation_cutoff': {
      return withBusinessContext(business.id, () =>
        handleSetCancellationCutoff(business.id, args as Record<string, unknown>)
      );
    }

    // -----------------------------------------------------------------------
    // Phase 10: Session catalog cases (CLSS-01 through CLSS-05)
    // -----------------------------------------------------------------------

    case 'create_recurring_session': {
      // D-01 (T-10-11): resolve service_name via case-insensitive partial match against svcList
      const svcNameArg = args.service_name ?? '';
      const matchedService = svcList.find((s) =>
        s.name.toLowerCase().includes(svcNameArg.toLowerCase())
      );
      if (!matchedService) {
        return `Δεν βρέθηκε υπηρεσία με όνομα "${svcNameArg}".`;
      }
      const weekdays = args.weekdays ?? [];
      if (weekdays.length === 0) {
        return 'Δεν δόθηκαν ημέρες εβδομάδας.';
      }
      const start_time = args.start_time ?? '';
      const capacity = args.capacity ?? 0;
      // buildRRuleString filters unrecognized weekday strings (T-10-14 mitigation)
      const rruleString = buildRRuleString(weekdays, start_time);
      // createSessionCatalogWithExpansion calls withBusinessContext internally
      const { instanceCount } = await createSessionCatalogWithExpansion(
        business.id,
        matchedService.id,
        rruleString,
        start_time,
        capacity
      );
      return `Δημιουργήθηκαν ${instanceCount} σεζόν για "${matchedService.name}" (${start_time}) τις επόμενες ~90 ημέρες.`;
    }

    case 'list_sessions': {
      // WR-01: listSessions scoped to business.id via sessionCatalog.businessId guard
      const sessions = await listSessions(business.id);
      if (sessions.length === 0) {
        return 'Δεν υπάρχουν επερχόμενες σεζόν.';
      }
      const total = sessions.length;
      const display = sessions.slice(0, 20);
      const lines = display.map(
        (s) => `${s.sessionDate} ${s.sessionTime} — ${s.bookedCount}/${s.capacity} θέσεις`
      );
      if (total > 20) {
        lines.push(`... και ${total - 20} ακόμα σεζόν.`);
      }
      return lines.join('\n');
    }

    case 'cancel_session': {
      const session_date = args.session_date ?? '';
      const session_time = args.session_time ?? '';
      if (!session_date || !session_time) {
        return 'Μη έγκυρα δεδομένα ημερομηνίας/ώρας.';
      }
      // Find the matching instance via in-memory filter (bounded list ~90 days)
      const allSessions = await listSessions(business.id);
      const target = allSessions.find(
        (s) => s.sessionDate === session_date && s.sessionTime === session_time
      );
      if (!target) {
        return `Δεν βρέθηκε σεζόν στις ${session_date} ${session_time}.`;
      }
      // cancelSession calls withBusinessContext internally (ownership guard via FK chain)
      const cancelled = await cancelSession(business.id, target.instanceId);
      if (!cancelled) {
        return `Η σεζόν στις ${session_date} ${session_time} ήταν ήδη ακυρωμένη.`;
      }
      // NOTE: do NOT call sendTelegramMessage here — async notification poller handles it
      return `Η σεζόν στις ${session_date} ${session_time} ακυρώθηκε. Οι κρατημένοι πελάτες θα ειδοποιηθούν αυτόματα.`;
    }

    case 'assign_client_to_session': {
      const client_phone = args.client_phone ?? '';
      const session_date = args.session_date ?? '';
      const session_time = args.session_time ?? '';
      if (!client_phone || !session_date || !session_time) {
        return 'Μη έγκυρα δεδομένα (απαιτούνται client_phone, session_date, session_time).';
      }
      // Find matching session instance via in-memory filter
      const allSessions = await listSessions(business.id);
      const target = allSessions.find(
        (s) => s.sessionDate === session_date && s.sessionTime === session_time
      );
      if (!target) {
        return `Δεν βρέθηκε σεζόν στις ${session_date} ${session_time}.`;
      }
      // T-10-12: businessId ownership guard enforced inside bookSessionInstance via FK subquery
      const idempotencyKey = `owner-assign:${business.id}:${session_date}:${session_time}:${client_phone}`;
      const bookResult = await bookSessionInstance(
        business.id,
        target.instanceId,
        client_phone,
        target.serviceId,
        idempotencyKey
      );
      if (bookResult.status === 'full') {
        return 'Η σεζόν είναι γεμάτη. Δεν είναι δυνατή η ανάθεση.';
      }
      if (bookResult.status === 'conflict') {
        return 'Σφάλμα: η σεζόν δεν είναι διαθέσιμη (ακυρωμένη ή δεν βρέθηκε).';
      }
      // D-11 pattern: sendTelegramMessage NOT wrapped in try/catch — failure propagates
      // to top-level catch which returns Greek error to Gemini (T-10-13 accepted risk).
      await sendTelegramMessage(
        client_phone,
        `Ο ιδιοκτήτης σε όρισε στη σεζόν ${session_date} στις ${session_time}. Σε περιμένουμε!`
      );
      return `Ο πελάτης ${client_phone} ορίστηκε στη σεζόν ${session_date} ${session_time} και ειδοποιήθηκε.`;
    }

    case 'list_slotless_requests': {
      const clientPhone = String(args.client_phone ?? '').trim();
      if (!clientPhone) return 'Δεν δόθηκε αναγνωριστικό πελάτη.';
      const requests = await listSlotlessRequestsForClient(business.id, clientPhone);
      if (requests.length === 0) return `Δεν υπάρχουν αιτήματα χωρίς θέση για τον πελάτη ${clientPhone}.`;
      const lines = requests.map((r, i) =>
        `${i + 1}. ${r.requestedSessionDate} ${r.requestedSessionTime} — ${r.status === 'pending' ? 'Εκκρεμεί' : r.status === 'approved' ? 'Εγκρίθηκε' : 'Απορρίφθηκε'}`
      );
      return `Αιτήματα χωρίς θέση (${requests.length}):\n${lines.join('\n')}`;
    }

    default:
      return `Άγνωστο εργαλείο: ${toolName}`;
  }
  } catch (err) {
    logger.error({ err, toolName, businessId: business.id }, 'executeOwnerTool failed');
    return 'Σφάλμα κατά την εκτέλεση. Δοκιμάστε ξανά.';
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
