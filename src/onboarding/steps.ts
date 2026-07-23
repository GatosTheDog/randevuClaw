import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../database/db';
import { businesses, businessHours, services } from '../database/schema';
import { generateSlug } from '../database/seed';
import type { Business } from '../database/queries';
import { updateOnboardingStep, activateBusiness } from './queries';
import type { OnboardingSession } from './queries';
import {
  sendTelegramMessage,
  sendTelegramMessageWithKeyboard,
  unregisterBotWebhook,
  registerBotWebhook,
} from '../telegram/client';
import { config } from '../config';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Step type and constants
// ---------------------------------------------------------------------------

export type OnboardingStep =
  | 'name'
  | 'hours_0_query'
  | 'hours_0_range'
  | 'hours_1_query'
  | 'hours_1_range'
  | 'hours_2_query'
  | 'hours_2_range'
  | 'hours_3_query'
  | 'hours_3_range'
  | 'hours_4_query'
  | 'hours_4_range'
  | 'hours_5_query'
  | 'hours_5_range'
  | 'hours_6_query'
  | 'hours_6_range'
  | 'svc_name'
  | 'svc_price'
  | 'svc_duration'
  | 'svc_more'
  | 'config_booking_mode'
  | 'config_cancellation_cutoff'
  | 'config_slotless_requests'
  | 'config_last_session_threshold'
  | 'done';

/**
 * Greek day names keyed by JS Date.getDay() index.
 * CRITICAL: 0=Sunday matches JS Date.getDay() and business_hours.dayOfWeek convention.
 */
export const GREEK_DAY_NAMES: Record<number, string> = {
  0: 'Κυριακή',
  1: 'Δευτέρα',
  2: 'Τρίτη',
  3: 'Τετάρτη',
  4: 'Πέμπτη',
  5: 'Παρασκευή',
  6: 'Σάββατο',
};

/** Partial state stored in onboarding_sessions.collected_data. */
export interface CollectedData {
  currentService?: { name?: string; price?: number };
}

// ---------------------------------------------------------------------------
// Time-range parsing
// ---------------------------------------------------------------------------

/** HH:MM-HH:MM range format validator. */
const RANGE_REGEX = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

interface ParsedRanges {
  openTime: string;
  closeTime: string;
  openTime2: string | null;
  closeTime2: string | null;
}

function parseTimeRange(text: string): ParsedRanges | null {
  const parts = text.trim().split(',').map((s) => s.trim());
  if (parts.length > 2) return null;

  if (!RANGE_REGEX.test(parts[0])) return null;
  const [open1, close1] = parts[0].split('-');
  // open must be before close
  if (timeToMinutes(open1) >= timeToMinutes(close1)) return null;

  if (parts.length === 1) {
    return { openTime: open1, closeTime: close1, openTime2: null, closeTime2: null };
  }

  if (!RANGE_REGEX.test(parts[1])) return null;
  const [open2, close2] = parts[1].split('-');
  if (timeToMinutes(open2) >= timeToMinutes(close2)) return null;
  // Second range must start AFTER first range ends (no overlap)
  if (timeToMinutes(open2) <= timeToMinutes(close1)) return null;

  return { openTime: open1, closeTime: close1, openTime2: open2, closeTime2: close2 };
}

/** Ναι/Όχι inline keyboard buttons — reused for every yes/no prompt. */
const YES_NO_BUTTONS = [[{ text: 'Ναι', callback_data: 'ναι' }, { text: 'Όχι', callback_data: 'όχι' }]];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCollectedData(raw: string | null): CollectedData {
  try {
    return JSON.parse(raw ?? '{}') as CollectedData;
  } catch {
    return {};
  }
}

function serializeCollectedData(data: CollectedData): string {
  return JSON.stringify(data);
}

// ---------------------------------------------------------------------------
// Step handlers
// ---------------------------------------------------------------------------

/**
 * Collects the business name, generates a slug, updates the businesses row,
 * and advances the session to the first hours-query step.
 */
