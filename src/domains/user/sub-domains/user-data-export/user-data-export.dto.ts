import { z } from 'zod';

/** POST /users/me/data-export — no request body; export is triggered for the authenticated user. */
export const exportUserDataBodyDto = z.object({}).strict();

export type ExportUserDataBodyInput = z.infer<typeof exportUserDataBodyDto>;

/** GET /users/me/data-export/:exportId */
export const exportIdParamDto = z.object({
  exportId: z.string().min(1).max(21),
});

export type ExportIdParamInput = z.infer<typeof exportIdParamDto>;
