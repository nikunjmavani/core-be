import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { validatePublicIdParam } from '@/shared/utils/identity/public-id-param.util.js';
import type { WebhookService } from './webhook.service.js';
import { WebhookSerializer } from './webhook.serializer.js';

export function createWebhookController(service: WebhookService) {
  return {
    listWebhooks: async (
      request: FastifyRequest<{ Params: { id: string } }>,
      _reply: FastifyReply,
    ) => {
      requireAuth(request);
      const data = await service.list(validatePublicIdParam(request.params.id, 'id'));
      return successResponse(WebhookSerializer.many(data), getRequestIdentifier(request));
    },
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
    listDeliveryAttempts: async (
      request: FastifyRequest<{ Params: { id: string; webhookId: string } }>,
      _reply: FastifyReply,
    ) => {
      requireAuth(request);
      const limit = Number((request.query as { limit?: string }).limit) || 25;
      const data = await service.listDeliveryAttempts(
        validatePublicIdParam(request.params.id, 'id'),
        request.params.webhookId,
        limit,
      );
      return successResponse(WebhookSerializer.many(data), getRequestIdentifier(request));
    },
    testWebhook: async (
      request: FastifyRequest<{ Params: { id: string; webhookId: string } }>,
      _reply: FastifyReply,
    ) => {
      requireAuth(request);
      const data = await service.testWebhook(
        validatePublicIdParam(request.params.id, 'id'),
        request.params.webhookId,
      );
      return successResponse(WebhookSerializer.one(data), getRequestIdentifier(request));
    },
  };
}
