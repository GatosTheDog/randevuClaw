import { eq } from 'drizzle-orm';
import removeAccents from 'remove-accents';
import { db } from '../database/db';
import { services, businessHours } from '../database/schema';
import { listServicesForBusiness } from '../database/queries';
import type { Business } from '../database/queries';
import { sendTelegramMessage } from '../telegram/client';

function normalize(text: string): string {
  return removeAccents(text.trim().toLowerCase());
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingDeleteEntry {
  id: number;
  name: string;
  price: number | null;
  durationMin: number;
}

// ---------------------------------------------------------------------------
// Module-level state (not exported)
// ---------------------------------------------------------------------------

// Holds the pending service list for the two-turn διαγραφή υπηρεσίας flow.
// Keyed by business.id. Cleared on owner reply (valid or invalid).
const pendingDeleteByBusiness = new Map<number, PendingDeleteEntry[]>();

// ---------------------------------------------------------------------------
// Constants (not exported)
// ---------------------------------------------------------------------------

// Matches exactly HH:MM in 24-hour format, anchored at start and end.
const TIME_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

// Greek day names → JS Date.getDay() convention (0=Sunday..6=Saturday).
// Keys are accent-stripped so lookup works regardless of tonos in user input.
const GREEK_DAY_NAME_TO_INDEX: Record<string, number> = {
  κυριακη: 0,
  δευτερα: 1,
  τριτη: 2,
  τεταρτη: 3,
  πεμπτη: 4,
  παρασκευη: 5,
  σαββατο: 6,
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Greek edit commands per D-06.
 * Used by isOwnerEditCommand and listed here for reference in tests.
 */
export const OWNER_EDIT_KEYWORDS: readonly string[] = [
  'αλλαγή ωραρίου',
  'νέα υπηρεσία',
  'αλλαγή τιμής',
  'διαγραφή υπηρεσίας',
];

/**
 * Returns true when the message text contains any owner edit keyword.
 * Case-insensitive (trimmed + lowercased before comparison).
 */
export function isOwnerEditCommand(text: string): boolean {
  const n = normalize(text);
  return OWNER_EDIT_KEYWORDS.some((kw) => n.includes(normalize(kw)));
}

/**
 * Returns true when a pending deletion state exists for the given business.
 * Called from the telegram.ts intercept to route the owner's second-turn
 * number reply back to routeOwnerEdit (the διαγραφή υπηρεσίας confirmation turn).
 */
export function hasPendingEditState(businessId: number): boolean {
  return pendingDeleteByBusiness.has(businessId);
}

/**
 * Routes an owner text message to the appropriate single-turn edit handler.
 * Handles αλλαγή ωραρίου, νέα υπηρεσία, αλλαγή τιμής, and the two-turn
 * διαγραφή υπηρεσίας flow. All four keywords write to the DB when inline
 * data is provided; keyword-only messages send format instructions.
 *
 * Called only after the caller has already verified the sender is the owner.
 * botTokenStore context is already set by the per-business bot handler.
 */
export async function routeOwnerEdit(
  business: Business,
  ownerTelegramId: string,
  messageText: string
): Promise<void> {
  // -----------------------------------------------------------------------
  // STEP 0 — Pending delete confirmation (must run BEFORE keyword matching)
  // -----------------------------------------------------------------------
  if (pendingDeleteByBusiness.has(business.id)) {
    const serviceList = pendingDeleteByBusiness.get(business.id)!;
    // Clear the pending state immediately — even on an invalid reply — so the
    // owner is not stuck in a loop if they send garbage.
    pendingDeleteByBusiness.delete(business.id);

    const parsedIndex = parseInt(messageText.trim(), 10);
    if (isNaN(parsedIndex) || parsedIndex < 1 || parsedIndex > serviceList.length) {
      await sendTelegramMessage(ownerTelegramId, 'Μη έγκυρος αριθμός. Η διαγραφή ακυρώθηκε.');
      return;
    }

    const svc = serviceList[parsedIndex - 1];
    await db.delete(services).where(eq(services.id, svc.id));
    await sendTelegramMessage(ownerTelegramId, `Η υπηρεσία "${svc.name}" διαγράφηκε.`);
    return;
  }

  // -----------------------------------------------------------------------
  // STEP 1 — Normalize (accent-stripped + lowercase for keyword matching)
  // -----------------------------------------------------------------------
  const normalized = normalize(messageText);

  // -----------------------------------------------------------------------
  // STEP 2 — αλλαγή ωραρίου
  // -----------------------------------------------------------------------
  const KW_HOURS = normalize('αλλαγή ωραρίου');
  const KW_NEW_SVC = normalize('νέα υπηρεσία');
  const KW_PRICE = normalize('αλλαγή τιμής');
  const KW_DELETE = normalize('διαγραφή υπηρεσίας');

  if (normalized.includes(KW_HOURS)) {
    const kwIndex = normalized.indexOf(KW_HOURS);
    const dataStr = normalized.slice(kwIndex + KW_HOURS.length).trim();

    if (!dataStr) {
      await sendTelegramMessage(
        ownerTelegramId,
        'Αλλαγή ωραρίου: στείλτε "αλλαγή ωραρίου [ημέρα],[ώρα έναρξης],[ώρα λήξης]" — π.χ.: αλλαγή ωραρίου Δευτέρα,09:00,17:00'
      );
      return;
    }

    const parts = dataStr.split(',');
    const dayNameKey = normalize(parts[0]?.trim() ?? '');
    const openTime = parts[1]?.trim() ?? '';
    const closeTime = parts[2]?.trim() ?? '';
    const dayOfWeek = GREEK_DAY_NAME_TO_INDEX[dayNameKey];

    if (dayOfWeek === undefined || !TIME_REGEX.test(openTime) || !TIME_REGEX.test(closeTime)) {
      await sendTelegramMessage(
        ownerTelegramId,
        'Μη έγκυρα στοιχεία. Στείλτε π.χ.: αλλαγή ωραρίου Δευτέρα,09:00,17:00'
      );
      return;
    }

    await db.insert(businessHours)
      .values({ businessId: business.id, dayOfWeek, openTime, closeTime, isClosed: false })
      .onConflictDoUpdate({
        target: [businessHours.businessId, businessHours.dayOfWeek],
        set: { openTime, closeTime, isClosed: false },
      });

    await sendTelegramMessage(
      ownerTelegramId,
      `Ωράριο ${parts[0].trim()} ενημερώθηκε: ${openTime}-${closeTime}.`
    );
    return;
  }

  // -----------------------------------------------------------------------
  // STEP 3 — νέα υπηρεσία
  // -----------------------------------------------------------------------
  if (normalized.includes(KW_NEW_SVC)) {
    const kwIndex = normalized.indexOf(KW_NEW_SVC);
    const dataStr = normalized.slice(kwIndex + KW_NEW_SVC.length).trim();

    if (!dataStr) {
      await sendTelegramMessage(
        ownerTelegramId,
        'Νέα υπηρεσία: στείλτε "νέα υπηρεσία [όνομα],[τιμή σε λεπτά],[διάρκεια σε λεπτά]" — π.χ.: νέα υπηρεσία Reformer,2000,60'
      );
      return;
    }

    // Use original messageText for name (preserve casing); find data boundary
    // via the accent-stripped normalized string's keyword position.
    const originalAfterKw = messageText.trim().slice(kwIndex + KW_NEW_SVC.length).trim();
    const rawParts = originalAfterKw.split(',');
    const name = rawParts[0]?.trim() ?? '';
    const price = parseInt(rawParts[1]?.trim() ?? '', 10);
    const durationMin = parseInt(rawParts[2]?.trim() ?? '', 10);

    if (!name || name.length > 100 || !(price > 0) || !(durationMin > 0)) {
      await sendTelegramMessage(
        ownerTelegramId,
        'Μη έγκυρα στοιχεία. Στείλτε π.χ.: νέα υπηρεσία Reformer,2000,60'
      );
      return;
    }

    await db.insert(services).values({ businessId: business.id, name, price, durationMin });
    await sendTelegramMessage(ownerTelegramId, `Η υπηρεσία "${name}" προστέθηκε.`);
    return;
  }

  // -----------------------------------------------------------------------
  // STEP 4 — αλλαγή τιμής
  // -----------------------------------------------------------------------
  if (normalized.includes(KW_PRICE)) {
    const serviceList = await listServicesForBusiness(business.id);
    const listText = serviceList
      .map((s, i) => `${i + 1}. ${s.name} — ${s.price ?? '?'} λεπτά`)
      .join('\n');

    const kwIndex = normalized.indexOf(KW_PRICE);
    const dataStr = normalized.slice(kwIndex + KW_PRICE.length).trim();

    if (!dataStr) {
      await sendTelegramMessage(
        ownerTelegramId,
        `${listText}\nΑλλαγή τιμής: στείλτε "αλλαγή τιμής [αριθμός],[νέα τιμή σε λεπτά]" — π.χ.: αλλαγή τιμής 1,2000`
      );
      return;
    }

    const rawParts = dataStr.split(',');
    const idx = parseInt(rawParts[0]?.trim() ?? '', 10) - 1;
    const newPrice = parseInt(rawParts[1]?.trim() ?? '', 10);

    if (idx < 0 || idx >= serviceList.length || !(newPrice > 0)) {
      await sendTelegramMessage(ownerTelegramId, `${listText}\nΜη έγκυρα στοιχεία.`);
      return;
    }

    const svc = serviceList[idx];
    await db.update(services).set({ price: newPrice }).where(eq(services.id, svc.id));
    await sendTelegramMessage(
      ownerTelegramId,
      `Η τιμή της υπηρεσίας "${svc.name}" ενημερώθηκε σε ${newPrice} λεπτά.`
    );
    return;
  }

  // -----------------------------------------------------------------------
  // STEP 5 — διαγραφή υπηρεσίας
  // -----------------------------------------------------------------------
  if (normalized.includes(KW_DELETE)) {
    const serviceList = await listServicesForBusiness(business.id);

    if (serviceList.length === 0) {
      await sendTelegramMessage(ownerTelegramId, 'Δεν υπάρχουν καταχωρημένες υπηρεσίες.');
      return;
    }

    const listText = serviceList
      .map((s, i) => `${i + 1}. ${s.name} — ${s.price ?? '?'} λεπτά`)
      .join('\n');

    // Store service list (with nullable price preserved as-is) for the second turn.
    pendingDeleteByBusiness.set(business.id, serviceList);

    await sendTelegramMessage(
      ownerTelegramId,
      `${listText}\nΣτείλτε τον αριθμό της υπηρεσίας για διαγραφή:`
    );
    return;
  }
}
