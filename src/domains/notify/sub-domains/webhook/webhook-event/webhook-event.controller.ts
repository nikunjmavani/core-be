import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requirePrincipal } from '@/shared/utils/http/request.util.js';
import { serializeWebhookEventList } from './webhook-event.serializer.js';
import type { WebhookEventService } from './webhook-event.service.js';

/**
 * Build the Fastify handler map for `GET /organizations/:organization_id/webhook-events` — returns the
 * static catalog of dispatchable webhook event types.
 */
export function createWebhookEventController(service: WebhookEventService) {
  return {
    listWebhookEvents: async (
      request: FastifyRequest<{ Params: { organization_id: string } }>,
      _reply: FastifyReply,
    ) => {
      requirePrincipal(request);
      const events = await service.list();
      const serialized = serializeWebhookEventList(events);
      return successResponse(serialized, getRequestIdentifier(request));
    },
  };
}
