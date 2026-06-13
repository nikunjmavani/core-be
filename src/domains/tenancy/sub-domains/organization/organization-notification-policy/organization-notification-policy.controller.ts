import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@/shared/utils/http/response.util.js';
import {
  getActingUserPublicId,
  getRequestIdentifier,
  requirePrincipal,
  resolveActiveOrganizationId,
} from '@/shared/utils/http/request.util.js';
import { validatePublicIdParam } from '@/shared/utils/identity/public-id-param.util.js';
import type { OrganizationNotificationPolicyService } from './organization-notification-policy.service.js';

/**
 * Builds the Fastify handler map for `/organizations/:organization_id/notification-policies`
 * routes — list, get, create, update, delete. Validates BOTH the
 * organization `id` and the `policyId` path params via
 * {@link validatePublicIdParam}.
 *
 * @remarks
 * sec-T5: this handler used to coerce `policyId` to a positive integer
 * (`validatePolicyIdParam`), exposing the row's `bigserial` `id` in URLs
 * and serialised responses — a convention break against the rest of the
 * codebase (which uses 21-char base62 `public_id` strings) and a minor
 * cross-tenant volume oracle via the auto-increment value. The schema
 * already provisions a `public_id` column on
 * `tenancy.organization_notification_policies`, and the unique index
 * `idx_organization_notification_policies_public_id` makes lookups
 * O(1). Switch both inputs and outputs to the public id.
 */
export function createOrganizationNotificationPolicyController(
  service: OrganizationNotificationPolicyService,
) {
  return {
    listPolicies: async (request: FastifyRequest, _reply: FastifyReply) => {
      const organizationId = resolveActiveOrganizationId(request);
      const data = await service.list(organizationId);
      return successResponse(data, getRequestIdentifier(request));
    },
    getPolicy: async (request: FastifyRequest, _reply: FastifyReply) => {
      const { policy_id: policyId } = (request.params as {
        policy_id: string;
      }) ?? { policy_id: '' };
      const organizationId = resolveActiveOrganizationId(request);
      const data = await service.getByPublicId(
        organizationId,
        validatePublicIdParam(policyId, 'policy_id'),
      );
      return successResponse(data, getRequestIdentifier(request));
    },
    createPolicy: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requirePrincipal(request);
      const organizationId = resolveActiveOrganizationId(request);
      const data = await service.create(organizationId, request.body, getActingUserPublicId(auth));
      reply.code(201);
      return successResponse(data, getRequestIdentifier(request));
    },
    updatePolicy: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requirePrincipal(request);
      const { policy_id: policyId } = (request.params as {
        policy_id: string;
      }) ?? { policy_id: '' };
      const organizationId = resolveActiveOrganizationId(request);
      const data = await service.update(
        organizationId,
        validatePublicIdParam(policyId, 'policy_id'),
        request.body,
        getActingUserPublicId(auth),
      );
      return successResponse(data, getRequestIdentifier(request));
    },
    deletePolicy: async (request: FastifyRequest, reply: FastifyReply) => {
      requirePrincipal(request);
      const { policy_id: policyId } = (request.params as {
        policy_id: string;
      }) ?? { policy_id: '' };
      const organizationId = resolveActiveOrganizationId(request);
      await service.delete(organizationId, validatePublicIdParam(policyId, 'policy_id'));
      return reply.code(204).send();
    },
  };
}
