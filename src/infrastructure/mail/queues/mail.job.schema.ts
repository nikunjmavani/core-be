import { z } from 'zod';
import { dlqReplayJobFieldsSchema } from '@/infrastructure/queue/dlq/dlq-replay-job-fields.schema.js';

export const mailJobDataSchema = z
  .object({
    mailOutboxId: z.number().int().positive(),
    requestId: z.string().min(1).max(128).optional(),
    traceparent: z.string().min(1).max(256).optional(),
    tracestate: z.string().min(1).max(512).optional(),
  })
  .merge(dlqReplayJobFieldsSchema);

export type MailJobDataValidated = z.infer<typeof mailJobDataSchema>;
