import { and, eq, not } from 'drizzle-orm';
import { db } from '../database/db';
import { onboardingSessions, businesses } from '../database/schema';
import type { Business } from '../database/queries';

// All functions in this module use the admin `db` (bypasses RLS).
// Onboarding operations are cross-tenant — the platform bot must look up
// sessions across all businesses. The RLS-scoped app connection is not used here.

export interface OnboardingSession {
  id: number;
  businessId: number;
  currentStep: string;
  collectedData: string | null;
  createdAt: Date;
  updatedAt: Date;
}

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
 * Finds the active onboarding session for a given owner Telegram ID.
 * "Active" means currentStep != 'done'. A completed session (step = 'done') is
 * excluded so that a re-registration attempt starts a fresh session.
 * Returns { session, business } or null if no active session exists.
 */
export async function findActiveSessionByOwnerTelegramId(
  ownerTelegramId: string
): Promise<{ session: OnboardingSession; business: Business } | null> {
  const rows = await db
    .select({ session: onboardingSessions, business: businesses })
    .from(onboardingSessions)
    .innerJoin(businesses, eq(onboardingSessions.businessId, businesses.id))
    .where(
      and(
        eq(businesses.ownerTelegramId, ownerTelegramId),
        not(eq(onboardingSessions.currentStep, 'done'))
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Creates a new onboarding session, or resets an existing one to the given
 * initial step. onConflictDoUpdate targets the unique index on businessId so
 * that re-registration (same owner re-submitting their bot token) is handled
 * atomically without creating duplicate rows (T-05-05 mitigation).
 */
export async function createOrResetOnboardingSession(
  businessId: number,
  initialStep: string
): Promise<OnboardingSession> {
  const rows = await db
    .insert(onboardingSessions)
    .values({ businessId, currentStep: initialStep, collectedData: null })
    .onConflictDoUpdate({
      target: onboardingSessions.businessId,
      set: { currentStep: initialStep, collectedData: null, updatedAt: new Date() },
    })
    .returning();
  return rows[0];
}

/**
 * Advances the onboarding session to the next step, persisting any
 * collected mid-step data as a JSON string in collectedData.
 */
export async function updateOnboardingStep(
  sessionId: number,
  nextStep: string,
  collectedData: string | null
): Promise<void> {
  await db
    .update(onboardingSessions)
    .set({ currentStep: nextStep, collectedData, updatedAt: new Date() })
    .where(eq(onboardingSessions.id, sessionId));
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
