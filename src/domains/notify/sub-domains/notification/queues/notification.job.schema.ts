import { z } from 'zod';
import { traceContextJobFieldsSchema } from '@/infrastructure/observability/tracing/trace-context-job-fields.schema.js';
import { dlqReplayJobFieldsSchema } from '@/infrastructure/queue/dlq/dlq-replay-job-fields.schema.js';

/**
 * Zod schema for `notification` BullMQ job payloads — validates the producer-supplied id triple
 * (`notificationId`, organization public id for tenant scoping, and optional request id for log
 * correlation) before the worker reaches Postgres. Merges the W3C trace-context fields so
 * API→worker spans stay linked, and the shared DLQ replay metadata so notification jobs
 * re-enqueued from the dead-letter queue keep their replay provenance.
 */
export const notificationJobDataSchema = z
  .object({
    notificationId: z.number().int().positive(),
    organizationPublicId: z.string().min(1).max(21).nullable(),
    requestId: z.string().min(1).max(128).optional(),
  })
  .merge(traceContextJobFieldsSchema)
  .merge(dlqReplayJobFieldsSchema);

/** Type inferred from {@link notificationJobDataSchema}; what the worker receives after parsing. */
export type NotificationJobDataValidated = z.infer<typeof notificationJobDataSchema>;
