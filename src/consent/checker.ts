import {
  findClientBusinessRelationship,
  insertClientBusinessRelationship,
} from '../database/queries';

export const CONSENT_NOTICE_GREEK_TEMPLATE = (businessName: string): string =>
  `Για να διαχειριστούμε το ραντεβού σας με την επιχείρηση ${businessName}, αποθηκεύουμε τον αριθμό τηλεφώνου σας και το ιστορικό ραντεβού σας.`;

export async function getOrCreateClientRelationship(
  businessId: number,
  senderPhone: string
): Promise<{ isFirstContact: boolean; consentGiven: boolean }> {
  const existing = await findClientBusinessRelationship(businessId, senderPhone);

  if (existing) {
    return { isFirstContact: false, consentGiven: existing.consentGiven };
  }

  await insertClientBusinessRelationship(businessId, senderPhone);
  return { isFirstContact: true, consentGiven: true };
}
