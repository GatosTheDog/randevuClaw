import {
  Business,
  findClientBusinessRelationship,
  insertClientBusinessRelationship,
} from '../database/queries';
import { logger } from '../utils/logger';
import { CONSENT_LABELS } from '../utils/greek-messages';

export const CONSENT_NOTICE_GREEK_TEMPLATE = (businessName: string): string =>
  `Για να διαχειριστούμε το ραντεβού σας με την επιχείρηση ${businessName}, αποθηκεύουμε τον αριθμό τηλεφώνου σας και το ιστορικό ραντεβού σας.`;

// Quick task 260729-mlr: builds a Greek summary of only the non-default
// booking-policy flags configured for this business, so a new client learns
// the actual rules before hitting them mid-flow. Returns '' when every flag
// is at its default (open_slots, no cutoff, no slotless requests, 'allow'
// enforcement) — a plain-vanilla business gets zero extra text.
//
// Deliberately excluded (not client-facing restrictions):
// - enforcementPolicy === 'flag': transparent to the client, only alerts the owner.
// - allowMultiBooking: a permissive capability, not a restriction to warn about.
// - lastSessionThresholdEnabled: a later proactive renewal nudge, not an upfront rule.
export const buildPolicySummaryGreek = (business: Business): string => {
  const lines: string[] = [];

  if (business.bookingMode === 'fixed_sessions') {
    lines.push('Οι κρατήσεις γίνονται μέσω σταθερού προγράμματος μαθημάτων, με καθορισμένες ώρες.');
  }

  if (business.cancellationCutoffEnabled) {
    lines.push(
      `Δεν επιτρέπεται ακύρωση μέσα σε ${business.cancellationCutoffHours} ώρες πριν το ραντεβού/μάθημα.`
    );
  }

  if (business.slotlessRequestsEnabled) {
    lines.push(
      'Αν δεν υπάρχει διαθέσιμη ώρα άμεσα, μπορείτε να στείλετε αίτημα κράτησης προς έγκριση από την επιχείρηση.'
    );
  }

  if (business.enforcementPolicy === 'block') {
    lines.push('Απαιτείται ενεργή συνδρομή/πακέτο μαθημάτων για να κάνετε κράτηση.');
  }

  if (lines.length === 0) {
    return '';
  }

  return `\n\nΙσχύουσες πολιτικές:\n${lines.map((line) => `- ${line}`).join('\n')}`;
};

// Phase 27 (COMP-01/COMP-02, D-01): the merged consent+registration prompt.
// One Ναι/Όχι step — accepting sets consentGiven=true, which IS the
// opt-in/registered flag (no separate registration question).
// Quick task 260729-mlr: now takes the full Business object so it can
// append a per-business policy summary before the final consent question.
export const CONSENT_PROMPT_GREEK_TEMPLATE = (business: Business): string =>
  `${CONSENT_NOTICE_GREEK_TEMPLATE(business.name)}${buildPolicySummaryGreek(business)}\nΣυμφωνείτε να συνεχίσουμε;`;

export const CONSENT_KEYBOARD: Array<Array<{ text: string; callback_data: string }>> = [
  [
    { text: CONSENT_LABELS.ACCEPT, callback_data: 'consent:yes' },
    { text: CONSENT_LABELS.DECLINE, callback_data: 'consent:no' },
  ],
];

export async function getOrCreateClientRelationship(
  businessId: number,
  senderPhone: string
): Promise<{ isFirstContact: boolean; consentGiven: boolean }> {
  const existing = await findClientBusinessRelationship(businessId, senderPhone);

  if (existing) {
    logger.debug({ businessId, senderPhone }, 'Returning client, relationship found');
    return { isFirstContact: false, consentGiven: existing.consentGiven };
  }

  const inserted = await insertClientBusinessRelationship(businessId, senderPhone);
  logger.info({ businessId, senderPhone }, 'First contact — new client relationship created');
  // Phase 27 (COMP-02): load-bearing fix — this MUST reflect the real
  // inserted row's consentGiven (now DB-defaulted to false, Plan 27-01),
  // not a hardcoded true. Hardcoding true here would make every brand-new
  // client read back as already-consented, silently defeating the entire
  // gate this plan wires up in webhooks/telegram.ts and conversation/router.ts.
  return { isFirstContact: true, consentGiven: inserted.consentGiven };
}
