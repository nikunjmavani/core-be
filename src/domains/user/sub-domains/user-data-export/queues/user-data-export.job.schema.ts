import { z } from 'zod';

export const userDataExportJobDataSchema = z.object({
  exportPublicId: z.string().min(1).max(21),
  userPublicId: z.string().min(1).max(21),
  userInternalId: z.number().int().positive(),
});

export type UserDataExportJobData = z.infer<typeof userDataExportJobDataSchema>;
