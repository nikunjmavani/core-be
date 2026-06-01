import { z } from 'zod';
import { traceContextJobFieldsSchema } from '@/infrastructure/observability/tracing/trace-context-job-fields.schema.js';
import { dlqReplayJobFieldsSchema } from '@/infrastructure/queue/dlq/dlq-replay-job-fields.schema.js';

/** Minimal Redis payload — worker retrieves the full Stripe event via API. */
export const stripeWebhookJobDataSchema = z
  .object({
    stripeEventId: z.string().min(1),
    requestId: z.string().min(1).max(128).optional(),
  })
  .merge(traceContextJobFieldsSchema)
  .merge(dlqReplayJobFieldsSchema);

/** Inferred payload type for jobs on the `stripe-webhook` queue (validated form). */
export type StripeWebhookJobDataValidated = z.infer<typeof stripeWebhookJobDataSchema>;
