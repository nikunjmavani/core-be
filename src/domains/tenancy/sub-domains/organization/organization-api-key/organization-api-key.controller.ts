import type { FastifyReply, FastifyRequest } from 'fastify';
import { paginatedResponse, successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { validatePublicIdParam } from '@/shared/utils/identity/public-id-param.util.js';
import type { OrganizationApiKeyService } from './organization-api-key.service.js';

export function createOrganizationApiKeyController(service: OrganizationApiKeyService) {
  return {
    listApiKeys: async (request: FastifyRequest, _reply: FastifyReply) => {
      const organizationId = validatePublicIdParam(
        (request.params as { id: string }).id ?? '',
        'id',
      );
      const result = await service.list(organizationId, request.query);
      return paginatedResponse(result.items, getRequestIdentifier(request), {
        per_page: result.limit,
        next: null,
        has_more: result.page * result.limit < result.total,
        estimated_total: result.total,
      });
    },
    getApiKey: async (request: FastifyRequest, _reply: FastifyReply) => {
      const { id: organizationId, apiKeyId } = (request.params as {
        id: string;
        apiKeyId: string;
      }) ?? { id: '', apiKeyId: '' };
      const data = await service.getByPublicId(organizationId, apiKeyId);
      return successResponse(data, getRequestIdentifier(request));
    },
    createApiKey: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      const organizationId = validatePublicIdParam(
        (request.params as { id: string }).id ?? '',
        'id',
      );
      const result = await service.create(organizationId, request.body, auth.userId);
      reply.code(201);
      return successResponse(
        { api_key: result.api_key, raw_key: result.raw_key },
        getRequestIdentifier(request),
      );
    },
    updateApiKey: async (request: FastifyRequest, _reply: FastifyReply) => {
      const auth = requireAuth(request);
      const { id: organizationId, apiKeyId } = (request.params as {
        id: string;
        apiKeyId: string;
      }) ?? { id: '', apiKeyId: '' };
      const data = await service.update(organizationId, apiKeyId, request.body, auth.userId);
      return successResponse(data, getRequestIdentifier(request));
    },
    deleteApiKey: async (request: FastifyRequest, reply: FastifyReply) => {
      requireAuth(request);
      const { id: organizationId, apiKeyId } = (request.params as {
        id: string;
        apiKeyId: string;
      }) ?? { id: '', apiKeyId: '' };
      await service.delete(organizationId, apiKeyId);
      return reply.code(204).send();
    },
    rotateApiKey: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      const { id: organizationId, apiKeyId } = (request.params as {
        id: string;
        apiKeyId: string;
      }) ?? { id: '', apiKeyId: '' };
      const result = await service.rotate(organizationId, apiKeyId, auth.userId);
      reply.code(201);
      return successResponse(
        { api_key: result.api_key, raw_key: result.raw_key },
        getRequestIdentifier(request),
      );
    },
  };
}