export async function handleNameStep(
  session: OnboardingSession,
  business: Business,
  ownerTelegramId: string,
  text: string
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 100) {
    await sendTelegramMessage(
      ownerTelegramId,
      'Παρακαλώ εισάγετε ένα έγκυρο όνομα (1-100 χαρακτήρες):'
    );
    return;
  }

  const existingSlugsRows = await db.select({ slug: businesses.slug }).from(businesses);
  const existingSlugs = existingSlugsRows.map((r) => r.slug);
  const slug = generateSlug(trimmed, existingSlugs);

  await db
    .update(businesses)
    .set({ name: trimmed, slug })
    .where(eq(businesses.id, business.id));

  await updateOnboardingStep(session.id, 'hours_0_query', null);
  await sendTelegramMessageWithKeyboard(ownerTelegramId, 'Είστε ανοιχτά την Κυριακή;', YES_NO_BUTTONS);
}

/**
 * Asks whether the business is open on the given day.
 * 'yes' → advances to open-time prompt.
 * 'no'  → inserts a closed-day row and advances to the next day (or services if day 6).
 * Unrecognized → re-sends the same question without advancing.
 *
 * Per Pitfall 3 (RESEARCH.md): closed days ALWAYS insert a business_hours row
 * (isClosed: true, openTime: '00:00', closeTime: '00:00') — never skip the insert.
 */
export async function handleHoursQueryStep(
  day: number,
  session: OnboardingSession,
  business: Business,
  ownerTelegramId: string,
  text: string
): Promise<void> {
  const normalized = text.trim().toLowerCase();
  const isYes = normalized.includes('ναι') || normalized.includes('yes');
  const isNo = normalized.includes('όχι') || normalized.includes('no');

  if (isYes) {
    const nextStep = `hours_${day}_range` as OnboardingStep;
    await updateOnboardingStep(session.id, nextStep, null);
    await sendTelegramMessage(
      ownerTelegramId,
      `Ώρες ${GREEK_DAY_NAMES[day]} (π.χ. 09:00-18:00 ή 09:00-13:00,17:00-21:00):`
    );
  } else if (isNo) {
    // Always insert the closed-day row — never skip (Pitfall 3)
    await db
      .insert(businessHours)
      .values({
        businessId: business.id,
        dayOfWeek: day,
        openTime: '00:00',
        closeTime: '00:00',
        isClosed: true,
      })
      .onConflictDoNothing();

    if (day < 6) {
      const nextStep = `hours_${day + 1}_query` as OnboardingStep;
      await updateOnboardingStep(session.id, nextStep, null);
      await sendTelegramMessageWithKeyboard(
        ownerTelegramId,
        `Είστε ανοιχτά την ${GREEK_DAY_NAMES[day + 1]};`,
        YES_NO_BUTTONS
      );
    } else {
      // Saturday (day 6) — transition to service collection
      await updateOnboardingStep(session.id, 'svc_name', null);
      await sendTelegramMessage(
        ownerTelegramId,
        'Ωραία! Προσθέστε μια υπηρεσία.\nΌνομα υπηρεσίας: (π.χ. Reformer Pilates)'
      );
    }
  } else {
    // Unrecognized input — re-send the same question without advancing
    await sendTelegramMessageWithKeyboard(
      ownerTelegramId,
      `Είστε ανοιχτά την ${GREEK_DAY_NAMES[day]};`,
      YES_NO_BUTTONS
    );
  }
}

/**
 * Collects a single time range (or split range) for a day.
 * Accepts "HH:MM-HH:MM" or "HH:MM-HH:MM,HH:MM-HH:MM" (split hours).
 * Validates via parseTimeRange before writing the business_hours row.
 * Advances to the next day's query step, or to 'svc_name' after Saturday (day 6).
 */
