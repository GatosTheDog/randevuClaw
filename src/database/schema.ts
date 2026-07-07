import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const businesses = pgTable('businesses', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  phoneNumberId: text('phone_number_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  whatsappMessageId: text('whatsapp_message_id').notNull().unique(), // D-05 dedup key
  businessId: integer('business_id')
    .notNull()
    .references(() => businesses.id),
  senderPhone: text('sender_phone').notNull(),
  messageBody: text('message_body').notNull(),
  status: text('status').notNull().default('received'), // 'received' | 'processed'
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const clientBusinessRelationships = pgTable(
  'client_business_relationships',
  {
    id: serial('id').primaryKey(),
    businessId: integer('business_id')
      .notNull()
      .references(() => businesses.id),
    senderPhone: text('sender_phone').notNull(),
    consentGiven: boolean('consent_given').notNull().default(true), // Implied consent (D-10)
    consentTimestamp: timestamp('consent_timestamp').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    // D-09/D-12 composite key: one relationship row per (business, phone) pair
    uniqueIndex('unique_client_business').on(table.businessId, table.senderPhone),
  ]
);
