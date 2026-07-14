import { logger } from '../utils/logger';
import { sendTelegramMessage } from '../telegram/client';
import type { Business } from '../database/queries';
import type { OnboardingSession } from './queries';
import {
  handleNameStep,
  handleHoursQueryStep,
  handleHoursOpenStep,
  handleHoursCloseStep,
  handleSvcNameStep,
  handleSvcPriceStep,
  handleSvcDurationStep,
  handleSvcMoreStep,
} from './steps';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Extracts the day index from an hours step name, e.g. 'hours_3_open' → 3.
 * Returns 0 as a safe fallback if the pattern does not match.
 */
function extractDayIndex(step: string): number {
  const match = /^hours_(\d)_/.exec(step);
  return match ? parseInt(match[1], 10) : 0;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Routes an incoming platform-bot message to the correct step handler based on
 * the session's currentStep. All step handlers are called here; none of the
 * handler-specific routing logic leaks into the platform bot webhook handler.
 *
 * Error isolation: the entire dispatch is wrapped in try/catch so that any
 * unhandled exception inside a step handler sends a Greek error message to the
 * owner rather than propagating to the HTTP handler and causing a 500 response.
 */
export async function dispatchOnboardingStep(
  session: OnboardingSession,
  business: Business,
  ownerTelegramId: string,
  messageText: string
): Promise<void> {
  const step = session.currentStep;

  try {
    if (step === 'name') {
      await handleNameStep(session, business, ownerTelegramId, messageText);
    } else if (/^hours_\d_query$/.test(step)) {
      await handleHoursQueryStep(
        extractDayIndex(step),
        session,
        business,
        ownerTelegramId,
        messageText
      );
    } else if (/^hours_\d_open$/.test(step)) {
      await handleHoursOpenStep(
        extractDayIndex(step),
        session,
        business,
        ownerTelegramId,
        messageText
      );
    } else if (/^hours_\d_close$/.test(step)) {
      await handleHoursCloseStep(
        extractDayIndex(step),
        session,
        business,
        ownerTelegramId,
        messageText
      );
    } else if (step === 'svc_name') {
      await handleSvcNameStep(session, business, ownerTelegramId, messageText);
    } else if (step === 'svc_price') {
      await handleSvcPriceStep(session, business, ownerTelegramId, messageText);
    } else if (step === 'svc_duration') {
      await handleSvcDurationStep(session, business, ownerTelegramId, messageText);
    } else if (step === 'svc_more') {
      await handleSvcMoreStep(session, business, ownerTelegramId, messageText);
    } else if (step === 'done') {
      // Terminal state — should not normally receive messages, but handle gracefully
      await sendTelegramMessage(ownerTelegramId, 'Η επιχείρησή σας είναι ήδη ενεργή.');
    } else {
      logger.warn({ step, ownerTelegramId }, 'Unknown onboarding step encountered');
      await sendTelegramMessage(
        ownerTelegramId,
        'Άγνωστη κατάσταση. Παρακαλώ επικοινωνήστε με την υποστήριξη.'
      );
    }
  } catch (err) {
    logger.error({ err, step, ownerTelegramId }, 'Error in dispatchOnboardingStep');
    try {
      await sendTelegramMessage(
        ownerTelegramId,
        'Προέκυψε σφάλμα. Παρακαλώ δοκιμάστε ξανά ή επικοινωνήστε με την υποστήριξη.'
      );
    } catch (sendErr) {
      logger.error({ sendErr }, 'Failed to send error message to owner during onboarding dispatch');
    }
  }
}
