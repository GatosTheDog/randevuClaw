import {
  findClientBusinessRelationship,
  insertClientBusinessRelationship,
} from '../database/queries';
import { logger } from '../utils/logger';
import { CONSENT_LABELS } from '../utils/greek-messages';

export const CONSENT_NOTICE_GREEK_TEMPLATE = (businessName: string): string =>
  `Για να διαχειριστούμε το ραντεβού σας με την επιχείρηση ${businessName}, αποθηκεύουμε τον αριθμό τηλεφώνου σας και το ιστορικό ραντεβού σας.`;

// Phase 27 (COMP-01/COMP-02, D-01): the merged consent+registration prompt.
// One Ναι/Όχι step — accepting sets consentGiven=true, which IS the
// opt-in/registered flag (no separate registration question).
export const CONSENT_PROMPT_GREEK_TEMPLATE = (businessName: string): string =>
  `${CONSENT_NOTICE_GREEK_TEMPLATE(businessName)}\nΣυμφωνείτε να συνεχίσουμε;`;

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
