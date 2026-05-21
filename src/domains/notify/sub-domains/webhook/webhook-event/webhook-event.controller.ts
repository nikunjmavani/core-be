import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { serializeWebhookEventList } from './webhook-event.serializer.js';
import type { WebhookEventService } from './webhook-event.service.js';

export function createWebhookEventController(service: WebhookEventService) {
  return {
    listWebhookEvents: async (
      request: FastifyRequest<{ Params: { id: string } }>,
      _reply: FastifyReply,
    ) => {
      requireAuth(request);
      const events = await service.list();
      const serialized = serializeWebhookEventList(events);
      return successResponse(serialized, getRequestIdentifier(request));
    },
  };
}