export async function handleHoursRangeStep(
  day: number,
  session: OnboardingSession,
  business: Business,
  ownerTelegramId: string,
  text: string
): Promise<void> {
  const parsed = parseTimeRange(text);
  const exampleText = 'π.χ. 09:00-18:00 ή 09:00-13:00,17:00-21:00';

  if (!parsed) {
    await sendTelegramMessage(
      ownerTelegramId,
      `Μη έγκυρο. Χρησιμοποιήστε μορφή ΩΩ:ΛΛ-ΩΩ:ΛΛ (${exampleText}):`
    );
    return;
  }

  await db
    .insert(businessHours)
    .values({
      businessId: business.id,
      dayOfWeek: day,
      openTime: parsed.openTime,
      closeTime: parsed.closeTime,
      openTime2: parsed.openTime2,
      closeTime2: parsed.closeTime2,
      isClosed: false,
    })
    .onConflictDoNothing();

  if (day < 6) {
    const nextStep = `hours_${day + 1}_query` as OnboardingStep;
    await updateOnboardingStep(session.id, nextStep, null);
    await sendTelegramMessageWithKeyboard(
      ownerTelegramId,
      `Είστε ανοιχτά την ${GREEK_DAY_NAMES[day + 1]};`,
      YES_NO_BUTTONS
    );
  } else {
    await updateOnboardingStep(session.id, 'svc_name', null);
    await sendTelegramMessage(
      ownerTelegramId,
      'Ωραία! Προσθέστε μια υπηρεσία.\nΌνομα υπηρεσίας: (π.χ. Reformer Pilates)'
    );
  }
}

/**
 * Collects the service name, stores it in collectedData, and advances to svc_price.
 * Per Pitfall 6: always resets currentService to avoid stale partial data from a
 * previous service entry.
 */
export async function handleSvcNameStep(
  session: OnboardingSession,
  _business: Business,
  ownerTelegramId: string,
  text: string
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 100) {
    await sendTelegramMessage(
      ownerTelegramId,
      'Παρακαλώ εισάγετε ένα έγκυρο όνομα υπηρεσίας (1-100 χαρακτήρες):'
    );
    return;
  }

  // Reset currentService to clear any stale partial data from a previous entry
  const collectedData: CollectedData = {
    currentService: { name: trimmed },
  };
  await updateOnboardingStep(session.id, 'svc_price', serializeCollectedData(collectedData));
  await sendTelegramMessage(ownerTelegramId, 'Τιμή σε λεπτά ευρώ (π.χ. 2000 = 20€):');
}

/**
 * Collects the service price (in euro cents).
 * Validates that the parsed integer is > 0.
 * Stores price in collectedData and advances to svc_duration.
 */
export async function handleSvcPriceStep(
  session: OnboardingSession,
  _business: Business,
  ownerTelegramId: string,
  text: string
): Promise<void> {
  const parsed = parseInt(text.trim(), 10);
  if (isNaN(parsed) || parsed <= 0) {
    await sendTelegramMessage(
      ownerTelegramId,
      'Μη έγκυρη τιμή. Εισάγετε θετικό ακέραιο αριθμό (π.χ. 2000):'
    );
    return;
  }

  const collectedData = parseCollectedData(session.collectedData);
  if (!collectedData.currentService) {
    collectedData.currentService = {};
  }
  collectedData.currentService.price = parsed;

  await updateOnboardingStep(session.id, 'svc_duration', serializeCollectedData(collectedData));
  await sendTelegramMessage(ownerTelegramId, 'Διάρκεια σε λεπτά (π.χ. 60):');
}

/**
 * Collects the service duration (in minutes) and inserts the complete service row.
 * Validates that the parsed integer is > 0.
 * Clears collectedData.currentService after insert.
 */
