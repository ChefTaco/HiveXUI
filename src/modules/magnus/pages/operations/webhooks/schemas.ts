// The webhook routes are browser routes with no released contract yet, so the shapes are here.
// services/control-api/src/routes/webhooks.ts, services/control-api/src/services/webhook-service.ts
// and services/control-api/prisma/schema.prisma in Magnus. Secrets and headers are never returned, and
// `url` is only the target's origin, because webhook paths and queries often embed tokens.
import { z } from 'zod';

const isoDate = z.iso.datetime();

export const webhookEndpointSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  type: z.string(),
  secretConfigured: z.boolean(),
  /** A JSON-encoded string array. Empty means every event. */
  events: z.string(),
  headersConfigured: z.boolean(),
  active: z.boolean(),
  retries: z.number().int(),
  timeoutMs: z.number().int(),
  createdBy: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
  _count: z.object({ deliveries: z.number().int() }).optional(),
});
export type WebhookEndpoint = z.output<typeof webhookEndpointSchema>;

export const webhookListResponseSchema = z.object({ success: z.literal(true), data: z.object({ endpoints: z.array(webhookEndpointSchema) }) });
export const webhookResponseSchema = z.object({ success: z.literal(true), data: z.object({ endpoint: webhookEndpointSchema }) });
export const webhookDeleteResponseSchema = z.object({ success: z.literal(true), data: z.object({ success: z.literal(true) }) });

export const webhookDeliverySchema = z.object({
  id: z.string(),
  endpointId: z.string(),
  event: z.string(),
  /** A JSON-encoded string. */
  payload: z.string(),
  status: z.string(),
  httpStatus: z.number().int().nullable(),
  response: z.string().nullable(),
  error: z.string().nullable(),
  attempts: z.number().int(),
  deliveredAt: isoDate.nullable(),
  createdAt: isoDate,
});
export type WebhookDelivery = z.output<typeof webhookDeliverySchema>;
export const webhookDeliveriesResponseSchema = z.object({ success: z.literal(true), data: z.object({ deliveries: z.array(webhookDeliverySchema), total: z.number().int() }) });

/** 200 when delivered and 502 when not, both with this body. */
export const webhookTestResponseSchema = z.object({ success: z.literal(true), data: z.object({ success: z.boolean(), error: z.string().optional() }) });
export const webhookRedeliverResponseSchema = z.object({ success: z.literal(true), data: z.object({ deliveryId: z.string() }) });
