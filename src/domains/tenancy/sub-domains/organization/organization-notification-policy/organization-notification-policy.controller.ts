import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { validatePublicIdParam } from '@/shared/utils/identity/public-id-param.util.js';
import { validatePolicyIdParam } from './organization-notification-policy.validator.js';
import type { OrganizationNotificationPolicyService } from './organization-notification-policy.service.js';

/**
 * Builds the Fastify handler map for `/organizations/:id/notification-policies`
 * routes — list, get, create, update, delete. Validates the numeric
 * `policyId` path param via {@link validatePolicyIdParam}.
 */
export function createOrganizationNotificationPolicyController(
  service: OrganizationNotificationPolicyService,
) {
  return {
    listPolicies: async (request: FastifyRequest, _reply: FastifyReply) => {
      const organizationId = validatePublicIdParam(
        (request.params as { id: string }).id ?? '',
        'id',
      );
      const data = await service.list(organizationId);
      return successResponse(data, getRequestIdentifier(request));
    },
    getPolicy: async (request: FastifyRequest, _reply: FastifyReply) => {
      const { id: organizationId, policyId } = (request.params as {
        id: string;
        policyId: string;
      }) ?? { id: '', policyId: '' };
      const policyIdNumber = validatePolicyIdParam(policyId);
      const data = await service.getById(organizationId, policyIdNumber);
      return successResponse(data, getRequestIdentifier(request));
    },
    createPolicy: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      const organizationId = validatePublicIdParam(
        (request.params as { id: string }).id ?? '',
        'id',
      );
      const data = await service.create(organizationId, request.body, auth.userId);
      reply.code(201);
      return successResponse(data, getRequestIdentifier(request));
    },
    updatePolicy: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const { id: organizationId, policyId } = (request.params as {
        id: string;
        policyId: string;
      }) ?? { id: '', policyId: '' };
      const policyIdNumber = validatePolicyIdParam(policyId);
      const data = await service.update(organizationId, policyIdNumber, request.body, auth.userId);
      return successResponse(data, getRequestIdentifier(request));
    },
    deletePolicy: async (request: FastifyRequest, reply: FastifyReply) => {
      requireAuth(request);
      const { id: organizationId, policyId } = (request.params as {
        id: string;
        policyId: string;
      }) ?? { id: '', policyId: '' };
      const policyIdNumber = validatePolicyIdParam(policyId);
      await service.delete(organizationId, policyIdNumber);
      return reply.code(204).send();
    },
  };
}
