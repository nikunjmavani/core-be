import { z } from 'zod';
import { dlqReplayJobFieldsSchema } from '@/infrastructure/queue/dlq/dlq-replay-job-fields.schema.js';

/** Minimal Redis payload — worker retrieves the full Stripe event via API. */
export const stripeWebhookJobDataSchema = z
  .object({
    stripeEventId: z.string().min(1),
    requestId: z.string().min(1).max(128).optional(),
  })
  .merge(dlqReplayJobFieldsSchema);

export type StripeWebhookJobDataValidated = z.infer<typeof stripeWebhookJobDataSchema>;
