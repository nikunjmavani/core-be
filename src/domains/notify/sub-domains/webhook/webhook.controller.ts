import type { FastifyReply, FastifyRequest } from 'fastify';
import { paginatedResponse, successResponse } from '@/shared/utils/http/response.util.js';
import {
  getActingUserPublicId,
  getRequestIdentifier,
  requirePrincipal,
  resolveActiveOrganizationId,
} from '@/shared/utils/http/request.util.js';
import { validatePublicIdParam } from '@/shared/utils/identity/public-id-param.util.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import type { WebhookService } from './webhook.service.js';
import { WebhookDeliveryAttemptSerializer } from './webhook.serializer.js';
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
  return async (
    request: FastifyRequest<{ Params: { organization_id: string } }>,
    _reply: FastifyReply,
  ) => {
    requirePrincipal(request);
    const parsed = validateListWebhooksQuery(request.query);
    const result = await service.list(
      omitUndefined({
        organization_public_id: resolveActiveOrganizationId(request),
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
    request: FastifyRequest<{ Params: { organization_id: string; webhook_id: string } }>,
    _reply: FastifyReply,
  ) => {
    requirePrincipal(request);
    const parsed = validateListWebhookDeliveryAttemptsQuery(request.query);
    const result = await service.listDeliveryAttempts(
      omitUndefined({
        organization_public_id: resolveActiveOrganizationId(request),
        // sec-new-N1: reject malformed webhookId before reaching the service layer.
        webhook_public_id: validatePublicIdParam(request.params.webhook_id, 'webhook_id'),
        after: parsed.after,
        limit: parsed.limit,
        include_total: parsed.include_total === 'true',
      }),
    );
    return paginatedResponse(
      WebhookDeliveryAttemptSerializer.many(result.items),
      getRequestIdentifier(request),
      buildCursorPaginationMetadata(result),
    );
  };
}

/**
 * Build the Fastify handler map for `/organizations/:organization_id/webhooks` — coordinates organization
 * scoping, validation, {@link WebhookService} calls, and {@link WebhookSerializer} output (which
 * also strips encrypted-secret fields from responses).
 */
export function createWebhookController(service: WebhookService) {
  return {
    listWebhooks: createListWebhooksHandler(service),
    getWebhook: async (
      request: FastifyRequest<{ Params: { organization_id: string; webhook_id: string } }>,
      _reply: FastifyReply,
    ) => {
      requirePrincipal(request);
      // sec-new-N1: reject malformed webhookId before reaching the service layer.
      const data = await service.get(
        resolveActiveOrganizationId(request),
        validatePublicIdParam(request.params.webhook_id, 'webhook_id'),
      );
      // sec-T #17: service already returns the serialized public shape (id, url,
      // events, is_enabled, ...). Re-running WebhookSerializer.one over it would
      // double-serialize and (with the typed projection) reject the input shape.
      return successResponse(data, getRequestIdentifier(request));
    },
    createWebhook: async (
      request: FastifyRequest<{ Params: { organization_id: string } }>,
      reply: FastifyReply,
    ) => {
      const auth = requirePrincipal(request);
      const data = await service.create(
        resolveActiveOrganizationId(request),
        request.body,
        getActingUserPublicId(auth),
      );
      reply.code(201);
      return successResponse(data, getRequestIdentifier(request));
    },
    updateWebhook: async (
      request: FastifyRequest<{ Params: { organization_id: string; webhook_id: string } }>,
      _reply: FastifyReply,
    ) => {
      const auth = requirePrincipal(request);
      // sec-new-N1: reject malformed webhookId before reaching the service layer.
      const data = await service.update(
        resolveActiveOrganizationId(request),
        validatePublicIdParam(request.params.webhook_id, 'webhook_id'),
        request.body,
        getActingUserPublicId(auth),
      );
      return successResponse(data, getRequestIdentifier(request));
    },
    deleteWebhook: async (
      request: FastifyRequest<{ Params: { organization_id: string; webhook_id: string } }>,
      reply: FastifyReply,
    ) => {
      requirePrincipal(request);
      // sec-new-N1: reject malformed webhookId before reaching the service layer.
      await service.delete(
        resolveActiveOrganizationId(request),
        validatePublicIdParam(request.params.webhook_id, 'webhook_id'),
      );
      return reply.code(204).send();
    },
    listDeliveryAttempts: createListDeliveryAttemptsHandler(service),
    testWebhook: async (
      request: FastifyRequest<{ Params: { organization_id: string; webhook_id: string } }>,
      _reply: FastifyReply,
    ) => {
      requirePrincipal(request);
      // sec-new-N1: reject malformed webhookId before reaching the service layer.
      const data = await service.testWebhook({
        organization_public_id: resolveActiveOrganizationId(request),
        webhook_public_id: validatePublicIdParam(request.params.webhook_id, 'webhook_id'),
        requestId: getRequestIdentifier(request),
      });
      // sec-T #17: testWebhook returns its own shape (success/status_code/delivered_at/
      // response_body), NOT a webhook row — return it directly without re-running
      // WebhookSerializer.one over it.
      return successResponse(data, getRequestIdentifier(request));
    },
  };
}
