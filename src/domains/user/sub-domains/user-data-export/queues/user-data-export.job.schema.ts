import { z } from 'zod';

/**
 * Zod schema for the `user-data-export` BullMQ job payload. Validated on enqueue and on worker
 * pickup (via `parseBullMQJobData`) so malformed jobs from an old release fail fast in the DLQ
 * instead of silently corrupting an export.
 */
export const userDataExportJobDataSchema = z.object({
  exportPublicId: z.string().min(1).max(21),
  userPublicId: z.string().min(1).max(21),
  userInternalId: z.number().int().positive(),
});

/** Inferred BullMQ job payload type for the `user-data-export` queue. */
export type UserDataExportJobData = z.infer<typeof userDataExportJobDataSchema>;
