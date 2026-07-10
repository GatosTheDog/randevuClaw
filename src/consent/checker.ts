import {
  findClientBusinessRelationship,
  insertClientBusinessRelationship,
} from '../database/queries';
import { logger } from '../utils/logger';

export const CONSENT_NOTICE_GREEK_TEMPLATE = (businessName: string): string =>
  `Για να διαχειριστούμε το ραντεβού σας με την επιχείρηση ${businessName}, αποθηκεύουμε τον αριθμό τηλεφώνου σας και το ιστορικό ραντεβού σας.`;

export async function getOrCreateClientRelationship(
  businessId: number,
  senderPhone: string
): Promise<{ isFirstContact: boolean; consentGiven: boolean }> {
  const existing = await findClientBusinessRelationship(businessId, senderPhone);

  if (existing) {
    logger.debug({ businessId, senderPhone }, 'Returning client, relationship found');
    return { isFirstContact: false, consentGiven: existing.consentGiven };
  }

  await insertClientBusinessRelationship(businessId, senderPhone);
  logger.info({ businessId, senderPhone }, 'First contact — new client relationship created');
  return { isFirstContact: true, consentGiven: true };
}
