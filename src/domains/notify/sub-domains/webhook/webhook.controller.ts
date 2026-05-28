import type { FastifyReply, FastifyRequest } from 'fastify';
import { paginatedResponse, successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { validatePublicIdParam } from '@/shared/utils/identity/public-id-param.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { WebhookService } from './webhook.service.js';
import { WebhookSerializer } from './webhook.serializer.js';
import {
  validateListWebhookDeliveryAttemptsQuery,
  validateListWebhooksQuery,
} from './webhook.validator.js';

interface CursorPaginationResult {
  limit: number;
  has_more: boolean;
  next_cursor: string | null;
  total: number | null;
}

function buildCursorPaginationMetadata(result: CursorPaginationResult) {
  return {
    per_page: result.limit,
    next: result.next_cursor,
    has_more: result.has_more,
    ...(result.total !== null ? { estimated_total: result.total } : {}),
  };
}

function createListWebhooksHandler(service: WebhookService) {
  return async (request: FastifyRequest<{ Params: { id: string } }>, _reply: FastifyReply) => {
    requireAuth(request);
    const parsed = validateListWebhooksQuery(request.query);
    const result = await service.list(
      omitUndefined({
        organization_public_id: validatePublicIdParam(request.params.id, 'id'),
        after: parsed.after,
        limit: parsed.limit,
        include_total: parsed.include_total === 'true',
      }),
    );
    return paginatedResponse(
      result.items,
      getRequestIdentifier(request),
      buildCursorPaginationMetadata(result),
    );
  };
}

function createListDeliveryAttemptsHandler(service: WebhookService) {
  return async (
    request: FastifyRequest<{ Params: { id: string; webhookId: string } }>,
    _reply: FastifyReply,
  ) => {
    requireAuth(request);
    const parsed = validateListWebhookDeliveryAttemptsQuery(request.query);
    const result = await service.listDeliveryAttempts(
      omitUndefined({
        organization_public_id: validatePublicIdParam(request.params.id, 'id'),
        webhook_public_id: request.params.webhookId,
        after: parsed.after,
        limit: parsed.limit,
        include_total: parsed.include_total === 'true',
      }),
    );
    return paginatedResponse(
      WebhookSerializer.many(result.items),
      getRequestIdentifier(request),
      buildCursorPaginationMetadata(result),
    );
  };
}

/**
 * Build the Fastify handler map for `/organizations/:id/webhooks` — coordinates organization
 * scoping, validation, {@link WebhookService} calls, and {@link WebhookSerializer} output (which
 * also strips encrypted-secret fields from responses).
 */
export function createWebhookController(service: WebhookService) {
  return {
    listWebhooks: createListWebhooksHandler(service),
    getWebhook: async (
      request: FastifyRequest<{ Params: { id: string; webhookId: string } }>,
      _reply: FastifyReply,
    ) => {
      requireAuth(request);
      const data = await service.get(
        validatePublicIdParam(request.params.id, 'id'),
        request.params.webhookId,
      );
      return successResponse(WebhookSerializer.one(data), getRequestIdentifier(request));
    },
    createWebhook: async (
      request: FastifyRequest<{ Params: { id: string } }>,
      _reply: FastifyReply,
    ) => {
      const auth = requireAuth(request);
      const data = await service.create(
        validatePublicIdParam(request.params.id, 'id'),
        request.body,
        auth.userId,
      );
      return successResponse(WebhookSerializer.one(data), getRequestIdentifier(request));
    },
    updateWebhook: async (
      request: FastifyRequest<{ Params: { id: string; webhookId: string } }>,
      _reply: FastifyReply,
    ) => {
      const auth = requireAuth(request);
      const data = await service.update(
        validatePublicIdParam(request.params.id, 'id'),
        request.params.webhookId,
        request.body,
        auth.userId,
      );
      return successResponse(WebhookSerializer.one(data), getRequestIdentifier(request));
    },
    deleteWebhook: async (
      request: FastifyRequest<{ Params: { id: string; webhookId: string } }>,
      reply: FastifyReply,
    ) => {
      requireAuth(request);
      await service.delete(
        validatePublicIdParam(request.params.id, 'id'),
        request.params.webhookId,
      );
      return reply.code(204).send();
    },
    listDeliveryAttempts: createListDeliveryAttemptsHandler(service),
    testWebhook: async (
      request: FastifyRequest<{ Params: { id: string; webhookId: string } }>,
      _reply: FastifyReply,
    ) => {
      requireAuth(request);
      const data = await service.testWebhook({
        organization_public_id: validatePublicIdParam(request.params.id, 'id'),
        webhook_public_id: request.params.webhookId,
        requestId: getRequestIdentifier(request),
      });
      return successResponse(WebhookSerializer.one(data), getRequestIdentifier(request));
    },
  };
}
