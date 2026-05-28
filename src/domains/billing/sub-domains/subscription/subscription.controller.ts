import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@/shared/utils/http/response.util.js';
import { getRequestIdentifier, requireAuth } from '@/shared/utils/http/request.util.js';
import { validatePublicIdParam } from '@/shared/utils/identity/public-id-param.util.js';
import type { SubscriptionService } from './subscription.service.js';
import { SubscriptionSerializer } from './subscription.serializer.js';

/**
 * Builds organization-scoped subscription handlers (list / get / create /
 * update / change-plan / cancel / resume). Each handler validates the
 * organization `id` path param and the `Idempotency-Key` header on create
 * before delegating to {@link SubscriptionService}.
 */
export function createSubscriptionController(service: SubscriptionService) {
  return {
    listSubscriptions: async (
      request: FastifyRequest<{ Params: { id: string } }>,
      _reply: FastifyReply,
    ) => {
      requireAuth(request);
      const data = await service.list(validatePublicIdParam(request.params.id, 'id'));
      return successResponse(SubscriptionSerializer.many(data), getRequestIdentifier(request));
    },
    getSubscription: async (
      request: FastifyRequest<{ Params: { id: string; subscriptionId: string } }>,
      _reply: FastifyReply,
    ) => {
      requireAuth(request);
      const data = await service.get(
        validatePublicIdParam(request.params.id, 'id'),
        request.params.subscriptionId,
      );
      return successResponse(SubscriptionSerializer.one(data), getRequestIdentifier(request));
    },
    createSubscription: async (
      request: FastifyRequest<{ Params: { id: string } }>,
      _reply: FastifyReply,
    ) => {
      const auth = requireAuth(request);
      const idempotencyKey =
        typeof request.headers['idempotency-key'] === 'string'
          ? request.headers['idempotency-key']
          : undefined;
      const data = await service.create(
        validatePublicIdParam(request.params.id, 'id'),
        request.body,
        auth.userId,
        idempotencyKey,
      );
      return successResponse(SubscriptionSerializer.one(data), getRequestIdentifier(request));
    },
    updateSubscription: async (
      request: FastifyRequest<{ Params: { id: string; subscriptionId: string } }>,
      _reply: FastifyReply,
    ) => {
      requireAuth(request);
      const data = await service.update(
        validatePublicIdParam(request.params.id, 'id'),
        request.params.subscriptionId,
        request.body,
      );
      return successResponse(SubscriptionSerializer.one(data), getRequestIdentifier(request));
    },
    changePlan: async (
      request: FastifyRequest<{ Params: { id: string; subscriptionId: string } }>,
      _reply: FastifyReply,
    ) => {
      requireAuth(request);
      const data = await service.changePlan(
        validatePublicIdParam(request.params.id, 'id'),
        request.params.subscriptionId,
        request.body,
      );
      return successResponse(SubscriptionSerializer.one(data), getRequestIdentifier(request));
    },
    cancelSubscription: async (
      request: FastifyRequest<{ Params: { id: string; subscriptionId: string } }>,
      _reply: FastifyReply,
    ) => {
      requireAuth(request);
      const data = await service.cancel(
        validatePublicIdParam(request.params.id, 'id'),
        request.params.subscriptionId,
      );
      return successResponse(SubscriptionSerializer.one(data), getRequestIdentifier(request));
    },
    resumeSubscription: async (
      request: FastifyRequest<{ Params: { id: string; subscriptionId: string } }>,
      _reply: FastifyReply,
    ) => {
      requireAuth(request);
      const data = await service.resume(
        validatePublicIdParam(request.params.id, 'id'),
        request.params.subscriptionId,
      );
      return successResponse(SubscriptionSerializer.one(data), getRequestIdentifier(request));
    },
  };
}
