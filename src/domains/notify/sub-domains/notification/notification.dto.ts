import { z } from 'zod';
import { cursorListQuerySchema } from '@/shared/utils/http/pagination.util.js';
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

export const listNotificationsQueryDto = cursorListQuerySchema.strict();

export type GetNotificationParamsInput = z.infer<typeof getNotificationParamsDto>;
export type DeleteNotificationParamsInput = z.infer<typeof deleteNotificationParamsDto>;
export type ListNotificationsQueryInput = z.infer<typeof listNotificationsQueryDto>;
