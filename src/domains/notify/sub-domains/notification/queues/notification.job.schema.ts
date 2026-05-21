import { z } from 'zod';

export const notificationJobDataSchema = z.object({
  notificationId: z.number().int().positive(),
  organizationPublicId: z.string().min(1).max(21).nullable(),
  requestId: z.string().min(1).max(128).optional(),
});

export type NotificationJobDataValidated = z.infer<typeof notificationJobDataSchema>;