export async function handleSvcDurationStep(
  session: OnboardingSession,
  business: Business,
  ownerTelegramId: string,
  text: string
): Promise<void> {
  const parsed = parseInt(text.trim(), 10);
  if (isNaN(parsed) || parsed <= 0) {
    await sendTelegramMessage(
      ownerTelegramId,
      'Μη έγκυρη διάρκεια. Εισάγετε θετικό ακέραιο (π.χ. 60):'
    );
    return;
  }

  const collectedData = parseCollectedData(session.collectedData);
  const name = collectedData.currentService?.name;
  const price = collectedData.currentService?.price;

  if (!name) {
    // Should not happen in normal flow — guard for data integrity
    logger.warn({ sessionId: session.id }, 'handleSvcDurationStep: missing service name in collectedData; resetting to svc_name');
    await updateOnboardingStep(session.id, 'svc_name', null);
    await sendTelegramMessage(ownerTelegramId, 'Σφάλμα: λείπει το όνομα υπηρεσίας. Ξεκινήστε ξανά:');
    return;
  }

  await db.insert(services).values({
    businessId: business.id,
    name,
    price: price ?? null,
    durationMin: parsed,
  });

  // Clear currentService from collectedData after successful insert
  await updateOnboardingStep(session.id, 'svc_more', null);
  await sendTelegramMessageWithKeyboard(
    ownerTelegramId,
    'Υπηρεσία αποθηκεύτηκε! Θέλετε να προσθέσετε άλλη;',
    YES_NO_BUTTONS
  );
}

/**
 * Asks whether the owner wants to add another service.
 * 'yes' → resets currentService to {} (Pitfall 6) and returns to svc_name.
 * 'no'  → calls handleActivate to complete onboarding.
 * Unrecognized → re-sends the question without advancing.
 */
export async function handleSvcMoreStep(
  session: OnboardingSession,
  business: Business,
  ownerTelegramId: string,
  text: string
): Promise<void> {
  const normalized = text.trim().toLowerCase();
  const isYes = normalized.includes('ναι') || normalized.includes('yes');
  const isNo = normalized.includes('όχι') || normalized.includes('no');

  if (isYes) {
    // Per Pitfall 6: clear stale partial data before starting a fresh service entry
    const collectedData: CollectedData = { currentService: {} };
    await updateOnboardingStep(session.id, 'svc_name', serializeCollectedData(collectedData));
    await sendTelegramMessage(ownerTelegramId, 'Όνομα νέας υπηρεσίας: (π.χ. Reformer Pilates)');
  } else if (isNo) {
    await updateOnboardingStep(session.id, 'config_booking_mode', null);
    await sendTelegramMessage(
      ownerTelegramId,
      'Θέλετε να χρησιμοποιήσετε πρόγραμμα τάξεων (ορισμένες ώρες) αντί για ελεύθερες θέσεις;\n' +
      'Απαντήστε "ναι" για πρόγραμμα τάξεων, "όχι" για ελεύθερες θέσεις, ή "παράλειψη".\n' +
      '(προεπιλογή: ελεύθερες θέσεις)'
    );
  } else {
    // Unrecognized input — re-send the question without advancing
    await sendTelegramMessageWithKeyboard(
      ownerTelegramId,
      'Θέλετε να προσθέσετε άλλη υπηρεσία;',
      YES_NO_BUTTONS
    );
  }
}

/**
 * Activates the business by:
 * 1. Generating a new webhookId (UUID) and webhookSecret (32 random bytes hex).
 * 2. Calling unregisterBotWebhook first (STATE.md blocker / T-05-09) to avoid
 *    "another webhook is active" conflicts on re-registration.
 * 3. Calling registerBotWebhook to set the new webhook URL.
 * 4. Persisting webhookId and webhookSecret via activateBusiness.
 * 5. Advancing the session to 'done'.
 * 6. Sending a Greek confirmation to the owner.
 */
export async function handleActivate(
  session: OnboardingSession,
  business: Business,
  ownerTelegramId: string
): Promise<void> {
  const webhookId = crypto.randomUUID();
  const webhookSecret = crypto.randomBytes(32).toString('hex');

  if (!config.webhookBaseUrl) {
    await sendTelegramMessage(
      ownerTelegramId,
      'Σφάλμα: το WEBHOOK_BASE_URL δεν έχει οριστεί. Επικοινωνήστε με τον διαχειριστή.'
    );
    return;
  }

  // Always unregister before registering to prevent webhook conflicts (T-05-09)
  await unregisterBotWebhook(business.botToken!);
  await registerBotWebhook(
    business.botToken!,
    `${config.webhookBaseUrl}/webhooks/telegram/${webhookId}`,
    webhookSecret
  );

  await activateBusiness(business.id, webhookId, webhookSecret);
  await updateOnboardingStep(session.id, 'done', null);

  logger.info({ businessId: business.id, webhookId }, 'Business activated via onboarding');

  await sendTelegramMessage(
    ownerTelegramId,
    'Η επιχείρησή σας είναι ενεργή! Οι πελάτες μπορούν τώρα να κάνουν κράτηση μέσω του bot σας.'
  );
}

