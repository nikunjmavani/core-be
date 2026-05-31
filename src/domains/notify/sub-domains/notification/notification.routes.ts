import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { rejectLegacyPagePagination } from '@/shared/utils/http/pagination.util.js';
import type { NotificationService } from './notification.service.js';
import { createNotificationController } from './notification.controller.js';
import {
  deleteNotificationParamsDto,
  getNotificationParamsDto,
  listNotificationsQueryDto,
} from './notification.dto.js';

/**
 * Returns a Fastify plugin that registers the `/notifications` HTTP routes (list, unread count,
 * get, mark read, mark-all-read, delete) bound to the supplied {@link NotificationService}.
 */
export function notificationRoutes(service: NotificationService): FastifyPluginAsync {
  const controller = createNotificationController(service);

  return async (app) => {
    const zodApplication = app.withTypeProvider<ZodTypeProvider>();
    zodApplication.get(
      '/notifications',
      {
        schema: {
          summary: 'List my notifications',
          description: 'Returns a paginated list of notifications for the authenticated user.',
          tags: ['Notification'],
          querystring: listNotificationsQueryDto,
        },
        onRequest: [app.authenticate],
        preValidation: [rejectLegacyPagePagination],
      },
      controller.listNotifications,
    );
    zodApplication.get(
      '/notifications/unread-count',
      {
        onRequest: [app.authenticate],
        schema: {
          summary: 'Get unread notification count',
          description: 'Returns the count of unread notifications for the authenticated user.',
          tags: ['Notification'],
        },
      },
      controller.getUnreadCount,
    );
    zodApplication.get<{ Params: { id: string } }>(
      '/notifications/:id',
      {
        onRequest: [app.authenticate],
        schema: {
          summary: 'Get notification',
          description: 'Returns a single notification by ID.',
          tags: ['Notification'],
          params: getNotificationParamsDto,
        },
      },
      controller.getNotification,
    );
    zodApplication.patch<{ Params: { id: string } }>(
      '/notifications/:id/read',
      {
        onRequest: [app.authenticate],
        schema: {
          summary: 'Mark notification as read',
          description: 'Marks a single notification as read.',
          tags: ['Notification'],
          params: getNotificationParamsDto,
        },
      },
      controller.markNotificationRead,
    );
    zodApplication.post(
      '/notifications/mark-all-read',
      {
        onRequest: [app.authenticate],
        schema: {
          summary: 'Mark all notifications as read',
          description:
            'Marks all unread notifications as read for the authenticated user and returns `{ updated_count }` only (not the full row set).',
          tags: ['Notification'],
        },
      },
      controller.markAllRead,
    );
    zodApplication.delete<{ Params: { notificationId: string } }>(
      '/notifications/:notificationId',
      {
        onRequest: [app.authenticate],
        schema: {
          summary: 'Delete notification',
          description: 'Permanently deletes a notification.',
          tags: ['Notification'],
          params: deleteNotificationParamsDto,
        },
      },
      controller.deleteNotification,
    );
  };
}
