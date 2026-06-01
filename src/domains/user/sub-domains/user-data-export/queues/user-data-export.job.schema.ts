import { z } from 'zod';
import { traceContextJobFieldsSchema } from '@/infrastructure/observability/tracing/trace-context-job-fields.schema.js';

/**
 * Zod schema for the `user-data-export` BullMQ job payload. Validated on enqueue and on worker
 * pickup (via `parseJobDataOrDeadLetter`) so malformed jobs from an old release fail fast in the
 * DLQ instead of silently corrupting an export. Merges the W3C trace-context fields so the
 * export worker span links back to the originating request.
 */
export const userDataExportJobDataSchema = z
  .object({
    exportPublicId: z.string().min(1).max(21),
    userPublicId: z.string().min(1).max(21),
    userInternalId: z.number().int().positive(),
  })
  .extend(traceContextJobFieldsSchema.shape);

/** Inferred BullMQ job payload type for the `user-data-export` queue. */
export type UserDataExportJobData = z.infer<typeof userDataExportJobDataSchema>;
