import { z } from 'zod';

/** Serializable post-commit side effect — persisted to Redis before the HTTP response returns. */
/** Zod schema for serializable post-commit dispatch tasks stored in Redis. */
export const commitDispatchTaskSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('mail_outbox'),
    mailOutboxId: z.number().int().positive(),
    requestId: z.string().optional(),
  }),
  z.object({
    type: z.literal('notification'),
    notificationId: z.number().int().positive(),
    organizationPublicId: z.string().nullable(),
  }),
  z.object({
    type: z.literal('user_data_export'),
    exportPublicId: z.string().min(1),
    userPublicId: z.string().min(1),
    userInternalId: z.number().int().positive(),
  }),
]);

/** Discriminated union of durable post-commit side effects replayed after HTTP commit. */
export type CommitDispatchTask = z.infer<typeof commitDispatchTaskSchema>;
