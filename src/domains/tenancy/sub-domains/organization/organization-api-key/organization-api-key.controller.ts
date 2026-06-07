import type { FastifyReply, FastifyRequest } from 'fastify';
import { paginatedResponse, successResponse } from '@/shared/utils/http/response.util.js';
import {
  getActingUserPublicId,
  getRequestIdentifier,
  requireAuth,
  requirePrincipal,
} from '@/shared/utils/http/request.util.js';
import { validatePublicIdParam } from '@/shared/utils/identity/public-id-param.util.js';
import type { OrganizationApiKeyService } from './organization-api-key.service.js';

/**
 * Builds the Fastify handler map for `/organizations/:id/api-keys` routes —
 * list, get, create (returns the raw key once), update, delete, and rotate.
 * Wraps service calls with principal validation, public-id validation, and the
 * standard response shapers. Create/rotate require a real user principal
 * because they mint new secrets and perform scope-grant checks.
 */
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
        next: result.next_cursor,
        has_more: result.has_more,
        ...(result.total !== null ? { estimated_total: result.total } : {}),
      });
    },
    getApiKey: async (request: FastifyRequest, _reply: FastifyReply) => {
      const rawParams = (request.params as { id: string; apiKeyId: string }) ?? {
        id: '',
        apiKeyId: '',
      };
      // sec-re-18 (sec-B10 class): bind path params at the boundary so an
      // attacker-supplied string never flows into Sentry breadcrumbs, log
      // payloads, or metric labels with unbounded cardinality.
      const organizationId = validatePublicIdParam(rawParams.id ?? '', 'id');
      const apiKeyId = validatePublicIdParam(rawParams.apiKeyId ?? '', 'apiKeyId');
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
      const auth = requirePrincipal(request);
      const rawParams = (request.params as { id: string; apiKeyId: string }) ?? {
        id: '',
        apiKeyId: '',
      };
      // sec-re-18 (sec-B10 class): bind path params at the boundary so an
      // attacker-supplied string never flows into Sentry breadcrumbs, log
      // payloads, or metric labels with unbounded cardinality.
      const organizationId = validatePublicIdParam(rawParams.id ?? '', 'id');
      const apiKeyId = validatePublicIdParam(rawParams.apiKeyId ?? '', 'apiKeyId');
      const data = await service.update(
        organizationId,
        apiKeyId,
        request.body,
        getActingUserPublicId(auth),
      );
      return successResponse(data, getRequestIdentifier(request));
    },
    deleteApiKey: async (request: FastifyRequest, reply: FastifyReply) => {
      requirePrincipal(request);
      const rawParams = (request.params as { id: string; apiKeyId: string }) ?? {
        id: '',
        apiKeyId: '',
      };
      // sec-re-18 (sec-B10 class): bind path params at the boundary so an
      // attacker-supplied string never flows into Sentry breadcrumbs, log
      // payloads, or metric labels with unbounded cardinality.
      const organizationId = validatePublicIdParam(rawParams.id ?? '', 'id');
      const apiKeyId = validatePublicIdParam(rawParams.apiKeyId ?? '', 'apiKeyId');
      await service.delete(organizationId, apiKeyId);
      return reply.code(204).send();
    },
    rotateApiKey: async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = requireAuth(request);
      const rawParams = (request.params as { id: string; apiKeyId: string }) ?? {
        id: '',
        apiKeyId: '',
      };
      // sec-re-18 (sec-B10 class): bind path params at the boundary so an
      // attacker-supplied string never flows into Sentry breadcrumbs, log
      // payloads, or metric labels with unbounded cardinality.
      const organizationId = validatePublicIdParam(rawParams.id ?? '', 'id');
      const apiKeyId = validatePublicIdParam(rawParams.apiKeyId ?? '', 'apiKeyId');
      const result = await service.rotate(organizationId, apiKeyId, auth.userId);
      reply.code(201);
      return successResponse(
        { api_key: result.api_key, raw_key: result.raw_key },
        getRequestIdentifier(request),
      );
    },
  };
}
