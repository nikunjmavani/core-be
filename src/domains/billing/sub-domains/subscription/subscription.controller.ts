import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '@/shared/utils/http/response.util.js';
import {
  getActingUserPublicId,
  getRequestIdentifier,
  requirePrincipal,
} from '@/shared/utils/http/request.util.js';
import { validatePublicIdParam } from '@/shared/utils/identity/public-id-param.util.js';
import type { SubscriptionService } from './subscription.service.js';
import { SubscriptionSerializer } from './subscription.serializer.js';

function readIdempotencyKey(request: FastifyRequest): string | undefined {
  return typeof request.headers['idempotency-key'] === 'string'
    ? request.headers['idempotency-key']
    : undefined;
}

/**
 * Builds organization-scoped subscription handlers (list / get / create /
 * update / change-plan / cancel / resume). Each handler validates the
 * organization `id` AND the `subscriptionId` path params (sec-B10); externally
 * mutating routes also require the `Idempotency-Key` header before delegating
 * to {@link SubscriptionService}.
 *
 * @remarks
 * sec-B10: every handler used to validate the organization `id` but threaded
 * `request.params.subscription_id` to the service unchecked. Not an IDOR (the
 * service uses an exact-match WHERE), but unbounded attacker-supplied input
 * would otherwise flow into Sentry breadcrumbs, log payloads, and route-tagged
 * metric labels — a small cardinality + content-exfiltration foot-gun.
 * Validate both ids at the boundary so observability cannot be poisoned.
 */
export function createSubscriptionController(service: SubscriptionService) {
  return {
    listSubscriptions: async (
      request: FastifyRequest<{ Params: { organization_id: string } }>,
      _reply: FastifyReply,
    ) => {
      requirePrincipal(request);
      const data = await service.list(
        validatePublicIdParam(request.params.organization_id, 'organization_id'),
      );
      return successResponse(SubscriptionSerializer.many(data), getRequestIdentifier(request));
    },
    getSubscription: async (
      request: FastifyRequest<{ Params: { organization_id: string; subscription_id: string } }>,
      _reply: FastifyReply,
    ) => {
      requirePrincipal(request);
      const data = await service.get(
        validatePublicIdParam(request.params.organization_id, 'organization_id'),
        validatePublicIdParam(request.params.subscription_id, 'subscription_id'),
      );
      return successResponse(SubscriptionSerializer.one(data), getRequestIdentifier(request));
    },
    createSubscription: async (
      request: FastifyRequest<{ Params: { organization_id: string } }>,
      reply: FastifyReply,
    ) => {
      const auth = requirePrincipal(request);
      const idempotencyKey = readIdempotencyKey(request);
      const data = await service.create(
        validatePublicIdParam(request.params.organization_id, 'organization_id'),
        request.body,
        getActingUserPublicId(auth),
        idempotencyKey,
      );
      reply.code(201);
      return successResponse(SubscriptionSerializer.one(data), getRequestIdentifier(request));
    },
    updateSubscription: async (
      request: FastifyRequest<{ Params: { organization_id: string; subscription_id: string } }>,
      _reply: FastifyReply,
    ) => {
      requirePrincipal(request);
      const data = await service.update(
        validatePublicIdParam(request.params.organization_id, 'organization_id'),
        validatePublicIdParam(request.params.subscription_id, 'subscription_id'),
        request.body,
      );
      return successResponse(SubscriptionSerializer.one(data), getRequestIdentifier(request));
    },
    changePlan: async (
      request: FastifyRequest<{ Params: { organization_id: string; subscription_id: string } }>,
      _reply: FastifyReply,
    ) => {
      requirePrincipal(request);
      const data = await service.changePlan(
        validatePublicIdParam(request.params.organization_id, 'organization_id'),
        validatePublicIdParam(request.params.subscription_id, 'subscription_id'),
        request.body,
        readIdempotencyKey(request),
      );
      return successResponse(SubscriptionSerializer.one(data), getRequestIdentifier(request));
    },
    cancelSubscription: async (
      request: FastifyRequest<{ Params: { organization_id: string; subscription_id: string } }>,
      _reply: FastifyReply,
    ) => {
      requirePrincipal(request);
      const data = await service.cancel(
        validatePublicIdParam(request.params.organization_id, 'organization_id'),
        validatePublicIdParam(request.params.subscription_id, 'subscription_id'),
        readIdempotencyKey(request),
      );
      return successResponse(SubscriptionSerializer.one(data), getRequestIdentifier(request));
    },
    resumeSubscription: async (
      request: FastifyRequest<{ Params: { organization_id: string; subscription_id: string } }>,
      _reply: FastifyReply,
    ) => {
      requirePrincipal(request);
      const data = await service.resume(
        validatePublicIdParam(request.params.organization_id, 'organization_id'),
        validatePublicIdParam(request.params.subscription_id, 'subscription_id'),
        readIdempotencyKey(request),
      );
      return successResponse(SubscriptionSerializer.one(data), getRequestIdentifier(request));
    },
  };
}
