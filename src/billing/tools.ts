// Phase 7: Billing tool handlers for the owner AI agent.
//
// These handlers sit between the Gemini NLU (ai-owner-agent.ts) and the DB
// query layer (billing/queries.ts). Each handler validates Gemini-parsed args
// via Zod before any DB write (T-07-02) and returns Greek-language strings.

import { z } from 'zod';
import {
  createPackage,
  listPackages,
  deactivatePackage,
  getClientActiveMembership,
  setBusinessEnforcementPolicy,
} from './queries';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Zod schema for create_package Gemini tool args (T-07-02 input validation)
// ---------------------------------------------------------------------------

export const CreatePackageSchema = z.object({
  name: z.string().min(1, 'Το όνομα πακέτου είναι υποχρεωτικό'),
  price_cents: z.number().int().min(0, 'Η τιμή πρέπει να είναι μη αρνητική'),
  valid_days: z.number().int().min(1, 'Η διάρκεια πρέπει να είναι τουλάχιστον 1 μέρα'),
  // null = unlimited sessions (D-02: Gemini maps "απεριόριστες" keywords to null)
  session_count: z.number().int().min(1).nullable(),
});

export interface CreatePackageResult {
  confirmationText: string;
  pendingPackageId: number;
}

// ---------------------------------------------------------------------------
// Zod schema for set_enforcement_policy Gemini tool args (ENFC-01 input validation)
// ---------------------------------------------------------------------------

export const SetEnforcementPolicySchema = z.object({
  policy: z.enum(['allow', 'block', 'flag']),
});

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

/**
 * Validates Gemini-parsed args (T-07-02) and creates a pending package row.
 *
 * D-03: Package is created with isActive: false (pending confirmation).
 * The row is activated only after the owner confirms via handleConfirmPackage.
 * On invalid args, returns a Greek error string and performs NO DB write.
 */
export async function handleCreatePackage(
  businessId: number,
  args: Record<string, unknown>
): Promise<CreatePackageResult | string> {
  const parsed = CreatePackageSchema.safeParse(args);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return `Σφάλμα επικύρωσης: ${firstIssue?.message ?? 'Μη έγκυρα δεδομένα'}`;
  }

  const { name, price_cents, valid_days, session_count } = parsed.data;

  try {
    // D-03: createPackage() inserts with isActive: false — pending owner confirmation.
    // The pending package is activated only via handleConfirmPackage after owner taps Ναι.
    const pendingPackageId = await createPackage(businessId, {
      name,
      priceCents: price_cents,
      validDays: valid_days,
      sessionCount: session_count,
    });

    const sessionCountLine =
      session_count === null ? 'Συνεδρίες: Απεριόριστες' : `Συνεδρίες: ${session_count}`;

    const confirmationText = [
      '📦 Νέο πακέτο:',
      `Όνομα: ${name}`,
      `Τιμή: €${(price_cents / 100).toFixed(2)}`,
      `Διάρκεια: ${valid_days} ημέρες`,
      sessionCountLine,
      '',
      'Δημιουργώ;',
    ].join('\n');

    logger.info({ businessId, pendingPackageId }, 'Package pending confirmation created');

    return { confirmationText, pendingPackageId };
  } catch (err) {
    logger.error({ err, businessId }, 'handleCreatePackage failed');
    return 'Σφάλμα κατά τη δημιουργία πακέτου. Δοκιμάστε ξανά.';
  }
}

/**
 * Lists all active packages for a business, formatted in Greek.
 * Returns an empty-state Greek message when no active packages exist.
 */
export async function handleListPackages(businessId: number): Promise<string> {
  try {
    const packages = await listPackages(businessId);

    if (packages.length === 0) {
      return 'Δεν υπάρχουν ενεργά πακέτα.';
    }

    const lines = packages.map(
      (p) =>
        `• ${p.name}: ${
          p.sessionCount === null ? 'Απεριόριστες' : p.sessionCount + ' συνεδρίες'
        }, €${(p.priceCents / 100).toFixed(2)}, ${p.validDays} ημέρες`
    );

    return '📦 Ενεργά πακέτα:\n' + lines.join('\n');
  } catch (err) {
    logger.error({ err, businessId }, 'handleListPackages failed');
    return 'Σφάλμα κατά την ανάκτηση πακέτων. Δοκιμάστε ξανά.';
  }
}

/**
 * Soft-deactivates a billing package (isActive → false).
 * Existing memberships referencing this packageId are NOT affected — they
 * retain their session counts and expiry dates after the package is deactivated.
 */
export async function handleDeactivatePackage(packageId: number): Promise<string> {
  try {
    await deactivatePackage(packageId);
    return 'Το πακέτο απενεργοποιήθηκε. Υπάρχουσες συνδρομές δεν επηρεάζονται.';
  } catch (err) {
    logger.error({ err, packageId }, 'handleDeactivatePackage failed');
    return 'Σφάλμα κατά την απενεργοποίηση πακέτου. Δοκιμάστε ξανά.';
  }
}

/**
 * Validates Gemini-parsed args (ENFC-01) and updates the business enforcement policy.
 *
 * SetEnforcementPolicySchema Zod enum validates the policy value before any DB write.
 * On invalid args, returns a Greek error string and performs NO DB write (T-08-10 / T-08-11).
 * On success, logs the change and returns a Greek confirmation string.
 */
export async function handleSetEnforcementPolicy(
  businessId: number,
  args: Record<string, unknown>
): Promise<string> {
  const parsed = SetEnforcementPolicySchema.safeParse(args);
  if (!parsed.success) {
    return 'Μη έγκυρη πολιτική. Επιτρεπτές τιμές: allow, block, flag.';
  }

  try {
    await setBusinessEnforcementPolicy(businessId, parsed.data.policy);
    logger.info({ businessId, policy: parsed.data.policy }, 'Enforcement policy set via NLU');
    return 'Η πολιτική κρατήσεων ορίστηκε σε: ' + parsed.data.policy + '.';
  } catch (err) {
    logger.error({ err, businessId }, 'handleSetEnforcementPolicy failed');
    return 'Σφάλμα κατά την ενημέρωση πολιτικής. Δοκιμάστε ξανά.';
  }
}

/**
 * Returns the client's active membership for a business, formatted in Greek.
 * Returns a not-found Greek message when no active non-expired membership exists.
 */
export async function handleViewClientMembership(
  businessId: number,
  clientPhone: string
): Promise<string> {
  try {
    const membership = await getClientActiveMembership(businessId, clientPhone);

    if (!membership) {
      return 'Δεν βρέθηκε ενεργή συνδρομή για αυτόν τον πελάτη.';
    }

    const sessionsLine = membership.isUnlimited
      ? 'Απεριόριστες'
      : `${membership.sessionsRemaining} εναπομείναντα`;

    const expiresAtStr = membership.expiresAt.toLocaleDateString('el-GR', {
      timeZone: 'Europe/Athens',
    });

    return [
      '📋 Ενεργή συνδρομή:',
      `Πακέτο: ${membership.packageName}`,
      `Συνεδρίες: ${sessionsLine}`,
      `Λήγει: ${expiresAtStr}`,
    ].join('\n');
  } catch (err) {
    logger.error({ err, businessId, clientPhone }, 'handleViewClientMembership failed');
    return 'Σφάλμα κατά την ανάκτηση συνδρομής. Δοκιμάστε ξανά.';
  }
}
