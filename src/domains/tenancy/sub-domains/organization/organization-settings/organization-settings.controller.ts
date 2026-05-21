import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { validatePublicIdParam } from '@/shared/utils/identity/public-id-param.util.js';
import type { OrganizationSettingsService } from './organization-settings.service.js';

export function createOrganizationSettingsController(service: OrganizationSettingsService) {
  return {
    getSettings: async (request: FastifyRequest, _reply: FastifyReply) => {
      const organizationId = validatePublicIdParam(
        (request.params as { id: string }).id ?? '',
        'id',
      );
      const data = await service.get(organizationId);
      return successResponse(data, getRequestIdentifier(request));
    },
    updateSettings: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const organizationId = validatePublicIdParam(
        (request.params as { id: string }).id ?? '',
        'id',
      );
      const data = await service.update(organizationId, request.body, auth.userId);
      return successResponse(data, getRequestIdentifier(request));
    },
  };
}
