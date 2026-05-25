import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse, paginatedResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { validatePublicIdParam } from '@/shared/utils/identity/public-id-param.util.js';
import { recordScopedAuditEvent } from '@/shared/utils/infrastructure/audit-request-context.util.js';
import type { UserContainer } from './user.container.js';

// eslint-disable-next-line max-lines-per-function -- controller aggregator: thin handler map across user / settings / notifications / admin.
export function createUserController({
  userService,
  userSettingsService,
  userNotificationPreferencesService,
}: Pick<
  UserContainer,
  'userService' | 'userSettingsService' | 'userNotificationPreferencesService'
>) {
  return {
    // ── Self-service ──────────────────────────────────────────

    getMe: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await userService.getMe(auth.userId);
      return successResponse(data, getRequestIdentifier(request));
    },

    patchMe: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await userService.updateMe(auth.userId, request.body);
      return successResponse(data, getRequestIdentifier(request));
    },

    deleteMe: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      await userService.deleteMe(auth.userId);
      return reply.status(204).send();
    },

    getSettings: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await userSettingsService.get(auth.userId);
      return successResponse(data, getRequestIdentifier(request));
    },

    patchSettings: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await userSettingsService.update(auth.userId, request.body);
      await recordScopedAuditEvent(request, {
        actorUserPublicId: auth.userId,
        action: 'user.settings.update',
        resource_type: 'user_settings',
      });
      return successResponse(data, getRequestIdentifier(request));
    },

    getNotificationPreferences: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await userNotificationPreferencesService.get(auth.userId);
      return successResponse(data, getRequestIdentifier(request));
    },

    putNotificationPreferences: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await userNotificationPreferencesService.put(auth.userId, request.body);
      return successResponse(data, getRequestIdentifier(request));
    },

    uploadAvatar: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await userService.uploadAvatar(auth.userId, request.body);
      return successResponse(data, getRequestIdentifier(request));
    },

    deleteAvatar: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const data = await userService.deleteAvatar(auth.userId);
      return successResponse(data, getRequestIdentifier(request));
    },

    // ── Admin ─────────────────────────────────────────────────

    listUsers: async (request: FastifyRequest, _reply: FastifyReply) => {
      const result = await userService.listUsers(request.query);
      return paginatedResponse(result.items, getRequestIdentifier(request), {
        per_page: result.limit,
        next: result.next_cursor,
        has_more: result.has_more,
        ...(result.total !== null ? { estimated_total: result.total } : {}),
      });
    },

    getUser: async (request: FastifyRequest, _reply: FastifyReply) => {
      const userId = validatePublicIdParam(
        (request.params as { userId: string }).userId ?? '',
        'userId',
      );
      const data = await userService.getUser(userId);
      return successResponse(data, getRequestIdentifier(request));
    },

    updateUser: async (request: FastifyRequest, _reply: FastifyReply) => {
      const userId = validatePublicIdParam(
        (request.params as { userId: string }).userId ?? '',
        'userId',
      );
      const data = await userService.adminUpdateUser(userId, request.body);
      return successResponse(data, getRequestIdentifier(request));
    },

    deleteUser: async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = validatePublicIdParam(
        (request.params as { userId: string }).userId ?? '',
        'userId',
      );
      await userService.deleteUser(userId);
      return reply.status(204).send();
    },

    suspendUser: async (request: FastifyRequest, _reply: FastifyReply) => {
      const userId = validatePublicIdParam(
        (request.params as { userId: string }).userId ?? '',
        'userId',
      );
      const data = await userService.suspendUser(userId);
      return successResponse(data, getRequestIdentifier(request));
    },

    unsuspendUser: async (request: FastifyRequest, _reply: FastifyReply) => {
      const userId = validatePublicIdParam(
        (request.params as { userId: string }).userId ?? '',
        'userId',
      );
      const data = await userService.unsuspendUser(userId);
      return successResponse(data, getRequestIdentifier(request));
    },
  };
}
