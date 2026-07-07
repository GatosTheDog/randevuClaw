import { z } from 'zod';

const WhatsAppMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
});

export const WhatsAppWebhookPayloadSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          value: z.object({
            messaging_product: z.string(),
            metadata: z
              .object({
                display_phone_number: z.string(),
                phone_number_id: z.string(),
              })
              .optional(),
            messages: z.array(WhatsAppMessageSchema).optional(),
          }),
          field: z.string(),
        })
      ),
    })
  ),
});

export type WhatsAppWebhookPayload = z.infer<typeof WhatsAppWebhookPayloadSchema>;
export type WhatsAppMessage = z.infer<typeof WhatsAppMessageSchema>;

export function validateWebhookPayload(data: unknown): WhatsAppWebhookPayload {
  return WhatsAppWebhookPayloadSchema.parse(data);
}
