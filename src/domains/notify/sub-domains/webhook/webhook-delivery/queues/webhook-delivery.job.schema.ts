import { z } from 'zod';
import { traceContextJobFieldsSchema } from '@/infrastructure/observability/tracing/trace-context-job-fields.schema.js';
import { dlqReplayJobFieldsSchema } from '@/infrastructure/queue/dlq/dlq-replay-job-fields.schema.js';

/**
 * Zod schema for `webhook-delivery` BullMQ job payloads — validates the delivery-attempt id,
 * the organization public id used for tenant scoping, and the optional request id used for
 * tracing. Also merges the W3C trace-context fields and the shared DLQ replay metadata so jobs
 * replayed from the DLQ keep their provenance.
 */
export const webhookDeliveryJobDataSchema = z
  .object({
    deliveryAttemptId: z.number().int().positive(),
    organizationPublicId: z.string().min(1).max(28),
    requestId: z.string().min(1).max(128).optional(),
  })
  .extend(traceContextJobFieldsSchema.shape)
  .extend(dlqReplayJobFieldsSchema.shape);

/** Type inferred from {@link webhookDeliveryJobDataSchema}; what the worker receives after parsing. */
export type WebhookDeliveryJobDataValidated = z.infer<typeof webhookDeliveryJobDataSchema>;
