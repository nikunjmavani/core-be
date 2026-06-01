import { z } from 'zod';
import { cursorPaginationSchema } from '@/shared/utils/http/pagination.util.js';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

/** Zod schema for `GET /notifications/:id` and `PATCH /notifications/:id/read` path params. */
export const getNotificationParamsDto = z
  .object({
    id: trimmedStringMinMax(1, 21),
  })
  .strict();

/** Zod schema for `DELETE /notifications/:notificationId` path params. */
export const deleteNotificationParamsDto = z
  .object({
    notificationId: trimmedStringMinMax(1, 21),
  })
  .strict();

/**
 * Zod schema for the `GET /notifications` query string — extends the cursor pagination schema
 * with an opt-in `include_total` flag (defaults to `false` so the inbox stays keyset-only).
 */
export const listNotificationsQueryDto = cursorPaginationSchema
  .extend({
    // Opt in to count(*); defaults to false so the user inbox stays keyset-only.
    include_total: z.enum(['true', 'false']).optional().default('false'),
  })
  .strict();

/** Type inferred from {@link getNotificationParamsDto}. */
export type GetNotificationParamsInput = z.infer<typeof getNotificationParamsDto>;
/** Type inferred from {@link deleteNotificationParamsDto}. */
export type DeleteNotificationParamsInput = z.infer<typeof deleteNotificationParamsDto>;
/** Type inferred from {@link listNotificationsQueryDto}. */
export type ListNotificationsQueryInput = z.infer<typeof listNotificationsQueryDto>;
