import { z } from 'zod';
import { dlqReplayJobFieldsSchema } from '@/infrastructure/queue/dlq/dlq-replay-job-fields.schema.js';

export const webhookDeliveryJobDataSchema = z
  .object({
    deliveryAttemptId: z.number().int().positive(),
    organizationPublicId: z.string().min(1).max(21),
    requestId: z.string().min(1).max(128).optional(),
  })
  .merge(dlqReplayJobFieldsSchema);

export type WebhookDeliveryJobDataValidated = z.infer<typeof webhookDeliveryJobDataSchema>;
