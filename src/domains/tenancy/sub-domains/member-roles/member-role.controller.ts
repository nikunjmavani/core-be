import type { FastifyReply, FastifyRequest } from 'fastify';
import { paginatedResponse, successResponse } from '@/shared/utils/http/response.util.js';
import {
  getActingUserPublicId,
  getRequestIdentifier,
  requirePrincipal,
} from '@/shared/utils/http/request.util.js';
import {
  cursorPaginationSchema,
  ensureCursorOnlyPagination,
} from '@/shared/utils/http/pagination.util.js';
import { validatePublicIdParam } from '@/shared/utils/identity/public-id-param.util.js';
import {
  buildAuditActorFields,
  recordScopedAuditEvent,
} from '@/shared/utils/infrastructure/audit-request-context.util.js';
import type { MemberRoleService } from './member-role.service.js';

/**
 * Builds the HTTP handler map for the organization role CRUD endpoints under
 * `/organizations/:organization_id/roles`. Mutating handlers also record a scoped audit
 * event via {@link recordScopedAuditEvent} so role lifecycle changes appear in
 * the audit log.
 */
export function createMemberRoleController(service: MemberRoleService) {
  return {
    listRoles: async (request: FastifyRequest, _reply: FastifyReply) => {
      const organizationId = validatePublicIdParam(
        (request.params as { organization_id: string }).organization_id ?? '',
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
      const { organization_id: rawOrgId, role_id: rawRoleId } = (request.params as {
        organization_id: string;
        role_id: string;
      }) ?? { organization_id: '', role_id: '' };
      // sec-new-T3: reject malformed path params before reaching the service layer.
      const organizationId = validatePublicIdParam(rawOrgId ?? '', 'organization_id');
      const roleId = validatePublicIdParam(rawRoleId ?? '', 'role_id');
      const data = await service.getByPublicId(organizationId, roleId);
      return successResponse(data, getRequestIdentifier(request));
    },
    createRole: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requirePrincipal(request);
      const organizationId = validatePublicIdParam(
        (request.params as { organization_id: string }).organization_id ?? '',
        'id',
      );
      const data = await service.create(organizationId, request.body, getActingUserPublicId(auth));
      await recordScopedAuditEvent(request, {
        ...buildAuditActorFields(auth),
        action: 'tenancy.role.create',
        resource_type: 'role',
        organizationPublicId: organizationId,
        metadata: { role_public_id: (data as { public_id?: string }).public_id },
      });
      reply.code(201);
      return successResponse(data, getRequestIdentifier(request));
    },
    updateRole: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requirePrincipal(request);
      const { organization_id: rawUpdateOrgId, role_id: rawUpdateRoleId } = (request.params as {
        organization_id: string;
        role_id: string;
      }) ?? { organization_id: '', role_id: '' };
      // sec-new-T3: reject malformed path params before reaching the service layer.
      const organizationId = validatePublicIdParam(rawUpdateOrgId ?? '', 'organization_id');
      const roleId = validatePublicIdParam(rawUpdateRoleId ?? '', 'role_id');
      const data = await service.update(
        organizationId,
        roleId,
        request.body,
        getActingUserPublicId(auth),
      );
      await recordScopedAuditEvent(request, {
        ...buildAuditActorFields(auth),
        action: 'tenancy.role.update',
        resource_type: 'role',
        organizationPublicId: organizationId,
        metadata: { role_public_id: roleId },
      });
      return successResponse(data, getRequestIdentifier(request));
    },
    deleteRole: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requirePrincipal(request);
      const { organization_id: rawDeleteOrgId, role_id: rawDeleteRoleId } = (request.params as {
        organization_id: string;
        role_id: string;
      }) ?? { organization_id: '', role_id: '' };
      // sec-new-T3: reject malformed path params before reaching the service layer.
      const organizationId = validatePublicIdParam(rawDeleteOrgId ?? '', 'organization_id');
      const roleId = validatePublicIdParam(rawDeleteRoleId ?? '', 'role_id');
      await service.delete(organizationId, roleId);
      await recordScopedAuditEvent(request, {
        ...buildAuditActorFields(auth),
        action: 'tenancy.role.delete',
        resource_type: 'role',
        organizationPublicId: organizationId,
        metadata: { role_public_id: roleId },
      });
      return reply.code(204).send();
    },
  };
}
