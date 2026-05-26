import { z } from 'zod';
import { cursorPaginationSchema } from '@/shared/utils/http/pagination.util.js';
import { trimmedStringMinMax } from '@/shared/utils/validation/validation.util.js';

export const getNotificationParamsDto = z
  .object({
    id: trimmedStringMinMax(1, 21),
  })
  .strict();

export const deleteNotificationParamsDto = z
  .object({
    notificationId: trimmedStringMinMax(1, 21),
  })
  .strict();

export const listNotificationsQueryDto = cursorPaginationSchema
  .extend({
    // Opt in to count(*); defaults to false so the user inbox stays keyset-only.
    include_total: z.enum(['true', 'false']).optional().default('false'),
  })
  .strict();

export type GetNotificationParamsInput = z.infer<typeof getNotificationParamsDto>;
export type DeleteNotificationParamsInput = z.infer<typeof deleteNotificationParamsDto>;
export type ListNotificationsQueryInput = z.infer<typeof listNotificationsQueryDto>;
