import { z } from 'zod';

/**
 * Zod schema for `notification` BullMQ job payloads — validates the producer-supplied id triple
 * (`notificationId`, organization public id for tenant scoping, and optional request id for log
 * correlation) before the worker reaches Postgres.
 */
export const notificationJobDataSchema = z.object({
  notificationId: z.number().int().positive(),
  organizationPublicId: z.string().min(1).max(21).nullable(),
  requestId: z.string().min(1).max(128).optional(),
});

/** Type inferred from {@link notificationJobDataSchema}; what the worker receives after parsing. */
export type NotificationJobDataValidated = z.infer<typeof notificationJobDataSchema>;
