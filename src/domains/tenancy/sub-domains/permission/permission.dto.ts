import { z } from 'zod';

/** Permissions list is unfiltered today; schema reserved for future query params. */
export const listPermissionsQueryDto = z.object({}).strict();

/** Validated query inferred from {@link listPermissionsQueryDto}. */
export type ListPermissionsQueryInput = z.infer<typeof listPermissionsQueryDto>;
