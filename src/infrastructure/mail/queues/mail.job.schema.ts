import { z } from 'zod';
import { traceContextJobFieldsSchema } from '@/infrastructure/observability/tracing/trace-context-job-fields.schema.js';
import { dlqReplayJobFieldsSchema } from '@/infrastructure/queue/dlq/dlq-replay-job-fields.schema.js';

/**
 * Zod schema for the BullMQ `mail/send-email` job payload — only the outbox row
 * id is persisted in Redis; the full email body lives in `auth.mail_outbox`.
 * Includes W3C trace context (`traceparent`/`tracestate`) for cross-process
 * distributed tracing and the shared DLQ replay envelope.
 */
export const mailJobDataSchema = z
  .object({
    mailOutboxId: z.number().int().positive(),
    requestId: z.string().min(1).max(128).optional(),
  })
  .merge(traceContextJobFieldsSchema)
  .merge(dlqReplayJobFieldsSchema);

/** Validated mail job payload — `z.infer<typeof mailJobDataSchema>`. */
export type MailJobDataValidated = z.infer<typeof mailJobDataSchema>;
