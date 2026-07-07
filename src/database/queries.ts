import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { businesses, clientBusinessRelationships, messages } from './schema';

export interface Business {
  id: number;
  name: string;
  slug: string;
  phoneNumberId: string | null;
  createdAt: Date;
}

export interface ClientBusinessRelationship {
  id: number;
  businessId: number;
  senderPhone: string;
  consentGiven: boolean;
  consentTimestamp: Date;
  createdAt: Date;
}

export async function findBusinessBySlug(slug: string): Promise<Business | null> {
  const rows = await db
    .select()
    .from(businesses)
    .where(eq(businesses.slug, slug))
    .limit(1);

  return rows[0] ?? null;
}

export async function insertOrIgnoreMessage(
  whatsappMessageId: string,
  businessId: number,
  senderPhone: string,
  messageBody: string
): Promise<'inserted' | 'ignored'> {
  const result = await db
    .insert(messages)
    .values({
      whatsappMessageId,
      businessId,
      senderPhone,
      messageBody,
      status: 'received',
    })
    .onConflictDoNothing()
    .returning({ id: messages.id });

  return result.length > 0 ? 'inserted' : 'ignored';
}

export async function markMessageProcessed(whatsappMessageId: string): Promise<void> {
  await db
    .update(messages)
    .set({ status: 'processed' })
    .where(eq(messages.whatsappMessageId, whatsappMessageId));
}

export async function findClientBusinessRelationship(
  businessId: number,
  senderPhone: string
): Promise<ClientBusinessRelationship | null> {
  const rows = await db
    .select()
    .from(clientBusinessRelationships)
    .where(
      and(
        eq(clientBusinessRelationships.businessId, businessId),
        eq(clientBusinessRelationships.senderPhone, senderPhone)
      )
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function insertClientBusinessRelationship(
  businessId: number,
  senderPhone: string
): Promise<ClientBusinessRelationship> {
  const rows = await db
    .insert(clientBusinessRelationships)
    .values({
      businessId,
      senderPhone,
      consentGiven: true,
      consentTimestamp: new Date(),
    })
    .returning();

  return rows[0];
}
