import type { FastifyReply, FastifyRequest } from 'fastify';
import { paginatedResponse, successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import {
  cursorPaginationSchema,
  ensureCursorOnlyPagination,
} from '@/shared/utils/http/pagination.util.js';
import { validatePublicIdParam } from '@/shared/utils/identity/public-id-param.util.js';
import { recordScopedAuditEvent } from '@/shared/utils/infrastructure/audit-request-context.util.js';
import type { MemberRoleService } from './member-role.service.js';

export function createMemberRoleController(service: MemberRoleService) {
  return {
    listRoles: async (request: FastifyRequest, _reply: FastifyReply) => {
      const organizationId = validatePublicIdParam(
        (request.params as { id: string }).id ?? '',
        'id',
      );
      ensureCursorOnlyPagination(request.query);
      const pagination = cursorPaginationSchema.parse(request.query);
      const result = await service.list(organizationId, pagination);
      return paginatedResponse(result.items, getRequestIdentifier(request), {
        per_page: result.limit,
        next: result.next_cursor,
        has_more: result.has_more,
        ...(result.total !== null ? { estimated_total: result.total } : {}),
      });
    },
    getRole: async (request: FastifyRequest, _reply: FastifyReply) => {
      const { id: organizationId, roleId } = (request.params as {
        id: string;
        roleId: string;
      }) ?? { id: '', roleId: '' };
      const data = await service.getByPublicId(organizationId, roleId);
      return successResponse(data, getRequestIdentifier(request));
    },
    createRole: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      const organizationId = validatePublicIdParam(
        (request.params as { id: string }).id ?? '',
        'id',
      );
      const data = await service.create(organizationId, request.body, auth.userId);
      await recordScopedAuditEvent(request, {
        actorUserPublicId: auth.userId,
        action: 'tenancy.role.create',
        resource_type: 'role',
        organizationPublicId: organizationId,
        metadata: { role_public_id: (data as { public_id?: string }).public_id },
      });
      reply.code(201);
      return successResponse(data, getRequestIdentifier(request));
    },
    updateRole: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const { id: organizationId, roleId } = (request.params as {
        id: string;
        roleId: string;
      }) ?? { id: '', roleId: '' };
      const data = await service.update(organizationId, roleId, request.body, auth.userId);
      await recordScopedAuditEvent(request, {
        actorUserPublicId: auth.userId,
        action: 'tenancy.role.update',
        resource_type: 'role',
        organizationPublicId: organizationId,
        metadata: { role_public_id: roleId },
      });
      return successResponse(data, getRequestIdentifier(request));
    },
    deleteRole: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      const { id: organizationId, roleId } = (request.params as {
        id: string;
        roleId: string;
      }) ?? { id: '', roleId: '' };
      await service.delete(organizationId, roleId);
      await recordScopedAuditEvent(request, {
        actorUserPublicId: auth.userId,
        action: 'tenancy.role.delete',
        resource_type: 'role',
        organizationPublicId: organizationId,
        metadata: { role_public_id: roleId },
      });
      return reply.code(204).send();
    },
  };
}
