import { z } from 'zod';

/** POST /users/me/data-export — no request body; export is triggered for the authenticated user. */
export const exportUserDataBodyDto = z.object({}).strict();

/** Inferred body type from {@link exportUserDataBodyDto}; intentionally empty (auth context drives the export). */
export type ExportUserDataBodyInput = z.infer<typeof exportUserDataBodyDto>;

/** GET /users/me/data-export/:data_export_id */
export const dataExportIdParamDto = z.object({
  data_export_id: z.string().min(1).max(28),
});

/** Inferred path-param type from {@link dataExportIdParamDto} (carries the public export identifier). */
export type DataExportIdParamInput = z.infer<typeof dataExportIdParamDto>;
