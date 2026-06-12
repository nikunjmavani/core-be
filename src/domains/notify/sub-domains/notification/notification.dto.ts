import { z } from 'zod';
import { cursorPaginationSchema } from '@/shared/utils/http/pagination.util.js';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

/** Zod schema for `GET /notifications/:notification_id` and `PATCH /notifications/:notification_id/read` path params. */
export const getNotificationParamsDto = z
  .object({
    notification_id: trimmedStringMinMax(1, 28),
  })
  .strict();

/** Zod schema for `DELETE /notifications/:notification_id` path params. */
export const deleteNotificationParamsDto = z
  .object({
    notification_id: trimmedStringMinMax(1, 28),
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
