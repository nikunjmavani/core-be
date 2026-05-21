import type { FastifyReply, FastifyRequest } from 'fastify';
import { NotFoundError } from '@/shared/errors/index.js';
import { paginatedResponse, successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { parseListLimitQuery } from '@/shared/utils/http/pagination.util.js';
import type { NotificationService } from './notification.service.js';
import { NotificationSerializer } from './notification.serializer.js';

export function createNotificationController(service: NotificationService) {
  return {
    listNotifications: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const { limit } = parseListLimitQuery(request.query);
      const items = await service.listForUser(auth.userId, { limit });
      const serialized = NotificationSerializer.many(items);
      const nextCursor = null;
      const hasMore = false;
      return paginatedResponse(serialized, getRequestIdentifier(request), {
        per_page: serialized.length,
        next: nextCursor,
        has_more: hasMore,
        estimated_total: serialized.length,
      });
    },
    getNotification: async (
      request: FastifyRequest<{ Params: { id: string } }>,
      _reply: FastifyReply,
    ) => {
      const auth = requireAuth(request);
      const notification = await service.get(request.params.id, auth.userId);
      if (!notification) throw new NotFoundError('Notification');
      return successResponse(
        NotificationSerializer.one(notification),
        getRequestIdentifier(request),
      );
    },
    markNotificationRead: async (
      request: FastifyRequest<{ Params: { id: string } }>,
      _reply: FastifyReply,
    ) => {
      const auth = requireAuth(request);
      const notification = await service.markRead(request.params.id, auth.userId);
      if (!notification) throw new NotFoundError('Notification');
      return successResponse(
        NotificationSerializer.one(notification),
        getRequestIdentifier(request),
      );
    },
    markAllRead: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const notifications = await service.markAllRead(auth.userId);
      return successResponse(
        NotificationSerializer.many(notifications),
        getRequestIdentifier(request),
      );
    },
    getUnreadCount: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const count = await service.getUnreadCount(auth.userId);
      return successResponse({ count }, getRequestIdentifier(request));
    },
    deleteNotification: async (
      request: FastifyRequest<{ Params: { notificationId: string } }>,
      reply: FastifyReply,
    ) => {
      const auth = requireAuth(request);
      const deleted = await service.deleteNotification(request.params.notificationId, auth.userId);
      if (!deleted) throw new NotFoundError('Notification');
      return reply.code(204).send();
    },
  };
}
