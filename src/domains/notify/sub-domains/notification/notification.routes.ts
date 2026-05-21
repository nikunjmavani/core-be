import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { listLimitQuerySchema } from '@/shared/utils/http/pagination.util.js';
import type { NotificationService } from './notification.service.js';
import { createNotificationController } from './notification.controller.js';
import { deleteNotificationParamsDto, getNotificationParamsDto } from './notification.dto.js';

export function notificationRoutes(service: NotificationService): FastifyPluginAsync {
  const controller = createNotificationController(service);

  return async (app) => {
    const zodApplication = app.withTypeProvider<ZodTypeProvider>();
    zodApplication.get(
      '/notifications',
      {
        schema: { querystring: listLimitQuerySchema },
        onRequest: [app.authenticate],
      },
      controller.listNotifications,
    );
    zodApplication.get(
      '/notifications/unread-count',
      { onRequest: [app.authenticate], schema: {} },
      controller.getUnreadCount,
    );
    zodApplication.get<{ Params: { id: string } }>(
      '/notifications/:id',
      {
        onRequest: [app.authenticate],
        schema: { params: getNotificationParamsDto },
      },
      controller.getNotification,
    );
    zodApplication.patch<{ Params: { id: string } }>(
      '/notifications/:id/read',
      {
        onRequest: [app.authenticate],
        schema: { params: getNotificationParamsDto },
      },
      controller.markNotificationRead,
    );
    zodApplication.post(
      '/notifications/mark-all-read',
      { onRequest: [app.authenticate], schema: {} },
      controller.markAllRead,
    );
    zodApplication.delete<{ Params: { notificationId: string } }>(
      '/notifications/:notificationId',
      {
        onRequest: [app.authenticate],
        schema: { params: deleteNotificationParamsDto },
      },
      controller.deleteNotification,
    );
  };
}
