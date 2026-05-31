import type { FastifyReply, FastifyRequest } from 'fastify';
import { paginatedResponse, successResponse } from '@/shared/utils/http/response.util.js';
import {
  getRequestIdentifier,
  requireAuth,
  requirePrincipal,
} from '@/shared/utils/http/request.util.js';
import { validatePublicIdParam } from '@/shared/utils/identity/public-id-param.util.js';
import type { MembershipService } from './membership.service.js';

/**
 * Builds the HTTP handler map for the organization membership routes under
 * `/organizations/:id/memberships` plus the self-service `leave` and
 * `transfer-ownership` actions that take an organization id as the only
 * path param.
 */
export function createMembershipController(service: MembershipService) {
  return {
    listMemberships: async (request: FastifyRequest, _reply: FastifyReply) => {
      const organizationId = validatePublicIdParam(
        (request.params as { id: string }).id ?? '',
        'id',
      );
      const result = await service.list(organizationId, request.query);
      return paginatedResponse(result.items, getRequestIdentifier(request), {
        per_page: result.limit,
        next: result.next_cursor,
        has_more: result.has_more,
        ...(result.total !== null ? { estimated_total: result.total } : {}),
      });
    },
    getMembership: async (request: FastifyRequest, _reply: FastifyReply) => {
      const { id: organizationId, membershipId } = (request.params as {
        id: string;
        membershipId: string;
      }) ?? { id: '', membershipId: '' };
      const data = await service.getByPublicId(organizationId, membershipId);
      return successResponse(data, getRequestIdentifier(request));
    },
    createMembership: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requirePrincipal(request);
      const organizationId = validatePublicIdParam(
        (request.params as { id: string }).id ?? '',
        'id',
      );
      const data = await service.create(organizationId, request.body, auth.userId);
      reply.code(201);
      return successResponse(data, getRequestIdentifier(request));
    },
    updateMembership: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requirePrincipal(request);
      const { id: organizationId, membershipId } = (request.params as {
        id: string;
        membershipId: string;
      }) ?? { id: '', membershipId: '' };
      const data = await service.update(organizationId, membershipId, request.body, auth.userId);
      return successResponse(data, getRequestIdentifier(request));
    },
    deleteMembership: async (request: FastifyRequest, reply: FastifyReply) => {
      requirePrincipal(request);
      const { id: organizationId, membershipId } = (request.params as {
        id: string;
        membershipId: string;
      }) ?? { id: '', membershipId: '' };
      await service.delete(organizationId, membershipId);
      return reply.code(204).send();
    },
    getMembershipPermissions: async (request: FastifyRequest, _reply: FastifyReply) => {
      const { id: organizationId, membershipId } = (request.params as {
        id: string;
        membershipId: string;
      }) ?? { id: '', membershipId: '' };
      const data = await service.getPermissions(organizationId, membershipId);
      return successResponse(data, getRequestIdentifier(request));
    },
    leaveOrganization: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      const organizationId = validatePublicIdParam(
        (request.params as { id: string }).id ?? '',
        'id',
      );
      await service.leaveOrganization(organizationId, auth.userId);
      return reply.code(204).send();
    },
    transferOwnership: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const organizationId = validatePublicIdParam(
        (request.params as { id: string }).id ?? '',
        'id',
      );
      const data = await service.transferOwnership(organizationId, request.body, auth.userId);
      return successResponse(data, getRequestIdentifier(request));
    },
  };
}
