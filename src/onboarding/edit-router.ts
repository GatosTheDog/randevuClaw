import { eq } from 'drizzle-orm';
import { db } from '../database/db';
import { services, businessHours } from '../database/schema';
import { listServicesForBusiness } from '../database/queries';
import type { Business } from '../database/queries';
import { sendTelegramMessage } from '../telegram/client';

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
const GREEK_DAY_NAME_TO_INDEX: Record<string, number> = {
  κυριακή: 0,
  δευτέρα: 1,
  τρίτη: 2,
  τετάρτη: 3,
  πέμπτη: 4,
  παρασκευή: 5,
  σάββατο: 6,
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
  const normalized = text.trim().toLowerCase();
  return OWNER_EDIT_KEYWORDS.some((kw) => normalized.includes(kw));
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
  // STEP 1 — Normalize
  // -----------------------------------------------------------------------
  const normalized = messageText.trim().toLowerCase();

  // -----------------------------------------------------------------------
  // STEP 2 — αλλαγή ωραρίου
  // -----------------------------------------------------------------------
  if (normalized.includes('αλλαγή ωραρίου')) {
    const kwIndex = normalized.indexOf('αλλαγή ωραρίου');
    const dataStr = normalized.slice(kwIndex + 'αλλαγή ωραρίου'.length).trim();

    if (!dataStr) {
      await sendTelegramMessage(
        ownerTelegramId,
        'Αλλαγή ωραρίου: στείλτε "αλλαγή ωραρίου [ημέρα],[ώρα έναρξης],[ώρα λήξης]" — π.χ.: αλλαγή ωραρίου Δευτέρα,09:00,17:00'
      );
      return;
    }

    const parts = dataStr.split(',');
    const dayNameKey = parts[0]?.trim().toLowerCase() ?? '';
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
  if (normalized.includes('νέα υπηρεσία')) {
    const kwIndex = normalized.indexOf('νέα υπηρεσία');
    const dataStr = normalized.slice(kwIndex + 'νέα υπηρεσία'.length).trim();

    if (!dataStr) {
      await sendTelegramMessage(
        ownerTelegramId,
        'Νέα υπηρεσία: στείλτε "νέα υπηρεσία [όνομα],[τιμή σε λεπτά],[διάρκεια σε λεπτά]" — π.χ.: νέα υπηρεσία Reformer,2000,60'
      );
      return;
    }

    // Use original messageText for name (preserve casing), but split from the
    // keyword position in normalized to correctly locate the data boundary.
    const originalAfterKw = messageText.trim().slice(
      messageText.trim().toLowerCase().indexOf('νέα υπηρεσία') + 'νέα υπηρεσία'.length
    ).trim();
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
  if (normalized.includes('αλλαγή τιμής')) {
    const serviceList = await listServicesForBusiness(business.id);
    const listText = serviceList
      .map((s, i) => `${i + 1}. ${s.name} — ${s.price ?? '?'} λεπτά`)
      .join('\n');

    const kwIndex = normalized.indexOf('αλλαγή τιμής');
    const dataStr = normalized.slice(kwIndex + 'αλλαγή τιμής'.length).trim();

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
  if (normalized.includes('διαγραφή υπηρεσίας')) {
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
