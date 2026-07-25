import { eq } from 'drizzle-orm';
import { db } from '../database/db';
import { businesses } from '../database/schema';
import type { Business } from '../database/queries';

// All functions in this module use the admin `db` (bypasses RLS).
// Onboarding operations are cross-tenant — the platform bot must look up
// sessions across all businesses. The RLS-scoped app connection is not used here.

/**
 * Looks up a business row by the owner's Telegram user ID.
 * Returns null if no business has been registered for that owner yet.
 */
export async function findBusinessByOwnerTelegramId(
  ownerTelegramId: string
): Promise<Business | null> {
  const rows = await db
    .select()
    .from(businesses)
    .where(eq(businesses.ownerTelegramId, ownerTelegramId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Inserts a placeholder businesses row at bot-token-validation time.
 * name and slug are placeholders; the real name is collected in the 'name'
 * onboarding step and written back via an update (RESEARCH.md §A3).
 * botToken and webhookId are set immediately so the routing layer can
 * look up the business by webhookId before the session is complete.
 */
export async function createBusinessForOnboarding(params: {
  ownerTelegramId: string;
  name: string;
  slug: string;
  botToken: string;
  webhookId: string;
  webhookSecret: string;
}): Promise<Business> {
  const rows = await db
    .insert(businesses)
    .values(params)
    .returning();
  return rows[0];
}

/**
 * Updates the business row with its final webhookId and webhookSecret
 * after a successful setWebhook call during the activation step.
 * Separated from createBusinessForOnboarding so the webhookId/Secret
 * can be updated on re-registration without inserting a duplicate row.
 */
export async function activateBusiness(
  businessId: number,
  webhookId: string,
  webhookSecret: string
): Promise<void> {
  await db
    .update(businesses)
    .set({ webhookId, webhookSecret })
    .where(eq(businesses.id, businessId));
}