export async function handleConfigBookingModeStep(
  session: OnboardingSession,
  business: Business,
  ownerTelegramId: string,
  text: string
): Promise<void> {
  const normalized = text.trim().toLowerCase();
  const isYes = normalized.includes('ναι') || normalized.includes('yes');

  if (isYes) {
    await db.update(businesses).set({ bookingMode: 'fixed_sessions' }).where(eq(businesses.id, business.id));
  }

  await updateOnboardingStep(session.id, 'config_cancellation_cutoff', null);
  await sendTelegramMessage(
    ownerTelegramId,
    'Θέλετε όριο ακύρωσης κράτησης;\n' +
    'Απαντήστε π.χ. "ναι 8" για 8 ώρες, "όχι" για απενεργοποίηση, ή "παράλειψη".\n' +
    '(προεπιλογή: απενεργοποιημένο)'
  );
}

export async function handleConfigCancellationCutoffStep(
  session: OnboardingSession,
  business: Business,
  ownerTelegramId: string,
  text: string
): Promise<void> {
  const normalized = text.trim().toLowerCase();
  const isNo = normalized === 'όχι' || normalized === 'no' || normalized.includes('παράλειψη') || normalized.includes('skip');
  const match = text.match(/ναι\s+(\d+)/i);

  if (!isNo && match) {
    const hours = Math.min(168, Math.max(1, Number.parseInt(match[1], 10)));
    await db.update(businesses)
      .set({ cancellationCutoffEnabled: true, cancellationCutoffHours: hours })
      .where(eq(businesses.id, business.id));
  }

  await updateOnboardingStep(session.id, 'config_slotless_requests', null);
  await sendTelegramMessage(
    ownerTelegramId,
    'Θέλετε να επιτρέπετε αιτήματα κράτησης όταν δεν υπάρχει διαθέσιμη θέση;\n' +
    'Απαντήστε "ναι" ή "όχι".\n' +
    '(προεπιλογή: απενεργοποιημένο)'
  );
}

export async function handleConfigSlotlessRequestsStep(
  session: OnboardingSession,
  business: Business,
  ownerTelegramId: string,
  text: string
): Promise<void> {
  const normalized = text.trim().toLowerCase();
  const isYes = normalized.includes('ναι') || normalized.includes('yes');

  if (isYes) {
    await db.update(businesses)
      .set({ slotlessRequestsEnabled: true })
      .where(eq(businesses.id, business.id));
  }

  await updateOnboardingStep(session.id, 'config_last_session_threshold', null);
  await sendTelegramMessage(
    ownerTelegramId,
    'Θέλετε ειδοποίηση ανανέωσης όταν ένας πελάτης έχει λίγα εναπομείναντα μαθήματα;\n' +
    'Απαντήστε π.χ. "ναι 2" για ειδοποίηση στα 2 μαθήματα, "όχι" ή "παράλειψη".\n' +
    '(προεπιλογή: απενεργοποιημένο)'
  );
}

export async function handleConfigLastSessionThresholdStep(
  session: OnboardingSession,
  business: Business,
  ownerTelegramId: string,
  text: string
): Promise<void> {
  const normalized = text.trim().toLowerCase();
  const isNo = normalized === 'όχι' || normalized === 'no' || normalized.includes('παράλειψη') || normalized.includes('skip');
  const match = text.match(/ναι\s+(\d+)/i);

  if (!isNo && match) {
    const count = Math.min(20, Math.max(1, Number.parseInt(match[1], 10)));
    await db.update(businesses)
      .set({ lastSessionThresholdEnabled: true, lastSessionThresholdCount: count })
      .where(eq(businesses.id, business.id));
  }

  await handleActivate(session, business, ownerTelegramId);
}
